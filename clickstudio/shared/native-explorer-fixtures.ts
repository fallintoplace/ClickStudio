import { buildMaterializedViewLineage } from './materialized-view-lineage.js';
import { parseMergeActivity, parseMutationActivity } from './storage-activity.js';
import type { NativeExplorerRequest, NativeExplorerSnapshot } from './native-explorers.js';

/** Static, explicitly labelled examples; never a fallback for live metadata. */
export function nativeExplorerFixture(request: NativeExplorerRequest): NativeExplorerSnapshot {
    if (request.database !== 'demo' || (request.kind !== 'lineage' && request.table !== 'events'))
        throw new Error('This object has no sample metadata. Select demo.events.');
    const now = '2026-09-25T21:32:00.000Z';
    let snapshot: NativeExplorerSnapshot;
    if (request.kind === 'lineage')
        snapshot = buildMaterializedViewLineage(
            'demo',
            [
                {
                    database: 'demo',
                    name: 'events',
                    engine: 'MergeTree',
                    dependencies_database: ['demo'],
                    dependencies_table: ['daily_events_mv'],
                },
                {
                    database: 'demo',
                    name: 'daily_events_mv',
                    engine: 'MaterializedView',
                    target_database: 'demo',
                    target_table: 'daily_events',
                    create_table_query:
                        'CREATE MATERIALIZED VIEW demo.daily_events_mv TO demo.daily_events AS SELECT toDate(timestamp) AS day, count() AS events FROM demo.events GROUP BY day',
                },
                { database: 'demo', name: 'daily_events', engine: 'SummingMergeTree' },
                {
                    database: 'demo',
                    name: 'monthly_report_mv',
                    engine: 'MaterializedView',
                    target_database: 'demo',
                    target_table: 'monthly_report',
                    loading_dependencies_database: ['demo', 'demo'],
                    loading_dependencies_table: ['daily_events', 'monthly_report'],
                    create_table_query:
                        'CREATE MATERIALIZED VIEW demo.monthly_report_mv REFRESH EVERY 10 MINUTE TO demo.monthly_report AS SELECT toStartOfMonth(day) AS month, sum(events) AS events FROM demo.daily_events GROUP BY month',
                },
                { database: 'demo', name: 'monthly_report', engine: 'MergeTree' },
            ],
            [
                {
                    database: 'demo',
                    view: 'monthly_report_mv',
                    status: 'Scheduled',
                    last_success_time: '2026-09-25 21:30:00',
                    last_success_duration_ms: '8400',
                    last_refresh_time: '2026-09-25 21:30:00',
                    next_refresh_time: '2026-09-25 21:40:00',
                    read_rows: '1800000',
                    written_rows: '12',
                    progress: null,
                },
            ],
            ['Sample dependency graph. Catalog dependencies are distinct from insert triggers.'],
            now,
        );
    else if (request.kind === 'merges')
        snapshot = parseMergeActivity(
            'demo',
            'events',
            [
                {
                    result_part_name: '202609_101_105_1',
                    source_part_names: [
                        '202609_101_101_0',
                        '202609_102_102_0',
                        '202609_103_103_0',
                        '202609_104_104_0',
                        '202609_105_105_0',
                    ],
                    progress: 0.67,
                    elapsed: 12.4,
                    bytes_read_uncompressed: '12884901888',
                    bytes_written_uncompressed: '8589934592',
                    memory_usage: '268435456',
                    is_mutation: 0,
                },
            ],
            now,
        );
    else
        snapshot = parseMutationActivity(
            'demo',
            'events',
            [
                {
                    mutation_id: 'mutation_58.txt',
                    command: "UPDATE status = 'processed' WHERE status = 'pending'",
                    create_time: '2026-09-25 21:31:22',
                    parts_to_do: '11',
                    is_done: 0,
                },
                {
                    mutation_id: 'mutation_57.txt',
                    command: 'MATERIALIZE COLUMN normalized_status',
                    create_time: '2026-09-25 21:29:00',
                    parts_to_do: '2',
                    is_done: 0,
                    latest_fail_reason: 'Sample: memory limit reached on the last attempt',
                    latest_fail_time: '2026-09-25 21:31:05',
                    latest_failed_part: '202609_90_100_2',
                },
                {
                    mutation_id: 'mutation_56.txt',
                    command: 'DELETE WHERE expired = 1',
                    create_time: '2026-09-25 20:00:00',
                    parts_to_do: '0',
                    is_done: 1,
                },
            ],
            now,
        );
    return {
        ...snapshot,
        source: 'fixture',
        notes: ['Static sample data, not live server activity.', ...snapshot.notes],
    };
}
