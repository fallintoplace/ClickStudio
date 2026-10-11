import { easeCubicInOut, hierarchy, pack, scaleLinear, select, treemap } from 'd3';
import type { ScaleLinear, HierarchyCircularNode, HierarchyRectangularNode } from 'd3';
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
} from 'react';
import type {
    MergeTreePart,
    MergeTreePartsSnapshot,
    PartsLayout,
    PartsMetric,
    PartsState,
} from '../../../../shared/database/explorer/storage/parts';
import {
    formatCompressionRatio,
    scalePartMetrics,
} from '../../../../shared/database/explorer/storage/parts';
import type { Connection } from '../../../../shared/database/connections/types';
import type { SchemaTable } from '../../../../shared/database/schema/types';
import type { Copy } from '../../../common/translations/i18n';
import { loadTableParts } from './table-parts-provider';
import { message } from '../../../common/requests/api';
import { Button } from '../../../common/components/ui';
import { formatBytes } from '../../../common/browser/format';

type Cell = {
    id: string;
    label: string;
    value?: number;
    part?: MergeTreePart;
    colorIndex?: number;
    children?: Cell[];
};

const width = 1_000;
const height = 510;
const palette = ['var(--accent)', 'var(--violet)', 'var(--green)', 'var(--amber)', 'var(--cyan)'];

function exactCount(value: string) {
    try {
        return BigInt(value).toLocaleString();
    } catch {
        return value;
    }
}

function exactBytes(value: string) {
    try {
        const bytes = BigInt(value);
        const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
        let unit = 0,
            divisor = 1n;
        while (bytes >= divisor * 1024n && unit < units.length - 1) {
            divisor *= 1024n;
            unit++;
        }
        if (!unit) return `${exactCount(value)} B`;
        const tenths = ((bytes % divisor) * 10n) / divisor;
        return `${(bytes / divisor).toLocaleString()}.${tenths} ${units[unit]}`;
    } catch {
        return formatBytes(value);
    }
}

function partId(part: MergeTreePart) {
    return `${part.partition}:${part.name}:${part.active ? 'active' : 'inactive'}`;
}

function metricText(part: MergeTreePart, metric: PartsMetric) {
    return metric === 'compressedBytes'
        ? exactBytes(part.compressedBytes)
        : exactCount(part[metric]);
}

function compareBlockNumber(left: string, right: string) {
    const a = BigInt(left),
        b = BigInt(right);

    if (a < b) {
        return -1;
    }

    if (a > b) {
        return 1;
    }

    return 0;
}

function makeTree(
    snapshot: MergeTreePartsSnapshot,
    metric: PartsMetric,
    parts: readonly MergeTreePart[],
): Cell {
    const values = scalePartMetrics(parts, metric);
    const grouped = new Map<string, Cell[]>();
    parts.forEach((part, index) => {
        const children = grouped.get(part.partition) ?? [];
        children.push({ id: `part:${partId(part)}`, label: part.name, part, value: values[index] });
        grouped.set(part.partition, children);
    });
    return {
        id: 'table',
        label: `${snapshot.database}.${snapshot.table}`,
        children: [...grouped].map(([partition, children], index) => ({
            id: `partition:${partition}`,
            label: partition,
            children,
            colorIndex: index,
        })),
    };
}

function tooltip(part: MergeTreePart) {
    return `${part.name}\n${part.active ? 'Active' : 'Inactive'} · ${part.partition}\nRows: ${part.rows}\nMarks: ${part.marks}\nCompressed: ${part.compressedBytes} bytes\nUncompressed: ${part.uncompressedBytes} bytes\nCompression: ${formatCompressionRatio(part)}\nLevel: ${part.level}\nBlocks: ${part.minBlockNumber}–${part.maxBlockNumber}\nDisk: ${part.diskName}\nModified: ${part.modifiedAt}`;
}

