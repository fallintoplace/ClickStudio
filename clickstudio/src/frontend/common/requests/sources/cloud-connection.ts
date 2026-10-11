import {
    CLOUD_ACTIONS,
    type CloudCredentials,
    type CloudRequest,
} from '../../../../shared/database/connections/cloud-requests.js';
import type { ImportJobStatus } from '../../../../shared/database/imports/status.js';
import type { ImportFormat } from '../../../../shared/database/imports/limits.js';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    CLOUD_QUERY_LIMITS,
} from '../../../../shared/database/connections/cloud-policy.js';
import { DEFAULT_LIMITS } from '../../../../shared/queries/execution/settings.js';
import { type Capability, type Connection } from '../../../../shared/database/connections/types.js';
import {
    type ClickHouseDocumentationEntry,
    type ClickHouseDocumentationSummary,
} from '../../../../shared/database/reference/types.js';
import { type Column, type Row } from '../../../../shared/common/values.js';
import { type Schema, type SchemaColumn } from '../../../../shared/database/schema/types.js';
import type { ReplicationSnapshot } from '../../../../shared/database/explorer/activity/replication.js';
import type {
    QueryLogSource,
    WorkloadSnapshot,
    WorkloadWindow,
} from '../../../../shared/database/explorer/activity/workload.js';
import type {
    FlamegraphSnapshot,
    FlamegraphSource,
} from '../../../../shared/queries/inspection/flamegraph.js';
import type { CloudImportColumn } from '../../../database/imports/state/cloud-import.js';
import type { CreateTableColumn } from '../../../../shared/database/tables/create-table.js';
import type {
    NativeExplorerRequest,
    NativeExplorerSnapshot,
} from '../../../../shared/database/explorer/explorers.js';
import type { MergeTreePartsSnapshot } from '../../../../shared/database/explorer/storage/parts.js';

export { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../../shared/database/connections/cloud-policy.js';

export type { CloudCredentials } from '../../../../shared/database/connections/cloud-requests.js';
export type SavedCloudConnectionProfile = Pick<CloudCredentials, 'host' | 'database' | 'username'>;
export type CloudQueryResult = {
    queryId: string;
    columns: Column[];
    rows: Row[];
    elapsedMs: number;
    bytes: number;
    truncated: boolean;
    writtenRows?: number;
};
export type CloudImportJob = {
    id: string;
    connectionId: string;
    table: string;
    queryId: string;
    deduplicationToken?: string;
    rows: number;
    createdAt: string;
    status: ImportJobStatus;
    error?: string;
    reviewedAt?: string;
    reconciliationRequired?: boolean;
    tableCreated?: boolean;
    tableExists?: boolean;
};
export type CloudImportInput = {
    file: File;
    format: ImportFormat;
    target: string;
    fields: Record<string, string>;
    queryId: string;
    deduplicationToken?: string;
    expectedColumns?: Pick<SchemaColumn, 'name' | 'type' | 'defaultKind'>[];
    createTable?: {
        database: string;
        name: string;
        columns: CloudImportColumn[];
        generateId?: boolean;
    };
};
type ActiveCloudConnection = {
    credentials?: CloudCredentials;
    connection: Connection & { trusted: boolean };
    localSession: boolean;
};

const CLOUD_PROFILE_STORAGE_KEY = 'clickstudio:cloud-connection-profile:v1';
let activeCloud: ActiveCloudConnection | undefined;

export function loadSavedCloudConnectionProfile(): SavedCloudConnectionProfile | undefined {
    try {
        const value: unknown = JSON.parse(
            window.localStorage.getItem(CLOUD_PROFILE_STORAGE_KEY) ?? 'null',
        );
        if (typeof value !== 'object' || value === null) return undefined;
        const profile = value as Record<string, unknown>;
        if (
            typeof profile.host !== 'string' ||
            typeof profile.database !== 'string' ||
            typeof profile.username !== 'string'
        )
            return undefined;
        return { host: profile.host, database: profile.database, username: profile.username };
    } catch {
        return undefined;
    }
}

export function saveCloudConnectionProfile(profile: SavedCloudConnectionProfile) {
    try {
        window.localStorage.setItem(CLOUD_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch {}
}

export class CloudRequestError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly status: number,
    ) {
        super(message);
        this.name = 'CloudRequestError';
    }
}

async function requestCloud<T>(body: CloudRequest, signal?: AbortSignal): Promise<T> {
    const requestBody = activeCloud?.localSession
        ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'credentials'))
        : body;
    const response = await fetch('/api/cloud', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-ClickStudio-Intent': '1' },
        body: JSON.stringify(requestBody),
        ...(signal ? { signal } : {}),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const root =
            typeof payload === 'object' && payload !== null
                ? (payload as Record<string, unknown>)
                : {};
        const detail =
            typeof root.error === 'object' && root.error !== null
                ? (root.error as Record<string, unknown>)
                : {};
        throw new CloudRequestError(
            typeof detail.code === 'string' ? detail.code : 'CLOUD_REQUEST',
            typeof detail.message === 'string'
                ? detail.message
                : `ClickHouse Cloud returned HTTP ${response.status}.`,
            response.status,
        );
    }
    return payload as T;
}

