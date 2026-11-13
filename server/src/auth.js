// Token authentication. The server derives the current user from the token,
// never from a user id sent by the client.
const crypto = require('crypto');
const { db, insertAndGetId } = require('./db');
const { toSqlDateTime } = require('./http');
const { publicUser } = require('./users');

const SESSION_DAYS = 30;
const HANDOFF_MINUTES = 5;

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function issueToken(userId, kind = 'session') {
    const token = crypto.randomBytes(32).toString('hex');
    const ms = kind === 'handoff' ? HANDOFF_MINUTES * 60_000 : SESSION_DAYS * 86_400_000;
    await insertAndGetId('sessions', {
        token_hash: hash(token),
        kind,
        user_id: userId,
        expires_at: toSqlDateTime(new Date(Date.now() + ms)),
        created_at: toSqlDateTime(new Date()),
    });
    return token;
}

async function consumeToken(token, kind) {
    if (!token) return null;
    // Expiry is compared in SQL: drivers return timestamps in formats that
    // JavaScript would otherwise parse as local time rather than UTC.
    const row = await db('sessions')
        .where({ token_hash: hash(token), kind })
        .andWhere('expires_at', '>', toSqlDateTime(new Date()))
        .first();
    if (!row) return null;

    if (kind === 'handoff') {
        await db('sessions').where({ id: row.id }).del(); // single use
    }
    return publicUser(await db('users').where({ id: row.user_id }).first());
}

/** Exchange a handoff code for a session token (used when opening the dashboard). */
async function exchangeHandoff(code) {
    const user = await consumeToken(code, 'handoff');
    if (!user) return null;
    return { token: await issueToken(user.id), user };
}

async function revokeToken(token) {
    if (token) await db('sessions').where({ token_hash: hash(token), kind: 'session' }).del();
}

function bearerToken(req) {
    const header = req.get('Authorization') || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** Populates req.user, or answers 401. */
async function requireAuth(req, res, next) {
    try {
        const user = await consumeToken(bearerToken(req), 'session');
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        req.user = user;
        req.authToken = bearerToken(req);
        return next();
    } catch (err) {
        return next(err);
    }
}

/** Only experts may read the dashboard's cross-learner statistics. */
function requireExpert(req, res, next) {
    if (req.user?.role !== 'expert') {
        return res.status(403).json({ error: 'Expert access required' });
    }
    return next();
}

/** Owning the tour is required to change or delete it. */
async function assertOwnsTour(req, res, tourId) {
    const tour = await db('tour').where({ id: tourId }).first('id', 'user_id');
    if (!tour) {
        res.status(404).json({ error: 'Tour not found' });
        return null;
    }
    if (Number(tour.user_id) !== Number(req.user.id)) {
        res.status(403).json({ error: 'This tour belongs to another user' });
        return null;
    }
    return tour;
}

/** Owning the step's tour is required to change or delete the step. */
async function assertOwnsStep(req, res, stepId) {
    const step = await db('tour_steps').where({ id: stepId }).first('id', 'tour_id');
    if (!step) {
        res.status(404).json({ error: 'Tour step not found' });
        return null;
    }
    return await assertOwnsTour(req, res, step.tour_id) ? step : null;
}

/** Delete expired rows; called opportunistically at startup. */
async function purgeExpiredTokens() {
    return db('sessions').where('expires_at', '<', toSqlDateTime(new Date())).del();
}

module.exports = {
    issueToken, exchangeHandoff, revokeToken, requireAuth, requireExpert,
    assertOwnsTour, assertOwnsStep, purgeExpiredTokens,
};
