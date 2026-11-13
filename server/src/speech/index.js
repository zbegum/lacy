// Speech-to-text behind one function; STT_PROVIDER picks the service.
const { speech } = require('../config');
const { requireVoice } = require('../setup');

const providers = {
    elevenlabs: () => require('./elevenlabs'),
    google: () => require('./google'),
};

async function transcribe(buffer, mimeType = 'audio/webm') {
    requireVoice();
    const load = providers[speech.provider];
    if (!load) {
        throw new Error(`Unsupported STT_PROVIDER "${speech.provider}". Use elevenlabs or google.`);
    }
    const transcript = await load()(buffer, mimeType, speech.language);
    return transcript.trim();
}

module.exports = { transcribe };