export function PartsExplorer({
    connection,
    table,
    copy,
    onClose,
    embedded = false,
}: {
    connection: Pick<Connection, 'id' | 'dataSource'>;
    table: SchemaTable;
    copy: Copy['common'];
    onClose?: () => void;
    embedded?: boolean;
}) {
    const [state, setState] = useState<{
        key: string;
        loading: boolean;
        snapshot?: MergeTreePartsSnapshot;
        error?: string;
    }>();
    const [retryCount, setRetryCount] = useState(0);
    const [metric, setMetric] = useState<PartsMetric>('compressedBytes');
    const [partState, setPartState] = useState<PartsState>('all');
    const [layoutMode, setLayoutMode] = useState<PartsLayout>('map');
    const [selectedPart, setSelectedPart] = useState<MergeTreePart>();
    const [zoomedPartition, setZoomedPartition] = useState<string>();
    const transformGroup = useRef<SVGGElement>(null);
    const requestKey = `${connection.id}:${table.database}.${table.name}`;

    useEffect(() => {
        const controller = new AbortController();
        setState({ key: requestKey, loading: true });
        setSelectedPart(undefined);
        setZoomedPartition(undefined);
        void loadTableParts(connection.id, table.database, table.name, controller.signal)
            .then(snapshot => {
                if (!controller.signal.aborted)
                    setState({ key: requestKey, loading: false, snapshot });
            })
            .catch(error => {
                if (!controller.signal.aborted)
                    setState({ key: requestKey, loading: false, error: message(error) });
            });
        return () => controller.abort();
    }, [connection.id, requestKey, retryCount, table.database, table.name]);

    const snapshot = state?.key === requestKey ? state.snapshot : undefined;
    const filteredParts = useMemo(
        () =>
            snapshot?.parts?.filter(
                part => partState === 'all' || part.active === (partState === 'active'),
            ) ?? [],
        [partState, snapshot],
    );
    const tree = useMemo(
        () => (snapshot ? makeTree(snapshot, metric, filteredParts) : undefined),
        [filteredParts, metric, snapshot],
    );
    const layout = useMemo(() => {
        if (!tree || layoutMode === 'map') return undefined;
        const root = hierarchy(tree, node => node.children)
            .sum(node => node.value ?? 0)
            .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));
        return layoutMode === 'treemap'
            ? treemap<Cell>()
                  .size([width, height])
                  .paddingInner(3)
                  .paddingTop(node => (node.depth === 1 ? 25 : 3))
                  .round(true)(root)
            : pack<Cell>().size([width, height]).padding(4)(root);
    }, [layoutMode, tree]);
    const layoutNodes = layout?.descendants() ?? [];

    const partitionGroups = useMemo(() => {
        const grouped = new Map<string, MergeTreePart[]>();
        for (const part of filteredParts) {
            const parts = grouped.get(part.partition) ?? [];
            parts.push(part);
            grouped.set(part.partition, parts);
        }
        return [...grouped]
            .map(([partition, parts]) => ({
                id: `partition:${partition}`,
                partition,
                parts: parts.sort(
                    (left, right) =>
                        compareBlockNumber(left.minBlockNumber, right.minBlockNumber) ||
                        left.name.localeCompare(right.name),
                ),
            }))
            .sort((left, right) => left.partition.localeCompare(right.partition));
    }, [filteredParts]);
    const visiblePartitionGroups = zoomedPartition
        ? partitionGroups.filter(group => group.id === zoomedPartition)
        : partitionGroups;
    const metricValues = useMemo(
        () => scalePartMetrics(filteredParts, metric),
        [filteredParts, metric],
    );
    const metricScale = useMemo(
        () =>
            scaleLinear()
                .domain([0, Math.max(1, ...metricValues)])
                .range([0, 100]),
        [metricValues],
    );
    const metricByPart = useMemo(
        () => new Map(filteredParts.map((part, index) => [partId(part), metricValues[index] ?? 0])),
        [filteredParts, metricValues],
    );
    const visibleTotals = useMemo(
        () =>
            filteredParts.reduce(
                (totals, part) => ({
                    rows: totals.rows + BigInt(part.rows),
                    compressedBytes: totals.compressedBytes + BigInt(part.compressedBytes),
                }),
                { rows: 0n, compressedBytes: 0n },
            ),
        [filteredParts],
    );

    useEffect(() => {
        const group = transformGroup.current;
        if (!group || !layout) return;
        const selected = layout.descendants().find(node => node.data.id === zoomedPartition);
        let transform = 'translate(0,0) scale(1)';
        if (selected) {
            const bounds =
                layoutMode === 'treemap'
                    ? (() => {
                          const rect = selected as HierarchyRectangularNode<Cell>;
                          return { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
                      })()
                    : (() => {
                          const circle = selected as HierarchyCircularNode<Cell>;
                          return {
                              x0: circle.x - circle.r,
                              y0: circle.y - circle.r,
                              x1: circle.x + circle.r,
                              y1: circle.y + circle.r,
                          };
                      })();
            const scale =
                Math.min(
                    width / Math.max(1, bounds.x1 - bounds.x0),
                    height / Math.max(1, bounds.y1 - bounds.y0),
                ) * 0.94;
            const x = (width - (bounds.x0 + bounds.x1) * scale) / 2;
            const y = (height - (bounds.y0 + bounds.y1) * scale) / 2;
            transform = `translate(${x},${y}) scale(${scale})`;
        }
        select(group)
            .interrupt()
            .transition()
            .duration(520)
            .ease(easeCubicInOut)
            .attr('transform', transform);
    }, [layout, layoutMode, zoomedPartition]);

    useEffect(() => {
        if (embedded) return;
        const closeOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') onClose?.();
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [embedded, onClose]);

    const current = state?.key === requestKey ? state : undefined;
    const partitions = new Set(filteredParts.map(part => part.partition)).size;
    let activeMetricLabel: string;

    switch (metric) {
        case 'compressedBytes':
            activeMetricLabel = copy.partsMetricSize;
            break;
        case 'rows':
            activeMetricLabel = copy.partsMetricRows;
            break;
        default:
            activeMetricLabel = copy.partsMetricMarks;
            break;
    }
    const selectedPartition = zoomedPartition?.replace(/^partition:/, '');
    const partitionParts = selectedPartition
        ? filteredParts.filter(part => part.partition === selectedPartition)
        : [];
    const handleCell = (id: string, part?: MergeTreePart) => {
        if (id.startsWith('partition:')) {
            setSelectedPart(undefined);
            setZoomedPartition(currentZoom => (currentZoom === id ? undefined : id));
        } else if (part) setSelectedPart(part);
    };
    const keyCell = (event: KeyboardEvent<SVGElement>, id: string, part?: MergeTreePart) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleCell(id, part);
        }
    };
    let selectedTotal: string | undefined;

    switch (partState) {
        case 'all':
            selectedTotal = snapshot?.totalParts;
            break;
        case 'active':
            selectedTotal = snapshot?.activeParts;
            break;
        default:
            selectedTotal = snapshot?.inactiveParts;
            break;
    }
    let selectedStateLabel: string;

    switch (partState) {
        case 'all':
            selectedStateLabel = copy.partsStateAll;
            break;
        case 'active':
            selectedStateLabel = copy.partsStateActive;
            break;
        default:
            selectedStateLabel = copy.partsStateInactive;
            break;
    }
    const stateIsTruncated =
        snapshot &&
        selectedTotal !== undefined &&
        BigInt(selectedTotal) > BigInt(filteredParts.length);
    const showingText = stateIsTruncated
        ? copy.partsShowingState
              .replace('{shown}', filteredParts.length.toLocaleString())
              .replace('{total}', exactCount(selectedTotal ?? '0'))
              .replace('{state}', selectedStateLabel.toLowerCase())
        : undefined;

    const dialog = renderPartsDialog({
        embedded,
        copy,
        table,
        onClose,
        partState,
        setPartState,
        setSelectedPart,
        setZoomedPartition,
        snapshot,
        metric,
        setMetric,
        layoutMode,
        setLayoutMode,
        partitions,
        current,
        setRetryCount,
        filteredParts,
        layout,
        selectedPartition,
        stateIsTruncated,
        visibleTotals,
        visiblePartitionGroups,
        zoomedPartition,
        handleCell,
        metricByPart,
        metricScale,
        selectedPart,
        activeMetricLabel,
        transformGroup,
        layoutNodes,
        keyCell,
        showingText,
        partitionParts,
        connection,
    });
    return embedded ? (
        <div className="parts-explorer-embedded">{dialog}</div>
    ) : (
        <div className="parts-explorer-layer">
            <button
                className="parts-explorer-scrim"
                type="button"
                aria-label={copy.closePanel}
                onClick={() => onClose?.()}
            />
            {dialog}
        </div>
    );
}

