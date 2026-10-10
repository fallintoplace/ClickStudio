import { useState } from 'react';
import type { Connection, SchemaTable } from '../../shared/types';
import {
    mutationStatus,
    type MergeActivity,
    type MutationActivity,
} from '../../shared/storage-activity';
import { nativeBytes, nativeCount, nativeTime } from '../../shared/native-format';
import { useNativeExplorer } from '../useNativeExplorer';
import { Button } from './ui';

function MergeCard({ item }: { item: MergeActivity }) {
    const percent = item.progress === undefined ? undefined : Math.round(item.progress * 100);
    const elapsedMs =
        item.elapsedSeconds === undefined ? 0 : Math.round(item.elapsedSeconds * 1000);
    const rate =
        item.bytesRead !== undefined && Number.isSafeInteger(elapsedMs) && elapsedMs > 0
            ? ((BigInt(item.bytesRead) * 1000n) / BigInt(elapsedMs)).toString()
            : undefined;
    return (
        <article className="native-activity-card">
            <header>
                <span className="native-badge">
                    {item.isMutation ? 'PART MUTATION' : 'MERGING'}
                </span>
                <strong>{percent === undefined ? 'Progress unavailable' : `${percent}%`}</strong>
            </header>
            <div className="native-merge-flow">
                <div className="native-source-parts">
                    {item.sourceParts.slice(0, 8).map(name => (
                        <code key={name}>{name}</code>
                    ))}
                    {(item.sourceParts.length > 8 || item.sourcePartsTruncated) && (
                        <details>
                            <summary>
                                More source parts
                                {item.sourcePartsTruncated ? ' (bounded list)' : ''}
                            </summary>
                            {item.sourceParts.slice(8).map(name => (
                                <code key={name}>{name}</code>
                            ))}
                        </details>
                    )}
                </div>
                <span className="native-flow-arrow" aria-hidden="true">
                    ⟶
                </span>
                <div className="native-merge-target">
                    <span className="eyebrow">RESULT PART</span>
                    <code>{item.resultPart}</code>
                    <progress
                        aria-label={`Progress for ${item.resultPart}`}
                        value={percent}
                        max={100}
                    />
                    <small>
                        {item.elapsedSeconds === undefined
                            ? 'Elapsed unavailable'
                            : `${item.elapsedSeconds.toFixed(1)} seconds elapsed`}
                    </small>
                </div>
            </div>
            <dl className="native-metrics">
                <div>
                    <dt>Average read rate</dt>
                    <dd>{rate === undefined ? 'Unavailable' : `${nativeBytes(rate)}/s`}</dd>
                </div>
                <div>
                    <dt>Uncompressed read</dt>
                    <dd title={item.bytesRead}>{nativeBytes(item.bytesRead)}</dd>
                </div>
                <div>
                    <dt>Uncompressed written</dt>
                    <dd title={item.bytesWritten}>{nativeBytes(item.bytesWritten)}</dd>
                </div>
                <div>
                    <dt>Memory</dt>
                    <dd title={item.memory}>{nativeBytes(item.memory)}</dd>
                </div>
            </dl>
        </article>
    );
}
function MutationCard({ item }: { item: MutationActivity }) {
    return (
        <article className="native-activity-card">
            <header>
                <code>{item.id}</code>
                <span
                    className={`native-badge ${item.done ? 'is-complete' : item.latestFailure ? 'is-warning' : ''}`}
                >
                    {mutationStatus(item)}
                </span>
            </header>
            <pre className="native-sql">{item.command}</pre>
            <dl className="native-metrics">
                <div>
                    <dt>Parts remaining</dt>
                    <dd>{nativeCount(item.partsRemaining)}</dd>
                </div>
                <div>
                    <dt>Created (UTC)</dt>
                    <dd>{nativeTime(item.createdAt)}</dd>
                </div>
            </dl>
            {item.latestFailure && (
                <details className="native-warning">
                    <summary>Last attempt details</summary>
                    <p>
                        {nativeTime(item.latestFailureAt)} · {item.failedPart}
                    </p>
                    <pre>{item.latestFailure}</pre>
                </details>
            )}
        </article>
    );
}
export function StorageActivityView({
    connection,
    table,
    kind,
    active,
}: {
    connection: Pick<Connection, 'id' | 'dataSource'>;
    table: SchemaTable;
    kind: 'merges' | 'mutations';
    active: boolean;
}) {
    const [live, setLive] = useState(false);
    const { snapshot, loading, error, refresh } = useNativeExplorer(
        connection.id,
        { kind, database: table.database, table: table.name },
        active,
        live && connection.dataSource !== 'fixture',
    );
    const current = snapshot?.kind === kind ? snapshot : undefined;
    return (
        <section
            className="native-activity"
            aria-label={kind === 'merges' ? 'Merge activity' : 'Mutation activity'}
        >
            <div className="native-toolbar">
                <div>
                    <h3>
                        {table.database}.{table.name}
                    </h3>
                    <p>
                        {kind === 'merges'
                            ? 'Watch source parts become a new physical part.'
                            : 'Inspect queued, processing, and completed mutations.'}
                    </p>
                </div>
                <label className="native-toggle">
                    <input
                        type="checkbox"
                        checked={live}
                        onChange={event => setLive(event.target.checked)}
                        disabled={connection.dataSource === 'fixture'}
                    />
                    Auto-refresh · 5 s
                </label>
                <Button onClick={refresh} disabled={loading}>
                    Refresh
                </Button>
            </div>
            {error && (
                <div role="alert" className="native-warning">
                    {error}
                    {current && <p>Showing the previous snapshot below, not current activity.</p>}
                </div>
            )}
            {loading && !current && (
                <div role="status" className="native-empty">
                    Reading ClickHouse metadata…
                </div>
            )}
            {current && (
                <>
                    <div className="native-snapshot-meta">
                        <span>
                            {current.source === 'fixture'
                                ? 'SAMPLE DATA · static'
                                : 'SERVER SNAPSHOT'}
                        </span>
                        <time dateTime={current.observedAt}>{nativeTime(current.observedAt)}</time>
                        {loading && <span>Refreshing…</span>}
                    </div>
                    {current.items.length === 0 && (
                        <div className="native-empty">
                            {kind === 'merges'
                                ? 'No active merges or part mutations in this snapshot.'
                                : 'No mutation records for this table.'}
                        </div>
                    )}
                    {current.kind === 'merges'
                        ? current.items.map(item => <MergeCard key={item.id} item={item} />)
                        : current.items.map(item => <MutationCard key={item.id} item={item} />)}
                    {current.truncated && (
                        <p className="native-warning">
                            Showing the first 50 records. Additional activity is not included.
                        </p>
                    )}
                    <footer className="native-notes">
                        {current.notes.map(note => (
                            <p key={note}>{note}</p>
                        ))}
                    </footer>
                </>
            )}
        </section>
    );
}