async function localCloudSession<T>(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
    const response = await fetch('/api/cloud/session', {
        method,
        credentials: 'same-origin',
        headers: {
            'X-ClickStudio-Intent': '1',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload: unknown = method === 'DELETE' ? null : await response.json().catch(() => null);
    if (!response.ok) {
        const root =
            typeof payload === 'object' && payload !== null
                ? (payload as Record<string, unknown>)
                : {};
        const detail =
            typeof root.error === 'object' && root.error !== null
                ? (root.error as Record<string, unknown>)
                : {};
        throw new CloudRequestError(
            typeof detail.code === 'string' ? detail.code : 'CLOUD_REQUEST',
            typeof detail.message === 'string'
                ? detail.message
                : `ClickHouse Cloud returned HTTP ${response.status}.`,
            response.status,
        );
    }
    return payload as T;
}

async function requestCloudImport<T>(form: FormData): Promise<T> {
    const response = await fetch('/api/cloud', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-ClickStudio-Intent': '1' },
        body: form,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const root =
            typeof payload === 'object' && payload !== null
                ? (payload as Record<string, unknown>)
                : {};
        const detail =
            typeof root.error === 'object' && root.error !== null
                ? (root.error as Record<string, unknown>)
                : {};
        throw new CloudRequestError(
            typeof detail.code === 'string' ? detail.code : 'CLOUD_REQUEST',
            typeof detail.message === 'string'
                ? detail.message
                : `ClickHouse Cloud returned HTTP ${response.status}.`,
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

function makeConnection(
    credentials: SavedCloudConnectionProfile,
    tested: CloudConnectionTest,
): Connection & { trusted: boolean } {
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
        limits: { ...DEFAULT_LIMITS, ...CLOUD_QUERY_LIMITS },
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

export async function connectClickHouseCloud(
    credentials: CloudCredentials,
    persistInLocalServer = false,
) {
    const tested = persistInLocalServer
        ? await localCloudSession<CloudConnectionTest>('POST', { credentials })
        : await requestCloud<CloudConnectionTest>({ action: CLOUD_ACTIONS.test, credentials });
    const connection = makeConnection(credentials, tested);
    activeCloud = persistInLocalServer
        ? { connection, localSession: true }
        : { credentials: { ...credentials }, connection, localSession: false };
    return connection;
}

export async function restoreClickHouseCloudSession() {
    const payload = await localCloudSession<{
        session: { profile: SavedCloudConnectionProfile; tested: CloudConnectionTest } | null;
    }>('GET');
    if (!payload.session) return undefined;
    const connection = makeConnection(payload.session.profile, payload.session.tested);
    activeCloud = { connection, localSession: true };
    return connection;
}

export function getClickHouseCloudConnection() {
    return activeCloud?.connection;
}

export async function disconnectClickHouseCloud() {
    if (activeCloud?.localSession) await localCloudSession<void>('DELETE');
    activeCloud = undefined;
}

export async function runClickHouseCloudSql(
    sql: string,
    sessionId?: string,
    options: { queryId?: string; parameters?: Record<string, string> } = {},
): Promise<CloudQueryResult> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before running SQL.',
            401,
        );
    return await requestCloud<CloudQueryResult>({
        action: CLOUD_ACTIONS.run,
        credentials: activeCloud.credentials,
        sql,
        ...(sessionId ? { sessionId } : {}),
        ...options,
    });
}

export async function loadClickHouseCloudSchema(
    offsets: { databaseOffset?: number; tableOffset?: number; columnOffset?: number } = {},
): Promise<Schema> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before loading its schema.',
            401,
        );
    return await requestCloud<Schema>({
        action: CLOUD_ACTIONS.schema,
        credentials: activeCloud.credentials,
        ...offsets,
    });
}

export async function loadClickHouseCloudQueryTree(
    sql: string,
    parameters: Record<string, string>,
    signal?: AbortSignal,
): Promise<string[]> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before analyzing SQL.',
            401,
        );
    return await requestCloud<string[]>(
        { action: CLOUD_ACTIONS.queryTree, credentials: activeCloud.credentials, sql, parameters },
        signal,
    );
}

export async function loadClickHouseCloudProgress(queryId: string, signal?: AbortSignal) {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud to load query progress.',
            401,
        );
    const response = await requestCloud<{
        progress?: { readRows: string; readBytes: string; elapsedMs: number; memory?: string };
    }>({ action: CLOUD_ACTIONS.progress, credentials: activeCloud.credentials, queryId }, signal);
    return response.progress;
}

