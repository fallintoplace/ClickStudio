import test from 'node:test';
import assert from 'node:assert/strict';
import {
    matchesDraft,
    sameParameters,
} from '../../.workspace-build/src/frontend/workspace/queries/history/evidence.js';

for (const [title, left, right, expected] of [
    ['Empty parameters match', {}, {}, true],
    ['Insertion order does not change evidence', { a: '1', b: '2' }, { b: '2', a: '1' }, true],
    ['Changed parameter makes evidence stale', { value: 'before' }, { value: 'after' }, false],
    ['Missing key is not an empty value', { value: '' }, {}, false],
    ['Additional parameter is detected', {}, { value: '' }, false],
    [
        'UInt64 strings remain exact',
        { n: '18446744073709551615' },
        { n: '18446744073709551614' },
        false,
    ],
    ['Only own keys participate', { toString: 'x' }, {}, false],
])
    test(title, () => assert.equal(sameParameters(left, right), expected));

test('Draft matching checks both SQL and bound values without mutating evidence', () => {
    const run = Object.freeze({ sql: 'SELECT {n:UInt64}', parameters: Object.freeze({ n: '1' }) });
    assert.equal(matchesDraft(run, '\nSELECT {n:UInt64}\n', { n: '1' }), true);
    assert.equal(matchesDraft(run, run.sql, { n: '2' }), false);
    assert.equal(matchesDraft(run, 'SELECT 2', { n: '1' }), false);
    assert.deepEqual(run.parameters, { n: '1' });
});
