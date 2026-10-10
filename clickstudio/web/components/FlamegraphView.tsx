import { hierarchy, partition } from 'd3';
import type { HierarchyRectangularNode } from 'd3';
import { useMemo, useState, type KeyboardEvent } from 'react';
import type { FlamegraphFrame, FlamegraphSeries } from '../../shared/flamegraph';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';

const width = 1120;
const height = 390;

function frameDescription(frame: FlamegraphFrame, total: number) {
    const share = total ? ((frame.samples / total) * 100).toFixed(1) : '0.0';
    return `${frame.name} · ${frame.samples.toLocaleString()} samples · ${share}%${frame.location ? ` · ${frame.location}` : ''}`;
}

export function FlamegraphView({ series }: { series: FlamegraphSeries }) {
    const [selectedId, setSelectedId] = useState<string>();
    const layout = useMemo(() => {
        const root = hierarchy(series.root, frame => frame.children)
            .sum(frame => frame.selfSamples)
            .sort(
                (left, right) =>
                    (right.value ?? 0) - (left.value ?? 0) ||
                    left.data.name.localeCompare(right.data.name),
            );
        return partition<FlamegraphFrame>().size([width, height]).padding(1).round(true)(root);
    }, [series]);
    const nodes = layout.descendants().slice(1) as HierarchyRectangularNode<FlamegraphFrame>[];
    const selected = nodes.find(node => node.data.id === selectedId)?.data;

    const selectFrame = (node: HierarchyRectangularNode<FlamegraphFrame>) =>
        setSelectedId(node.data.id);
    const onKeyDown = (
        event: KeyboardEvent<SVGRectElement>,
        node: HierarchyRectangularNode<FlamegraphFrame>,
    ) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectFrame(node);
        }
    };

    return (
        <div className="flamegraph-view">
            <div className="flamegraph-summary">
                <span>
                    <i className="flamegraph-signal" />
                    {series.type === 'CPU' ? 'CPU samples' : 'Wall-clock samples'} ·{' '}
                    <strong>{series.samples.toLocaleString()}</strong>
                </span>
                <small>
                    Each bar’s width shows its share of samples. Click a frame to inspect it.
                </small>
            </div>
            <ScrollEdgeFrame<HTMLDivElement> className="flamegraph-canvas-frame">
                {ref => (
                    <div
                        ref={ref}
                        className="flamegraph-canvas"
                        role="group"
                        aria-label={`${series.type} flamegraph`}
                    >
                        <svg
                            viewBox={`0 0 ${width} ${height}`}
                            className="flamegraph-svg"
                            role="group"
                            aria-label={`${series.type} samples by call stack`}
                        >
                            {nodes.map(node => {
                                const x = node.x0,
                                    y = height - node.y1,
                                    rectWidth = Math.max(0, node.x1 - node.x0),
                                    rectHeight = Math.max(0, node.y1 - node.y0);
                                const label =
                                    rectWidth > 210
                                        ? node.data.name
                                        : rectWidth > 94
                                          ? `${node.data.name.slice(0, 24)}…`
                                          : '';
                                const selectedFrame = selectedId === node.data.id;
                                return (
                                    <g
                                        key={node.data.id}
                                        className={`flamegraph-node depth-${Math.min(5, node.depth)}${selectedFrame ? ' is-selected' : ''}`}
                                    >
                                        <rect
                                            x={x}
                                            y={y}
                                            width={rectWidth}
                                            height={rectHeight}
                                            rx="3"
                                            role="button"
                                            tabIndex={0}
                                            aria-label={frameDescription(node.data, series.samples)}
                                            aria-pressed={selectedFrame}
                                            onClick={() => selectFrame(node)}
                                            onKeyDown={event => onKeyDown(event, node)}
                                        >
                                            <title>
                                                {frameDescription(node.data, series.samples)}
                                            </title>
                                        </rect>
                                        {label && (
                                            <text
                                                x={x + 7}
                                                y={y + Math.min(rectHeight - 5, 18)}
                                                pointerEvents="none"
                                            >
                                                {label}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}
                        </svg>
                    </div>
                )}
            </ScrollEdgeFrame>
            <div className="flamegraph-detail" aria-live="polite">
                {selected ? (
                    <>
                        <span className="eyebrow">SELECTED FRAME</span>
                        <strong>{selected.name}</strong>
                        <div>
                            <span>{selected.samples.toLocaleString()} samples</span>
                            <span>
                                {series.samples
                                    ? ((selected.samples / series.samples) * 100).toFixed(1)
                                    : '0.0'}
                                % of this profile
                            </span>
                            <span>{selected.children.length.toLocaleString()} child frames</span>
                            {selected.location && <code>{selected.location}</code>}
                        </div>
                    </>
                ) : (
                    <p>Select a frame to see its sample share and source location.</p>
                )}
            </div>
        </div>
    );
}
