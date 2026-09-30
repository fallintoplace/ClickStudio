import type { Json, Schema, SchemaColumn } from '../../shared/types';
import { api } from '../api';

export type ImportFormat = 'csv' | 'json' | 'ndjson';
export type Step = 'file' | 'mapping' | 'review' | 'status';
export const importSteps = [
    { id: 'file', label: 'File' },
    { id: 'mapping', label: 'Set up' },
    { id: 'review', label: 'Review' },
    { id: 'status', label: 'Import' },
] as const satisfies readonly { id: Step; label: string }[];

export type ImportPreview = {
    id: string;
    name: string;
    format: ImportFormat;
    columns: string[];
    rows: Record<string, Json>[];
    rowCount: number;
};
export type ImportMapping = {
    id: string;
    deduplicationToken?: string | null;
    payloadFingerprint?: string;
    inputId: string;
    connectionId: string;
    table: string;
    fields: Record<string, string>;
    rows: Record<string, Json>[];
    rowCount: number;
    missingFields?: Record<string, number>;
};
export type ImportJob = {
    id: string;
    connectionId?: string;
    table: string;
    queryId?: string;
    deduplicationToken?: string;
    rows: number;
    createdAt?: string;
    status: 'running' | 'succeeded' | 'unknown';
    error?: string;
    reconciliationRequired?: boolean;
    tableCreated?: boolean;
    tableExists?: boolean;
    reviewedAt?: string;
    demoRows?: Record<string, Json>[];
    demoPersisted?: boolean;
};
export type PendingImport = { id: string; table: string; rows: number; name: string; queryId?: string; deduplicationToken?: string; payloadFingerprint?: string; retryDeduplicationToken?: string | null; retryOriginId?: string; inspectionOpened?: boolean };
export type BusyAction = '' | 'setup' | 'preview' | 'mapping' | 'commit' | 'recover' | 'review';

export function isPendingImport(value: unknown): value is PendingImport {
    return typeof value === 'object' && value !== null && !Array.isArray(value) &&
        'id' in value && typeof value.id === 'string' && value.id.length > 0 &&
        'table' in value && typeof value.table === 'string' && value.table.length > 0 &&
        'rows' in value && typeof value.rows === 'number' && Number.isSafeInteger(value.rows) && value.rows >= 0 &&
        'name' in value && typeof value.name === 'string' &&
        (!('deduplicationToken' in value) || typeof value.deduplicationToken === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.deduplicationToken)) &&
        (!('payloadFingerprint' in value) || typeof value.payloadFingerprint === 'string' && /^sha256-v1:[0-9a-f]{64}$/i.test(value.payloadFingerprint)) &&
        (!('retryDeduplicationToken' in value) || value.retryDeduplicationToken === null || typeof value.retryDeduplicationToken === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.retryDeduplicationToken)) &&
        (!('retryOriginId' in value) || typeof value.retryOriginId === 'string' && value.retryOriginId.length > 0) &&
        (!('inspectionOpened' in value) || typeof value.inspectionOpened === 'boolean');
}

export const MAX_FILE_BYTES = 2_000_000;
export const importStateKey = (connectionId: string) => `clickstudio:import:${connectionId}:v1`;

export function formatImportRowCount(count: number): string {
    return `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'}`;
}

export function formatImportColumnCount(count: number): string {
    return `${count.toLocaleString()} ${count === 1 ? 'column' : 'columns'}`;
}

export function formatImportColumnRange(shown: number, total: number): string {
    return `${shown.toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? 'column' : 'columns'}`;
}

export function fileFormat(file: File): ImportFormat | undefined {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) return 'csv';
    if (name.endsWith('.json')) return 'json';
    if (name.endsWith('.ndjson') || name.endsWith('.jsonl')) return 'ndjson';
    return undefined;
}

export function displayImportValue(value: Json | undefined): string {
    if (value === undefined) return '—';
    if (typeof value === 'string') return value;
    if (value === null) return 'null';
    return JSON.stringify(value);
}

export function writableColumns(schema: Schema | undefined, table: string): SchemaColumn[] {
    return schema?.columns.filter(column => `${column.database}.${column.table}` === table && !['MATERIALIZED', 'ALIAS'].includes(column.defaultKind)) ?? [];
}

export function initialFields(sourceColumns: string[], destinations: SchemaColumn[]): Record<string, string> {
    const writableNames = new Set(destinations.map(column => column.name));
    return Object.fromEntries(sourceColumns.map(column => [column, writableNames.has(column) ? column : '']));
}

export function loadImportSetup(connectionId: string, signal?: AbortSignal) {
    return Promise.all([
        api<string[]>(`/connections/${encodeURIComponent(connectionId)}/import-targets`, signal ? { signal } : {}),
        api<Schema>(`/connections/${encodeURIComponent(connectionId)}/schema`, signal ? { signal } : {}),
    ]);
}
