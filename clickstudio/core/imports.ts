import { randomUUID } from 'node:crypto';
import type { Json, Principal, Schema, SchemaColumn } from '../shared/types.js';
import { quoteIdentifier } from '../shared/sql.js';
import { AppError, requireThat, asError } from './errors.js';
import { canWrite, mustOwn } from './guards.js';
import { hash, audit, type Store } from './store.js';
import { validateJson } from './validation.js';

function isJsonObject(value: Json): value is Record<string, Json> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export interface InputPreview {
    id: string;
    owner: string;
    name: string;
    format: 'csv' | 'json' | 'ndjson';
    columns: string[];
    rows: Record<string, Json>[];
    createdAt: string;
    expiresAt: string;
}
/** RFC 4180-style CSV parser. Quoted newlines and escaped quotes are not split. */
export function parseCsv(source: string, maxRows = 10000): {
    columns: string[];
    rows: Record<string, Json>[];
} {
    const input = source.replace(/^\uFEFF/, ''), records: string[][] = [];
    let row: string[] = [], field = '', quoted = false, afterQuote = false;
    const pushField = () => { row.push(field); field = ''; afterQuote = false; };
    const pushRow = () => {
        pushField();
        records.push(row);
        row = [];
        requireThat(records.length <= maxRows + 1, 413, 'IMPORT_ROW_LIMIT', `Imports are limited to ${maxRows} rows`);
    };
    for (let i = 0; i < input.length; i++) {
        const ch = input[i]!;
        if (quoted) {
            if (ch === '"' && input[i + 1] === '"') {
                field += '"';
                i++;
            }
            else if (ch === '"') {
                quoted = false;
                afterQuote = true;
            }
            else
                field += ch;
        }
        else if (ch === ',')
            pushField();
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && input[i + 1] === '\n')
                i++;
            pushRow();
        }
        else if (ch === '"') {
            requireThat(field === '' && !afterQuote, 400, 'INVALID_CSV', 'Quote in an unquoted field');
            quoted = true;
        }
        else {
            requireThat(!afterQuote, 400, 'INVALID_CSV', 'Unexpected character after a closing quote');
            field += ch;
        }
    }
    requireThat(!quoted, 400, 'INVALID_CSV', 'Unclosed quoted CSV field');
    if (field !== '' || row.length || afterQuote)
        pushRow();
    const columns = records.shift() ?? [];
    requireThat(columns.length > 0 && columns.length <= 200 && columns.every(c => c.trim().length > 0 && c.length <= 256), 400, 'INVALID_HEADERS', 'CSV needs 1–200 nonempty column names');
    requireThat(new Set(columns).size === columns.length, 400, 'DUPLICATE_HEADERS', 'Duplicate CSV column names');
    const rows = records.map((record, index) => {
        requireThat(record.length === columns.length, 400, 'CSV_WIDTH', `CSV row ${index + 2} has the wrong number of fields`);
        const parsed: Record<string, Json> = {};
        for (const [columnIndex, column] of columns.entries()) {
            const field = record[columnIndex];
            requireThat(field !== undefined, 400, 'CSV_WIDTH', `CSV row ${index + 2} has the wrong number of fields`);
            parsed[column] = field;
        }
        return parsed;
    });
    return { columns, rows };
}
export function parseInput(source: string, format: InputPreview['format']) {
    requireThat(Buffer.byteLength(source) <= 2000000, 413, 'IMPORT_BYTE_LIMIT', 'Import previews are limited to 2 MB');
    if (format === 'csv')
        return parseCsv(source);
    let parsed: unknown;
    try {
        parsed = format === 'ndjson' ? source.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)) : JSON.parse(source);
    }
    catch {
        throw new AppError(400, 'INVALID_JSON', 'The uploaded JSON is invalid');
    }
    requireThat(Array.isArray(parsed) && parsed.length > 0 && parsed.length <= 10000, 400, 'IMPORT_ROWS', 'Upload an array of 1–10,000 JSON objects');
    const columns = new Set<string>();
    const rows = parsed.map(value => {
        const validated = validateJson(value);
        requireThat(isJsonObject(validated), 400, 'IMPORT_OBJECT', 'Every JSON row must be an object');
        for (const key of Object.keys(validated)) {
            requireThat(key.length > 0 && key.length <= 256, 400, 'INVALID_HEADERS', 'Invalid JSON field name');
            columns.add(key);
        }
        return validated;
    });
    requireThat(columns.size > 0 && columns.size <= 200, 400, 'IMPORT_COLUMNS', 'Import previews support 1–200 columns');
    return { columns: [...columns], rows };
}
export interface ImportJob {
    id: string;
    owner: string;
    inputId: string;
    connectionId: string;
    table: string;
    queryId: string;
    rows: number;
    createdAt: string;
    status: 'running' | 'succeeded' | 'unknown';
    error?: string;
    reconciliationRequired?: boolean;
    reviewedAt?: string;
}
export interface ImportDriver {
    schema(connectionId: string): Promise<Schema>;
    allowed(connectionId: string, table: string): boolean;
    insert(connectionId: string, table: string, rows: Record<string, Json>[], queryId: string): Promise<void>;
    inspectInsert(connectionId: string, queryId: string): Promise<'running' | 'succeeded' | 'unknown'>;
}
interface Mapping {
    id: string;
    owner: string;
    inputId: string;
    connectionId: string;
    table: string;
    fields: Record<string, string>;
    schemaHash: string;
    rows: Record<string, Json>[];
    expiresAt: string;
}
export class ImportService {
    constructor(private readonly store: Store, private readonly driver: ImportDriver, private readonly trusted: (p: Principal, c: string) => boolean) {
        for (const job of store.list<ImportJob>('imports'))
            if (job.status === 'running') {
                job.status = 'unknown';
                job.reconciliationRequired = true;
                job.error = 'Application restarted during insertion. Inspect the destination; do not retry blindly.';
                store.put('imports', job.id, job);
            }
    }
    preview(principal: Principal, name: string, source: string, format: InputPreview['format']): InputPreview {
        canWrite(principal);
        this.sweep();
        requireThat(this.store.count('inputs') < 20, 429, 'INPUT_CAPACITY', 'Remove an older preview before uploading another file');
        const parsed = parseInput(source, format);
        requireThat(parsed.rows.length > 0, 400, 'IMPORT_EMPTY', 'The input contains no data rows');
        const input: InputPreview = { id: randomUUID(), owner: principal.id, name: name.slice(0, 128), format, ...parsed,
            createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
        this.store.put('inputs', input.id, input);
        audit(this.store, principal, 'import.preview', input.id);
        return input;
    }
    get(principal: Principal, id: string): InputPreview {
        const input = this.store.get<InputPreview>('inputs', id);
        requireThat(input, 404, 'NOT_FOUND', 'Input preview not found');
        mustOwn(principal, input.owner);
        requireThat(Date.parse(input.expiresAt) > Date.now(), 410, 'INPUT_EXPIRED', 'This preview expired; upload the input again');
        return input;
    }
    getJob(principal: Principal, id: string): ImportJob {
        const job = this.store.get<ImportJob>('imports', id);
        requireThat(job, 404, 'NOT_FOUND', 'Import job not found');
        mustOwn(principal, job.owner);
        return job;
    }
    listRecoverable(principal: Principal, connectionId?: string): ImportJob[] {
        return this.store.list<ImportJob>('imports').filter(job => job.owner === principal.id &&
            (!connectionId || job.connectionId === connectionId) &&
            (job.status === 'running' || (job.status === 'unknown' && !job.reviewedAt)))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    async map(principal: Principal, inputId: string, connectionId: string, table: string, fields: Record<string, string>): Promise<Mapping> {
        canWrite(principal);
        const input = this.get(principal, inputId);
        requireThat(this.trusted(principal, connectionId), 403, 'WORKSPACE_UNTRUSTED', 'Trust the destination connection first');
        requireThat(this.driver.allowed(connectionId, table), 403, 'IMPORT_NOT_ALLOWED', 'Choose a valid table in a visible non-system database');
        const schema = await this.driver.schema(connectionId);
        const columns = targetColumns(schema, table);
        const destinations = Object.values(fields);
        requireThat(destinations.length > 0 && new Set(destinations).size === destinations.length, 400, 'IMPORT_MAPPING', 'Each destination column must be mapped once');
        for (const [source, destination] of Object.entries(fields)) {
            requireThat(input.columns.includes(source) && columns.some(c => c.name === destination && !['MATERIALIZED', 'ALIAS'].includes(c.defaultKind)), 400, 'IMPORT_MAPPING', 'Mapping references an unknown source or a non-writable destination column');
        }
        // No model-inferred coercion is applied. Strings stay strings; server type errors remain visible.
        const rows = input.rows.map(row => {
            const mapped: Record<string, Json> = {};
            for (const [source, destination] of Object.entries(fields)) {
                requireThat(Object.hasOwn(row, source), 400, 'IMPORT_MISSING_FIELD', `An input row is missing ${source}`);
                const value = row[source];
                requireThat(value !== undefined, 400, 'IMPORT_MISSING_FIELD', `An input row is missing ${source}`);
                mapped[destination] = value;
            }
            return mapped;
        });
        const mapping: Mapping = { id: randomUUID(), owner: principal.id, inputId, connectionId, table, fields,
            schemaHash: hash(columns), rows, expiresAt: input.expiresAt };
        this.store.put('mappings', mapping.id, mapping);
        return mapping;
    }
    async commit(principal: Principal, mappingId: string, confirmation: string): Promise<ImportJob> {
        canWrite(principal);
        const mapping = this.store.get<Mapping>('mappings', mappingId);
        requireThat(mapping, 404, 'NOT_FOUND', 'Mapping not found');
        mustOwn(principal, mapping.owner);
        const old = this.store.get<ImportJob>('imports', mappingId);
        if (old)
            return old;
        const unresolved = this.store.list<ImportJob>('imports').find(job => job.owner === principal.id &&
            job.connectionId === mapping.connectionId && job.table === mapping.table &&
            (job.status === 'running' || (job.status === 'unknown' && !job.reviewedAt)));
        requireThat(!unresolved, 409, 'IMPORT_UNRESOLVED', 'Review or reconcile the previous import to this table before starting another write');
        this.get(principal, mapping.inputId);
        requireThat(this.trusted(principal, mapping.connectionId) && this.driver.allowed(mapping.connectionId, mapping.table), 403, 'IMPORT_NOT_ALLOWED', 'Destination trust or availability changed');
        requireThat(confirmation === `INSERT ${mapping.rows.length} ROWS`, 400, 'IMPORT_CONFIRMATION', 'Confirm the exact row count before inserting');
        const schema = await this.driver.schema(mapping.connectionId);
        requireThat(hash(targetColumns(schema, mapping.table)) === mapping.schemaHash, 409, 'SCHEMA_CHANGED', 'The destination schema changed; review a new mapping');
        requireThat(this.trusted(principal, mapping.connectionId) && this.driver.allowed(mapping.connectionId, mapping.table), 403, 'IMPORT_NOT_ALLOWED', 'Destination trust or availability changed during schema validation');
        const existing = this.store.get<ImportJob>('imports', mappingId);
        if (existing)
            return existing;
        const stillUnresolved = this.store.list<ImportJob>('imports').find(job => job.owner === principal.id &&
            job.connectionId === mapping.connectionId && job.table === mapping.table &&
            (job.status === 'running' || (job.status === 'unknown' && !job.reviewedAt)));
        requireThat(!stillUnresolved, 409, 'IMPORT_UNRESOLVED', 'Review or reconcile the previous import to this table before starting another write');
        const job: ImportJob = { id: mappingId, owner: principal.id, inputId: mapping.inputId, connectionId: mapping.connectionId,
            table: mapping.table, queryId: `clickstudio-import-${randomUUID()}`, rows: mapping.rows.length, status: 'running', createdAt: new Date().toISOString() };
        this.store.put('imports', job.id, job);
        audit(this.store, principal, 'import.commit', job.id);
        try {
            await this.driver.insert(mapping.connectionId, mapping.table, mapping.rows, job.queryId);
            job.status = 'succeeded';
        }
        catch (error) {
            job.status = 'unknown';
            job.reconciliationRequired = true;
            job.error = `${asError(error).message} The insert may have partially completed. Check the table before retrying.`;
        }
        this.store.put('imports', job.id, job);
        return job;
    }
    async reconcile(principal: Principal, id: string): Promise<ImportJob> {
        const job = this.getJob(principal, id);
        if (job.status === 'succeeded' || (job.status === 'running' && !job.reconciliationRequired))
            return job;
        requireThat(this.trusted(principal, job.connectionId), 403, 'WORKSPACE_UNTRUSTED', 'Trust this connection before checking ClickHouse import status');
        const previous = { status: job.status, error: job.error, reconciliationRequired: job.reconciliationRequired };
        const evidence = await this.driver.inspectInsert(job.connectionId, job.queryId);
        if (evidence === 'succeeded') {
            job.status = 'succeeded';
            job.error = undefined;
            job.reconciliationRequired = false;
        }
        else if (evidence === 'running') {
            job.status = 'running';
            job.error = 'ClickHouse still reports this insert as active.';
            job.reconciliationRequired = true;
        }
        else {
            job.status = 'unknown';
            job.error = 'ClickHouse could not confirm the insert. The rows may already be there.';
            job.reconciliationRequired = false;
        }
        const changed = job.status !== previous.status || job.error !== previous.error || job.reconciliationRequired !== previous.reconciliationRequired;
        if (changed)
            this.store.put('imports', job.id, job);
        if (job.status !== previous.status)
            audit(this.store, principal, 'import.reconcile', job.id);
        return job;
    }
    async review(principal: Principal, id: string, inspected: boolean, noActiveInsert: boolean): Promise<ImportJob> {
        canWrite(principal);
        requireThat(inspected && noActiveInsert, 400, 'IMPORT_REVIEW_CONFIRMATION', 'Confirm that you inspected the destination and no insert is still active');
        const job = this.getJob(principal, id);
        if (job.reviewedAt)
            return job;
        requireThat(job.status === 'unknown', 409, 'IMPORT_NOT_UNKNOWN', 'Only an import with an unknown outcome can be reviewed');
        requireThat(this.trusted(principal, job.connectionId), 403, 'WORKSPACE_UNTRUSTED', 'Trust this connection before reviewing an import');
        const previousStatus = job.status;
        const evidence = await this.driver.inspectInsert(job.connectionId, job.queryId);
        if (evidence === 'succeeded') {
            job.status = 'succeeded';
            job.error = undefined;
            job.reconciliationRequired = false;
        }
        else if (evidence === 'running') {
            job.status = 'running';
            job.error = 'ClickHouse still reports this insert as active.';
            job.reconciliationRequired = true;
        }
        else {
            job.reviewedAt = new Date().toISOString();
            job.reconciliationRequired = false;
            audit(this.store, principal, 'import.review', job.id);
        }
        this.store.put('imports', job.id, job);
        if (job.status !== previousStatus)
            audit(this.store, principal, 'import.reconcile', job.id);
        return job;
    }
    remove(principal: Principal, id: string) {
        canWrite(principal);
        this.get(principal, id);
        this.store.delete('inputs', id);
        for (const m of this.store.list<Mapping>('mappings'))
            if (m.inputId === id)
                this.store.delete('mappings', m.id);
        audit(this.store, principal, 'input.delete', id);
    }
    sweep() {
        for (const bucket of ['inputs', 'mappings'])
            for (const item of this.store.list<{
                id: string;
                expiresAt: string;
            }>(bucket))
                if (Date.parse(item.expiresAt) <= Date.now())
                    this.store.delete(bucket, item.id);
    }
}
function targetColumns(schema: Schema, table: string): SchemaColumn[] {
    const matches = schema.columns.filter(c => `${c.database}.${c.table}` === table);
    requireThat(matches.length > 0, 400, 'UNKNOWN_TABLE', 'Destination table not found');
    return matches;
}
export function quotedTable(table: string): string {
    const parts = table.split('.');
    requireThat(parts.length === 2 && parts.every(Boolean), 400, 'TABLE_NAME', 'Use database.table for import destinations');
    return parts.map(quoteIdentifier).join('.');
}
