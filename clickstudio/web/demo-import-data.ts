import { IMPORT_FILE_SIZE_LABEL, IMPORT_ROW_LIMIT_LABEL, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS, MAX_IMPORT_COLUMNS, MAX_IMPORT_COLUMN_NAME_CHARS, type ImportFormat } from '../shared/import-limits.js';
import type { Json } from '../shared/types.js';

export type DemoImportFormat = ImportFormat;
export type DemoImportRow = Record<string, Json>;
export type DemoImportColumn = { name: string; type: string };
export type DemoImportQueryResult = { columns: DemoImportColumn[]; rows: Json[][] };

export const DEMO_IMPORT_TARGET = 'demo.interview_imports';
export const DEMO_IMPORT_SAMPLE_CSV = `day,region,channel,events,revenue
2026-09-21,North America,Organic search,18420,14892.40
2026-09-22,Europe,Direct,12680,10340.75
2026-09-23,Asia Pacific,Paid search,9820,8451.20
2026-09-24,North America,Email,8240,7118.90
2026-09-25,Europe,Referral,7160,6294.35
2026-09-26,Asia Pacific,Social,6840,5740.80
`;

const demoColumns: DemoImportColumn[] = [
    { name: 'day', type: 'Date' },
    { name: 'region', type: 'LowCardinality(String)' },
    { name: 'channel', type: 'LowCardinality(String)' },
    { name: 'events', type: 'UInt64' },
    { name: 'revenue', type: 'Decimal(18, 2)' },
];

function parseCsv(source: string) {
    const input = source.replace(/^\uFEFF/, ''), records: string[][] = [];
    let row: string[] = [], field = '', quoted = false, afterQuote = false;
    const pushField = () => { row.push(field); field = ''; afterQuote = false; };
    const pushRow = () => {
        pushField();
        records.push(row);
        row = [];
        if (records.length > MAX_IMPORT_ROWS + 1) throw new Error(`Imports are limited to ${IMPORT_ROW_LIMIT_LABEL} rows`);
    };
    for (let i = 0; i < input.length; i++) {
        const ch = input[i]!;
        if (quoted) {
            if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') { quoted = false; afterQuote = true; }
            else field += ch;
        } else if (ch === ',') pushField();
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && input[i + 1] === '\n') i++;
            pushRow();
        } else if (ch === '"') {
            if (field !== '' || afterQuote) throw new Error('Quote in an unquoted field');
            quoted = true;
        } else {
            if (afterQuote) throw new Error('Unexpected character after a closing quote');
            field += ch;
        }
    }
    if (quoted) throw new Error('Unclosed quoted CSV field');
    if (field !== '' || row.length || afterQuote) pushRow();
    const columns = records.shift() ?? [];
    if (!columns.length || columns.length > MAX_IMPORT_COLUMNS || columns.some(column => !column.trim() || column.length > MAX_IMPORT_COLUMN_NAME_CHARS))
        throw new Error(`CSV needs 1–${MAX_IMPORT_COLUMNS} nonempty column names`);
    if (new Set(columns).size !== columns.length) throw new Error('Duplicate CSV column names');
    const rows = records.map((values, index) => {
        if (values.length !== columns.length) throw new Error(`CSV row ${index + 2} has the wrong number of fields`);
        const result = Object.create(null) as DemoImportRow;
        columns.forEach((column, columnIndex) => { result[column] = values[columnIndex]!; });
        return result;
    });
    return { columns, rows };
}

function validateJson(value: unknown, depth = 0): Json {
    if (depth > 30) throw new Error('JSON nesting is too deep');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))
            throw new Error('Encode 64-bit integers as JSON strings to avoid precision loss');
        return value;
    }
    if (Array.isArray(value)) return value.map(item => validateJson(item, depth + 1));
    if (typeof value !== 'object') throw new Error('Unsupported JSON value');
    const result = Object.create(null) as Record<string, Json>;
    for (const [key, item] of Object.entries(value)) result[key] = validateJson(item, depth + 1);
    return result;
}

