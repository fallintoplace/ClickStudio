import type { RunKind, RunStatus, RunResultState, ScriptStatus, RunEventType } from './status.js';
import type { Limits } from './settings.js';
import type { Column } from '../../common/values.js';
import type { ApiError } from '../../common/errors.js';

export interface RunRequest {
    clientRequestId: string;
    connectionId: string;
    documentId?: string;
    sql: string;
    kind?: RunKind;
    parameters?: Record<string, string>;
    limits?: Partial<Limits>;
    tags?: Record<string, string>;
    parentRunId?: string;
    sourceFrom?: number;
    sourceTo?: number;
}

export interface Progress {
    readRows: string;
    readBytes: string;
    elapsedMs: number;
    memory?: string;
}

export interface Run {
    dataSource: 'clickhouse' | 'fixture';
    id: string;
    queryId: string;
    owner: string;
    connectionId: string;
    documentId?: string;
    sql: string;
    sourceFrom?: number;
    sourceTo?: number;
    kind: RunKind;
    parameters: Record<string, string>;
    limits: Limits;
    tags: Record<string, string>;
    parentRunId?: string;
    status: RunStatus;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    elapsedMs: number;
    rowCount: number;
    writtenRows?: number;
    bytes: number;
    columns: Column[];
    progress?: Progress;
    warnings: string[];
    error?: ApiError;
    sequence: number;
    resultExpiresAt?: string;
    resultState: RunResultState;
    requestedBy: string;
    executedAs: string;
    permissionSnapshot: {
        readonly: boolean;
        role: string;
    };
    retryPolicy: 'never';
    traceId?: string;
    serverVersion?: string;
}

export interface RunEvent {
    sequence: number;
    type: RunEventType;
    run: Run;
}

export interface Script {
    id: string;
    owner: string;
    connectionId: string;
    sql: string;
    createdAt: string;
    status: ScriptStatus;
    stopOnError: boolean;
    cancelled: boolean;
    statements: {
        sql: string;
        from: number;
        to: number;
        runId?: string;
        status: 'pending' | 'skipped' | RunStatus;
        error?: ApiError;
    }[];
}