function renderPartsDialog({
    embedded,
    copy,
    table,
    onClose,
    partState,
    setPartState,
    setSelectedPart,
    setZoomedPartition,
    snapshot,
    metric,
    setMetric,
    layoutMode,
    setLayoutMode,
    partitions,
    current,
    setRetryCount,
    filteredParts,
    layout,
    selectedPartition,
    stateIsTruncated,
    visibleTotals,
    visiblePartitionGroups,
    zoomedPartition,
    handleCell,
    metricByPart,
    metricScale,
    selectedPart,
    activeMetricLabel,
    transformGroup,
    layoutNodes,
    keyCell,
    showingText,
    partitionParts,
    connection,
}: {
    embedded: boolean;
    copy: Copy['common'];
    table: SchemaTable;
    onClose: (() => void) | undefined;
    partState: PartsState;
    setPartState: import('react').Dispatch<import('react').SetStateAction<PartsState>>;
    setSelectedPart: import('react').Dispatch<
        import('react').SetStateAction<MergeTreePart | undefined>
    >;
    setZoomedPartition: import('react').Dispatch<
        import('react').SetStateAction<string | undefined>
    >;
    snapshot: MergeTreePartsSnapshot | undefined;
    metric: PartsMetric;
    setMetric: import('react').Dispatch<import('react').SetStateAction<PartsMetric>>;
    layoutMode: PartsLayout;
    setLayoutMode: import('react').Dispatch<import('react').SetStateAction<PartsLayout>>;
    partitions: number;
    current:
        | { key: string; loading: boolean; snapshot?: MergeTreePartsSnapshot; error?: string }
        | undefined;
    setRetryCount: import('react').Dispatch<import('react').SetStateAction<number>>;
    filteredParts: MergeTreePart[];
    layout: HierarchyRectangularNode<Cell> | HierarchyCircularNode<Cell> | undefined;
    selectedPartition: string | undefined;
    stateIsTruncated: boolean | undefined;
    visibleTotals: { rows: bigint; compressedBytes: bigint };
    visiblePartitionGroups: { id: string; partition: string; parts: MergeTreePart[] }[];
    zoomedPartition: string | undefined;
    handleCell: (id: string, part?: MergeTreePart) => void;
    metricByPart: Map<string, number>;
    metricScale: ScaleLinear<number, number, never>;
    selectedPart: MergeTreePart | undefined;
    activeMetricLabel: string;
    transformGroup: import('react').RefObject<SVGGElement | null>;
    layoutNodes: HierarchyCircularNode<Cell>[] | HierarchyRectangularNode<Cell>[];
    keyCell: (event: KeyboardEvent<SVGElement>, id: string, part?: MergeTreePart) => void;
    showingText: string | undefined;
    partitionParts: MergeTreePart[];
    connection: Pick<Connection, 'id' | 'dataSource'>;
}) {
    const getPartsSummary = () => {
        if (snapshot) {
            return `${exactCount(snapshot.activeParts)} ${copy.partsStateActive.toLowerCase()} · ${exactCount(snapshot.inactiveParts)} ${copy.partsStateInactive.toLowerCase()} · ${partitions} ${copy.partsPartitions}`;
        }

        if (current?.loading) {
            return copy.partsLoading;
        }

        return '';
    };
    return (
        <section
            className={`parts-explorer-dialog${embedded ? ' is-embedded' : ''}`}
            role={embedded ? 'region' : 'dialog'}
            aria-modal={embedded ? undefined : true}
            aria-label={copy.partsExplorerTitle}
        >
            <header className="parts-explorer-header">
                <div>
                    <span className="eyebrow">{copy.partsExplorerTitle.toUpperCase()}</span>
                    <h2>
                        {table.database}.{table.name}
                    </h2>
                    <p>{copy.partsExplorerDescription}</p>
                </div>
                {!embedded && (
                    <Button
                        variant="ghost"
                        className="panel-collapse-button"
                        aria-label={copy.closePanel}
                        onClick={() => onClose?.()}
                    >
                        ×
                    </Button>
                )}
            </header>
            <div className="parts-explorer-toolbar">
                <div className="parts-view-control" role="group" aria-label={copy.partsStateFilter}>
                    {(['all', 'active', 'inactive'] as const).map(value => {
                        const getStateLabel = () => {
                            switch (value) {
                                case 'all':
                                    return copy.partsStateAll;

                                case 'active':
                                    return copy.partsStateActive;

                                default:
                                    return copy.partsStateInactive;
                            }
                        };
                        const getStateCount = () => {
                            if (value === 'active' && snapshot) {
                                return ` ${exactCount(snapshot.activeParts)}`;
                            }

                            if (value === 'inactive' && snapshot) {
                                return ` ${exactCount(snapshot.inactiveParts)}`;
                            }

                            return '';
                        };
                        return (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={partState === value}
                                onClick={() => {
                                    setPartState(value);
                                    setSelectedPart(undefined);
                                    setZoomedPartition(undefined);
                                }}
                            >
                                {getStateLabel()}
                                {getStateCount()}
                            </button>
                        );
                    })}
                </div>
                <div
                    className="parts-view-control"
                    role="group"
                    aria-label={copy.partsExplorerTitle}
                >
                    {(['compressedBytes', 'rows', 'marks'] as const).map(value => {
                        const getMetricLabel = () => {
                            switch (value) {
                                case 'compressedBytes':
                                    return copy.partsMetricSize;

                                case 'rows':
                                    return copy.partsMetricRows;

                                default:
                                    return copy.partsMetricMarks;
                            }
                        };
                        return (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={metric === value}
                                onClick={() => setMetric(value)}
                            >
                                {getMetricLabel()}
                            </button>
                        );
                    })}
                </div>
                <div className="parts-view-control" role="group" aria-label={copy.partsMap}>
                    {(['map', 'treemap', 'galaxy'] as const).map(value => {
                        const getViewLabel = () => {
                            switch (value) {
                                case 'map':
                                    return copy.partsMap;

                                case 'treemap':
                                    return copy.partsTreemap;

                                default:
                                    return copy.partsGalaxy;
                            }
                        };
                        return (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={layoutMode === value}
                                onClick={() => setLayoutMode(value)}
                            >
                                {getViewLabel()}
                            </button>
                        );
                    })}
                </div>
                <span className="parts-count-summary">{getPartsSummary()}</span>
            </div>
            {current?.loading && (
                <div className="parts-state" role="status">
                    {copy.partsLoading}
                </div>
            )}
            {current?.error && (
                <div className="parts-state is-error" role="alert">
                    <span>{current.error}</span>
                    <Button
                        variant="secondary"
                        className="toolbar-small"
                        disabled={current.loading}
                        onClick={() => setRetryCount(value => value + 1)}
                    >
                        Retry
                    </Button>
                </div>
            )}
            {snapshot && !filteredParts.length && (
                <div className="parts-state" role="status">
                    {copy.partsEmpty}
                </div>
            )}
            {snapshot && filteredParts.length > 0 && (layoutMode === 'map' || layout) && (
                <>
                    <div className="parts-graph-meta">
                        <span className="parts-breadcrumb">
                            <button type="button" onClick={() => setZoomedPartition(undefined)}>
                                {snapshot.database}.{snapshot.table}
                            </button>
                            {selectedPartition && (
                                <>
                                    <i>/</i>
                                    <strong>{selectedPartition}</strong>
                                </>
                            )}
                        </span>
                        <span>
                            {stateIsTruncated && `${copy.partsLoaded} · `}
                            {copy.partsMetricSize}:{' '}
                            <strong>{exactBytes(visibleTotals.compressedBytes.toString())}</strong>{' '}
                            · {copy.partsMetricRows}:{' '}
                            <strong>{exactCount(visibleTotals.rows.toString())}</strong>
                        </span>
                    </div>
                    {renderPartsGraph({
                        layoutMode,
                        copy,
                        visiblePartitionGroups,
                        zoomedPartition,
                        handleCell,
                        metricByPart,
                        metricScale,
                        selectedPart,
                        setSelectedPart,
                        metric,
                        activeMetricLabel,
                        transformGroup,
                        layoutNodes,
                        keyCell,
                        showingText,
                    })}
                    {renderPartInspector({ selectedPart, copy, selectedPartition, partitionParts })}
                </>
            )}
            {connection.dataSource === 'fixture' && snapshot && (
                <span className="parts-fixture-label">{copy.partsFixture}</span>
            )}
            <div className="parts-explorer-footer">
                <span>{snapshot && `${exactCount(snapshot.totalParts)} ${copy.partsTotal}`}</span>
                {!embedded && (
                    <Button
                        variant="secondary"
                        className="toolbar-small"
                        onClick={() => onClose?.()}
                    >
                        {copy.closePanel}
                    </Button>
                )}
            </div>
        </section>
    );
}

