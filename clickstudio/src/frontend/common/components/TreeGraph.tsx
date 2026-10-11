import { hierarchy, tree } from 'd3';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
    initialExpanded,
    indexTree,
    visibleTree,
    type TreeGraphModel,
    type TreeGraphNode,
    type VisibleTreeGraphNode,
} from './tree-model';
import type { Copy } from '../translations/i18n';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';

const nodeWidth = 220;
const nodeHeight = 72;
const graphPadding = 30;

type TreeGraphPresentation = {
    label: string;
    heading: string;
    hint: string;
    empty: string;
    truncated: string;
    selectedNode: string;
    typeAttribute: 'data-ast-node-type' | 'data-query-tree-type';
    pathAttribute: 'data-ast-node-path' | 'data-query-tree-path';
    inspectorClass?: string;
};

function compact(value: string | undefined, max = 30) {
    if (!value) return '';
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function TreeGraph({
    model,
    copy,
    presentation,
    category,
    resetKey,
}: {
    model: TreeGraphModel;
    copy: Copy['common'];
    presentation: TreeGraphPresentation;
    category: (type: string) => string;
    resetKey?: unknown;
}) {
    const root = model.root;
    const nodeIndex = useMemo(
        () => (root ? indexTree(root) : new Map<string, TreeGraphNode>()),
        [root],
    );
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [selectedId, setSelectedId] = useState<string>();
    const [zoom, setZoom] = useState(1);
    const graphViewport = useRef<HTMLDivElement>(null);
    const setGraphViewport = useCallback((viewport: HTMLDivElement | null) => {
        graphViewport.current = viewport;
    }, []);

    useEffect(() => {
        setExpanded(root ? initialExpanded(root) : new Set());
        setSelectedId(root?.id);
        setZoom(1);
    }, [resetKey, root]);

    const visible = useMemo(
        () => (root ? visibleTree(root, expanded) : { root: undefined, truncated: false }),
        [root, expanded],
    );
    const layout = useMemo(() => {
        if (!visible.root) return { width: 480, height: 180, nodes: [], links: [] };
        const laidOut = tree<VisibleTreeGraphNode>().nodeSize([nodeWidth + 34, nodeHeight + 56])(
            hierarchy(visible.root, node => node.children),
        );
        const nodes = laidOut.descendants();
        const minX = Math.min(...nodes.map(node => node.x));
        const maxX = Math.max(...nodes.map(node => node.x));
        const maxY = Math.max(...nodes.map(node => node.y));
        const offsetX = graphPadding + nodeWidth / 2 - minX;
        const offsetY = graphPadding + nodeHeight / 2;
        return {
            width: Math.max(480, maxX - minX + nodeWidth + graphPadding * 2),
            height: Math.max(180, maxY + nodeHeight + graphPadding * 2),
            nodes: nodes.map(node => ({ node, x: node.x + offsetX, y: node.y + offsetY })),
            links: laidOut.links().map(link => ({
                source: { x: link.source.x + offsetX, y: link.source.y + offsetY },
                target: { x: link.target.x + offsetX, y: link.target.y + offsetY },
            })),
        };
    }, [visible.root]);

    if (!root)
        return (
            <div className="pipeline-graph-empty" role="status">
                {presentation.empty}
            </div>
        );

    const selected = selectedId ? (nodeIndex.get(selectedId) ?? root) : root;
    const selectedExpanded = expanded.has(selected.id);
    const graphWidth = Math.max(480, layout.width);
    const graphHeight = Math.max(180, layout.height);
    const toggle = (node: TreeGraphNode) => {
        if (!node.children.length) return;
        setExpanded(current => {
            const next = new Set(current);
            if (next.has(node.id)) next.delete(node.id);
            else next.add(node.id);
            return next;
        });
    };
    const choose = (node: TreeGraphNode) => setSelectedId(node.id);
    const onNodeKeyDown = (event: KeyboardEvent<SVGGElement>, node: TreeGraphNode) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        choose(node);
    };
    const fitGraph = () => {
        const viewport = graphViewport.current;
        if (!viewport) return;
        const availableWidth = Math.max(1, viewport.clientWidth - 24);
        const availableHeight = Math.max(1, viewport.clientHeight - 24);
        setZoom(Math.min(1, availableWidth / graphWidth, availableHeight / graphHeight));
        viewport.scrollTo({ top: 0, left: 0 });
    };

    return (
        <div
            className="pipeline-graph-card ast-graph-card grid gap-3 rounded-xl border p-3"
            role="group"
            aria-label={presentation.label}
        >
            <div className="pipeline-graph-heading">
                <div>
                    <span className="eyebrow">{presentation.heading.toUpperCase()}</span>
                    <strong>
                        {model.nodeCount.toLocaleString()} {copy.sqlAstNodes}
                    </strong>
                </div>
                <small>{presentation.hint}</small>
            </div>
            {(model.truncated || visible.truncated) && (
                <p className="pipeline-graph-warning" role="status">
                    {presentation.truncated}
                </p>
            )}
            <div
                className="pipeline-graph-controls"
                role="group"
                aria-label={copy.pipelineZoomControls}
            >
                {selected.children.length > 0 && (
                    <button
                        type="button"
                        className="ast-expand-selected"
                        onClick={() => toggle(selected)}
                    >
                        {selectedExpanded ? copy.collapse : copy.expand}
                    </button>
                )}
                <button
                    type="button"
                    aria-label={copy.pipelineZoomOut}
                    title={copy.pipelineZoomOut}
                    disabled={zoom <= 0.02}
                    onClick={() => setZoom(current => Math.max(0.02, current / 1.2))}
                >
                    −
                </button>
                <button
                    type="button"
                    className="pipeline-zoom-reset"
                    aria-label={copy.pipelineZoomReset}
                    title={copy.pipelineZoomReset}
                    onClick={() => setZoom(1)}
                >
                    100%
                </button>
                <output aria-label={copy.pipelineZoomLevel}>{Math.round(zoom * 100)}%</output>
                <button
                    type="button"
                    aria-label={copy.pipelineZoomIn}
                    title={copy.pipelineZoomIn}
                    disabled={zoom >= 2.5}
                    onClick={() => setZoom(current => Math.min(2.5, current * 1.2))}
                >
                    +
                </button>
                <button
                    type="button"
                    className="pipeline-zoom-fit"
                    aria-label={copy.pipelineFit}
                    title={copy.pipelineFit}
                    onClick={fitGraph}
                >
                    {copy.pipelineFit}
                </button>
            </div>
            <ScrollEdgeFrame<HTMLDivElement>
                className="pipeline-graph-viewport-frame"
                onViewport={setGraphViewport}
            >
                {ref => (
                    <div
                        ref={ref}
                        className="pipeline-graph-scroll ast-graph-scroll overflow-auto"
                        role="region"
                        aria-label={presentation.label}
                    >
                        <svg
                            className="pipeline-graph-svg ast-graph-svg"
                            width={Math.round(graphWidth * zoom)}
                            height={Math.round(graphHeight * zoom)}
                            viewBox={`0 0 ${graphWidth} ${graphHeight}`}
                            role="group"
                            aria-label={presentation.hint}
                        >
                            <g className="ast-graph-edges" aria-hidden="true">
                                {layout.links.map((link, index) => {
                                    const middleY = (link.source.y + link.target.y) / 2;
                                    return (
                                        <path
                                            key={index}
                                            d={`M ${link.source.x} ${link.source.y + nodeHeight / 2} C ${link.source.x} ${middleY}, ${link.target.x} ${middleY}, ${link.target.x} ${link.target.y - nodeHeight / 2}`}
                                        />
                                    );
                                })}
                            </g>
                            {layout.nodes.map(({ node, x, y }) => {
                                const source = node.data.source;
                                const active = selected.id === source.id;
                                const isExpanded = expanded.has(source.id);
                                const label = source.summary
                                    ? `${source.type} · ${source.summary}`
                                    : source.type;
                                return (
                                    <g
                                        key={source.id}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={label}
                                        aria-pressed={active}
                                        {...{
                                            [presentation.typeAttribute]: source.type,
                                            [presentation.pathAttribute]: source.path,
                                        }}
                                        className={`ast-graph-node ast-node-${category(source.type)}${active ? ' is-selected' : ''}`}
                                        transform={`translate(${x - nodeWidth / 2} ${y - nodeHeight / 2})`}
                                        onClick={() => choose(source)}
                                        onDoubleClick={() => toggle(source)}
                                        onKeyDown={event => onNodeKeyDown(event, source)}
                                    >
                                        <title>{label}</title>
                                        <rect width={nodeWidth} height={nodeHeight} rx="11" />
                                        <text className="ast-node-field" x="13" y="17">
                                            {compact(source.field, 25)}
                                        </text>
                                        {source.children.length > 0 && (
                                            <text
                                                className="ast-node-toggle"
                                                x={nodeWidth - 12}
                                                y="17"
                                                textAnchor="end"
                                            >
                                                {isExpanded ? '−' : `+${source.childCount}`}
                                            </text>
                                        )}
                                        <text className="ast-node-type" x="13" y="40">
                                            {compact(source.type, 29)}
                                        </text>
                                        <text className="ast-node-summary" x="13" y="59">
                                            {compact(
                                                source.summary ||
                                                    `${source.childCount} child${source.childCount === 1 ? '' : 'ren'}`,
                                                31,
                                            )}
                                        </text>
                                    </g>
                                );
                            })}
                        </svg>
                    </div>
                )}
            </ScrollEdgeFrame>
            <div
                className={[
                    'pipeline-node-inspector ast-node-inspector',
                    presentation.inspectorClass,
                ]
                    .filter(Boolean)
                    .join(' ')}
                aria-live="polite"
                aria-label={presentation.selectedNode}
            >
                <div className="pipeline-node-inspector-main">
                    <span className="eyebrow">{presentation.selectedNode.toUpperCase()}</span>
                    <strong>
                        {selected.type}
                        {selected.summary ? ` · ${selected.summary}` : ''}
                    </strong>
                    <small>{copy.sqlAstPath}</small>
                    <code className="ast-node-path" title={selected.path}>
                        {selected.path}
                    </code>
                </div>
                <div className="pipeline-node-facts">
                    <span>
                        <small>{copy.sqlAstChildren}</small>
                        <strong>{selected.childCount.toLocaleString()}</strong>
                    </span>
                    <span>
                        <small>{copy.sqlAstProperties}</small>
                        <strong>{selected.propertyCount.toLocaleString()}</strong>
                    </span>
                </div>
                {selected.properties.length > 0 && (
                    <dl className="ast-node-properties">
                        {selected.properties.map(property => (
                            <div key={property.name}>
                                <dt>{property.name}</dt>
                                <dd>
                                    <code title={property.value}>{property.value}</code>
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>
        </div>
    );
}
