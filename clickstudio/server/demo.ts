import { nativeExplorerFixture } from '../shared/native-explorer-fixtures.js';
import type { NativeExplorerRequest } from '../shared/native-explorers.js';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ClickHouseDocumentationEntry, ClickHouseDocumentationSummary, Connection, Principal, Progress, ReferenceCategory, Run, Schema } from '../shared/types.js';
import { DEFAULT_LIMITS } from '../shared/types.js';
import { parseMergeTreeParts, type MergeTreePartsSnapshot } from '../shared/parts.js';
import { demoFlamegraph, demoReplication, demoWorkload } from '../shared/observability-fixtures.js';
import type { WorkloadWindow } from '../shared/workload.js';
import { DEMO_EXPLAIN_ANALYZE, demoMergeTreePartRows } from '../shared/demo-fixtures.js';
import { AppError } from '../core/errors.js';
import type { CreateTableColumn } from '../core/table-creation.js';

const demoIndexAnalysis = [
    'ReadFromMergeTree (demo.events)',
    '  Indexes:',
    '    MinMax',
    '      Keys:',
    '        day',
    "      Condition: (day in ['2026-01-01', '2026-01-08'])",
    '      Parts: 8/58',
    '      Granules: 46/612',
    '    Partition',
    '      Keys:',
    '        toYYYYMM(day)',
    "      Condition: (toYYYYMM(day) = 202601)",
    '      Parts: 4/8',
    '      Granules: 46/360',
    '    PrimaryKey',
    '      Keys:',
    '        tenant_id',
    '        day',
    '      Condition: (tenant_id = 42)',
    '      Parts: 4/4',
    '      Granules: 12/46',
    '    Skip',
    '      Name: tenant_bloom',
    '      Description: bloom filter on tenant_id',
    '      Parts: 1/4',
    '      Granules: 4/12',
];

