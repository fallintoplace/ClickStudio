import { useMemo } from 'react';
import { demoReplication, demoWorkload } from '../../shared/observability-fixtures';
import type { WorkloadPoint } from '../../shared/workload';
import { formatBytes } from './ui';

function bytes(value: string) {
    try {
        return Number(BigInt(value));
    } catch {
        return 0;
    }
}

function WorkloadSample({ connectionId }: { connectionId: string }) {
    const snapshot = useMemo(() => demoWorkload(connectionId, 60), [connectionId]);
    const maxDuration = Math.max(1, ...snapshot.points.map(point => point.durationMs));
    const maxMemory = Math.max(1, ...snapshot.points.map(point => bytes(point.memory)));
    const runs = snapshot.families.reduce((sum, family) => sum + family.executions, 0);
    const errors = snapshot.families.reduce((sum, family) => sum + family.errors, 0);
    const readBytes = snapshot.families.reduce((sum, family) => sum + bytes(family.readBytes), 0);

    const pointPosition = (point: WorkloadPoint, index: number) => ({
        cx: 28 + (point.durationMs / maxDuration) * 424,
        cy: 12 + (1 - bytes(point.memory) / maxMemory) * 58,
        r: 2.4 + (index % 3) * 0.45,
    });

    return (
        <article className="workspace-help-monitoring-sample-card">
            <header>
                <span className="eyebrow">WORKLOAD · 60 MIN</span>
                <strong>Query activity</strong>
            </header>
            <div className="workspace-help-monitoring-sample-metrics">
                <span>
                    <small>Executions</small>
                    <strong>{runs.toLocaleString()}</strong>
                </span>
                <span>
                    <small>Query families</small>
                    <strong>{snapshot.families.length}</strong>
                </span>
                <span>
                    <small>Read volume</small>
                    <strong>{formatBytes(readBytes)}</strong>
                </span>
                <span className={errors ? 'has-warning' : ''}>
                    <small>Errors</small>
                    <strong>{errors}</strong>
                </span>
            </div>
            <div className="workspace-help-monitoring-sample-chart">
                <div>
                    <span>Duration</span>
                    <span>Peak memory</span>
                </div>
                <svg
                    viewBox="0 0 480 82"
                    role="img"
                    aria-label="Sample query duration and peak memory chart"
                >
                    {[22, 42, 62].map(y => (
                        <line
                            key={y}
                            x1="24"
                            x2="458"
                            y1={y}
                            y2={y}
                            className="workspace-help-monitoring-gridline"
                        />
                    ))}
                    {snapshot.points.slice(0, 70).map((point, index) => {
                        const position = pointPosition(point, index);
                        return (
                            <circle
                                key={point.queryId}
                                cx={position.cx}
                                cy={position.cy}
                                r={position.r}
                                className={point.failed ? 'is-error' : ''}
                            >
                                <title>{`${point.durationMs} ms · ${formatBytes(point.memory)} peak memory${point.failed ? ' · failed' : ''}`}</title>
                            </circle>
                        );
                    })}
                </svg>
                <div className="workspace-help-monitoring-chart-axis">
                    <span>Fast</span>
                    <span>Slow</span>
                </div>
            </div>
            <div className="workspace-help-monitoring-sample-families">
                {snapshot.families.slice(0, 3).map(family => (
                    <div key={family.hash}>
                        <code>{family.query}</code>
                        <span>
                            {family.executions.toLocaleString()} runs · p95{' '}
                            {Math.round(family.p95Ms)} ms
                        </span>
                    </div>
                ))}
            </div>
        </article>
    );
}

function ReplicationSample({ connectionId }: { connectionId: string }) {
    const snapshot = useMemo(() => demoReplication(connectionId), [connectionId]);
    const issues = snapshot.replicas.filter(
        replica =>
            replica.readonly ||
            replica.sessionExpired ||
            replica.absoluteDelay > 60 ||
            replica.activeReplicas < replica.totalReplicas,
    ).length;
    const queued = snapshot.queue.reduce((sum, group) => sum + group.entries, 0);

    return (
        <article className="workspace-help-monitoring-sample-card">
            <header>
                <span className="eyebrow">REPLICATION · LOCAL NODE</span>
                <strong>Replica health</strong>
            </header>
            <div className="workspace-help-monitoring-sample-metrics">
                <span>
                    <small>Replicated tables</small>
                    <strong>{snapshot.replicas.length}</strong>
                </span>
                <span className={issues ? 'has-warning' : ''}>
                    <small>Needs attention</small>
                    <strong>{issues}</strong>
                </span>
                <span>
                    <small>Queued tasks</small>
                    <strong>{queued}</strong>
                </span>
                <span>
                    <small>Queue errors</small>
                    <strong>{snapshot.queue.reduce((sum, group) => sum + group.errors, 0)}</strong>
                </span>
            </div>
            <div className="workspace-help-monitoring-sample-replicas">
                {snapshot.replicas.map(replica => {
                    const needsAttention =
                        replica.readonly ||
                        replica.sessionExpired ||
                        replica.absoluteDelay > 60 ||
                        replica.activeReplicas < replica.totalReplicas;
                    const tableQueue = snapshot.queue
                        .filter(
                            group =>
                                group.database === replica.database &&
                                group.table === replica.table,
                        )
                        .reduce((sum, group) => sum + group.entries, 0);
                    return (
                        <div key={`${replica.database}.${replica.table}`}>
                            <span
                                className={`workspace-help-replica-dot${needsAttention ? ' is-warning' : ''}`}
                            />
                            <code>
                                {replica.database}.{replica.table}
                            </code>
                            <span>
                                {replica.activeReplicas}/{replica.totalReplicas} active
                            </span>
                            <span>{replica.absoluteDelay}s delay</span>
                            <strong className={needsAttention ? 'is-warning' : ''}>
                                {needsAttention ? 'Review' : 'Healthy'}
                            </strong>
                            <small>{tableQueue} queued</small>
                        </div>
                    );
                })}
            </div>
        </article>
    );
}

export function MonitoringHelpPreview({
    connectionId,
    workloadSample,
    replicationSample,
}: {
    connectionId: string;
    workloadSample: boolean;
    replicationSample: boolean;
}) {
    if (!workloadSample && !replicationSample) return null;

    return (
        <section className="workspace-help-monitoring-preview" aria-label="Sample monitoring data">
            <header className="workspace-help-monitoring-preview-heading">
                <div>
                    <span className="eyebrow">MONITORING</span>
                    <strong>Example snapshot</strong>
                </div>
                <span className="workspace-help-monitoring-demo-tag">Demo</span>
            </header>
            <div className="workspace-help-monitoring-preview-grid">
                {workloadSample && <WorkloadSample connectionId={connectionId} />}
                {replicationSample && <ReplicationSample connectionId={connectionId} />}
            </div>
        </section>
    );
}
