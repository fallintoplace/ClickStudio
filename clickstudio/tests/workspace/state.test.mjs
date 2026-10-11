import test from 'node:test';
import assert from 'node:assert/strict';
import {
    checkpoint,
    closeDraft,
    draftFromDocument,
    MAX_CLOSED_TABS,
    MAX_TABS,
    newDraft,
    recover,
    reopenDraft,
} from '../../.workspace-build/src/frontend/workspace/editor/drafts/workspace-state.js';

const workspace = (...tabs) => ({ version: 1, tabs, activeId: tabs[0].id });
const read = value => ({ getItem: () => JSON.stringify(value) });

test('Existing version-1 drafts preserve SQL, parameters, evidence and saved revision', () => {
    const draft = {
        ...newDraft('Exact.sql', 'SELECT {n:UInt64}'),
        serverId: 'document-1',
        baseRevision: 7,
        parameters: { n: '18446744073709551615' },
        activeRunId: 'run-1',
        runIds: ['run-1'],
        chart: { kind: 'bar', x: 0, ys: [1], title: 'Counts' },
        from: 2,
        to: 4,
        dependencies: ['metric-1'],
        parentDocumentId: 'parent-1',
        parentRunId: 'parent-run-1',
    };
    const result = recover('key', read(workspace(draft))).tabs[0];
    for (const [key, value] of Object.entries(draft)) assert.deepEqual(result[key], value, key);
});

test('A deleted table marker survives recovery only with valid source and run identity', () => {
    const source = { database: 'analytics', table: 'events', runId: 'run-1' };
    const draft = {
        ...newDraft('Preview events.sql', 'SELECT * FROM `analytics`.`events`'),
        activeRunId: 'run-1',
        invalidatedSource: source,
    };
    assert.deepEqual(recover('key', read(workspace(draft))).tabs[0].invalidatedSource, source);

    const malformed = recover(
        'key',
        read(workspace({ ...draft, invalidatedSource: { ...source, runId: '../bad' } })),
    ).tabs[0];
    assert.equal(malformed.invalidatedSource, undefined);
});

test('Opening a saved metric preserves its revision, run, parent and dependency semantics', () => {
    const metric = {
        definition: 'sum(amount)',
        grain: 'day',
        dimensions: ['region'],
        timezone: 'UTC',
        filters: 'paid',
        nullTreatment: 'exclude',
        sourceColumns: ['orders.amount'],
    };
    const document = {
        id: 'metric-document',
        owner: 'owner',
        name: 'Daily revenue',
        connectionId: 'demo',
        sql: 'SELECT sum(amount) FROM orders',
        revision: 4,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        parameters: { currency: 'EUR' },
        chart: { kind: 'line', x: 0, ys: [1], title: 'Revenue by day' },
        runId: 'metric-run',
        parentDocumentId: 'parent-document',
        dependencies: ['source-document'],
        kind: 'metric',
        metric,
    };
    const draft = draftFromDocument(document);
    assert.notEqual(draft.id, document.id);
    assert.equal(draft.serverId, document.id);
    assert.equal(draft.baseRevision, document.revision);
    assert.equal(draft.activeRunId, document.runId);
    assert.deepEqual(draft.runIds, [document.runId]);
    assert.equal(draft.parentDocumentId, document.parentDocumentId);
    assert.equal(draft.kind, document.kind);
    assert.deepEqual(draft.metric, metric);
    assert.deepEqual(draft.dependencies, document.dependencies);
    assert.deepEqual(draft.parameters, document.parameters);
    assert.deepEqual(draft.chart, document.chart);
});

