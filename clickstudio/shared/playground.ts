import { DEFAULT_LIMITS, type Connection } from './types.js';

const capability = (available: boolean, reason?: string) => ({
    available,
    ...(reason ? { reason } : {}),
});

export const PLAYGROUND_CONNECTION_ID = 'playground';
export const PLAYGROUND_URL = 'https://sql-clickhouse.clickhouse.com:8443/';
export const PLAYGROUND_CONNECTION: Connection & { trusted: boolean } = {
    dataSource: 'clickhouse',
    id: PLAYGROUND_CONNECTION_ID,
    name: 'ClickHouse Playground',
    host: 'sql-clickhouse.clickhouse.com:8443',
    database: 'github',
    username: 'demo',
    readonly: true,
    trusted: true,
    limits: { ...DEFAULT_LIMITS, rows: 1000, seconds: 60 },
    manifest: {
        version: 1,
        serverVersion: 'ClickHouse SQL Playground',
        testedAt: new Date(0).toISOString(),
        schema: capability(true),
        progress: capability(
            false,
            'The public Playground does not expose query progress to this browser connection.',
        ),
        cancellation: capability(
            false,
            'Closing the request cannot confirm that ClickHouse stopped the query.',
        ),
        explain: capability(true),
        explainPlan: capability(true),
        explainAnalyze: capability(true),
        queryTree: capability(true),
        explainPipeline: capability(true),
        pipeline: capability(
            false,
            'The public Playground returns pipeline text, but structured pipeline profiling is unavailable in this connection.',
        ),
        queryLog: capability(
            false,
            'Query-log profiling is not enabled on the public Playground connection.',
        ),
        traceLog: capability(
            false,
            'Trace-log profiling is not enabled on the public Playground connection.',
        ),
        replication: capability(
            false,
            'Replication system-table access is not enabled on the public Playground connection.',
        ),
        documentation: capability(
            false,
            'System-table documentation is not enabled on this connection.',
        ),
        import: capability(false, 'The public Playground connection is read only.'),
        scripts: capability(
            false,
            'The public Playground accepts one read-only statement per request.',
        ),
        parameters: capability(
            false,
            'Query parameters are not enabled on the public Playground connection.',
        ),
    },
};
