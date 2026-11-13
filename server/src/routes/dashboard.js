// Read-only statistics for the expert dashboard (previously a separate PHP API).
// Response shapes match the old PHP endpoints so the dashboard UI is unchanged.
const express = require('express');
const { db } = require('../db');
const { handle, num, now } = require('../http');
const { assertOwnsTour } = require('../auth');

const router = express.Router();
const raw = (sql, bindings) => db.raw(sql, bindings);

// Learners who actually left feedback: a comment or a rating. Assignment rows are
// created with feedback '', so counting non-NULL feedback counted everyone assigned.
const GAVE_FEEDBACK_COUNT = "COUNT(CASE WHEN TRIM(COALESCE(ta.feedback, '')) <> '' OR ta.rating IS NOT NULL THEN 1 END)";
const COMPLETED = "COUNT(CASE WHEN ta.tour_status = 'completed' THEN 1 END)";

// Statistics are about guided tours. An exploration belongs to the person who made
// it, and finishing one now writes an assignment row, so it must not count as a
// tour someone was given.
const GUIDED_ONLY = 'ta.tour_id IN (SELECT id FROM tour WHERE isGuided = 1)';

// A quiz result as a percentage of that quiz's points (total_score is raw points,
// and quizzes differ in size). NULL when there is no result or no points.
const quizMax = (tourCol) => `(SELECT SUM(qq.score) FROM quiz_questions qq WHERE qq.tour_id = ${tourCol})`;
const SCORE_PCT = `CASE WHEN q.total_score IS NOT NULL AND ${quizMax('q.tour_id')} > 0
    THEN q.total_score * 100.0 / ${quizMax('q.tour_id')} END`;

// Time on a tour. time_spent is only written when the learner submits feedback, so
// someone who skips it would show 0. Every session is also logged in tour_usage;
// take whichever is larger rather than adding them, since they overlap.
const USAGE_SECONDS = `(SELECT COALESCE(SUM(MAX(0, (julianday(us.exit_timestamp) - julianday(us.enter_timestamp)) * 86400)), 0)
    FROM tour_usage us WHERE us.tour_id = ta.tour_id AND us.user_id = ta.user_id AND us.exit_timestamp IS NOT NULL)`;
const TIME_SPENT = `CASE WHEN ta.tour_id IS NULL THEN 0 ELSE MAX(COALESCE(ta.time_spent, 0), ${USAGE_SECONDS}) END`;

const leftJoinGuidedAssignments = (query) => query.leftJoin('tour_assignment as ta', function joinAssignments() {
    this.on('u.id', 'ta.user_id').andOn(db.raw(GUIDED_ONLY));
});

function numbers(row, fields) {
    if (!row) return row;
    const out = { ...row };
    for (const f of fields) out[f] = num(out[f]);
    return out;
}

router.get('/codebase-learners', handle(async (req, res) => {
    const rows = await leftJoinGuidedAssignments(db('users as u'))
        .leftJoin('tour_quiz as q', function joinQuiz() {
            this.on('ta.tour_id', 'q.tour_id').andOn('ta.user_id', 'q.learner_id');
        })
        .where('u.role', 'learner')
        .groupBy('u.id', 'u.email', 'u.name', 'u.department')
        .select('u.id', 'u.email as username', 'u.name', 'u.department',
            raw(`${COMPLETED} AS completed_tours`),
            raw('COUNT(ta.tour_id) AS total_tours'),
            raw(`COALESCE(SUM(${TIME_SPENT}), 0) AS total_time_spent`),
            // Over the quizzes this learner took; NULL (shown as "—") if none.
            raw(`AVG(${SCORE_PCT}) AS average_score`));
    res.json(rows.map((r) => ({
        ...numbers(r, ['completed_tours', 'total_tours', 'total_time_spent']),
        average_score: r.average_score == null ? null : num(r.average_score),
    })));
}));

