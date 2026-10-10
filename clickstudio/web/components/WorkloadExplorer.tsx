import { scaleLinear, scaleSqrt } from 'd3';
import { useEffect, useMemo, useState } from 'react';
import type { WorkloadSnapshot, WorkloadWindow } from '../../shared/workload';
import type { Capability } from '../../shared/types';
import { loadWorkload } from '../observability-provider';
import { message } from '../api';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';
import { Button, formatBytes, Icon } from './ui';

const windows: Array<{ value: WorkloadWindow; label: string }> = [
    { value: 15, label: '15 min' },
    { value: 60, label: '1 hour' },
    { value: 360, label: '6 hours' },
    { value: 1440, label: '24 hours' },
];
const chartWidth = 1040;
const chartHeight = 340;
const margin = { top: 22, right: 28, bottom: 42, left: 72 };

function count(value: string) {
    try {
        return BigInt(value).toLocaleString();
    } catch {
        return value;
    }
}

function byteNumber(value: string) {
    try {
        return Math.min(1e18, Number(BigInt(value)));
    } catch {
        return 0;
    }
}

export function WorkloadExplorer({
    connectionId,
    capability,
    trusted,
}: {
    connectionId: string;
    capability?: Capability;
    trusted: boolean;
}) {
    const [minutes, setMinutes] = useState<WorkloadWindow>(60);
    const [snapshotState, setSnapshotState] = useState<{
        key: string;
        value?: WorkloadSnapshot;
        loading: boolean;
        error?: string;
    }>();
    const [selectedHash, setSelectedHash] = useState('');
    const [refresh, setRefresh] = useState(0);
    const key = `${connectionId}:${minutes}`;

    useEffect(() => {
        if (!trusted || capability?.available !== true) return;
        const controller = new AbortController();
        setSnapshotState({ key, loading: true });
        void loadWorkload(connectionId, minutes, controller.signal)
            .then(value => {
                if (!controller.signal.aborted) setSnapshotState({ key, value, loading: false });
            })
            .catch(error => {
                if (!controller.signal.aborted)
                    setSnapshotState({ key, loading: false, error: message(error) });
            });
        return () => controller.abort();
    }, [capability?.available, connectionId, key, minutes, refresh, trusted]);

    const snapshot = snapshotState?.key === key ? snapshotState.value : undefined;
    const loading = snapshotState?.key === key && snapshotState.loading;
    const selectedFamily =
        snapshot?.families.find(family => family.hash === selectedHash) ?? snapshot?.families[0];
    const chart = useMemo(() => {
        const points = snapshot?.points ?? [];
        const maxDuration = Math.max(1, ...points.map(point => point.durationMs));
        const maxMemory = Math.max(1, ...points.map(point => byteNumber(point.memory)));
        const maxRows = Math.max(1, ...points.map(point => byteNumber(point.readRows)));
        return {
            x: scaleLinear()
                .domain([0, maxDuration])
                .nice()
                .range([margin.left, chartWidth - margin.right]),
            y: scaleSqrt()
                .domain([0, maxMemory])
                .range([chartHeight - margin.bottom, margin.top]),
            radius: scaleSqrt().domain([0, maxRows]).range([4, 13]),
        };
    }, [snapshot?.points]);
    const families = snapshot?.families ?? [];
    const totalRuns = families.reduce((sum, family) => sum + family.executions, 0);
    const totalErrors = families.reduce((sum, family) => sum + family.errors, 0);

    if (!trusted)
        return (
            <div className="observability-state" role="status">
                <span className="eyebrow">WORKLOAD</span>
                <strong>Trust this connection to inspect workload history.</strong>
            </div>
        );
    if (capability?.available !== true)
        return (
            <div className="observability-state" role="status">
                <span className="eyebrow">WORKLOAD</span>
                <strong>Query-log access is unavailable.</strong>
                <p>{capability?.reason ?? 'Test the connection to check query-log access.'}</p>
            </div>
        );

    return (
        <section className="workload-view" aria-label="Workload observatory">
            <div className="observability-view-heading">
                <div>
                    <span className="eyebrow">LOCAL QUERY LOG</span>
                    <h3>Workload</h3>
                    <p>Query families and recent executions from this ClickHouse connection.</p>
                </div>
                <div className="workload-controls" role="group" aria-label="Workload time window">
                    <div className="parts-view-control">
                        {windows.map(option => (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={minutes === option.value}
                                onClick={() => setMinutes(option.value)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <Button
                        variant="secondary"
                        className="toolbar-small"
                        onClick={() => setRefresh(value => value + 1)}
                        disabled={loading}
                    >
                        <Icon name="history" />
                        Refresh
                    </Button>
                </div>
            </div>
            <div className="observability-scope">
                <span className="status-light is-trusted" />
                Current user · local node ·{' '}
                {snapshot?.queryLogSource === 'user_query_log' ? 'user query log' : 'query log'}
            </div>
            {loading && (
                <div className="observability-state" role="status">
                    Loading query history…
                </div>
            )}
            {snapshotState?.key === key && snapshotState.error && (
                <div className="observability-state is-error" role="alert">
                    {snapshotState.error}
                </div>
            )}
            {snapshot && (
                <>
                    <div className="observability-metrics">
                        <article>
                            <span>Executions</span>
                            <strong>{totalRuns.toLocaleString()}</strong>
                        </article>
                        <article>
                            <span>Query families</span>
                            <strong>{families.length.toLocaleString()}</strong>
                        </article>
                        <article>
                            <span>Read volume</span>
                            <strong>
                                {formatBytes(
                                    families.reduce(
                                        (sum, family) => sum + byteNumber(family.readBytes),
                                        0,
                                    ),
                                )}
                            </strong>
                        </article>
                        <article className={totalErrors ? 'has-warning' : ''}>
                            <span>Errors</span>
                            <strong>{totalErrors.toLocaleString()}</strong>
                        </article>
                    </div>
                    <div className="workload-scatter-card">
                        <div className="workload-section-heading">
                            <div>
                                <span className="eyebrow">RECENT EXECUTIONS</span>
                                <strong>Duration vs. peak memory</strong>
                            </div>
                            <span className="workload-chart-legend">
                                <i />
                                Successful <i className="is-error" />
                                Failed · Bubble size: rows read
                            </span>
                        </div>
                        {snapshot.points.length ? (
                            <ScrollEdgeFrame<HTMLDivElement> className="workload-scatter-frame">
                                {ref => (
                                    <div ref={ref} className="workload-scatter-scroll">
                                        <svg
                                            className="workload-scatter-svg"
                                            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                                            role="group"
                                            aria-label="Recent query execution duration plotted against memory usage"
                                        >
                                            {chart.x.ticks(5).map(tick => (
                                                <g key={`x-${tick}`} className="workload-axis">
                                                    <line
                                                        x1={chart.x(tick)}
                                                        x2={chart.x(tick)}
                                                        y1={margin.top}
                                                        y2={chartHeight - margin.bottom}
                                                    />
                                                    <text
                                                        x={chart.x(tick)}
                                                        y={chartHeight - margin.bottom + 22}
                                                        textAnchor="middle"
                                                    >
                                                        {Math.round(tick)} ms
                                                    </text>
                                                </g>
                                            ))}
                                            {chart.y.ticks(4).map(tick => (
                                                <g key={`y-${tick}`} className="workload-axis">
                                                    <line
                                                        x1={margin.left}
                                                        x2={chartWidth - margin.right}
                                                        y1={chart.y(tick)}
                                                        y2={chart.y(tick)}
                                                    />
                                                    <text
                                                        x={margin.left - 10}
                                                        y={chart.y(tick) + 3}
                                                        textAnchor="end"
                                                    >
                                                        {formatBytes(tick)}
                                                    </text>
                                                </g>
                                            ))}
                                            {snapshot.points.map(point => {
                                                const active =
                                                    !selectedFamily ||
                                                    point.hash === selectedFamily.hash;
                                                return (
                                                    <circle
                                                        key={point.queryId}
                                                        className={`workload-scatter-point${point.failed ? ' is-error' : ''}${active ? '' : ' is-muted'}`}
                                                        cx={chart.x(point.durationMs)}
                                                        cy={chart.y(byteNumber(point.memory))}
                                                        r={chart.radius(byteNumber(point.readRows))}
                                                        role="button"
                                                        tabIndex={0}
                                                        aria-label={`${point.failed ? 'Failed' : 'Successful'} query · ${point.durationMs} ms · ${formatBytes(point.memory)} peak memory · ${count(point.readRows)} rows read`}
                                                        onClick={() => setSelectedHash(point.hash)}
                                                        onKeyDown={event => {
                                                            if (
                                                                event.key === 'Enter' ||
                                                                event.key === ' '
                                                            )
                                                                setSelectedHash(point.hash);
                                                        }}
                                                    >
                                                        <title>{`${point.at} · ${point.durationMs} ms · ${formatBytes(point.memory)} · ${count(point.readRows)} rows read · ${point.queryId}`}</title>
                                                    </circle>
                                                );
                                            })}
                                        </svg>
                                    </div>
                                )}
                            </ScrollEdgeFrame>
                        ) : (
                            <div className="observability-state">
                                No query executions in this time window.
                            </div>
                        )}
                    </div>
                    <div className="workload-browser">
                        <section className="workload-family-list" aria-label="Query families">
                            <div className="workload-section-heading">
                                <div>
                                    <span className="eyebrow">QUERY FAMILIES</span>
                                    <strong>Ranked by total duration</strong>
                                </div>
                            </div>
                            {families.length ? (
                                families.map(family => (
                                    <button
                                        key={family.hash}
                                        type="button"
                                        className={
                                            selectedFamily?.hash === family.hash
                                                ? 'is-selected'
                                                : ''
                                        }
                                        aria-pressed={selectedFamily?.hash === family.hash}
                                        onClick={() => setSelectedHash(family.hash)}
                                    >
                                        <span>
                                            <code>{family.query || `Query ${family.hash}`}</code>
                                            <small>
                                                {family.executions.toLocaleString()} runs · p95{' '}
                                                {Math.round(family.p95Ms)} ms
                                                {family.errors ? ` · ${family.errors} errors` : ''}
                                            </small>
                                        </span>
                                        <strong>{formatBytes(family.readBytes)}</strong>
                                    </button>
                                ))
                            ) : (
                                <div className="observability-state">
                                    No query families in this time window.
                                </div>
                            )}
                        </section>
                        <section
                            className="workload-family-detail"
                            aria-live="polite"
                            aria-label="Selected query family"
                        >
                            {selectedFamily ? (
                                <>
                                    <div>
                                        <span className="eyebrow">SELECTED FAMILY</span>
                                        <code>
                                            {selectedFamily.query || `Query ${selectedFamily.hash}`}
                                        </code>
                                    </div>
                                    <div className="workload-family-stats">
                                        <span>
                                            <small>Executions</small>
                                            <strong>
                                                {selectedFamily.executions.toLocaleString()}
                                            </strong>
                                        </span>
                                        <span>
                                            <small>p50 / p95 / p99</small>
                                            <strong>
                                                {Math.round(selectedFamily.p50Ms)} /{' '}
                                                {Math.round(selectedFamily.p95Ms)} /{' '}
                                                {Math.round(selectedFamily.p99Ms)} ms
                                            </strong>
                                        </span>
                                        <span>
                                            <small>Total duration</small>
                                            <strong>
                                                {Math.round(
                                                    selectedFamily.totalMs,
                                                ).toLocaleString()}{' '}
                                                ms
                                            </strong>
                                        </span>
                                        <span>
                                            <small>Rows / bytes read</small>
                                            <strong>
                                                {count(selectedFamily.readRows)} /{' '}
                                                {formatBytes(selectedFamily.readBytes)}
                                            </strong>
                                        </span>
                                        <span>
                                            <small>Peak memory</small>
                                            <strong>
                                                {formatBytes(selectedFamily.peakMemory)}
                                            </strong>
                                        </span>
                                        <span>
                                            <small>Errors · latest</small>
                                            <strong>
                                                {selectedFamily.errors.toLocaleString()} ·{' '}
                                                {selectedFamily.lastSeen}
                                            </strong>
                                        </span>
                                    </div>
                                </>
                            ) : (
                                <p>
                                    Select a query family to inspect its latency and read profile.
                                </p>
                            )}
                        </section>
                    </div>
                    {snapshot.truncated && (
                        <div className="observability-footnote">
                            Showing a bounded sample of query families and recent executions.
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
