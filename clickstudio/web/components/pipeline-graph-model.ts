import { dagre } from 'd3-dag';
import type { ProfilePipeline, ProfilePipelineNode } from '../../shared/types';
import type { Copy } from '../i18n';

export const nodeWidth = 220;
export const nodeHeight = 74;
const graphPadding = 28;
export const autoFocusGraphKinds = new Set([
    'execution',
    'explain-plan',
    'index-analysis',
    'runtime',
]);
export type PipelineGraphKind =
    'execution' | 'sql-flow' | 'explain-plan' | 'index-analysis' | 'runtime';

export type PositionedNode = { node: ProfilePipelineNode; x: number; y: number };
export type PositionedEdge = {
    source: string;
    target: string;
    label?: string;
    flow?: number;
    points: Array<{ x: number; y: number }>;
};
export type GraphLayout = {
    width: number;
    height: number;
    nodes: PositionedNode[];
    edges: PositionedEdge[];
};

function fallbackLayout(pipeline: ProfilePipeline): GraphLayout {
    const byId = new Map(pipeline.nodes.map(node => [node.id, node]));
    const ranks = new Map(pipeline.nodes.map(node => [node.id, 0]));
    const incoming = new Map(pipeline.nodes.map(node => [node.id, 0]));
    const outgoing = new Map(pipeline.nodes.map(node => [node.id, [] as string[]]));
    for (const edge of pipeline.edges) {
        if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
        incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
        outgoing.get(edge.source)?.push(edge.target);
    }
    const queue = pipeline.nodes.filter(node => incoming.get(node.id) === 0).map(node => node.id);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        visited.add(id);
        for (const next of outgoing.get(id) ?? []) {
            ranks.set(next, Math.max(ranks.get(next) ?? 0, (ranks.get(id) ?? 0) + 1));
            incoming.set(next, (incoming.get(next) ?? 1) - 1);
            if (incoming.get(next) === 0) queue.push(next);
        }
    }
    let nextRank = Math.max(0, ...ranks.values()) + 1;
    for (const node of pipeline.nodes) {
        if (!visited.has(node.id)) ranks.set(node.id, nextRank++);
    }
    const layers = new Map<number, ProfilePipelineNode[]>();
    for (const node of pipeline.nodes) {
        const rank = ranks.get(node.id) ?? 0;
        layers.set(rank, [...(layers.get(rank) ?? []), node]);
    }
    const maxLayerSize = Math.max(1, ...[...layers.values()].map(layer => layer.length));
    const width = maxLayerSize * (nodeWidth + 32) + graphPadding * 2;
    const height = layers.size * (nodeHeight + 54) + graphPadding * 2;
    const positions = new Map<string, { x: number; y: number }>();
    for (const [rank, layer] of layers) {
        layer.forEach((node, index) =>
            positions.set(node.id, {
                x: graphPadding + ((index + 0.5) * (width - graphPadding * 2)) / layer.length,
                y: graphPadding + rank * (nodeHeight + 54) + nodeHeight / 2,
            }),
        );
    }
    return {
        width,
        height,
        nodes: pipeline.nodes.flatMap(node => {
            const position = positions.get(node.id);
            return position ? [{ node, ...position }] : [];
        }),
        edges: pipeline.edges.flatMap(edge => {
            const start = positions.get(edge.source),
                end = positions.get(edge.target);
            if (!start || !end) return [];
            const middleY = (start.y + end.y) / 2;
            return [
                {
                    ...edge,
                    points: [
                        { x: start.x, y: start.y + nodeHeight / 2 },
                        { x: start.x, y: middleY },
                        { x: end.x, y: middleY },
                        { x: end.x, y: end.y - nodeHeight / 2 },
                    ],
                },
            ];
        }),
    };
}

