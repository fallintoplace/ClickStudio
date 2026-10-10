export type NativeAstObject = Record<string, unknown>;

export interface NativeAstWalkOptions {
    maxNodes?: number;
    skipKeys?: readonly string[];
}

export interface NativeAstWalkResult {
    visited: number;
    truncated: boolean;
}

export interface NativeAstProperty {
    name: string;
    value: string;
}

export interface NativeAstTreeNode {
    id: string;
    path: string;
    field: string;
    type: string;
    summary?: string;
    childCount: number;
    propertyCount: number;
    properties: NativeAstProperty[];
    children: NativeAstTreeNode[];
}

export interface NativeAstTree {
    root?: NativeAstTreeNode;
    nodeCount: number;
    truncated: boolean;
}

export interface NativeAstTreeOptions {
    maxNodes?: number;
    maxDepth?: number;
    maxPropertyLength?: number;
}

const DEFAULT_WALK_LIMIT = 20_000;
const DEFAULT_TREE_LIMIT = 2_000;
const DEFAULT_TREE_DEPTH = 80;
const DEFAULT_PROPERTY_LENGTH = 180;
const MAX_VISIBLE_PROPERTIES = 24;
const DEFAULT_SKIP_KEYS = ['value'] as const;

export function asNativeAstObject(value: unknown): NativeAstObject | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as NativeAstObject)
        : undefined;
}

export function nativeAstType(value: unknown): string | undefined {
    const type = asNativeAstObject(value)?.type;
    return typeof type === 'string' && type.length ? type : undefined;
}

export function nativeAstChildren(value: unknown): unknown[] {
    const children = asNativeAstObject(value)?.children;
    return Array.isArray(children) ? children : [];
}

function positiveInteger(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value !== undefined
        ? Math.max(1, Math.floor(value))
        : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value !== undefined
        ? Math.max(0, Math.floor(value))
        : fallback;
}

/**
 * Walk the JSON shape returned by ClickHouse parseQueryToJSON/ch_parse.
 * Literal `value` payloads are skipped by default so large Array/Map literals
 * do not masquerade as AST structure. Return false from the visitor to stop.
 */
export function walkNativeAst(
    root: unknown,
    visit: (node: NativeAstObject) => boolean | void,
    options: NativeAstWalkOptions = {},
): NativeAstWalkResult {
    const maxNodes = positiveInteger(options.maxNodes, DEFAULT_WALK_LIMIT);
    const skipKeys = new Set(options.skipKeys ?? DEFAULT_SKIP_KEYS);
    const stack: unknown[] = [root];
    const seen = new WeakSet<object>();
    let visited = 0;

    while (stack.length) {
        const value = stack.pop();
        if (Array.isArray(value)) {
            if (seen.has(value)) continue;
            seen.add(value);
            for (let index = value.length - 1; index >= 0; index--) stack.push(value[index]);
            continue;
        }
        const node = asNativeAstObject(value);
        if (!node) continue;
        if (seen.has(node)) continue;
        seen.add(node);
        if (visited >= maxNodes) return { visited, truncated: true };
        visited++;
        if (visit(node) === false) return { visited, truncated: false };
        const entries = Object.entries(node);
        for (let index = entries.length - 1; index >= 0; index--) {
            const [key, child] = entries[index]!;
            if (!skipKeys.has(key) && child !== null && typeof child === 'object')
                stack.push(child);
        }
    }
    return { visited, truncated: false };
}

function astObject(value: unknown): NativeAstObject | undefined {
    const node = asNativeAstObject(value);
    return node && nativeAstType(node) ? node : undefined;
}

function pathKey(path: string, key: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? `${path}.${key}`
        : `${path}[${JSON.stringify(key)}]`;
}

function short(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function propertyText(value: unknown, maxLength: number): string {
    if (typeof value === 'string') return short(value, maxLength);
    if (value === null) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value === undefined) return 'undefined';
    try {
        return short(JSON.stringify(value), maxLength);
    } catch {
        return short(String(value), maxLength);
    }
}

