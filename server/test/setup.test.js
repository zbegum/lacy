// What the server reports about its own setup: the startup summary and the
// errors people see when a key is missing.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const setup = require('../src/setup');

const original = JSON.parse(JSON.stringify({ llm: config.llm, speech: config.speech, podcast: config.podcast }));
afterEach(() => {
    Object.assign(config.llm, JSON.parse(JSON.stringify(original.llm)));
    Object.assign(config.speech, original.speech);
    Object.assign(config.podcast, original.podcast);
});

test('Gemini with a key is ready; without one it names GEMINI_API_KEY', () => {
    config.llm.provider = 'gemini';
    config.llm.gemini.apiKey = 'k';
    assert.equal(setup.aiStatus().ready, true);
    config.llm.gemini.apiKey = undefined;
    assert.equal(setup.aiStatus().missing, 'GEMINI_API_KEY');
    assert.throws(() => setup.requireAi(), (err) => err.code === 'LACY_NOT_CONFIGURED' && /GEMINI_API_KEY/.test(err.message));
});

test('a self-hosted OpenAI-compatible endpoint needs no key, OpenAI itself does', () => {
    config.llm.provider = 'openai';
    config.llm.openai.apiKey = undefined;
    config.llm.openai.baseUrl = 'http://gpu-box:8000/v1';
    assert.equal(setup.aiStatus().ready, true);
    config.llm.openai.baseUrl = 'https://api.openai.com/v1';
    assert.equal(setup.aiStatus().missing, 'OPENAI_API_KEY');
});

test('the startup summary marks AI as required and voice/podcasts as optional', () => {
    config.llm.provider = 'gemini';
    config.llm.gemini.apiKey = undefined;
    config.podcast.elevenLabsApiKey = undefined;
    config.speech.provider = 'elevenlabs';
    const text = setup.summaryLines().join('\n');
    assert.match(text, /✗ AI \(tours\)\s+GEMINI_API_KEY is not set/);
    assert.match(text, /– Podcasts\s+ELEVENLABS_API_KEY is not set \(optional\)/);
});

test('the public status has ready flags only', () => {
    assert.deepEqual(Object.keys(setup.publicStatus()).sort(), ['ai', 'podcasts', 'voice']);
});

test('the model list holds only what the admin set up, default first', () => {
    config.llm.provider = 'gemini';
    config.llm.gemini.apiKey = 'k';
    const saved = { url: process.env.OPENAI_BASE_URL, key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
    delete process.env.OPENAI_BASE_URL; delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_MODEL;
    try {
        assert.deepEqual(setup.availableModels().map((m) => m.id), ['gemini']);

        config.llm.gemini.apiKey = undefined;
        assert.deepEqual(setup.availableModels(), [], 'nothing set up means nothing to pick');

        process.env.OPENAI_BASE_URL = 'http://gpu-box:8000/v1';
        config.llm.openai.baseUrl = 'http://gpu-box:8000/v1';
        config.llm.gemini.apiKey = 'k';
        config.llm.provider = 'openai';
        assert.deepEqual(setup.availableModels().map((m) => m.id), ['openai', 'gemini']);
        assert.ok(!JSON.stringify(setup.availableModels()).includes('"k"'), 'never includes a key');
    } finally {
        for (const [k, v] of Object.entries({ OPENAI_BASE_URL: saved.url, OPENAI_API_KEY: saved.key, OPENAI_MODEL: saved.model })) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
});

test('tour languages come from TOUR_LANGUAGES, English when unset or unknown', () => {
    const saved = config.tourLanguages;
    try {
        config.tourLanguages = ['en'];
        assert.deepEqual(setup.tourLanguages().map((l) => l.id), ['en']);
        config.tourLanguages = ['tr', 'en', 'tr', 'xx'];
        assert.deepEqual(setup.tourLanguages().map((l) => l.id), ['tr', 'en'], 'order kept, duplicates and unknowns dropped');
        assert.equal(setup.resolveLanguage('en'), 'en');
        assert.equal(setup.resolveLanguage('de'), 'tr', 'not allowed: the admin default');
        config.tourLanguages = ['xx'];
        assert.deepEqual(setup.tourLanguages().map((l) => l.id), ['en']);
    } finally {
        config.tourLanguages = saved;
    }
});
