// Tours and tour steps, as used by the VS Code extension.
const path = require('path');
const { requireAi, requirePodcasts, resolveLanguage } = require('../setup');
const { resolveProvider } = require('../llm');
const express = require('express');
const { db, insertAndGetId, upsert } = require('../db');
const { handle, toSqlDateTime, now, isTruthyFlag } = require('../http');
const { assertOwnsTour, assertOwnsStep } = require('../auth');
const generation = require('../generation');
const podcast = require('../podcast');

const router = express.Router();

// The sidebar caps file selection at 5; enforce it here too so the documented
// limit holds however the API is called.
const MAX_TOUR_FILES = 5;

/**
 * Tours belong to a project, identified by its git remote when the extension can
 * read one (`github.com/acme/widgets`) and by the folder name otherwise. Older
 * tours only have a project_name, so both are accepted.
 */
function scopeToProject(query, { projectKey, projectName }) {
    const key = String(projectKey || '').trim().toLowerCase();
    if (!key) {
        return query.where('project_name', projectName);
    }
    return query.where((q) => q
        .where('project_key', key)
        .orWhere((legacy) => legacy.whereNull('project_key').where('project_name', projectName)));
}

/**
 * Normalise a path the LLM produced into a project-relative path with "/"
 * separators. Clients may be on Windows while the server runs on Linux, so this
 * works on the strings rather than the server's own path rules.
 */
function toProjectRelative(filePath, basePath, projectName) {
    if (!filePath) return null;

    let normalised = String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
    const root = [basePath, projectName].filter(Boolean).join('/').replace(/\\/g, '/').replace(/\/+$/, '');

    // Drop the project root if the model echoed an absolute path back at us.
    if (root && normalised.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        normalised = normalised.slice(root.length + 1);
    } else if (projectName) {
        const marker = `/${projectName}/`;
        const at = normalised.toLowerCase().indexOf(marker.toLowerCase());
        if (at !== -1) normalised = normalised.slice(at + marker.length);
    }

    return path.posix.normalize(normalised).replace(/^(\.\.\/)+/, '');
}

// Every learner in the target department gets the guided tour assigned.
// Departments are compared without case, so "backend" reaches "Backend".
async function assignToDepartment(trx, tourId, department) {
    const users = await trx('users')
        .where({ role: 'learner' })
        .whereRaw('LOWER(department) = ?', [String(department || '').trim().toLowerCase()])
        .select('id');
    const rows = users.map((user) => ({
        tour_id: tourId, user_id: user.id, tour_status: 'assigned', feedback: '', rating: null, time_spent: 0,
    }));
    // Chunked to stay under SQLite's bind-parameter limit.
    for (let i = 0; i < rows.length; i += 200) {
        await trx('tour_assignment').insert(rows.slice(i, i + 200));
    }
    return rows.length;
}

