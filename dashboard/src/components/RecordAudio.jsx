import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api';

export default function RecordAudio({ onTranscription }) {
  const { stepId } = useParams();
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('idle');
  const [audioUrl, setAudioUrl] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  async function startRecording() {
    try {
      setStatus('requesting');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const options = { mimeType: 'audio/webm;codecs=opus' };
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstart = () => {
        setRecording(true);
        setStatus('recording');
      };

      mediaRecorder.onstop = async () => {
        setRecording(false);
        setStatus('stopped');

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        try {
          setStatus('uploading');
          // Convert blob to ArrayBuffer and POST as octet-stream
          const arrayBuffer = await blob.arrayBuffer();

          const resp = await apiFetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: arrayBuffer,
          });

          if (!resp.ok) {
            const text = await resp.text();
            setStatus('error');
            if (onTranscription) onTranscription({ success: false, error: text || resp.statusText });
            return;
          }

          const result = await resp.json();
          const transcribedText = result?.text || result?.transcription || result?.transcript || result?.result || JSON.stringify(result);
          setStatus('done');

          // If a stepId is provided, PATCH the server endpoint to update only description
          let patchResult = null;
          if (stepId) {
            try {
              setStatus('saving');
              const patchResp = await apiFetch(`/api/edit-tour-step-description/${encodeURIComponent(stepId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: transcribedText })
              });
              patchResult = { ok: patchResp.ok, status: patchResp.status, body: patchResp.ok ? await patchResp.json() : await patchResp.text() };
              setStatus(patchResp.ok ? 'saved' : 'save_error');
            } catch (err) {
              setStatus('save_error');
              patchResult = { ok: false, error: err.message };
            }
          }

          if (onTranscription) onTranscription({ success: true, transcription: transcribedText, patchResult });
        } catch (err) {
          setStatus('error');
          if (onTranscription) onTranscription({ success: false, error: err.message });
        } finally {
          // stop tracks
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
          }
        }
      };

      mediaRecorder.start();
    } catch (err) {
      setStatus('error');
    }
  }

  function stopRecording() {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch (err) {
      setStatus('error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={startRecording}
          disabled={recording || status === 'requesting'}
          title="Start recording"
        >
          ● Record
        </button>
        <button onClick={stopRecording} disabled={!recording} title="Stop recording">■ Stop</button>
        <div style={{ alignSelf: 'center', color: '#ccc' }}>Status: {status}</div>
      </div>

      {audioUrl && (
        <div>
          <audio controls src={audioUrl} />
          <div style={{ marginTop: 6 }}>
            <button onClick={() => { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
