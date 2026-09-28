import type { Json, Schema, SchemaTable } from '../shared/types.js';
import { isValidTableDatabase, type CreateTableColumnType } from '../shared/table-creation.js';

export const CREATE_CLOUD_TABLE_TARGET = '__create_table_from_file__';

export type CloudImportColumn = { source: string; name: string; type: CreateTableColumnType };

const nonInsertableEngines = new Set(['View', 'MaterializedView', 'LiveView', 'WindowView']);

export function cloudImportDatabases(schema?: Schema): string[] {
    return (schema?.databases ?? []).filter(isValidTableDatabase);
}

export function preferredCloudImportDatabase(schema: Schema, currentDatabase: string): string {
    const databases = cloudImportDatabases(schema);
    return databases.includes(currentDatabase) ? currentDatabase : databases[0] ?? '';
}

export function cloudImportTargets(schema: Schema): string[] {
    return schema.tables
        .filter((table: SchemaTable) => isValidTableDatabase(table.database) && !nonInsertableEngines.has(table.engine))
        .map(table => `${table.database}.${table.name}`);
}

function textValue(value: Json): string | undefined {
    if (value === null || typeof value === 'object') return undefined;
    return String(value).trim();
}

function isCalendarDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isDateTime(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)) return false;
    return Number.isFinite(Date.parse(value.replace(' ', 'T')));
}

export function inferCloudImportType(rows: Record<string, Json>[], column: string): CreateTableColumnType {
    const rawValues = rows.map(row => row[column]).filter((value): value is Json => value !== null && value !== undefined);
    if (rawValues.length > 0 && rawValues.every(value => typeof value === 'boolean')) return 'Bool';
    const values = rawValues.map(textValue);
    if (values.some(value => value === undefined || value === '')) return 'String';
    const nonEmpty = values.filter((value): value is string => Boolean(value));
    if (!nonEmpty.length) return 'String';
    if (nonEmpty.every(isCalendarDate)) return 'Date';
    if (nonEmpty.every(isDateTime)) return 'DateTime';
    if (nonEmpty.every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) return 'UUID';
    if (nonEmpty.every(value => /^-?\d+(?:\.\d+)?$/.test(value))) {
        if (nonEmpty.every(value => /^\d+$/.test(value)) && nonEmpty.every(value => BigInt(value) <= 18_446_744_073_709_551_615n)) return 'UInt64';
        if (nonEmpty.every(value => /^-?\d+$/.test(value)) && nonEmpty.every(value => BigInt(value) >= -9_223_372_036_854_775_808n && BigInt(value) <= 9_223_372_036_854_775_807n)) return 'Int64';
        if (nonEmpty.every(value => /^-?\d+$/.test(value))) return 'String';
        const decimals = nonEmpty.map(value => value.split('.')[1]?.length ?? 0);
        if (decimals.every(length => length <= 2) && nonEmpty.every(value => value.replace('-', '').replace('.', '').length <= 18)) return 'Decimal(18, 2)';
        return 'Float64';
    }
    return 'String';
}

export function inferCloudImportColumns(rows: Record<string, Json>[], columns: string[]): CloudImportColumn[] {
    const used = new Set<string>();
    return columns.map((source, index) => {
        const normalized = source.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
        const base = normalized && /^[A-Za-z_]/.test(normalized) ? normalized : `column_${index + 1}`;
        let name = base;
        let suffix = 2;
        while (used.has(name)) name = `${base.slice(0, 120 - String(suffix).length - 1)}_${suffix++}`;
        used.add(name);
        return { source, name, type: inferCloudImportType(rows, source) };
    });
}

export function suggestCloudTableName(fileName: string) {
    const base = fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
    const safe = base || 'imported_data';
    return /^[A-Za-z_]/.test(safe) ? safe : `import_${safe}`;
}
