import { DEFAULT_LIMITS, type Capability, type ClickHouseDocumentationEntry, type ClickHouseDocumentationSummary, type Column, type Connection, type Row, type Schema, type SchemaColumn } from '../shared/types.js';
import type { ReplicationSnapshot } from '../shared/replication.js';
import type { QueryLogSource, WorkloadSnapshot, WorkloadWindow } from '../shared/workload.js';
import type { FlamegraphSnapshot, FlamegraphSource } from '../shared/flamegraph.js';
import type { CloudImportColumn } from './cloud-import.js';
import type { CreateTableColumn } from '../shared/table-creation.js';
import type { NativeExplorerRequest, NativeExplorerSnapshot } from '../shared/native-explorers.js';
import type { MergeTreePartsSnapshot } from '../shared/parts.js';

export const CLICKHOUSE_CLOUD_CONNECTION_ID = 'clickhouse-cloud';

export type CloudCredentials = { host: string; database: string; username: string; password: string };
export type SavedCloudConnectionProfile = Pick<CloudCredentials, 'host' | 'database' | 'username'>;
export type CloudQueryResult = { queryId: string; columns: Column[]; rows: Row[]; elapsedMs: number; bytes: number; truncated: boolean; writtenRows?: number };
export type CloudImportJob = { id: string; connectionId: string; table: string; queryId: string; rows: number; createdAt: string; status: 'running' | 'succeeded' | 'unknown'; error?: string; reviewedAt?: string; reconciliationRequired?: boolean; tableCreated?: boolean; tableExists?: boolean };
export type CloudImportInput = {
    file: File;
    format: 'csv' | 'json' | 'ndjson';
    target: string;
    fields: Record<string, string>;
    queryId: string;
    expectedColumns?: Pick<SchemaColumn, 'name' | 'type' | 'defaultKind'>[];
    createTable?: { database: string; name: string; columns: CloudImportColumn[]; generateId?: boolean };
};
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
        headers: { 'Content-Type': 'application/json', 'X-ClickStudio-Intent': '1' },
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

async function requestCloudImport<T>(form: FormData): Promise<T> {
    const response = await fetch('/api/cloud', { method: 'POST', credentials: 'same-origin', headers: { 'X-ClickStudio-Intent': '1' }, body: form });
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

export type CloudConnectionTest = {
    host: string;
    database: string;
    username: string;
    serverVersion: string;
    queryLog: Capability;
    queryLogSource?: QueryLogSource;
    replication: Capability;
    progress: Capability;
    cancellation: Capability;
    explain: Capability;
    explainPlan: Capability;
    explainAnalyze: Capability;
    queryTree: Capability;
    explainPipeline: Capability;
    pipeline: Capability;
    traceLog: Capability;
    traceLogSource?: FlamegraphSource;
    documentation: Capability;
    parameters: Capability;
};

function makeConnection(credentials: CloudCredentials, tested: CloudConnectionTest): Connection & { trusted: boolean } {
    const available = capability(true);
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
            progress: tested.progress,
            cancellation: tested.cancellation,
            explain: tested.explain,
            explainPlan: tested.explainPlan,
            explainAnalyze: tested.explainAnalyze,
            queryTree: tested.queryTree,
            explainPipeline: tested.explainPipeline,
            pipeline: tested.pipeline,
            queryLog: tested.queryLog,
            ...(tested.queryLogSource ? { queryLogSource: tested.queryLogSource } : {}),
            traceLog: tested.traceLog,
            ...(tested.traceLogSource ? { traceLogSource: tested.traceLogSource } : {}),
            replication: tested.replication,
            documentation: tested.documentation,
            import: available,
            scripts: capability(true),
            parameters: tested.parameters,
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

export async function runClickHouseCloudSql(sql: string, sessionId?: string, options: { queryId?: string; parameters?: Record<string, string> } = {}): Promise<CloudQueryResult> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before running SQL.', 401);
    return await requestCloud<CloudQueryResult>({ action: 'run', credentials: activeCloud.credentials, sql, ...(sessionId ? { sessionId } : {}), ...options });
}

export async function loadClickHouseCloudSchema(offsets: { databaseOffset?: number; tableOffset?: number; columnOffset?: number } = {}): Promise<Schema> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before loading its schema.', 401);
    return await requestCloud<Schema>({ action: 'schema', credentials: activeCloud.credentials, ...offsets });
}

export async function loadClickHouseCloudQueryTree(sql: string, parameters: Record<string, string>, signal?: AbortSignal): Promise<string[]> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before analyzing SQL.', 401);
    return await requestCloud<string[]>({ action: 'query-tree', credentials: activeCloud.credentials, sql, parameters }, signal);
}

export async function loadClickHouseCloudProgress(queryId: string, signal?: AbortSignal) {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud to load query progress.', 401);
    const response = await requestCloud<{ progress?: { readRows: string; readBytes: string; elapsedMs: number; memory?: string } }>({ action: 'progress', credentials: activeCloud.credentials, queryId }, signal);
    return response.progress;
}

export async function cancelClickHouseCloudQuery(queryId: string, signal?: AbortSignal) {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before stopping SQL.', 401);
    return await requestCloud<{ cancelled: boolean; queryId: string }>({ action: 'cancel', credentials: activeCloud.credentials, queryId }, signal);
}

