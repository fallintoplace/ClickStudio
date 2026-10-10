import { linkHorizontal } from 'd3';
import { useEffect, useId, useMemo, useState } from 'react';
import type { Connection } from '../../shared/types';
import {
    layoutLineage,
    type LineageEdge,
    type LineageNode,
    type LineageSnapshot,
} from '../../shared/materialized-view-lineage';
import { nativeCount, nativeTime } from '../../shared/native-format';
import { useNativeExplorer } from '../useNativeExplorer';
import { NativeExplorerDialog } from './NativeExplorerDialog';
import { Button, Icon } from './ui';

const modeLabels = {
    incremental: 'Incremental MV',
    refreshable: 'Refreshable MV',
    'append-incremental': 'Append incremental refresh',
    unknown: 'Mode unavailable',
};
const edgeKinds: LineageEdge['kind'][] = [
    'insert-trigger',
    'writes-to',
    'refresh-dependency',
    'catalog-dependency',
];
const edgeLabels: Record<LineageEdge['kind'], string> = {
    'insert-trigger': 'Insert trigger',
    'writes-to': 'Writes to',
    'refresh-dependency': 'Refresh ordering',
    'catalog-dependency': 'Catalog dependency',
};
const beginnerEdgeLabels: Record<LineageEdge['kind'], string> = {
    'insert-trigger': 'New rows trigger a view',
    'writes-to': 'View saves results',
    'refresh-dependency': 'Refresh order',
    'catalog-dependency': 'Related object',
};
const nodeLabel = (node: LineageNode) => (node.mode ? modeLabels[node.mode] : node.engine);
function beginnerNodeRole(node: LineageNode, edges: LineageEdge[]) {
    if (node.kind === 'materialized-view')
        return node.mode === 'refreshable' || node.mode === 'append-incremental'
            ? 'Scheduled view'
            : 'Materialized view';
    if (node.kind === 'external') return 'Related object';
    const startsFlow = edges.some(
        edge => edge.kind === 'insert-trigger' && edge.source === node.id,
    );
    const storesResults = edges.some(edge => edge.kind === 'writes-to' && edge.target === node.id);
    if (startsFlow && storesResults) return 'Input and result table';
    if (startsFlow) return 'Input table';
    if (storesResults) return 'Result table';
    return 'Table';
}
function beginnerNodeHint(node: LineageNode, edges: LineageEdge[]) {
    if (node.kind === 'materialized-view') {
        if (node.mode === 'refreshable' || node.mode === 'append-incremental')
            return node.schedule ? 'Runs on a schedule' : 'Scheduled query';
        if (node.mode === 'incremental') return 'Runs when rows arrive';
        return 'View metadata incomplete';
    }
    if (node.kind === 'external') return 'Outside this database';
    const startsFlow = edges.some(
        edge => edge.kind === 'insert-trigger' && edge.source === node.id,
    );
    const storesResults = edges.some(edge => edge.kind === 'writes-to' && edge.target === node.id);
    if (startsFlow && storesResults) return 'Starts flow · stores results';
    if (startsFlow) return 'New rows start this flow';
    if (storesResults) return 'Stores view results';
    return node.database;
}
function beginnerNodeDescription(node: LineageNode, edges: LineageEdge[]) {
    if (node.kind === 'materialized-view') {
        if (node.mode === 'refreshable')
            return 'Runs its query on a schedule and writes the output to a target table.';
        if (node.mode === 'incremental')
            return 'When new rows arrive in a source table, ClickHouse runs this view query and writes its output to a target table.';
        if (node.mode === 'append-incremental')
            return 'Runs on a schedule and adds results for newly inserted rows to its target table.';
        if (node.mode === 'unknown')
            return 'This view transforms rows with a query. Its trigger or schedule could not be determined from the available metadata.';
        return 'Runs a query that transforms data and writes the output to a target table.';
    }
    if (node.kind === 'external')
        return 'A related object named by ClickHouse metadata, outside the objects loaded in this view.';
    const startsFlow = edges.some(
        edge => edge.kind === 'insert-trigger' && edge.source === node.id,
    );
    const storesResults = edges.some(edge => edge.kind === 'writes-to' && edge.target === node.id);
    if (startsFlow && storesResults)
        return 'New inserts can trigger a view, and this table also stores view results.';
    if (startsFlow) return 'New rows inserted into this table can start a materialized view.';
    if (storesResults) return 'This table stores results produced by a materialized view.';
    return 'A table connected to a materialized view in this database.';
}
function beginnerRelationshipLabel(nodeId: string, edge: LineageEdge) {
    const isOutgoing = edge.source === nodeId;
    if (edge.kind === 'insert-trigger')
        return isOutgoing ? 'New rows trigger' : 'Triggered by inserts from';
    if (edge.kind === 'writes-to') return isOutgoing ? 'Saves results in' : 'Stores results from';
    if (edge.kind === 'refresh-dependency') return isOutgoing ? 'Refreshes before' : 'Runs after';
    return isOutgoing ? 'Related to' : 'Referenced by';
}
function LineagePrimer() {
    return (
        <section className="native-lineage-primer" aria-label="Typical materialized view flow">
            <header>
                <span className="eyebrow">A TYPICAL DATA FLOW</span>
                <strong>Follow the rows</strong>
            </header>
            <div className="native-lineage-primer-flow">
                <article className="is-source">
                    <span className="native-lineage-primer-icon">
                        <Icon name="table" />
                    </span>
                    <div>
                        <small>01 · INPUT</small>
                        <strong>Source table</strong>
                        <p>New rows arrive here.</p>
                    </div>
                </article>
                <span className="native-lineage-primer-arrow" aria-hidden="true">
                    →
                </span>
                <article className="is-view">
                    <span className="native-lineage-primer-icon">
                        <Icon name="view" />
                    </span>
                    <div>
                        <small>02 · TRANSFORM</small>
                        <strong>Materialized view</strong>
                        <p>Runs a query on those rows.</p>
                    </div>
                </article>
                <span className="native-lineage-primer-arrow" aria-hidden="true">
                    →
                </span>
                <article className="is-target">
                    <span className="native-lineage-primer-icon">
                        <Icon name="database" />
                    </span>
                    <div>
                        <small>03 · OUTPUT</small>
                        <strong>Target table</strong>
                        <p>Stores the query result.</p>
                    </div>
                </article>
            </div>
            <p className="native-lineage-primer-note">
                Incremental views run on inserts; refreshable views run on a schedule. The map shows
                links reported by ClickHouse.
            </p>
        </section>
    );
}
function NodeDetails({
    node,
    snapshot,
    beginner,
}: {
    node: LineageNode;
    snapshot: LineageSnapshot;
    beginner: boolean;
}) {
    const upstream = snapshot.edges.filter(edge => edge.target === node.id),
        downstream = snapshot.edges.filter(edge => edge.source === node.id);
    const refresh = node.refresh;
    const role = beginnerNodeRole(node, snapshot.edges);
    return (
        <aside
            className={`native-node-details${beginner ? ' is-beginner' : ''}`}
            aria-label="Selected object"
        >
            <span className="eyebrow">{beginner ? role : nodeLabel(node)}</span>
            <h3>
                {node.database}.{node.table}
            </h3>
            {beginner && (
                <p className="native-node-explanation">
                    {beginnerNodeDescription(node, snapshot.edges)}
                </p>
            )}
            <dl className="native-metrics">
                <div>
                    <dt>{beginner ? 'Connected from' : 'Incoming relationships'}</dt>
                    <dd>{upstream.length}</dd>
                </div>
                <div>
                    <dt>{beginner ? 'Connected to' : 'Outgoing relationships'}</dt>
                    <dd>{downstream.length}</dd>
                </div>
            </dl>
            {!beginner && node.schedule && <p className="native-schedule">{node.schedule}</p>}
            {refresh ? (
                <>
                    <span className="native-badge">{refresh.status}</span>
                    {refresh.progress !== undefined && (
                        <progress aria-label="Refresh progress" value={refresh.progress} max={1} />
                    )}
                    {beginner ? (
                        <details className="native-refresh-details">
                            <summary>Refresh details</summary>
                            <dl className="native-detail-list">
                                <dt>Last successful refresh</dt>
                                <dd>{nativeTime(refresh.lastSuccessAt)}</dd>
                                <dt>Last successful duration</dt>
                                <dd>
                                    {refresh.lastSuccessDurationMs === undefined
                                        ? 'Unavailable'
                                        : `${nativeCount(refresh.lastSuccessDurationMs)} ms`}
                                </dd>
                                <dt>Latest attempt</dt>
                                <dd>{nativeTime(refresh.lastAttemptAt)}</dd>
                                <dt>Next refresh</dt>
                                <dd>{nativeTime(refresh.nextRefreshAt)}</dd>
                                <dt>Rows processed / stored</dt>
                                <dd>
                                    {nativeCount(refresh.readRows)} /{' '}
                                    {nativeCount(refresh.writtenRows)}
                                </dd>
                            </dl>
                        </details>
                    ) : (
                        <dl className="native-detail-list">
                            <dt>Last successful refresh</dt>
                            <dd>{nativeTime(refresh.lastSuccessAt)}</dd>
                            <dt>Last successful duration</dt>
                            <dd>
                                {refresh.lastSuccessDurationMs === undefined
                                    ? 'Unavailable'
                                    : `${nativeCount(refresh.lastSuccessDurationMs)} ms`}
                            </dd>
                            <dt>Latest attempt</dt>
                            <dd>{nativeTime(refresh.lastAttemptAt)}</dd>
                            <dt>Next refresh</dt>
                            <dd>{nativeTime(refresh.nextRefreshAt)}</dd>
                            <dt>Rows read / written</dt>
                            <dd>
                                {nativeCount(refresh.readRows)} / {nativeCount(refresh.writtenRows)}
                            </dd>
                        </dl>
                    )}
                    {refresh.exception && <pre className="native-warning">{refresh.exception}</pre>}
                </>
            ) : (
                node.kind === 'materialized-view' && (
                    <p className="native-notes">
                        {beginner
                            ? node.mode === 'incremental'
                                ? 'Runs when new rows are inserted. No schedule is needed.'
                                : 'No refresh status is available for this view.'
                            : node.mode === 'incremental'
                              ? 'Triggered by inserted blocks; no periodic refresh schedule.'
                              : 'No refresh telemetry available for this object.'}
                    </p>
                )
            )}
            <div className="native-relationships">
                {[...upstream, ...downstream].map(edge => {
                    const related = snapshot.nodes.find(
                        item => item.id === (edge.source === node.id ? edge.target : edge.source),
                    );
                    return (
                        <p key={JSON.stringify(edge)}>
                            <span>
                                {beginner
                                    ? beginnerRelationshipLabel(node.id, edge)
                                    : `${edgeLabels[edge.kind]} ${edge.source === node.id ? '→' : '←'}`}
                            </span>
                            <code>
                                {related?.database}.{related?.table}
                            </code>
                        </p>
                    );
                })}
            </div>
            {beginner ? (
                <details>
                    <summary>Technical details</summary>
                    <dl className="native-detail-list">
                        <dt>Engine</dt>
                        <dd>{node.engine}</dd>
                        {node.mode && (
                            <>
                                <dt>View mode</dt>
                                <dd>{modeLabels[node.mode]}</dd>
                            </>
                        )}
                        {node.schedule && (
                            <>
                                <dt>Refresh schedule</dt>
                                <dd>{node.schedule}</dd>
                            </>
                        )}
                    </dl>
                    {node.definition && (
                        <>
                            <span className="native-detail-caption">
                                CREATE definition{node.definitionTruncated ? ' (truncated)' : ''}
                            </span>
                            <pre className="native-sql">{node.definition}</pre>
                        </>
                    )}
                </details>
            ) : (
                node.definition && (
                    <details>
                        <summary>
                            CREATE definition{node.definitionTruncated ? ' (truncated)' : ''}
                        </summary>
                        <pre className="native-sql">{node.definition}</pre>
                    </details>
                )
            )}
        </aside>
    );
}
function LineageGraph({ snapshot, beginner }: { snapshot: LineageSnapshot; beginner: boolean }) {
    const [search, setSearch] = useState(''),
        [selected, setSelected] = useState('');
    const marker = useId().replace(/[^a-zA-Z0-9]/g, '');
    const graph = useMemo(() => {
        const query = search.trim().toLowerCase();
        const matches = new Set(
            snapshot.nodes
                .filter(node => `${node.database}.${node.table}`.toLowerCase().includes(query))
                .map(node => node.id),
        );
        const visible = new Set(matches);
        if (query)
            for (const edge of snapshot.edges)
                if (matches.has(edge.source) || matches.has(edge.target)) {
                    visible.add(edge.source);
                    visible.add(edge.target);
                }
        const nodes = snapshot.nodes.filter(node => visible.has(node.id)).slice(0, 120),
            ids = new Set(nodes.map(node => node.id));
        const edges = snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
        return { ...layoutLineage(nodes, edges), edges, clipped: visible.size > nodes.length };
    }, [search, snapshot]);
    const selectedNode =
        graph.nodes.find(node => node.id === selected) ??
        graph.nodes.find(node => node.kind === 'materialized-view') ??
        graph.nodes[0];
    const positions = new Map(graph.nodes.map(node => [node.id, node]));
    const curve = linkHorizontal<
        { source: [number, number]; target: [number, number] },
        [number, number]
    >()
        .x(point => point[0])
        .y(point => point[1]);
    return (
        <>
            {beginner && <LineagePrimer />}
            <div className="native-toolbar native-lineage-controls">
                <label className="native-search">
                    Find an object
                    <input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Search database or table"
                    />
                </label>
                <span>
                    {graph.nodes.length} objects · {graph.edges.length} links
                </span>
            </div>
            <div className="native-lineage-map-heading">
                <strong>Data map</strong>
                <span>
                    {beginner
                        ? 'Select an object to see what it does.'
                        : 'Select an object to inspect its relationships.'}
                </span>
            </div>
            <div className="native-lineage-legend">
                {Object.entries(beginner ? beginnerEdgeLabels : edgeLabels).map(([kind, label]) => (
                    <span key={kind} className={`edge-${kind}`}>
                        {label}
                    </span>
                ))}
            </div>
            {(graph.clipped || snapshot.truncated) && (
                <p className="native-warning">
                    {beginner
                        ? 'Large map: search by database or table to focus the objects shown.'
                        : 'This graph is bounded. Search to focus the displayed objects; metadata outside the snapshot remains unavailable.'}
                </p>
            )}
            {graph.hasCycle && (
                <p className="native-notes">
                    {beginner
                        ? 'Some links form a loop. These objects appear in the last column.'
                        : 'Cyclic or unresolved dependencies appear in the final column.'}
                </p>
            )}
            {!graph.nodes.length ? (
                <div className="native-empty">
                    {search
                        ? 'No matching objects.'
                        : beginner
                          ? 'No connected views found for this database.'
                          : 'No materialized-view relationships were returned for this database.'}
                </div>
            ) : (
                <div className="native-lineage-layout">
                    <div
                        className="native-lineage-canvas"
                        tabIndex={0}
                        aria-label={
                            beginner
                                ? 'Materialized view data flow map. Scroll to explore.'
                                : 'Materialized view dependency graph. Scroll to explore.'
                        }
                    >
                        <svg
                            width={graph.width}
                            height={graph.height}
                            role="group"
                            aria-label={beginner ? 'Data flow graph' : 'Dependency graph'}
                        >
                            <defs>
                                {edgeKinds.map(kind => (
                                    <marker
                                        key={kind}
                                        id={`${marker}-${kind}`}
                                        className={`native-edge-marker edge-${kind}`}
                                        viewBox="0 0 10 10"
                                        refX="9"
                                        refY="5"
                                        markerWidth="7"
                                        markerHeight="7"
                                        orient="auto-start-reverse"
                                    >
                                        <path d="M 0 0 L 10 5 L 0 10 z" />
                                    </marker>
                                ))}
                            </defs>
                            {graph.edges.map(edge => {
                                const from = positions.get(edge.source)!,
                                    to = positions.get(edge.target)!;
                                return (
                                    <path
                                        key={JSON.stringify(edge)}
                                        className={`native-edge edge-${edge.kind}`}
                                        d={
                                            curve({
                                                source: [from.x + 224, from.y + 36],
                                                target: [to.x - 3, to.y + 36],
                                            }) ?? ''
                                        }
                                        markerEnd={`url(#${marker}-${edge.kind})`}
                                    >
                                        <title>
                                            {
                                                (beginner ? beginnerEdgeLabels : edgeLabels)[
                                                    edge.kind
                                                ]
                                            }
                                            : {from.table} → {to.table}
                                        </title>
                                    </path>
                                );
                            })}
                            {graph.nodes.map(node => {
                                const role = beginnerNodeRole(node, graph.edges),
                                    hint = beginnerNodeHint(node, graph.edges);
                                const label = beginner ? role : nodeLabel(node);
                                const variant =
                                    beginner && role === 'Input table'
                                        ? 'input-table'
                                        : beginner && role === 'Result table'
                                          ? 'result-table'
                                          : '';
                                const className = `native-lineage-node ${node.kind}${beginner ? ' beginner-node' : ''} ${variant} ${node.id === selectedNode?.id ? 'is-selected' : ''}`;
                                const ariaLabel = `${node.database}.${node.table}: ${label}`;
                                return (
                                    <g
                                        key={node.id}
                                        transform={`translate(${node.x},${node.y})`}
                                        className={className}
                                        tabIndex={0}
                                        role="button"
                                        aria-label={ariaLabel}
                                        aria-pressed={node.id === selectedNode?.id}
                                        onClick={() => setSelected(node.id)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setSelected(node.id);
                                            }
                                        }}
                                    >
                                        <title>{ariaLabel}</title>
                                        <rect width="224" height="74" rx="12" />
                                        <text x="14" y="21" className="native-node-kind">
                                            {label.slice(0, 30)}
                                        </text>
                                        <text x="14" y="43">
                                            {node.table.length > 26
                                                ? `${node.table.slice(0, 25)}…`
                                                : node.table}
                                        </text>
                                        <text x="14" y="61" className="native-node-meta">
                                            {beginner
                                                ? hint
                                                : (node.refresh?.status ?? node.database)}
                                        </text>
                                    </g>
                                );
                            })}
                        </svg>
                    </div>
                    {selectedNode && (
                        <NodeDetails node={selectedNode} snapshot={snapshot} beginner={beginner} />
                    )}
                </div>
            )}
        </>
    );
}
export function MaterializedViewExplorer({
    connection,
    database,
    databases = [database],
    onClose,
    embedded = false,
    active = true,
}: {
    connection: Pick<Connection, 'id'>;
    database: string;
    databases?: readonly string[];
    onClose?: () => void;
    embedded?: boolean;
    active?: boolean;
}) {
    const [selectedDatabase, setSelectedDatabase] = useState(database);
    useEffect(() => setSelectedDatabase(database), [database]);
    const { snapshot, loading, error, refresh } = useNativeExplorer(
        connection.id,
        { kind: 'lineage', database: selectedDatabase },
        active,
        false,
    );
    const current = snapshot?.kind === 'lineage' ? snapshot : undefined;
    const content = (
        <>
            <div className="native-toolbar native-lineage-meta-toolbar">
                <span className="native-snapshot-meta">
                    {current?.source === 'fixture'
                        ? 'SAMPLE DATA'
                        : embedded
                          ? 'LIVE SERVER DATA'
                          : 'SERVER METADATA'}
                    {current && ` · Updated ${nativeTime(current.observedAt)}`}
                </span>
                <label className="native-lineage-database">
                    Database
                    <select
                        aria-label="Lineage database"
                        value={selectedDatabase}
                        onChange={event => setSelectedDatabase(event.target.value)}
                    >
                        {databases.map(value => (
                            <option key={value} value={value}>
                                {value}
                            </option>
                        ))}
                    </select>
                </label>
                <Button onClick={refresh} disabled={loading}>
                    {embedded ? 'Refresh map' : 'Refresh metadata'}
                </Button>
            </div>
            {error && (
                <div role="alert" className="native-warning">
                    {error}
                    {current && <p>The previous snapshot is shown below.</p>}
                </div>
            )}
            {loading && !current && (
                <div className="native-empty" role="status">
                    {embedded ? 'Loading the data map…' : 'Reading materialized-view metadata…'}
                </div>
            )}
            {!loading && !error && !current && (
                <div className="native-empty" role="status">
                    No metadata snapshot is loaded. Use Refresh metadata to check this database
                    again.
                </div>
            )}
            {current && (
                <>
                    <LineageGraph snapshot={current} beginner={embedded} />
                    {embedded ? (
                        <footer className="native-notes">
                            <details className="native-lineage-notes">
                                <summary>About this map</summary>
                                {current.notes.map(note => (
                                    <p key={note}>{note}</p>
                                ))}
                                <p>
                                    Server-reported links may not include every table referenced by
                                    a view query.
                                </p>
                            </details>
                        </footer>
                    ) : (
                        <footer className="native-notes">
                            {current.notes.map(note => (
                                <p key={note}>{note}</p>
                            ))}
                        </footer>
                    )}
                </>
            )}
        </>
    );
    return embedded ? (
        content
    ) : (
        <NativeExplorerDialog
            title="Materialized view dependencies"
            description={`${selectedDatabase} · Insert triggers, write targets, and refresh schedules`}
            onClose={() => onClose?.()}
        >
            {content}
        </NativeExplorerDialog>
    );
}
