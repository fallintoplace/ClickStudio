import { lexSql, type Token } from '../../../sql/sql.js';

export interface TableReference {
    database: string;
    table: string;
}
export interface MaterializedViewDefinition {
    mode: 'incremental' | 'refreshable' | 'append-incremental' | 'unknown';
    schedule?: string;
    target?: TableReference;
    dependsOn: TableReference[];
}

const word = (token: Token | undefined, value: string) =>
    token?.kind === 'word' && token.text.toUpperCase() === value;
function identifier(token: Token | undefined): string | undefined {
    if (token?.kind === 'word') return token.text;
    if (token?.kind !== 'quoted' || !['`', '"'].includes(token.text[0]!)) return undefined;
    const quote = token.text[0]!;
    const escapes: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        '0': '\0',
    };
    return token.text
        .slice(1, -1)
        .replaceAll(quote + quote, quote)
        .replace(/\\(.)/gs, (_, character: string) => escapes[character] ?? character);
}
function reference(
    tokens: Token[],
    start: number,
    database: string,
): { value: TableReference; next: number } | undefined {
    const first = identifier(tokens[start]);
    if (!first) return undefined;
    if (tokens[start + 1]?.text !== '.')
        return { value: { database, table: first }, next: start + 1 };
    const second = identifier(tokens[start + 2]);
    return second ? { value: { database: first, table: second }, next: start + 3 } : undefined;
}

function viewHeader(tokens: Token[], next: number): Token[] {
    // Column definitions and engine arguments can contain identifiers named REFRESH or TO.
    const header: Token[] = [];
    let depth = 0;
    const headerStart =
        word(tokens[next], 'ON') && word(tokens[next + 1], 'CLUSTER') ? next + 3 : next;
    for (const token of tokens.slice(headerStart)) {
        if (token.kind === 'symbol' && token.text === '(') depth++;
        if (!depth && word(token, 'AS')) break;
        if (!depth) header.push(token);
        if (token.kind === 'symbol' && token.text === ')') depth = Math.max(0, depth - 1);
    }
    return header;
}

/** Read only the CREATE header; never guess SELECT lineage from SQL text. */
export function materializedViewDefinition(
    sql: string,
    database: string,
): MaterializedViewDefinition {
    const unknown: MaterializedViewDefinition = { mode: 'unknown', dependsOn: [] };
    let tokens: Token[];
    try {
        tokens = lexSql(sql);
    } catch {
        return unknown;
    }
    const view = tokens.findIndex(
        (token, index) => word(token, 'VIEW') && word(tokens[index - 1], 'MATERIALIZED'),
    );
    if (view < 0) return unknown;
    let start = view + 1;
    if (
        word(tokens[start], 'IF') &&
        word(tokens[start + 1], 'NOT') &&
        word(tokens[start + 2], 'EXISTS')
    )
        start += 3;
    const name = reference(tokens, start, database);
    if (!name) return unknown;
    const header = viewHeader(tokens, name.next);
    const refresh = header.findIndex(
        (token, index) =>
            word(token, 'REFRESH') &&
            (word(header[index + 1], 'EVERY') || word(header[index + 1], 'AFTER')),
    );
    const result: MaterializedViewDefinition = {
        mode: refresh < 0 ? 'incremental' : 'refreshable',
        dependsOn: [],
    };
    const target = header.findIndex(token => word(token, 'TO'));
    if (target >= 0 && !(word(header[target + 1], 'INNER') && word(header[target + 2], 'UUID')))
        result.target = reference(header, target + 1, database)?.value;
    if (refresh < 0) return result;
    const terminators = new Set([
        'DEPENDS',
        'APPEND',
        'TO',
        'ENGINE',
        'SETTINGS',
        'EMPTY',
        'SQL',
        'COMMENT',
        'POPULATE',
    ]);
    const end = header.findIndex(
        (token, index) =>
            index > refresh && token.kind === 'word' && terminators.has(token.text.toUpperCase()),
    );
    const last = header[(end < 0 ? header.length : end) - 1];
    if (last) result.schedule = sql.slice(header[refresh + 1]!.from, last.to).trim();
    if (
        header.some(
            (token, index) => word(token, 'APPEND') && word(header[index + 1], 'INCREMENTAL'),
        )
    )
        result.mode = 'append-incremental';
    const depends = header.findIndex(
        (token, index) => word(token, 'DEPENDS') && word(header[index + 1], 'ON'),
    );
    if (depends >= 0) {
        for (let index = depends + 2; index < header.length;) {
            const dependency = reference(header, index, database);
            if (!dependency) break;
            result.dependsOn.push(dependency.value);
            if (header[dependency.next]?.text !== ',') break;
            index = dependency.next + 1;
        }
    }
    return result;
}