export async function cancelClickHouseCloudQuery(queryId: string, signal?: AbortSignal) {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before stopping SQL.',
            401,
        );
    return await requestCloud<{ cancelled: boolean; queryId: string }>(
        { action: CLOUD_ACTIONS.cancel, credentials: activeCloud.credentials, queryId },
        signal,
    );
}

export async function loadClickHouseCloudProfileEvidence(queryId: string, signal?: AbortSignal) {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before loading query history.',
            401,
        );
    const source = activeCloud.connection.manifest?.queryLogSource;
    if (!source)
        throw new CloudRequestError(
            'QUERY_LOG_UNAVAILABLE',
            'Test the connection to check query-log access.',
            409,
        );
    return await requestCloud<Record<string, unknown>[]>(
        { action: CLOUD_ACTIONS.profile, credentials: activeCloud.credentials, queryId, source },
        signal,
    );
}

export async function loadClickHouseCloudPipeline(
    sql: string,
    parameters: Record<string, string>,
    signal?: AbortSignal,
) {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before loading pipeline details.',
            401,
        );
    return await requestCloud<string[]>(
        { action: CLOUD_ACTIONS.pipeline, credentials: activeCloud.credentials, sql, parameters },
        signal,
    );
}

export async function loadClickHouseCloudFlamegraph(
    queryId: string,
    createdAt: string,
    finishedAt: string | undefined,
    signal?: AbortSignal,
): Promise<FlamegraphSnapshot> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before loading profiler samples.',
            401,
        );
    const source = activeCloud.connection.manifest?.traceLogSource;
    if (!source)
        throw new CloudRequestError(
            'TRACE_UNAVAILABLE',
            'Test the connection to check trace-log access.',
            409,
        );
    const asDate = (value: string) => {
        const date = new Date(value);
        return Number.isFinite(date.getTime())
            ? date.toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
    };
    return await requestCloud<FlamegraphSnapshot>(
        {
            action: CLOUD_ACTIONS.flamegraph,
            credentials: activeCloud.credentials,
            queryId,
            startDate: asDate(createdAt),
            endDate: asDate(finishedAt ?? createdAt),
            source,
        },
        signal,
    );
}

export async function searchClickHouseCloudDocumentation(
    query: string,
    category: string,
    signal?: AbortSignal,
) {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before searching reference docs.',
            401,
        );
    return await requestCloud<ClickHouseDocumentationSummary[]>(
        {
            action: CLOUD_ACTIONS.documentationSearch,
            credentials: activeCloud.credentials,
            query,
            category,
        },
        signal,
    );
}

export async function loadClickHouseCloudDocumentationEntry(
    name: string,
    type: string,
    signal?: AbortSignal,
) {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before opening reference docs.',
            401,
        );
    return await requestCloud<ClickHouseDocumentationEntry | undefined>(
        {
            action: CLOUD_ACTIONS.documentationEntry,
            credentials: activeCloud.credentials,
            name,
            type,
            serverVersion: activeCloud.connection.manifest?.serverVersion,
        },
        signal,
    );
}

export async function loadClickHouseCloudNativeExplorer(
    request: NativeExplorerRequest,
    signal: AbortSignal,
): Promise<NativeExplorerSnapshot> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before inspecting metadata.',
            401,
        );
    return await requestCloud<NativeExplorerSnapshot>(
        { action: CLOUD_ACTIONS.nativeExplorer, credentials: activeCloud.credentials, ...request },
        signal,
    );
}