router.post('/create-tour', handle(async (req, res) => {
    const {
        files, file_parts: fileParts = {}, file_contents: fileContents = {}, llmModel, tour_focus: tourFocus,
        projectKnowledge, targetDepartment, create_Quiz: createQuiz, create_audio: createAudio = false,
        basePath, projectName, description, projectKey,
    } = req.body;
    const userId = req.user.id;
    const isGuided = isTruthyFlag(req.body.isGuided);
    // Only a language the admin allows; anything else gets the server's default.
    const language = resolveLanguage(req.body.language);
    // Before anything is saved: without an AI key no tour can be written.
    requireAi(resolveProvider(llmModel));
    let name = typeof req.body.name === 'string' ? req.body.name.trim() : '';

    if (isGuided && req.user.role !== 'expert') {
        return res.status(403).json({ error: 'Only experts can create guided tours.' });
    }

    const missing = [];
    if (!Array.isArray(files) || files.length === 0) missing.push('files');
    if (!tourFocus) missing.push('tour_focus');
    if (req.body.isGuided === undefined) missing.push('isGuided');
    if (!projectKnowledge) missing.push('projectKnowledge');
    if (isGuided && !name) missing.push('name');
    if (isGuided && !targetDepartment) missing.push('targetDepartment');
    if (createQuiz === undefined) missing.push('create_Quiz');
    if (!projectName) missing.push('projectName');
    if (missing.length > 0) {
        return res.status(400).json({ message: `The following fields are required: ${missing.join(', ')}` });
    }

    if (files.length > MAX_TOUR_FILES) {
        return res.status(400).json({ error: `A tour can cover at most ${MAX_TOUR_FILES} files.` });
    }

    const sources = generation.loadSources({ files, fileParts, fileContents, basePath, projectName });
    if (sources.length === 0) {
        return res.status(400).json({ error: 'None of the selected files could be read. Send their contents in file_contents.' });
    }

    // Do all LLM work before touching the database, so a failed generation
    // never leaves a half-created tour behind.
    let steps;
    let quizQuestions;
    try {
        if (!name) {
            name = await generation.generateTourName({ files, llmModel, tourFocus, projectKnowledge, projectName, language });
        }
        steps = await generation.generateTourSteps({
            sources, llmModel, tourFocus, projectKnowledge, targetDepartment, description, language,
        });
        if (isTruthyFlag(createQuiz)) {
            quizQuestions = await generation.generateQuizQuestions({
                sources, llmModel, tourFocus, projectKnowledge, targetDepartment, language,
            });
        }
    } catch (err) {
        if (err.code === 'LACY_NOT_CONFIGURED') {
            return res.status(err.status).json({ error: err.message, code: err.code });
        }
        console.error('Tour generation failed:', err);
        return res.status(500).json({ error: `Error while generating the tour, please try again: ${err.message}` });
    }

    let assignedLearners = 0;
    const tourId = await db.transaction(async (trx) => {
        const id = await insertAndGetId('tour', {
            name,
            project_name: projectName,
            project_key: String(projectKey || projectName || '').trim().toLowerCase() || null,
            user_id: userId,
            isGuided: isGuided ? 1 : 0,
            target_department: targetDepartment || null,
            tour_focus: tourFocus,
            created_at: now(),
        }, 'id', trx);

        if (isGuided) {
            assignedLearners = await assignToDepartment(trx, id, targetDepartment);
        }
        if (steps.length > 0) {
            await trx('tour_steps').insert(steps.map((step) => ({
                tour_id: id,
                step_number: step.step_number,
                description: step.description,
                file_path: toProjectRelative(step.file_path, basePath, projectName),
                line_start: step.line_start,
                line_end: step.line_end,
                anchor_text: generation.anchorTextForStep(sources, step.file_path, step.line_start, step.line_end),
                created_at: now(),
            })));
        }
        return id;
    });

    let podcastError;
    if (isTruthyFlag(createAudio)) {
        try {
            // Check the key first: writing the script costs an AI call.
            requirePodcasts();
            const script = await generation.generatePodcastScript({ sources, llmModel });
            await podcast.saveAudioScript(tourId, script);
            await podcast.synthesizeAndSaveSegments(script, tourId);
        } catch (err) {
            console.error(`Podcast generation failed for tour ${tourId}:`, err);
            podcastError = err.message;
        }
    }

    if (quizQuestions) {
        return res.status(200).json({
            message: 'Tour created and quiz generated.', tourId, quizQuestions, name, podcastError, assignedLearners,
        });
    }
    return res.status(201).json({
        message: 'Tour created successfully!', tourId, name, podcastError, assignedLearners,
    });
}));

router.post('/create-tour-manual', handle(async (req, res) => {
    const { name, project_name: projectName, project_key: projectKey, isGuided, target_department: department } = req.body;
    const userId = req.user.id;
    if (req.user.role !== 'expert') {
        return res.status(403).json({ error: 'Only experts can create guided tours.' });
    }
    if (!name || !projectName || typeof isGuided === 'undefined' || !department) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    let assignedLearners = 0;
    const tourId = await db.transaction(async (trx) => {
        const id = await insertAndGetId('tour', {
            name, user_id: userId, project_name: projectName,
            project_key: String(projectKey || projectName || '').trim().toLowerCase() || null,
            isGuided: isTruthyFlag(isGuided) ? 1 : 0,
            target_department: department, created_at: toSqlDateTime(req.body.created_at) || now(),
        }, 'id', trx);
        assignedLearners = await assignToDepartment(trx, id, department);
        return id;
    });
    res.status(201).json({ success: true, message: 'Tour created and assigned successfully', tourId, assignedLearners });
}));

router.get('/get-tours', handle(async (req, res) => {
    const { projectName, projectKey } = req.query;
    const userId = req.user.id;
    if (!projectName) {
        return res.status(400).json({ error: 'Missing projectName' });
    }
    const tours = await scopeToProject(db('tour'), { projectKey, projectName })
        .andWhere((q) => q.where({ isGuided: 1 }).orWhere({ isGuided: 0, user_id: userId }));
    res.json(tours);
}));

