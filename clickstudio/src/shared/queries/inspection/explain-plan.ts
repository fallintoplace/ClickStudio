import type { Json } from '../../common/values.js';
import type { RunKind } from '../execution/status.js';

export type ExplainPlanProperty = { name: string; value: Json };
export type ExplainPlanNode = {
    type: string;
    id?: string;
    description?: string;
    properties: ExplainPlanProperty[];
    children: ExplainPlanNode[];
};
export type ExplainPlan = { root: ExplainPlanNode; nodeCount: number; truncated: boolean };

const MAX_PLAN_JSON_CHARS = 2_000_000;
const MAX_PLAN_NODES = 500;
const MAX_PLAN_DEPTH = 64;
const PLAN_NODE_KEYS = new Set(['Node Type', 'Node Id', 'Description', 'Plans']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export function sqlForRunKind(statement: string, kind: RunKind): string {
    if (kind === 'explain') return `EXPLAIN indexes = 1\n${statement}`;
    if (kind === 'plan') return `EXPLAIN PLAN json = 1, indexes = 1, description = 1\n${statement}`;
    if (kind === 'pipeline') return `EXPLAIN PIPELINE graph = 1, compact = 0\n${statement}`;
    if (kind === 'analyze') return `EXPLAIN ANALYZE\n${statement}`;
    return statement;
}

export function explainPrefixLength(kind: RunKind): number {
    if (kind === 'explain') return 'EXPLAIN indexes = 1\n'.length;
    if (kind === 'plan') return 'EXPLAIN PLAN json = 1, indexes = 1, description = 1\n'.length;
    if (kind === 'pipeline') return 'EXPLAIN PIPELINE graph = 1, compact = 0\n'.length;
    if (kind === 'analyze') return 'EXPLAIN ANALYZE\n'.length;
    return 0;
}

export function parseExplainPlan(input: unknown): ExplainPlan | undefined {
    if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PLAN_JSON_CHARS)
        return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(input) as unknown;
    } catch {
        return undefined;
    }

    const rows = Array.isArray(parsed) ? parsed : undefined;
    if (!rows || rows.length !== 1 || !isRecord(rows[0]) || !isRecord(rows[0].Plan))
        return undefined;

    let nodeCount = 0;
    let truncated = false;
    const parseNode = (
        raw: Record<string, unknown>,
        depth: number,
    ): ExplainPlanNode | undefined => {
        if (nodeCount >= MAX_PLAN_NODES) {
            truncated = true;
            return undefined;
        }
        if (depth >= MAX_PLAN_DEPTH) {
            truncated = true;
            return { type: 'Depth limit reached', properties: [], children: [] };
        }
        nodeCount++;
        const type =
            typeof raw['Node Type'] === 'string' && raw['Node Type'].trim()
                ? raw['Node Type'].slice(0, 160)
                : 'Unknown step';
        const id = typeof raw['Node Id'] === 'string' ? raw['Node Id'].slice(0, 160) : undefined;
        const description =
            typeof raw.Description === 'string' ? raw.Description.slice(0, 4_000) : undefined;
        const properties = Object.entries(raw)
            .filter(([name]) => !PLAN_NODE_KEYS.has(name))
            .slice(0, 100)
            .map(([name, value]) => ({ name: name.slice(0, 160), value: value as Json }));
        if (Object.keys(raw).length - PLAN_NODE_KEYS.size > properties.length) truncated = true;
        const rawChildren = Array.isArray(raw.Plans) ? raw.Plans : [];
        const children: ExplainPlanNode[] = [];
        for (const child of rawChildren) {
            if (!isRecord(child)) continue;
            const parsedChild = parseNode(child, depth + 1);
            if (parsedChild) children.push(parsedChild);
            if (nodeCount >= MAX_PLAN_NODES) {
                if (rawChildren.length > children.length) truncated = true;
                break;
            }
        }
        return {
            type,
            ...(id ? { id } : {}),
            ...(description ? { description } : {}),
            properties,
            children,
        };
    };

    const root = parseNode(rows[0].Plan, 0);
    return root ? { root, nodeCount, truncated } : undefined;
}