export async function loadClickHouseCloudProfileEvidence(queryId: string, signal?: AbortSignal) {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before loading query history.', 401);
    const source = activeCloud.connection.manifest?.queryLogSource;
    if (!source) throw new CloudRequestError('QUERY_LOG_UNAVAILABLE', 'Test the connection to check query-log access.', 409);
    return await requestCloud<Record<string, unknown>[]>({ action: 'profile', credentials: activeCloud.credentials, queryId, source }, signal);
}

export async function loadClickHouseCloudPipeline(sql: string, parameters: Record<string, string>, signal?: AbortSignal) {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before loading pipeline details.', 401);
    return await requestCloud<string[]>({ action: 'pipeline', credentials: activeCloud.credentials, sql, parameters }, signal);
}

export async function loadClickHouseCloudFlamegraph(queryId: string, createdAt: string, finishedAt: string | undefined, signal?: AbortSignal): Promise<FlamegraphSnapshot> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before loading profiler samples.', 401);
    const source = activeCloud.connection.manifest?.traceLogSource;
    if (!source) throw new CloudRequestError('TRACE_UNAVAILABLE', 'Test the connection to check trace-log access.', 409);
    const asDate = (value: string) => {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    };
    return await requestCloud<FlamegraphSnapshot>({ action: 'flamegraph', credentials: activeCloud.credentials, queryId, startDate: asDate(createdAt), endDate: asDate(finishedAt ?? createdAt), source }, signal);
}

export async function searchClickHouseCloudDocumentation(query: string, category: string, signal?: AbortSignal) {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before searching reference docs.', 401);
    return await requestCloud<ClickHouseDocumentationSummary[]>({ action: 'documentation-search', credentials: activeCloud.credentials, query, category }, signal);
}

export async function loadClickHouseCloudDocumentationEntry(name: string, type: string, signal?: AbortSignal) {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before opening reference docs.', 401);
    return await requestCloud<ClickHouseDocumentationEntry | undefined>({ action: 'documentation-entry', credentials: activeCloud.credentials, name, type, serverVersion: activeCloud.connection.manifest?.serverVersion }, signal);
}

export async function loadClickHouseCloudNativeExplorer(request: NativeExplorerRequest, signal: AbortSignal): Promise<NativeExplorerSnapshot> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before inspecting metadata.', 401);
    return await requestCloud<NativeExplorerSnapshot>({ action: 'native-explorer', credentials: activeCloud.credentials, ...request }, signal);
}

export async function loadClickHouseCloudTableParts(database: string, table: string, signal: AbortSignal): Promise<MergeTreePartsSnapshot> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before inspecting storage.', 401);
    return await requestCloud<MergeTreePartsSnapshot>({ action: 'table-parts', credentials: activeCloud.credentials, database, table }, signal);
}

export async function createClickHouseCloudTable(input: { database: string; name: string; columns: CreateTableColumn[]; orderBy: string }) {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before creating a table.', 401);
    return await requestCloud<{ database: string; table: string; columns: CreateTableColumn[]; orderBy: string; queryId: string }>({
        action: 'create-table', credentials: activeCloud.credentials, ...input,
    });
}

export async function dropClickHouseCloudTable(database: string, table: string, confirmation: string) {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before deleting a table.', 401);
    return await requestCloud<{ database: string; table: string; queryId: string }>({
        action: 'drop-table', credentials: activeCloud.credentials, database, table, confirmation,
    });
}

export async function importClickHouseCloudFile(input: CloudImportInput): Promise<CloudImportJob> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before importing data.', 401);
    const form = new FormData();
    form.set('action', 'import-commit');
    form.set('credentials', JSON.stringify(activeCloud.credentials));
    form.set('file', input.file, input.file.name);
    form.set('format', input.format);
    form.set('target', input.target);
    form.set('fields', JSON.stringify(input.fields));
    form.set('queryId', input.queryId);
    if (input.expectedColumns) form.set('expectedColumns', JSON.stringify(input.expectedColumns));
    if (input.createTable) form.set('createTable', JSON.stringify(input.createTable));
    return await requestCloudImport<CloudImportJob>(form);
}

export async function insertClickHouseCloudRow(input: {
    table: string;
    columns: readonly Pick<SchemaColumn, 'name' | 'type' | 'defaultKind'>[];
    row: Record<string, unknown>;
    queryId: string;
}): Promise<CloudImportJob> {
    const file = new File([JSON.stringify([input.row])], 'insert-row.json', { type: 'application/json' });
    return importClickHouseCloudFile({
        file,
        format: 'json',
        target: input.table,
        fields: Object.fromEntries(Object.keys(input.row).map(column => [column, column])),
        queryId: input.queryId,
        expectedColumns: input.columns.map(({ name, type, defaultKind }) => ({ name, type, defaultKind })),
    });
}

export async function checkClickHouseCloudImport(queryId: string, table: string, rows: number): Promise<CloudImportJob> {
    if (!activeCloud) throw new CloudRequestError('CLOUD_DISCONNECTED', 'Reconnect to ClickHouse Cloud before checking import status.', 401);
    return await requestCloud<CloudImportJob>({ action: 'import-status', credentials: activeCloud.credentials, queryId, table, rows });
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
