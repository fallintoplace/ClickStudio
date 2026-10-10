import { MAX_IMPORT_COLUMNS } from '../shared/import-limits.js';
import type { Json, SchemaColumn } from '../shared/types.js';

export type ImportMappingColumn = Pick<SchemaColumn, 'name' | 'type' | 'defaultKind'>;

export class ImportMappingError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'ImportMappingError';
    }
}

function isNullable(type: string) {
    let unwrapped = type.trim();
    while (true) {
        const wrapper = unwrapped.match(/^LowCardinality\((.*)\)$/);
        if (!wrapper) return /^Nullable\(/.test(unwrapped);
        unwrapped = wrapper[1]!.trim();
    }
}

function hasUsableDefault(column: ImportMappingColumn) {
    return column.defaultKind.toUpperCase() === 'DEFAULT' || isNullable(column.type);
}

function isStringType(type: string) {
    let unwrapped = type.trim();
    while (true) {
        const wrapper = unwrapped.match(/^(?:Nullable|LowCardinality)\((.*)\)$/);
        if (!wrapper) return unwrapped === 'String';
        unwrapped = wrapper[1]!.trim();
    }
}

function stringValue(value: Json): string {
    if (value !== null && typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function unwrappedType(type: string) {
    let current = type.trim();
    while (true) {
        const wrapper = current.match(/^(?:Nullable|LowCardinality)\((.*)\)$/);
        if (!wrapper) return current;
        current = wrapper[1]!.trim();
    }
}

function valueFitsKnownType(value: Json, type: string): boolean | undefined {
    const baseType = unwrappedType(type);
    const integerType = baseType.match(/^(UInt|Int)(8|16|32|64|128|256)$/);
    if (integerType) {
        if (typeof value !== 'string' && typeof value !== 'number') return false;
        const text = String(value).trim();
        if (!/^[+-]?\d+$/.test(text)) return false;
        const digits = text.replace(/^[+-]/, '').replace(/^0+/, '') || '0';
        if (digits.length > 78) return false;
        const integer = BigInt(`${text.startsWith('-') ? '-' : ''}${digits}`);
        const bits = BigInt(integerType[2]!);
        const unsigned = integerType[1] === 'UInt';
        const minimum = unsigned ? 0n : -(1n << (bits - 1n));
        const maximum = unsigned ? (1n << bits) - 1n : (1n << (bits - 1n)) - 1n;
        return integer >= minimum && integer <= maximum;
    }
    return undefined;
}

export function mapImportRows(
    sourceRows: Record<string, Json>[],
    sourceColumns: string[],
    fields: Record<string, string>,
    destinationColumns: ImportMappingColumn[],
) {
    const entries = Object.entries(fields);
    if (
        !entries.length ||
        entries.length > MAX_IMPORT_COLUMNS ||
        new Set(entries.map(([, destination]) => destination)).size !== entries.length
    )
        throw new ImportMappingError(
            'IMPORT_MAPPING',
            `Map 1–${MAX_IMPORT_COLUMNS} source columns to unique destination columns.`,
        );

    const writableColumns = destinationColumns.filter(
        column => !['MATERIALIZED', 'ALIAS'].includes(column.defaultKind.toUpperCase()),
    );
    const writableByName = new Map(writableColumns.map(column => [column.name, column]));
    for (const [source, destination] of entries) {
        if (!sourceColumns.includes(source) || !writableByName.has(destination))
            throw new ImportMappingError(
                'IMPORT_MAPPING',
                'Mapping references an unknown source or a non-writable destination column.',
            );
    }

    const mappedDestinations = new Set(entries.map(([, destination]) => destination));
    const requiredUnmapped = writableColumns.filter(
        column => !mappedDestinations.has(column.name) && !hasUsableDefault(column),
    );
    if (requiredUnmapped.length)
        throw new ImportMappingError(
            'IMPORT_REQUIRED_COLUMNS',
            `Map a source column to each required destination column: ${requiredUnmapped.map(column => column.name).join(', ')}.`,
        );

    const missingFields: Record<string, number> = Object.create(null) as Record<string, number>;
    const rows = sourceRows.map((row, rowIndex) => {
        const mapped: Record<string, Json> = Object.create(null) as Record<string, Json>;
        for (const [source, destination] of entries) {
            const column = writableByName.get(destination)!;
            if (!Object.hasOwn(row, source) || row[source] === undefined) {
                if (!hasUsableDefault(column))
                    throw new ImportMappingError(
                        'IMPORT_MISSING_FIELD',
                        `Input row ${rowIndex + 1} is missing ${source}, required by ${destination}.`,
                    );
                missingFields[source] = (missingFields[source] ?? 0) + 1;
                continue;
            }
            const value = row[source]!;
            if (value === null && !isNullable(column.type))
                throw new ImportMappingError(
                    'IMPORT_NULL_VALUE',
                    `Input row ${rowIndex + 1} has null for non-nullable destination ${destination}.`,
                );
            if (value !== null && valueFitsKnownType(value, column.type) === false) {
                const displayValue =
                    typeof value === 'string'
                        ? value.replace(/\s+/g, ' ').slice(0, 80)
                        : stringValue(value).slice(0, 80);
                throw new ImportMappingError(
                    'IMPORT_VALUE_TYPE',
                    `Input row ${rowIndex + 1}: ${JSON.stringify(source)} value ${JSON.stringify(displayValue)} cannot be inserted into ${JSON.stringify(destination)} (${column.type}). Check the value or choose a matching column.`,
                );
            }
            mapped[destination] =
                isStringType(column.type) && value !== null && typeof value !== 'string'
                    ? stringValue(value)
                    : value;
        }
        return mapped;
    });

    return { rows, missingFields };
}
