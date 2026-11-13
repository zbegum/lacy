// Tour podcasts: an LLM writes an Expert/Junior dialogue, ElevenLabs voices each
// line, and the audio is written to AUDIO_DIR. The database keeps only the file
// name, so it stays small no matter how many podcasts are generated.
const fs = require('fs');
const { requirePodcasts } = require('./setup');
const path = require('path');
const { podcast } = require('./config');
const { db, upsert } = require('./db');

function segmentFile(tourId, index) {
    return path.join(podcast.audioDir, `tour-${tourId}-segment-${index}.mp3`);
}

async function saveAudioScript(tourId, audioText) {
    await upsert('voice_tours', { tour_id: tourId }, { audio_text: audioText });
}

async function synthesizeSnippet(text, voiceId, settings) {
    const clean = text.replace(/(Expert|Junior):\s*/gi, '').replace(/[_/.]/g, ' ').trim();

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
            'xi-api-key': podcast.elevenLabsApiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
        },
        body: JSON.stringify({ text: clean, model_id: podcast.model, voice_settings: settings }),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`ElevenLabs TTS returned ${response.status}: ${detail.slice(0, 300)}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/**
 * Split the script into Expert/Junior segments, synthesize each one and store it
 * in voice_tour_segments. Returns the indexes that were saved.
 */
async function synthesizeAndSaveSegments(script, tourId, settings = { stability: 0.75, similarity_boost: 0.8 }) {
    requirePodcasts();

    const segments = [];
    // The same speakers the player splits on; "Learner" is the junior voice.
    const segmentRegex = /(Expert|Junior|Learner):\s*([\s\S]*?)(?=(?:Expert|Junior|Learner):|$)/g;
    let match;
    while ((match = segmentRegex.exec(script)) !== null) {
        segments.push({ role: match[1], text: match[2].trim() });
    }

    if (segments.length === 0) {
        throw new Error('The podcast script had no "Expert:" or "Junior:" lines to voice.');
    }

    const saved = [];
    let firstError;
    for (let i = 0; i < segments.length; i++) {
        const { role, text } = segments[i];
        const voiceId = role === 'Expert' ? podcast.expertVoiceId : podcast.juniorVoiceId;
        try {
            const audio = await synthesizeSnippet(text, voiceId, settings);
            await fs.promises.mkdir(podcast.audioDir, { recursive: true });
            const file = segmentFile(tourId, i);
            await fs.promises.writeFile(file, audio);
            await upsert('voice_tour_segments', { tour_id: tourId, segment_index: i },
                { role, audio_path: path.basename(file), audio_blob: null });
            saved.push(i);
        } catch (err) {
            firstError ||= err;
            console.error(`Skipping podcast segment ${i} of tour ${tourId}: ${err.message}`);
        }
    }
    // Every clip failing is a failure (a rejected key, no credit), not a podcast.
    if (saved.length === 0) {
        throw new Error(`No audio could be made: ${firstError ? firstError.message : 'unknown error'}`);
    }
    return saved;
}

async function getSegmentIndexes(tourId) {
    const rows = await db('voice_tour_segments').where({ tour_id: tourId }).orderBy('segment_index').select('segment_index');
    return rows.map((r) => r.segment_index);
}

async function getSegmentAudio(tourId, index) {
    const row = await db('voice_tour_segments')
        .where({ tour_id: tourId, segment_index: index })
        .first('audio_path', 'audio_blob');
    if (!row) return null;

    if (row.audio_path) {
        try {
            return await fs.promises.readFile(path.join(podcast.audioDir, row.audio_path));
        } catch (err) {
            console.error(`Podcast audio missing for tour ${tourId} segment ${index}:`, err.message);
            return null;
        }
    }
    // Written by an older version straight into the database: move it to disk.
    if (row.audio_blob) {
        const file = segmentFile(tourId, index);
        try {
            await fs.promises.mkdir(podcast.audioDir, { recursive: true });
            await fs.promises.writeFile(file, row.audio_blob);
            await db('voice_tour_segments').where({ tour_id: tourId, segment_index: index })
                .update({ audio_path: path.basename(file), audio_blob: null });
        } catch (err) {
            console.error('Could not move podcast audio to disk:', err.message);
        }
        return row.audio_blob;
    }
    return null;
}

/** Remove a tour's audio files (the database rows cascade with the tour). */
async function deleteTourAudio(tourId) {
    const rows = await db('voice_tour_segments').where({ tour_id: tourId }).select('audio_path');
    await Promise.all(rows
        .filter((r) => r.audio_path)
        .map((r) => fs.promises.rm(path.join(podcast.audioDir, r.audio_path), { force: true })));
}

module.exports = { saveAudioScript, synthesizeAndSaveSegments, getSegmentIndexes, getSegmentAudio, deleteTourAudio };
