import { useEffect, useState } from 'react';
import type { ReplicationSnapshot } from '../../shared/replication';
import type { Capability } from '../../shared/types';
import { message } from '../api';
import { loadReplication } from '../observability-provider';

export function ReplicationExplorer({
    connectionId,
    capability,
    trusted,
}: {
    connectionId: string;
    capability?: Capability;
    trusted: boolean;
}) {
    const [state, setState] = useState<{
        connectionId: string;
        value?: ReplicationSnapshot;
        loading: boolean;
        error?: string;
    }>();
    const [refresh, setRefresh] = useState(0);

    useEffect(() => {
        if (!trusted || capability?.available !== true) return;
        const controller = new AbortController();
        setState({ connectionId, loading: true });
        void loadReplication(connectionId, controller.signal)
            .then(value => {
                if (!controller.signal.aborted) setState({ connectionId, value, loading: false });
            })
            .catch(error => {
                if (!controller.signal.aborted)
                    setState({ connectionId, loading: false, error: message(error) });
            });
        return () => controller.abort();
    }, [capability?.available, connectionId, refresh, trusted]);

    const snapshot = state?.connectionId === connectionId ? state.value : undefined;
    const loading = state?.connectionId === connectionId && state.loading;
    const replicas = snapshot?.replicas ?? [];
    const queue = snapshot?.queue ?? [];
    const queued = queue.reduce((sum, group) => sum + group.entries, 0);
    const issues = replicas.filter(
        replica =>
            replica.readonly ||
            replica.sessionExpired ||
            replica.absoluteDelay > 60 ||
            replica.activeReplicas < replica.totalReplicas,
    ).length;
    const queueIssues = queue.reduce((sum, group) => sum + group.errors + group.postponed, 0);

    if (!trusted)
        return (
            <div className="observability-state" role="status">
                <span className="eyebrow">REPLICATION</span>
                <strong>Trust this connection to inspect replication health.</strong>
            </div>
        );
    if (capability?.available !== true)
        return (
            <div className="observability-state" role="status">
                <span className="eyebrow">REPLICATION</span>
                <strong>Replication system tables are unavailable.</strong>
                <p>{capability?.reason ?? 'Test the connection to check replication access.'}</p>
            </div>
        );

    return (
        <section className="replication-view" aria-label="Replication health">
            <div className="observability-view-heading">
                <div>
                    <span className="eyebrow">LOCAL REPLICA STATUS</span>
                    <h3>Replication</h3>
                    <p>Replica and queue evidence from this server. No cluster-wide fan-out.</p>
                </div>
                <button
                    className="observability-refresh"
                    type="button"
                    disabled={loading}
                    onClick={() => setRefresh(value => value + 1)}
                >
                    Refresh
                </button>
            </div>
            <div className="observability-scope">
                <span className="status-light is-trusted" />
                Current server · local replica rows · configured cluster topology is not inferred
            </div>
            {loading && (
                <div className="observability-state" role="status">
                    Loading replication status…
                </div>
            )}
            {state?.connectionId === connectionId && state.error && (
                <div className="observability-state is-error" role="alert">
                    {state.error}
                </div>
            )}
            {snapshot && (
                <>
                    <div className="observability-metrics">
                        <article>
                            <span>Replicated tables</span>
                            <strong>
                                {snapshot.capabilities.replicas
                                    ? replicas.length.toLocaleString()
                                    : '—'}
                            </strong>
                        </article>
                        <article className={issues ? 'has-warning' : ''}>
                            <span>Tables needing attention</span>
                            <strong>
                                {snapshot.capabilities.replicas ? issues.toLocaleString() : '—'}
                            </strong>
                        </article>
                        <article>
                            <span>Queued tasks</span>
                            <strong>
                                {snapshot.capabilities.queue ? queued.toLocaleString() : '—'}
                            </strong>
                        </article>
                        <article className={queueIssues ? 'has-warning' : ''}>
                            <span>Queue errors / postponed</span>
                            <strong>
                                {snapshot.capabilities.queue ? queueIssues.toLocaleString() : '—'}
                            </strong>
                        </article>
                    </div>
                    {!snapshot.capabilities.replicas && (
                        <div className="observability-state">
                            Replica details are unavailable to this reader.{' '}
                            {snapshot.capabilities.queue ? 'Queue summaries are shown below.' : ''}
                        </div>
                    )}
                    {snapshot.capabilities.replicas && !replicas.length && (
                        <div className="observability-empty">
                            <span className="observability-empty-mark">◎</span>
                            <strong>No replicated MergeTree tables</strong>
                            <p>
                                This server returned an empty <code>system.replicas</code> view.
                            </p>
                        </div>
                    )}
                    {replicas.length > 0 && (
                        <div className="replication-table-list">
                            {replicas.map(replica => {
                                const entries = queue.filter(
                                    group =>
                                        group.database === replica.database &&
                                        group.table === replica.table,
                                );
                                const needsAttention =
                                    replica.readonly ||
                                    replica.sessionExpired ||
                                    replica.absoluteDelay > 60 ||
                                    replica.activeReplicas < replica.totalReplicas ||
                                    entries.some(group => group.errors > 0 || group.postponed > 0);
                                return (
                                    <article
                                        className={`replication-table-card${needsAttention ? ' has-warning' : ''}`}
                                        key={`${replica.database}.${replica.table}:${replica.replicaName}`}
                                    >
                                        <header>
                                            <span
                                                className={`replication-health-dot${needsAttention ? ' is-warning' : ''}`}
                                            />
                                            <div>
                                                <span className="eyebrow">{replica.database}</span>
                                                <h4>{replica.table}</h4>
                                            </div>
                                            <strong className="replication-health-label">
                                                {needsAttention ? 'Review' : 'Healthy'}
                                            </strong>
                                        </header>
                                        <div className="replication-table-meta">
                                            <span>
                                                <small>Local replica</small>
                                                <code>{replica.replicaName || 'unknown'}</code>
                                            </span>
                                            <span>
                                                <small>Replicas active</small>
                                                <strong>
                                                    {replica.activeReplicas} /{' '}
                                                    {replica.totalReplicas}
                                                </strong>
                                            </span>
                                            <span>
                                                <small>Delay</small>
                                                <strong>
                                                    {replica.absoluteDelay.toLocaleString()} s
                                                </strong>
                                            </span>
                                            <span>
                                                <small>Queue</small>
                                                <strong>
                                                    {replica.queueSize.toLocaleString()}
                                                </strong>
                                            </span>
                                        </div>
                                        <div className="replication-flags">
                                            {replica.leader && <span>Leader</span>}
                                            {replica.readonly && (
                                                <span className="is-warning">Read only</span>
                                            )}
                                            {replica.sessionExpired && (
                                                <span className="is-warning">Session expired</span>
                                            )}
                                            <span>{replica.insertsInQueue} inserts</span>
                                            <span>{replica.mergesInQueue} merges</span>
                                            <span>{replica.futureParts} future parts</span>
                                        </div>
                                        {entries.length > 0 && (
                                            <div className="replication-queue-list">
                                                {entries.map(group => (
                                                    <div
                                                        key={`${group.type}:${group.database}.${group.table}`}
                                                    >
                                                        <strong>{group.type}</strong>
                                                        <span>
                                                            {group.entries.toLocaleString()} tasks
                                                        </span>
                                                        <span>
                                                            {group.errors} errors ·{' '}
                                                            {group.postponed} postponed
                                                        </span>
                                                        <small>
                                                            Oldest {group.oldestAt || 'unknown'} ·
                                                            max retries {group.maxTries}
                                                        </small>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    )}
                    {snapshot.capabilities.queue && !queue.length && (
                        <div className="observability-footnote">Replication queue is empty.</div>
                    )}
                    {snapshot.truncated && (
                        <div className="observability-footnote">
                            Showing the first 500 local replica records and queue groups.
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
