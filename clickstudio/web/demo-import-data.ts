import { ImportParseError, parseImportSource } from '../shared/import-parser.js';
import { IMPORT_ROW_LIMIT_LABEL, type ImportFormat } from '../shared/import-limits.js';
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

export function parseImportFile(source: string, format: DemoImportFormat) {
    try {
        return parseImportSource(source, format);
    } catch (error) {
        if (error instanceof ImportParseError)
            throw new Error(
                error.code === 'IMPORT_ROW_LIMIT'
                    ? `Imports are limited to ${IMPORT_ROW_LIMIT_LABEL} rows`
                    : error.message,
                { cause: error },
            );
        throw error;
    }
}

export const parseDemoImport = parseImportFile;

export function demoImportQuery(
    sql: string,
    importedRows: DemoImportRow[],
): DemoImportQueryResult | undefined {
    const match = sql.match(
        /^\s*SELECT\s+(.+?)\s+FROM\s+(?:`?demo`?\s*\.\s*)?`?interview_imports`?(?:\s|;|$)/i,
    );
    if (!match) return undefined;
    const selection = match[1]!.trim();
    const projections =
        selection === '*'
            ? demoColumns.map(column => ({ source: column.name, name: column.name }))
            : selection.split(',').map(part => {
                  const item = part
                      .trim()
                      .match(
                          /^`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s+AS\s+`?([A-Za-z_][A-Za-z0-9_]*)`?)?$/i,
                      );
                  return item ? { source: item[1]!, name: item[2] ?? item[1]! } : undefined;
              });
    if (!projections.length || projections.some(item => !item)) return undefined;
    const columns = projections.map(item => {
        const sourceColumn = demoColumns.find(column => column.name === item!.source);
        return { name: item!.name, type: sourceColumn?.type ?? 'String' };
    });
    const limit = Number(sql.match(/\bLIMIT\s+(\d+)/i)?.[1] ?? 200);
    const rows = importedRows
        .slice(0, Math.max(0, Math.min(limit, 500)))
        .map(row => projections.map(item => row[item!.source] ?? null));
    return { columns, rows };
}

const importDatabaseName = 'clickstudio-interview-imports';
const importStoreName = 'tables';
const importStorageKey = DEMO_IMPORT_TARGET;

function openImportDatabase() {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(importDatabaseName, 1);
        request.onupgradeneeded = () =>
            request.result.createObjectStore(importStoreName, { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
            reject(request.error ?? new Error('Could not open browser demo storage'));
    });
}

export async function loadDemoImportRows(): Promise<DemoImportRow[]> {
    const database = await openImportDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const request = database
                .transaction(importStoreName, 'readonly')
                .objectStore(importStoreName)
                .get(importStorageKey);
            request.onsuccess = () =>
                resolve(
                    Array.isArray(request.result?.rows)
                        ? (request.result.rows as DemoImportRow[])
                        : [],
                );
            request.onerror = () =>
                reject(request.error ?? new Error('Could not load browser demo rows'));
        });
    } finally {
        database.close();
    }
}

export async function saveDemoImportRows(rows: DemoImportRow[]) {
    const database = await openImportDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(importStoreName, 'readwrite');
            transaction
                .objectStore(importStoreName)
                .put({ key: importStorageKey, rows, updatedAt: new Date().toISOString() });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () =>
                reject(transaction.error ?? new Error('Could not save browser demo rows'));
            transaction.onabort = () =>
                reject(transaction.error ?? new Error('Could not save browser demo rows'));
        });
    } finally {
        database.close();
    }
}
