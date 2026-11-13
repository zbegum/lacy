// Learner progress: completion, feedback, questions and research telemetry.
const express = require('express');
const { db, insertAndGetId } = require('../db');
const { handle, toSqlDateTime, now } = require('../http');

const router = express.Router();

router.patch('/complete-tour', handle(async (req, res) => {
    const { tourID: tourId } = req.body;
    const userId = req.user.id;
    if (!tourId) return res.status(400).json({ error: 'Missing tourID' });
    let affectedRows = await db('tour_assignment')
        .where({ tour_id: tourId, user_id: userId })
        .update({ tour_status: 'completed' });
    if (!affectedRows) {
        // Explorations are nobody's assignment, so there is no row to update.
        // Record the owner finishing their own exploration, so it can show as done.
        const own = await db('tour').where({ id: tourId, user_id: userId, isGuided: 0 }).first('id');
        if (own) {
            await db('tour_assignment').insert({
                tour_id: tourId, user_id: userId, tour_status: 'completed', feedback: '', rating: null, time_spent: 0,
            });
            affectedRows = 1;
        }
    }
    res.json({ success: true, affectedRows });
}));

router.post('/submit-feedback', handle(async (req, res) => {
    const { tour_id: tourId, tour_status: status, feedback, rating, time_spent: timeSpent } = req.body;
    const userId = req.user.id;
    if (!tourId || !status || !rating) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const values = { feedback: feedback || null, rating, time_spent: timeSpent || 0, tour_status: status };
    const keys = { tour_id: tourId, user_id: userId };

    const updated = await db('tour_assignment').where(keys).update(values);
    if (updated) return res.status(200).json({ message: 'Feedback updated successfully' });

    await db('tour_assignment').insert({ ...keys, ...values });
    res.status(201).json({ message: 'Feedback submitted successfully' });
}));

router.get('/get-feedback', handle(async (req, res) => {
    const { tour_id: tourId } = req.query;
    const userId = req.user.id;
    if (!tourId) return res.status(400).json({ error: 'Missing tour_id' });

    const row = await db('tour_assignment').where({ user_id: userId, tour_id: tourId }).first('feedback', 'rating', 'time_spent');
    if (!row || row.rating == null || row.time_spent <= 0) {
        return res.status(200).json({ feedbackExists: false, message: 'No feedback found for the specified user and tour.' });
    }
    res.status(200).json({ feedbackExists: true, feedback: row });
}));

router.post('/submit-question', handle(async (req, res) => {
    const { tour_id: tourId, step_no: stepNo, question } = req.body;
    const userId = req.user.id;
    if (!tourId || !stepNo || !question) {
        return res.status(400).json({ success: false, error: 'Missing fields' });
    }
    const questionId = await insertAndGetId('questions', {
        tour_id: tourId, step_no: stepNo, user_id: userId, question, created_at: now(),
    }, 'question_id');
    res.json({ success: true, question_id: questionId });
}));

router.post('/log-tour-usage', handle(async (req, res) => {
    const { tour_id: tourId, enter_timestamp: enter, exit_timestamp: exit, exit_step_id: exitStepId } = req.body;
    const userId = req.user.id;
    if (!tourId) return res.status(400).json({ error: 'Missing required fields' });
    const id = await insertAndGetId('tour_usage', {
        tour_id: tourId, user_id: userId, enter_timestamp: toSqlDateTime(enter),
        exit_timestamp: toSqlDateTime(exit), exit_step_id: exitStepId ?? null,
    });
    res.status(201).json({ message: 'Tour usage logged successfully', id });
}));

router.post('/log-edit-history', handle(async (req, res) => {
    const { tour_id: tourId, start_time: start, end_time: end, number_of_edit_actions: actions } = req.body;
    const userId = req.user.id;
    if (!tourId || !start || !end || !actions) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const id = await insertAndGetId('edit_history', {
        tour_id: tourId, user_id: userId, start_time: toSqlDateTime(start),
        end_time: toSqlDateTime(end), number_of_edit_actions: actions,
    });
    res.status(201).json({ message: 'Edit history logged successfully', id });
}));

module.exports = router;
