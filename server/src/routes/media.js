// Podcasts, speech-to-text and the in-tour chatbot.
const express = require('express');
const { availableModels, tourLanguages, voiceStatus, podcastStatus } = require('../setup');
const { db } = require('../db');
const { handle } = require('../http');
const { generateText } = require('../llm');
const { transcribe } = require('../speech');
const podcast = require('../podcast');

const router = express.Router();

router.get('/tours/:id/audio-segments', handle(async (req, res) => {
    res.json(await podcast.getSegmentIndexes(Number(req.params.id)));
}));

router.get('/tours/:id/audio-segments/:index/blob', handle(async (req, res) => {
    const audio = await podcast.getSegmentAudio(Number(req.params.id), Number(req.params.index));
    if (!audio) return res.status(404).send('Segment not found');
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'private, no-cache' });
    res.send(Buffer.from(audio));
}));

router.get('/tours/:id/audio_text', handle(async (req, res) => {
    const tourId = Number(req.params.id);
    if (Number.isNaN(tourId)) return res.status(400).json({ error: 'Invalid tour ID.' });
    const row = await db('voice_tours').where({ tour_id: tourId }).first('audio_text');
    if (!row) return res.status(404).json({ error: 'Audio text not found for this tour ID.' });
    res.status(200).json({ success: true, audio_text: row.audio_text });
}));

// Accepts either raw audio (application/octet-stream, audio/*) or JSON
// { audio: <base64>, mimeType: "audio/wav" }.
router.post(
    '/transcribe',
    express.raw({ type: ['application/octet-stream', 'audio/*'], limit: '50mb' }),
    handle(async (req, res) => {
        let buffer;
        let mimeType;
        if (Buffer.isBuffer(req.body)) {
            buffer = req.body;
            mimeType = req.get('X-Audio-Type') || (req.is('audio/*') ? req.get('Content-Type') : 'audio/webm');
        } else if (req.body?.audio) {
            buffer = Buffer.from(req.body.audio, 'base64');
            mimeType = req.body.mimeType || 'audio/wav';
        }
        if (!buffer || buffer.length === 0) {
            return res.status(400).json({ success: false, error: 'No audio received.' });
        }
        try {
            const transcript = await transcribe(buffer, mimeType);
            res.json({ success: true, transcript, text: transcript });
        } catch (err) {
            console.error('Transcription failed:', err.message);
            res.status(err.status || 502).json({ success: false, error: err.message, code: err.code });
        }
    }),
);

// What the tour forms may offer: AI models and tour languages the admin set up.
// Labels only, never keys. (/ai-models is the older name.)
router.get(['/tour-options', '/ai-models'], (req, res) => {
    const models = availableModels();
    res.json({
        models,
        languages: tourLanguages(),
        // Voice tours need speech-to-text as well as an AI model.
        voice: voiceStatus().ready && models.length > 0
            ? { ready: true }
            : { ready: false, message: models.length === 0
                ? 'Voice tours need an AI model, and none is set up on this server.'
                : `Voice tours are not set up on this server: ${voiceStatus().missing || 'speech-to-text'} is missing. Ask whoever runs it to add it.` },
        // Podcasts need text-to-speech as well as an AI model to write the script.
        podcasts: podcastStatus().ready && models.length > 0
            ? { ready: true }
            : { ready: false, message: `Podcasts are not set up on this server: ${podcastStatus().missing || 'an AI model'} is missing.` },
        message: models.length ? null
            : 'No AI model is set up on this Lacy server, so tours cannot be created yet. '
              + 'Ask whoever runs the server to add GEMINI_API_KEY (or OpenAI settings).',
    });
});

router.post('/generate-response', handle(async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });
    try {
        res.json({ response: await generateText(query) });
    } catch (err) {
        console.error('Chat response failed:', err.message);
        res.status(err.status || 500).json({ error: err.expose ? err.message : 'Failed to generate response', code: err.code });
    }
}));

module.exports = router;
