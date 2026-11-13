
let isRecording = false;
let audioProjectFiles = []; 
let audioSelectedFiles = new Set(); 
let audioBasePath = ""; 
let pendingTourConfig = null;

window.addEventListener("message", async(event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.command) {
        case "activateAudioTab":
            initAudioUI();
            break;

        case "nodeRecordingStarted":
            break;

        case "nodeRecordingFailed":
            window.lacyRecordingFailed?.(msg.error, msg.empty);
            break;

        case "nodeRecordingFinished":
            // With SoX the recording comes in one-minute pieces; the recorder
            // collects them and plays them back as one.
            if (msg.audioBase64) window.lacyRecordingChunk?.(msg.audioBase64);
            break;
        
        case "audioTourFailed":
            hideLoading();
            updateStatus(`Could not create the tour: ${msg.error || "unknown error"}. Your recording is kept; try again.`);
            document.getElementById("finishRecording").disabled = false;
            break;

        case "audioTourCreated":
            hideLoading();
            updateStatus("Tour created.");
            vscode.postMessage({ command: "showInfo", text: "Voice tour created." });
            document.getElementById("my-tours-tab")?.click();
            try {
                if (typeof loadUsersGuidedTours === "function") {
                    await loadUsersGuidedTours();
                }
            } catch (err) {
            console.error('Unexpected error:', err);
        }

            // TO-DO Switch to Tours tab if you want:
            break;
            case "loadFiles": 
            audioProjectFiles = msg.files; 
            audioBasePath = msg.basePath; 
            audioProjectName = msg.projectName; 
            if (audioProjectFiles.length > 0) { 
                createFileExplorer(audioProjectFiles, "audio-file-explorer"); 
            } 
            break;
    }
});

