import type { ProfilePipeline, ProfilePipelineEdge, ProfilePipelineNode } from '../shared/types.js';
import { lexSql, type Token } from '../shared/sql.js';
import {
    asNativeAstObject as object,
    nativeAstChildren as children,
    walkNativeAst,
    type NativeAstObject,
} from '../shared/native-ast.js';
import type { NativeParseResult } from '../shared/native-parser.js';

type AstObject = NativeAstObject;
type SourceRange = { from: number; to: number };
type ClauseName =
    | 'WITH'
    | 'SELECT'
    | 'FROM'
    | 'PREWHERE'
    | 'WHERE'
    | 'GROUP BY'
    | 'HAVING'
    | 'WINDOW'
    | 'QUALIFY'
    | 'ORDER BY'
    | 'LIMIT'
    | 'OFFSET'
    | 'UNION';
type ClauseSpan = SourceRange & { name: ClauseName };
type Source = { name: string; detail: string; range?: SourceRange };
type FlowBranch = {
    sources: Source[];
    joins: string[];
    prewhere: boolean;
    where: boolean;
    groupBy: boolean;
    aggregates: string[];
    having: boolean;
    windows: string[];
    qualify: boolean;
    orderBy: boolean;
    limit: boolean;
    projection: string[];
};

export interface SqlFlowModel {
    pipeline: ProfilePipeline;
    sourceRanges: Map<string, SourceRange>;
    mode: 'native AST' | 'keyword estimate';
    parserError?: string;
}

const MAX_BRANCHES = 12;
const MAX_SOURCES_PER_BRANCH = 10;
const MAX_FLOW_NODES = 100;

function hasNode(value: unknown): boolean {
    return value !== undefined && value !== null;
}

function cleanIdentifier(value: string): string {
    return value
        .replace(/^`|`$/g, '')
        .replace(/^"|"$/g, '')
        .replace(/``/g, '`')
        .replace(/""/g, '"')
        .toLowerCase();
}

function identifierParts(value: AstObject): string[] {
    const parts = value.name_parts;
    if (Array.isArray(parts))
        return parts.filter((part): part is string => typeof part === 'string');
    return typeof value.name === 'string' ? value.name.split('.') : [];
}

function tableSources(
    query: AstObject,
    tokens: Token[],
    from: ClauseSpan | undefined,
    cteNames: Set<string>,
): Source[] {
    const sources: Source[] = [],
        seen = new Set<string>();
    walkNativeAst(query.tables, node => {
        if (node.type !== 'TableIdentifier') return;
        const parts = identifierParts(node);
        if (!parts.length) return;
        const name = parts.join('.');
        const alias = typeof node.alias === 'string' ? node.alias : undefined;
        const isCte = parts.length === 1 && cteNames.has(cleanIdentifier(parts[0]!));
        const label = isCte ? `CTE · ${parts[0]}` : name;
        const detail = isCte
            ? `Common table expression reference${alias ? ` · alias ${alias}` : ''}`
            : alias
              ? `Table source · alias ${alias}`
              : 'Table source';
        const tokenRange = findIdentifierRange(tokens, parts, from);
        const key = `${cleanIdentifier(name)}\u0000${cleanIdentifier(alias ?? '')}`;
        if (seen.has(key)) return;
        seen.add(key);
        sources.push({ name: label, detail, ...(tokenRange ? { range: tokenRange } : {}) });
    });
    if (!sources.length && from) {
        const firstSource = tokens.find(
            token =>
                token.from >= from.from &&
                token.to <= from.to &&
                (token.kind === 'quoted' ||
                    (token.kind === 'word' &&
                        ![
                            'FROM',
                            'JOIN',
                            'FINAL',
                            'SAMPLE',
                            'ARRAY',
                            'LEFT',
                            'RIGHT',
                            'INNER',
                            'FULL',
                            'CROSS',
                            'GLOBAL',
                            'ANY',
                            'ALL',
                            'AS',
                        ].includes(token.text.toUpperCase()))),
        );
        if (firstSource)
            sources.push({
                name: `${firstSource.text.replace(/[`\"]/g, '')}()`,
                detail: 'ClickHouse table function',
                range: { from: firstSource.from, to: firstSource.to },
            });
    }
    return sources.slice(0, MAX_SOURCES_PER_BRANCH);
}

