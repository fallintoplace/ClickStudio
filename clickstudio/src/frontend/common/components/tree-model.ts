export interface TreeGraphNode {
    readonly id: string;
    readonly path: string;
    readonly field: string;
    readonly type: string;
    readonly summary?: string;
    readonly childCount: number;
    readonly propertyCount: number;
    readonly properties: readonly { name: string; value: string }[];
    readonly children: readonly TreeGraphNode[];
}

export interface TreeGraphModel {
    readonly root?: TreeGraphNode;
    readonly nodeCount: number;
    readonly truncated: boolean;
}

const initialExpandedDepth = 3;
const maxVisibleNodes = 320;

export type VisibleTreeGraphNode = {
    source: TreeGraphNode;
    children: VisibleTreeGraphNode[];
};

export function initialExpanded(root: TreeGraphNode): Set<string> {
    const expanded = new Set<string>();
    const stack: Array<{ node: TreeGraphNode; depth: number }> = [{ node: root, depth: 0 }];
    while (stack.length) {
        const { node, depth } = stack.pop()!;
        if (!node.children.length || depth >= initialExpandedDepth) continue;
        expanded.add(node.id);
        for (let index = node.children.length - 1; index >= 0; index--)
            stack.push({ node: node.children[index]!, depth: depth + 1 });
    }
    return expanded;
}

export function indexTree(root: TreeGraphNode): Map<string, TreeGraphNode> {
    const index = new Map<string, TreeGraphNode>();
    const stack = [root];
    while (stack.length) {
        const node = stack.pop()!;
        index.set(node.id, node);
        for (let child = node.children.length - 1; child >= 0; child--)
            stack.push(node.children[child]!);
    }
    return index;
}

export function visibleTree(root: TreeGraphNode, expanded: ReadonlySet<string>) {
    const budget = { remaining: maxVisibleNodes, truncated: false };
    const build = (node: TreeGraphNode): VisibleTreeGraphNode | undefined => {
        if (budget.remaining-- <= 0) {
            budget.truncated = true;
            return undefined;
        }
        const children: VisibleTreeGraphNode[] = [];
        if (expanded.has(node.id)) {
            for (const child of node.children) {
                const visible = build(child);
                if (!visible) break;
                children.push(visible);
            }
        }
        return { source: node, children };
    };
    return { root: build(root), truncated: budget.truncated };
}
