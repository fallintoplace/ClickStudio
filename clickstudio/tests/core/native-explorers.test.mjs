import test from 'node:test';
import assert from 'node:assert/strict';
import {
    metadataInteger,
    metadataTime,
    metadataProgress,
    metadataFlag,
} from '../../.core-build/src/shared/database/explorer/metadata.js';
import { materializedViewDefinition } from '../../.core-build/src/shared/database/explorer/objects/view-definition.js';
import {
    buildMaterializedViewLineage,
    layoutLineage,
    tableReferenceId,
} from '../../.core-build/src/shared/database/explorer/objects/view-lineage.js';
import {
    loadNativeExplorer,
    lineageTablesQuery,
    mergeActivityQuery,
    mutationActivityQuery,
    refreshActivityQuery,
} from '../../.core-build/src/shared/database/explorer/explorers.js';
import { nativeExplorerFixture } from '../../.core-build/src/shared/samples/explorers.js';
import {
    parseMergeActivity,
    parseMutationActivity,
    mutationStatus,
} from '../../.core-build/src/shared/database/explorer/storage/activity.js';
import {
    nativeCount,
    nativeBytes,
} from '../../.core-build/src/frontend/database/explorer/format.js';

for (const value of [undefined, null, '', -1, '1.2', 'bad', Number.MAX_SAFE_INTEGER + 1])
    test(`Metadata does not invent a counter from ${String(value)}`, () =>
        assert.equal(metadataInteger(value), undefined));
test('Metadata preserves UInt64, zero and unknown progress independently', () => {
    assert.equal(metadataInteger('18446744073709551615'), '18446744073709551615');
    assert.equal(metadataInteger('000'), '0');
    assert.equal(metadataInteger(0), '0');
    assert.equal(metadataFlag('0'), false);
    assert.equal(metadataFlag(undefined), undefined);
    assert.equal(metadataProgress(null), undefined);
    assert.equal(metadataProgress(2), 1);
    assert.equal(metadataProgress(-1), undefined);
    assert.equal(metadataTime('2026-09-25 12:00:00'), '2026-09-25T12:00:00.000Z');
    assert.equal(metadataTime('1970-01-01 00:00:00'), undefined);
    assert.equal(metadataTime('bad'), undefined);
    assert.equal(nativeCount('18446744073709551615'), '18,446,744,073,709,551,615');
    assert.equal(nativeBytes('1024'), '1.0 KiB');
    assert.equal(nativeBytes(undefined), 'Unavailable');
});
for (const [sql, expected] of [
    [
        'CREATE MATERIALIZED VIEW mv TO target AS SELECT * FROM source',
        { mode: 'incremental', target: { database: 'db', table: 'target' }, dependsOn: [] },
    ],
    [
        'CREATE MATERIALIZED VIEW IF NOT EXISTS `mv` REFRESH EVERY 10 MINUTE DEPENDS ON `raw`.`first`, "second" TO "out" AS SELECT 1',
        {
            mode: 'refreshable',
            schedule: 'EVERY 10 MINUTE',
            target: { database: 'db', table: 'out' },
            dependsOn: [
                { database: 'raw', table: 'first' },
                { database: 'db', table: 'second' },
            ],
        },
    ],
    [
        'CREATE MATERIALIZED VIEW mv REFRESH AFTER 1 HOUR APPEND INCREMENTAL TO dest AS SELECT 1',
        {
            mode: 'append-incremental',
            schedule: 'AFTER 1 HOUR',
            target: { database: 'db', table: 'dest' },
            dependsOn: [],
        },
    ],
    [
        "CREATE MATERIALIZED VIEW mv TO `target.with.dot` AS SELECT 'REFRESH EVERY 1 SECOND APPEND INCREMENTAL' FROM t",
        {
            mode: 'incremental',
            target: { database: 'db', table: 'target.with.dot' },
            dependsOn: [],
        },
    ],
    [
        "CREATE MATERIALIZED VIEW mv TO INNER UUID 'x' ENGINE = MergeTree ORDER BY x AS SELECT 1 AS x",
        { mode: 'incremental', dependsOn: [] },
    ],
    [
        'CREATE MATERIALIZED VIEW mv ON CLUSTER as TO dest AS SELECT 1',
        { mode: 'incremental', target: { database: 'db', table: 'dest' }, dependsOn: [] },
    ],
    ['SELECT 1', { mode: 'unknown', dependsOn: [] }],
])
    test(`CREATE header parser: ${sql.slice(0, 85)}`, () =>
        assert.deepEqual(materializedViewDefinition(sql, 'db'), expected));

