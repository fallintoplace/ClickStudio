import { StringDecoder } from 'node:string_decoder';
import type { Column, Json, Limits, Row } from '../shared/types.js';
import { AppError, requireThat } from './errors.js';
import type { DriverResult } from './runs.js';

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}
function isJson(value: unknown): value is Json {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return true;
    if (typeof value === 'number')
        return Number.isFinite(value);
    if (Array.isArray(value))
        return value.every(isJson);
    return value !== null && typeof value === 'object' && Object.values(value).every(isJson);
}
function isRow(value: unknown): value is Row {
    return Array.isArray(value) && value.every(isJson);
}
/** Bounded parsing before JSON.parse: even one very large string cannot grow without limit. */
export async function collectCompactStream(stream: AsyncIterable<Buffer | string>, limits: Pick<Limits, 'rows' | 'bytes'>): Promise<DriverResult> {
    const decoder = new StringDecoder('utf8');
    let pending = '', stage = 0, names: string[] = [], columns: Column[] = [];
    let bytes = 0, truncated = false;
    const rows: Row[] = [];
    const consume = (line: string) => {
        if (!line.trim())
            return;
        const size = Buffer.byteLength(line);
        if (bytes + size > limits.bytes) {
            if (stage < 2)
                throw new AppError(413, 'METADATA_TOO_LARGE', 'Result metadata exceeds the configured byte limit');
            truncated = true;
            return;
        }
        if (stage >= 2 && rows.length >= limits.rows) {
            truncated = true;
            return;
        }
        let data: unknown;
        try {
            data = JSON.parse(line);
        }
        catch {
            throw new AppError(502, 'RESULT_STREAM_ERROR', 'ClickHouse interrupted the result stream or returned invalid data. Inspect this query ID on the server.');
        }
        requireThat(Array.isArray(data), 502, 'RESULT_FORMAT', 'Expected a compact JSON row');
        if (stage < 2) {
            requireThat(isStringArray(data) && data.length > 0 && data.length <= 500, 502, 'RESULT_METADATA', 'Invalid names/types header');
            if (stage === 0)
                names = data;
            else {
                requireThat(data.length === names.length, 502, 'RESULT_METADATA', 'Column names and types differ');
                columns = names.map((name, i) => {
                    const type = data[i];
                    requireThat(type !== undefined, 502, 'RESULT_METADATA', 'Column names and types differ');
                    return { name, type };
                });
            }
            bytes += size;
            stage++;
            return;
        }
        requireThat(isRow(data), 502, 'RESULT_FORMAT', 'Expected a compact JSON row');
        requireThat(data.length === columns.length, 502, 'RESULT_WIDTH', 'Unexpected number of fields in a result row');
        rows.push(data);
        bytes += size;
    };
    outer: for await (const chunk of stream) {
        pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            consume(line);
            if (truncated)
                break outer;
        }
        // Limit an unterminated row before it is parsed. Exiting for-await closes the source stream.
        if (Buffer.byteLength(pending) + bytes > limits.bytes) {
            requireThat(stage >= 2, 413, 'METADATA_TOO_LARGE', 'Result metadata exceeds the configured byte limit');
            truncated = true;
            break;
        }
    }
    if (!truncated) {
        pending += decoder.end();
        if (pending.trim())
            consume(pending);
    }
    requireThat(stage === 2, 502, 'RESULT_INCOMPLETE', 'The server did not return a complete result header');
    return { columns, rows, bytes, truncated, bounded: { rows: limits.rows, bytes: limits.bytes } };
}
