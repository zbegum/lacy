const config = require('./config');
const { db } = require('./db');
const { createApp } = require('./app');
const { purgeExpiredTokens } = require('./auth');
const { summaryLines } = require('./setup');

async function main() {
    // Bring the schema up to date on start, so a fresh install needs no manual step.
    await db.migrate.latest();

    await purgeExpiredTokens();

    const server = createApp().listen(config.port, config.host, () => {
        console.log(`Lacy is listening on http://${config.host}:${config.port}`);
        console.log(summaryLines().join('\n'));
    });
    // Tour generation with large files can take several minutes.
    server.requestTimeout = 30 * 60 * 1000;
    server.headersTimeout = 31 * 60 * 1000;
    server.keepAliveTimeout = 65 * 1000;

    const shutdown = () => server.close(() => db.destroy().then(() => process.exit(0)));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('Failed to start Lacy server:', err);
    process.exit(1);
});
