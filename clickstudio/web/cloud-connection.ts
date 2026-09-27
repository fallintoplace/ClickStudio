import { DEFAULT_LIMITS, type Capability, type Column, type Connection, type Row, type Schema } from '../shared/types.js';
import type { ReplicationSnapshot } from '../shared/replication.js';
import type { QueryLogSource, WorkloadSnapshot, WorkloadWindow } from '../shared/workload.js';

export const CLICKHOUSE_CLOUD_CONNECTION_ID = 'clickhouse-cloud';

export type CloudCredentials = { host: string; database: string; username: string; password: string };
export type SavedCloudConnectionProfile = Pick<CloudCredentials, 'host' | 'database' | 'username'>;
export type CloudQueryResult = { queryId: string; columns: Column[]; rows: Row[]; elapsedMs: number; bytes: number; truncated: boolean };
type CloudConnectionState = { credentials: CloudCredentials; connection: Connection & { trusted: boolean } };

const CLOUD_PROFILE_STORAGE_KEY = 'clickstudio:cloud-connection-profile:v1';
let activeCloud: CloudConnectionState | undefined;

export function loadSavedCloudConnectionProfile(): SavedCloudConnectionProfile | undefined {
    try {
        const value: unknown = JSON.parse(window.localStorage.getItem(CLOUD_PROFILE_STORAGE_KEY) ?? 'null');
        if (typeof value !== 'object' || value === null) return undefined;
        const profile = value as Record<string, unknown>;
        if (typeof profile.host !== 'string' || typeof profile.database !== 'string' || typeof profile.username !== 'string') return undefined;
        return { host: profile.host, database: profile.database, username: profile.username };
    } catch {
        return undefined;
    }
}

export function saveCloudConnectionProfile(profile: SavedCloudConnectionProfile) {
    try { window.localStorage.setItem(CLOUD_PROFILE_STORAGE_KEY, JSON.stringify(profile)); } catch { }
}

export class CloudRequestError extends Error {
    constructor(public readonly code: string, message: string, public readonly status: number) {
        super(message);
        this.name = 'CloudRequestError';
    }
}

async function requestCloud<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetch('/api/cloud', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
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

type CloudConnectionTest = {
    host: string;
    database: string;
    username: string;
    serverVersion: string;
    queryLog: Capability;
    queryLogSource?: QueryLogSource;
    replication: Capability;
};

function makeConnection(credentials: CloudCredentials, tested: CloudConnectionTest): Connection & { trusted: boolean } {
    const available = capability(true);
    const unavailable = capability(false, 'This hosted Cloud connection does not provide this feature yet.');
    return {
        dataSource: 'clickhouse',
        id: CLICKHOUSE_CLOUD_CONNECTION_ID,
        name: 'ClickHouse Cloud',
        host: tested.host,
        database: credentials.database,
        username: credentials.username,
        readonly: false,
        trusted: true,
        limits: { ...DEFAULT_LIMITS, rows: 1_000, bytes: 2_000_000, seconds: 45, threads: 4 },
        manifest: {
            version: 1,
            serverVersion: tested.serverVersion,
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
            queryLog: tested.queryLog,
            ...(tested.queryLogSource ? { queryLogSource: tested.queryLogSource } : {}),
            traceLog: unavailable,
            replication: tested.replication,
            documentation: unavailable,
            import: unavailable,
            scripts: capability(true),
            parameters: unavailable,
        },
    };
}

export async function connectClickHouseCloud(credentials: CloudCredentials) {
    const tested = await requestCloud<CloudConnectionTest>({ action: 'test', credentials });
    const connection = makeConnection(credentials, tested);
    activeCloud = { credentials: { ...credentials }, connection };
    return connection;
}

export function getClickHouseCloudConnection() {
    return activeCloud?.connection;
}

export function disconnectClickHouseCloud() {
    activeCloud = undefined;
}

export async function runClickHouseCloudSql(sql: string, sessionId?: string): Promise<CloudQueryResult> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before running SQL.', 401);
    return await requestCloud<CloudQueryResult>({ action: 'run', credentials: activeCloud.credentials, sql, ...(sessionId ? { sessionId } : {}) });
}

export async function loadClickHouseCloudSchema(): Promise<Schema> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before loading its schema.', 401);
    return await requestCloud<Schema>({ action: 'schema', credentials: activeCloud.credentials });
}

export async function loadClickHouseCloudWorkload(minutes: WorkloadWindow, signal: AbortSignal): Promise<WorkloadSnapshot> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before loading workload history.', 401);
    const source = activeCloud.connection.manifest?.queryLogSource;
    if (!source) throw new CloudRequestError('QUERY_LOG_UNAVAILABLE', 'Test the connection to check query-log access.', 409);
    return await requestCloud<WorkloadSnapshot>({ action: 'workload', credentials: activeCloud.credentials, minutes, source }, signal);
}

export async function loadClickHouseCloudReplication(signal: AbortSignal): Promise<ReplicationSnapshot> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before loading replication status.', 401);
    return await requestCloud<ReplicationSnapshot>({ action: 'replication', credentials: activeCloud.credentials }, signal);
}