test('Malformed optional metadata cannot crash a restored SQL draft', () => {
    const state = recover(
        'key',
        read(
            workspace({
                id: 'valid',
                name: 'Keep.sql',
                sql: 'SELECT 42',
                chart: { kind: 'unknown', x: -4, ys: 'bad', title: null },
                parameters: [],
                dependencies: null,
                checkpoints: [null, false, { sql: 'SELECT 7', from: 100, to: -1 }],
                runIds: 4,
                from: 1000,
                to: -10,
                kind: 'dashboard',
            }),
        ),
    );
    const draft = state.tabs[0];
    assert.equal(draft.sql, 'SELECT 42');
    assert.deepEqual(draft.chart, { kind: 'table', x: 0, ys: [], title: 'Query result' });
    assert.deepEqual(draft.parameters, {});
    assert.deepEqual(draft.dependencies, []);
    assert.deepEqual(draft.runIds, []);
    assert.equal(draft.from, 0);
    assert.equal(draft.to, draft.sql.length);
    assert.equal(draft.checkpoints.length, 1);
    assert.equal(draft.checkpoints[0].from, 0);
    assert.equal(draft.checkpoints[0].to, 8);
});

test('Scatter and heatmap chart settings survive workspace recovery', () => {
    const charts = [
        { kind: 'scatter', x: 0, ys: [1], title: 'Fare by distance' },
        { kind: 'heatmap', x: 1, groupBy: 0, ys: [2], title: 'Trips by weekday and hour' },
        {
            kind: 'heatmap',
            x: 499,
            groupBy: 498,
            ys: [497],
            title: 'Largest supported axis indexes',
        },
    ];
    for (const chart of charts) {
        const draft = { ...newDraft('Chart.sql', 'SELECT 1'), chart };
        assert.deepEqual(recover('key', read(workspace(draft))).tabs[0].chart, chart);
    }
});

test('Invalid heatmap group-by metadata is discarded without losing the rest of the chart', () => {
    for (const groupBy of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 500, '1']) {
        const draft = {
            ...newDraft('Chart.sql', 'SELECT 1'),
            chart: { kind: 'heatmap', x: 0, groupBy, ys: [2], title: 'Recoverable' },
        };
        const recovered = recover('key', read(workspace(draft))).tabs[0].chart;
        assert.deepEqual(recovered, { kind: 'heatmap', x: 0, ys: [2], title: 'Recoverable' });
    }
});

test('One invalid tab does not reset valid sibling drafts', () => {
    const good = newDraft('Keep.sql', 'SELECT 123');
    const state = recover(
        'key',
        read({ version: 1, tabs: [null, good, { sql: 123 }], activeId: good.id }),
    );
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].sql, 'SELECT 123');
    assert.match(state.recoveryWarning, /could not be recovered/);
});

test('Duplicate tab IDs are repaired without dropping either SQL draft', () => {
    const first = newDraft('A.sql', 'SELECT 1');
    const second = { ...first, name: 'B.sql', sql: 'SELECT 2' };
    const state = recover('key', read(workspace(first, second)));
    assert.equal(new Set(state.tabs.map(t => t.id)).size, 2);
    assert.deepEqual(
        state.tabs.map(t => t.sql),
        ['SELECT 1', 'SELECT 2'],
    );
    assert.equal(state.activeId, first.id);
});

test('Missing active tab selects a valid existing draft', () => {
    const draft = newDraft();
    assert.equal(
        recover('key', read({ ...workspace(draft), activeId: 'missing' })).activeId,
        draft.id,
    );
});

for (const value of [null, [], 1, { version: 2, tabs: [] }, { version: 1, tabs: [] }]) {
    test(`Unavailable workspace shape ${JSON.stringify(value)} opens one draft`, () => {
        const state = recover('key', read(value));
        assert.equal(state.tabs.length, 1);
        assert.equal(state.activeId, state.tabs[0].id);
    });
}

test('Invalid JSON and unavailable browser storage do not prevent startup', () => {
    for (const storage of [
        { getItem: () => '{bad' },
        {
            getItem() {
                throw new Error('denied');
            },
        },
    ])
        assert.equal(recover('key', storage).tabs.length, 1);
});

