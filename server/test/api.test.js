// End-to-end API test against a throwaway database and a fake OpenAI-compatible
// LLM, so it runs offline without API keys.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lacy-test-'));
let llmServer;
let apiServer;
let base;
let db;
let expertToken;
let learnerToken;
let podcastPrompts = 0;

const fakeReplies = {
    tour: JSON.stringify([
        { step_number: 1, description: 'Entry point', file_path: 'src/index.js', line_start: 1, line_end: 2 },
        { step_number: 2, description: 'Helper', file_path: 'src/util.js', line_start: 1, line_end: 1 },
    ]),
    quiz: '```json\n[{"question_id":1,"question":"What does index.js do?","question_type":"radio","options":["Starts","Stops"],"answers":["Starts"],"score":5}]\n```',
    name: '"Fake Tour Name"',
};

async function call(method, url, { body, token } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(base + url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
}

const asExpert = (method, url, body) => call(method, url, { body, token: expertToken });
const asLearner = (method, url, body) => call(method, url, { body, token: learnerToken });

before(async () => {
    llmServer = http.createServer((req, res) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            const prompt = JSON.parse(data).messages[0].content;
            if (/podcast style conversation/i.test(prompt)) podcastPrompts += 1;
            let content = fakeReplies.tour;
            if (/quiz questions/i.test(prompt)) content = fakeReplies.quiz;
            else if (/name/i.test(prompt) && /RANDOMIZER SEED/.test(prompt)) content = fakeReplies.name;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ choices: [{ message: { content } }] }));
        });
    });
    await new Promise((resolve) => llmServer.listen(0, resolve));

    process.env.DB_FILE = path.join(tmpDir, 'test.sqlite');
    process.env.AUDIO_DIR = path.join(tmpDir, 'audio');
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${llmServer.address().port}/v1`;

    ({ db } = require('../src/db'));
    await db.migrate.latest();
    const { createUser } = require('../src/users');
    await createUser({ email: 'expert@example.com', password: 'pw-expert', role: 'expert', department: 'Backend' });
    await createUser({ email: 'learner@example.com', password: 'pw-learner', role: 'learner', department: 'Backend' });

    const { createApp } = require('../src/app');
    apiServer = createApp().listen(0);
    await new Promise((resolve) => apiServer.once('listening', resolve));
    base = `http://127.0.0.1:${apiServer.address().port}/api`;

    expertToken = (await call('POST', '/login', { body: { email: 'expert@example.com', password: 'pw-expert' } })).body.token;
    learnerToken = (await call('POST', '/login', { body: { email: 'learner@example.com', password: 'pw-learner' } })).body.token;
});