router.get('/learner-profile', handle(async (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const profile = await leftJoinGuidedAssignments(db('users as u'))
        .where({ 'u.id': userId, 'u.role': 'learner' })
        .groupBy('u.id', 'u.email', 'u.department')
        .first('u.email as username', 'u.department as team',
            raw(`${COMPLETED} AS completed_tours`),
            raw('COUNT(ta.tour_id) AS total_tours'),
            raw(`COALESCE(SUM(${TIME_SPENT}), 0) AS total_time_spent`));

    const tours = await db('tour as t')
        .join('tour_assignment as ta', function joinAssignment() {
            this.on('ta.tour_id', 't.id').andOnVal('ta.user_id', userId);
        })
        .leftJoin('tour_quiz as q', function joinQuiz() {
            this.on('q.tour_id', 't.id').andOnVal('q.learner_id', userId);
        })
        .where('t.isGuided', 1)
        .select('t.id as tour_id', 't.name as tour_name', 't.project_name', 'ta.tour_status',
            'ta.rating', 'ta.feedback',
            raw('(SELECT COUNT(*) FROM quiz_questions qq WHERE qq.tour_id = t.id) AS quiz_question_count'),
            raw(`${TIME_SPENT} AS time_spent`),
            raw(`${SCORE_PCT} AS average_score`));

    const questions = await db('questions as qs')
        .join('tour as t', 't.id', 'qs.tour_id')
        .where('qs.user_id', userId)
        .orderBy('qs.question_id', 'desc')
        .select('qs.question_id', 'qs.tour_id', 't.name as tour_name', 'qs.step_no', 'qs.question', 'qs.answer');

    res.json({
        questions,
        profile: profile ? numbers(profile, ['completed_tours', 'total_tours', 'total_time_spent']) : false,
        tours: tours.map((t) => ({
            ...numbers(t, ['time_spent', 'quiz_question_count']),
            average_score: t.average_score == null ? null : num(t.average_score),
        })),
    });
}));

router.get('/expert-profile', handle(async (req, res) => {
    // Experts see their own profile; the query parameter is ignored.
    const userId = req.user.id;

    const profile = await db('users').where({ id: userId, role: 'expert' }).first('email', 'department');
    const tours = await db('tour')
        .where({ isGuided: 1, user_id: userId })
        .select('id as tour_id', 'name as tour_name', 'project_name', 'created_at');
    if (tours.length === 0) {
        return res.json({ profile: profile || false, tours: [] });
    }

    const stats = await db('tour_assignment as ta')
        .whereIn('ta.tour_id', tours.map((t) => t.tour_id))
        .groupBy('ta.tour_id')
        .select('ta.tour_id',
            raw('COALESCE(AVG(ta.rating), 0) AS average_rating'),
            raw(`(${COMPLETED} * 1.0 / COUNT(ta.user_id)) * 100 AS completion_ratio`),
            raw(`${GAVE_FEEDBACK_COUNT} AS feedback_count`),
            raw('COUNT(ta.user_id) AS learners'),
            raw(`${COMPLETED} AS completed_learners`),
            raw('COUNT(ta.rating) AS rating_count'));
    const byTour = new Map(stats.map((s) => [Number(s.tour_id), s]));

    res.json({
        profile: profile || false,
        tours: tours.map((tour) => {
            const s = byTour.get(Number(tour.tour_id));
            return {
                ...tour,
                average_rating: num(s?.average_rating),
                completion_ratio: num(s?.completion_ratio),
                feedback_count: num(s?.feedback_count),
                learners: num(s?.learners),
                completed_learners: num(s?.completed_learners),
                rating_count: num(s?.rating_count),
            };
        }),
    });
}));

