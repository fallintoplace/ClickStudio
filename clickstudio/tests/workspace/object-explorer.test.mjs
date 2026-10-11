import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildObjectExplorer,
    explorerColumnId,
    explorerDictionaryId,
    explorerProjectionId,
    explorerRelationId,
    explorerSkipIndexId,
    relationKind,
    tableQuerySql,
} from '../../.workspace-build/src/frontend/database/explorer/objects/model.js';
import { sqlReferencesQualifiedTable } from '../../.workspace-build/src/shared/database/tables/delete-table.js';

const schema = {
    connectionId: 'live',
    fetchedAt: '2026-09-25T00:00:00.000Z',
    tables: [
        {
            database: 'analytics',
            name: 'events',
            engine: 'MergeTree',
            orderBy: '(tenant_id, day)',
            primaryKey: 'tenant_id',
            projections: [{ name: 'by_day', type: 'Normal', sortingKey: 'day' }],
            skipIndexes: [
                {
                    name: 'tenant_bloom',
                    type: 'bloom_filter',
                    expression: 'tenant_id',
                    granularity: '4',
                },
            ],
        },
        { database: 'analytics', name: 'daily_events', engine: 'View' },
        { database: 'system', name: 'query_log', engine: 'MergeTree' },
    ],
    columns: [
        {
            database: 'analytics',
            table: 'events',
            name: 'tenant_id',
            type: 'UInt64',
            defaultKind: '',
            comment: '',
        },
        {
            database: 'analytics',
            table: 'events',
            name: 'email',
            type: 'String',
            defaultKind: '',
            comment: 'Customer email',
        },
        {
            database: 'analytics',
            table: 'daily_events',
            name: 'day',
            type: 'Date',
            defaultKind: '',
            comment: '',
        },
    ],
    dictionaries: [
        {
            database: 'analytics',
            name: 'campaign_lookup',
            status: 'LOADED',
            type: 'Hashed',
            keyColumns: 'campaign_id UInt64',
            attributeColumns: 'campaign_name String',
            elementCount: '10',
            memoryBytes: '1024',
            lastSuccessfulUpdate: '2026-09-25 08:00:00',
        },
    ],
    warnings: [],
    truncated: false,
};

test('Object explorer groups the preferred database first and classifies ClickHouse views', () => {
    const model = buildObjectExplorer(schema, '', 'analytics');
    assert.deepEqual(
        model.databases.map(database => database.name),
        ['analytics', 'system'],
    );
    assert.deepEqual(
        model.databases[0].tables.map(relation => relation.table.name),
        ['events'],
    );
    assert.deepEqual(
        model.databases[0].views.map(relation => relation.table.name),
        ['daily_events'],
    );
    assert.deepEqual(
        model.databases[0].dictionaries.map(dictionary => dictionary.name),
        ['campaign_lookup'],
    );
    assert.equal(model.totalObjects, 4);
    assert.equal(model.visibleObjects, 4);
    assert.equal(relationKind(schema.tables[0]), 'table');
    assert.equal(relationKind(schema.tables[1]), 'view');
});

test('Object explorer search keeps ancestors while pinpointing columns, projections, indexes, and dictionaries', () => {
    const columnModel = buildObjectExplorer(schema, 'customer email', 'analytics');
    assert.equal(columnModel.visibleObjects, 1);
    assert.deepEqual(
        columnModel.databases[0].tables[0].matchedColumns.map(column => column.name),
        ['email'],
    );

    const projectionModel = buildObjectExplorer(schema, 'by_day', 'analytics');
    assert.deepEqual(
        projectionModel.databases[0].tables[0].matchedProjections.map(
            projection => projection.name,
        ),
        ['by_day'],
    );

    const indexModel = buildObjectExplorer(schema, 'tenant_bloom', 'analytics');
    assert.deepEqual(
        indexModel.databases[0].tables[0].matchedSkipIndexes.map(index => index.name),
        ['tenant_bloom'],
    );

    const dictionaryModel = buildObjectExplorer(schema, 'campaign_lookup', 'analytics');
    assert.equal(dictionaryModel.databases[0].dictionaries[0].name, 'campaign_lookup');

    assert.equal(buildObjectExplorer(schema, 'does-not-exist', 'analytics').visibleObjects, 0);
});

test('Object explorer keeps stable selectable IDs for every navigable object', () => {
    const model = buildObjectExplorer(schema, '', 'analytics');
    assert.equal(
        model.selectionById.get(explorerRelationId('analytics', 'events'))?.kind,
        'relation',
    );
    assert.equal(
        model.selectionById.get(explorerColumnId('analytics', 'events', 'email'))?.kind,
        'column',
    );
    assert.equal(
        model.selectionById.get(explorerProjectionId('analytics', 'events', 'by_day'))?.kind,
        'projection',
    );
    assert.equal(
        model.selectionById.get(explorerSkipIndexId('analytics', 'events', 'tenant_bloom'))?.kind,
        'skip-index',
    );
    assert.equal(
        model.selectionById.get(explorerDictionaryId('analytics', 'campaign_lookup'))?.kind,
        'dictionary',
    );
});

test('Generated table SQL is quoted, bounded, and uses explicit columns when practical', () => {
    const table = schema.tables[0];
    const columns = schema.columns.filter(column => column.table === 'events');
    assert.equal(
        tableQuerySql(table, columns, 'preview'),
        'SELECT *\nFROM `analytics`.`events`\nLIMIT 100;',
    );
    assert.equal(
        tableQuerySql(table, columns, 'select'),
        'SELECT\n    `tenant_id`,\n    `email`\nFROM `analytics`.`events`\nLIMIT 100;',
    );

    const manyColumns = Array.from({ length: 25 }, (_, index) => ({
        database: 'analytics',
        table: 'events',
        name: `c${index}`,
        type: 'UInt8',
        defaultKind: '',
        comment: '',
    }));
    assert.match(tableQuerySql(table, manyColumns, 'select'), /SELECT\n {4}\*\nFROM/);
});

test('Dropped table matching finds exact FROM and JOIN identifiers outside comments and strings', () => {
    const sql =
        'SELECT *\nFROM `analytics`.`events`\nJOIN `analytics`.`owners` ON owners.id = events.owner_id;';
    assert.equal(sqlReferencesQualifiedTable(sql, 'analytics', 'events'), true);
    assert.equal(sqlReferencesQualifiedTable(sql, 'analytics', 'owners'), true);
    assert.equal(sqlReferencesQualifiedTable(sql, 'analytics', 'event'), false);
    assert.equal(
        sqlReferencesQualifiedTable(
            "SELECT 'FROM `analytics`.`events`' -- JOIN `analytics`.`events`",
            'analytics',
            'events',
        ),
        false,
    );
});

test('Dropped table matching keeps quoted identifier case and ignores malformed SQL', () => {
    assert.equal(
        sqlReferencesQualifiedTable('select * from `Analytics`.`Events`', 'Analytics', 'Events'),
        true,
    );
    assert.equal(
        sqlReferencesQualifiedTable('select * from `analytics`.`events`', 'analytics', 'Events'),
        false,
    );
    assert.equal(
        sqlReferencesQualifiedTable('select * from `analytics`.`events', 'analytics', 'events'),
        false,
    );
});

test('Undefined schema produces an empty explorer model', () => {
    const model = buildObjectExplorer(undefined, 'events');
    assert.equal(model.totalObjects, 0);
    assert.equal(model.visibleObjects, 0);
    assert.deepEqual(model.databases, []);
});
