// Google Cloud Speech-to-Text. Credentials come from the standard
// GOOGLE_APPLICATION_CREDENTIALS environment variable.
const speech = require('@google-cloud/speech');

let client;

async function transcribe(buffer, mimeType, languageCode) {
    if (!client) client = new speech.SpeechClient();

    const recognitionConfig = { languageCode, enableAutomaticPunctuation: true };
    if (mimeType.includes('webm')) {
        recognitionConfig.encoding = 'WEBM_OPUS';
        recognitionConfig.sampleRateHertz = 48000;
    } else if (!mimeType.includes('wav')) {
        // Raw PCM; WAV files carry their own header and need no hints.
        recognitionConfig.encoding = 'LINEAR16';
        recognitionConfig.sampleRateHertz = 16000;
    }

    const [response] = await client.recognize({
        audio: { content: buffer.toString('base64') },
        config: recognitionConfig,
    });
    return (response.results || [])
        .map((result) => result.alternatives?.[0]?.transcript || '')
        .join('\n');
}

module.exports = transcribe;
