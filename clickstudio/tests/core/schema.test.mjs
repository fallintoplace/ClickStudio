import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSchemaMetadataWarnings, enrichSchemaTables, formatPlaygroundMetadataWarning, isSchema } from '../../.core-build/shared/schema.js';

const tables = [
    { database: 'analytics', name: 'events', engine: 'MergeTree' },
    { database: 'archive', name: 'events', engine: 'MergeTree' },
];

test('Playground metadata warning is omitted when every optional feature is available', () => {
    assert.equal(formatPlaygroundMetadataWarning([]), undefined);
});

test('Playground metadata warning names one unavailable feature', () => {
    assert.equal(formatPlaygroundMetadataWarning(['projection']), 'The public Playground account cannot read projection metadata.');
});

test('Playground metadata warning joins two and three unavailable features naturally', () => {
    assert.equal(formatPlaygroundMetadataWarning(['projection', 'skip index']), 'The public Playground account cannot read projection or skip index metadata.');
    assert.equal(formatPlaygroundMetadataWarning(['projection', 'skip index', 'dictionary']), 'The public Playground account cannot read projection, skip index, or dictionary metadata.');
});

test('Playground metadata warning removes duplicate unavailable features', () => {
    assert.equal(formatPlaygroundMetadataWarning(['dictionary', 'dictionary']), 'The public Playground account cannot read dictionary metadata.');
});

test('public Playground groups permission failures into one useful warning', () => {
    assert.deepEqual(collectSchemaMetadataWarnings([], [
        { kind: 'projection', warning: 'Projection metadata is unavailable.', permissionDenied: true },
        { kind: 'skip index', warning: 'Skip-index metadata is unavailable.', permissionDenied: true },
        { kind: 'dictionary', warning: 'Dictionary metadata is unavailable.', permissionDenied: true },
    ], true), ['The public Playground account cannot read projection, skip index, or dictionary metadata.']);
});

test('public Playground keeps non-permission and general warnings alongside the summary', () => {
    assert.deepEqual(collectSchemaMetadataWarnings(['Database metadata is unavailable.'], [
        { kind: 'projection', warning: 'Projection metadata is unavailable.', permissionDenied: true },
        { kind: 'skip index', warning: 'Skip-index metadata is unavailable.' },
    ], true), [
        'Database metadata is unavailable.',
        'The public Playground account cannot read projection metadata.',
        'Skip-index metadata is unavailable.',
    ]);
});

test('other connections keep separate optional metadata warnings', () => {
    assert.deepEqual(collectSchemaMetadataWarnings([], [
        { kind: 'projection', warning: 'Projection metadata is unavailable.', permissionDenied: true },
        { kind: 'dictionary', warning: 'Dictionary metadata is unavailable.', permissionDenied: true },
    ], false), ['Projection metadata is unavailable.', 'Dictionary metadata is unavailable.']);
});

test('Schema metadata stays scoped to the matching database and table', () => {
    const result = enrichSchemaTables(tables, {
        tables: [{
            database: 'analytics', name: 'events', orderBy: '(tenant_id, day)', primaryKey: 'tenant_id, day',
            partitionKey: 'toYYYYMM(day)', samplingKey: 'tenant_id', ttlConfigured: true,
            rowEstimate: '18446744073709551615', sizeBytes: '9007199254740993123', uncompressedBytes: null,
            parts: '12', activeParts: '9', skipIndexTypes: ['bloom_filter'],
        }],
        projections: [{ database: 'analytics', table: 'events', name: 'by_day', type: 'Normal', sortingKey: 'day' }],
        skipIndexes: [{ database: 'analytics', table: 'events', name: 'tenant_idx', type: 'bloom_filter', expression: 'tenant_id', granularity: '4' }],
    });

    assert.equal(result[0].rowEstimate, '18446744073709551615');
    assert.equal(result[0].sizeBytes, '9007199254740993123');
    assert.equal(result[0].uncompressedBytes, null);
    assert.deepEqual(result[0].projections, [{ name: 'by_day', type: 'Normal', sortingKey: 'day' }]);
    assert.deepEqual(result[0].skipIndexes, [{ name: 'tenant_idx', type: 'bloom_filter', expression: 'tenant_id', granularity: '4' }]);
    assert.deepEqual(result[1], { ...tables[1], projections: [], skipIndexes: [] });
});

test('Unavailable metadata stays distinguishable from an empty metadata list', () => {
    const unavailable = enrichSchemaTables(tables, {});
    const availableButEmpty = enrichSchemaTables(tables, { tables: [], projections: [], skipIndexes: [] });

    assert.equal('projections' in unavailable[0], false);
    assert.equal('skipIndexes' in unavailable[0], false);
    assert.equal('rowEstimate' in unavailable[0], false);
    assert.deepEqual(availableButEmpty[0].projections, []);
    assert.deepEqual(availableButEmpty[0].skipIndexes, []);
    assert.equal('rowEstimate' in availableButEmpty[0], false);
});

test('Schema enrichment does not mutate the base table list', () => {
    const input = structuredClone(tables);
    enrichSchemaTables(input, { tables: [{ database: 'analytics', name: 'events', ttlConfigured: false }] });
    assert.deepEqual(input, tables);
});

const baseSchema = () => ({
    connectionId: 'playground',
    fetchedAt: '2026-09-25T00:00:00.000Z',
    columns: [{ database: 'github', table: 'events', name: 'event_type', type: 'String', defaultKind: '', comment: '' }],
    tables: [{ database: 'github', name: 'events', engine: 'MergeTree' }],
    warnings: [],
    truncated: false,
});

test('Schema wire guard accepts complete optional metadata', () => {
    const schema = {
        ...baseSchema(),
        tables: [{
            database: 'github', name: 'events', engine: 'MergeTree',
            orderBy: 'created_at', primaryKey: 'created_at', partitionKey: '', samplingKey: '',
            ttlConfigured: false, materializedViewTarget: '', rowEstimate: null, sizeBytes: '12',
            uncompressedBytes: '24', parts: '1', activeParts: '1', skipIndexTypes: ['minmax'],
            projections: [{ name: 'by_actor', type: 'Projection', sortingKey: 'actor_login' }],
            skipIndexes: [{ name: 'event_idx', type: 'set', expression: 'event_type', granularity: '1' }],
        }],
        dictionaries: [{
            database: 'github', name: 'actors', status: 'LOADED', type: 'HASHED',
            keyColumns: 'id', attributeColumns: 'name', elementCount: '10',
            memoryBytes: '128', lastSuccessfulUpdate: '2026-09-25T00:00:00.000Z',
        }],
        metadataWarnings: ['Metadata is partial'],
    };
    assert.equal(isSchema(schema), true);
});

test('Schema wire guard rejects malformed nested cache data', () => {
    const invalid = [
        { ...baseSchema(), columns: [{ database: 'github', table: 'events', name: 'event_type', type: 1, defaultKind: '', comment: '' }] },
        { ...baseSchema(), tables: [{ database: 'github', name: 'events', engine: 'MergeTree', rowEstimate: 42 }] },
        { ...baseSchema(), warnings: ['ok', 1] },
        { ...baseSchema(), tables: [{ database: 'github', name: 'events', engine: 'MergeTree', projections: [{ name: 'p', type: 'Projection' }] }] },
        { ...baseSchema(), dictionaries: [{ database: 'github', name: 'actors', status: 'LOADED', type: 'HASHED', keyColumns: 'id', attributeColumns: 'name', elementCount: 10, memoryBytes: '128', lastSuccessfulUpdate: 'now' }] },
    ];
    for (const value of invalid)
        assert.equal(isSchema(value), false);
});
