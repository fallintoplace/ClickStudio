export type NativeParserStatus = 'loading' | 'ready' | 'unavailable';

export interface NativeParseError {
    message: string;
    begin?: number;
    end?: number;
    line?: number;
    column?: number;
    expected?: string[];
}

export type NativeHighlightType =
    | 'keyword'
    | 'identifier'
    | 'function'
    | 'alias'
    | 'substitution'
    | 'number'
    | 'string'
    | 'string_escape'
    | 'string_metacharacter';

export interface NativeHighlight {
    begin: number;
    end: number;
    type: NativeHighlightType;
}

export interface NativeParseResult {
    error?: NativeParseError;
    highlights?: NativeHighlight[];
    ast?: unknown | null;
    ast_error?: string;
}

export interface NativeParseStatement {
    from: number;
    to: number;
    sql: string;
    result: NativeParseResult;
}

export interface NativeParseSnapshot {
    statements: NativeParseStatement[];
    elapsedMs: number;
}

export interface NativeHighlightRange {
    from: number;
    to: number;
    type: NativeHighlightType;
}

export interface NativeFormatResult {
    sql?: string;
    error?: NativeParseError;
}

export type NativeParserRequest = {
    id: number;
    kind: 'parseMany' | 'formatMany';
    sql: string[];
};
export type NativeParserReply =
    | { id: number; kind: 'parseMany'; ok: true; results: NativeParseResult[] }
    | { id: number; kind: 'formatMany'; ok: true; results: NativeFormatResult[] }
    | { id: number; kind: NativeParserRequest['kind']; ok: false; message: string };
export type NativeParserWorkerStatus = {
    kind: 'status';
    status: Exclude<NativeParserStatus, 'loading'>;
    reason?: string;
};

export interface NativeDiagnostic {
    from: number;
    to: number;
    message: string;
}

const encoder = new TextEncoder();
const nativeHighlightTypes = [
    'keyword',
    'identifier',
    'function',
    'alias',
    'substitution',
    'number',
    'string',
    'string_escape',
    'string_metacharacter',
] as const satisfies readonly NativeHighlightType[];

function isNativeHighlightType(value: unknown): value is NativeHighlightType {
    return typeof value === 'string' && nativeHighlightTypes.some(type => type === value);
}
function isOffset(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNativeError(value: unknown): NativeParseError | undefined {
    if (!isRecord(value) || typeof value.message !== 'string') return undefined;
    const expected = Array.isArray(value.expected)
        ? value.expected.filter((item): item is string => typeof item === 'string')
        : undefined;
    return {
        message: value.message,
        ...(typeof value.begin === 'number' ? { begin: value.begin } : {}),
        ...(typeof value.end === 'number' ? { end: value.end } : {}),
        ...(typeof value.line === 'number' ? { line: value.line } : {}),
        ...(typeof value.column === 'number' ? { column: value.column } : {}),
        ...(expected?.length ? { expected } : {}),
    };
}

function parseNativeHighlight(value: unknown): NativeHighlight | undefined {
    if (
        !isRecord(value) ||
        !isOffset(value.begin) ||
        !isOffset(value.end) ||
        value.end <= value.begin ||
        !isNativeHighlightType(value.type)
    )
        return undefined;
    return { begin: value.begin, end: value.end, type: value.type };
}

export function parseNativeParseResult(value: unknown): NativeParseResult {
    if (!isRecord(value)) throw new Error('ClickHouse parser returned an invalid response');
    const error = value.error === undefined ? undefined : parseNativeError(value.error);
    if (value.error !== undefined && !error)
        throw new Error('ClickHouse parser returned invalid diagnostics');
    let highlights;

    if (value.highlights === undefined) {
        highlights = undefined;
    } else if (Array.isArray(value.highlights)) {
        highlights = value.highlights
            .map(parseNativeHighlight)
            .filter((item): item is NativeHighlight => Boolean(item));
    } else {
        highlights = undefined;
    }
    const result: NativeParseResult = {};
    if (error) result.error = error;
    if (highlights) result.highlights = highlights;
    if (Object.hasOwn(value, 'ast')) result.ast = value.ast;
    if (typeof value.ast_error === 'string') result.ast_error = value.ast_error;
    return result;
}

export function utf8ByteOffsetToUtf16Index(value: string, byteOffset: number): number {
    if (!Number.isFinite(byteOffset) || byteOffset <= 0) return 0;
    let bytes = 0,
        index = 0;
    for (const character of value) {
        const width = encoder.encode(character).length;
        if (bytes + width > byteOffset) break;
        bytes += width;
        index += character.length;
    }
    return Math.min(index, value.length);
}

export function sourcePositionFromUtf8ByteOffset(
    value: string,
    byteOffset: number,
    sourceFrom: number,
    sourceTo: number,
    prefixBytes = 0,
): number {
    const localPosition = utf8ByteOffsetToUtf16Index(value, byteOffset - prefixBytes);
    return Math.max(sourceFrom, Math.min(sourceTo, sourceFrom + localPosition));
}

function offsetFromLineColumn(
    value: string,
    line: number | undefined,
    column: number | undefined,
): number {
    if (line === undefined || column === undefined || line < 1 || column < 1) return 0;
    let start = 0,
        current = 1;
    while (current < line) {
        const next = value.indexOf('\n', start);
        if (next < 0) return value.length;
        start = next + 1;
        current++;
    }
    const end = value.indexOf('\n', start);
    const text = value.slice(start, end < 0 ? value.length : end);
    return start + utf8ByteOffsetToUtf16Index(text, column - 1);
}

function clickHouseErrorLocation(message: string) {
    const match = message.match(
        /^(.+?): failed at position \d+ \(([^)]*)\) \(line\s+(\d+),\s*col(?:umn)?\s+(\d+)\):/i,
    );
    if (!match) return undefined;
    const kind = match[1],
        line = Number(match[3]),
        column = Number(match[4]);
    if (
        kind === undefined ||
        !Number.isSafeInteger(line) ||
        line < 1 ||
        !Number.isSafeInteger(column) ||
        column < 1
    )
        return undefined;
    return {
        kind: kind.replace(/\s+\([^)]*\)$/, '').trim(),
        token: (match[2] ?? '').trim(),
        line,
        column,
    };
}