after(async () => {
    apiServer?.close();
    llmServer?.close();
    await db?.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('login issues a token and never returns the password hash', async () => {
    const ok = await call('POST', '/get-user-by-email-and-password', { body: { email: 'Expert@example.com', password: 'pw-expert' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.role, 'expert');
    assert.equal(ok.body.password_hash, undefined);
    assert.match(ok.body.token, /^[0-9a-f]{64}$/);

    const wrong = await call('POST', '/login', { body: { email: 'expert@example.com', password: 'nope' } });
    assert.equal(wrong.status, 404);
});

test('the API rejects requests without a valid token', async () => {
    assert.equal((await call('GET', '/get-exploration-tours?projectName=demo')).status, 401);
    assert.equal((await call('GET', '/get-exploration-tours?projectName=demo', { token: 'not-a-token' })).status, 401);
    assert.equal((await call('GET', '/dashboard/codebase-learners')).status, 401);
});

test('guided tour: generation, assignment, quiz, feedback and dashboard', async () => {
    const created = await asExpert('POST', '/create-tour', {
        name: 'Guided One',
        files: ['src/index.js', 'src/util.js'],
        file_contents: { 'src/index.js': 'start();\nstop();', 'src/util.js': 'module.exports = {};' },
        file_parts: {},
        llmModel: 'openai',
        tour_focus: 'startup',
        isGuided: 1,
        projectKnowledge: 'medium',
        targetDepartment: 'Backend',
        create_Quiz: true,
        basePath: '/home/dev/',
        projectName: 'demo',
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.quizQuestions.length, 1);
    const { tourId } = created.body;

    // The tour belongs to the expert whose token created it, not to a client-sent id.
    assert.equal((await db('tour').where({ id: tourId }).first()).user_id, 1);

    const steps = await asLearner('GET', '/get-tour-steps?tourName=Guided%20One');
    assert.deepEqual(steps.body.map((s) => [s.step_number, s.file_path]), [[1, 'src/index.js'], [2, 'src/util.js']]);

    const assigned = await asLearner('GET', '/get-guided-tours-assigned-to-user?projectName=demo');
    assert.equal(assigned.body.length, 1);
    assert.equal(assigned.body[0].tour_status, 'assigned');
    assert.equal(Number(assigned.body[0].hasPodcast), 0);

    assert.equal((await asExpert('POST', '/save-quiz', { tourId, quizQuestions: created.body.quizQuestions })).status, 201);
    const quiz = await asLearner('GET', `/get-quiz?tour_id=${tourId}`);
    assert.deepEqual(JSON.parse(quiz.body[0].options), ['Starts', 'Stops']);

    const answers = [{ question_id: 1, answer: ['Starts'] }];
    assert.equal((await asLearner('POST', '/store-quiz-answers', { tour_id: tourId, answers })).status, 200);
    assert.equal((await asLearner('POST', '/store-quiz-answers', { tour_id: tourId, answers })).status, 200);
    assert.equal((await asLearner('GET', `/get-quiz-answers?tour_id=${tourId}`)).body.length, 1);

    const result = { tour_id: tourId, total_score: 5, start_at: new Date().toISOString(), ended_at: new Date().toISOString() };
    assert.equal((await asLearner('POST', '/post-tour-quiz-results', result)).status, 201);
    // One attempt per learner: a second submission is refused, not overwritten.
    const retake = await asLearner('POST', '/post-tour-quiz-results', { ...result, total_score: 99 });
    assert.equal(retake.status, 409);
    assert.deepEqual((await asLearner('GET', `/get-quiz-score?tour_id=${tourId}`)).body, { isSolved: true, total_score: 5 });

    await asLearner('PATCH', '/complete-tour', { tourID: tourId });
    const feedback = await asLearner('POST', '/submit-feedback', {
        tour_id: tourId, tour_status: 'completed', feedback: 'Great', rating: 4, time_spent: 120,
    });
    assert.equal(feedback.status, 200);

    const question = await asLearner('POST', '/submit-question', { tour_id: tourId, step_no: 1, question: 'Why?' });
    assert.ok(question.body.question_id);
    await asExpert('POST', '/dashboard/answer-question', { question_id: question.body.question_id, answer: 'Because' });

    const detail = await asExpert('GET', `/dashboard/tour-full-detail?tour_id=${tourId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.is_expert, true);
    assert.equal(detail.body.tour_statistics.completed_learners, 1);
    assert.equal(detail.body.tour_rating, '4');
    // 5 points out of a 5-point quiz: the dashboard shows this as a percentage.
    assert.equal(detail.body.quiz_success, '100');
    assert.equal(detail.body.questions_by_step['1'][0].answer, 'Because');

    const learners = await asExpert('GET', '/dashboard/codebase-learners');
    assert.equal(learners.body[0].completed_tours, 1);

    const expert = await asExpert('GET', '/dashboard/expert-profile');
    assert.equal(expert.body.tours[0].completion_ratio, 100);

    const stats = await asExpert('GET', '/dashboard/all-tour-statistics');
    assert.equal(stats.body.part_1.completed.completed_tours, 1);

    assert.equal((await asExpert('GET', '/dashboard/learner-profile?user_id=2')).body.profile.total_time_spent, 120);

    // Learners have no business reading dashboard statistics.
    assert.equal((await asLearner('GET', '/dashboard/codebase-learners')).status, 403);
});

test('only the owner can change or delete a tour', async () => {
    const tour = await asExpert('POST', '/create-tour-manual', {
        name: 'Owned Tour', project_name: 'demo', isGuided: 1, target_department: 'Backend',
    });
    const tourId = tour.body.tourId;

    const step = await asExpert('POST', '/create-tour-step/Owned%20Tour', {
        step_number: 1, description: 'd', file_path: 'a.js', line_start: 1, line_end: 2,
    });
    assert.equal(step.status, 201);

    assert.equal((await asLearner('PATCH', `/edit-tour-step/${step.body.id}`, { description: 'hijacked' })).status, 403);
    assert.equal((await asLearner('DELETE', `/delete-tour-step/${step.body.id}`)).status, 403);
    assert.equal((await asLearner('DELETE', `/delete-tour/${tourId}`)).status, 403);
    assert.equal((await asLearner('POST', '/save-quiz', { tourId, quizQuestions: [] })).status, 403);
    assert.equal((await asLearner('PATCH', '/update-tour-name', { currentTourName: 'Owned Tour', newTourName: 'Hijacked' })).status, 403);

    assert.equal((await asExpert('PATCH', `/edit-tour-step/${step.body.id}`, { description: 'edited' })).status, 200);
    assert.equal((await asExpert('DELETE', `/delete-tour/${tourId}`)).status, 200);
});

test('dashboard handoff code works once, then expires', async () => {
    const handoff = await asExpert('POST', '/auth/handoff');
    assert.match(handoff.body.code, /^[0-9a-f]{64}$/);

    const exchanged = await call('POST', '/auth/exchange', { body: { code: handoff.body.code } });
    assert.equal(exchanged.status, 200);
    assert.equal(exchanged.body.user.email, 'expert@example.com');

    // The new token works...
    assert.equal((await call('GET', '/dashboard/codebase-learners', { token: exchanged.body.token })).status, 200);
    // ...but the code cannot be replayed.
    assert.equal((await call('POST', '/auth/exchange', { body: { code: handoff.body.code } })).status, 401);
});

test('logout revokes the token', async () => {
    const login = await call('POST', '/login', { body: { email: 'learner@example.com', password: 'pw-learner' } });
    const { token } = login.body;
    assert.equal((await call('GET', '/me', { token })).status, 200);

    assert.equal((await call('POST', '/logout', { token })).status, 200);
    assert.equal((await call('GET', '/me', { token })).status, 401);
});

test('exploratory tour gets a generated name; step edits and deletes renumber', async () => {
    const created = await asLearner('POST', '/create-tour', {
        files: ['src/index.js'],
        file_contents: { 'src/index.js': 'start();' },
        tour_focus: 'what happens',
        isGuided: 0,
        projectKnowledge: 'low',
        create_Quiz: false,
        projectName: 'demo',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.name, 'Fake Tour Name');

    const steps = (await asLearner('GET', `/get-tour-steps?tourName=${encodeURIComponent('Fake Tour Name')}`)).body;
    assert.equal((await asLearner('PATCH', `/edit-tour-step/${steps[0].id}`, { description: 'Edited' })).status, 200);
    assert.equal((await asLearner('GET', `/get-tour-step-by-id?id=${steps[0].id}`)).body.description, 'Edited');

    assert.equal((await asLearner('DELETE', `/delete-tour-step/${steps[0].id}`)).status, 200);
    const remaining = (await asLearner('GET', `/get-tour-steps?tourName=${encodeURIComponent('Fake Tour Name')}`)).body;
    assert.deepEqual(remaining.map((s) => s.step_number), [1]);

    assert.equal((await asLearner('DELETE', `/delete-tour/${created.body.tourId}`)).status, 200);
    assert.equal((await asLearner('GET', `/get-tour-id?tourName=${encodeURIComponent('Fake Tour Name')}`)).status, 404);
});

test('create-tour rejects requests without readable files', async () => {
    const response = await asLearner('POST', '/create-tour', {
        files: ['/etc/passwd'], tour_focus: 'x', isGuided: 0, projectKnowledge: 'low',
        create_Quiz: false, projectName: 'demo', basePath: '/',
    });
    assert.equal(response.status, 400);
});

test('only experts create guided tours, and a tour covers at most 5 files', async () => {
    const asLearnerGuided = await asLearner('POST', '/create-tour', {
        name: 'Learner Guided', files: ['a.js'], file_contents: { 'a.js': 'x' },
        tour_focus: 'x', isGuided: 1, projectKnowledge: 'low', targetDepartment: 'Backend',
        create_Quiz: false, projectName: 'demo',
    });
    assert.equal(asLearnerGuided.status, 403);

    assert.equal((await asExpert('POST', '/create-tour-manual', {
        name: 'x', project_name: 'demo', isGuided: 1, target_department: 'Backend',
    })).status, 201);
    assert.equal((await asLearner('POST', '/create-tour-manual', {
        name: 'y', project_name: 'demo', isGuided: 1, target_department: 'Backend',
    })).status, 403);

    const files = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `${n}.js`);
    const tooMany = await asExpert('POST', '/create-tour', {
        name: 'Too many', files,
        file_contents: Object.fromEntries(files.map((f) => [f, 'x'])),
        tour_focus: 'x', isGuided: 1, projectKnowledge: 'low', targetDepartment: 'Backend',
        create_Quiz: false, projectName: 'demo',
    });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.error, /at most 5 files/);
});

test('a podcast script shows up before its audio, flagged as not playable', async () => {
    const tour = await asExpert('POST', '/create-tour-manual', {
        name: 'Podcast Pending', project_name: 'pod', isGuided: 1, target_department: 'Backend',
    });
    const tourId = tour.body.tourId;
    const list = async () => (await asExpert('GET', '/get-guided-tours-created-by-user?projectName=pod')).body[0];

    assert.equal(Number((await list()).hasPodcast), 0, 'no script, no podcast');

    // The script row is written before synthesis; a failed synthesis leaves no segments.
    await db('voice_tours').insert({ tour_id: tourId, audio_text: 'Expert: hi' });
    let row = await list();
    assert.equal(Number(row.hasPodcast), 1, 'listed, so the page can say why it cannot play');
    assert.equal(Number(row.hasPodcastAudio), 0);
    assert.equal((await asExpert('GET', `/tour-summary?tourId=${tourId}`)).body.hasPodcastAudio, false);

    await db('voice_tour_segments').insert({ tour_id: tourId, segment_index: 0, role: 'Expert', audio_blob: Buffer.from('x') });
    row = await list();
    assert.equal(Number(row.hasPodcast), 1);
    assert.equal(Number(row.hasPodcastAudio), 1);
});

test('answers can only be written by the expert who owns the tour', async () => {
    await require('../src/users').createUser({
        email: 'expert2@example.com', password: 'pw-expert2', role: 'expert', department: 'Backend',
    });
    const otherToken = (await call('POST', '/login', { body: { email: 'expert2@example.com', password: 'pw-expert2' } })).body.token;

    const tour = await asExpert('POST', '/create-tour-manual', {
        name: 'Owned Questions', project_name: 'demo', isGuided: 1, target_department: 'Backend',
    });
    const question = await asLearner('POST', '/submit-question', {
        tour_id: tour.body.tourId, step_no: 1, question: 'Why?',
    });

    const hijack = await call('POST', '/dashboard/answer-question', {
        body: { question_id: question.body.question_id, answer: 'hijacked' }, token: otherToken,
    });
    assert.equal(hijack.status, 403);

    const owner = await asExpert('POST', '/dashboard/answer-question', {
        question_id: question.body.question_id, answer: 'Because',
    });
    assert.equal(owner.body.success, true);
});

test('a password can be changed, and the old one stops working', async () => {
    const { createUser } = require('../src/users');
    await createUser({ email: 'changer@example.com', password: 'first-password', role: 'learner', department: 'Backend' });
    const token = (await call('POST', '/login', { body: { email: 'changer@example.com', password: 'first-password' } })).body.token;

    // The current password has to be right.
    assert.equal((await call('POST', '/change-password', {
        body: { current_password: 'wrong', new_password: 'second-password' }, token,
    })).status, 403);

    // And the new one long enough.
    assert.equal((await call('POST', '/change-password', {
        body: { current_password: 'first-password', new_password: 'short' }, token,
    })).status, 400);

    assert.equal((await call('POST', '/change-password', {
        body: { current_password: 'first-password', new_password: 'second-password' }, token,
    })).status, 200);

    assert.equal((await call('POST', '/login', { body: { email: 'changer@example.com', password: 'first-password' } })).status, 404);
    assert.equal((await call('POST', '/login', { body: { email: 'changer@example.com', password: 'second-password' } })).status, 200);
});

test('podcast audio is stored as files, not in the database', async () => {
    const podcast = require('../src/podcast');
    const tour = await asExpert('POST', '/create-tour-manual', {
        name: 'Audio Tour', project_name: 'audio', isGuided: 1, target_department: 'Backend',
    });
    const tourId = tour.body.tourId;

    const audioDir = process.env.AUDIO_DIR;
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, `tour-${tourId}-segment-0.mp3`), Buffer.from('fake-mp3'));
    await db('voice_tour_segments').insert({
        tour_id: tourId, segment_index: 0, role: 'Expert', audio_path: `tour-${tourId}-segment-0.mp3`,
    });

    const audio = await podcast.getSegmentAudio(tourId, 0);
    assert.equal(audio.toString(), 'fake-mp3');

    const response = await fetch(`${base}/tours/${tourId}/audio-segments/0/blob`, {
        headers: { Authorization: `Bearer ${expertToken}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');

    // Deleting the tour takes its audio files with it.
    assert.equal((await asExpert('DELETE', `/delete-tour/${tourId}`)).status, 200);
    assert.equal(fs.existsSync(path.join(audioDir, `tour-${tourId}-segment-0.mp3`)), false);
});

test('audio written by an older version is migrated out of the database on read', async () => {
    const podcast = require('../src/podcast');
    const tour = await asExpert('POST', '/create-tour-manual', {
        name: 'Legacy Audio', project_name: 'audio', isGuided: 1, target_department: 'Backend',
    });
    const tourId = tour.body.tourId;
    await db('voice_tour_segments').insert({
        tour_id: tourId, segment_index: 0, role: 'Expert', audio_blob: Buffer.from('legacy-bytes'),
    });

    assert.equal((await podcast.getSegmentAudio(tourId, 0)).toString(), 'legacy-bytes');

    const row = await db('voice_tour_segments').where({ tour_id: tourId, segment_index: 0 }).first();
    assert.equal(row.audio_path, `tour-${tourId}-segment-0.mp3`);
    assert.equal(row.audio_blob, null);
    assert.equal(fs.readFileSync(path.join(process.env.AUDIO_DIR, row.audio_path)).toString(), 'legacy-bytes');
});

test('departments are a free-text team label, matched without case', async () => {
    const { createUser } = require('../src/users');
    // A team names its own groups, and spelling drift does not split them.
    await createUser({ email: 'platform1@example.com', password: 'pw-learner', role: 'learner', department: 'Platform' });
    await createUser({ email: 'platform2@example.com', password: 'pw-learner', role: 'learner', department: 'platform' });

    const stored = await db('users').whereIn('email', ['platform1@example.com', 'platform2@example.com']).select('department');
    assert.deepEqual(stored.map((r) => r.department), ['Platform', 'Platform'],
        'the second account should join the existing spelling');

    const departments = await asExpert('GET', '/departments');
    const platform = departments.body.find((d) => d.department === 'Platform');
    assert.equal(platform.members, 2);
    assert.equal(departments.body.some((d) => d.department === 'platform'), false, 'no duplicate group');

    // Creating a tour for "PLATFORM" still reaches both learners.
    const created = await asExpert('POST', '/create-tour-manual', {
        name: 'Platform Tour', project_name: 'demo', isGuided: 1, target_department: 'PLATFORM',
    });
    assert.equal(created.body.assignedLearners, 2);
});

test('a tour aimed at a department with nobody in it says so', async () => {
    const created = await asExpert('POST', '/create-tour-manual', {
        name: 'Nobody Tour', project_name: 'demo', isGuided: 1, target_department: 'Nonexistent',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.assignedLearners, 0);
});

test('tours follow the repository, not the folder name', async () => {
    const key = 'github.com/acme/widgets';

    // The expert has the repo cloned as "widgets".
    const created = await asExpert('POST', '/create-tour-manual', {
        name: 'Repo Tour', project_name: 'widgets', project_key: key,
        isGuided: 1, target_department: 'Backend',
    });
    assert.equal(created.status, 201);

    // The learner cloned the same repo into "widgets-fork" and still sees it.
    const assigned = await asLearner(
        'GET', `/get-guided-tours-assigned-to-user?projectName=widgets-fork&projectKey=${encodeURIComponent(key)}`,
    );
    assert.equal(assigned.body.some((t) => t.name === 'Repo Tour'), true);

    // A different repository that happens to use the same folder name does not.
    const elsewhere = await asLearner(
        'GET', '/get-guided-tours-assigned-to-user?projectName=widgets&projectKey=github.com/other/widgets',
    );
    assert.equal(elsewhere.body.some((t) => t.name === 'Repo Tour'), false);
});

test('tours made before project keys existed still show up by folder name', async () => {
    const tour = await asExpert('POST', '/create-tour-manual', {
        name: 'Legacy Scoped', project_name: 'legacy-project', isGuided: 1, target_department: 'Backend',
    });
    // Simulate a row written by the previous version.
    await db('tour').where({ id: tour.body.tourId }).update({ project_key: null });

    const assigned = await asLearner(
        'GET', '/get-guided-tours-assigned-to-user?projectName=legacy-project&projectKey=github.com/acme/legacy',
    );
    assert.equal(assigned.body.some((t) => t.name === 'Legacy Scoped'), true);
});

test('a project without a git remote is still scoped by folder name', async () => {
    await asLearner('POST', '/create-tour', {
        files: ['a.js'], file_contents: { 'a.js': 'x' }, tour_focus: 'x', isGuided: 0,
        projectKnowledge: 'low', create_Quiz: false, projectName: 'no-git-here',
    });
    const mine = await asLearner('GET', '/get-exploration-tours?projectName=no-git-here&projectKey=no-git-here');
    assert.equal(mine.body.length, 1);

    const other = await asLearner('GET', '/get-exploration-tours?projectName=somewhere-else&projectKey=somewhere-else');
    assert.equal(other.body.length, 0);
});

test('generated steps remember the code they point at', async () => {
    const created = await asExpert('POST', '/create-tour', {
        name: 'Anchored Tour',
        files: ['src/index.js', 'src/util.js'],
        file_contents: { 'src/index.js': 'start();\nstop();', 'src/util.js': 'module.exports = {};' },
        tour_focus: 'startup', isGuided: 1, projectKnowledge: 'low',
        targetDepartment: 'Backend', create_Quiz: false, projectName: 'demo',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const steps = await asLearner('GET', '/get-tour-steps?tourName=Anchored%20Tour');
    // The fake LLM points step 1 at lines 1-2 of index.js.
    assert.equal(steps.body[0].anchor_text, 'start();\nstop();');
    assert.equal(steps.body[1].anchor_text, 'module.exports = {};');
});

test('a hand-written step stores the anchor the extension sends, and editing updates it', async () => {
    await asExpert('POST', '/create-tour-manual', {
        name: 'Manual Anchors', project_name: 'demo', isGuided: 1, target_department: 'Backend',
    });
    const step = await asExpert('POST', '/create-tour-step/Manual%20Anchors', {
        step_number: 1, description: 'look here', file_path: 'src/app.js',
        line_start: 10, line_end: 12, anchor_text: 'if (ready) {\n  go();\n}',
    });
    assert.equal(step.status, 201);

    let stored = await asExpert('GET', `/get-tour-step-by-id?id=${step.body.id}`);
    assert.equal(stored.body.anchor_text, 'if (ready) {\n  go();\n}');

    assert.equal((await asExpert('PATCH', `/edit-tour-step/${step.body.id}`, {
        line_start: 20, line_end: 20, anchor_text: 'go();',
    })).status, 200);

    stored = await asExpert('GET', `/get-tour-step-by-id?id=${step.body.id}`);
    assert.equal(stored.body.anchor_text, 'go();');
    assert.equal(stored.body.line_start, 20);
});

test('what readers find is reported back and shown to the expert', async () => {
    const tour = await asExpert('POST', '/create-tour-manual', {
        name: 'Health Tour', project_name: 'demo', isGuided: 1, target_department: 'Backend',
    });
    const tourId = tour.body.tourId;
    const stepA = await asExpert('POST', '/create-tour-step/Health%20Tour', {
        step_number: 1, description: 'a', file_path: 'src/a.js', line_start: 1, line_end: 2, anchor_text: 'a()',
    });
    const stepB = await asExpert('POST', '/create-tour-step/Health%20Tour', {
        step_number: 2, description: 'b', file_path: 'src/b.js', line_start: 1, line_end: 2, anchor_text: 'b()',
    });

    // A learner opens the tour: one step is fine, one no longer matches.
    assert.equal((await asLearner('POST', '/report-step-status', { step_id: stepA.body.id, status: 'exact' })).status, 200);
    assert.equal((await asLearner('POST', '/report-step-status', { step_id: stepB.body.id, status: 'missing' })).status, 200);

    let detail = await asExpert('GET', `/dashboard/tour-full-detail?tour_id=${tourId}`);
    assert.deepEqual(detail.body.steps_needing_review.map((s) => s.step_number), [2]);
    assert.equal(detail.body.tour_steps.find((s) => s.step_number === 1).code_status, 'exact');
    assert.equal(detail.body.tour_steps.find((s) => s.step_number === 2).code_status, 'missing');

    // The expert fixes the step; the next reader clears the flag.
    assert.equal((await asLearner('POST', '/report-step-status', { step_id: stepB.body.id, status: 'exact' })).status, 200);
    detail = await asExpert('GET', `/dashboard/tour-full-detail?tour_id=${tourId}`);
    assert.equal(detail.body.steps_needing_review.length, 0);

    assert.equal((await asLearner('POST', '/report-step-status', { step_id: stepB.body.id, status: 'nonsense' })).status, 400);
    assert.equal((await asLearner('POST', '/report-step-status', { step_id: 999999, status: 'exact' })).status, 404);
});

test('tours survive the person who wrote them leaving, if they are handed over', async () => {
    const { createUser, countToursOwned, reassignTours, deleteUser } = require('../src/users');
    const leaver = await createUser({ email: 'leaver@example.com', password: 'pw-expert', role: 'expert', department: 'Backend' });
    const stays = await createUser({ email: 'stays@example.com', password: 'pw-expert', role: 'expert', department: 'Backend' });

    const token = (await call('POST', '/login', { body: { email: 'leaver@example.com', password: 'pw-expert' } })).body.token;
    const tour = await call('POST', '/create-tour-manual', {
        body: { name: 'Leaver Tour', project_name: 'demo', isGuided: 1, target_department: 'Backend' },
        token,
    });
    assert.equal(await countToursOwned(leaver.id), 1);

    // Handing the tours over first means deleting the account keeps them.
    assert.equal(await reassignTours(leaver.id, stays.id), 1);
    assert.equal(await countToursOwned(leaver.id), 0);
    await deleteUser('leaver@example.com');

    const survivor = await db('tour').where({ id: tour.body.tourId }).first();
    assert.equal(survivor.name, 'Leaver Tour');
    assert.equal(survivor.user_id, stays.id);
});

test('deleting an account that still owns tours takes them with it', async () => {
    const { createUser, countToursOwned, deleteUser } = require('../src/users');
    const owner = await createUser({ email: 'owner@example.com', password: 'pw-expert', role: 'expert', department: 'Backend' });
    const token = (await call('POST', '/login', { body: { email: 'owner@example.com', password: 'pw-expert' } })).body.token;
    const tour = await call('POST', '/create-tour-manual', {
        body: { name: 'Owned Tour', project_name: 'demo', isGuided: 1, target_department: 'Backend' },
        token,
    });

    // This is why the CLI refuses to do it without --reassign-to or --force.
    assert.equal(await countToursOwned(owner.id), 1);
    await deleteUser('owner@example.com');
    assert.equal(await db('tour').where({ id: tour.body.tourId }).first(), undefined);
});

test('without an AI key, creating a tour says what the server needs, and saves nothing', async () => {
    const config = require('../src/config');
    const saved = { provider: config.llm.provider, key: config.llm.gemini.apiKey };
    config.llm.provider = 'gemini';
    config.llm.gemini.apiKey = undefined;
    try {
        const before = (await db('tour').count({ n: '*' }).first()).n;
        const response = await asExpert('POST', '/create-tour', {
            name: 'No Key', files: ['src/index.js'], file_contents: { 'src/index.js': 'x' },
            file_parts: {}, llmModel: '', tour_focus: 'x', isGuided: 1, projectKnowledge: 'low',
            targetDepartment: 'Backend', basePath: '/home/dev/', projectName: 'demo',
        });
        assert.equal(response.status, 503);
        assert.equal(response.body.code, 'LACY_NOT_CONFIGURED');
        assert.match(response.body.error, /GEMINI_API_KEY/);
        assert.equal((await db('tour').count({ n: '*' }).first()).n, before);

        const health = await call('GET', '/health');
        assert.equal(health.body.features.ai, false);
        assert.ok(!JSON.stringify(health.body).includes('GEMINI_API_KEY'), 'health must not talk about keys');
    } finally {
        config.llm.provider = saved.provider;
        config.llm.gemini.apiKey = saved.key;
    }
});

test('an exploration shows as completed once its owner finishes it', async () => {
    const created = await asLearner('POST', '/create-tour', {
        files: ['a.js'], file_contents: { 'a.js': 'x' }, tour_focus: 'x', isGuided: 0,
        projectKnowledge: 'low', create_Quiz: false, projectName: 'explore-done', name: 'Mine to finish',
    });
    assert.ok(created.status < 300, JSON.stringify(created.body));
    const list = () => asLearner('GET', '/get-exploration-tours?projectName=explore-done&projectKey=explore-done');

    assert.equal((await list()).body[0].tour_status, 'not_started');
    const done = await asLearner('PATCH', '/complete-tour', { tourID: created.body.tourId });
    assert.equal(done.body.affectedRows, 1);
    assert.equal((await list()).body[0].tour_status, 'completed');

    // Someone else's tour cannot be marked done this way.
    const other = await asExpert('PATCH', '/complete-tour', { tourID: created.body.tourId });
    assert.equal(other.body.affectedRows, 0);
});

test('the tour summary says what a tour covers, and shows progress only to its author', async () => {
    const created = await asExpert('POST', '/create-tour', {
        name: 'Summary Tour', files: ['src/index.js', 'src/util.js'],
        file_contents: { 'src/index.js': 'start();\nstop();', 'src/util.js': 'module.exports = {};' },
        file_parts: {}, llmModel: 'openai', tour_focus: 'startup', isGuided: 1, projectKnowledge: 'low',
        targetDepartment: 'Backend', create_Quiz: true, basePath: '/home/dev/', projectName: 'summary',
    });
    assert.ok(created.status < 300, JSON.stringify(created.body));
    const { tourId } = created.body;

    const mine = await asExpert('GET', `/tour-summary?tourId=${tourId}`);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.name, 'Summary Tour');
    assert.equal(mine.body.department, 'Backend');
    assert.equal(mine.body.stepCount, 2);
    assert.deepEqual(mine.body.files.map((f) => f.path), ['src/index.js', 'src/util.js']);
    assert.ok(mine.body.learners, 'the author sees learner progress');

    const theirs = await asLearner('GET', `/tour-summary?tourId=${tourId}`);
    assert.equal(theirs.body.learners, null, 'a learner does not see the progress of others');
});

test('the dashboard counts learners who left feedback, not everyone assigned', async () => {
    const created = await asExpert('POST', '/create-tour', {
        name: 'Feedback Count Tour', files: ['src/index.js'], file_contents: { 'src/index.js': 'start();' },
        file_parts: {}, llmModel: 'openai', tour_focus: 'x', isGuided: 1, projectKnowledge: 'low',
        targetDepartment: 'Backend', create_Quiz: false, basePath: '/home/dev/', projectName: 'fb-count',
    });
    assert.ok(created.status < 300, JSON.stringify(created.body));
    const { tourId } = created.body;
    const count = async () => {
        const profile = await asExpert('GET', '/dashboard/expert-profile');
        return profile.body.tours.find((t) => Number(t.tour_id) === Number(tourId)).feedback_count;
    };
    assert.equal(await count(), 0, 'assigned, but nobody has said anything yet');

    await asLearner('POST', '/submit-feedback', { tour_id: tourId, tour_status: 'completed', feedback: 'Clear, thanks', rating: 5, time_spent: 30 });
    assert.equal(await count(), 1);

    const detail = await asExpert('GET', `/dashboard/tour-full-detail?tour_id=${tourId}`);
    assert.equal(detail.body.feedbacks.length, 1);
});


test('dashboard statistics: feedback, scores, explorations and time are counted correctly', async () => {
    const make = (name, extra = {}) => asExpert('POST', '/create-tour', {
        name, files: ['src/index.js'], file_contents: { 'src/index.js': 'start();' },
        file_parts: {}, llmModel: 'openai', tour_focus: 'x', isGuided: 1, projectKnowledge: 'low',
        targetDepartment: 'Backend', create_Quiz: false, basePath: '/home/dev/', projectName: 'stats', ...extra,
    });
    const created = await make('Stats Tour');
    assert.ok(created.status < 300, JSON.stringify(created.body));
    const { tourId } = created.body;
    const detail = () => asExpert('GET', `/dashboard/tour-full-detail?tour_id=${tourId}`);
    const mineInProfile = async () => (await asExpert('GET', '/dashboard/expert-profile'))
        .body.tours.find((t) => Number(t.tour_id) === Number(tourId));
    const lin = async () => (await asExpert('GET', '/dashboard/codebase-learners')).body.find((l) => l.username === 'learner@example.com');

    // Assigned, nobody has said anything yet: no feedback (it used to count everyone assigned).
    assert.equal((await mineInProfile()).feedback_count, 0);
    assert.equal((await detail()).body.feedbacks.length, 0);

    // A 3-question quiz worth 1 + 1 + 2 points; the learner scores 2 of 4 = 50%.
    await asExpert('POST', '/save-quiz', { tourId, quizQuestions: [
        { tour_id: tourId, question_id: 1, score: 1, question: 'a', question_type: 'radio', options: ['x', 'y'], answers: ['x'] },
        { tour_id: tourId, question_id: 2, score: 1, question: 'b', question_type: 'radio', options: ['x', 'y'], answers: ['x'] },
        { tour_id: tourId, question_id: 3, score: 2, question: 'c', question_type: 'checkbox', options: ['x', 'y', 'z'], answers: ['x', 'y'] },
    ] });
    const before = (await lin()).total_tours;
    await asLearner('POST', '/post-tour-quiz-results', {
        tour_id: tourId, total_score: 2, start_at: '2026-11-12T10:00:00Z', ended_at: '2026-11-12T10:05:00Z',
    });
    assert.equal((await detail()).body.quiz_success, '50', 'a percentage of the quiz, not raw points');
    assert.equal((await detail()).body.assigned_users.find((u) => u.email === 'learner@example.com').score, 50);

    // The learner skips feedback, but spent 10 minutes in the tour: that time still counts.
    await asLearner('POST', '/log-tour-usage', {
        tour_id: tourId, enter_timestamp: '2026-11-12T10:00:00Z', exit_timestamp: '2026-11-12T10:10:00Z', exit_step_id: null,
    });
    await asLearner('PATCH', '/complete-tour', { tourID: tourId });
    const times = (await detail()).body.time_statistics;
    assert.equal(Math.round(times.total_time_spent), 600);
    assert.equal(Math.round(times.avg_time_spent), 600, 'averaged over people who spent time, not everyone assigned');

    // Feedback with a rating now counts once.
    await asLearner('POST', '/submit-feedback', { tour_id: tourId, tour_status: 'completed', feedback: 'Clear', rating: 5, time_spent: 300 });
    assert.equal((await mineInProfile()).feedback_count, 1);
    assert.equal((await detail()).body.feedbacks.length, 1);

    // The learner's own exploration does not count as a tour they were given.
    const explore = await asLearner('POST', '/create-tour', {
        files: ['a.js'], file_contents: { 'a.js': 'x' }, tour_focus: 'x', isGuided: 0,
        projectKnowledge: 'low', create_Quiz: false, projectName: 'stats-explore', name: 'Own exploration',
    });
    await asLearner('PATCH', '/complete-tour', { tourID: explore.body.tourId });
    assert.equal((await lin()).total_tours, before, 'explorations are not assignments');
});

test('podcasts are only offered, and only attempted, when the server can make them', async () => {
    // Whatever the developer's own .env says, this server has no ElevenLabs key.
    const config = require('../src/config');
    const realKey = config.podcast.elevenLabsApiKey;
    config.podcast.elevenLabsApiKey = undefined;
    try {
    const options = await asExpert('GET', '/tour-options');
    assert.equal(options.body.podcasts.ready, false);
    assert.match(options.body.podcasts.message, /ELEVENLABS_API_KEY/);

    // Asked for anyway: the tour is made, the podcast is refused up front, and no
    // AI call is spent on a script that could never be voiced.
    const before = podcastPrompts;
    const created = await asExpert('POST', '/create-tour', {
        name: 'With podcast', files: ['src/index.js'], file_contents: { 'src/index.js': 'start();' },
        file_parts: {}, llmModel: 'openai', tour_focus: 'x', isGuided: 1, projectKnowledge: 'low',
        targetDepartment: 'Backend', create_Quiz: false, create_audio: true, projectName: 'podcast-demo',
    });
    assert.ok(created.body.tourId);
    assert.match(created.body.podcastError, /ELEVENLABS_API_KEY/);
    assert.equal(podcastPrompts, before);
    } finally {
        config.podcast.elevenLabsApiKey = realKey;
    }
});

test('a podcast whose every clip fails is an error, not a silent empty podcast', async () => {
    const config = require('../src/config');
    const podcast = require('../src/podcast');
    const realFetch = global.fetch;
    const realKey = config.podcast.elevenLabsApiKey;
    config.podcast.elevenLabsApiKey = 'rejected-key';
    global.fetch = async () => new Response('invalid api key', { status: 401 });
    try {
        await assert.rejects(
            podcast.synthesizeAndSaveSegments('Expert: Hello.\nLearner: Hi.', 999),
            /No audio could be made: ElevenLabs TTS returned 401/,
        );
        assert.deepEqual(await podcast.getSegmentIndexes(999), []);
    } finally {
        global.fetch = realFetch;
        config.podcast.elevenLabsApiKey = realKey;
    }
});