router.get('/all-tour-statistics', handle(async (req, res) => {
    const projects = await db('tour as t')
        .where('t.isGuided', 1)
        .groupBy('t.project_name')
        .select('t.project_name', raw('COUNT(t.id) AS total_tours_per_project'));

    const experts = await db('tour as t')
        .join('users as u', 't.user_id', 'u.id')
        .where({ 'u.role': 'expert', 't.isGuided': 1 })
        .groupBy('u.email')
        .select('u.email as expert_name', raw('COUNT(t.id) AS total_tours_for_expert'));

    // Count tours, not assignments: a tour counts as completed once every learner
    // it was assigned to has finished it.
    const completed = await db
        .from(db('tour as t')
            .leftJoin('tour_assignment as ta', 't.id', 'ta.tour_id')
            .where('t.isGuided', 1)
            .groupBy('t.id')
            .select('t.id', raw(`CASE WHEN COUNT(ta.user_id) > 0 AND ${COMPLETED} = COUNT(ta.user_id) THEN 1 ELSE 0 END AS is_completed`))
            .as('per_tour'))
        .first(raw('COUNT(*) AS total_tours'), raw('COALESCE(SUM(is_completed), 0) AS completed_tours'));

    const guided = await db('tour as t')
        .join('users as u', 't.user_id', 'u.id')
        .where('t.isGuided', 1)
        .select('t.id', 't.project_name', 't.name as tour_name', 't.target_department', 'u.email as created_by', 't.created_at',
            raw('(SELECT COUNT(*) FROM tour_assignment a WHERE a.tour_id = t.id) AS learners'),
            raw("(SELECT COUNT(*) FROM tour_assignment a WHERE a.tour_id = t.id AND a.tour_status = 'completed') AS completed_learners"));

    res.json({
        part_1: {
            projects: projects.map((p) => numbers(p, ['total_tours_per_project'])),
            experts: experts.map((e) => numbers(e, ['total_tours_for_expert'])),
            completed: numbers(completed, ['total_tours', 'completed_tours']),
        },
        part_2: guided.map((t) => numbers(t, ['learners', 'completed_learners'])),
    });
}));

