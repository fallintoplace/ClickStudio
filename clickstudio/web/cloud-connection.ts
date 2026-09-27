import { DEFAULT_LIMITS, type Column, type Connection, type Row, type Schema } from '../shared/types.js';

export const CLICKHOUSE_CLOUD_CONNECTION_ID = 'clickhouse-cloud';

export type CloudCredentials = { host: string; database: string; username: string; password: string };
export type CloudQueryResult = { queryId: string; columns: Column[]; rows: Row[]; elapsedMs: number; bytes: number; truncated: boolean };
type CloudConnectionState = { credentials: CloudCredentials; connection: Connection & { trusted: boolean } };

let activeCloud: CloudConnectionState | undefined;

export class CloudRequestError extends Error {
    constructor(public readonly code: string, message: string, public readonly status: number) {
        super(message);
        this.name = 'CloudRequestError';
    }
}

async function requestCloud<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch('/api/cloud', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const root = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
        const detail = typeof root.error === 'object' && root.error !== null ? root.error as Record<string, unknown> : {};
        throw new CloudRequestError(
            typeof detail.code === 'string' ? detail.code : 'CLOUD_REQUEST',
            typeof detail.message === 'string' ? detail.message : `ClickHouse Cloud returned HTTP ${response.status}.`,
            response.status,
        );
    }
    return payload as T;
}

function capability(available: boolean, reason?: string) {
    return { available, ...(reason ? { reason } : {}) };
}

function makeConnection(credentials: CloudCredentials, host: string, serverVersion: string): Connection & { trusted: boolean } {
    const available = capability(true);
    const unavailable = capability(false, 'This hosted Cloud connection does not provide this feature yet.');
    return {
        dataSource: 'clickhouse',
        id: CLICKHOUSE_CLOUD_CONNECTION_ID,
        name: 'ClickHouse Cloud',
        host,
        database: credentials.database,
        username: credentials.username,
        readonly: false,
        trusted: true,
        limits: { ...DEFAULT_LIMITS, rows: 1_000, bytes: 2_000_000, seconds: 45, threads: 4 },
        manifest: {
            version: 1,
            serverVersion,
            testedAt: new Date().toISOString(),
            schema: available,
            progress: unavailable,
            cancellation: unavailable,
            explain: available,
            explainPlan: available,
            explainAnalyze: available,
            queryTree: unavailable,
            explainPipeline: unavailable,
            pipeline: unavailable,
            queryLog: unavailable,
            traceLog: unavailable,
            replication: unavailable,
            documentation: unavailable,
            import: unavailable,
            scripts: capability(false, 'Run one SQL statement at a time in the hosted Cloud connection.'),
            parameters: unavailable,
        },
    };
}

export async function connectClickHouseCloud(credentials: CloudCredentials) {
    const tested = await requestCloud<{ host: string; database: string; username: string; serverVersion: string }>({ action: 'test', credentials });
    const connection = makeConnection(credentials, tested.host, tested.serverVersion);
    activeCloud = { credentials: { ...credentials }, connection };
    return connection;
}

export function getClickHouseCloudConnection() {
    return activeCloud?.connection;
}

export function disconnectClickHouseCloud() {
    activeCloud = undefined;
}

export async function runClickHouseCloudSql(sql: string): Promise<CloudQueryResult> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before running SQL.', 401);
    return await requestCloud<CloudQueryResult>({ action: 'run', credentials: activeCloud.credentials, sql });
}

export async function loadClickHouseCloudSchema(): Promise<Schema> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before loading its schema.', 401);
    return await requestCloud<Schema>({ action: 'schema', credentials: activeCloud.credentials });
}