router.get('/get-exploration-tours', handle(async (req, res) => {
    const { projectName, projectKey } = req.query;
    const userId = req.user.id;
    // tour_status says whether this person has finished it: completed, or a quiz
    // taken (explorations made before completion was recorded only have that).
    const tours = await scopeToProject(db('tour'), { projectKey, projectName })
        .andWhere({ user_id: userId, isGuided: 0 })
        .select('tour.*')
        .select(db.raw(`CASE
            WHEN EXISTS (SELECT 1 FROM tour_assignment a WHERE a.tour_id = tour.id AND a.user_id = ? AND a.tour_status = 'completed')
              OR EXISTS (SELECT 1 FROM tour_quiz q WHERE q.tour_id = tour.id AND q.learner_id = ?)
            THEN 'completed' ELSE 'not_started' END AS tour_status`, [userId, userId]));
    res.json(tours);
}));

// A podcast has a script (voice_tours, written first) and, if synthesis worked,
// audio (voice_tour_segments). hasPodcast is either, so a podcast whose audio
// failed still shows up and can say why; hasPodcastAudio is whether it plays.
const podcastTours = () => db.raw(`(SELECT tour_id, MAX(audio) AS audio FROM (
        SELECT tour_id, 0 AS audio FROM voice_tours
        UNION ALL SELECT tour_id, 1 AS audio FROM voice_tour_segments
    ) GROUP BY tour_id) AS v`);
const hasPodcast = () => db.raw(`CASE WHEN v.tour_id IS NOT NULL THEN 1 ELSE 0 END AS "hasPodcast",
    COALESCE(v.audio, 0) AS "hasPodcastAudio"`);

router.get('/get-guided-tours-created-by-user', handle(async (req, res) => {
    const { projectName, projectKey } = req.query;
    const userId = req.user.id;
    const tours = await scopeToProject(
        db('tour as t').leftJoin(podcastTours(), 't.id', 'v.tour_id'),
        { projectKey, projectName },
    )
        .andWhere({ 't.user_id': userId, 't.isGuided': 1 })
        .select('t.*', hasPodcast());
    res.json(tours);
}));

router.get('/get-guided-tours-assigned-to-user', handle(async (req, res) => {
    const { projectName, projectKey } = req.query;
    const userId = req.user.id;
    const tours = await scopeToProject(
        db('tour as t')
            .join('tour_assignment as a', 'a.tour_id', 't.id')
            .leftJoin(podcastTours(), 't.id', 'v.tour_id'),
        { projectKey, projectName },
    )
        .andWhere({ 'a.user_id': userId, 't.isGuided': 1 })
        .select('t.*', 'a.tour_status', hasPodcast());
    res.json(tours);
}));

router.get('/get-tour-id', handle(async (req, res) => {
    const { tourName } = req.query;
    if (!tourName) return res.status(400).json({ error: 'Tour name is required' });
    const tour = await db('tour').where({ name: tourName }).first('id as tour_id', 'isGuided', 'user_id');
    if (!tour) return res.status(404).json({ error: 'Tour not found' });
    res.status(200).json(tour);
}));

router.patch('/update-tour-name', handle(async (req, res) => {
    const current = req.body.currentTourName?.trim();
    const next = req.body.newTourName?.trim();
    if (!current) return res.status(400).json({ error: 'Current tour name is required' });
    if (!next) return res.status(400).json({ error: 'New tour name is required' });

    const tour = await db('tour').where({ name: current }).first('id');
    if (!tour) return res.status(404).json({ error: 'Tour not found' });
    if (!await assertOwnsTour(req, res, tour.id)) return undefined;

    await db('tour').where({ id: tour.id }).update({ name: next });
    res.status(200).json({ message: 'Tour name updated successfully' });
}));

router.delete('/delete-tour/:tour_id', handle(async (req, res) => {
    if (!await assertOwnsTour(req, res, req.params.tour_id)) return undefined;
    await podcast.deleteTourAudio(req.params.tour_id);
    const deleted = await db('tour').where({ id: req.params.tour_id }).del();
    if (!deleted) return res.status(404).json({ error: 'Tour not found' });
    res.json({ message: 'Tour deleted successfully' });
}));

// ---- Steps ---------------------------------------------------------------

