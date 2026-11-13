const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { db } = require('./db');
const { requireAuth, requireExpert } = require('./auth');
const { publicStatus } = require('./setup');

function createApp() {
    const app = express();
    app.use(cors({ origin: config.corsOrigin }));
    app.use(express.json({ limit: '50mb' }));

    app.get('/api/health', async (req, res) => {
        try {
            await db.raw('SELECT 1');
            res.json({ status: 'ok', features: publicStatus() });
        } catch (err) {
            res.status(503).json({ status: 'error', error: err.message });
        }
    });

    // Public: login and the dashboard handoff exchange.
    app.use('/api', require('./routes/auth'));

    // Everything else needs a valid token; the user comes from the token.
    app.use('/api', requireAuth, require('./routes/tours'));
    app.use('/api', requireAuth, require('./routes/quiz'));
    app.use('/api', requireAuth, require('./routes/learning'));
    app.use('/api', requireAuth, require('./routes/media'));
    app.use('/api/dashboard', requireAuth, requireExpert, require('./routes/dashboard'));

    app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

    // Serve the built dashboard (single-page app). Checked per request, so building
    // the dashboard after the server is already running does not need a restart.
    const indexHtml = path.join(config.dashboardDir, 'index.html');
    app.use(express.static(config.dashboardDir));
    app.get(/.*/, (req, res) => {
        if (!fs.existsSync(indexHtml)) {
            return res.status(404).type('text/plain').send(
                'The Lacy dashboard has not been built yet. Run "npm install && npm run build" in the dashboard directory.',
            );
        }
        return res.sendFile(indexHtml);
    });

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.code === 'LACY_NOT_CONFIGURED') {
            // Expected until the key is added; the message says what to do.
            console.warn(`${req.method} ${req.originalUrl}: ${err.message}`);
        } else {
            console.error(`${req.method} ${req.originalUrl} failed:`, err);
        }
        res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal Server Error', code: err.code });
    });

    return app;
}

module.exports = { createApp };
