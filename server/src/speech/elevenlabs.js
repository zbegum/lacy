// ElevenLabs Scribe speech-to-text (ELEVENLABS_API_KEY).
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const { podcast } = require('../config');

let client;

async function transcribe(buffer, mimeType, languageCode) {
    if (!podcast.elevenLabsApiKey) {
        throw new Error('ELEVENLABS_API_KEY is not set.');
    }
    if (!client) client = new ElevenLabsClient({ apiKey: podcast.elevenLabsApiKey });

    const result = await client.speechToText.convert({
        file: new Blob([buffer], { type: mimeType }),
        modelId: 'scribe_v1',
        languageCode: languageCode.split('-')[0],
    });
    return result.text || '';
}

module.exports = transcribe;