function compactNativeErrorMessage(
    error: NativeParseError,
    location: ReturnType<typeof clickHouseErrorLocation>,
): string {
    const firstLine = (error.message.split(/\r?\n|Expected one of:/i, 1)[0] ?? '').trim();
    let summary: string;

    if (location) {
        summary = `${location.kind} · line ${location.line}, column ${location.column}${location.token ? ` · near “${location.token.slice(0, 40)}${location.token.length > 40 ? '…' : ''}”` : ''}`;
    } else if (firstLine.length > 160) {
        summary = `${firstLine.slice(0, 159)}…`;
    } else {
        summary = firstLine;
    }
    const expected = error.expected?.length
        ? `Expected: ${error.expected.slice(0, 8).join(' · ')}${error.expected.length > 8 ? ' · …' : ''}`
        : '';
    return [summary || 'ClickHouse parser reported a syntax error.', expected]
        .filter(Boolean)
        .join('\n');
}

export function nativeDiagnosticForStatement(
    sql: string,
    statementFrom: number,
    error: NativeParseError,
): NativeDiagnostic {
    const messageLocation = clickHouseErrorLocation(error.message);
    const localFrom =
        error.begin === undefined
            ? offsetFromLineColumn(
                  sql,
                  error.line ?? messageLocation?.line,
                  error.column ?? messageLocation?.column,
              )
            : utf8ByteOffsetToUtf16Index(sql, error.begin);
    const unexpectedToken =
        messageLocation?.token && sql.startsWith(messageLocation.token, localFrom)
            ? messageLocation.token
            : undefined;
    const localTo =
        error.end === undefined
            ? Math.min(sql.length, localFrom + (unexpectedToken?.length ?? 1))
            : utf8ByteOffsetToUtf16Index(sql, error.end);
    return {
        from: statementFrom + localFrom,
        to: statementFrom + Math.max(localFrom, localTo),
        message: compactNativeErrorMessage(error, messageLocation),
    };
}

export function nativeHighlightRanges(
    sql: string,
    statementFrom: number,
    highlights: readonly NativeHighlight[] = [],
): NativeHighlightRange[] {
    const byteLength = encoder.encode(sql).length;
    return highlights.flatMap(highlight => {
        if (highlight.begin < 0 || highlight.end <= highlight.begin || highlight.end > byteLength)
            return [];
        const from = statementFrom + utf8ByteOffsetToUtf16Index(sql, highlight.begin);
        const to = statementFrom + utf8ByteOffsetToUtf16Index(sql, highlight.end);
        return to > from ? [{ from, to, type: highlight.type }] : [];
    });
}