function nodeSummary(node: NativeAstObject, maxLength: number): string | undefined {
    const parts = node.name_parts;
    if (Array.isArray(parts)) {
        const names = parts.filter((part): part is string => typeof part === 'string');
        if (names.length === parts.length && names.length) return short(names.join('.'), maxLength);
    }
    if (typeof node.name === 'string' && node.name.length) return short(node.name, maxLength);
    const type = nativeAstType(node);
    if (type === 'Literal') {
        const literal = asNativeAstObject(node.value);
        if (literal && typeof literal.field_type === 'string') {
            const value = propertyText(
                literal.value,
                Math.max(24, maxLength - literal.field_type.length - 3),
            );
            return short(`${literal.field_type} · ${value}`, maxLength);
        }
        return short(propertyText(node.value, maxLength), maxLength);
    }
    if (type === 'ExpressionList') {
        const count = nativeAstChildren(node).length;
        return `${count.toLocaleString()} item${count === 1 ? '' : 's'}`;
    }
    if (typeof node.alias === 'string' && node.alias.length)
        return short(`alias ${node.alias}`, maxLength);
    if (typeof node.union_mode === 'string' && node.union_mode.length)
        return short(node.union_mode.replace(/^UNION_/, ''), maxLength);
    return undefined;
}

type ChildCandidate = { node: NativeAstObject; path: string; field: string };

function childCandidates(
    node: NativeAstObject,
    path: string,
): { children: ChildCandidate[]; propertyEntries: Array<[string, unknown]> } {
    const children: ChildCandidate[] = [];
    const propertyEntries: Array<[string, unknown]> = [];
    for (const [key, value] of Object.entries(node)) {
        if (key === 'type') continue;
        const child = astObject(value);
        if (child) {
            children.push({ node: child, path: pathKey(path, key), field: key });
            continue;
        }
        if (Array.isArray(value)) {
            const typedItems: ChildCandidate[] = [];
            for (let index = 0; index < value.length; index++) {
                const item = astObject(value[index]);
                if (item)
                    typedItems.push({
                        node: item,
                        path: `${pathKey(path, key)}[${index}]`,
                        field: `${key}[${index}]`,
                    });
            }
            if (typedItems.length) {
                children.push(...typedItems);
                continue;
            }
        }
        propertyEntries.push([key, value]);
    }
    return { children, propertyEntries };
}

/** Build a bounded UI-friendly tree containing only real ClickHouse AST nodes. */
export function buildNativeAstTree(
    root: unknown,
    options: NativeAstTreeOptions = {},
): NativeAstTree {
    const maxNodes = positiveInteger(options.maxNodes, DEFAULT_TREE_LIMIT);
    const maxDepth = nonNegativeInteger(options.maxDepth, DEFAULT_TREE_DEPTH);
    const maxPropertyLength = positiveInteger(options.maxPropertyLength, DEFAULT_PROPERTY_LENGTH);
    const rootNode = astObject(root);
    if (!rootNode) return { nodeCount: 0, truncated: false };

    const seen = new WeakSet<object>();
    let nodeCount = 0;
    let truncated = false;

    const build = (
        node: NativeAstObject,
        path: string,
        field: string,
        depth: number,
    ): NativeAstTreeNode | undefined => {
        if (nodeCount >= maxNodes) {
            truncated = true;
            return undefined;
        }
        if (seen.has(node)) {
            truncated = true;
            return undefined;
        }
        seen.add(node);
        nodeCount++;
        const { children: candidates, propertyEntries } = childCandidates(node, path);
        const properties = propertyEntries
            .slice(0, MAX_VISIBLE_PROPERTIES)
            .map(([name, value]) => ({
                name,
                value: propertyText(value, maxPropertyLength),
            }));
        const builtChildren: NativeAstTreeNode[] = [];
        if (depth >= maxDepth) {
            if (candidates.length) truncated = true;
        } else {
            for (const candidate of candidates) {
                const built = build(candidate.node, candidate.path, candidate.field, depth + 1);
                if (!built) break;
                builtChildren.push(built);
            }
        }
        const summary = nodeSummary(node, maxPropertyLength);
        return {
            id: path,
            path,
            field,
            type: nativeAstType(node)!,
            ...(summary ? { summary } : {}),
            childCount: candidates.length,
            propertyCount: propertyEntries.length,
            properties,
            children: builtChildren,
        };
    };

    const built = build(rootNode, '$', '$', 0);
    return { ...(built ? { root: built } : {}), nodeCount, truncated };
}