export function parseImportFile(source: string, format: DemoImportFormat) {
    if (new TextEncoder().encode(source).byteLength > MAX_IMPORT_FILE_BYTES) throw new Error(`Import previews are limited to ${IMPORT_FILE_SIZE_LABEL}`);
    if (format === 'csv') return parseCsv(source);
    let parsed: unknown;
    try {
        parsed = format === 'ndjson'
            ? source.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line))
            : JSON.parse(source);
    } catch {
        throw new Error('The uploaded JSON is invalid');
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_IMPORT_ROWS)
        throw new Error(`Upload an array of 1–${IMPORT_ROW_LIMIT_LABEL} JSON objects`);
    const columns = new Set<string>();
    const rows = parsed.map(value => {
        const row = validateJson(value);
        if (row === null || Array.isArray(row) || typeof row !== 'object') throw new Error('Every JSON row must be an object');
        for (const key of Object.keys(row)) {
            if (!key || key.length > MAX_IMPORT_COLUMN_NAME_CHARS) throw new Error('Invalid JSON field name');
            columns.add(key);
        }
        return row;
    });
    if (columns.size === 0 || columns.size > MAX_IMPORT_COLUMNS) throw new Error(`Import previews support 1–${MAX_IMPORT_COLUMNS} columns`);
    return { columns: [...columns], rows };
}

export const parseDemoImport = parseImportFile;

export function demoImportQuery(sql: string, importedRows: DemoImportRow[]): DemoImportQueryResult | undefined {
    const match = sql.match(/^\s*SELECT\s+(.+?)\s+FROM\s+(?:`?demo`?\s*\.\s*)?`?interview_imports`?(?:\s|;|$)/i);
    if (!match) return undefined;
    const selection = match[1]!.trim();
    const projections = selection === '*'
        ? demoColumns.map(column => ({ source: column.name, name: column.name }))
        : selection.split(',').map(part => {
            const item = part.trim().match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s+AS\s+`?([A-Za-z_][A-Za-z0-9_]*)`?)?$/i);
            return item ? { source: item[1]!, name: item[2] ?? item[1]! } : undefined;
        });
    if (!projections.length || projections.some(item => !item)) return undefined;
    const columns = projections.map(item => {
        const sourceColumn = demoColumns.find(column => column.name === item!.source);
        return { name: item!.name, type: sourceColumn?.type ?? 'String' };
    });
    const limit = Number(sql.match(/\bLIMIT\s+(\d+)/i)?.[1] ?? 200);
    const rows = importedRows.slice(0, Math.max(0, Math.min(limit, 500))).map(row =>
        projections.map(item => row[item!.source] ?? null));
    return { columns, rows };
}

const importDatabaseName = 'clickstudio-interview-imports';
const importStoreName = 'tables';
const importStorageKey = DEMO_IMPORT_TARGET;

function openImportDatabase() {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(importDatabaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(importStoreName, { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open browser demo storage'));
    });
}

export async function loadDemoImportRows(): Promise<DemoImportRow[]> {
    const database = await openImportDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const request = database.transaction(importStoreName, 'readonly').objectStore(importStoreName).get(importStorageKey);
            request.onsuccess = () => resolve(Array.isArray(request.result?.rows) ? request.result.rows as DemoImportRow[] : []);
            request.onerror = () => reject(request.error ?? new Error('Could not load browser demo rows'));
        });
    } finally { database.close(); }
}

export async function saveDemoImportRows(rows: DemoImportRow[]) {
    const database = await openImportDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(importStoreName, 'readwrite');
            transaction.objectStore(importStoreName).put({ key: importStorageKey, rows, updatedAt: new Date().toISOString() });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error ?? new Error('Could not save browser demo rows'));
            transaction.onabort = () => reject(transaction.error ?? new Error('Could not save browser demo rows'));
        });
    } finally { database.close(); }
}
