// Quizzes: questions written by experts (or generated), learner answers and scores.
const express = require('express');
const { db, upsert } = require('../db');
const { handle, toSqlDateTime } = require('../http');
const { assertOwnsTour } = require('../auth');

const router = express.Router();

const asJson = (value) => (typeof value === 'string' ? value : JSON.stringify(value ?? []));

router.post('/save-quiz', handle(async (req, res) => {
    const { tourId, quizQuestions } = req.body;
    if (!tourId || !Array.isArray(quizQuestions)) {
        return res.status(400).json({ error: 'Invalid request data' });
    }
    if (!await assertOwnsTour(req, res, tourId)) return undefined;
    await db.transaction(async (trx) => {
        await trx('quiz_questions').where({ tour_id: tourId }).del();
        for (const [index, q] of quizQuestions.entries()) {
            await trx('quiz_questions').insert({
                tour_id: tourId,
                question_id: index + 1, // positional
                score: q.score,
                question: q.question,
                question_type: q.question_type,
                options: asJson(q.options),
                answers: asJson(q.answers),
            });
        }
    });
    res.status(201).json({ message: quizQuestions.length ? 'Quiz saved successfully' : 'Quiz cleared successfully' });
}));

router.post('/create-quiz-question', handle(async (req, res) => {
    const { question, options, answers, score, question_type: questionType, tour_id: tourId } = req.body;
    if (!question || !options || !answers || !score || !questionType || !tourId) {
        return res.status(400).json({ message: 'All fields are required' });
    }
    if (!await assertOwnsTour(req, res, tourId)) return undefined;

    const id = await db.transaction(async (trx) => {
        const { max } = await trx('quiz_questions').where({ tour_id: tourId }).max('question_id as max').first();
        const questionId = Number(max || 0) + 1;
        await trx('quiz_questions').insert({
            tour_id: tourId, question_id: questionId, question, score, question_type: questionType,
            options: asJson(options), answers: asJson(answers),
        });
        return questionId;
    });
    res.status(201).json({ message: 'Quiz question created successfully', id });
}));

router.get('/get-quiz-questions', handle(async (req, res) => {
    const { tourName } = req.query;
    if (!tourName) return res.status(400).json({ message: 'Tour name is required' });
    const questions = await db('quiz_questions as qq')
        .join('tour as t', 'qq.tour_id', 't.id')
        .where('t.name', tourName.trim())
        .orderBy('qq.question_id')
        .select('qq.question', 'qq.answers', 'qq.options', 'qq.score', 'qq.question_type');
    res.json(questions);
}));

router.get('/get-quiz', handle(async (req, res) => {
    const { tour_id: tourId } = req.query;
    if (!tourId) return res.status(400).json({ error: 'Missing tour_id' });
    res.json(await db('quiz_questions').where({ tour_id: tourId }).orderBy('question_id')
        .select('question', 'options', 'answers', 'score', 'question_type'));
}));

router.post('/post-tour-quiz-results', handle(async (req, res) => {
    const { tour_id: tourId, total_score: totalScore, start_at: startAt, ended_at: endedAt } = req.body;
    const learnerId = req.user.id;
    if (tourId == null || startAt == null || endedAt == null) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (totalScore == null) return res.status(400).json({ error: 'Missing total_score' });

    const keys = { tour_id: tourId, learner_id: learnerId };
    const existed = await db('tour_quiz').where(keys).first('tour_id', 'ended_at');
    if (existed && existed.ended_at != null) {
        // One attempt per learner, enforced here and not only in the sidebar.
        return res.status(409).json({ error: 'This quiz has already been submitted.' });
    }
    await upsert('tour_quiz', keys, {
        total_score: totalScore, start_at: toSqlDateTime(startAt), ended_at: toSqlDateTime(endedAt),
    });
    if (existed) return res.status(200).json({ message: 'Quiz data updated successfully' });
    res.status(201).json({ message: 'Quiz data inserted successfully' });
}));

router.get('/get-quiz-score', handle(async (req, res) => {
    const { tour_id: tourId } = req.query;
    const learnerId = req.user.id;
    if (!tourId) return res.status(400).json({ error: 'Missing tour_id' });

    const row = await db('tour_quiz').where({ learner_id: learnerId, tour_id: tourId }).first('total_score', 'ended_at');
    if (!row) return res.status(200).json({ isSolved: false, total_score: 0 });
    res.status(200).json({ isSolved: row.ended_at != null, total_score: row.total_score || 0 });
}));

router.post('/store-quiz-answers', handle(async (req, res) => {
    const { tour_id: tourId, answers } = req.body;
    const userId = req.user.id;
    if (!tourId || !Array.isArray(answers)) {
        return res.status(400).json({
            error: 'Missing or invalid required fields: tour_id or answers',
            details: { tour_id: !!tourId, answers: Array.isArray(answers) },
        });
    }
    await db.transaction(async (trx) => {
        for (const a of answers) {
            const answer = typeof a.answer === 'string' ? a.answer : JSON.stringify(a.answer);
            await upsert('quiz_answers', { tour_id: tourId, user_id: userId, question_id: a.question_id }, { answer }, trx);
        }
    });
    res.status(200).json({ message: 'Quiz answers stored successfully', count: answers.length });
}));

router.get('/get-quiz-answers', handle(async (req, res) => {
    const { tour_id: tourId } = req.query;
    const userId = req.user.id;
    if (!tourId) return res.status(400).json({ error: 'Missing tour_id' });
    const rows = await db('quiz_answers').where({ user_id: userId, tour_id: tourId }).select('question_id', 'answer');
    if (rows.length === 0) {
        return res.status(404).json({ message: 'No quiz answers found for the specified user and tour.' });
    }
    res.status(200).json(rows);
}));

module.exports = router;
