import type { Limits } from './types.js';

export const CLICKHOUSE_CLOUD_CONNECTION_ID = 'clickhouse-cloud';
export const CLOUD_QUERY_LIMITS: Readonly<Pick<Limits, 'rows' | 'bytes' | 'seconds' | 'threads'>> = Object.freeze({
    rows: 1_000, bytes: 2_000_000, seconds: 45, threads: 4,
});
export const MAX_CLOUD_INSPECTOR_RESULT_ROWS = 2_000;
export const MAX_CLOUD_REFERENCE_RESULT_ROWS = 6_000;
export const CLOUD_SCHEMA_DATABASE_PAGE_ROWS = 1_000;
export const CLOUD_SCHEMA_TABLE_PAGE_ROWS = 1_000;
export const CLOUD_SCHEMA_COLUMN_PAGE_ROWS = 2_000;
export const CLOUD_REQUEST_TIMEOUT_MS = 50_000;
export const CLOUD_QUERY_TIMEOUT_MS = 48_000;
export const MAX_CLOUD_IMPORT_REQUEST_BYTES = 4_000_000;