router.get('/tour-full-detail', handle(async (req, res) => {
    const tourId = req.query.tour_id;
    if (!tourId) return res.status(400).json({ error: 'tour_id is required' });
    const currentUserId = req.user.id;

    const tourDetails = await db('tour as t')
        .leftJoin('users as u', 't.user_id', 'u.id')
        .where('t.id', tourId)
        .first('t.id', 't.name as tour_name', 't.project_name', 't.target_department',
            'u.email as created_by', 'u.id as created_by_id', 't.created_at');

    const assignments = db('tour_assignment as ta').where('ta.tour_id', tourId);

    const tourStats = await assignments.clone().first(
        raw('COUNT(ta.user_id) AS total_learners'),
        raw(`${COMPLETED} AS completed_learners`),
        raw(`COALESCE(SUM(${TIME_SPENT}), 0) AS total_time_spent`),
    );
    const rating = await assignments.clone().first(
        raw('COALESCE(AVG(ta.rating), 0) AS tour_rating'),
        raw('COUNT(ta.rating) AS rating_count'),
    );
    const quiz = await db('tour_quiz as q').where({ 'q.tour_id': tourId })
        .first(
            raw(`COALESCE(AVG(${SCORE_PCT}), 0) AS average_quiz_score`),
            raw(`COUNT(${SCORE_PCT}) AS quiz_attempts`),
        );
    const quizQuestions = await db('quiz_questions').where({ tour_id: tourId }).count({ n: '*' }).first();
    // The average is over people who actually spent time on it; counting those who
    // have not started as 0 minutes made every tour look quicker than it is.
    const timeStats = await assignments.clone().first(
        raw(`COALESCE(SUM(${TIME_SPENT}), 0) AS total_time_spent`),
        raw(`COALESCE(AVG(CASE WHEN ${TIME_SPENT} > 0 THEN ${TIME_SPENT} END), 0) AS avg_time_spent`),
    );
    const feedbacks = await assignments.clone()
        .join('users as u', 'u.id', 'ta.user_id')
        // Every assignment row starts with feedback '' (not NULL), so "has a
        // value" is not "gave feedback": a written comment or a rating is.
        .where((q) => q.whereRaw("TRIM(COALESCE(ta.feedback, '')) <> ''").orWhereNotNull('ta.rating'))
        .select('u.email as learner_email', 'ta.feedback', 'ta.rating');
    const tourSteps = await db('tour_steps').where({ tour_id: tourId }).orderBy('step_number')
        .select('id', 'step_number', 'description', 'file_path', 'line_start', 'line_end');
    const users = await assignments.clone()
        .join('users as u', 'u.id', 'ta.user_id')
        .leftJoin('tour_quiz as q', function joinQuiz() {
            this.on('q.tour_id', 'ta.tour_id').andOn('q.learner_id', 'ta.user_id');
        })
        .select('u.id', 'u.name', 'u.email', 'ta.tour_status',
            raw(`${TIME_SPENT} AS time_spent`), raw(`${SCORE_PCT} AS score`));
    const health = await db('step_health as h')
        .join('tour_steps as ts', 'ts.id', 'h.step_id')
        .where('h.tour_id', tourId)
        .select('h.step_id', 'h.status', 'h.reported_at', 'ts.step_number', 'ts.file_path');

    const questions = await db('questions as qs').where({ 'qs.tour_id': tourId })
        .leftJoin('users as u', 'u.id', 'qs.user_id')
        .select('qs.question_id', 'qs.step_no', 'qs.user_id as learner_id', 'u.email as learner_email', 'qs.question', 'qs.answer');

    const questionsByStep = {};
    for (const q of questions) {
        (questionsByStep[q.step_no] ||= []).push(q);
    }

    res.json({
        tour_details: tourDetails || false,
        tour_statistics: numbers(tourStats, ['total_learners', 'completed_learners', 'total_time_spent']),
        tour_rating: String(num(rating?.tour_rating)),
        quiz_success: String(num(quiz?.average_quiz_score)),
        // Lets the page tell "no quiz" or "nobody took it yet" from a real 0%.
        quiz_question_count: num(quizQuestions?.n),
        quiz_attempts: num(quiz?.quiz_attempts),
        rating_count: num(rating?.rating_count),
        time_statistics: numbers(timeStats, ['total_time_spent', 'avg_time_spent']),
        feedbacks,
        assigned_users: users.map((u) => ({
            ...u,
            score: u.score == null ? null : num(u.score),
            time_spent: num(u.time_spent),
            total_steps: tourSteps.length,
            completed_steps: u.tour_status === 'completed' ? tourSteps.length : 0,
        })),
        tour_steps: tourSteps.map((step) => ({
            ...step,
            code_status: health.find((h) => Number(h.step_id) === Number(step.id))?.status || null,
        })),
        steps_needing_review: health
            .filter((h) => h.status === 'changed' || h.status === 'missing')
            .map((h) => ({ step_number: h.step_number, file_path: h.file_path, status: h.status, reported_at: h.reported_at })),
        questions_by_step: questionsByStep,
        is_expert: Boolean(tourDetails && currentUserId && String(tourDetails.created_by_id) === String(currentUserId)),
    });
}));

router.post('/answer-question', handle(async (req, res) => {
    const { question_id: questionId, answer } = req.body;
    if (!questionId || !answer) {
        return res.status(400).json({ error: 'Missing question_id or answer' });
    }
    const question = await db('questions').where({ question_id: questionId }).first('tour_id');
    if (!question) {
        return res.status(404).json({ error: 'Question not found' });
    }
    // Only the expert who created the tour answers its questions.
    if (!await assertOwnsTour(req, res, question.tour_id)) return undefined;

    const updated = await db('questions').where({ question_id: questionId }).update({ answer, answered_at: now() });
    res.json({ success: updated > 0 });
}));

module.exports = router;
