export interface Statement {
    sql: string;
    from: number;
    to: number;
}
export interface Token {
    text: string;
    from: number;
    to: number;
    kind: 'word' | 'quoted' | 'symbol';
}
export class SqlSyntaxError extends Error {
    constructor(message: string, public readonly position: number) { super(message); }
}
export const EXPLORATION_FORMAT_ERROR = 'FORMAT is not allowed in exploration SQL';
/** A boundary lexer, not a SQL parser or an authorization boundary. */
export function lexSql(sql: string): Token[] {
    const out: Token[] = [];
    for (let i = 0; i < sql.length;) {
        const start = i, ch = sql[i]!;
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (sql.startsWith('--', i) || ch === '#') {
            while (i < sql.length && sql[i] !== '\n')
                i++;
            continue;
        }
        if (sql.startsWith('/*', i)) {
            i += 2;
            let depth = 1;
            while (i < sql.length && depth) {
                if (sql.startsWith('/*', i)) {
                    depth++;
                    i += 2;
                }
                else if (sql.startsWith('*/', i)) {
                    depth--;
                    i += 2;
                }
                else
                    i++;
            }
            if (depth)
                throw new SqlSyntaxError('Unclosed block comment', start);
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            i++;
            let closed = false;
            while (i < sql.length) {
                if (sql[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (sql[i] === ch) {
                    if (sql[i + 1] === ch) {
                        i += 2;
                        continue;
                    }
                    i++;
                    closed = true;
                    break;
                }
                i++;
            }
            if (!closed)
                throw new SqlSyntaxError('Unclosed quoted value or identifier', start);
            out.push({ text: sql.slice(start, i), from: start, to: i, kind: 'quoted' });
            continue;
        }
        if (ch === '$') {
            const marker = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
            if (marker) {
                const end = sql.indexOf(marker, i + marker.length);
                if (end < 0)
                    throw new SqlSyntaxError('Unclosed heredoc', start);
                i = end + marker.length;
                out.push({ text: sql.slice(start, i), from: start, to: i, kind: 'quoted' });
                continue;
            }
        }
        if (/[A-Za-z_]/.test(ch)) {
            i++;
            while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i]!))
                i++;
            out.push({ text: sql.slice(start, i), from: start, to: i, kind: 'word' });
        }
        else {
            i++;
            out.push({ text: ch, from: start, to: i, kind: 'symbol' });
        }
    }
    return out;
}

export function hasTopLevelOutputFormat(sql: string): boolean {
    const tokens = lexSql(sql);
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (token.kind === 'symbol') {
            if (token.text === '(') depth++;
            else if (token.text === ')') depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth !== 0 || token.kind !== 'word' || token.text.toUpperCase() !== 'FORMAT')
            continue;
        if (tokens[i + 1]?.kind !== 'word')
            continue;
        let afterFormat = i + 2;
        if (tokens[afterFormat]?.kind === 'symbol' && tokens[afterFormat]?.text === ';')
            afterFormat++;
        if (afterFormat === tokens.length)
            return true;
    }
    return false;
}

export function splitSql(sql: string): Statement[] {
    const tokens = lexSql(sql), result: Statement[] = [];
    let from = 0, meaningful = false;
    for (const token of tokens) {
        if (token.text === ';' && token.kind === 'symbol') {
            if (meaningful)
                result.push(trimStatement(sql, from, token.from));
            from = token.to;
            meaningful = false;
        }
        else
            meaningful = true;
    }
    if (meaningful)
        result.push(trimStatement(sql, from, sql.length));
    return result;
}
function trimStatement(sql: string, from: number, to: number): Statement {
    while (from < to && /\s/.test(sql[from]!))
        from++;
    while (to > from && /\s/.test(sql[to - 1]!))
        to--;
    return { sql: sql.slice(from, to), from, to };
}
export function selectedStatement(sql: string, from: number, to = from): Statement | undefined {
    if (to > from) {
        const selection = trimStatement(sql, from, to);
        return splitSql(selection.sql).length ? selection : undefined;
    }
    const all = splitSql(sql);
    return all.find(s => from >= s.from && from <= s.to) ??
        all.find(s => s.from > from) ?? all.at(-1);
}

export function hasSqlComments(sql: string): boolean {
    return protectedSqlRanges(sql).some(range =>
        sql.startsWith('--', range.from) || sql[range.from] === '#' || sql.startsWith('/*', range.from));
}