export function layoutPipeline(pipeline: ProfilePipeline): GraphLayout {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: 'TB', nodesep: 34, ranksep: 74, quality: 'fast' });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const node of pipeline.nodes)
        graph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    const edgeKeys = new Set<string>();
    for (const edge of pipeline.edges) {
        if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
        const key = `${edge.source}\u0000${edge.target}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        graph.setEdge(edge.source, edge.target);
    }
    try {
        dagre.layout(graph);
        const dimensions = graph.graph();
        if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height))
            return fallbackLayout(pipeline);
        const positions = new Map(
            graph.nodes().map(id => {
                const position = graph.node(id);
                return [
                    id,
                    { x: position.x + graphPadding, y: position.y + graphPadding },
                ] as const;
            }),
        );
        return {
            width: dimensions.width + graphPadding * 2,
            height: dimensions.height + graphPadding * 2,
            nodes: pipeline.nodes.flatMap(node => {
                const position = positions.get(node.id);
                return position ? [{ node, ...position }] : [];
            }),
            edges: pipeline.edges.flatMap(edge => {
                if (!graph.hasEdge(edge.source, edge.target)) return [];
                const points = graph.edge(edge.source, edge.target).points.map(point => ({
                    x: point.x + graphPadding,
                    y: point.y + graphPadding,
                }));
                return points.length ? [{ ...edge, points }] : [];
            }),
        };
    } catch {
        return fallbackLayout(pipeline);
    }
}

export function labelLines(label: string) {
    const words = label.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
        if (current && `${current} ${word}`.length > 28) {
            lines.push(current);
            current = word;
        } else current = current ? `${current} ${word}` : word;
    }
    if (current) lines.push(current);
    if (lines.length > 2) lines[1] = `${lines[1]!.slice(0, 25)}…`;
    return lines.slice(0, 2);
}

export function pathFor(points: PositionedEdge['points']) {
    return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

export function centerGraphNode(
    viewport: HTMLDivElement,
    node: PositionedNode,
    scale: number,
    behavior: ScrollBehavior = 'auto',
) {
    viewport.scrollTo({
        left: Math.max(0, node.x * scale - viewport.clientWidth / 2),
        top: Math.max(0, node.y * scale - viewport.clientHeight / 2),
        behavior,
    });
}

export function focusPipeline(pipeline: ProfilePipeline, selectedId?: string) {
    if (!selectedId) return undefined;
    const incoming = new Map(pipeline.nodes.map(node => [node.id, new Set<string>()]));
    const outgoing = new Map(pipeline.nodes.map(node => [node.id, new Set<string>()]));
    for (const edge of pipeline.edges) {
        incoming.get(edge.target)?.add(edge.source);
        outgoing.get(edge.source)?.add(edge.target);
    }
    const trace = (links: Map<string, Set<string>>) => {
        const visited = new Set([selectedId]);
        const queue = [selectedId];
        for (let index = 0; index < queue.length; index++) {
            for (const next of links.get(queue[index]!) ?? []) {
                if (visited.has(next)) continue;
                visited.add(next);
                queue.push(next);
            }
        }
        return visited;
    };
    const upstream = trace(incoming);
    const downstream = trace(outgoing);
    const nodeIds = new Set([...upstream, ...downstream]);
    const edgeIds = new Set(
        pipeline.edges.flatMap(edge =>
            (upstream.has(edge.source) && upstream.has(edge.target)) ||
            (downstream.has(edge.source) && downstream.has(edge.target))
                ? [`${edge.source}\u0000${edge.target}`]
                : [],
        ),
    );
    return { nodeIds, edgeIds };
}

export function sqlFlowNodeKind(kind: string, copy?: Copy['common']) {
    const translation: Partial<Record<ProfilePipelineNode['kind'], keyof Copy['common']>> = {
        read: 'sqlFlowReadKind',
        filter: 'sqlFlowFilterKind',
        aggregate: 'sqlFlowAggregateKind',
        sort: 'sqlFlowSortKind',
        resize: 'sqlFlowResizeKind',
        join: 'sqlFlowJoinKind',
        transform: 'sqlFlowTransformKind',
        output: 'sqlFlowOutputKind',
        stage: 'sqlFlowStageKind',
    };
    const key = translation[kind as ProfilePipelineNode['kind']];
    return key && copy ? copy[key] : kind;
}

export function sqlFlowNodeStatus(status: string, copy?: Copy['common']) {
    return status === 'estimated' ? (copy?.sqlFlowEstimatedStatus ?? status) : status;
}

export function sqlFlowNodeLabel(node: ProfilePipelineNode, copy?: Copy['common']) {
    if (!copy) return node.label;
    if (node.kind === 'output' && node.label === 'Return result') return copy.sqlFlowReturnResult;
    if (node.kind === 'filter') return `${node.label.split(' · ')[0]} · ${copy.sqlFlowFilterKind}`;
    if (node.kind === 'aggregate' && node.label.startsWith('Aggregate · '))
        return `${copy.sqlFlowAggregateKind} · ${node.label.slice('Aggregate · '.length)}`;
    if (node.kind === 'sort' && node.label.startsWith('ORDER BY · '))
        return `ORDER BY · ${copy.sqlFlowSortKind}`;
    if (node.kind === 'join' && node.label.startsWith('Join · '))
        return `${copy.sqlFlowJoinKind} · ${node.label.slice('Join · '.length)}`;
    if (node.kind === 'transform') {
        if (node.label.startsWith('Project · '))
            return `${copy.sqlFlowTransformKind} · ${node.label.slice('Project · '.length)}`;
        if (node.label.startsWith('Window · '))
            return `${copy.sqlFlowTransformKind} · ${node.label.slice('Window · '.length)}`;
        if (node.label.startsWith('LIMIT / OFFSET · '))
            return `LIMIT / OFFSET · ${copy.sqlFlowTransformKind}`;
    }
    return node.label;
}

export function sqlFlowNodeDetail(node: ProfilePipelineNode, copy?: Copy['common']) {
    if (!node.detail || !copy) return node.detail;
    if (node.detail === 'Table source') return copy.sqlFlowSourceDetail;
    if (node.detail.startsWith('Table source · alias '))
        return `${copy.sqlFlowSourceDetail} · alias ${node.detail.slice('Table source · alias '.length)}`;
    if (node.detail === 'Columns produced by the SELECT list') return copy.sqlFlowOutputColumns;
    return node.detail;
}

export function graphLabels(kind: PipelineGraphKind, copy?: Copy['common']) {
    switch (kind) {
        case 'sql-flow':
            return {
                terminology: {
                    graph: copy?.sqlMap ?? 'SQL flow graph',
                    item: copy?.sqlFlowStages ?? 'stages',
                    selected: copy?.sqlFlowSelectedStage ?? 'Selected stage',
                    action: copy?.sqlFlowInspectStage ?? 'Inspect stage',
                    details: copy?.sqlFlowStageDetails ?? 'Selected stage details',
                },
                connection: copy?.sqlFlowConnections ?? 'connections',
                viewport: copy?.sqlMap ?? 'Scrollable SQL flow graph',
                svg: copy?.sqlFlowGraphHint ?? 'Click a stage to inspect it',
                empty: copy?.sqlFlowNoStages ?? 'No SQL stages were found in this statement.',
            };
        case 'explain-plan':
            return {
                terminology: {
                    graph: copy?.logicalPlan ?? 'Logical query plan',
                    item: copy?.planStep ?? 'steps',
                    selected: copy?.planSelectedStep ?? 'Selected step',
                    action: copy?.planInspectStep ?? 'Inspect step',
                    details: copy?.planStepDetails ?? 'Selected plan step details',
                },
                connection: 'connections',
                viewport: `${copy?.logicalPlan ?? 'Logical query plan'} · ${copy?.planGraphView ?? 'Graph'}`,
                svg: copy?.planGraphHint ?? 'Select a step to inspect its properties.',
                empty: copy?.pipelineNoOutput ?? 'This pipeline did not return any operator nodes.',
            };
        case 'index-analysis':
            return {
                terminology: {
                    graph: copy?.indexAnalysisGraph ?? 'Index pruning graph',
                    item: copy?.indexAnalysisItem ?? 'index checks',
                    selected: copy?.indexAnalysisSelected ?? 'Selected index',
                    action: copy?.indexAnalysisInspect ?? 'Inspect index',
                    details: copy?.indexAnalysisDetails ?? 'Selected index details',
                },
                connection: 'connections',
                viewport: `${copy?.indexAnalysisGraph ?? 'Index pruning graph'} · ${copy?.planGraphView ?? 'Graph'}`,
                svg:
                    copy?.indexAnalysisHint ??
                    'Select an index to inspect its condition and pruning counts.',
                empty: copy?.pipelineNoOutput ?? 'This pipeline did not return any operator nodes.',
            };
        case 'runtime':
            return {
                terminology: {
                    graph: copy?.runtimeGraph ?? 'Measured runtime',
                    item: copy?.sqlFlowOperators ?? 'stages',
                    selected: copy?.selectedOperator ?? 'Selected stage',
                    action: copy?.inspectOperator ?? 'Inspect stage',
                    details: copy?.selectedOperatorDetails ?? 'Selected runtime stage details',
                },
                connection: 'connections',
                viewport: `${copy?.runtimeGraph ?? 'Measured runtime'} · ${copy?.planGraphView ?? 'Graph'}`,
                svg: copy?.pipelineGraphHint ?? 'Click an operator to inspect it',
                empty: copy?.pipelineNoOutput ?? 'This pipeline did not return any operator nodes.',
            };
        default:
            return {
                terminology: {
                    graph: copy?.pipelineGraph ?? 'Execution plan graph',
                    item: copy?.sqlFlowOperators ?? 'operators',
                    selected: copy?.selectedOperator ?? 'Selected operator',
                    action: copy?.inspectOperator ?? 'Inspect operator',
                    details: copy?.selectedOperatorDetails ?? 'Selected operator details',
                },
                connection: 'connections',
                viewport: 'Scrollable operator graph',
                svg: copy?.pipelineGraphHint ?? 'Click an operator to inspect it',
                empty: copy?.pipelineNoOutput ?? 'This pipeline did not return any operator nodes.',
            };
    }
}

export function graphNodeKindLabel(
    kind: PipelineGraphKind,
    node: ProfilePipelineNode,
    copy?: Copy['common'],
) {
    if (kind === 'sql-flow') return sqlFlowNodeKind(node.kind, copy);
    if (kind === 'explain-plan') return copy?.planStep ?? 'step';
    if (kind !== 'index-analysis') return node.kind;
    if (node.kind === 'read') return 'READ';
    if (node.kind === 'filter') return 'INDEX';
    return 'OUTPUT';
}