test('Parameters remain exact strings and own properties, including reserved-looking names', () => {
    const parameters = JSON.parse('{"__proto__":"literal","n":"9007199254740993","bad":3}');
    const draft = recover('key', read(workspace({ ...newDraft(), parameters }))).tabs[0];
    assert.equal(draft.parameters.n, '9007199254740993');
    assert.equal(Object.hasOwn(draft.parameters, '__proto__'), true);
    assert.equal(draft.parameters.__proto__, 'literal');
    assert.equal(Object.hasOwn(draft.parameters, 'bad'), false);
});

test('Restored checkpoints and both tab queues respect their documented limits', () => {
    const draft = newDraft();
    const points = Array.from({ length: 40 }, () => ({
        id: 'point',
        at: '',
        reason: 'test',
        sql: 'SELECT 1',
        from: 0,
        to: 0,
    }));
    const state = recover(
        'key',
        read({
            ...workspace({ ...draft, checkpoints: points }),
            tabs: Array.from({ length: 40 }, () => ({ ...draft, checkpoints: points })),
            closedTabs: Array.from({ length: 20 }, () => draft),
        }),
    );
    assert.equal(state.tabs.length, MAX_TABS);
    assert.equal(state.closedTabs.length, MAX_CLOSED_TABS);
    assert.equal(state.tabs[0].checkpoints.length, 30);
    assert.equal(
        new Set([...state.tabs, ...state.closedTabs].map(t => t.id)).size,
        MAX_TABS + MAX_CLOSED_TABS,
    );
});

test('Metric metadata is preserved and malformed arrays are made safe', () => {
    const metric = {
        definition: 'Orders',
        grain: 'day',
        dimensions: ['region', null],
        timezone: 'UTC',
        filters: 'paid',
        nullTreatment: 'exclude',
        sourceColumns: ['orders.id'],
    };
    const draft = recover('key', read(workspace({ ...newDraft(), kind: 'metric', metric })))
        .tabs[0];
    assert.deepEqual(draft.metric, { ...metric, dimensions: ['region'] });
    assert.equal(draft.kind, 'metric');
});

test('Closing an active middle tab selects its right-hand neighbour', () => {
    const [a, b, c] = [newDraft('A'), newDraft('B'), newDraft('C')];
    const original = { ...workspace(a, b, c), activeId: b.id };
    const next = closeDraft(original, b.id);
    assert.equal(next.activeId, c.id);
    assert.deepEqual(next.tabs, [a, c]);
    assert.equal(next.closedTabs[0], b);
    assert.equal(original.tabs.length, 3);
});

test('Closing a background tab leaves the active tab unchanged', () => {
    const [a, b] = [newDraft('A'), newDraft('B')];
    assert.equal(closeDraft(workspace(a, b), b.id).activeId, a.id);
});

test('Closing the last tab keeps a usable editor and a recoverable closed draft', () => {
    const original = newDraft('Important.sql', 'SELECT 99');
    const next = closeDraft(workspace(original), original.id);
    assert.equal(next.tabs.length, 1);
    assert.equal(next.activeId, next.tabs[0].id);
    assert.notEqual(next.activeId, original.id);
    assert.equal(next.closedTabs[0], original);
});

test('Close/reopen preserves unsaved parameters, selection, checkpoints and run IDs', () => {
    const draft = {
        ...checkpoint(newDraft('Work.sql', 'SELECT 3'), 'Before change'),
        from: 2,
        to: 4,
        activeRunId: 'run-1',
        runIds: ['run-1'],
        scriptId: 'script-1',
        parameters: { n: '3' },
    };
    const other = newDraft();
    const restored = reopenDraft(closeDraft(workspace(draft, other), draft.id));
    assert.equal(restored.tabs.at(-1), draft);
    assert.equal(restored.activeId, draft.id);
    assert.deepEqual(restored.closedTabs, []);
});

test('Closed tabs survive serialization and recovery', () => {
    const draft = newDraft('Return.sql', 'SELECT 1234');
    const closed = closeDraft(workspace(draft, newDraft()), draft.id);
    const recovered = reopenDraft(recover('key', read(closed)));
    assert.equal(recovered.tabs.at(-1).sql, draft.sql);
    assert.equal(recovered.activeId, draft.id);
});

