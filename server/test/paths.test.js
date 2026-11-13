// Clients run on Windows, macOS and Linux while the server may run anywhere
// (often Linux in a container), so path handling must not depend on the
// server's own platform.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { toProjectRelative } = require('../src/routes/tours');

test('project-relative paths come out with forward slashes', () => {
    // Windows client, absolute path echoed back by the model
    assert.equal(
        toProjectRelative('C:\\Users\\dev\\projects\\demo\\src\\index.js', 'C:\\Users\\dev\\projects\\', 'demo'),
        'src/index.js',
    );
    // Windows client, already relative
    assert.equal(toProjectRelative('src\\app\\main.ts', 'C:\\Users\\dev\\projects\\', 'demo'), 'src/app/main.ts');

    // macOS/Linux client, absolute
    assert.equal(
        toProjectRelative('/Users/dev/projects/demo/src/index.js', '/Users/dev/projects/', 'demo'),
        'src/index.js',
    );
    // macOS/Linux client, relative with a leading ./
    assert.equal(toProjectRelative('./src/index.js', '/Users/dev/projects/', 'demo'), 'src/index.js');

    // No basePath at all (the extension may not send one)
    assert.equal(toProjectRelative('src/index.js', undefined, 'demo'), 'src/index.js');

    // Paths cannot climb out of the project
    assert.equal(toProjectRelative('../../etc/passwd', '/Users/dev/projects/', 'demo'), 'etc/passwd');

    assert.equal(toProjectRelative(null, '/x/', 'demo'), null);
});
