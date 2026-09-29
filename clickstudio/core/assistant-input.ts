import type { Json, Result, Schema, SchemaColumn, SchemaTable } from '../shared/types.js';
import { AppError } from './errors.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, name: string, max: number, allowEmpty = false): string {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
        throw new AppError(400, 'INVALID_REQUEST', `${name} must be a string under ${max.toLocaleString()} characters.`);
    return value;
}

export function assistantSchemaFrom(value: unknown, connectionId: string): Schema {
    if (!isRecord(value) || !Array.isArray(value.tables) || !Array.isArray(value.columns) ||
        value.tables.length > 500 || value.columns.length > 2_000)
        throw new AppError(400, 'INVALID_SCHEMA', 'Refresh the ClickHouse schema and try again.');

    const tables: SchemaTable[] = value.tables.map(raw => {
        if (!isRecord(raw)) throw new AppError(400, 'INVALID_SCHEMA', 'Refresh the ClickHouse schema and try again.');
        return {
            database: field(raw.database, 'Schema database', 128),
            name: field(raw.name, 'Schema table', 256),
            engine: field(raw.engine ?? '', 'Schema engine', 128, true),
        };
    });
    const columns: SchemaColumn[] = value.columns.map(raw => {
        if (!isRecord(raw)) throw new AppError(400, 'INVALID_SCHEMA', 'Refresh the ClickHouse schema and try again.');
        return {
            database: field(raw.database, 'Schema database', 128),
            table: field(raw.table, 'Schema table', 256),
            name: field(raw.name, 'Schema column', 256),
            type: field(raw.type, 'Schema type', 2_048),
            defaultKind: '',
            comment: '',
        };
    });
    return {
        connectionId,
        fetchedAt: typeof value.fetchedAt === 'string' && value.fetchedAt.length <= 128 ? value.fetchedAt : new Date().toISOString(),
        tables,
        columns,
        warnings: [],
        truncated: value.truncated === true,
    };
}

export function assistantResultFrom(value: unknown): Result | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows) ||
        value.columns.length > 100 || value.rows.length > 100 ||
        (value.completeness !== 'complete' && value.completeness !== 'truncated'))
        throw new AppError(400, 'INVALID_RESULT', 'Select a valid retained result and try again.');
    const columns = value.columns.map(column => {
        if (!isRecord(column)) throw new AppError(400, 'INVALID_RESULT', 'Select a valid retained result and try again.');
        return { name: field(column.name, 'Result column name', 256), type: field(column.type, 'Result column type', 2_048) };
    });
    const rows = value.rows.map(row => {
        if (!Array.isArray(row) || row.length !== columns.length)
            throw new AppError(400, 'INVALID_RESULT', 'Select a valid retained result and try again.');
        return row as Json[];
    });
    return {
        runId: field(value.runId, 'Result run ID', 200), queryId: field(value.queryId, 'Result query ID', 200),
        columns, rows, completeness: value.completeness,
        createdAt: field(value.createdAt, 'Result creation time', 128), expiresAt: field(value.expiresAt, 'Result expiry time', 128),
    };
}
