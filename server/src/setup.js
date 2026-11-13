// What this server has been set up to do, from its environment.
//
// Keys live only on the server, so the person running it is the only one who
// can fix a missing one. Two uses: a summary printed at startup, so they can see
// what works at a glance; and a clear error, naming the setting to add, when
// someone uses a feature whose key is missing.
const config = require('./config');

class NotConfiguredError extends Error {
    constructor(feature, message) {
        super(message);
        this.code = 'LACY_NOT_CONFIGURED';
        this.feature = feature;
        // Read by the error handler: 503 and the message shown as is.
        this.status = 503;
        this.expose = true;
    }
}

const SETUP_HINT = 'Ask whoever runs your Lacy server to add it (see INSTALL.md).';

/** Tour writing. `provider` is the one a request asked for, or the default. */
function aiStatus(provider = config.llm.provider) {
    if (provider === 'gemini') {
        return config.llm.gemini.apiKey
            ? { ready: true, label: `Gemini (${config.llm.gemini.model})` }
            : { ready: false, label: 'Gemini', missing: 'GEMINI_API_KEY' };
    }
    if (provider === 'openai') {
        const { baseUrl, apiKey, model } = config.llm.openai;
        let host = baseUrl;
        try { host = new URL(baseUrl).host; } catch { /* shown as given */ }
        // A self-hosted endpoint (vLLM, Ollama, a gateway) may need no key;
        // OpenAI itself always does.
        if (!apiKey && /(^|\.)openai\.com$/.test(host)) {
            return { ready: false, label: 'OpenAI', missing: 'OPENAI_API_KEY' };
        }
        return { ready: true, label: `${model} at ${host}` };
    }
    return { ready: false, label: provider, problem: `LLM_PROVIDER is "${provider}"; use gemini or openai` };
}

/** Voice tours (speech to text). */
function voiceStatus() {
    if (config.speech.provider === 'elevenlabs') {
        return config.podcast.elevenLabsApiKey
            ? { ready: true, label: 'ElevenLabs' }
            : { ready: false, label: 'ElevenLabs', missing: 'ELEVENLABS_API_KEY' };
    }
    if (config.speech.provider === 'google') {
        return process.env.GOOGLE_APPLICATION_CREDENTIALS
            ? { ready: true, label: 'Google Speech' }
            : { ready: false, label: 'Google Speech', missing: 'GOOGLE_APPLICATION_CREDENTIALS' };
    }
    return { ready: false, label: config.speech.provider, problem: `STT_PROVIDER is "${config.speech.provider}"; use elevenlabs or google` };
}

/** Podcasts (text to speech). */
function podcastStatus() {
    return config.podcast.elevenLabsApiKey
        ? { ready: true, label: 'ElevenLabs' }
        : { ready: false, label: 'ElevenLabs', missing: 'ELEVENLABS_API_KEY' };
}

function missingText(status) {
    return status.missing ? `${status.missing} is not set` : status.problem;
}

function requireAi(provider) {
    const status = aiStatus(provider);
    if (!status.ready) {
        throw new NotConfiguredError('ai',
            `This Lacy server has no AI set up yet, so it cannot write tours or quizzes: ${missingText(status)}. ${SETUP_HINT}`);
    }
}

function requireVoice() {
    const status = voiceStatus();
    if (!status.ready) {
        throw new NotConfiguredError('voice',
            `Voice tours are not set up on this Lacy server: ${missingText(status)}. ${SETUP_HINT}`);
    }
}

function requirePodcasts() {
    const status = podcastStatus();
    if (!status.ready) {
        throw new NotConfiguredError('podcasts',
            `Podcasts are not set up on this Lacy server: ${missingText(status)}. ${SETUP_HINT}`);
    }
}

/**
 * The AI models people can pick when making a tour: only providers the admin has
 * actually set up, default first. OpenAI-compatible counts as set up once any of
 * its settings is given, since Lacy's built-in fallback (api.openai.com with no
 * key) is not something anyone chose.
 */
function availableModels() {
    const models = [];
    if (aiStatus('gemini').ready) {
        models.push({ id: 'gemini', label: `Gemini (${config.llm.gemini.model})` });
    }
    const openaiChosen = Boolean(process.env.OPENAI_BASE_URL || process.env.OPENAI_API_KEY || process.env.OPENAI_MODEL)
        || config.llm.provider === 'openai';
    if (openaiChosen && aiStatus('openai').ready) {
        models.push({ id: 'openai', label: aiStatus('openai').label });
    }
    models.sort((a, b) => (b.id === config.llm.provider) - (a.id === config.llm.provider));
    return models;
}

const LANGUAGE_NAMES = { en: 'English', tr: 'Turkish' };

/** The tour languages the admin allows, as {id, label}; English if none valid. */
function tourLanguages() {
    const seen = new Set();
    const chosen = (config.tourLanguages || []).filter((code) => LANGUAGE_NAMES[code] && !seen.has(code) && seen.add(code));
    return (chosen.length ? chosen : ['en']).map((id) => ({ id, label: LANGUAGE_NAMES[id] }));
}

/** A requested language if allowed, else the admin's default. */
function resolveLanguage(requested) {
    const allowed = tourLanguages().map((l) => l.id);
    const code = String(requested || '').toLowerCase();
    return allowed.includes(code) ? code : allowed[0];
}

/** One line per feature, for the startup log. */
function summaryLines() {
    const line = (name, status, optional) => {
        if (status.ready) return `  ✓ ${name.padEnd(12)} ${status.label}`;
        const mark = optional ? '–' : '✗';
        const tail = optional ? ' (optional)' : '  ← tours cannot be created until this is set';
        return `  ${mark} ${name.padEnd(12)} ${missingText(status)}${tail}`;
    };
    return [
        line('AI (tours)', aiStatus(), false),
        line('Voice tours', voiceStatus(), true),
        line('Podcasts', podcastStatus(), true),
        `  ✓ ${'Languages'.padEnd(12)} ${tourLanguages().map((l) => l.label).join(', ')}`,
    ];
}

/** Ready flags only; safe to show to anyone, it names no keys. */
function publicStatus() {
    return { ai: aiStatus().ready, voice: voiceStatus().ready, podcasts: podcastStatus().ready };
}

module.exports = {
    NotConfiguredError, aiStatus, voiceStatus, podcastStatus,
    requireAi, requireVoice, requirePodcasts, summaryLines, publicStatus, availableModels,
    tourLanguages, resolveLanguage,
};