function renderPartInspector({
    selectedPart,
    copy,
    selectedPartition,
    partitionParts,
}: {
    selectedPart: MergeTreePart | undefined;
    copy: Copy['common'];
    selectedPartition: string | undefined;
    partitionParts: MergeTreePart[];
}) {
    const renderSelectionDetails = () => {
        if (selectedPart) {
            return (
                <>
                    <div className="parts-inspector-heading">
                        <span className="eyebrow">
                            {copy.partsPart.toUpperCase()} ·{' '}
                            {selectedPart.active ? copy.partsStateActive : copy.partsStateInactive}
                        </span>
                        <strong>{selectedPart.name}</strong>
                        <code>{selectedPart.partition}</code>
                    </div>
                    <div className="parts-inspector-stats">
                        <span>
                            <small>{copy.partsRows}</small>
                            <strong>{exactCount(selectedPart.rows)}</strong>
                        </span>
                        <span>
                            <small>{copy.partsMarks}</small>
                            <strong>{exactCount(selectedPart.marks)}</strong>
                        </span>
                        <span>
                            <small>{copy.partsCompressed}</small>
                            <strong>{exactBytes(selectedPart.compressedBytes)}</strong>
                        </span>
                        <span>
                            <small>{copy.partsUncompressed}</small>
                            <strong>{exactBytes(selectedPart.uncompressedBytes)}</strong>
                        </span>
                        <span>
                            <small>{copy.partsCompression}</small>
                            <strong>{formatCompressionRatio(selectedPart)}</strong>
                        </span>
                        <span>
                            <small>{copy.partsLevel}</small>
                            <strong>{selectedPart.level}</strong>
                        </span>
                        <span>
                            <small>{copy.partsModified}</small>
                            <strong>{selectedPart.modifiedAt}</strong>
                        </span>
                        <span>
                            <small>{copy.partsMinBlock}</small>
                            <strong>{selectedPart.minBlockNumber}</strong>
                        </span>
                        <span>
                            <small>{copy.partsMaxBlock}</small>
                            <strong>{selectedPart.maxBlockNumber}</strong>
                        </span>
                        <span>
                            <small>{copy.partsDisk}</small>
                            <strong>{selectedPart.diskName}</strong>
                        </span>
                    </div>
                </>
            );
        }

        if (selectedPartition && partitionParts.length > 0) {
            return (
                <>
                    <div className="parts-inspector-heading">
                        <span className="eyebrow">{copy.partsPartitions.toUpperCase()}</span>
                        <strong>{selectedPartition}</strong>
                        <code>
                            {partitionParts.length} {copy.partsTotal}
                        </code>
                    </div>
                    <div className="parts-inspector-stats">
                        <span>
                            <small>{copy.partsRows}</small>
                            <strong>
                                {exactCount(
                                    partitionParts
                                        .reduce((sum, part) => sum + BigInt(part.rows), 0n)
                                        .toString(),
                                )}
                            </strong>
                        </span>
                        <span>
                            <small>{copy.partsCompressed}</small>
                            <strong>
                                {exactBytes(
                                    partitionParts
                                        .reduce(
                                            (sum, part) => sum + BigInt(part.compressedBytes),
                                            0n,
                                        )
                                        .toString(),
                                )}
                            </strong>
                        </span>
                    </div>
                </>
            );
        }

        return <p>{copy.partsSelectForDetails}</p>;
    };
    return (
        <div className="parts-inspector" aria-live="polite">
            {renderSelectionDetails()}
        </div>
    );
}

