const express = require('express');
const { handle } = require('../http');
const { verifyCredentials, changePassword, listDepartments, MIN_PASSWORD_LENGTH } = require('../users');
const { issueToken, exchangeHandoff, revokeToken, requireAuth } = require('../auth');

const router = express.Router();

async function login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = await verifyCredentials(email, password);
    if (!user) {
        // 404 rather than 401: the extension's login page expects this.
        return res.status(404).json({ error: 'User not found' });
    }
    // `token` is what clients must send as `Authorization: Bearer <token>`.
    res.json({ ...user, token: await issueToken(user.id) });
}

router.post('/login', handle(login));
// Original endpoint name, still used by the extension's login page.
router.post('/get-user-by-email-and-password', handle(login));

router.post('/logout', requireAuth, handle(async (req, res) => {
    await revokeToken(req.authToken);
    res.json({ success: true });
}));

router.get('/me', requireAuth, (req, res) => res.json(req.user));

// The departments this team actually uses, for the "target department" picker.
router.get('/departments', requireAuth, handle(async (req, res) => {
    res.json(await listDepartments());
}));

router.post('/change-password', requireAuth, handle(async (req, res) => {
    const { current_password: current, new_password: next } = req.body;
    if (!current || !next) {
        return res.status(400).json({ error: 'current_password and new_password are required' });
    }
    if (String(next).length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    if (!await changePassword(req.user.id, current, next)) {
        return res.status(403).json({ error: 'Your current password is not correct.' });
    }
    // Other sessions keep working; sign out elsewhere if that matters to you.
    res.json({ success: true });
}));

// Short-lived code so the extension can open the dashboard in a browser
// without putting a long-lived token in the URL.
router.post('/auth/handoff', requireAuth, handle(async (req, res) => {
    res.json({ code: await issueToken(req.user.id, 'handoff') });
}));

router.post('/auth/exchange', handle(async (req, res) => {
    const result = await exchangeHandoff(req.body.code);
    if (!result) {
        return res.status(401).json({ error: 'This link has expired. Open the dashboard from VS Code again.' });
    }
    res.json(result);
}));

module.exports = router;