router.get('/get-tour-steps', handle(async (req, res) => {
    const tourName = req.query.tourName?.trim();
    const userId = req.user.id;
    if (!tourName) {
        return res.status(400).json({ message: 'Tour name is required' });
    }
    const steps = await db('tour as t')
        .join('tour_steps as ts', 't.id', 'ts.tour_id')
        .leftJoin('questions as q', function joinQuestions() {
            this.on('q.tour_id', 't.id').andOn('q.step_no', 'ts.step_number').andOnVal('q.user_id', userId);
        })
        .where('t.name', tourName)
        .orderBy('ts.step_number')
        .select('ts.id', 'ts.tour_id', 'ts.step_number', 'ts.file_path', 'ts.line_start', 'ts.line_end',
            'ts.anchor_text', 'ts.description', 't.isGuided', 'q.question', 'q.answer');
    res.json(steps);
}));

router.get('/get-tour-steps-files', handle(async (req, res) => {
    const tourName = req.query.tourName?.trim();
    if (!tourName) return res.status(400).json({ message: 'Tour name required' });
    const steps = await db('tour as t')
        .join('tour_steps as ts', 't.id', 'ts.tour_id')
        .where('t.name', tourName)
        .orderBy('ts.step_number')
        .select('t.tour_focus', 'ts.id', 'ts.tour_id', 'ts.step_number', 'ts.file_path', 'ts.line_start', 'ts.line_end');
    res.json(steps);
}));

// Everything the tour info card shows, by id. Learner progress is only for the
// tour's own author.
router.get('/tour-summary', handle(async (req, res) => {
    const tourId = Number(req.query.tourId);
    if (!tourId) return res.status(400).json({ error: 'tourId is required' });
    const tour = await db('tour').where({ id: tourId }).first();
    if (!tour) return res.status(404).json({ error: 'Tour not found' });

    const steps = await db('tour_steps').where({ tour_id: tourId }).orderBy('step_number')
        .select('file_path', 'line_start', 'line_end');
    const files = [];
    for (const step of steps) {
        let file = files.find((f) => f.path === step.file_path);
        if (!file) files.push(file = { path: step.file_path, steps: 0, ranges: [] });
        file.steps += 1;
        file.ranges.push([step.line_start, step.line_end]);
    }
    const quiz = await db('quiz_questions').where({ tour_id: tourId }).count({ n: '*' }).first();
    const podcast = await db('voice_tour_segments').where({ tour_id: tourId }).first('tour_id');
    const podcastScript = await db('voice_tours').where({ tour_id: tourId }).first('tour_id');

    let learners = null;
    if (Number(tour.user_id) === Number(req.user.id) && Number(tour.isGuided) === 1) {
        const rows = await db('tour_assignment').where({ tour_id: tourId }).select('tour_status');
        learners = { assigned: rows.length, completed: rows.filter((r) => r.tour_status === 'completed').length };
    }

    res.json({
        id: tour.id,
        name: tour.name,
        guided: Number(tour.isGuided) === 1,
        focus: tour.tour_focus || null,
        department: tour.target_department || null,
        createdAt: tour.created_at || null,
        stepCount: steps.length,
        files,
        quizQuestions: Number(quiz?.n || 0),
        hasPodcast: Boolean(podcast || podcastScript),
        hasPodcastAudio: Boolean(podcast),
        learners,
    });
}));

// Single step by id (used when recording a new description for a step).
router.get('/get-tour-step-by-id', handle(async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ message: 'Tour step ID is required' });
    const step = await db('tour_steps').where({ id }).first();
    if (!step) return res.status(404).json({ error: 'Tour step not found' });
    res.json(step);
}));

// Step plus the given user's question for it.
router.get('/get-tour-steps-by-id', handle(async (req, res) => {
    const { id } = req.query;
    const userId = req.user.id;
    if (!id) {
        return res.status(400).json({ message: 'Tour step ID is required' });
    }
    const rows = await db('tour_steps as ts')
        .leftJoin('questions as q', function joinQuestions() {
            this.on('q.tour_id', 'ts.tour_id').andOn('q.step_no', 'ts.step_number').andOnVal('q.user_id', userId);
        })
        .where('ts.id', id)
        .select('ts.id', 'ts.tour_id', 'ts.step_number', 'ts.file_path', 'ts.line_start', 'ts.line_end',
            'ts.description', 'q.question');
    if (rows.length === 0) return res.status(404).json({ error: 'Tour step not found' });
    res.json(rows);
}));

