import test from 'node:test';
import assert from 'node:assert/strict';
import {
    draftSaveStatus,
    sameSavedContent,
} from '../../.workspace-build/src/frontend/workspace/queries/saved-queries/draft-save.js';
import {
    draftFromDocument,
    recoverDraft,
} from '../../.workspace-build/src/frontend/workspace/editor/drafts/workspace-state.js';

const candlestick = {
    open: 0,
    high: 1,
    low: 2,
    close: 3,
    bid: 4,
    ask: 5,
    spread: 6,
    quoteActivity: 7,
};
function savedDocument(chartOptions = {}) {
    return {
        id: 'document-1',
        owner: 'owner',
        connectionId: 'demo',
        name: 'Prices.sql',
        sql: 'SELECT 1',
        revision: 3,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        parameters: {},
        kind: 'query',
        dependencies: [],
        chart: {
            kind: 'candlestick',
            x: 0,
            ys: [],
            title: 'Prices',
            candlestick: { ...candlestick },
            ...chartOptions,
        },
    };
}

test('Candlestick property order does not mark a saved draft as changed', () => {
    const saved = savedDocument();
    const draft = draftFromDocument(saved);
    draft.chart.candlestick = Object.fromEntries(Object.entries(candlestick).reverse());
    assert.equal(sameSavedContent(draft, saved), true);
    assert.equal(draftSaveStatus(draft, saved.connectionId, saved).state, 'saved');
});

test('Recovering candlestick settings preserves saved status after reordering their keys', () => {
    const saved = savedDocument({
        candlestick: Object.fromEntries(Object.entries(candlestick).reverse()),
    });
    const draft = recoverDraft(JSON.parse(JSON.stringify(draftFromDocument(saved))));
    assert.ok(draft);
    assert.notDeepEqual(Object.keys(draft.chart.candlestick), Object.keys(saved.chart.candlestick));
    assert.equal(draftSaveStatus(draft, saved.connectionId, saved).state, 'saved');
});

for (const [field, value] of Object.entries(candlestick)) {
    test(`Candlestick ${field} changes and removal both mark the draft as changed`, () => {
        const saved = savedDocument();
        const draft = draftFromDocument(saved);
        draft.chart.candlestick[field] = value + 10;
        assert.equal(sameSavedContent(draft, saved), false);
        delete draft.chart.candlestick[field];
        assert.equal(sameSavedContent(draft, saved), false);
    });
}

test('An omitted optional candlestick field equals an explicit undefined field', () => {
    const saved = savedDocument({ candlestick: {} });
    const draft = draftFromDocument(saved);
    draft.chart.candlestick = { open: undefined };
    assert.equal(sameSavedContent(draft, saved), true);
});

test('Missing candlestick settings stay distinct from an explicitly empty configuration', () => {
    const saved = savedDocument({ candlestick: undefined });
    const draft = draftFromDocument(saved);
    assert.equal(sameSavedContent(draft, saved), true);
    draft.chart.candlestick = {};
    assert.equal(sameSavedContent(draft, saved), false);
    assert.equal(
        sameSavedContent(
            draftFromDocument(savedDocument({ candlestick: undefined })),
            savedDocument({ candlestick: {} }),
        ),
        false,
    );
});

test('Opening a saved document does not share editable arrays or nested settings', () => {
    const saved = savedDocument({ ys: [1] });
    saved.parameters = { n: '9007199254740993' };
    saved.dependencies = ['source-1'];
    saved.kind = 'metric';
    saved.metric = {
        definition: 'Price',
        grain: 'day',
        dimensions: ['symbol'],
        timezone: 'UTC',
        filters: '',
        nullTreatment: 'ignore',
        sourceColumns: ['price'],
    };
    const original = structuredClone(saved);
    const draft = draftFromDocument(saved);
    draft.parameters.n = '0';
    draft.dependencies.push('source-2');
    draft.chart.ys.push(2);
    draft.chart.candlestick.open = 10;
    draft.metric.dimensions.push('exchange');
    draft.metric.sourceColumns.push('volume');
    assert.deepEqual(saved, original);
});

test('Recovery narrows mixed arrays without losing valid draft metadata', () => {
    const draft = recoverDraft({
        sql: 'SELECT 1',
        chart: { ys: [0, '1', null, -1, 1.5, 499, 500, {}] },
        runIds: [null, 'run-1', 1, 'run-1', {}, 'run-2'],
        dependencies: [false, 'source-1', {}, 'invalid id'],
        metric: { dimensions: [null, 'symbol', 2], sourceColumns: ['price', {}] },
        checkpoints: [null, 2, [], { sql: false }, { sql: 'SELECT 2', from: 0, to: 8 }],
    });
    assert.ok(draft);
    assert.deepEqual(draft.chart.ys, [0, 499]);
    assert.deepEqual(draft.runIds, ['run-1', 'run-2']);
    assert.deepEqual(draft.dependencies, ['source-1']);
    assert.deepEqual(draft.metric.dimensions, ['symbol']);
    assert.deepEqual(draft.metric.sourceColumns, ['price']);
    assert.equal(draft.checkpoints.length, 1);
    assert.equal(draft.checkpoints[0].sql, 'SELECT 2');
});