function initAudioUI(){
const container = document.getElementById("audio-container");

    container.innerHTML = `
        <div id="audio-recording-wrapper" class="audio-recording-wrapper">
            <div class="tour-form-card">
                <h1 class="tour-title">New guided tour</h1>
                <p class="tour-form-method"><strong>Voice</strong> · Fill in the details, then record yourself talking through the code.</p>

                <div id="audio-tour-options" style="display:none;">
                  <div class="form-section">
                    <h2 class="section-heading">Tour Setup</h2>
                    <label class="form-subtitle">Tour Name</label>
                    <input type="text" id="audio-tour-name" class="form-input" placeholder="Enter a tour title" required>

                    <label for="file-explorer" class="form-subtitle">Tour Files</label>
                    <div id="audio-file-explorer" class="file-explorer"></div>
                    <p id="audio-file-selection-error" class="error-message" style="color: red; display: none;">Please select at least one file.</p>

                    <label class="form-subtitle">Tour Focus</label>
                    <input type="text" id="audio-tour-focus" class="form-input" placeholder="e.g., Features, Onboarding" required>

                    <label class="form-subtitle">AI Model</label>
                    <select id="audio-llm-model" class="form-input">
                <option value="">Loading models…</option>
            </select>
                  </div>

                  <div class="form-section">
                    <h2 class="section-heading">Audience</h2>
                    <label class="form-subtitle">Target Department</label>
                    <div id="audio-target-department" class="pill-radio-group">
                        <!-- filled from the server by renderDepartmentOptions -->
                    </div>

                    <label class="form-subtitle">Project Knowledge Level</label>
                    <select id="audio-project-knowledge" class="form-input">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                    </select>
                  </div>

                    <p class="voice-form-error" id="voice-form-error" role="alert" hidden></p>
                    <div class="tour-form-actions" id="voice-details-actions">
                        <button type="button" class="tour-cancel-button" id="audio-back-to-tours">Back</button>
                        <button type="button" class="tour-submit-button" id="guided-tour-to-audio">Next: Record</button>
                    </div>

                    <!-- Step 2: one button to record, then listen back and create. -->
                    <div id="audio-controls" class="voice-recorder" hidden>
                        <div class="form-section">
                            <h2 class="section-heading">Record</h2>
                            <div class="voice-stage">
                                <button type="button" id="record-toggle" class="record-button" aria-label="Start recording">
                                    <span class="record-icon" aria-hidden="true"></span>
                                </button>
                                <div class="voice-timer" id="voice-timer" aria-live="off">0:00</div>
                                <p id="recordingStatus" class="voice-status">Press to start. Talk through the files as you would to a new colleague.</p>
                            </div>
                            <audio id="audioPlayer" controls hidden></audio>
                        </div>
                        <div class="tour-form-actions">
                            <button type="button" class="tour-cancel-button" id="record-again" hidden>Record again</button>
                            <button type="button" class="tour-submit-button" id="finishRecording" disabled>Create tour</button>
                        </div>
                    </div>
                </div>
            </div>
            <div id="loading-overlay" class="loading-overlay hidden">
                <div class="loading-box">
                    <div class="spinner"></div>
                    <p id="loading-text">Creating your tour…</p>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById("audio-tour-options").style.display = "block";
    populateModelSelect("audio-llm-model", "guided-tour-to-audio");
    // The Audio tab is hidden, so this page needs its own way back.
    document.getElementById("audio-back-to-tours").addEventListener("click", () => {
        document.getElementById("my-tours-tab")?.click();
    });
    const continueBtn = document.getElementById("guided-tour-to-audio");
    const audioControls = document.getElementById("audio-controls");


    const detailFields = () => document.querySelectorAll(
        "#audio-tour-name, #audio-tour-focus, #audio-llm-model, #audio-project-knowledge, input[name='aud']"
    );

    continueBtn.onclick = () => {
        const config = collectTourConfigBeforeRecording();
        if (!config) return;

        pendingTourConfig = config;
        detailFields().forEach(el => el.disabled = true);
        document.getElementById("audio-tour-options").classList.add("is-recording-step");
        document.getElementById("voice-details-actions").hidden = true;
        audioControls.hidden = false;
        audioControls.scrollIntoView({ block: "start", behavior: "smooth" });
        // Recording starts straight away; the same button stops it.
        document.getElementById("record-toggle").click();
    };

    if (audioProjectFiles.length > 0) {
        createFileExplorer(audioProjectFiles, "audio-file-explorer");
    }

    initAudioControls();
    renderDepartmentOptions('audio-target-department', { name: 'aud', idPrefix: 'aud' });
}

function toggleAudioFileSelection(li, fullPath) { 
    if (audioSelectedFiles.has(fullPath)) { 
        audioSelectedFiles.delete(fullPath); 
        li.classList.remove('selected'); 
    } else { 
        audioSelectedFiles.add(fullPath); 
        li.classList.add('selected'); 
        // Show it in the editor too, as the other tour forms do.
        vscode.postMessage({ command: 'previewFile', filePath: fullPath });
    } 
} 

function getSelectedAudioFiles() { 
    return Array.from(audioSelectedFiles); 
}

function createFileExplorer(projectFiles, containerId) {
    const fileExplorer = document.getElementById(containerId);
    if (!fileExplorer) return;

    fileExplorer.innerHTML = '';

    const fileTree = buildFileTree(projectFiles);
    const treeView = renderTree(fileTree, '', true);
    fileExplorer.appendChild(treeView);
}

function renderTree(tree, parentPath = '', isRoot = false) {
    const ul = document.createElement('ul');
    if (!isRoot) {
        ul.classList.add('hidden');
    }

    const keys = Object.keys(tree).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
        const li = document.createElement('li');
        const fullPath = parentPath ? `${parentPath}/${key}` : key;

        if (tree[key].file) {
            const fileContainer = document.createElement('div');
            fileContainer.className = 'file-container';

            const fileName = document.createElement('span');
            fileName.textContent = key;
            fileName.className = 'file-name';

            fileContainer.addEventListener('click', () => toggleAudioFileSelection(li, fullPath));

            const detailsButton = document.createElement('button');
            detailsButton.textContent = '⚙️';
            detailsButton.className = 'details-button';
            detailsButton.style.display = 'none'; // audio tours don't use this yet

            fileContainer.appendChild(fileName);
            fileContainer.appendChild(detailsButton);
            li.appendChild(fileContainer);
            li.classList.add('file');
            li.dataset.path = fullPath;
        } else {
            const span = document.createElement('span');
            span.textContent = key;
            span.classList.add('folder');
            span.addEventListener('click', () => {
                const nestedUl = li.querySelector('ul');
                if (nestedUl) nestedUl.classList.toggle('hidden');
            });
            li.appendChild(span);

            const childTree = renderTree(tree[key], fullPath, false);
            li.appendChild(childTree);
        }
        ul.appendChild(li);
    }
    return ul;
}

function collectTourConfigBeforeRecording() {
    const name = document.getElementById("audio-tour-name")?.value?.trim();
    const tour_focus = document.getElementById("audio-tour-focus")?.value?.trim();
    const llmModel = document.getElementById("audio-llm-model")?.value;
    const projectKnowledge = document.getElementById("audio-project-knowledge")?.value;
    const targetDepartment = document.querySelector('input[name="aud"]:checked')?.value;
    const selectedFiles = getSelectedAudioFiles();

    const missing = [];
    if (!name) missing.push("a tour name");
    if (!selectedFiles.length) missing.push("at least one file");
    if (!tour_focus) missing.push("a tour focus");
    if (!targetDepartment) missing.push("a target department");
    const error = document.getElementById("voice-form-error");
    document.getElementById("audio-file-selection-error").style.display = selectedFiles.length ? "none" : "block";
    if (missing.length) {
        // alert() is blocked in VS Code panels, so say it here.
        error.textContent = `Before recording, add ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`;
        error.hidden = false;
        return null;
    }
    error.hidden = true;

    return { name, tour_focus, llmModel, projectKnowledge, targetDepartment, selectedFiles };
}

/** The recorder back in its "press to start" state. */
function resetRecorderView() {
    const toggle = document.getElementById("record-toggle");
    const player = document.getElementById("audioPlayer");
    if (!toggle) return;
    toggle.classList.remove("is-recording");
    toggle.setAttribute("aria-label", "Start recording");
    document.getElementById("voice-timer").textContent = "0:00";
    updateStatus("Press to start. Talk through the files as you would to a new colleague.");
    if (player) { player.hidden = true; player.removeAttribute("src"); }
    if (window.lacyRecordingUrl) { URL.revokeObjectURL(window.lacyRecordingUrl); window.lacyRecordingUrl = null; }
    document.getElementById("record-again").hidden = true;
    document.getElementById("finishRecording").disabled = true;
}

function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function initAudioControls() {
    const toggle = document.getElementById("record-toggle");
    const player = document.getElementById("audioPlayer");
    const finishBtn = document.getElementById("finishRecording");
    const againBtn = document.getElementById("record-again");
    const timerEl = document.getElementById("voice-timer");
    if (!toggle || !player || !finishBtn || !againBtn || !timerEl) return;

    const CHUNK_SECONDS = 59;
    let chunkTimer = null;
    let tick = null;
    let startedAt = 0;
    let recordedSeconds = 0;

    // The panel records when VS Code allows the microphone, which needs nothing
    // installed. Where it does not, the extension records with SoX instead.
    let mediaRecorder = null;
    let mediaStream = null;
    let usingSox = false;
    // After stopping SoX, the last piece is still on its way; review once it lands.
    let finishing = false;
    let reviewFallback = null;

    async function startInPanel() {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        window.recordingMimeType = "audio/webm";
        // One continuous recording, so what you play back is everything you said.
        const parts = [];
        mediaRecorder = new MediaRecorder(mediaStream);
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
        mediaRecorder.onstop = async () => {
            const blob = new Blob(parts, { type: "audio/webm" });
            const base64 = await blobToBase64(blob);
            if (base64) window.audioChunks = [base64];
            showReview();
        };
        mediaRecorder.start();
    }

    function startWithSox() {
        usingSox = true;
        window.recordingMimeType = "audio/wav";
        // SoX records in one-minute pieces; each arrives as nodeRecordingFinished.
        const startChunk = () => {
            vscode.postMessage({ command: "startNodeRecording", selectedFiles: pendingTourConfig.selectedFiles });
            chunkTimer = setTimeout(() => {
                if (isRecording) {
                    vscode.postMessage({ command: "stopNodeRecording" });
                    startChunk();
                }
            }, CHUNK_SECONDS * 1000);
        };
        startChunk();
    }

    function showReview() {
        finishing = false;
        clearTimeout(reviewFallback);
        renderRecordedAudio(window.audioChunks || [], window.recordingMimeType);
        toggle.classList.remove("is-recording");
        toggle.setAttribute("aria-label", "Start recording");
        const have = (window.audioChunks || []).length > 0;
        timerEl.textContent = formatDuration(recordedSeconds);
        updateStatus(have
            ? `Recorded ${formatDuration(recordedSeconds)}. Listen back, then create the tour.`
            : "Nothing was recorded. Check the microphone and try again.");
        againBtn.hidden = !have;
        finishBtn.disabled = !have;
    }

    async function start() {
        if (!pendingTourConfig) return;
        finishing = false;
        clearTimeout(reviewFallback);
        isRecording = true;
        usingSox = false;
        window.audioChunks = [];
        player.hidden = true;
        againBtn.hidden = true;
        finishBtn.disabled = true;
        toggle.classList.add("is-recording");
        toggle.setAttribute("aria-label", "Stop recording");
        updateStatus("Recording… press again to stop.");
        startedAt = Date.now();
        timerEl.textContent = "0:00";
        tick = setInterval(() => { timerEl.textContent = formatDuration((Date.now() - startedAt) / 1000); }, 500);
        try {
            await startInPanel();
        } catch (err) {
            console.error("Recording in the panel was not possible, falling back to SoX:", err);
            updateStatus("Recording with SoX… press again to stop.");
            startWithSox();
        }
    }

    function stop() {
        if (!isRecording) return;
        isRecording = false;
        clearInterval(tick);
        clearTimeout(chunkTimer);
        recordedSeconds = (Date.now() - startedAt) / 1000;
        updateStatus("Finishing the recording…");
        if (usingSox) {
            finishing = true;
            vscode.postMessage({ command: "stopNodeRecording" });
            // The last piece arrives as nodeRecordingFinished (see below); if it
            // never does, review what there is rather than wait forever.
            reviewFallback = setTimeout(showReview, 5000);
        } else {
            if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
            mediaStream?.getTracks().forEach((t) => t.stop());
            mediaStream = null;
        }
    }

    // The extension could not record (no SoX, or nothing captured): stop and say why.
    // Assigned, not added, because the controls are set up again on every visit.
    window.lacyRecordingChunk = (base64) => {
        if (!isRecording && !finishing) return; // a piece from a recording already dropped
        (window.audioChunks = window.audioChunks || []).push(base64);
        if (finishing) showReview();
    };

    window.lacyRecordingFailed = (error, empty) => {
        if (!isRecording && !usingSox) return;
        // An empty last piece (stopped just as a new minute began) is not a failure
        // when earlier pieces hold the recording.
        if (empty && (window.audioChunks || []).length) {
            if (finishing) showReview();
            return;
        }
        isRecording = false;
        usingSox = false;
        clearInterval(tick);
        clearTimeout(chunkTimer);
        recordedSeconds = (Date.now() - startedAt) / 1000;
        showReview();
        updateStatus(error || "Recording failed.");
    };

    toggle.onclick = () => (isRecording ? stop() : start());

    // Leaving the voice page (another tab, or back to My Tours) stops the recording,
    // so SoX never keeps listening in the background.
    const page = document.getElementById("audio-content");
    if (page && !page.dataset.recordingWatch) {
        page.dataset.recordingWatch = "1";
        new MutationObserver(() => {
            if (!page.classList.contains("active")) window.lacyStopRecording?.();
        }).observe(page, { attributes: true, attributeFilter: ["class"] });
    }
    window.lacyStopRecording = () => { if (isRecording) stop(); };
    againBtn.onclick = () => { resetRecorderView(); window.audioChunks = []; };

    finishBtn.onclick = () => {
        if (isRecording || !(window.audioChunks || []).length) return;
        finishBtn.disabled = true;
        showLoading("Writing down what you said…");
        vscode.postMessage({
            command: "submitAudioTour",
            ...pendingTourConfig,
            audioChunks: window.audioChunks,
            mimeType: window.recordingMimeType || "audio/wav",
        });
    };
}

/** MediaRecorder gives a Blob; the extension and server expect base64. */
function blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
    });
}

function updateStatus(text) {
    const statusEl = document.getElementById("recordingStatus");
    if (statusEl) {
        statusEl.textContent = text;
    }
}

/** Shows the player for the whole recording: every SoX piece joined into one WAV. */
function renderRecordedAudio(chunks, mimeType) {
    const player = document.getElementById("audioPlayer");
    if (!player) return;
    if (window.lacyRecordingUrl) URL.revokeObjectURL(window.lacyRecordingUrl);
    window.lacyRecordingUrl = null;
    if (!chunks.length) { player.hidden = true; player.removeAttribute("src"); return; }
    const bytes = chunks.map(base64ToBytes);
    const blob = mimeType === "audio/wav" && bytes.length > 1
        ? joinWavs(bytes)
        : new Blob([bytes[bytes.length - 1]], { type: mimeType || "audio/webm" });
    window.lacyRecordingUrl = URL.createObjectURL(blob);
    player.src = window.lacyRecordingUrl;
    player.hidden = false;
    player.load();
}

function base64ToBytes(base64) {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * The pieces of a WAV file: its format chunk and its sound data. SoX writes to a
 * pipe, so the sizes in its header can be wrong; the data runs to the end.
 */
function readWav(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
    let fmt = null;
    for (let at = 12; at + 8 <= bytes.length;) {
        const size = view.getUint32(at + 4, true);
        if (tag(at) === "fmt ") fmt = bytes.subarray(at, at + 8 + size);
        if (tag(at) === "data") return fmt && { fmt, data: bytes.subarray(at + 8) };
        at += 8 + size + (size & 1);
    }
    return null;
}

/** One WAV from several with the same format, with a correct header. */
function joinWavs(files) {
    const parts = files.map(readWav).filter(Boolean);
    if (!parts.length) return new Blob([files[files.length - 1]], { type: "audio/wav" });
    const fmt = parts[0].fmt;
    const dataLength = parts.reduce((n, p) => n + p.data.length, 0);
    const head = new Uint8Array(12 + fmt.length + 8);
    const view = new DataView(head.buffer);
    const put = (at, text) => { for (let i = 0; i < 4; i++) head[at + i] = text.charCodeAt(i); };
    put(0, "RIFF");
    view.setUint32(4, 4 + fmt.length + 8 + dataLength, true);
    put(8, "WAVE");
    head.set(fmt, 12);
    put(12 + fmt.length, "data");
    view.setUint32(12 + fmt.length + 4, dataLength, true);
    return new Blob([head, ...parts.map((p) => p.data)], { type: "audio/wav" });
}

function showLoading(text = "Creating your tour…") {
  const overlay = document.getElementById("loading-overlay");
  const label = document.getElementById("loading-text");
  if (label) label.textContent = text;
  overlay?.classList.remove("hidden");
}

function hideLoading() {
  document.getElementById("loading-overlay")?.classList.add("hidden");
}
