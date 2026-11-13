# Lacy server, with the expert dashboard built in.
FROM node:22-slim AS dashboard
WORKDIR /build
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

# python3/make/g++ are needed to build better-sqlite3 when no prebuilt binary exists.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/
COPY --from=dashboard /build/build ./dashboard/build

# /data should be a mounted volume: -v lacy-data:/data, or a Railway/Render disk.
ENV PORT=4000 DB_FILE=/data/lacy.sqlite AUDIO_DIR=/data/audio DASHBOARD_DIR=/app/dashboard/build
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
