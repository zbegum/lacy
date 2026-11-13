// Central configuration. Everything deployment-specific comes from the
// environment (or a .env file next to server/ or at the repo root).
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const env = process.env;

function int(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? fallback : n;
}

function bool(value, fallback = false) {
    if (value === undefined || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const config = {
    port: int(env.PORT, 4000),
    host: env.HOST || '0.0.0.0',
    corsOrigin: env.CORS_ORIGIN || '*',

    db: {
        // Lacy stores everything in one SQLite file. A relative DB_FILE is resolved
        // against the repository root, so it means the same thing no matter which
        // directory the server was started from.
        file: path.resolve(path.join(__dirname, '../..'), env.DB_FILE || 'server/data/lacy.sqlite'),
    },

    llm: {
        // gemini | openai (any OpenAI-compatible chat completions endpoint)
        provider: (env.LLM_PROVIDER || 'gemini').toLowerCase(),
        gemini: {
            apiKey: env.GEMINI_API_KEY,
            model: env.GEMINI_MODEL || 'gemini-flash-latest',
        },
        openai: {
            baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
            apiKey: env.OPENAI_API_KEY,
            model: env.OPENAI_MODEL || 'gpt-4o-mini',
        },
    },

    speech: {
        // elevenlabs | google
        provider: (env.STT_PROVIDER || 'elevenlabs').toLowerCase(),
        language: env.STT_LANGUAGE || 'en-US',
    },

    podcast: {
        // Podcast audio is written here rather than into the database.
        audioDir: path.resolve(path.join(__dirname, '../..'), env.AUDIO_DIR || 'server/data/audio'),
        elevenLabsApiKey: env.ELEVENLABS_API_KEY,
        model: env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2',
        expertVoiceId: env.ELEVENLABS_EXPERT_VOICE_ID || 'uYXf8XasLslADfZ2MB4u',
        juniorVoiceId: env.ELEVENLABS_JUNIOR_VOICE_ID || 'UgBBYS2sOqTuMpoF3BR0',
    },

    // Let the server read project files from its own disk when a request only sends
    // paths (the old local-only mode). Off by default: a deployed server must not
    // read arbitrary paths supplied by clients.
    allowLocalFileAccess: bool(env.ALLOW_LOCAL_FILE_ACCESS),

    // Languages experts may write tours in, e.g. "en,tr". The first is the default.
    // Unknown codes are ignored; Lacy's prompts exist for en and tr.
    tourLanguages: String(env.TOUR_LANGUAGES || 'en').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean),

    // Directory with the built dashboard (dashboard/build). Served at "/" when present.
    dashboardDir: env.DASHBOARD_DIR || path.resolve(__dirname, '../../dashboard/build'),
};

module.exports = config;