function protectedSqlRanges(sql: string): Array<{ from: number; to: number }> {
    const ranges: Array<{ from: number; to: number }> = [];
    for (let i = 0; i < sql.length;) {
        const from = i, ch = sql[i]!;
        if (sql.startsWith('--', i) || ch === '#') {
            const newline = sql.indexOf('\n', i);
            i = newline < 0 ? sql.length : newline;
        }
        else if (sql.startsWith('/*', i)) {
            i += 2;
            let depth = 1;
            while (i < sql.length && depth) {
                if (sql.startsWith('/*', i)) { depth++; i += 2; }
                else if (sql.startsWith('*/', i)) { depth--; i += 2; }
                else i++;
            }
        }
        else if (ch === "'" || ch === '"' || ch === '`') {
            i++;
            while (i < sql.length) {
                if (sql[i] === '\\') { i = Math.min(sql.length, i + 2); continue; }
                if (sql[i] === ch) {
                    if (sql[i + 1] === ch) { i += 2; continue; }
                    i++;
                    break;
                }
                i++;
            }
        }
        else if (ch === '$') {
            const marker = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
            if (marker) {
                const end = sql.indexOf(marker, i + marker.length);
                i = end < 0 ? sql.length : end + marker.length;
            }
            else i++;
        }
        else { i++; continue; }
        ranges.push({ from, to: i });
    }
    return ranges;
}

/**
 * A conservative layout helper for the editor. It only changes whitespace and
 * clause boundaries; quoted values and comments are protected byte-for-byte.
 * This is intentionally a formatter, not a SQL parser or a semantic rewrite.
 */
export function formatSql(sql: string): string {
    const protectedParts: string[] = [];
    let markerPrefix = '\uE000WB_FMT_';
    while (sql.includes(markerPrefix)) markerPrefix += '_';
    const protectedText = (value: string) => {
        const marker = `${markerPrefix}${protectedParts.length}\uE001`;
        protectedParts.push(value);
        return marker;
    };
    let masked = '';
    let from = 0;
    for (const range of protectedSqlRanges(sql)) {
        masked += sql.slice(from, range.from);
        masked += protectedText(sql.slice(range.from, range.to));
        from = range.to;
    }
    masked += sql.slice(from);
    masked = masked.replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim();
    masked = masked.replace(/\s*;\s*/g, ';\n');
    masked = masked.replace(/\s+(FROM|PREWHERE|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|UNION ALL|UNION DISTINCT|SETTINGS|FORMAT)\b/gi, (_match, keyword: string) => `\n${keyword.toUpperCase()}`);
    masked = masked.replace(/\s+(LEFT|RIGHT|FULL|INNER|CROSS)?\s*JOIN\b/gi, (_match, side: string | undefined) => `\n${side ? `${side.toUpperCase()} ` : ''}JOIN`);
    masked = masked.replace(/\s+(AND|OR)\s+/gi, (_match, keyword: string) => `\n  ${keyword.toUpperCase()} `);
    masked = masked.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
    for (let index = 0; index < protectedParts.length; index++)
        masked = masked.replaceAll(`${markerPrefix}${index}\uE001`, protectedParts[index]!);
    return masked;
}
export function quoteIdentifier(name: string): string {
    return '`' + name.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}

export function quoteStringLiteral(value: string): string {
    return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

export interface SqlParameter {
    name: string;
    type: string;
}

export function parameterNames(sql: string): SqlParameter[] {
    const tokens = lexSql(sql), out = new Map<string, string>();
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i]?.text !== '{' || tokens[i + 1]?.kind !== 'word' || tokens[i + 2]?.text !== ':')
            continue;
        const name = tokens[i + 1]!.text, start = tokens[i + 2]!.to;
        let end = i + 3;
        while (end < tokens.length && tokens[end]!.text !== '}')
            end++;
        if (end === tokens.length)
            throw new SqlSyntaxError('Unclosed parameter', tokens[i]!.from);
        const type = sql.slice(start, tokens[end]!.from).trim();
        if (!type || (out.has(name) && out.get(name) !== type))
            throw new SqlSyntaxError('Conflicting parameter type', start);
        out.set(name, type);
        i = end;
    }
    return [...out].map(([name, type]) => ({ name, type }));
}
