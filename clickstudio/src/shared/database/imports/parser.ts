import {
    IMPORT_FILE_SIZE_LABEL,
    IMPORT_ROW_LIMIT_LABEL,
    MAX_IMPORT_FILE_BYTES,
    MAX_IMPORT_ROWS,
    MAX_IMPORT_COLUMNS,
    MAX_IMPORT_COLUMN_NAME_CHARS,
    type ImportFormat,
} from './limits.js';
import type { Json } from '../../common/values.js';

export class ImportParseError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

function requireImport(
    condition: unknown,
    status: number,
    code: string,
    message: string,
): asserts condition {
    if (!condition) throw new ImportParseError(status, code, message);
}

function isJsonObject(value: Json): value is Record<string, Json> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateImportJson(value: unknown, depth = 0): Json {
    if (depth > 30) throw new ImportParseError(400, 'INVALID_JSON', 'JSON nesting is too deep');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        requireImport(
            Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)),
            400,
            'UNSAFE_NUMBER',
            'Encode 64-bit integers as JSON strings to avoid precision loss',
        );
        return value;
    }
    if (Array.isArray(value)) return value.map(v => validateImportJson(v, depth + 1));
    const out: {
        [key: string]: Json;
    } = Object.create(null);
    requireImport(
        value !== null && typeof value === 'object',
        400,
        'INVALID_REQUEST',
        'request must be an object',
    );
    for (const [key, v] of Object.entries(value)) out[key] = validateImportJson(v, depth + 1);
    return out;
}

/** RFC 4180-style CSV parser. Quoted newlines and escaped quotes are not split. */
export function parseCsv(
    source: string,
    maxRows = MAX_IMPORT_ROWS,
): {
    columns: string[];
    rows: Record<string, Json>[];
} {
    const input = source.replace(/^\uFEFF/, ''),
        records: string[][] = [];
    let row: string[] = [],
        field = '',
        quoted = false,
        afterQuote = false;
    const pushField = () => {
        row.push(field);
        field = '';
        afterQuote = false;
    };
    const pushRow = () => {
        pushField();
        records.push(row);
        row = [];
        requireImport(
            records.length <= maxRows + 1,
            413,
            'IMPORT_ROW_LIMIT',
            `Imports are limited to ${maxRows} rows`,
        );
    };
    for (let i = 0; i < input.length; i++) {
        const ch = input[i]!;
        if (quoted) {
            if (ch === '"' && input[i + 1] === '"') {
                field += '"';
                i++;
            } else if (ch === '"') {
                quoted = false;
                afterQuote = true;
            } else field += ch;
        } else if (ch === ',') pushField();
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && input[i + 1] === '\n') i++;
            pushRow();
        } else if (ch === '"') {
            requireImport(
                field === '' && !afterQuote,
                400,
                'INVALID_CSV',
                'Quote in an unquoted field',
            );
            quoted = true;
        } else {
            requireImport(
                !afterQuote,
                400,
                'INVALID_CSV',
                'Unexpected character after a closing quote',
            );
            field += ch;
        }
    }
    requireImport(!quoted, 400, 'INVALID_CSV', 'Unclosed quoted CSV field');
    if (field !== '' || row.length || afterQuote) pushRow();
    const columns = records.shift() ?? [];
    requireImport(
        columns.length > 0 &&
            columns.length <= MAX_IMPORT_COLUMNS &&
            columns.every(c => c.trim().length > 0 && c.length <= MAX_IMPORT_COLUMN_NAME_CHARS),
        400,
        'INVALID_HEADERS',
        `CSV needs 1–${MAX_IMPORT_COLUMNS} nonempty column names`,
    );
    requireImport(
        new Set(columns).size === columns.length,
        400,
        'DUPLICATE_HEADERS',
        'Duplicate CSV column names',
    );
    const rows = records.map((record, index) => {
        requireImport(
            record.length === columns.length,
            400,
            'CSV_WIDTH',
            `CSV row ${index + 2} has the wrong number of fields`,
        );
        const parsed: Record<string, Json> = Object.create(null) as Record<string, Json>;
        for (const [columnIndex, column] of columns.entries()) {
            const field = record[columnIndex];
            requireImport(
                field !== undefined,
                400,
                'CSV_WIDTH',
                `CSV row ${index + 2} has the wrong number of fields`,
            );
            parsed[column] = field;
        }
        return parsed;
    });
    return { columns, rows };
}
export function parseImportSource(source: string, format: ImportFormat) {
    requireImport(
        new TextEncoder().encode(source).byteLength <= MAX_IMPORT_FILE_BYTES,
        413,
        'IMPORT_BYTE_LIMIT',
        `Import previews are limited to ${IMPORT_FILE_SIZE_LABEL}`,
    );
    if (format === 'csv') return parseCsv(source);
    let parsed: unknown;
    try {
        parsed =
            format === 'ndjson'
                ? source
                      .split(/\r?\n/)
                      .filter(l => l.trim())
                      .map(l => JSON.parse(l))
                : JSON.parse(source);
    } catch {
        throw new ImportParseError(400, 'INVALID_JSON', 'The uploaded JSON is invalid');
    }
    requireImport(
        Array.isArray(parsed) && parsed.length > 0 && parsed.length <= MAX_IMPORT_ROWS,
        400,
        'IMPORT_ROWS',
        `Upload an array of 1–${IMPORT_ROW_LIMIT_LABEL} JSON objects`,
    );
    const columns = new Set<string>();
    const rows = parsed.map(value => {
        const validated = validateImportJson(value);
        requireImport(
            isJsonObject(validated),
            400,
            'IMPORT_OBJECT',
            'Every JSON row must be an object',
        );
        for (const key of Object.keys(validated)) {
            requireImport(
                key.length > 0 && key.length <= MAX_IMPORT_COLUMN_NAME_CHARS,
                400,
                'INVALID_HEADERS',
                'Invalid JSON field name',
            );
            columns.add(key);
        }
        return validated;
    });
    requireImport(
        columns.size > 0 && columns.size <= MAX_IMPORT_COLUMNS,
        400,
        'IMPORT_COLUMNS',
        `Import previews support 1–${MAX_IMPORT_COLUMNS} columns`,
    );
    return { columns: [...columns], rows };
}
