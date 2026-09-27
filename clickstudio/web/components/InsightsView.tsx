import { RunComparisonLauncher, type RunComparisonProps } from './RunComparison';
import type { Capability, ProfilePipeline, QueryProfile, Run } from '../../shared/types';
import type { FlamegraphSnapshot, FlamegraphTraceType } from '../../shared/flamegraph';
import { PipelineGraph } from './PipelineGraph';
import { FlamegraphView } from './FlamegraphView';
import { Button, formatBytes, Icon, terminal } from './ui';
import type { IconName } from './ui';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';
import { useState } from 'react';

export function InsightsView({ comparison, run, profile, pipeline, pipelineAvailable, flamegraph, flamegraphCapability, onLoad, onLoadPipeline, onLoadFlamegraph, loading }: { comparison?: RunComparisonProps; run: Run; profile?: QueryProfile; pipeline?: ProfilePipeline; pipelineAvailable: boolean; flamegraph?: FlamegraphSnapshot; flamegraphCapability?: Capability; onLoad: () => void; onLoadPipeline: () => void; onLoadFlamegraph: () => void; loading: boolean }) {
    const [tab, setTab] = useState<'overview' | 'flamegraph'>('overview');
    const [traceType, setTraceType] = useState<FlamegraphTraceType>('CPU');
    const summary = profile?.summary;
    const plan = pipeline ?? profile?.pipeline;
    const hasClickHousePlan = plan?.source === 'explain_pipeline';
    const metrics = [
        { label: 'Execution time', value: `${Math.round(summary?.durationMs ?? run.elapsedMs)} ms`, icon: 'bolt' },
        { label: 'Rows scanned', value: summary?.readRows ? Number(summary.readRows).toLocaleString() : 'Unavailable', icon: 'schema' },
        { label: 'Data read', value: summary?.readBytes ? formatBytes(summary.readBytes) : 'Unavailable', icon: 'details' },
        { label: 'Peak memory', value: summary?.memory ? formatBytes(summary.memory) : 'Unavailable', icon: 'pipeline' },
        { label: 'Rows returned', value: run.rowCount.toLocaleString(), icon: 'chart' },
        { label: 'Result size', value: formatBytes(run.bytes), icon: 'documents' },
    ] satisfies Array<{ label: string; value: string; icon: IconName }>;
    const measuredStages = plan?.nodes.filter(node => node.status === 'measured').length ?? 0;
    const plannedStages = plan?.nodes.filter(node => node.status === 'planned').length ?? 0;
    const estimatedStages = plan?.nodes.filter(node => node.status === 'estimated').length ?? 0;
    const traceTypes = (['CPU', 'Real'] as const).filter(type => flamegraph?.series[type]);
    const selectedTraceType = flamegraph?.series[traceType] ? traceType : traceTypes[0];
    const totalSamples = flamegraph ? flamegraph.samples.CPU + flamegraph.samples.Real : 0;
    const flamegraphAvailable = flamegraphCapability?.available === true;
    return <ScrollEdgeFrame<HTMLDivElement> className="insights-view-frame">{ref => <div ref={ref} className="insights-view animate-enter">
        <div className="insights-mode-tabs" role="tablist" aria-label="Execution insight views">
            <button id="insights-overview-tab" type="button" role="tab" aria-selected={tab === 'overview'} aria-controls="insights-overview-panel" onClick={() => setTab('overview')}>Overview</button>
            <button id="insights-flamegraph-tab" type="button" role="tab" aria-selected={tab === 'flamegraph'} aria-controls="insights-flamegraph-panel" onClick={() => setTab('flamegraph')}>CPU profile</button>
        </div>
        <div id="insights-overview-panel" role="tabpanel" aria-labelledby="insights-overview-tab" hidden={tab !== 'overview'}>
        <div className="insights-heading"><div><span className="eyebrow">EXECUTION INSIGHTS</span><h3>What happened when this ran?</h3><p>Measurements come from this run's execution and ClickHouse query log.</p></div>{!profile && <Button variant="secondary" onClick={onLoad} disabled={loading}>{loading ? 'Loading…' : 'Load execution details'}</Button>}</div>
        {comparison && <RunComparisonLauncher {...comparison}/>}
        <div className="insight-metrics">{metrics.map(metric => <article className="insight-metric" key={metric.label}><span className="insight-icon"><Icon name={metric.icon}/></span><span className="eyebrow">{metric.label}</span><strong>{metric.value}</strong></article>)}</div>
        <section className="run-analysis" aria-label="Run and query plan comparison">
            <div className="run-analysis-heading"><div><span className="eyebrow">RUN + EXPLAIN</span><strong>Measured execution, then its plan</strong></div>{pipelineAvailable && <Button variant="secondary" className="toolbar-small" onClick={onLoadPipeline} disabled={loading}>{loading ? 'Loading…' : hasClickHousePlan ? 'Refresh pipeline' : 'Load ClickHouse pipeline'}</Button>}</div>
            <div className="run-analysis-columns"><article><span className="eyebrow">THIS RUN</span><strong>{Math.round(summary?.durationMs ?? run.elapsedMs)} ms</strong><small>{summary?.readRows ? `${Number(summary.readRows).toLocaleString()} rows scanned` : 'Scan count unavailable'} · {summary?.readBytes ? formatBytes(summary.readBytes) : 'bytes unavailable'}</small><code>{run.queryId}</code></article><article><span className="eyebrow">QUERY PLAN</span><strong>{plan?.nodes.length ?? 0} operators</strong><small>{hasClickHousePlan ? 'EXPLAIN PIPELINE · ClickHouse' : 'Estimated from SQL shape'}</small><small>{plannedStages} planned · {measuredStages} measured · {estimatedStages} estimated</small></article></div>
            {plan ? <><div className="run-analysis-stages" aria-label="Pipeline stages">{plan.nodes.slice(0, 8).map((node, index) => <span key={node.id}><i>{String(index + 1).padStart(2, '0')}</i><strong>{node.label}</strong><small>{node.status}</small></span>)}{plan.nodes.length > 8 && <small>+{plan.nodes.length - 8} more operators</small>}</div><p className="profile-note">{plan.notice}</p><PipelineGraph pipeline={plan}/></> : <div className="pipeline-graph-empty">{pipelineAvailable ? 'Load the ClickHouse pipeline to inspect its operators and data flow.' : 'Pipeline graph evidence is unavailable for this connection.'}</div>}
        </section>
        {profile?.insights.length ? <div className="insight-list">{profile.insights.map(insight => <article key={insight.id} className={`insight-card severity-${insight.severity}`}><span className="insight-severity">{insight.severity}</span><div><strong>{insight.title}</strong><p>{insight.description}</p></div></article>)}</div> : profile ? <div className="profile-empty">No deterministic issue was identified in the available evidence.</div> : <p className="profile-note">Query log details can take a short time to appear after execution. Values marked unavailable are not inferred.</p>}
        {profile?.notice && <p className="profile-note">{profile.notice}</p>}
        </div>
        <section id="insights-flamegraph-panel" className="insights-flamegraph-panel" role="tabpanel" aria-labelledby="insights-flamegraph-tab" hidden={tab !== 'flamegraph'}>
            <div className="flamegraph-heading"><div><span className="eyebrow">RUN-SCOPED PROFILER SAMPLES</span><h3>CPU profile</h3><p>Call stacks recorded for query <code>{run.queryId}</code>.</p></div>
                {flamegraph && traceTypes.length > 1 && <div className="parts-view-control flamegraph-trace-types" role="group" aria-label="Trace sample type">{traceTypes.map(type => <button key={type} type="button" aria-pressed={selectedTraceType === type} onClick={() => setTraceType(type)}>{type === 'CPU' ? 'CPU time' : 'Wall time'}</button>)}</div>}
                {!flamegraph && flamegraphAvailable && <Button variant="secondary" onClick={onLoadFlamegraph} disabled={loading || !terminal(run)} title={!terminal(run) ? 'Wait for the query to finish before loading profiler samples.' : undefined}>{loading ? 'Loading…' : 'Load profile'}</Button>}
            </div>
            {!flamegraphAvailable
                ? <div className="observability-state" role="status"><strong>Profiler samples are unavailable for this connection.</strong><p>{flamegraphCapability?.reason ?? 'Test the connection to check access to system.trace_log symbol data.'}</p></div>
                : !terminal(run)
                    ? <div className="observability-state" role="status">Wait for this execution to finish before loading its profile.</div>
                    : !flamegraph
                        ? <div className="observability-state"><strong>Inspect sampled ClickHouse call stacks for this run.</strong><p>Samples depend on the server’s trace-log sampling settings and may appear after a short flush delay.</p></div>
                        : totalSamples === 0
                            ? <div className="observability-empty"><span className="observability-empty-mark">⌁</span><strong>No profiler samples were recorded for this execution.</strong><p>ClickHouse may not have sampled this query during its run.</p></div>
                            : flamegraph.symbolizedSamples === 0
                                ? <div className="observability-empty"><span className="observability-empty-mark">⌁</span><strong>Samples exist, but no symbolized stacks were recorded.</strong><p>Enable trace-log symbol collection on the ClickHouse server to render the call tree.</p></div>
                                : selectedTraceType && flamegraph.series[selectedTraceType]
                                    ? <><FlamegraphView key={`${run.id}:${selectedTraceType}`} series={flamegraph.series[selectedTraceType]!}/>{flamegraph.truncated && <p className="observability-footnote">The flamegraph was bounded to the most frequent sampled stacks.</p>}</>
                                    : <div className="observability-empty"><strong>No {traceType === 'CPU' ? 'CPU' : 'wall-clock'} samples were recorded.</strong><p>Choose the other sample type if it is available.</p></div>}
        </section>
    </div>}</ScrollEdgeFrame>;
}
