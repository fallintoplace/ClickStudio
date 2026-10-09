import type { ApiError } from '../shared/types.js';
import { lexSql } from '../shared/sql.js';
import { utf8ByteOffsetToUtf16Index } from '../shared/native-parser.js';

export type SqlErrorRange = { from: number; to: number };

function unknownFunctionName(message: string) {
    const named = /Function with name [`'\"]([^`'\"]+)[`'\"] does not exist/i.exec(message);
    if (named?.[1]) return named[1];
    const legacy = /Unknown function [`'\"]?([A-Za-z_][A-Za-z0-9_$]*)/i.exec(message);
    return legacy?.[1];
}

function identifier(token: ReturnType<typeof lexSql>[number]) {
    if (token.kind === 'word') return token.text;
    if (token.kind === 'quoted' && (token.text.startsWith('`') || token.text.startsWith('"'))) {
        const quote = token.text[0]!;
        return token.text.slice(1, -1).replaceAll(quote + quote, quote);
    }
    return undefined;
}

function unknownFunctionRange(sql: string, name: string): SqlErrorRange | undefined {
    try {
        const tokens = lexSql(sql), matches: SqlErrorRange[] = [];
        for (let index = 0; index < tokens.length - 1; index++) {
            const token = tokens[index]!;
            const tokenName = identifier(token);
            if (tokenName?.toLowerCase() === name.toLowerCase() && tokens[index + 1]!.text === '(')
                matches.push({ from: token.from, to: token.to });
        }
        return matches.length === 1 ? matches[0] : undefined;
    } catch {
        return undefined;
    }
}

function serverErrorPosition(sql: string, error: ApiError): number | undefined {
    if (error.position !== undefined)
        return Number.isSafeInteger(error.position) && error.position >= 0 && error.position <= sql.length ? error.position : undefined;
    const location = /\(line\s+(\d+),\s*col(?:umn)?\s+(\d+)\)/i.exec(error.message);
    if (!location) return undefined;
    const line = Number(location[1]), column = Number(location[2]);
    if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return undefined;
    let start = 0;
    for (let current = 1; current < line; current++) {
        const next = sql.indexOf('\n', start);
        if (next < 0) return undefined;
        start = next + 1;
    }
    const end = sql.indexOf('\n', start);
    const text = sql.slice(start, end < 0 ? sql.length : end);
    if (column - 1 > new TextEncoder().encode(text).length) return undefined;
    const offset = utf8ByteOffsetToUtf16Index(text, column - 1);
    if (new TextEncoder().encode(text.slice(0, offset)).length !== column - 1) return undefined;
    return start + offset;
}

export function sqlErrorLineColumn(sql: string, position: number) {
    const prefix = sql.slice(0, position), lines = prefix.split('\n');
    return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function sqlErrorExcerpt(sql: string, range?: SqlErrorRange) {
    if (!range || !Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 || range.to < range.from || range.to > sql.length) return sql;
    const end = sql.indexOf('\n', range.from);
    const lineEnd = end < 0 ? sql.length : end;
    const lineStart = range.from === 0 ? 0 : sql.lastIndexOf('\n', range.from - 1) + 1;
    const indent = sql.slice(lineStart, range.from).replace(/[^\t]/g, ' ');
    const marker = '^'.repeat(Math.max(1, Math.min(range.to, lineEnd) - range.from));
    return `${sql.slice(0, lineEnd)}\n${indent}${marker}${sql.slice(lineEnd)}`;
}

export function queryFailureSummary(error: ApiError) {
    const syntax = error.code === 'SYNTAX_ERROR' || /\bsyntax error\b/i.test(error.message);
    const token = syntax ? /failed at position \d+ \(([^)]+)\)/i.exec(error.message)?.[1]?.trim() : undefined;
    const message = error.message.split(/\r?\n|\s+In scope\s+|Expected one of:/i, 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
    return { syntax, token: token ? token.slice(0, 40) : undefined, message: message.length > 160 ? `${message.slice(0, 157).trimEnd()}…` : message };
}

/** Locate only a unique unknown-function call, or use an explicit server location. */
export function sqlErrorRange(sql: string, error: ApiError): SqlErrorRange | undefined {
    const name = unknownFunctionName(error.message);
    if (name) {
        const range = unknownFunctionRange(sql, name);
        if (range) return range;
    }
    const position = serverErrorPosition(sql, error);
    if (position !== undefined) return { from: position, to: Math.min(sql.length, position + 1) };
    return undefined;
}

/** Translate an error span from the submitted statement into the editor document. */
export function sqlErrorRangeInDraft(draft: string, statement: string, sourceFrom: number, error: ApiError, positionOrigin: 'statement' | 'draft' = 'statement'): SqlErrorRange | undefined {
    let offset = sourceFrom;
    if (draft.slice(offset, offset + statement.length) !== statement) {
        const first = draft.indexOf(statement);
        if (first < 0 || draft.indexOf(statement, first + 1) >= 0) return undefined;
        offset = first;
    }
    const statementError = positionOrigin === 'draft' && error.position !== undefined
        ? { ...error, position: error.position - sourceFrom }
        : error;
    const range = sqlErrorRange(statement, statementError);
    if (!range) return undefined;
    const from = offset + range.from, to = offset + range.to;
    return from >= 0 && to <= draft.length ? { from, to } : undefined;
}