/** Explicit UI/test fixtures, not a SQL emulator and never an automatic fallback for a real database. */
export class DemoDriver {
    connection(_p: Principal, id: string): Connection { if (!['demo', 'demo-second'].includes(id))
        throw new AppError(404, 'CONNECTION_NOT_FOUND', 'Fixture connection not found'); const yes = { available: true }; return { dataSource: 'fixture', id, name: id === 'demo' ? 'Demo fixtures (not live data)' : 'Second isolated fixture', host: 'fixture://local', database: 'demo', username: 'fixture-reader', readonly: true, limits: { ...DEFAULT_LIMITS }, manifest: { version: 1, serverVersion: 'fixture—not a ClickHouse server', testedAt: new Date().toISOString(), schema: yes, progress: yes, cancellation: yes, explain: yes, explainPlan: yes, explainAnalyze: yes, queryTree: yes, pipeline: yes, queryLog: yes, queryLogSource: 'query_log', traceLog: yes, replication: yes, documentation: { available: false, reason: 'Fixture mode' }, import: { available: false, reason: 'Fixture mode never writes data' }, scripts: yes, parameters: yes } }; }
    connections(p: Principal) { return ['demo', 'demo-second'].map(id => this.connection(p, id)); }
    async test(id: string) { return this.connection({ id: 'local-owner', role: 'owner' }, id); }
    async schema(id: string): Promise<Schema> {
        this.connection({ id: 'local-owner', role: 'owner' }, id);
        return {
            connectionId: id,
            fetchedAt: new Date().toISOString(),
            tables: [
                { database: 'demo', name: 'events', engine: 'MergeTree', orderBy: '(tenant_id, day)', primaryKey: 'tenant_id, day', partitionKey: 'toYYYYMM(day)', samplingKey: 'tenant_id', ttlConfigured: true, rowEstimate: '2840000000', sizeBytes: '442381631488', uncompressedBytes: '1724663015424', parts: '58', activeParts: '52', skipIndexTypes: ['bloom_filter', 'minmax'], projections: [{ name: 'by_tenant_day', type: 'Normal', sortingKey: 'tenant_id, day' }, { name: 'daily_revenue', type: 'Aggregate', sortingKey: 'day' }], skipIndexes: [{ name: 'tenant_bloom', type: 'bloom_filter', expression: 'tenant_id', granularity: '4' }, { name: 'event_type_minmax', type: 'minmax', expression: 'event_type', granularity: '1' }] },
                { database: 'demo', name: 'daily_rollup', engine: 'MaterializedView', materializedViewTarget: 'demo.daily_metrics', rowEstimate: null, sizeBytes: null, uncompressedBytes: null, parts: null, activeParts: null, projections: [], skipIndexes: [] },
            ],
            columns: [
                { database: 'demo', table: 'events', name: 'tenant_id', type: 'UInt64', comment: 'Fixture tenant identifier', defaultKind: '' },
                { database: 'demo', table: 'events', name: 'day', type: 'DateTime', comment: 'Fixture event timestamp', defaultKind: '' },
                { database: 'demo', table: 'events', name: 'event_type', type: 'LowCardinality(String)', comment: 'Fixture event category', defaultKind: '' },
                { database: 'demo', table: 'events', name: 'revenue', type: 'Decimal(18, 2)', comment: 'Fixture revenue', defaultKind: '' },
                { database: 'demo', table: 'daily_rollup', name: 'day', type: 'Date', comment: 'Fixture date bucket', defaultKind: '' },
                { database: 'demo', table: 'daily_rollup', name: 'events', type: 'UInt64', comment: 'Fixture daily count', defaultKind: '' },
            ],
            dictionaries: [{ database: 'demo', name: 'campaign_lookup', status: 'LOADED', type: 'Hashed', keyColumns: 'campaign_id UInt64', attributeColumns: 'campaign_name String, channel String', elementCount: '18240', memoryBytes: '5242880', lastSuccessfulUpdate: '2026-09-23 08:15:00' }],
            truncated: false,
            warnings: ['These are deterministic fixtures, not live database results.'],
        };
    }
    async searchDocumentation(id: string, _query: string, _category: ReferenceCategory): Promise<ClickHouseDocumentationSummary[]> {
        this.connection({ id: 'local-owner', role: 'owner' }, id);
        return [];
    }
    async documentationEntry(id: string, _name: string, _type: string): Promise<ClickHouseDocumentationEntry | undefined> {
        this.connection({ id: 'local-owner', role: 'owner' }, id);
        return undefined;
    }
    async execute(run: Run, signal: AbortSignal, progress: (p: Progress) => void) {
        if (/fixture_error/i.test(run.sql))
            throw new AppError(400, 'FIXTURE_ERROR', 'Deliberate fixture error; the draft is preserved');
        for (let i = 0; i < 5; i++) {
            await sleep(/fixture_slow/i.test(run.sql) ? 400 : 35, undefined, { signal });
            progress({ readRows: String(i * 20), readBytes: String(i * 160), elapsedMs: i * 35 });
        }
        if (run.kind === 'plan')
            return { columns: [{ name: 'explain', type: 'String' }], rows: [[JSON.stringify([{ Plan: { 'Node Type': 'Expression', 'Node Id': 'Expression_2', Description: 'Fixture only; the SQL was not evaluated.', Plans: [{ 'Node Type': 'ReadFromFixture', 'Node Id': 'ReadFromFixture_0' }] } }])]], truncated: false };
        if (run.kind === 'pipeline')
            return { columns: [{ name: 'explain', type: 'String' }], rows: ['digraph {', '  read [label="ReadFromFixture"];', '  filter [label="FilterTransform × 2"];', '  output [label="Output"];', '  read -> filter;', '  filter -> output;', '}'].map(line => [line]), truncated: false };
        if (run.kind === 'analyze')
            return { columns: [{ name: 'explain', type: 'String' }], rows: [[DEMO_EXPLAIN_ANALYZE]], truncated: false, warnings: ['DEMO FIXTURE: this is a sample runtime profile and does not evaluate the supplied SQL.'] };
        if (run.kind === 'explain')
            return { columns: [{ name: 'explain', type: 'String' }], rows: demoIndexAnalysis.map(line => [line]), truncated: false };
        return { columns: [{ name: 'day', type: 'Date' }, { name: 'events', type: 'UInt64' }], rows: Array.from({ length: 7 }, (_, i) => [`2026-01-${String(i + 1).padStart(2, '0')}`, String((i + 1) * 10)]), truncated: false, warnings: ['DEMO FIXTURE: this does not evaluate the supplied SQL.'] };
    }
    async cancel(_run: Run) { }
    async close() { }
    async targets(_id: string) { return []; }
    allowed(_id: string, _table: string) { return false; }
    database(id: string) { this.connection({ id: 'local-owner', role: 'owner' }, id); return 'demo'; }
    async createTable(_id: string, _table: string, _columns: CreateTableColumn[], _orderBy: string, _queryId: string) { throw new AppError(403, 'DEMO_READ_ONLY', 'Fixture mode never creates tables'); }
    async insert() { throw new AppError(403, 'DEMO_READ_ONLY', 'Fixture mode never inserts'); }
    async inspectInsert() { return 'unknown' as const; }
    async queryTree(id: string) {
        this.connection({ id: 'local-owner', role: 'owner' }, id);
        return [
            'QUERY id: 0',
            '  PROJECTION COLUMNS',
            '    event_type LowCardinality(String)',
            '    events UInt64',
            '  PROJECTION',
            '    LIST id: 1, nodes: 2',
            '      COLUMN id: 2, column_name: event_type, result_type: LowCardinality(String), source_id: 5',
            '      FUNCTION id: 3, function_name: count, function_type: aggregate, result_type: UInt64',
            '  JOIN TREE',
            '    TABLE id: 5, table_name: demo.events',
        ];
    }
    async nativeExplorer(id: string, request: NativeExplorerRequest, signal?: AbortSignal) {
        this.connection({ id: 'local-owner', role: 'owner' }, id);
        signal?.throwIfAborted();
        return nativeExplorerFixture(request);
    }
    async tableParts(id: string, database: string, table: string): Promise<MergeTreePartsSnapshot> {
        this.connection({ id: 'local-owner', role: 'owner' }, id);
        if (database !== 'demo' || table !== 'events') throw new AppError(404, 'TABLE_NOT_FOUND', 'The selected table is not available in this sample.');
        return parseMergeTreeParts(database, table, demoMergeTreePartRows());
    }
    async profileEvidence(_run: Run) { return [{ notice: 'Fixture mode has no real server profile' }]; }
    async profilePipeline(_run: Run) { return ['digraph {', '  node [shape=box];', '  read [label="ReadFromFixture"];', '  filter [label="FilterTransform × 2"];', '  expression [label="ExpressionTransform × 2"];', '  resize [label="Resize 2 → 1"];', '  output [label="Output"];', '  read -> filter [label="× 2"];', '  filter -> expression [label="× 2"];', '  expression -> resize;', '  resize -> output;', '}']; }
    async profileFlamegraph(run: Run) { return demoFlamegraph(run.queryId); }
    async workload(id: string, minutes: WorkloadWindow) { this.connection({ id: 'local-owner', role: 'owner' }, id); return demoWorkload(id, minutes); }
    async replication(id: string) { this.connection({ id: 'local-owner', role: 'owner' }, id); return demoReplication(id); }
}