router.post('/create-tour-step/:tourName', handle(async (req, res) => {
    const { tourName } = req.params;
    const { step_number: stepNumber, description, file_path: filePath, line_start: lineStart, line_end: lineEnd } = req.body;
    if (!tourName || !stepNumber || !description || !filePath || !lineStart || !lineEnd) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    const tour = await db('tour').where({ name: tourName }).first('id');
    if (!tour) return res.status(404).json({ error: 'Tour not found' });
    if (!await assertOwnsTour(req, res, tour.id)) return undefined;

    const id = await insertAndGetId('tour_steps', {
        tour_id: tour.id, step_number: stepNumber, description, file_path: filePath,
        line_start: lineStart, line_end: lineEnd, anchor_text: req.body.anchor_text ?? null,
        created_at: toSqlDateTime(req.body.created_at) || now(),
    });
    res.status(201).json({ message: 'Tour step created successfully', id });
}));

router.patch('/edit-tour-step/:id', handle(async (req, res) => {
    const { id } = req.params;
    if (!id || Number.isNaN(Number(id))) return res.status(400).json({ error: 'Invalid tour step ID.' });

    const changes = {};
    for (const field of ['description', 'line_start', 'line_end', 'anchor_text']) {
        if (req.body[field] !== undefined) changes[field] = req.body[field];
    }
    if (Object.keys(changes).length === 0) {
        return res.status(400).json({ error: 'No fields provided for update.' });
    }
    if (!await assertOwnsStep(req, res, id)) return undefined;

    const updated = await db('tour_steps').where({ id }).update(changes);
    if (!updated) return res.status(404).json({ error: 'Tour step not found.' });
    res.status(200).json({ success: true, message: 'Tour step updated successfully.' });
}));

router.patch('/edit-tour-step-description/:id', handle(async (req, res) => {
    const { description } = req.body;
    if (typeof description !== 'string') return res.status(400).json({ error: 'description is required' });
    if (!await assertOwnsStep(req, res, req.params.id)) return undefined;

    const updated = await db('tour_steps').where({ id: req.params.id }).update({ description });
    if (!updated) return res.status(404).json({ error: 'Tour step not found.' });
    res.json({ success: true });
}));

router.patch('/update-step-number/:id', handle(async (req, res) => {
    if (!await assertOwnsStep(req, res, req.params.id)) return undefined;

    await db('tour_steps').where({ id: req.params.id }).update({ step_number: req.body.step_number });
    res.status(200).json({ success: true });
}));

router.delete('/delete-tour-step/:id', handle(async (req, res) => {
    if (!await assertOwnsStep(req, res, req.params.id)) return undefined;

    const found = await db.transaction(async (trx) => {
        const step = await trx('tour_steps').where({ id: req.params.id }).first('tour_id', 'step_number');
        if (!step) return false;
        await trx('tour_steps').where({ id: req.params.id }).del();
        await trx('tour_steps')
            .where({ tour_id: step.tour_id })
            .andWhere('step_number', '>', step.step_number)
            .decrement('step_number', 1);
        return true;
    });
    if (!found) return res.status(404).json({ error: 'Tour step not found' });
    res.status(200).json({ message: 'Tour step deleted and steps reordered successfully' });
}));

// The extension reports what it found when it opened a step, so experts can see
// which of their steps no longer match the code.
const STEP_STATUSES = ['exact', 'moved', 'changed', 'missing'];

router.post('/report-step-status', handle(async (req, res) => {
    const { step_id: stepId, status } = req.body;
    if (!stepId || !STEP_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${STEP_STATUSES.join(', ')}` });
    }
    const step = await db('tour_steps').where({ id: stepId }).first('id', 'tour_id');
    if (!step) {
        return res.status(404).json({ error: 'Tour step not found' });
    }

    await upsert('step_health', { step_id: step.id }, {
        tour_id: step.tour_id,
        status,
        reported_by: req.user.id,
        reported_at: now(),
    });
    res.json({ success: true });
}));

router.get('/check-tour-assignment', handle(async (req, res) => {
    const { tour_id: tourId } = req.query;
    if (!tourId) return res.status(400).json({ error: 'Missing tour_id' });
    const assignment = await db('tour_assignment').where({ user_id: req.user.id, tour_id: tourId }).first('tour_id');
    res.status(200).json({ isAssigned: Boolean(assignment) });
}));

module.exports = router;
module.exports.toProjectRelative = toProjectRelative;