test('Lineage separates write targets, insert triggers, catalog dependencies and refresh ordering', () => {
    const snapshot = buildMaterializedViewLineage(
        'db',
        [
            {
                database: 'db',
                name: 'source',
                engine: 'MergeTree',
                dependencies_database: ['db'],
                dependencies_table: ['mv'],
            },
            {
                database: 'db',
                name: 'mv',
                engine: 'MaterializedView',
                target_database: 'db',
                target_table: 'dest',
                loading_dependencies_database: ['db', 'db'],
                loading_dependencies_table: ['dest', 'source'],
                create_table_query: 'CREATE MATERIALIZED VIEW mv TO dest AS SELECT * FROM source',
            },
            {
                database: 'db',
                name: 'refresh',
                engine: 'MaterializedView',
                create_table_query:
                    'CREATE MATERIALIZED VIEW refresh REFRESH EVERY 1 HOUR DEPENDS ON mv TO summary AS SELECT * FROM dest',
                loading_dependencies_database: ['db'],
                loading_dependencies_table: ['dest'],
            },
        ],
        [],
    );
    assert.deepEqual(snapshot.edges.map(edge => edge.kind).sort(), [
        'catalog-dependency',
        'insert-trigger',
        'refresh-dependency',
        'writes-to',
        'writes-to',
    ]);
    assert.equal(
        snapshot.edges.some(
            edge =>
                edge.source === tableReferenceId('db', 'dest') &&
                edge.target === tableReferenceId('db', 'mv'),
        ),
        false,
    );
    assert.notEqual(tableReferenceId('a.b', 'c'), tableReferenceId('a', 'b.c'));
});
test('Malformed dependency pairs cannot shift indexes and invent edges', () => {
    const snapshot = buildMaterializedViewLineage(
        'db',
        [
            {
                database: 'db',
                name: 'source',
                engine: 'MergeTree',
                dependencies_database: [null, 'db'],
                dependencies_table: ['wrong', 'correct'],
            },
        ],
        [],
    );
    assert.equal(snapshot.edges.length, 1);
    assert.equal(snapshot.edges[0].target, tableReferenceId('db', 'correct'));
});
test('Cyclic dependency graphs remain bounded and visible', () => {
    const nodes = ['a', 'b'].map(id => ({
        id,
        database: 'db',
        table: id,
        engine: '',
        kind: 'table',
    }));
    const result = layoutLineage(nodes, [
        { source: 'a', target: 'b', kind: 'catalog-dependency' },
        { source: 'b', target: 'a', kind: 'catalog-dependency' },
    ]);
    assert.equal(result.hasCycle, true);
    assert.equal(result.nodes.length, 2);
    assert.equal(Number.isFinite(result.width), true);
    assert.equal(layoutLineage([], []).hasCycle, false);
});
test('Metadata queries are bounded, parameterized, and old-version compatible', () => {
    for (const query of [mergeActivityQuery(), mutationActivityQuery()]) {
        assert.match(query, /database = \{database:String\}/);
        assert.match(query, /table = \{table:String\}/);
        assert.match(query, /LIMIT 51/);
    }
    const old = lineageTablesQuery(new Set());
    assert.match(old, /'' AS target_table/);
    assert.match(old, /LIMIT 251/);
    assert.match(old, /lengthUTF8\(t.create_table_query\)/);
    const modern = lineageTablesQuery(
        new Set([
            'target_table',
            'target_database',
            'loading_dependencies_table',
            'loading_dependencies_database',
        ]),
    );
    assert.match(modern, /arraySlice\(t.loading_dependencies_table/);
});
test('Lineage degrades optional refresh telemetry but not required metadata errors', async () => {
    const calls = [];
    const result = await loadNativeExplorer(
        { kind: 'lineage', database: "db' OR 1=1 --" },
        async (sql, parameters) => {
            calls.push({ sql, parameters });
            if (sql.includes('view_refreshes')) throw new Error('denied');
            if (sql.includes('system.columns')) return [];
            return [{ database: 'db', name: 'mv', engine: 'MaterializedView' }];
        },
    );
    assert.equal(result.kind, 'lineage');
    assert.match(result.notes.join(' '), /Refresh telemetry is unavailable/);
    assert.equal(
        calls.some(call => call.sql.includes("db' OR")),
        false,
    );
    assert.equal(calls[1].parameters.database, "db' OR 1=1 --");
    await assert.rejects(
        loadNativeExplorer({ kind: 'merges', database: 'db', table: 't' }, async () => {
            throw new Error('denied');
        }),
        /denied/,
    );
});
test('Cancellation is never presented as missing optional telemetry', async () => {
    const controller = new AbortController();
    await assert.rejects(
        loadNativeExplorer(
            { kind: 'lineage', database: 'db' },
            async () => {
                controller.abort();
                throw new Error('aborted');
            },
            controller.signal,
        ),
        { name: 'AbortError' },
    );
});
test('Merges retain exact counters and explicitly cap activity and source parts', () => {
    const row = {
        result_part_name: 'out',
        progress: 0.67,
        bytes_read_uncompressed: '18446744073709551615',
        source_part_names: Array.from({ length: 70 }, (_, index) => String(index)),
        source_parts_truncated: 1,
    };
    const snapshot = parseMergeActivity(
        'db',
        't',
        Array.from({ length: 51 }, () => row),
    );
    assert.equal(snapshot.items.length, 50);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.items[0].sourceParts.length, 64);
    assert.equal(snapshot.items[0].bytesRead, '18446744073709551615');
});
test('Mutation zero remaining does not mean finished or provide a percentage', () => {
    const pending = parseMutationActivity('db', 't', [
        { mutation_id: 'x', parts_to_do: '0', is_done: 0 },
    ]).items[0];
    assert.equal(mutationStatus(pending), 'Waiting for completion');
    assert.equal('progress' in pending, false);
    assert.equal(
        mutationStatus({ ...pending, done: true, latestFailure: 'old error' }),
        'Completed',
    );
    assert.equal(mutationStatus({ ...pending, done: undefined }), 'Completion unknown');
});
test('Fixtures are explicitly labelled and never generated for arbitrary live objects', () => {
    for (const kind of ['lineage', 'merges', 'mutations'])
        assert.equal(
            nativeExplorerFixture({ kind, database: 'demo', table: 'events' }).source,
            'fixture',
        );
    assert.throws(() => nativeExplorerFixture({ kind: 'lineage', database: 'production' }));
});

test('Older refresh schemas retain timestamps without inventing missing durations', () => {
    const old = refreshActivityQuery(
        new Set(['last_success_time', 'last_refresh_time', 'next_refresh_time']),
    );
    assert.match(old, /toString\(r.last_success_time, 'UTC'\)/);
    assert.match(old, /NULL AS last_success_duration_ms/);
    assert.match(old, /NULL AS progress/);
    assert.match(old, /LIMIT 251/);
    const modern = refreshActivityQuery(
        new Set(['last_success_duration_ms', 'progress', 'read_rows']),
    );
    assert.match(modern, /toString\(r.last_success_duration_ms\)/);
    assert.match(modern, /r.progress AS progress/);
});