function findIdentifierRange(
    tokens: Token[],
    parts: string[],
    span?: SourceRange,
): SourceRange | undefined {
    if (!parts.length) return undefined;
    const begin = span?.from ?? 0,
        end = span?.to ?? Number.POSITIVE_INFINITY;
    for (let index = 0; index < tokens.length; index++) {
        const first = tokens[index]!;
        if (
            first.from < begin ||
            first.to > end ||
            cleanIdentifier(first.text) !== cleanIdentifier(parts[0]!)
        )
            continue;
        let cursor = index,
            matched = true;
        for (let part = 1; part < parts.length; part++) {
            if (
                tokens[cursor + 1]?.text !== '.' ||
                cleanIdentifier(tokens[cursor + 2]?.text ?? '') !== cleanIdentifier(parts[part]!)
            ) {
                matched = false;
                break;
            }
            cursor += 2;
        }
        if (matched) return { from: first.from, to: tokens[cursor]!.to };
    }
    return undefined;
}

function topLevelClauses(sql: string): {
    tokens: Token[];
    clauses: ClauseSpan[];
    joins: SourceRange[];
    error?: string;
} {
    let tokens: Token[];
    try {
        tokens = lexSql(sql);
    } catch (error) {
        return {
            tokens: [],
            clauses: [],
            joins: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
    const found: Array<{ name: ClauseName; from: number }> = [],
        joins: SourceRange[] = [];
    let depth = 0;
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]!;
        if (token.kind === 'symbol' && token.text === ')') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth === 0 && token.kind === 'word') {
            const word = token.text.toUpperCase(),
                next = tokens[index + 1]?.text.toUpperCase();
            let name: ClauseName | undefined;
            if (word === 'GROUP' && next === 'BY') name = 'GROUP BY';
            else if (word === 'ORDER' && next === 'BY') name = 'ORDER BY';
            else if (word === 'WITH' && found.length === 0) name = 'WITH';
            else if (
                [
                    'SELECT',
                    'FROM',
                    'PREWHERE',
                    'WHERE',
                    'HAVING',
                    'WINDOW',
                    'QUALIFY',
                    'LIMIT',
                    'OFFSET',
                    'UNION',
                ].includes(word)
            )
                name = word as ClauseName;
            if (name) {
                found.push({ name, from: token.from });
                if (name === 'GROUP BY' || name === 'ORDER BY') index++;
                if (name === 'UNION' && next === 'ALL') index++;
            } else if (word === 'JOIN') joins.push({ from: token.from, to: token.to });
        }
        if (token.kind === 'symbol' && token.text === '(') depth++;
    }
    const clauses = found.map((item, index) => ({
        ...item,
        to: found[index + 1]?.from ?? sql.length,
    }));
    return { tokens, clauses, joins };
}

function clauseFor(clauses: ClauseSpan[], name: ClauseName, branch = 0): ClauseSpan | undefined {
    return clauses.filter(clause => clause.name === name)[branch];
}