function renderPartsGraph({
    layoutMode,
    copy,
    visiblePartitionGroups,
    zoomedPartition,
    handleCell,
    metricByPart,
    metricScale,
    selectedPart,
    setSelectedPart,
    metric,
    activeMetricLabel,
    transformGroup,
    layoutNodes,
    keyCell,
    showingText,
}: {
    layoutMode: PartsLayout;
    copy: Copy['common'];
    visiblePartitionGroups: { id: string; partition: string; parts: MergeTreePart[] }[];
    zoomedPartition: string | undefined;
    handleCell: (id: string, part?: MergeTreePart) => void;
    metricByPart: Map<string, number>;
    metricScale: ScaleLinear<number, number, never>;
    selectedPart: MergeTreePart | undefined;
    setSelectedPart: import('react').Dispatch<
        import('react').SetStateAction<MergeTreePart | undefined>
    >;
    metric: PartsMetric;
    activeMetricLabel: string;
    transformGroup: import('react').RefObject<SVGGElement | null>;
    layoutNodes: HierarchyCircularNode<Cell>[] | HierarchyRectangularNode<Cell>[];
    keyCell: (event: KeyboardEvent<SVGElement>, id: string, part?: MergeTreePart) => void;
    showingText: string | undefined;
}) {
    const renderTreemapCell = (
        node: (typeof layoutNodes)[number],
        depth: number,
        color: string,
        part: MergeTreePart | undefined,
        selected: boolean | undefined,
    ) => {
        const rect = node as HierarchyRectangularNode<Cell>;
        const cellWidth = Math.max(0, rect.x1 - rect.x0),
            cellHeight = Math.max(0, rect.y1 - rect.y0);
        const label = part?.name ?? node.data.label;
        const labelLimit = Math.max(3, Math.floor((cellWidth - 14) / 7));
        return (
            <g
                key={node.data.id}
                role={depth === 1 ? undefined : 'button'}
                tabIndex={depth === 1 ? undefined : 0}
                aria-label={part ? tooltip(part) : undefined}
                className={`parts-map-cell${depth === 1 ? ' is-partition-cell' : ' is-part-cell'}${selected ? ' is-selected' : ''}`}
                onClick={depth === 1 ? undefined : () => handleCell(node.data.id, part)}
                onKeyDown={depth === 1 ? undefined : event => keyCell(event, node.data.id, part)}
            >
                <title>{part ? tooltip(part) : node.data.label}</title>
                <rect
                    x={rect.x0}
                    y={rect.y0}
                    width={cellWidth}
                    height={cellHeight}
                    rx={depth === 1 ? 10 : 4}
                    style={
                        {
                            '--part-color': color,
                        } as CSSProperties
                    }
                />
                {part && cellWidth > 82 && cellHeight > 28 && (
                    <text
                        className="parts-cell-label"
                        x={rect.x0 + 7}
                        y={rect.y0 + Math.min(cellHeight - 7, 22)}
                    >
                        {label.length > labelLimit ? `${label.slice(0, labelLimit - 1)}…` : label}
                    </text>
                )}
            </g>
        );
    };
    const renderGalaxyCell = (
        node: (typeof layoutNodes)[number],
        depth: number,
        color: string,
        part: MergeTreePart | undefined,
        selected: boolean | undefined,
    ) => {
        const circle = node as HierarchyCircularNode<Cell>;
        const radius = circle.r;
        return (
            <g
                key={node.data.id}
                role={depth === 1 ? undefined : 'button'}
                tabIndex={depth === 1 ? undefined : 0}
                aria-label={part ? tooltip(part) : undefined}
                className={`parts-galaxy-cell${depth === 1 ? ' is-partition-cell' : ' is-part-cell'}${selected ? ' is-selected' : ''}`}
                transform={`translate(${circle.x},${circle.y})`}
                onClick={depth === 1 ? undefined : () => handleCell(node.data.id, part)}
                onKeyDown={depth === 1 ? undefined : event => keyCell(event, node.data.id, part)}
            >
                <title>{part ? tooltip(part) : node.data.label}</title>
                <circle r={radius} style={{ '--part-color': color } as CSSProperties} />
                {part && radius > 22 && (
                    <text className="parts-cell-label" y="3">
                        {part.name.length > 20 ? `${part.name.slice(0, 19)}…` : part.name}
                    </text>
                )}
            </g>
        );
    };

    return (
        <div className={`parts-graph-viewport is-${layoutMode}`}>
            {layoutMode === 'map' ? (
                <div className="parts-horizontal-map" role="list" aria-label={copy.partsMap}>
                    {visiblePartitionGroups.map(group => (
                        <section className="parts-map-partition" key={group.id} role="listitem">
                            <button
                                type="button"
                                className="parts-map-partition-heading"
                                aria-label={copy.partsZoomPartition.replace(
                                    '{partition}',
                                    group.partition,
                                )}
                                aria-pressed={zoomedPartition === group.id}
                                onClick={() => handleCell(group.id)}
                            >
                                <strong>{group.partition}</strong>
                                <span>
                                    {group.parts.length} parts ·{' '}
                                    {exactBytes(
                                        group.parts
                                            .reduce(
                                                (sum, part) => sum + BigInt(part.compressedBytes),
                                                0n,
                                            )
                                            .toString(),
                                    )}
                                </span>
                            </button>
                            <div className="parts-map-partition-rows">
                                {group.parts.map(part => {
                                    const size = metricByPart.get(partId(part)) ?? 0;
                                    const barWidth =
                                        size === 0 ? 0 : Math.max(1.5, metricScale(size));
                                    const selected =
                                        selectedPart?.name === part.name &&
                                        selectedPart.partition === part.partition &&
                                        selectedPart.active === part.active;
                                    return (
                                        <button
                                            key={partId(part)}
                                            type="button"
                                            className={`parts-map-row${part.active ? ' is-active' : ' is-inactive'}${selected ? ' is-selected' : ''}`}
                                            title={tooltip(part)}
                                            aria-label={tooltip(part)}
                                            aria-pressed={Boolean(selected)}
                                            onClick={() => setSelectedPart(part)}
                                        >
                                            <span className="parts-map-identity">
                                                <i aria-hidden="true" />
                                                <code>{part.name}</code>
                                                <small>
                                                    {part.active
                                                        ? copy.partsStateActive
                                                        : copy.partsStateInactive}{' '}
                                                    · L{part.level}
                                                </small>
                                            </span>
                                            <span className="parts-map-metrics">
                                                <span className="parts-map-size">
                                                    <i>
                                                        <b
                                                            style={{
                                                                width: `${barWidth}%`,
                                                            }}
                                                        />
                                                    </i>
                                                    <strong>{metricText(part, metric)}</strong>
                                                </span>
                                                <span>
                                                    {exactCount(part.rows)}{' '}
                                                    {copy.partsRows.toLowerCase()}
                                                </span>
                                                <span>{exactBytes(part.compressedBytes)}</span>
                                                <span>
                                                    {exactCount(part.marks)}{' '}
                                                    {copy.partsMarks.toLowerCase()}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            ) : (
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    role="group"
                    aria-label={`${copy.partsExplorerTitle} · ${activeMetricLabel}`}
                >
                    <g ref={transformGroup}>
                        {layoutNodes.slice(1).map(node => {
                            const depth = node.depth;
                            const colorIndex =
                                node.ancestors().find(ancestor => ancestor.depth === 1)?.data
                                    .colorIndex ?? 0;
                            const color = palette[colorIndex % palette.length]!;
                            const part = node.data.part;
                            const selected =
                                part &&
                                selectedPart?.name === part.name &&
                                selectedPart.partition === part.partition &&
                                selectedPart.active === part.active;
                            if (layoutMode === 'treemap') {
                                return renderTreemapCell(node, depth, color, part, selected);
                            }
                            return renderGalaxyCell(node, depth, color, part, selected);
                        })}
                        {layoutNodes
                            .filter(node => node.depth === 1)
                            .map(node => {
                                if (layoutMode === 'treemap') {
                                    const rect = node as HierarchyRectangularNode<Cell>;
                                    const rectWidth = Math.max(0, rect.x1 - rect.x0),
                                        rectHeight = Math.max(0, rect.y1 - rect.y0);
                                    const badgeWidth = Math.min(
                                        rectWidth,
                                        Math.max(36, node.data.label.length * 6 + 18),
                                    );
                                    const badgeHeight = Math.min(23, rectHeight);
                                    const labelLimit = Math.max(
                                        1,
                                        Math.floor((badgeWidth - 18) / 6),
                                    );
                                    return (
                                        <g
                                            key={`${node.data.id}:zoom`}
                                            className="parts-partition-zoom"
                                            role="button"
                                            tabIndex={0}
                                            aria-label={copy.partsZoomPartition.replace(
                                                '{partition}',
                                                node.data.label,
                                            )}
                                            onClick={() => handleCell(node.data.id)}
                                            onKeyDown={event => keyCell(event, node.data.id)}
                                        >
                                            <title>
                                                {copy.partsZoomPartition.replace(
                                                    '{partition}',
                                                    node.data.label,
                                                )}
                                            </title>
                                            <rect
                                                x={rect.x0}
                                                y={rect.y0}
                                                width={badgeWidth}
                                                height={badgeHeight}
                                                rx="7"
                                                style={
                                                    {
                                                        '--part-color':
                                                            palette[
                                                                (node.data.colorIndex ?? 0) %
                                                                    palette.length
                                                            ],
                                                    } as CSSProperties
                                                }
                                            />
                                            {badgeWidth > 35 && (
                                                <text
                                                    x={rect.x0 + 9}
                                                    y={rect.y0 + Math.min(16, badgeHeight - 5)}
                                                >
                                                    {node.data.label.length > labelLimit
                                                        ? `${node.data.label.slice(0, labelLimit - 1)}…`
                                                        : node.data.label}
                                                </text>
                                            )}
                                        </g>
                                    );
                                }
                                const circle = node as HierarchyCircularNode<Cell>;
                                const badgeWidth = Math.min(
                                    circle.r * 2,
                                    Math.max(36, node.data.label.length * 6 + 18),
                                );
                                const labelLimit = Math.max(1, Math.floor((badgeWidth - 18) / 6));
                                return (
                                    <g
                                        key={`${node.data.id}:zoom`}
                                        className="parts-partition-zoom is-galaxy-zoom"
                                        role="button"
                                        tabIndex={0}
                                        aria-label={copy.partsZoomPartition.replace(
                                            '{partition}',
                                            node.data.label,
                                        )}
                                        transform={`translate(${circle.x},${circle.y})`}
                                        onClick={() => handleCell(node.data.id)}
                                        onKeyDown={event => keyCell(event, node.data.id)}
                                    >
                                        <title>
                                            {copy.partsZoomPartition.replace(
                                                '{partition}',
                                                node.data.label,
                                            )}
                                        </title>
                                        <rect
                                            x={-badgeWidth / 2}
                                            y={-Math.min(circle.r, 13)}
                                            width={badgeWidth}
                                            height="21"
                                            rx="10"
                                            style={
                                                {
                                                    '--part-color':
                                                        palette[
                                                            (node.data.colorIndex ?? 0) %
                                                                palette.length
                                                        ],
                                                } as CSSProperties
                                            }
                                        />
                                        {badgeWidth > 35 && (
                                            <text y={-Math.min(circle.r, 13) + 14}>
                                                {node.data.label.length > labelLimit
                                                    ? `${node.data.label.slice(0, labelLimit - 1)}…`
                                                    : node.data.label}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}
                    </g>
                </svg>
            )}
            <div className="parts-legend">
                <span>
                    <i className="parts-legend-square" />
                    {layoutMode === 'map'
                        ? `${copy.partsBarWidth}: ${activeMetricLabel}`
                        : activeMetricLabel}
                </span>
                {showingText && <span>{showingText}</span>}
            </div>
        </div>
    );
}
