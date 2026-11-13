// Helpers shared by the sidebar's webview scripts. Loaded before them, so these
// are available as globals.

/** Escape text before putting it into innerHTML. */
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Build a nested tree from a list of project-relative file paths.
 * { 'src': { 'index.js': { file: true } } }
 */
function buildFileTree(files) {
    const tree = {};
    
    files.forEach(file => {
        const parts = file.split(/[\\/]/);
        let currentLevel = tree;
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            
            if (i === parts.length - 1) {
                // This is a file
                currentLevel[part] = { file: true };
            } else {
                // This is a directory
                if (!currentLevel[part]) {
                    currentLevel[part] = {};
                }
                currentLevel = currentLevel[part];
            }
        }
    });
    
    return tree;
}

/** The three kinds of question, as the expert sees them. */
const QUESTION_KINDS = [
    { type: 'radio', label: 'Single', hint: 'One correct answer. Mark it.' },
    { type: 'checkbox', label: 'Multiple', hint: 'Several correct answers. Mark each one.' },
    { type: 'text', label: 'Typed', hint: 'Learners type the answer; capitals and extra spaces are ignored.' },
];

/**
 * The answer part of one question in the quiz editor. Choice questions mark the
 * correct option(s) on the options themselves, so an answer can never drift
 * from the option it is meant to be.
 */
function renderQuestionType(question, index) {
    const type = question.question_type;
    if (type === 'text') {
        return `
            <div class="answers-container" id="answers-container-${index}">
                <input type="text" class="answer-input form-input" data-index="0" data-question-index="${index}"
                       placeholder="The accepted answer" value="${escapeHtml(question.answers?.[0] || '')}">
            </div>
        `;
    }
    if (type === 'radio' || type === 'checkbox') {
        const correct = new Set((question.answers || []).map((a) => String(a).trim().toLowerCase()));
        const rows = (question.options || []).map((option, i) => `
            <div class="option-item">
                <input type="${type}" class="correct-marker" name="correct-${index}" data-question-index="${index}"
                       data-index="${i}" ${correct.has(String(option).trim().toLowerCase()) && option !== '' ? 'checked' : ''}
                       title="Correct answer" aria-label="Option ${i + 1} is correct">
                <textarea class="option-input form-input" rows="1" data-index="${i}" data-question-index="${index}"
                          placeholder="Option ${i + 1}">${escapeHtml(option)}</textarea>
                <button type="button" class="remove-option" data-question-index="${index}" data-option-index="${i}"
                        ${(question.options || []).length <= 2 ? 'disabled title="A question needs at least two options"' : 'title="Remove option"'}
                        aria-label="Remove option ${i + 1}">×</button>
            </div>
        `).join('');
        return `
            <div class="options-container" id="options-container-${index}">
                ${rows}
                <button type="button" class="add-option" data-question-index="${index}">+ Add option</button>
            </div>
            <div id="answers-container-${index}"></div>
        `;
    }
    return `<p class="error">Unknown question type: ${escapeHtml(type)}</p>`;
}

/** What, if anything, keeps this question from being saved. One thing at a time. */
function quizQuestionProblem(q) {
    if (!String(q.question || '').trim()) return 'Write the question.';
    const answers = (q.answers || []).map((a) => String(a).trim()).filter(Boolean);
    if (q.question_type === 'text') return answers.length ? null : 'Write the accepted answer.';
    const options = (q.options || []).map((o) => String(o).trim()).filter(Boolean);
    if (options.length < 2) return 'Give at least two options.';
    const lower = options.map((o) => o.toLowerCase());
    if (lower.some((o, i) => lower.indexOf(o) !== i)) return 'Two options say the same thing.';
    if (q.question_type === 'radio' && answers.length !== 1) return 'Mark the correct answer.';
    if (q.question_type === 'checkbox' && answers.length < 2) return 'Mark at least two answers, or switch to Single.';
    return null;
}

/**
 * `options.skippable`: offer "Skip quiz", for a tour that is fine without one
 * (a hand-written tour starts with no questions at all).
 */