function shortSql(sql: string, span?: SourceRange): string {
    if (!span) return '';
    const text = sql.slice(span.from, span.to).replace(/\s+/g, ' ').trim();
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

function astBranches(ast: unknown): AstObject[] {
    const root = object(ast);
    if (!root) return [];
    if (root.type === 'SelectQuery') return [root];
    if (root.type !== 'SelectWithUnionQuery') return [];
    return children(root.list_of_selects).flatMap(item =>
        object(item)?.type === 'SelectQuery' ? [object(item)!] : [],
    );
}

function joinKinds(branch: AstObject): string[] {
    return children(branch.tables).flatMap(item => {
        const join = object(object(item)?.table_join);
        return join ? [typeof join.kind === 'string' ? join.kind : 'JOIN'] : [];
    });
}

function functionNames(value: unknown, predicate: (node: AstObject) => boolean): string[] {
    const result = new Set<string>();
    walkNativeAst(value, node => {
        if (node.type === 'Function' && typeof node.name === 'string' && predicate(node))
            result.add(node.name);
    });
    return [...result].slice(0, 8);
}

function expressionNames(value: unknown): string[] {
    return children(value)
        .slice(0, 8)
        .map(item => {
            const node = object(item);
            if (!node) return 'expression';
            if (typeof node.alias === 'string') return node.alias;
            if (typeof node.name === 'string') return node.name;
            return typeof node.type === 'string'
                ? node.type.replace(/([A-Z])/g, ' $1').trim()
                : 'expression';
        });
}

function makeAstBranch(
    branch: AstObject,
    index: number,
    sql: string,
    tokens: Token[],
    clauses: ClauseSpan[],
    joins: SourceRange[],
): FlowBranch {
    const aggregatePattern =
        /^(count|sum|avg|min|max|uniq|quantile|topk|grouparray|argmin|argmax|median|var|stddev|any|groupuniqarray)/i;
    const aggregates = functionNames(
        branch.select,
        node => node.is_window_function !== true && aggregatePattern.test(String(node.name)),
    );
    const windows = functionNames(
        branch.select,
        node => node.is_window_function === true || hasNode(node.window_definition),
    );
    const from = clauseFor(clauses, 'FROM', index);
    const rawJoins = joins.filter(
        range => !from || (range.from >= from.from && range.to <= from.to),
    );
    const joinLabels = joinKinds(branch);
    const joinSpan = rawJoins.length && from ? { from: rawJoins[0]!.from, to: from.to } : undefined;
    const selected = expressionNames(branch.select);
    const cteNames = new Set(
        children(branch.with).flatMap(item => {
            const name = object(item)?.name;
            return typeof name === 'string' ? [cleanIdentifier(name)] : [];
        }),
    );
    const sources = tableSources(branch, tokens, from, cteNames);
    if (joinLabels.length && joinSpan)
        sources.forEach(source => {
            source.range ??= joinSpan;
        });
    return {
        sources: sources.length
            ? sources
            : [
                  {
                      name: 'Scalar expressions',
                      detail: 'No table source · values are computed from the SELECT list',
                      range: clauseFor(clauses, 'SELECT', index),
                  },
              ],
        joins: joinLabels,
        prewhere: hasNode(branch.prewhere),
        where: hasNode(branch.where),
        groupBy: hasNode(branch.group_by),
        aggregates,
        having: hasNode(branch.having),
        windows,
        qualify: hasNode(branch.qualify),
        orderBy: hasNode(branch.order_by),
        limit: hasNode(branch.limit_length) || hasNode(branch.limit_offset),
        projection: selected,
    };
}

function buildFallbackBranch(
    tokens: Token[],
    clauses: ClauseSpan[],
    joins: SourceRange[],
): FlowBranch {
    const from = clauseFor(clauses, 'FROM');
    const sources: Source[] = [];
    if (from) {
        let expect = true,
            depth = 0;
        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index]!;
            if (token.from < from.from || token.to > from.to) continue;
            if (token.text === '(') {
                if (expect && depth === 0)
                    sources.push({
                        name: 'Subquery',
                        detail: 'Nested SELECT source',
                        range: { from: token.from, to: token.to },
                    });
                depth++;
                continue;
            }
            if (token.text === ')') {
                depth = Math.max(0, depth - 1);
                continue;
            }
            if (depth > 0) continue;
            if (token.kind === 'word' && ['FROM', 'JOIN'].includes(token.text.toUpperCase())) {
                expect = true;
                continue;
            }
            if (token.text === ',') {
                expect = true;
                continue;
            }
            if (expect && (token.kind === 'word' || token.kind === 'quoted')) {
                let name = token.text.replace(/^[`"]|[`"]$/g, ''),
                    to = token.to;
                if (tokens[index + 1]?.text === '.' && tokens[index + 2]) {
                    name += `.${tokens[index + 2]!.text.replace(/^[`"]|[`"]$/g, '')}`;
                    to = tokens[index + 2]!.to;
                }
                sources.push({
                    name,
                    detail: 'Inferred table or table-function source',
                    range: { from: token.from, to },
                });
                expect = false;
            }
        }
    }
    const names = new Set(
        tokens.filter(token => token.kind === 'word').map(token => token.text.toUpperCase()),
    );
    const hasFunction = (pattern: RegExp) =>
        tokens.some(
            (token, index) =>
                token.kind === 'word' &&
                pattern.test(token.text) &&
                tokens[index + 1]?.text === '(',
        );
    const joinsInFrom = joins.filter(
        range => !from || (range.from >= from.from && range.to <= from.to),
    );
    return {
        sources: sources.length
            ? sources.slice(0, MAX_SOURCES_PER_BRANCH)
            : [
                  {
                      name: 'SQL expressions',
                      detail: 'Source was not resolved by the keyword estimate',
                      range: clauseFor(clauses, 'SELECT'),
                  },
              ],
        joins: joinsInFrom.map(() => 'JOIN'),
        prewhere: names.has('PREWHERE'),
        where: names.has('WHERE'),
        groupBy: names.has('GROUP'),
        aggregates: hasFunction(/^(count|sum|avg|min|max|uniq|quantile|topk)/i)
            ? ['aggregate function']
            : [],
        having: names.has('HAVING'),
        windows: hasFunction(/^(row_number|rank|dense_rank|lag|lead|first_value|last_value)/i)
            ? ['window function']
            : [],
        qualify: names.has('QUALIFY'),
        orderBy: names.has('ORDER'),
        limit: names.has('LIMIT') || names.has('OFFSET'),
        projection: ['SELECT list'],
    };
}

function aggregatePipeline(
    sql: string,
    branches: FlowBranch[],
    clauses: ClauseSpan[],
    baseOffset: number,
    mode: SqlFlowModel['mode'],
    parserError?: string,
    branchesTruncated = false,
): SqlFlowModel {
    const nodes: ProfilePipelineNode[] = [],
        edges: ProfilePipelineEdge[] = [],
        sourceRanges = new Map<string, SourceRange>();
    let capped = false;
    const addNode = (
        id: string,
        label: string,
        kind: ProfilePipelineNode['kind'],
        detail: string,
        range?: SourceRange,
    ) => {
        if (nodes.length >= MAX_FLOW_NODES) {
            capped = true;
            return undefined;
        }
        nodes.push({ id, label, kind, detail, status: 'estimated' });
        if (range && range.to > range.from)
            sourceRanges.set(id, { from: baseOffset + range.from, to: baseOffset + range.to });
        return id;
    };
    const connect = (from: string[], to?: string) => {
        if (!to) return;
        for (const source of from) edges.push({ source, target: to });
    };
    branches.slice(0, MAX_BRANCHES).forEach((branch, branchIndex) => {
        const suffix = branches.length > 1 ? `-${branchIndex + 1}` : '';
        let frontier: string[] = [];
        const branchClauses = (name: ClauseName) => clauseFor(clauses, name, branchIndex);
        for (const source of branch.sources) {
            const id = addNode(
                `read${suffix}-${frontier.length + 1}`,
                source.name,
                'read',
                source.detail,
                source.range ?? branchClauses('FROM'),
            );
            if (id) frontier.push(id);
        }
        if (branch.joins.length || frontier.length > 1) {
            const kind = branch.joins.length
                ? branch.joins.slice(0, 3).join(' + ')
                : 'CROSS / comma';
            const span = branchClauses('FROM');
            const id = addNode(
                `join${suffix}`,
                `Join · ${kind}`,
                'join',
                `${branch.joins.length || Math.max(0, frontier.length - 1)} join operation${(branch.joins.length || frontier.length - 1) === 1 ? '' : 's'} in FROM`,
                span,
            );
            connect(frontier, id);
            frontier = id ? [id] : frontier;
        }
        const add = (
            id: string,
            label: string,
            kind: ProfilePipelineNode['kind'],
            detail: string,
            clause: ClauseName,
            enabled: boolean,
        ) => {
            if (!enabled) return;
            const span = branchClauses(clause);
            const next = addNode(
                `${id}${suffix}`,
                label,
                kind,
                shortSql(sql, span) || detail,
                span,
            );
            connect(frontier, next);
            if (next) frontier = [next];
        };
        add(
            'prewhere',
            'PREWHERE · early filter',
            'filter',
            'Filter rows before the main WHERE step',
            'PREWHERE',
            branch.prewhere,
        );
        add(
            'where',
            'WHERE · filter rows',
            'filter',
            'Filter rows before aggregation',
            'WHERE',
            branch.where,
        );
        const group = branchClauses('GROUP BY');
        const aggregateDetail = [
            shortSql(sql, group ?? branchClauses('SELECT')),
            branch.aggregates.length
                ? `${branch.aggregates.join(', ')} ${branch.aggregates.length === 1 ? 'aggregate' : 'aggregates'}`
                : '',
        ]
            .filter(Boolean)
            .join(' · ');
        add(
            'aggregate',
            `Aggregate · ${branch.aggregates.length ? branch.aggregates.join(', ') : 'GROUP BY'}`,
            'aggregate',
            aggregateDetail || 'Aggregate the selected groups',
            group ? 'GROUP BY' : 'SELECT',
            branch.groupBy || branch.aggregates.length > 0,
        );
        add(
            'having',
            'HAVING · filter groups',
            'filter',
            'Filter after aggregation',
            'HAVING',
            branch.having,
        );
        add(
            'window',
            `Window · ${branch.windows.join(', ') || 'window expression'}`,
            'transform',
            'Calculate a window function over the selected rows',
            'SELECT',
            branch.windows.length > 0,
        );
        add(
            'qualify',
            'QUALIFY · filter window results',
            'filter',
            'Filter rows after window calculations',
            'QUALIFY',
            branch.qualify,
        );
        const projection = addNode(
            `project${suffix}`,
            `Project · ${branch.projection.length} expressions`,
            'transform',
            branch.projection.join(' · ') || 'SELECT list',
            branchClauses('SELECT'),
        );
        connect(frontier, projection);
        frontier = projection ? [projection] : frontier;
        add(
            'sort',
            'ORDER BY · sort rows',
            'sort',
            'Order the projected result',
            'ORDER BY',
            branch.orderBy,
        );
        add(
            'limit',
            'LIMIT / OFFSET · bound result',
            'transform',
            'Apply row limit or offset',
            branchClauses('LIMIT') ? 'LIMIT' : 'OFFSET',
            branch.limit,
        );
        const output = addNode(
            `output${suffix}`,
            'Return result',
            'output',
            'Columns produced by the SELECT list',
            branchClauses('SELECT'),
        );
        connect(frontier, output);
        frontier = output ? [output] : frontier;
        if (branchIndex === 0 && branches.length > 1) {
            const unionSpan = clauses.find(clause => clause.name === 'UNION');
            const union = addNode(
                'union',
                `UNION · ${branches.length} branches`,
                'transform',
                'Combine the SELECT branches',
                unionSpan,
            );
            connect(frontier, union);
            frontier = union ? [union] : frontier;
        } else if (branchIndex > 0 && branches.length > 1) {
            const union = nodes.find(node => node.id === 'union');
            if (union) connect(frontier, union.id);
        }
    });
    const notice =
        mode === 'native AST'
            ? 'Built from the ClickHouse parser AST. This shows logical SQL structure; it is not the server’s physical EXPLAIN PIPELINE.'
            : 'The native AST is unavailable, so this is a best-effort keyword estimate. It is not the server’s physical EXPLAIN PIPELINE.';
    return {
        pipeline: {
            available: nodes.length > 0,
            source: 'query_shape',
            nodes,
            edges,
            truncated: capped || branchesTruncated,
            notice: `${notice}${capped ? ` The graph is bounded to ${MAX_FLOW_NODES} nodes.` : branchesTruncated ? ` The graph is bounded to ${MAX_BRANCHES} UNION branches.` : ''}`,
        },
        sourceRanges,
        mode,
        ...(parserError ? { parserError } : {}),
    };
}

export function buildSqlFlow(
    sql: string,
    parseResult: NativeParseResult | undefined,
    baseOffset = 0,
): SqlFlowModel {
    const outline = topLevelClauses(sql);
    if (outline.error)
        return aggregatePipeline(
            sql,
            [],
            outline.clauses,
            baseOffset,
            'keyword estimate',
            parseResult?.error?.message ?? outline.error,
        );
    const nativeBranches =
        !parseResult?.error && parseResult?.ast ? astBranches(parseResult.ast) : [];
    if (nativeBranches.length) {
        const branches = nativeBranches
            .slice(0, MAX_BRANCHES)
            .map((branch, index) =>
                makeAstBranch(branch, index, sql, outline.tokens, outline.clauses, outline.joins),
            );
        return aggregatePipeline(
            sql,
            branches,
            outline.clauses,
            baseOffset,
            'native AST',
            parseResult?.ast_error,
            nativeBranches.length > MAX_BRANCHES,
        );
    }
    const root = !parseResult?.error ? object(parseResult?.ast) : undefined;
    if (root?.type && !['SelectQuery', 'SelectWithUnionQuery'].includes(String(root.type)))
        return aggregatePipeline(
            sql,
            [],
            outline.clauses,
            baseOffset,
            'native AST',
            parseResult?.ast_error,
        );
    if (!outline.clauses.some(clause => clause.name === 'SELECT'))
        return aggregatePipeline(
            sql,
            [],
            outline.clauses,
            baseOffset,
            'keyword estimate',
            parseResult?.error?.message ?? parseResult?.ast_error,
        );
    const fallback = buildFallbackBranch(outline.tokens, outline.clauses, outline.joins);
    return aggregatePipeline(
        sql,
        [fallback],
        outline.clauses,
        baseOffset,
        'keyword estimate',
        parseResult?.error?.message ?? parseResult?.ast_error,
    );
}
