// The project key decides which tours people see, so URL shapes that mean the
// same repository must produce the same key.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { projectKeyFromRemote } = require('../../out/projectKey.js');

test('the same repository gives the same key however it was cloned', () => {
    const expected = 'github.com/acme/widgets';
    for (const url of [
        'https://github.com/acme/widgets.git',
        'https://github.com/acme/widgets',
        'git@github.com:acme/widgets.git',
        'ssh://git@github.com/acme/widgets.git',
        'https://GitHub.com/Acme/Widgets.git',
        'https://github.com/acme/widgets/',
    ]) {
        assert.equal(projectKeyFromRemote(url), expected, url);
    }
});

test('credentials and ports are stripped', () => {
    assert.equal(projectKeyFromRemote('https://someone:ghp_token@github.com/acme/widgets.git'),
        'github.com/acme/widgets');
    assert.equal(projectKeyFromRemote('ssh://git@git.example.com:2222/acme/widgets.git'),
        'git.example.com/acme/widgets');
});

test('self-hosted remotes keep their path', () => {
    assert.equal(projectKeyFromRemote('git@gitlab.example.com:team/sub/group/repo.git'),
        'gitlab.example.com/team/sub/group/repo');
});

test('different repositories do not collide', () => {
    assert.notEqual(projectKeyFromRemote('git@github.com:acme/widgets.git'),
        projectKeyFromRemote('git@github.com:other/widgets.git'));
});

test('no remote means no key, so the caller falls back to the folder name', () => {
    assert.equal(projectKeyFromRemote(''), null);
    assert.equal(projectKeyFromRemote(undefined), null);
    assert.equal(projectKeyFromRemote('   '), null);
});
