import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    useId,
    useRef,
    type CSSProperties,
    type KeyboardEvent,
} from 'react';
import type { ReactNode } from 'react';
import type { ProfilePipeline, ProfilePipelineNode } from '../../shared/types';
import {
    autoFocusGraphKinds,
    centerGraphNode,
    focusPipeline,
    graphLabels,
    GraphLayout,
    graphNodeKindLabel,
    labelLines,
    layoutPipeline,
    nodeHeight,
    nodeWidth,
    pathFor,
    sqlFlowNodeDetail,
    sqlFlowNodeKind,
    sqlFlowNodeLabel,
    sqlFlowNodeStatus,
    type PipelineGraphKind,
} from './pipeline-graph-model';
import type { Copy } from '../i18n';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';

export function PipelineGraph({
    pipeline,
    heading,
    subheading,
    graphKind = 'execution',
    onSelectNode,
    renderSelection,
    initialSelectedId,
    copy,
}: {
    pipeline: ProfilePipeline;
    heading?: string;
    subheading?: string;
    graphKind?: PipelineGraphKind;
    onSelectNode?: (node: ProfilePipelineNode) => void;
    renderSelection?: (node: ProfilePipelineNode) => ReactNode;
    initialSelectedId?: string;
    copy?: Copy['common'];
}) {
    const runtime = graphKind === 'runtime';
    const layout = useMemo(() => layoutPipeline(pipeline), [pipeline]);
    const firstNodeId =
        initialSelectedId && pipeline.nodes.some(node => node.id === initialSelectedId)
            ? initialSelectedId
            : pipeline.nodes[0]?.id;
    const [selectedId, setSelectedId] = useState<string | undefined>(firstNodeId);
    const [zoom, setZoom] = useState(1);
    const graphViewport = useRef<HTMLDivElement>(null);
    const setGraphViewport = useCallback((element: HTMLDivElement | null) => {
        graphViewport.current = element;
    }, []);
    const graphWidth = Math.max(480, layout.width);
    const graphHeight = Math.max(160, layout.height);
    useEffect(() => {
        const initialNodeId = firstNodeId;
        setSelectedId(initialNodeId);
        setZoom(1);
        if (!autoFocusGraphKinds.has(graphKind) || !initialNodeId) return;
        const initialNode = layout.nodes.find(({ node }) => node.id === initialNodeId);
        const frame = window.requestAnimationFrame(() => {
            const viewport = graphViewport.current;
            if (viewport && initialNode) centerGraphNode(viewport, initialNode, 1);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [pipeline, layout, graphKind, firstNodeId]);
    const selected = pipeline.nodes.find(node => node.id === selectedId) ?? pipeline.nodes[0];
    const graphId = `pipeline-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const markerId = `${graphId}-arrow`;
    const activeMarkerId = `${graphId}-arrow-active`;
    const gridId = `${graphId}-grid`;
    const ambientId = `${graphId}-ambient`;
    const focusedGraph = useMemo(
        () => focusPipeline(pipeline, selected?.id),
        [pipeline, selected?.id],
    );
    const incomingCount = selected
        ? pipeline.edges.filter(edge => edge.target === selected.id).length
        : 0;
    const outgoingCount = selected
        ? pipeline.edges.filter(edge => edge.source === selected.id).length
        : 0;
    const chooseNode = (node: ProfilePipelineNode) => {
        setSelectedId(node.id);
        onSelectNode?.(node);
    };
    const focusNodeElement = (nodeId: string) => {
        for (const element of graphViewport.current?.querySelectorAll<SVGGElement>(
            '[data-node-id]',
        ) ?? []) {
            if (element.dataset.nodeId !== nodeId) continue;
            element.focus();
            return;
        }
    };
    const zoomTo = (nextZoom: number) => {
        const viewport = graphViewport.current;
        if (!viewport) {
            setZoom(nextZoom);
            return;
        }
        const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom;
        const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom;
        setZoom(nextZoom);
        window.requestAnimationFrame(() => {
            const currentViewport = graphViewport.current;
            if (!currentViewport) return;
            currentViewport.scrollTo({
                left: Math.max(0, centerX * nextZoom - currentViewport.clientWidth / 2),
                top: Math.max(0, centerY * nextZoom - currentViewport.clientHeight / 2),
            });
        });
    };
    const onNodeKeyDown = (event: KeyboardEvent<SVGGElement>, node: ProfilePipelineNode) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            chooseNode(node);
            return;
        }
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const currentIndex = layout.nodes.findIndex(
            ({ node: candidate }) => candidate.id === node.id,
        );
        if (currentIndex < 0) return;
        const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
        const next =
            layout.nodes[(currentIndex + direction + layout.nodes.length) % layout.nodes.length];
        if (!next) return;
        chooseNode(next.node);
        focusNodeElement(next.node.id);
        const viewport = graphViewport.current;
        if (viewport) centerGraphNode(viewport, next, zoom, 'smooth');
    };
    const fitGraph = () => {
        const viewport = graphViewport.current;
        if (!viewport) return;
        const availableWidth = Math.max(1, viewport.clientWidth - 24);
        const availableHeight = Math.max(1, viewport.clientHeight - 24);
        setZoom(Math.min(1, availableWidth / graphWidth, availableHeight / graphHeight));
        viewport.scrollTo({ top: 0, left: 0 });
    };
    const focusSelectedNode = () => {
        if (!selected) return;
        const node = layout.nodes.find(({ node: candidate }) => candidate.id === selected.id);
        const viewport = graphViewport.current;
        if (!node || !viewport) return;
        setZoom(1);
        window.requestAnimationFrame(() => {
            const currentViewport = graphViewport.current;
            if (currentViewport) centerGraphNode(currentViewport, node, 1, 'smooth');
        });
    };

    const labels = graphLabels(graphKind, copy);
    const terminology = labels.terminology;
    const connectionLabel = labels.connection;
    const viewportLabel = labels.viewport;

    if (!pipeline.nodes.length) return <div className="pipeline-graph-empty">{labels.empty}</div>;

    return (
        <div
            className={`pipeline-graph-card grid gap-3 rounded-xl border p-3${runtime ? ' is-runtime-graph' : ''}`}
            role="group"
            aria-label={terminology.graph}
        >
            {graphKind !== 'explain-plan' && (
                <div className="pipeline-graph-heading">
                    <div>
                        <span className="eyebrow">
                            {heading ??
                                (graphKind === 'index-analysis' || runtime
                                    ? terminology.graph
                                    : pipeline.source === 'explain_pipeline'
                                      ? 'CLICKHOUSE OPERATOR PLAN'
                                      : 'ESTIMATED QUERY SHAPE')}
                        </span>
                        <strong>
                            {(graphKind === 'index-analysis'
                                ? pipeline.nodes.filter(node => node.kind === 'filter').length
                                : pipeline.nodes.length
                            ).toLocaleString()}{' '}
                            {terminology.item} <i>·</i> {pipeline.edges.length.toLocaleString()}{' '}
                            {connectionLabel}
                        </strong>
                    </div>
                    <small>
                        {subheading ??
                            (graphKind === 'index-analysis'
                                ? (copy?.indexAnalysisDescription ??
                                  'ClickHouse-reported index checks with parts and granules retained.')
                                : runtime
                                  ? (copy?.runtimeGraphDescription ??
                                    'Measured execution stages from EXPLAIN ANALYZE.')
                                  : pipeline.source === 'explain_pipeline'
                                    ? (copy?.pipelineGraphDescription ??
                                      'Planned topology · runtime counters are run-level')
                                    : 'Estimated from SQL structure')}
                    </small>
                </div>
            )}
            {pipeline.truncated && graphKind !== 'explain-plan' && (
                <p className="pipeline-graph-warning" role="status">
                    {graphKind === 'sql-flow'
                        ? (copy?.sqlFlowTruncatedWarning ??
                          'This query is large. The graph shows a bounded set of SQL stages.')
                        : graphKind === 'index-analysis'
                          ? (copy?.planTruncated ??
                            'The index output is large. Some checks are hidden.')
                          : (copy?.pipelineGraphTruncated ??
                            'This plan is large. The graph shows a bounded set of operators.')}
                </p>
            )}
            <div
                className="pipeline-graph-controls"
                role="group"
                aria-label={copy?.pipelineZoomControls ?? 'Graph view controls'}
            >
                <button
                    type="button"
                    aria-label={copy?.pipelineZoomOut ?? 'Zoom out'}
                    title={copy?.pipelineZoomOut ?? 'Zoom out'}
                    disabled={zoom <= 0.02}
                    onClick={() => zoomTo(Math.max(0.02, zoom / 1.2))}
                >
                    −
                </button>
                <output aria-label={copy?.pipelineZoomLevel ?? 'Zoom level'}>
                    {Math.round(zoom * 100)}%
                </output>
                <button
                    type="button"
                    aria-label={copy?.pipelineZoomIn ?? 'Zoom in'}
                    title={copy?.pipelineZoomIn ?? 'Zoom in'}
                    disabled={zoom >= 2.5}
                    onClick={() => zoomTo(Math.min(2.5, zoom * 1.2))}
                >
                    +
                </button>
                <button
                    type="button"
                    className="pipeline-control-action pipeline-focus-node"
                    aria-label={copy?.pipelineFocusNode ?? 'Focus node'}
                    title={copy?.pipelineFocusNode ?? 'Focus node'}
                    onClick={focusSelectedNode}
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <circle cx="8" cy="8" r="4.25" />
                        <path d="M8 1.5v2.2m0 8.6v2.2M1.5 8h2.2m8.6 0h2.2" />
                    </svg>
                    <span>{copy?.pipelineFocusNode ?? 'Focus node'}</span>
                </button>
                <button
                    type="button"
                    className="pipeline-control-action pipeline-zoom-fit"
                    aria-label={copy?.pipelineFit ?? 'Fit graph'}
                    title={copy?.pipelineFit ?? 'Fit graph'}
                    onClick={fitGraph}
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <path d="M6 2H2v4m0-4 4 4m4-4h4v4m0-4-4 4M2 10v4h4m-4 0 4-4m8 4h-4m4 0v-4m0 4-4-4" />
                    </svg>
                    <span>{copy?.pipelineFit ?? 'Fit graph'}</span>
                </button>
            </div>
            {renderPipelineGraphViewport({
                setGraphViewport,
                viewportLabel,
                graphWidth,
                zoom,
                graphHeight,
                labels,
                gridId,
                ambientId,
                markerId,
                activeMarkerId,
                layout,
                focusedGraph,
                runtime,
                selected,
                graphKind,
                copy,
                terminology,
                chooseNode,
                onNodeKeyDown,
            })}
            {selected && (
                <div
                    className={`pipeline-node-inspector${graphKind === 'explain-plan' ? ' is-plan' : ''}${graphKind === 'index-analysis' ? ' is-index-analysis' : ''}`}
                    aria-live="polite"
                    aria-label={terminology.details}
                >
                    <div className="pipeline-node-inspector-main">
                        <span className="eyebrow">{terminology.selected.toUpperCase()}</span>
                        <strong>
                            {graphKind === 'sql-flow'
                                ? sqlFlowNodeLabel(selected, copy)
                                : selected.label}
                        </strong>
                        {graphKind === 'explain-plan' || graphKind === 'index-analysis' ? (
                            renderSelection?.(selected)
                        ) : (
                            <>
                                <small>
                                    {graphKind === 'sql-flow'
                                        ? sqlFlowNodeKind(selected.kind, copy)
                                        : selected.kind}{' '}
                                    <i>·</i>{' '}
                                    {graphKind === 'sql-flow'
                                        ? sqlFlowNodeStatus(selected.status, copy)
                                        : selected.status === 'planned'
                                          ? (copy?.plannedStatus ?? selected.status)
                                          : selected.status}
                                </small>
                                {sqlFlowNodeDetail(
                                    selected,
                                    graphKind === 'sql-flow' ? copy : undefined,
                                ) &&
                                    sqlFlowNodeDetail(
                                        selected,
                                        graphKind === 'sql-flow' ? copy : undefined,
                                    ) !== selected.label && (
                                        <p>
                                            {sqlFlowNodeDetail(
                                                selected,
                                                graphKind === 'sql-flow' ? copy : undefined,
                                            )}
                                        </p>
                                    )}
                            </>
                        )}
                    </div>
                    {graphKind !== 'explain-plan' &&
                        graphKind !== 'index-analysis' &&
                        renderPipelineNodeFacts({
                            selected,
                            copy,
                            graphKind,
                            incomingCount,
                            outgoingCount,
                            runtime,
                        })}
                </div>
            )}
        </div>
    );
}

function renderPipelineNodeFacts({
    selected,
    copy,
    graphKind,
    incomingCount,
    outgoingCount,
    runtime,
}: {
    selected: ProfilePipelineNode;
    copy: Copy['common'] | undefined;
    graphKind: PipelineGraphKind;
    incomingCount: number;
    outgoingCount: number;
    runtime: boolean;
}) {
    return (
        <div className="pipeline-node-facts">
            {selected.parallelism !== undefined && (
                <span>
                    <small>{copy?.parallelism ?? 'Parallelism'}</small>
                    <strong>{selected.parallelism.toLocaleString()}</strong>
                </span>
            )}
            <span>
                <small>
                    {graphKind === 'sql-flow'
                        ? (copy?.sqlFlowInputs ?? 'Inputs')
                        : (copy?.pipelineInputs ?? 'Inputs')}
                </small>
                <strong>{incomingCount}</strong>
            </span>
            <span>
                <small>
                    {graphKind === 'sql-flow'
                        ? (copy?.sqlFlowOutputs ?? 'Outputs')
                        : (copy?.pipelineOutputs ?? 'Outputs')}
                </small>
                <strong>{outgoingCount}</strong>
            </span>
            {selected.durationMs !== undefined && (
                <span>
                    <small>{copy?.pipelineRunDuration ?? 'Run duration'}</small>
                    <strong>
                        {selected.durationMs < 1
                            ? `${selected.durationMs.toFixed(2)} ms`
                            : `${selected.durationMs.toFixed(1)} ms`}
                    </strong>
                </span>
            )}
            {runtime ? (
                <>
                    {selected.timePercent !== undefined && (
                        <span>
                            <small>Execution share</small>
                            <strong>{selected.timePercent}%</strong>
                        </span>
                    )}
                    {selected.inputRows !== undefined && (
                        <span>
                            <small>Rows in</small>
                            <strong>{selected.inputRows}</strong>
                        </span>
                    )}
                    {selected.outputRows !== undefined && (
                        <span>
                            <small>Rows out</small>
                            <strong>{selected.outputRows}</strong>
                        </span>
                    )}
                    {selected.inputBytes !== undefined && (
                        <span>
                            <small>Bytes in</small>
                            <strong>{selected.inputBytes}</strong>
                        </span>
                    )}
                    {selected.outputBytes !== undefined && (
                        <span>
                            <small>Bytes out</small>
                            <strong>{selected.outputBytes}</strong>
                        </span>
                    )}
                </>
            ) : (
                <>
                    {selected.rows !== undefined && (
                        <span>
                            <small>{copy?.pipelineRunRows ?? 'Run rows'}</small>
                            <strong>{Number(selected.rows).toLocaleString()}</strong>
                        </span>
                    )}
                    {selected.bytes !== undefined && (
                        <span>
                            <small>{copy?.pipelineRunBytes ?? 'Run bytes'}</small>
                            <strong>{selected.bytes}</strong>
                        </span>
                    )}
                </>
            )}
        </div>
    );
}

function renderPipelineGraphViewport({
    setGraphViewport,
    viewportLabel,
    graphWidth,
    zoom,
    graphHeight,
    labels,
    gridId,
    ambientId,
    markerId,
    activeMarkerId,
    layout,
    focusedGraph,
    runtime,
    selected,
    graphKind,
    copy,
    terminology,
    chooseNode,
    onNodeKeyDown,
}: {
    setGraphViewport: (element: HTMLDivElement | null) => void;
    viewportLabel: string;
    graphWidth: number;
    zoom: number;
    graphHeight: number;
    labels: ReturnType<typeof graphLabels>;
    gridId: string;
    ambientId: string;
    markerId: string;
    activeMarkerId: string;
    layout: GraphLayout;
    focusedGraph: { nodeIds: Set<string>; edgeIds: Set<string> } | undefined;
    runtime: boolean;
    selected: ProfilePipelineNode | undefined;
    graphKind: PipelineGraphKind;
    copy: Copy['common'] | undefined;
    terminology: { graph: string; item: string; selected: string; action: string; details: string };
    chooseNode: (node: ProfilePipelineNode) => void;
    onNodeKeyDown: (event: KeyboardEvent<SVGGElement>, node: ProfilePipelineNode) => void;
}) {
    return (
        <ScrollEdgeFrame<HTMLDivElement>
            className="pipeline-graph-viewport-frame"
            onViewport={setGraphViewport}
        >
            {ref => (
                <div
                    ref={ref}
                    className="pipeline-graph-scroll overflow-auto"
                    role="region"
                    aria-label={viewportLabel}
                >
                    <svg
                        className="pipeline-graph-svg"
                        width={Math.round(graphWidth * zoom)}
                        height={Math.round(graphHeight * zoom)}
                        viewBox={`0 0 ${graphWidth} ${graphHeight}`}
                        role="group"
                        aria-label={labels.svg}
                    >
                        <defs>
                            <pattern
                                id={gridId}
                                width="32"
                                height="32"
                                patternUnits="userSpaceOnUse"
                            >
                                <path d="M 32 0 H 0 V 32" className="pipeline-graph-grid-line" />
                            </pattern>
                            <radialGradient id={ambientId} cx="50%" cy="0%" r="90%">
                                <stop offset="0%" stopColor="var(--accent)" stopOpacity=".16" />
                                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                            </radialGradient>
                            <marker
                                id={markerId}
                                viewBox="0 0 10 10"
                                refX="8"
                                refY="5"
                                markerWidth="7"
                                markerHeight="7"
                                orient="auto-start-reverse"
                            >
                                <path d="M 0 0 L 10 5 L 0 10 z" className="pipeline-graph-arrow" />
                            </marker>
                            <marker
                                id={activeMarkerId}
                                viewBox="0 0 10 10"
                                refX="8"
                                refY="5"
                                markerWidth="7"
                                markerHeight="7"
                                orient="auto-start-reverse"
                            >
                                <path
                                    d="M 0 0 L 10 5 L 0 10 z"
                                    className="pipeline-graph-arrow-active"
                                />
                            </marker>
                        </defs>
                        <g className="pipeline-graph-atmosphere" aria-hidden="true">
                            <rect
                                width={graphWidth}
                                height={graphHeight}
                                fill={`url(#${gridId})`}
                            />
                            <rect
                                width={graphWidth}
                                height={graphHeight}
                                fill={`url(#${ambientId})`}
                            />
                        </g>
                        <g className="pipeline-graph-edges" aria-hidden="true">
                            {layout.edges.map((edge, index) => {
                                const middle = edge.points[Math.floor(edge.points.length / 2)];
                                const edgeId = `${edge.source}\u0000${edge.target}`;
                                const active = focusedGraph?.edgeIds.has(edgeId) ?? false;
                                const edgeState = focusedGraph
                                    ? active
                                        ? ' is-active'
                                        : ' is-muted'
                                    : '';
                                const path = pathFor(edge.points);
                                const flowStyle =
                                    runtime && edge.flow !== undefined
                                        ? { strokeWidth: `${1 + Math.sqrt(edge.flow) * 3}px` }
                                        : undefined;
                                const showLabel = Boolean(
                                    edge.label &&
                                    (!runtime ||
                                        edge.source === selected?.id ||
                                        edge.target === selected?.id),
                                );
                                return (
                                    <g
                                        key={`${edge.source}-${edge.target}-${index}`}
                                        className={`pipeline-graph-edge${edgeState}${runtime ? ' is-runtime-edge' : ''}`}
                                    >
                                        {active && <path className="pipeline-edge-glow" d={path} />}
                                        <path
                                            className="pipeline-edge-line"
                                            d={path}
                                            markerEnd={`url(#${active ? activeMarkerId : markerId})`}
                                            style={flowStyle}
                                        />
                                        {active &&
                                            (edge.source === selected?.id ||
                                                edge.target === selected?.id) && (
                                                <path className="pipeline-edge-pulse" d={path} />
                                            )}
                                        {showLabel && middle && (
                                            <text x={middle.x + 7} y={middle.y - 5}>
                                                {edge.label}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}
                        </g>
                        {layout.nodes.map(({ node, x, y }) => {
                            const label =
                                graphKind === 'sql-flow'
                                    ? sqlFlowNodeLabel(node, copy)
                                    : node.label;
                            const lines = labelLines(label);
                            const active = selected?.id === node.id;
                            const related = focusedGraph?.nodeIds.has(node.id) ?? false;
                            const status =
                                graphKind === 'execution' && node.status === 'planned'
                                    ? (copy?.plannedStatus ?? node.status)
                                    : node.status;
                            const nodeKindLabel = graphNodeKindLabel(graphKind, node, copy);
                            const nodeStatus =
                                graphKind === 'index-analysis'
                                    ? node.detail
                                    : graphKind === 'sql-flow'
                                      ? sqlFlowNodeStatus(node.status, copy)
                                      : status;
                            const focusState = focusedGraph
                                ? active
                                    ? ' is-selected'
                                    : related
                                      ? ' is-related'
                                      : ' is-muted'
                                : '';
                            const runtimeShare = Math.max(0, Math.min(100, node.timePercent ?? 0));
                            const runtimeStyle = runtime
                                ? ({
                                      '--runtime-node-fill': `color-mix(in srgb, var(--accent) ${10 + runtimeShare * 0.34}%, var(--panel-raised))`,
                                      '--runtime-node-stroke': `color-mix(in srgb, var(--accent) ${18 + runtimeShare * 0.62}%, var(--line-bright))`,
                                  } as CSSProperties)
                                : undefined;
                            const runtimeTiming =
                                node.durationMs === undefined
                                    ? ''
                                    : `${node.durationMs < 1 ? node.durationMs.toFixed(2) : node.durationMs.toFixed(1)} ms${node.timePercent === undefined ? '' : ` · ${node.timePercent}%`}`;
                            return (
                                <g
                                    key={node.id}
                                    role="button"
                                    tabIndex={active ? 0 : -1}
                                    aria-label={`${terminology.action} ${label}${node.detail ? ` · ${node.detail}` : ''}`}
                                    aria-pressed={active}
                                    data-node-id={node.id}
                                    className={`pipeline-graph-node pipeline-node-${node.kind}${runtime ? ' is-runtime-node' : ''}${focusState}`}
                                    style={runtimeStyle}
                                    transform={`translate(${x - nodeWidth / 2} ${y - nodeHeight / 2})`}
                                    onClick={event => {
                                        chooseNode(node);
                                        event.currentTarget.focus();
                                    }}
                                    onKeyDown={event => onNodeKeyDown(event, node)}
                                >
                                    <title>
                                        {node.detail ? `${label}\n${node.detail}` : label}
                                    </title>
                                    <rect
                                        className="pipeline-node-shadow"
                                        x="10"
                                        y="10"
                                        width={nodeWidth}
                                        height={nodeHeight}
                                        rx="11"
                                    />
                                    <path
                                        className="pipeline-node-side"
                                        d={`M 0 ${nodeHeight - 1} H ${nodeWidth} L ${nodeWidth + 10} ${nodeHeight + 9} H 10 Z`}
                                    />
                                    <path
                                        className="pipeline-node-side-right"
                                        d={`M ${nodeWidth - 1} 4 L ${nodeWidth + 9} 13 V ${nodeHeight + 9} L ${nodeWidth - 1} ${nodeHeight - 1} Z`}
                                    />
                                    <rect
                                        className="pipeline-node-face"
                                        width={nodeWidth}
                                        height={nodeHeight}
                                        rx="11"
                                    />
                                    <path
                                        className="pipeline-node-cap"
                                        d={`M 12 1 H ${nodeWidth - 12}`}
                                    />
                                    <path className="pipeline-node-accent-rail" d="M 1 17 V 57" />
                                    <text className="pipeline-node-kind" x="14" y="19">
                                        {nodeKindLabel.toUpperCase()}
                                    </text>
                                    {lines.map((line, index) => (
                                        <text
                                            className="pipeline-node-label"
                                            key={index}
                                            x="14"
                                            y={43 + index * 15}
                                        >
                                            {line}
                                        </text>
                                    ))}
                                    {node.parallelism !== undefined && (
                                        <text
                                            className="pipeline-node-parallel"
                                            x={nodeWidth - 12}
                                            y="20"
                                            textAnchor="end"
                                        >
                                            × {node.parallelism}
                                        </text>
                                    )}
                                    {runtime ? (
                                        <text
                                            className="pipeline-node-status runtime-node-timing"
                                            x={nodeWidth - 12}
                                            y={nodeHeight - 11}
                                            textAnchor="end"
                                        >
                                            {runtimeTiming}
                                        </text>
                                    ) : (
                                        graphKind !== 'explain-plan' && (
                                            <text
                                                className="pipeline-node-status"
                                                x={nodeWidth - 12}
                                                y={nodeHeight - 11}
                                                textAnchor="end"
                                            >
                                                {nodeStatus}
                                            </text>
                                        )
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                </div>
            )}
        </ScrollEdgeFrame>
    );
}
