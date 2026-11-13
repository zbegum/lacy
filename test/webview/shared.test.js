// Tests for the sidebar's shared webview helpers.
//
// The webview scripts are plain browser scripts that run against the DOM the
// extension injects, so they are exercised here in jsdom the same way: load the
// script into a page, then drive it through the DOM.
const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const sharedJs = fs.readFileSync(path.resolve(__dirname, '../../src/sidebar-panel/shared.js'), 'utf8');

/** A page with the elements the sidebar provides, plus shared.js loaded. */
function loadSidebar() {
    const dom = new JSDOM(`<!DOCTYPE html><body>
        <div id="quiz-edit-content"><div id="quiz-edit-container"></div></div>
        <div id="my-tours-tab"></div>
    </body>`, { runScripts: 'outside-only' });

    const { window } = dom;
    window.LACY_API_URL = 'http://lacy.test';
    window.vscode = { postMessage: mock.fn() };
    window.alert = mock.fn();
    window.fetch = mock.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    window.eval(`var vscode = window.vscode;\n${sharedJs}`);
    return window;
}

let window;
beforeEach(() => { window = loadSidebar(); });

test('escapeHtml neutralises markup', () => {
    const { escapeHtml } = window;
    assert.equal(escapeHtml('<script>alert("x")</script>'),
        '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    assert.equal(escapeHtml("Tom & Jerry's"), 'Tom &amp; Jerry&#039;s');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(42), '42');
});

test('buildFileTree nests paths, with either separator', () => {
    // Structuring through JSON: jsdom objects come from another realm.
    const tree = JSON.parse(JSON.stringify(window.buildFileTree(['src/index.js', 'src/lib/util.js', 'README.md'])));
    assert.deepEqual(tree, {
        src: { 'index.js': { file: true }, lib: { 'util.js': { file: true } } },
        'README.md': { file: true },
    });

    // Paths recorded on Windows still nest correctly.
    assert.deepEqual(JSON.parse(JSON.stringify(window.buildFileTree(['src\\app\\main.ts']))),
        { src: { app: { 'main.ts': { file: true } } } });
});

test('renderQuestionType marks correct options on the options themselves', () => {
    const html = window.renderQuestionType(
        { question_type: 'checkbox', options: ['A', 'B'], answers: ['A'] }, 0,
    );
    assert.equal((html.match(/class="option-input/g) || []).length, 2);
    assert.equal((html.match(/type="checkbox" class="correct-marker"/g) || []).length, 2);
    assert.equal((html.match(/checked/g) || []).length, 1, 'only A is marked correct');
    assert.match(html, /add-option/);
    assert.doesNotMatch(html, /add-answer/, 'there is no separate answer list any more');

    const text = window.renderQuestionType({ question_type: 'text', answers: ['yes'] }, 1);
    assert.match(text, /class="answer-input/);
    assert.doesNotMatch(text, /add-option/);
});

test('the quiz editor renders the questions it is given, without score fields', () => {
    window.renderQuizEditor([
        { question: 'What starts the app?', question_type: 'radio', options: ['index.js', 'util.js'], answers: ['index.js'], score: 5 },
    ], 7, 'Tour A');

    assert.equal(window.document.querySelectorAll('.quiz-question').length, 1);
    assert.equal(window.document.getElementById('question-0').value, 'What starts the app?');
    assert.equal(window.document.querySelectorAll('.option-input').length, 2);
    assert.equal(window.document.getElementById('score-0'), null, 'scores are not edited');
    const marks = [...window.document.querySelectorAll('.correct-marker')].map((m) => m.checked);
    assert.deepEqual(marks, [true, false]);
});

test('options and answers stored as JSON strings are accepted', () => {
    window.renderQuizEditor([
        { question: 'Q', question_type: 'radio', options: '["A","B"]', answers: '["A"]', score: '3' },
    ], 7);
    assert.equal(window.document.querySelectorAll('.option-input').length, 2);
    assert.equal(window.document.querySelector('.correct-marker').checked, true);
});

async function saveAndCapture() {
    const saved = [];
    window.fetch = mock.fn((url, options) => {
        saved.push({ url, body: JSON.parse(options.body) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    window.document.getElementById('save-quiz-button').dispatchEvent(new window.Event('click'));
    await new Promise((r) => setTimeout(r, 20));
    return saved;
}

test('renaming the correct option keeps it correct, capitals included, and keeps the score', async () => {
    window.renderQuizEditor([
        { question: 'Q', question_type: 'radio', options: ['a', 'b'], answers: ['a'], score: 2 },
    ], 42);

    const [firstOption] = window.document.querySelectorAll('.option-input');
    firstOption.value = 'All of the Above';
    const saved = await saveAndCapture();

    assert.equal(saved.length, 1, 'the quiz should have been saved once');
    assert.match(saved[0].url, /\/api\/save-quiz$/);
    const question = saved[0].body.quizQuestions[0];
    assert.deepEqual(question.options, ['All of the Above', 'b']);
    assert.deepEqual(question.answers, ['All of the Above'], 'the mark follows the option, not its old text');
    assert.equal(question.score, 2, 'an existing score is kept as it was');
    assert.equal(saved[0].body.tourId, 42);
});

test('marking a different option changes the correct answer', async () => {
    window.renderQuizEditor([
        { question: 'Q', question_type: 'radio', options: ['a', 'b'], answers: ['a'], score: 1 },
    ], 1);
    const [, second] = window.document.querySelectorAll('.correct-marker');
    second.checked = true;
    const saved = await saveAndCapture();
    assert.deepEqual(saved[0].body.quizQuestions[0].answers, ['b']);
});

test('a choice question with no correct answer marked is not saved, and says why', async () => {
    window.renderQuizEditor([
        { question: 'Q', question_type: 'radio', options: ['a', 'b'], answers: [], score: 1 },
    ], 1);
    const saved = await saveAndCapture();
    assert.equal(saved.length, 0, 'an incomplete quiz must not be saved');
    assert.match(window.document.getElementById('quiz-error-messages').textContent, /Mark the one correct answer/);
});

test('switching to "Several answers" turns the marks into checkboxes and keeps them', () => {
    window.renderQuizEditor([
        { question: 'Q', question_type: 'radio', options: ['a', 'b'], answers: ['a'], score: 1 },
    ], 1);
    window.document.querySelector('.quiz-kind-option[data-type="checkbox"]').dispatchEvent(new window.Event('click'));
    const marks = [...window.document.querySelectorAll('.correct-marker')];
    assert.ok(marks.every((m) => m.type === 'checkbox'));
    assert.deepEqual(marks.map((m) => m.checked), [true, false]);
});

test('Add Question adds a card without losing edits to the existing one', () => {
    window.renderQuizEditor([
        { question: 'First', question_type: 'radio', options: ['a', 'b'], answers: ['a'], score: 1 },
    ], 3);

    window.document.getElementById('question-0').value = 'Edited first question';
    window.document.getElementById('add-question-button').dispatchEvent(new window.Event('click'));

    assert.equal(window.document.querySelectorAll('.quiz-question').length, 2);
    assert.equal(window.document.getElementById('question-0').value, 'Edited first question');
});

test('Add Option adds an empty option and keeps the existing ones', () => {
    window.renderQuizEditor([
        { question: 'Q', question_type: 'radio', options: ['a'], answers: ['a'], score: 1 },
    ], 4);

    window.document.querySelector('.add-option').dispatchEvent(new window.Event('click'));

    const options = [...window.document.querySelectorAll('.option-input')].map((i) => i.value);
    assert.deepEqual(options, ['a', ''], 'the new blank option must survive the re-render');
    assert.equal(window.document.querySelector('.correct-marker').checked, true, 'and the mark stays');
});

test('Delete Question removes the right card', () => {
    window.renderQuizEditor([
        { question: 'First', question_type: 'radio', options: ['a'], answers: ['a'], score: 1 },
        { question: 'Second', question_type: 'radio', options: ['b'], answers: ['b'], score: 1 },
    ], 5);

    const [, secondDelete] = window.document.querySelectorAll('.delete-question-button');
    secondDelete.dispatchEvent(new window.Event('click'));

    const remaining = [...window.document.querySelectorAll('.quiz-question textarea[id^="question-"]')].map((t) => t.value);
    assert.deepEqual(remaining, ['First']);
});

function loadModelForm(reply) {
    const dom = new JSDOM(`<!DOCTYPE html><body>
        <select id="m"><option>Loading models…</option></select>
        <button id="go">Create Tour</button>
    </body>`, { runScripts: 'outside-only' });
    const { window } = dom;
    window.LACY_API_URL = 'http://lacy.test';
    window.fetch = mock.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(reply) }));
    window.eval(sharedJs);
    return window;
}

test('the AI Model dropdown lists only the models the server has set up', async () => {
    const window = loadModelForm({ models: [
        { id: 'gemini', label: 'Gemini (gemini-flash-latest)' },
        { id: 'openai', label: 'qwen at gpu-box:8000' },
    ] });
    await window.populateModelSelect('m', 'go');
    const select = window.document.getElementById('m');
    assert.deepEqual([...select.options].map((o) => o.value), ['gemini', 'openai']);
    assert.equal(select.disabled, false);
    assert.equal(window.document.getElementById('go').disabled, false);
});

test('with no model set up, the dropdown and the create button are disabled and say why', async () => {
    const window = loadModelForm({ models: [], message: 'No AI model is set up on this Lacy server.' });
    await window.populateModelSelect('m', 'go');
    assert.equal(window.document.getElementById('m').disabled, true);
    assert.equal(window.document.getElementById('go').disabled, true);
    assert.match(window.document.getElementById('m-note').textContent, /No AI model is set up/);
});

test('Save stays disabled until every question is complete, and the card says what is missing', async () => {
    window.renderQuizEditor([
        { question: 'Q', question_type: 'radio', options: ['a', 'b'], answers: [], score: 1 },
    ], 1);
    await new Promise((r) => setTimeout(r, 5));
    const save = window.document.getElementById('save-quiz-button');
    assert.equal(save.disabled, true);
    assert.match(window.document.querySelector('.quiz-card-status').textContent, /Mark the correct answer/);

    const [first] = window.document.querySelectorAll('.correct-marker');
    first.checked = true;
    first.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(save.disabled, false);
    assert.equal(window.document.querySelector('.quiz-card-status').textContent, '');
});

test('an option cannot be removed when only two are left', () => {
    window.renderQuizEditor([
        { question: 'Q', question_type: 'radio', options: ['a', 'b'], answers: ['a'], score: 1 },
    ], 1);
    assert.ok([...window.document.querySelectorAll('.remove-option')].every((b) => b.disabled));
});

test('a skippable quiz can be left without saving anything', async () => {
    window.renderQuizEditor([], 9, 'Manual tour', { skippable: true });
    const skip = window.document.getElementById('skip-quiz-button');
    assert.ok(skip, 'Skip quiz is offered');
    assert.equal(window.document.getElementById('save-quiz-button').disabled, true, 'nothing to save yet');
    skip.dispatchEvent(new window.Event('click'));
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(window.fetch.mock.callCount(), 0, 'skipping saves nothing');
    assert.equal(window.document.getElementById('quiz-edit-container').style.display, 'none');
});

test('Skip quiz is only offered where a tour may go without one', () => {
    window.renderQuizEditor([], 9, 'AI tour');
    assert.equal(window.document.getElementById('skip-quiz-button'), null);
});

test('a tour field with only one choice is not shown, but its value is still used', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><body>
        <label for="m">AI Model</label><select id="m"></select>
        <label for="l">Tour Language</label><select id="l"></select>
        <button id="go">Create Tour</button>
    </body>`, { runScripts: 'outside-only' });
    const w = dom.window;
    w.LACY_API_URL = 'http://lacy.test';
    w.fetch = mock.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({
        models: [{ id: 'gemini', label: 'Gemini' }],
        languages: [{ id: 'en', label: 'English' }, { id: 'tr', label: 'Turkish' }],
    }) }));
    w.eval(sharedJs);
    await w.populateTourOptions({ modelSelectId: 'm', languageSelectId: 'l', submitButtonId: 'go' });

    const model = w.document.getElementById('m');
    assert.equal(model.hidden, true, 'one model: not asked');
    assert.equal(w.document.querySelector('label[for="m"]').hidden, true);
    assert.equal(model.value, 'gemini', 'but still sent');
    assert.equal(w.document.getElementById('l').hidden, false, 'two languages: asked');
    assert.equal(w.document.getElementById('go').disabled, false);
});
