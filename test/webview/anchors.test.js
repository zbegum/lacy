// Steps are stored as line ranges, which drift when the file is edited or the
// reader is on another branch. These cover finding the code again by content.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { anchorTextFor, locateStep, anchorWarning } = require('../../out/anchors.js');

const FILE = [
    'function start() {',      // 1
    '    connect();',          // 2
    '    listen();',           // 3
    '}',                       // 4
    '',                        // 5
    'function stop() {',       // 6
    '    disconnect();',       // 7
    '}',                       // 8
].join('\n');

test('anchorTextFor takes the lines a step covers', () => {
    assert.equal(anchorTextFor(FILE, 6, 8), 'function stop() {\n    disconnect();\n}');
    assert.equal(anchorTextFor(FILE, 5, 5), null, 'a blank range is not worth remembering');
    assert.equal(anchorTextFor('', 1, 2), null);
});

test('unchanged code is found where the step says it is', () => {
    const anchor = anchorTextFor(FILE, 6, 8);
    assert.deepEqual(locateStep(FILE, anchor, 6, 8), { startLine: 6, endLine: 8, status: 'exact' });
});

test('code that moved down is followed', () => {
    const anchor = anchorTextFor(FILE, 6, 8);
    const edited = ['// a new header', '// added later', '', FILE].join('\n');

    const located = locateStep(edited, anchor, 6, 8);
    assert.equal(located.status, 'moved');
    assert.deepEqual(edited.split('\n').slice(located.startLine - 1, located.endLine),
        ['function stop() {', '    disconnect();', '}']);
});

test('code that moved up is followed', () => {
    const anchor = anchorTextFor(FILE, 6, 8);
    const edited = FILE.split('\n').slice(4).join('\n'); // first four lines deleted

    const located = locateStep(edited, anchor, 6, 8);
    assert.equal(located.status, 'moved');
    assert.deepEqual(edited.split('\n').slice(located.startLine - 1, located.endLine),
        ['function stop() {', '    disconnect();', '}']);
});

test('reindented code still counts as the same code', () => {
    const anchor = anchorTextFor(FILE, 6, 8);
    const reindented = FILE.replace('    disconnect();', '        disconnect();');
    assert.equal(locateStep(reindented, anchor, 6, 8).status, 'exact');
});

test('code edited in place is reported as changed, and still found', () => {
    const anchor = anchorTextFor(FILE, 6, 8);
    const edited = FILE.replace('    disconnect();', '    disconnect({ force: true });');

    const located = locateStep(edited, anchor, 6, 8);
    assert.equal(located.status, 'changed');
    assert.equal(located.startLine, 6, 'the step still points at the function it describes');
    assert.match(anchorWarning(located.status, 'src/app.js'), /edited since the tour was written/);
});

test('an edit and a move together are still found', () => {
    const anchor = anchorTextFor(FILE, 6, 8);
    const edited = ['// header', '', FILE.replace('    disconnect();', '    disconnect(1);')].join('\n');

    const located = locateStep(edited, anchor, 6, 8);
    assert.equal(located.status, 'changed');
    assert.match(edited.split('\n')[located.startLine - 1], /function stop/);
});

test('code that is gone is reported, not silently highlighted', () => {
    const anchor = anchorTextFor(FILE, 6, 8);
    const rewritten = 'function start() {\n    connect();\n}\n';

    const located = locateStep(rewritten, anchor, 6, 8);
    assert.equal(located.status, 'missing');
    assert.equal(located.startLine, 6, 'the original range comes back so something can still be shown');
    assert.match(anchorWarning(located.status, 'src/app.js'), /no longer in src\/app\.js/);
});

test('when the snippet appears twice, the copy nearest the original wins', () => {
    const duplicated = [
        'log();',            // 1
        'log();',            // 2
        '',                  // 3
        '// far below',      // 4
        'log();',            // 5
    ].join('\n');

    const located = locateStep(duplicated, 'log();', 5, 5);
    assert.equal(located.startLine, 5);

    const nearTop = locateStep(duplicated, 'log();', 1, 1);
    assert.equal(nearTop.startLine, 1);
});

test('steps written before anchoring keep their line numbers', () => {
    const located = locateStep(FILE, null, 2, 3);
    assert.deepEqual(located, { startLine: 2, endLine: 3, status: 'unknown' });
    assert.equal(anchorWarning('unknown', 'src/app.js'), null);
    assert.equal(anchorWarning('exact', 'src/app.js'), null);
});

test('a moved step reports where it went', () => {
    assert.match(anchorWarning('moved', 'src/app.js'), /moved in src\/app\.js/);
});

test('a step whose saved code starts with a blank line is not reported as moved', () => {
    // Steps often begin on the blank line above a function. That line is ignored
    // when matching, so the code itself is looked for one line further down.
    const file = ['import x', '', 'def first():', '    return 1', '', 'def second():', '    return 2'].join('\n');
    const anchor = anchorTextFor(file, 2, 4); // "", "def first():", "    return 1"
    const found = locateStep(file, anchor, 2, 4);
    assert.equal(found.status, 'exact');
    assert.deepEqual([found.startLine, found.endLine], [2, 4]);
    assert.equal(anchorWarning(found.status, 'a.py'), null);

    // And when it really did move, it is still followed.
    const moved = ['import x', 'import y', '', 'def first():', '    return 1'].join('\n');
    const followed = locateStep(moved, anchor, 2, 4);
    assert.equal(followed.status, 'moved');
    assert.equal(followed.startLine, 4);
});