test('Reopening cannot exceed the active-tab cap or consume the closed draft', () => {
    const state = workspace(...Array.from({ length: MAX_TABS }, () => newDraft()));
    state.closedTabs = [newDraft('Closed.sql')];
    assert.equal(reopenDraft(state), state);
    assert.equal(state.closedTabs.length, 1);
});

test('Unknown close and empty reopen are no-ops', () => {
    const state = workspace(newDraft());
    assert.equal(closeDraft(state, 'missing'), state);
    assert.equal(reopenDraft(state), state);
});

test('Closed history is newest-first and bounded without changing server references', () => {
    let state = workspace(newDraft());
    for (let i = 0; i < 14; i++) {
        state.tabs[0] = { ...state.tabs[0], name: `Draft-${i}`, serverId: `server-${i}` };
        state = closeDraft(state, state.activeId);
    }
    assert.equal(state.closedTabs.length, MAX_CLOSED_TABS);
    assert.equal(state.closedTabs[0].serverId, 'server-13');
    assert.equal(state.closedTabs.at(-1).serverId, 'server-4');
});

test('Reopening a duplicated local ID allocates a distinct ID without changing saved identity', () => {
    const draft = { ...newDraft(), serverId: 'server-1' };
    const state = { ...workspace(draft), closedTabs: [{ ...draft, sql: 'SELECT 99' }] };
    const next = reopenDraft(state);
    assert.notEqual(next.tabs[0].id, next.tabs[1].id);
    assert.equal(next.tabs[1].serverId, 'server-1');
    assert.equal(next.tabs[1].sql, 'SELECT 99');
});

test('Valid closed drafts survive when every open tab is malformed', () => {
    const draft = {
        ...newDraft('Still recoverable.sql', 'SELECT {n:UInt64}'),
        parameters: { n: '9007199254740993' },
        serverId: 'saved-document',
        baseRevision: 3,
    };
    const recovered = recover(
        'key',
        read({ version: 1, tabs: [null, { sql: 42 }], closedTabs: [draft] }),
    );
    assert.equal(recovered.tabs.length, 1);
    assert.equal(recovered.closedTabs.length, 1);
    assert.equal(reopenDraft(recovered).tabs.at(-1).sql, draft.sql);
    assert.deepEqual(reopenDraft(recovered).tabs.at(-1).parameters, draft.parameters);
    assert.equal(reopenDraft(recovered).tabs.at(-1).baseRevision, 3);
    assert.match(recovered.recoveryWarning, /could not be recovered/);
});

test('An empty open-tab list does not discard closed history', () => {
    const draft = newDraft('Closed.sql', 'SELECT 42');
    const recovered = recover('key', read({ version: 1, tabs: [], closedTabs: [draft] }));
    assert.equal(recovered.tabs.length, 1);
    assert.equal(recovered.activeId, recovered.tabs[0].id);
    assert.equal(recovered.closedTabs[0].id, draft.id);
});

test('Closed history can be recovered even when the open-tab list is missing', () => {
    const draft = newDraft('Closed.sql', 'SELECT 7');
    const recovered = recover('key', read({ version: 1, closedTabs: [draft] }));
    assert.equal(recovered.closedTabs[0]?.sql, draft.sql);
    assert.match(recovered.recoveryWarning, /could not be recovered/);
});

test('Malformed closed siblings are reported without losing valid closed drafts', () => {
    const draft = newDraft('Closed.sql', 'SELECT 8');
    const recovered = recover(
        'key',
        read({ ...workspace(newDraft()), closedTabs: [null, draft, { sql: 8 }] }),
    );
    assert.deepEqual(
        recovered.closedTabs.map(d => d.sql),
        [draft.sql],
    );
    assert.match(recovered.recoveryWarning, /could not be recovered/);
});