function renderQuizEditor(quizQuestions, tourId, tourName, options = {}) {
    return new Promise((resolve, reject) => {
        const parse = (value) => (Array.isArray(value) ? value : JSON.parse(value || '[]'));
        // Scores are not edited here; whatever a question had is kept, new ones count 1.
        quizQuestions = quizQuestions.map((q) => ({
            ...q,
            options: parse(q.options).map(String),
            answers: parse(q.answers).map(String),
            score: Number(q.score) > 0 ? Number(q.score) : 1,
            question_type: q.question_type || 'text',
        }));

        const container = document.getElementById('quiz-edit-container');
        if (!container) {
            reject('Quiz Editor Container not found!');
            return;
        }

        container.innerHTML = `
            <div class="quiz-editor">
                <h1 class="tour-title">Quiz</h1>
                <p class="tour-form-method">${tourName ? `<strong>${escapeHtml(tourName)}</strong> · ` : ''}Check the questions, fix anything that is off, then save.</p>
                <form id="quiz-edit-form" onsubmit="return false">
                    <div id="quiz-questions-container"></div>
                    <div id="quiz-error-messages" class="quiz-error-messages" role="alert"></div>
                    <div class="tour-form-actions quiz-editor-actions">
                        <button type="button" id="add-question-button" class="tour-cancel-button">+ Add question</button>
                        ${options.skippable ? '<button type="button" id="skip-quiz-button" class="tour-cancel-button">Skip quiz</button>' : ''}
                        <span class="quiz-save-status" aria-live="polite"></span>
                        <button type="button" id="save-quiz-button" class="tour-submit-button">Save quiz</button>
                    </div>
                </form>
            </div>
        `;
        const list = document.getElementById('quiz-questions-container');

        // Everything typed so far, read back from the page before any re-render.
        const readPage = () => {
            list.querySelectorAll('.quiz-question').forEach((card, index) => {
                const q = quizQuestions[index];
                if (!q) return;
                const text = card.querySelector(`#question-${index}`);
                if (text) q.question = text.value;
                if (q.question_type === 'text') {
                    const answer = card.querySelector('.answer-input');
                    q.answers = answer ? [answer.value] : q.answers;
                    return;
                }
                const options = [...card.querySelectorAll('.option-input')].map((input) => input.value);
                const marked = [...card.querySelectorAll('.correct-marker')].map((m) => m.checked);
                q.options = options;
                q.answers = options.filter((opt, i) => marked[i] && opt.trim() !== '');
            });
        };

        const render = () => {
            list.innerHTML = quizQuestions.map((question, index) => {
                const kind = QUESTION_KINDS.find((k) => k.type === question.question_type) || QUESTION_KINDS[2];
                return `
                    <div class="quiz-question quiz-edit-card" data-index="${index}">
                        <div class="quiz-edit-head">
                            <span class="quiz-edit-number">Question ${index + 1}</span>
                            <button type="button" class="delete-question-button" data-index="${index}"
                                    title="Delete question" aria-label="Delete question ${index + 1}">🗑</button>
                        </div>
                        <textarea id="question-${index}" class="form-input" rows="2"
                                  placeholder="Ask something the tour answered">${escapeHtml(question.question || '')}</textarea>
                        <div class="quiz-kind" role="radiogroup" aria-label="Kind of question">
                            ${QUESTION_KINDS.map((k) => `
                                <button type="button" class="quiz-kind-option ${k.type === kind.type ? 'is-active' : ''}"
                                        data-index="${index}" data-type="${k.type}" role="radio"
                                        aria-checked="${k.type === kind.type}">${k.label}</button>`).join('')}
                        </div>
                        <input type="hidden" id="question-type-${index}" value="${kind.type}">
                        <p class="quiz-kind-hint">${kind.hint}</p>
                        ${renderQuestionType(question, index)}
                        <p class="quiz-card-status" aria-live="polite"></p>
                    </div>
                `;
            }).join('') || '<p class="tour-description">No questions yet. Add one below.</p>';
            wire();
        };

        // Questions are often long: let each box grow to fit what it holds.
        const fit = (area) => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };

        // Checked as the expert types, so Save is only offered for a quiz that can be saved.
        const refresh = () => {
            readPage();
            let open = 0;
            list.querySelectorAll('.quiz-edit-card').forEach((card, index) => {
                const problem = quizQuestions[index] ? quizQuestionProblem(quizQuestions[index]) : null;
                card.classList.toggle('is-incomplete', Boolean(problem));
                card.querySelector('.quiz-card-status').textContent = problem || '';
                if (problem) open += 1;
            });
            const save = document.getElementById('save-quiz-button');
            const status = document.querySelector('.quiz-save-status');
            if (!save || !status) return;
            const reason = !quizQuestions.length ? 'Add at least one question.'
                : open ? `${open} question${open === 1 ? ' needs' : 's need'} finishing.` : '';
            save.disabled = Boolean(reason);
            status.textContent = reason;
        };

        const wire = () => {
            const areas = [...list.querySelectorAll('textarea')];
            areas.forEach((area) => area.addEventListener('input', () => fit(area)));
            // Measured once laid out; before that the boxes have no width to wrap in.
            const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 0);
            later(() => areas.forEach(fit));
            refresh();
            list.querySelectorAll('.quiz-kind-option').forEach((button) => button.addEventListener('click', () => {
                readPage();
                const q = quizQuestions[+button.dataset.index];
                const to = button.dataset.type;
                if (q.question_type === to) return;
                if (to === 'text') {
                    q.answers = q.answers.slice(0, 1);
                } else {
                    if (q.question_type === 'text') {
                        // The typed answer becomes the first, correct option.
                        q.options = q.answers.filter(Boolean).length ? [q.answers[0], ''] : ['', ''];
                    }
                    if (to === 'radio') q.answers = q.answers.slice(0, 1);
                }
                q.question_type = to;
                render();
            }));
            // A single-answer question has one mark at most: radios do that already.
            list.querySelectorAll('.add-option').forEach((button) => button.addEventListener('click', () => {
                readPage();
                quizQuestions[+button.dataset.questionIndex].options.push('');
                render();
            }));
            list.querySelectorAll('.remove-option').forEach((button) => button.addEventListener('click', () => {
                readPage();
                const q = quizQuestions[+button.dataset.questionIndex];
                const [removed] = q.options.splice(+button.dataset.optionIndex, 1);
                q.answers = q.answers.filter((a) => a !== removed);
                render();
            }));
            list.querySelectorAll('.delete-question-button').forEach((button) => button.addEventListener('click', () => {
                readPage();
                quizQuestions.splice(+button.dataset.index, 1);
                render();
            }));
        };

        render();
        list.addEventListener('input', refresh);
        list.addEventListener('change', refresh);

        // The panel can be resized; re-wrap the text when it is.
        window.addEventListener('resize', () => list.querySelectorAll('textarea').forEach(fit));

        document.getElementById('add-question-button').addEventListener('click', () => {
            readPage();
            quizQuestions.push({ question: '', options: ['', ''], answers: [], score: 1, question_type: 'radio' });
            render();
            document.getElementById(`question-${quizQuestions.length - 1}`)?.focus();
        });

        container.style.display = 'block';
        document.getElementById('quiz-edit-content')?.classList.add('active');

        // Skipping saves nothing: the tour simply has no quiz.
        document.getElementById('skip-quiz-button')?.addEventListener('click', () => {
            container.style.display = 'none';
            resolve();
            document.getElementById('my-tours-tab')?.click();
        });

        document.getElementById('save-quiz-button').addEventListener('click', async () => {
            readPage();
            const errors = document.getElementById('quiz-error-messages');
            errors.innerHTML = '';
            list.querySelectorAll('.field-error').forEach((el) => el.remove());
            list.querySelectorAll('.quiz-edit-card').forEach((el) => el.classList.remove('has-error'));

            const problems = [];
            const flag = (index, message) => {
                problems.push(`Question ${index + 1}: ${message}`);
                const card = list.querySelector(`.quiz-edit-card[data-index="${index}"]`);
                if (!card) return;
                card.classList.add('has-error');
                const note = document.createElement('p');
                note.className = 'field-error';
                note.textContent = message;
                card.appendChild(note);
            };

            quizQuestions.forEach((q, index) => {
                const options = q.options.map((o) => o.trim()).filter(Boolean);
                const answers = q.answers.map((a) => a.trim()).filter(Boolean);
                if (!String(q.question || '').trim()) flag(index, 'Write the question.');
                if (q.question_type === 'text') {
                    if (!answers.length) flag(index, 'Write the accepted answer.');
                    return;
                }
                if (options.length < 2) flag(index, 'Give at least two options.');
                const lower = options.map((o) => o.toLowerCase());
                if (lower.some((o, i) => lower.indexOf(o) !== i)) flag(index, 'Two options say the same thing.');
                if (q.question_type === 'radio' && answers.length !== 1) flag(index, 'Mark the one correct answer.');
                if (q.question_type === 'checkbox' && answers.length < 2) {
                    flag(index, 'Mark at least two correct answers, or switch to “Single”.');
                }
            });

            if (problems.length) {
                errors.innerHTML = `<p>Fix ${problems.length === 1 ? 'this' : 'these'} before saving:</p>`
                    + `<ul>${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
                return;
            }

            const toSave = quizQuestions.map((q) => ({
                question: q.question.trim(),
                options: q.question_type === 'text' ? [] : q.options.map((o) => o.trim()).filter(Boolean),
                answers: q.answers.map((a) => a.trim()).filter(Boolean),
                score: q.score,
                question_type: q.question_type,
            }));

            try {
                await saveQuizToDatabase(toSave, tourId);
                if (typeof vscode !== 'undefined') vscode.postMessage({ command: 'showInfo', text: 'Quiz saved.' });
                container.style.display = 'none';
                resolve();
                document.getElementById('my-tours-tab')?.click();
            } catch (error) {
                errors.innerHTML = '<p>Could not save the quiz. Check that the Lacy server is running, then try again.</p>';
                reject(error);
            }
        });
    });
}

async function saveQuizToDatabase(quizQuestions, tourID) {

    // Transform the quizQuestions to match the server's expected structure
    const formattedQuizQuestions = quizQuestions.map((question, index) => ({
        tour_id: tourID,
        question_id: index + 1, // Question ID starts from 1
        score: question.score,
        question: question.question,
        question_type: question.question_type,
        options: question.options, // Send as raw array
        answers: question.answers  // Send as raw array
    }));

    const payload = { tourId: tourID, quizQuestions: formattedQuizQuestions };

    return fetch(`${window.LACY_API_URL}/api/save-quiz`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server responded with status ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            throw new Error(data.error); // Throw an error to reject the promise
        } else {
            return data; // Return the response data
        }
    })
    .catch(error => {
        throw error; // The editor says it could not save
    });
}

/**
 * Fill a "target department" picker from the departments this team actually uses.
 * The list comes from the accounts on the server, so a team can name its groups
 * whatever it likes instead of picking from a fixed list.
 */
async function renderDepartmentOptions(containerId, { name = 'audience', idPrefix = 'audience' } = {}) {
    const container = document.getElementById(containerId);
    if (!container) return [];

    container.innerHTML = '<span class="pill-loading">Loading departments…</span>';
    let departments = [];
    try {
        const response = await fetch(`${window.LACY_API_URL}/api/departments`);
        if (response.ok) departments = await response.json();
    } catch (err) {
        console.error('Could not load departments:', err);
    }

    const withLearners = departments.filter((d) => d.department);
    if (withLearners.length === 0) {
        container.innerHTML = '<span class="pill-empty">No departments yet. Create accounts with '
            + '<code>npm run create-user -- --department &lt;name&gt;</code> on the server.</span>';
        return [];
    }

    container.innerHTML = withLearners.map((d, i) => {
        const id = `${idPrefix}-${i}`;
        return `<input type="radio" id="${id}" name="${name}" value="${escapeHtml(d.department)}">`
            + `<label for="${id}" class="pill">${escapeHtml(d.department)}</label>`;
    }).join('');
    return withLearners;
}

/** Warn when a guided tour was assigned to nobody. */
function warnIfNobodyAssigned(result) {
    if (result && result.assignedLearners === 0) {
        vscode.postMessage({
            command: 'showError',
            text: 'The tour was created, but nobody is in that department yet, so no learner has been assigned it.',
        });
    }
}

/** Show or hide a form field: the control and the label just before it. */
function setFieldShown(control, shown) {
    control.hidden = !shown;
    const label = control.previousElementSibling;
    if (label && label.tagName === 'LABEL') label.hidden = !shown;
}

/**
 * Fill a tour form's "AI Model" and "Tour Language" dropdowns from what this
 * server's admin set up. A field with a single choice is not shown at all (the
 * choice is still used). With no AI model, the model field says so and the
 * form's main button is disabled, so nobody fills in a form that cannot be sent.
 */
async function populateTourOptions({ modelSelectId, languageSelectId, submitButtonId, podcastToggleId } = {}) {
    const select = modelSelectId ? document.getElementById(modelSelectId) : null;
    const languageSelect = languageSelectId ? document.getElementById(languageSelectId) : null;
    const button = submitButtonId ? document.getElementById(submitButtonId) : null;

    let note = null;
    if (select) {
        const noteId = `${modelSelectId}-note`;
        note = document.getElementById(noteId);
        if (!note) {
            note = document.createElement('p');
            note.id = noteId;
            note.className = 'model-unavailable';
            note.style.display = 'none';
            select.insertAdjacentElement('afterend', note);
        }
        select.innerHTML = '<option value="">Loading models…</option>';
        select.disabled = true;
    }

    const block = (message) => {
        if (!select) return;
        select.innerHTML = '<option value="">No AI model set up</option>';
        select.disabled = true;
        setFieldShown(select, true);
        if (button) { button.disabled = true; button.title = message; }
        note.textContent = message;
        note.style.display = 'block';
    };
    const fill = (control, items) => {
        control.innerHTML = items
            .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
            .join('');
        control.disabled = false;
        // One choice is not a choice: keep it as the value, but do not ask.
        setFieldShown(control, items.length > 1);
    };

    try {
        const response = await fetch(`${window.LACY_API_URL}/api/tour-options`);
        if (!response.ok) throw new Error(`status ${response.status}`);
        const { models = [], languages = [], message, podcasts } = await response.json();

        // Offer a podcast only where the server can make one.
        const podcastToggle = podcastToggleId ? document.getElementById(podcastToggleId) : null;
        if (podcastToggle) {
            // Shown either way; without text-to-speech it is off, with the reason.
            const ready = Boolean(podcasts && podcasts.ready);
            const row = podcastToggle.closest('.toggle-row') || podcastToggle;
            row.hidden = false;
            podcastToggle.disabled = !ready;
            if (!ready) podcastToggle.checked = false;
            row.classList.toggle('is-unavailable', !ready);
            let warning = document.getElementById(`${podcastToggleId}-warning`);
            if (!ready) {
                if (!warning) {
                    warning = document.createElement('p');
                    warning.id = `${podcastToggleId}-warning`;
                    warning.className = 'lacy-warning';
                    warning.setAttribute('role', 'note');
                    row.insertAdjacentElement('afterend', warning);
                }
                warning.textContent = 'No podcast audio on this server: it has no ElevenLabs key (ELEVENLABS_API_KEY), '
                    + 'so Lacy cannot voice a podcast. Ask whoever runs the server to add one.';
            } else if (warning) {
                warning.remove();
            }
        }

        if (languageSelect) {
            fill(languageSelect, languages.length ? languages : [{ id: 'en', label: 'English' }]);
        }
        if (!select) return;
        if (!models.length) {
            block(message || 'No AI model is set up on this Lacy server. Ask whoever runs it to add one.');
            return;
        }
        fill(select, models);
        if (button) { button.disabled = false; button.removeAttribute('title'); }
        note.style.display = 'none';
    } catch (err) {
        if (languageSelect) fill(languageSelect, [{ id: 'en', label: 'English' }]);
        block('Could not ask the Lacy server which AI models it has. Check that it is running.');
    }
}

/** Older name, for the model dropdown alone. */
function populateModelSelect(selectId, submitButtonId) {
    return populateTourOptions({ modelSelectId: selectId, submitButtonId });
}

/**
 * "Voice" in the New guided tour popup only works when the server can turn speech
 * into text. Ask before anyone records, and say why it is unavailable.
 */
async function checkVoiceTours() {
    const button = document.getElementById('voice-tour-button');
    const hint = document.getElementById('voice-tour-hint');
    if (!button || !hint) return;
    const defaultHint = 'Talk through the code; Lacy turns it into steps.';
    try {
        const response = await fetch(`${window.LACY_API_URL}/api/tour-options`);
        const { voice } = response.ok ? await response.json() : {};
        const ready = !voice || voice.ready;
        button.disabled = !ready;
        hint.textContent = ready ? defaultHint : (voice.message || 'Voice tours are not set up on this server.');
        hint.classList.toggle('is-unavailable', !ready);
    } catch {
        button.disabled = false;
        hint.textContent = defaultHint;
        hint.classList.remove('is-unavailable');
    }
}