export async function loadClickHouseCloudTableParts(
    database: string,
    table: string,
    signal: AbortSignal,
): Promise<MergeTreePartsSnapshot> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before inspecting storage.',
            401,
        );
    return await requestCloud<MergeTreePartsSnapshot>(
        { action: CLOUD_ACTIONS.tableParts, credentials: activeCloud.credentials, database, table },
        signal,
    );
}

export async function createClickHouseCloudTable(input: {
    database: string;
    name: string;
    columns: CreateTableColumn[];
    orderBy: string;
}) {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before creating a table.',
            401,
        );
    return await requestCloud<{
        database: string;
        table: string;
        columns: CreateTableColumn[];
        orderBy: string;
        queryId: string;
    }>({
        action: CLOUD_ACTIONS.createTable,
        credentials: activeCloud.credentials,
        ...input,
    });
}

export async function dropClickHouseCloudTable(
    database: string,
    table: string,
    confirmation: string,
) {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before deleting a table.',
            401,
        );
    return await requestCloud<{ database: string; table: string; queryId: string }>({
        action: CLOUD_ACTIONS.dropTable,
        credentials: activeCloud.credentials,
        database,
        table,
        confirmation,
    });
}

export async function importClickHouseCloudFile(input: CloudImportInput): Promise<CloudImportJob> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before importing data.',
            401,
        );
    const form = new FormData();
    form.set('action', CLOUD_ACTIONS.importCommit);
    if (activeCloud.credentials) form.set('credentials', JSON.stringify(activeCloud.credentials));
    form.set('file', input.file, input.file.name);
    form.set('format', input.format);
    form.set('target', input.target);
    form.set('fields', JSON.stringify(input.fields));
    form.set('queryId', input.queryId);
    if (input.deduplicationToken) form.set('deduplicationToken', input.deduplicationToken);
    if (input.expectedColumns) form.set('expectedColumns', JSON.stringify(input.expectedColumns));
    if (input.createTable) form.set('createTable', JSON.stringify(input.createTable));
    return await requestCloudImport<CloudImportJob>(form);
}

export async function insertClickHouseCloudRow(input: {
    table: string;
    columns: readonly Pick<SchemaColumn, 'name' | 'type' | 'defaultKind'>[];
    row: Record<string, unknown>;
    queryId: string;
    deduplicationToken?: string;
}): Promise<CloudImportJob> {
    const file = new File([JSON.stringify([input.row])], 'insert-row.json', {
        type: 'application/json',
    });
    return importClickHouseCloudFile({
        file,
        format: 'json',
        target: input.table,
        fields: Object.fromEntries(Object.keys(input.row).map(column => [column, column])),
        queryId: input.queryId,
        deduplicationToken: input.deduplicationToken,
        expectedColumns: input.columns.map(({ name, type, defaultKind }) => ({
            name,
            type,
            defaultKind,
        })),
    });
}

export async function checkClickHouseCloudImport(
    queryId: string,
    table: string,
    rows: number,
    deduplicationToken?: string,
): Promise<CloudImportJob> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before checking import status.',
            401,
        );
    return await requestCloud<CloudImportJob>({
        action: CLOUD_ACTIONS.importStatus,
        credentials: activeCloud.credentials,
        queryId,
        table,
        rows,
        ...(deduplicationToken ? { deduplicationToken } : {}),
    });
}

export async function loadClickHouseCloudWorkload(
    minutes: WorkloadWindow,
    signal: AbortSignal,
): Promise<WorkloadSnapshot> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before loading workload history.',
            401,
        );
    const source = activeCloud.connection.manifest?.queryLogSource;
    if (!source)
        throw new CloudRequestError(
            'QUERY_LOG_UNAVAILABLE',
            'Test the connection to check query-log access.',
            409,
        );
    return await requestCloud<WorkloadSnapshot>(
        { action: CLOUD_ACTIONS.workload, credentials: activeCloud.credentials, minutes, source },
        signal,
    );
}

export async function loadClickHouseCloudReplication(
    signal: AbortSignal,
): Promise<ReplicationSnapshot> {
    if (!activeCloud)
        throw new CloudRequestError(
            'CLOUD_DISCONNECTED',
            'Reconnect to ClickHouse Cloud before loading replication status.',
            401,
        );
    return await requestCloud<ReplicationSnapshot>(
        { action: CLOUD_ACTIONS.replication, credentials: activeCloud.credentials },
        signal,
    );
}
