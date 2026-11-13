// The sign-in form is the first thing anyone uses, and it is where each person
// points their editor at their team's Lacy server.
const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const sharedJs = fs.readFileSync(path.resolve(__dirname, '../../src/sidebar-panel/shared.js'), 'utf8');
const loginJs = fs.readFileSync(path.resolve(__dirname, '../../src/sidebar-panel/registration/login.js'), 'utf8');

function loadLogin({ serverUrl = 'http://localhost:4000' } = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><body>
        <div id="login-container"></div>
        <div id="app-tabs"></div>
        <div class="tab" id="tours-tab"></div>
    </body>`, { runScripts: 'outside-only', url: 'http://lacy.test' }); // an origin, so localStorage works

    const { window } = dom;
    window.LACY_API_URL = serverUrl;
    window.lacyLogoUri = 'logo.png';
    window.vscode = { postMessage: mock.fn(), getState: () => undefined, setState: mock.fn() };
    window.eval(`var vscode = window.vscode;\n${sharedJs}\n${loginJs}`);
    return window;
}

/** The form renders on a timer, after session restoration. */
const formReady = (window) => new Promise((resolve) => setTimeout(resolve, 150));

let window;
beforeEach(() => { window = loadLogin(); });

test('the sign-in form asks for the server, prefilled with the configured one', async () => {
    await formReady(window);
    const field = window.document.getElementById('server-url');
    assert.ok(field, 'there should be a server field');
    assert.equal(field.value, 'http://localhost:4000');
    assert.ok(window.document.getElementById('email'));
    assert.ok(window.document.getElementById('password'));
});

test('signing in uses the server that was typed, not the configured one', async () => {
    await formReady(window);
    const calls = [];
    window.fetch = mock.fn((url, options) => {
        calls.push(url);
        if (String(url).endsWith('/api/health')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
        }
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 1, email: 'ada@example.com', role: 'expert', token: 'tok' }),
        });
    });

    window.document.getElementById('server-url').value = 'http://lacy.team.internal:4000/';
    window.document.getElementById('email').value = 'ada@example.com';
    window.document.getElementById('password').value = 'secret';
    window.document.getElementById('login-form').dispatchEvent(new window.Event('submit'));
    await new Promise((r) => setTimeout(r, 50));

    assert.deepEqual(calls, [
        'http://lacy.team.internal:4000/api/health',
        'http://lacy.team.internal:4000/api/get-user-by-email-and-password',
    ], 'the trailing slash should be trimmed and both calls go to the typed server');

    const login = window.vscode.postMessage.mock.calls
        .map((c) => c.arguments[0])
        .find((m) => m.command === 'login');
    assert.equal(login.serverUrl, 'http://lacy.team.internal:4000', 'the address is handed to the extension to remember');
    assert.equal(login.token, 'tok');
    assert.equal(login.user.email, 'ada@example.com');
});

test('an unreachable server says so, instead of blaming the password', async () => {
    await formReady(window);
    window.fetch = mock.fn(() => Promise.reject(new Error('connect ECONNREFUSED')));

    window.document.getElementById('server-url').value = 'http://nowhere:4000';
    window.document.getElementById('email').value = 'ada@example.com';
    window.document.getElementById('password').value = 'secret';
    window.document.getElementById('login-form').dispatchEvent(new window.Event('submit'));
    await new Promise((r) => setTimeout(r, 50));

    const popup = window.document.querySelector('.wrong-popup');
    assert.match(popup.textContent, /Cannot reach a Lacy server at http:\/\/nowhere:4000/);
    assert.equal(window.fetch.mock.callCount(), 1, 'it should not try to sign in to a server it cannot reach');
});

test('a reachable server with wrong credentials blames the credentials', async () => {
    await formReady(window);
    window.fetch = mock.fn((url) => {
        if (String(url).endsWith('/api/health')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'User not found' }) });
    });

    window.document.getElementById('email').value = 'ada@example.com';
    window.document.getElementById('password').value = 'wrong';
    window.document.getElementById('login-form').dispatchEvent(new window.Event('submit'));
    await new Promise((r) => setTimeout(r, 50));

    assert.match(window.document.querySelector('.wrong-popup').textContent, /Email or password is wrong/);
});

test('the sign-in form says where the details come from and links to the setup guide', async () => {
    await formReady(window);
    const help = window.document.querySelector('.login-help');
    assert.ok(help, 'there should be a help note under the form');
    assert.match(help.textContent, /server address/);
    window.document.getElementById('setup-guide-link').click();
    const sent = window.vscode.postMessage.mock.calls.map((c) => c.arguments[0].command);
    assert.ok(sent.includes('openSetupGuide'));
});
