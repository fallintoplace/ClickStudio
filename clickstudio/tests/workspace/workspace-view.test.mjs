import test from 'node:test';
import assert from 'node:assert/strict';
import { sameSavedContent, draftSaveStatus, rememberRunIds } from '../../.workspace-build/shared/workspace-view.js';

function saved(overrides = {}) {
    return { id: 'document-1', owner: 'local-owner', connectionId: 'demo', name: 'Analysis.sql',
        sql: 'SELECT {n:UInt64}', parameters: { n: '9007199254740993', country: 'DE' },
        chart: { kind: 'bar', x: 0, ys: [1, 2], title: 'Analysis' }, kind: 'query', dependencies: ['source'],
        runId: 'run-1', revision: 3, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
        ...overrides };
}
function draft(document = saved(), overrides = {}) {
    return { ...document, id: 'local-tab', serverId: document.id, baseRevision: document.revision, activeRunId: document.runId,
        from: 0, to: 0, runIds: ['run-1'], checkpoints: [], ...overrides };
}
test('A fresh draft is explicitly local, not falsely labelled saved', () => {
    assert.equal(draftSaveStatus(draft(saved(), { serverId: undefined }), 'demo').state, 'local');
});
test('Exact saved content has a saved revision label', () => {
    assert.equal(draftSaveStatus(draft(), 'demo', saved()).label, 'Matches saved revision r3');
});
for (const [field, change] of Object.entries({
    name: 'Renamed.sql', sql: 'SELECT 2', parameters: { n: '9007199254740994', country: 'DE' },
    chart: { kind: 'line', x: 0, ys: [1, 2], title: 'Analysis' }, kind: 'snippet', dependencies: ['other'],
    activeRunId: 'run-2', parentDocumentId: 'parent-2',
})) {
    test(`Changing ${field} marks the current draft unsaved`, () => {
        assert.equal(draftSaveStatus(draft(saved(), { [field]: change }), 'demo', saved()).state, 'changed');
    });
}
for (const [field, value] of Object.entries({ title: 'Different title', x: 1, groupBy: 2, ys: [2, 1] })) {
    test(`Chart ${field} participates in saved-state comparison`, () => {
        const d = draft(); d.chart = { ...d.chart, [field]: value };
        assert.equal(sameSavedContent(d, saved()), false);
    });
}
test('SQL whitespace edits still differ from the exact saved revision', () => {
    assert.equal(sameSavedContent(draft(saved(), { sql: ` ${saved().sql}` }), saved()), false);
});
test('Selection and checkpoints do not mark document content dirty', () => {
    assert.equal(sameSavedContent(draft(saved(), { from: 5, to: 9, checkpoints: [{ sql: 'SELECT 1' }], runIds: ['other'] }), saved()), true);
});
test('Parameter insertion order does not produce a false dirty state', () => {
    assert.equal(sameSavedContent(draft(saved(), { parameters: { country: 'DE', n: '9007199254740993' } }), saved()), true);
});
test('Cleared parameters do not equal a missing parameter key', () => {
    assert.equal(sameSavedContent(draft(saved(), { parameters: { n: '', country: 'DE' } }), saved()), false);
});
test('Review and publication markers are not editable content', () => {
    assert.equal(sameSavedContent(draft(), saved({ verifiedRevision: 3, publishedRevision: 3 })), true);
});
const metric = { definition: 'sum(amount)', grain: 'day', dimensions: ['country'], timezone: 'UTC', filters: '', nullTreatment: 'ignore', sourceColumns: ['amount'] };
for (const key of Object.keys(metric)) {
    test(`Metric ${key} edits are unsaved`, () => {
        const s = saved({ kind: 'metric', metric });
        const d = draft(s, { metric: { ...metric, [key]: Array.isArray(metric[key]) ? ['changed'] : 'changed' } });
        assert.equal(sameSavedContent(d, s), false);
    });
}
test('Metric key order does not produce a false change', () => {
    const s = saved({ kind: 'metric', metric });
    assert.equal(sameSavedContent(draft(s, { metric: Object.fromEntries(Object.entries(metric).reverse()) }), s), true);
});
test('Saving does not claim edits made during the request were saved', () => {
    const submitted = draft(), edited = { ...submitted, sql: 'SELECT 999' };
    assert.equal(draftSaveStatus(edited, 'demo', saved(), { saving: true }).state, 'saving');
    const response = saved({ revision: 4 });
    const current = { ...edited, baseRevision: response.revision };
    assert.equal(draftSaveStatus(current, 'demo', response).state, 'changed');
});
test('Failure to read a saved revision is not presented as saved', () => {
    assert.equal(draftSaveStatus(draft(), 'demo', saved(), { readError: true }).state, 'unavailable');
});
test('Loaded cached content stays verifiable during a background refresh', () => {
    assert.equal(draftSaveStatus(draft(), 'demo', saved(), { pending: true }).state, 'saved');
});
test('Initial loading is distinguished from a missing saved file', () => {
    assert.equal(draftSaveStatus(draft(), 'demo', undefined, { pending: true }).state, 'checking');
    assert.equal(draftSaveStatus(draft(), 'demo').state, 'unavailable');
});
test('A newer revision stays a conflict even when its SQL matches', () => {
    assert.equal(draftSaveStatus(draft(), 'demo', saved({ revision: 4 })).state, 'conflict');
});
test('Trash is distinct from a conflict or unsaved status', () => {
    assert.equal(draftSaveStatus(draft(), 'demo', saved({ deletedAt: '2026-01-03T00:00:00Z' })).state, 'deleted');
});
for (const other of [saved({ id: 'other' }), saved({ connectionId: 'other' }), saved({ revision: 2 })]) {
    test(`Mismatched baseline ${other.id}/${other.connectionId}/r${other.revision} is unavailable`, () => {
        assert.equal(draftSaveStatus(draft(), 'demo', other).state, 'unavailable');
    });
}
test('A missing base revision is not described as a known conflict', () => {
    assert.equal(draftSaveStatus(draft(saved(), { baseRevision: undefined }), 'demo', saved()).state, 'unavailable');
});

test('Script polling remembers only new statement IDs', () => {
    const previous = ['query-1'];
    assert.deepEqual(rememberRunIds(previous, ['script-1', 'script-1', 'script-2']), ['query-1', 'script-1', 'script-2']);
    assert.deepEqual(previous, ['query-1']);
});
test('Repeated script polling returns the original history reference', () => {
    const previous = ['script-1', 'script-2'];
    assert.equal(rememberRunIds(previous, ['script-1', 'script-2']), previous);
});
test('Remembered script history survives a later non-script run', () => {
    const ids = rememberRunIds(rememberRunIds([], ['script-1', 'script-2']), ['query-3']);
    assert.deepEqual(ids, ['script-1', 'script-2', 'query-3']);
});
