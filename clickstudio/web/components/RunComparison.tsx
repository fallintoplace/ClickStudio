import { useEffect, useMemo, useState } from 'react';
import type { ProfilePipeline, QueryProfile, Run } from '../../shared/types';
import {
    comparableRun,
    comparePipelineOperators,
    compareRuns,
    comparisonDelta,
    type ComparisonMetric,
} from '../../shared/run-comparison';
import { nativeBytes, nativeCount, nativeTime } from '../../shared/native-format';
import { api, message } from '../api';
import { NativeExplorerDialog } from './NativeExplorerDialog';
import { OverlayPortal } from './OverlayPortal';
import { PipelineGraph } from './PipelineGraph';
import { Button } from './ui';

export interface RunComparisonProps {
    connectionId: string;
    trusted: boolean;
    history: Run[];
    initialRun?: Run;
    profiles?: Readonly<Record<string, QueryProfile>>;
    pipelines?: Readonly<Record<string, ProfilePipeline>>;
    queryLogAvailable?: boolean;
}
function metricValue(value: string | undefined, unit: ComparisonMetric['unit']) {
    if (unit === 'bytes') {
        return nativeBytes(value);
    }

    if (value === undefined) {
        return 'Unavailable';
    }

    return `${nativeCount(value)}${unit === 'ms' ? ' ms' : ''}`;
}
function runOptionLabel(run: Run) {
    const query = run.sql.replace(/\s+/g, ' ').trim();
    const preview = query.length > 38 ? `${query.slice(0, 38).trimEnd()}…` : query;
    return `${run.createdAt.replace('T', ' ').slice(0, 19)} · ${preview}`;
}
function PipelineComparison({
    before,
    after,
}: {
    before?: ProfilePipeline;
    after?: ProfilePipeline;
}) {
    const usable = (pipeline?: ProfilePipeline) =>
        pipeline?.available && pipeline.source !== 'query_shape' ? pipeline : undefined;
    const left = usable(before),
        right = usable(after);
    const differences =
        left && right && left.source === right.source
            ? comparePipelineOperators(left, right)
            : undefined;
    return (
        <section className="native-pipeline-comparison">
            <h3>Saved pipeline comparison</h3>
            <p className="native-notes">
                These are inspections captured in this workspace session, potentially after
                execution—not historical runtime plans. Comparing does not run EXPLAIN again.
            </p>
            {differences && (
                <details open>
                    <summary>Operator inventory changes · {differences.length}</summary>
                    {differences.length ? (
                        <div className="native-operator-diff">
                            {differences.map(row => (
                                <div key={row.label}>
                                    <code>{row.label}</code>
                                    <span>
                                        {row.before} → {row.after}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="native-notes">
                            The operator counts match. This does not establish structural or result
                            equivalence.
                        </p>
                    )}
                </details>
            )}
            {left && right && left.source !== right.source && (
                <p className="native-notes">
                    Different inspection types: inspect the graphs separately.
                </p>
            )}
            <div className="native-comparison-columns">
                {[
                    { name: 'Before', pipeline: left },
                    { name: 'After', pipeline: right },
                ].map(({ name, pipeline }) => (
                    <article key={name}>
                        <h4>
                            {name}
                            {pipeline && ` · ${pipeline.source}`}
                        </h4>
                        {pipeline ? (
                            <>
                                <p className="native-notes">{pipeline.notice}</p>
                                <PipelineGraph pipeline={pipeline} />
                            </>
                        ) : (
                            <div className="native-empty">
                                No saved ClickHouse pipeline for this run. Open its Insights and
                                load the pipeline, then return here.
                            </div>
                        )}
                    </article>
                ))}
            </div>
        </section>
    );
}
function ComparisonBody({
    before,
    after,
    profiles,
    pipelines,
    queryLogAvailable,
}: { before: Run; after: Run } & Pick<
    RunComparisonProps,
    'profiles' | 'pipelines' | 'queryLogAvailable'
>) {
    const [loaded, setLoaded] = useState<Record<string, QueryProfile>>({});
    const [requested, setRequested] = useState(false),
        [loading, setLoading] = useState(false),
        [error, setError] = useState('');
    useEffect(() => {
        if (!requested || !queryLogAvailable) return;
        const controller = new AbortController();
        setLoading(true);
        setError('');
        void Promise.all(
            [before.id, after.id].map(
                async id =>
                    [
                        id,
                        await api<QueryProfile>(`/runs/${encodeURIComponent(id)}/profile`, {
                            signal: controller.signal,
                        }),
                    ] as const,
            ),
        )
            .then(entries => {
                if (!controller.signal.aborted) setLoaded(Object.fromEntries(entries));
            })
            .catch(caught => {
                if (!controller.signal.aborted) setError(message(caught));
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setLoading(false);
                    setRequested(false);
                }
            });
        return () => controller.abort();
    }, [before.id, after.id, requested, queryLogAvailable]);
    const comparison = compareRuns(
        before,
        after,
        loaded[before.id] ?? profiles?.[before.id],
        loaded[after.id] ?? profiles?.[after.id],
    );
    return (
        <>
            <div className="native-toolbar">
                <span className="native-notes">
                    {before.dataSource === 'fixture' ? 'SAMPLE RUNS' : 'RETAINED RUNS'} ·
                    Percentages use the same measurement source on both sides.
                </span>
                <Button disabled={!queryLogAvailable || loading} onClick={() => setRequested(true)}>
                    {loading ? 'Loading query-log evidence…' : 'Load query-log metrics'}
                </Button>
            </div>
            {!queryLogAvailable && (
                <p className="native-notes">
                    Query-log access is unavailable for this connection. Available client metrics
                    are shown instead.
                </p>
            )}
            {error && (
                <p role="alert" className="native-warning">
                    {error}
                </p>
            )}
            <div className="native-comparison-table-scroll">
                <table className="native-comparison-table">
                    <thead>
                        <tr>
                            <th>Metric</th>
                            <th>Before</th>
                            <th>After</th>
                            <th>Change</th>
                        </tr>
                    </thead>
                    <tbody>
                        {comparison.metrics.map(metric => {
                            const delta = comparison.deltasEnabled
                                ? comparisonDelta(metric.before, metric.after)
                                : { text: 'Not comparable', direction: 'unknown' };
                            return (
                                <tr key={metric.label}>
                                    <th scope="row">
                                        {metric.label}
                                        <small>{metric.source}</small>
                                    </th>
                                    <td title={metric.before}>
                                        {metricValue(metric.before, metric.unit)}
                                    </td>
                                    <td title={metric.after}>
                                        {metricValue(metric.after, metric.unit)}
                                    </td>
                                    <td
                                        className={metric.neutral ? '' : `delta-${delta.direction}`}
                                    >
                                        {delta.text}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="native-comparison-columns">
                {[
                    { name: 'Before', run: before },
                    { name: 'After', run: after },
                ].map(({ name, run }) => (
                    <article key={name} className="native-run-summary">
                        <h4>
                            {name} · {run.status}
                        </h4>
                        <time>{nativeTime(run.createdAt)}</time>
                        <code className="native-query-id">{run.queryId}</code>
                        <pre className="native-sql">{run.sql}</pre>
                        <details>
                            <summary>Parameters and limits</summary>
                            <pre className="native-sql">
                                {JSON.stringify(
                                    {
                                        parameters: run.parameters,
                                        limits: run.limits,
                                        serverVersion: run.serverVersion ?? 'Unavailable',
                                    },
                                    null,
                                    2,
                                )}
                            </pre>
                        </details>
                    </article>
                ))}
            </div>
            <details className="native-notes">
                <summary>Comparison context</summary>
                {comparison.warnings.map(warning => (
                    <p key={warning}>{warning}</p>
                ))}
            </details>
            <PipelineComparison before={pipelines?.[before.id]} after={pipelines?.[after.id]} />
        </>
    );
}
export function RunComparisonView(props: RunComparisonProps) {
    const runs = useMemo(() => {
        const all = props.initialRun ? [props.initialRun, ...props.history] : props.history;
        return [
            ...new Map(
                all.filter(run => comparableRun(run, props.connectionId)).map(run => [run.id, run]),
            ).values(),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, [props.history, props.initialRun, props.connectionId]);
    const initialAfter =
        props.initialRun && runs.some(run => run.id === props.initialRun?.id)
            ? props.initialRun.id
            : (runs[0]?.id ?? '');
    const initialBefore = runs.find(run => run.id !== initialAfter)?.id ?? '';
    const [beforeId, setBeforeId] = useState(initialBefore),
        [afterId, setAfterId] = useState(initialAfter);

    useEffect(() => {
        setAfterId(current => (runs.some(run => run.id === current) ? current : initialAfter));
        setBeforeId(current =>
            runs.some(run => run.id === current && run.id !== afterId) ? current : initialBefore,
        );
    }, [afterId, initialAfter, initialBefore, runs]);

    const before = runs.find(run => run.id === beforeId),
        after = runs.find(run => run.id === afterId);
    return runs.length < 2 ? (
        <div className="native-empty">
            Complete two queries on this connection to compare their runs.
        </div>
    ) : (
        <>
            <div className="native-run-pickers">
                {[
                    { name: 'Before', value: beforeId, change: setBeforeId },
                    { name: 'After', value: afterId, change: setAfterId },
                ].map(picker => (
                    <label key={picker.name} className="native-run-picker">
                        <span>{picker.name}</span>
                        <select
                            aria-label={picker.name + ' run'}
                            title={runs.find(run => run.id === picker.value)?.sql}
                            value={picker.value}
                            onChange={event => picker.change(event.target.value)}
                        >
                            {runs.map(run => (
                                <option key={run.id} value={run.id}>
                                    {runOptionLabel(run)}
                                </option>
                            ))}
                        </select>
                    </label>
                ))}
                <Button
                    onClick={() => {
                        setBeforeId(afterId);
                        setAfterId(beforeId);
                    }}
                >
                    Swap ⇄
                </Button>
            </div>
            {before && after && before.id !== after.id ? (
                <ComparisonBody
                    key={JSON.stringify([before.id, after.id])}
                    before={before}
                    after={after}
                    profiles={props.profiles}
                    pipelines={props.pipelines}
                    queryLogAvailable={props.queryLogAvailable}
                />
            ) : (
                <div className="native-empty">Select two different runs.</div>
            )}
        </>
    );
}

function RunComparisonDialog({ onClose, ...props }: RunComparisonProps & { onClose: () => void }) {
    return (
        <NativeExplorerDialog
            title="Compare query runs"
            description="Before / after measurements and saved ClickHouse pipelines"
            onClose={onClose}
        >
            <RunComparisonView {...props} />
        </NativeExplorerDialog>
    );
}

export function RunComparisonLauncher(props: RunComparisonProps) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button
                variant="secondary"
                className="toolbar-small"
                disabled={!props.trusted}
                onClick={() => setOpen(true)}
            >
                Compare runs
            </Button>
            {open && props.trusted && (
                <OverlayPortal>
                    <RunComparisonDialog {...props} onClose={() => setOpen(false)} />
                </OverlayPortal>
            )}
        </>
    );
}
