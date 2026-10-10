export interface QueryTreeProperty {
    name: string;
    value: string;
}
export interface QueryTreeNode {
    id: string;
    path: string;
    field: string;
    type: string;
    summary?: string;
    childCount: number;
    propertyCount: number;
    properties: QueryTreeProperty[];
    children: QueryTreeNode[];
}
export interface QueryTree {
    root?: QueryTreeNode;
    nodeCount: number;
    truncated: boolean;
    lineCount: number;
}
export interface QueryTreeOptions {
    maxNodes?: number;
    maxLines?: number;
    maxPropertyLength?: number;
}
const DEFAULT_MAX_NODES = 1_000;
const DEFAULT_MAX_LINES = 6_000;
const DEFAULT_PROPERTY_LENGTH = 240;
const MAX_PROPERTIES = 32;
function boundedInteger(value: number | undefined, fallback: number) {
    return Number.isFinite(value) && value !== undefined
        ? Math.max(1, Math.floor(value))
        : fallback;
}
function short(value: string, maxLength: number) {
    return value.length <= maxLength ? value : value.slice(0, Math.max(1, maxLength - 1)) + '…';
}
function leadingIndent(value: string) {
    let indent = 0;
    for (const character of value) {
        if (character === ' ') indent++;
        else if (character === '\t') indent += 4;
        else break;
    }
    return indent;
}
function splitTopLevel(value: string): string[] {
    const parts: string[] = [];
    let start = 0,
        depth = 0,
        quote = '';
    for (let index = 0; index < value.length; index++) {
        const character = value[index]!;
        if (quote) {
            if (character === '\\') index++;
            else if (character === quote) quote = '';
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            quote = character;
            continue;
        }
        if ('([{'.includes(character)) depth++;
        else if (')]}'.includes(character)) depth = Math.max(0, depth - 1);
        else if (character === ',' && depth === 0) {
            parts.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
}
function parseProperties(
    value: string | undefined,
    id: string | undefined,
    maxLength: number,
): QueryTreeProperty[] {
    const properties: QueryTreeProperty[] = [];
    if (id?.trim()) properties.push({ name: 'id', value: short(id.trim(), maxLength) });
    for (const part of splitTopLevel(value ?? '')) {
        const separator = part.indexOf(':');
        if (separator <= 0) continue;
        const name = part.slice(0, separator).trim(),
            propertyValue = part.slice(separator + 1).trim();
        if (name && propertyValue)
            properties.push({ name: short(name, 80), value: short(propertyValue, maxLength) });
        if (properties.length >= MAX_PROPERTIES) break;
    }
    return properties;
}
function property(properties: readonly QueryTreeProperty[], name: string) {
    return properties.find(item => item.name === name)?.value;
}
function nodeSummary(
    type: string,
    properties: readonly QueryTreeProperty[],
    raw: string,
    maxLength: number,
): string | undefined {
    const table = property(properties, 'table_name');
    if (table) return short(table, maxLength);
    const column = property(properties, 'column_name');
    if (column)
        return short(
            column +
                (property(properties, 'result_type')
                    ? ' · ' + property(properties, 'result_type')
                    : ''),
            maxLength,
        );
    const fn = property(properties, 'function_name');
    if (fn)
        return short(
            fn +
                '()' +
                (property(properties, 'result_type')
                    ? ' · ' + property(properties, 'result_type')
                    : ''),
            maxLength,
        );
    const identifier = property(properties, 'identifier');
    if (identifier) return short(identifier, maxLength);
    const alias = property(properties, 'alias');
    if (alias) return short('alias ' + alias, maxLength);
    const nodes = property(properties, 'nodes');
    if (type === 'LIST' && nodes) return short(nodes + ' nodes', maxLength);
    if (type === 'OUTPUT') return short(raw, maxLength);
    return undefined;
}
type ParsedNode = QueryTreeNode & { indent: number };
function parsedLine(line: string, index: number, maxLength: number): ParsedNode | undefined {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) return undefined;
    const content = trimmed.trimStart();
    const match = content.match(
        /^([A-Z][A-Z0-9 _-]*?)(?=\s+id:|$)(?:\s+id:\s*([^,]+))?(?:,\s*(.*))?$/,
    );
    const type = match?.[1]?.trim() || 'OUTPUT';
    const properties = parseProperties(match?.[3], match?.[2], maxLength);
    const summary = nodeSummary(type, properties, content, maxLength);
    const serverId = property(properties, 'id');
    return {
        id: 'query-tree-' + index,
        path: '',
        field: serverId ? 'id ' + serverId : '',
        type,
        ...(summary ? { summary } : {}),
        childCount: 0,
        propertyCount: properties.length,
        properties,
        children: [],
        indent: leadingIndent(line),
    };
}
function assignPaths(node: QueryTreeNode, path: string) {
    node.path = path;
    node.childCount = node.children.length;
    node.children.forEach((child, index) => assignPaths(child, path + '.children[' + index + ']'));
}
export function parseQueryTree(
    lines: readonly string[],
    options: QueryTreeOptions = {},
): QueryTree {
    const maxNodes = boundedInteger(options.maxNodes, DEFAULT_MAX_NODES);
    const maxLines = boundedInteger(options.maxLines, DEFAULT_MAX_LINES);
    const maxPropertyLength = boundedInteger(options.maxPropertyLength, DEFAULT_PROPERTY_LENGTH);
    const source = lines.slice(0, maxLines),
        roots: ParsedNode[] = [],
        stack: ParsedNode[] = [];
    let nodeCount = 0,
        truncated = lines.length > source.length;
    for (let lineIndex = 0; lineIndex < source.length; lineIndex++) {
        if (nodeCount >= maxNodes) {
            truncated = true;
            break;
        }
        const node = parsedLine(source[lineIndex]!, nodeCount, maxPropertyLength);
        if (!node) continue;
        while (stack.length && stack[stack.length - 1]!.indent >= node.indent) stack.pop();
        if (stack.length) stack[stack.length - 1]!.children.push(node);
        else roots.push(node);
        stack.push(node);
        nodeCount++;
    }
    let root: QueryTreeNode | undefined;
    if (roots.length === 1) root = roots[0];
    else if (roots.length > 1) {
        root = {
            id: 'query-tree-root',
            path: '',
            field: '',
            type: 'ANALYZER',
            summary: roots.length + ' roots',
            childCount: roots.length,
            propertyCount: 0,
            properties: [],
            children: roots,
        };
        nodeCount++;
    }
    if (root) assignPaths(root, '$');
    return { ...(root ? { root } : {}), nodeCount, truncated, lineCount: source.length };
}
