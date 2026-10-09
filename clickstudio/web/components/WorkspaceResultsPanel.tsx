import { useState } from 'react';
import type { ProfilePipeline, QueryProfile, ResultPage, Run, Script } from '../../shared/types';
import type { FlamegraphSnapshot } from '../../shared/flamegraph';
import type { NativeParseSnapshot, NativeParserStatus } from '../../shared/native-parser';
import type { Copy, ExperienceLevel, Locale } from '../i18n';
import type { BusyAction, Connected, ResultsView } from '../workspace-types';
import type { Draft } from '../workspace-state';
import type { FailedQueryError } from '../workspace-helpers';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../cloud-connection';
import type { WorkspacePanelController } from '../useWorkspacePanels';
import type { WorkspaceViewState } from '../useWorkspaceViewState';
import { ChartView, GeoView, InsightsView, ResultGrid } from './ResultViews';
import { ExplainAnalyzeView } from './ExplainAnalyzeView';
import { ExplainIndexesView } from './ExplainIndexesView';
import { ExplainPlanView } from './ExplainPlanView';
import { PipelineGraph } from './PipelineGraph';
import { SqlFlowView } from './SqlFlowView';
import { Button, cx, Icon, Status } from './ui';
import { ScriptResults } from './WorkspaceChrome';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';
import { QueryFailureNotice } from './QueryFailureNotice';
import { resultsTabLabel } from '../workspace-helpers';

export type WorkspaceResultsPanelState = Readonly<{
    active: Draft;
    connection: Connected;
    copy: Copy;
    locale: Locale;
    run?: Run;
    failedAttempt?: FailedQueryError;
    script?: Script;
    history: Run[];
    page: number;
    resultPage?: ResultPage;
    profile?: QueryProfile;
    pipeline?: ProfilePipeline;
    flamegraph?: FlamegraphSnapshot;
    profilesByRun: Readonly<Record<string, QueryProfile>>;
    pipelinesByRun: Readonly<Record<string, ProfilePipeline>>;
    nativeParserEnabled: boolean;
    nativeParserStatus: NativeParserStatus;
    nativeParseSnapshot?: NativeParseSnapshot;
    trusted: boolean;
    busy: BusyAction;
    execution?: Readonly<{ sql: string }>;
    retainedExecutionResult?: Readonly<{ run: Run; page: ResultPage; pageIndex: number }>;
    cancelling: boolean;
    experience: ExperienceLevel;
}>;

export type WorkspaceResultsPanelActions = Readonly<{
    onSelectView: (view: ResultsView) => void;
    onSelectScriptRun: (runId: string) => void;
    onOpenDetached: () => void;
    onDockDetached: () => void;
    onCancel: () => void;
    onPage: (page: number) => void;
    onPatch: (values: Partial<Draft>) => void;
    onLoadProfile: () => void;
    onLoadPipeline: () => void;
    onLoadFlamegraph: () => void;
    onRevealRange: (from: number, to: number) => void;
}>;

export function WorkspaceResultsPanel({
    state,
    actions,
    panels,
    viewState,
    detached = false,
}: {
    state: WorkspaceResultsPanelState;
    actions: WorkspaceResultsPanelActions;
    panels: WorkspacePanelController;
    viewState: WorkspaceViewState;
    detached?: boolean;
}) {
    const [tableToolbar, setTableToolbar] = useState<HTMLDivElement | null>(null);
    const {
        active,
        connection,
        copy,
        locale,
        run,
        failedAttempt,
        script,
        history,
        page,
        resultPage,
        profile,
        pipeline,
        flamegraph,
        profilesByRun,
        pipelinesByRun,
        nativeParserEnabled,
        nativeParserStatus,
        nativeParseSnapshot,
        trusted,
        busy,
        execution,
        retainedExecutionResult,
        cancelling,
        experience,
    } = state;
    const {
        resultTabs,
        visibleResultsView,
        retainedSnapshot,
        explainPlan,
        explainIndexAnalysis,
        pipelineResult,
        analyzeEvidence,
        resultsTitle,
        resultsEyebrow,
        resultsPanelLabel,
        snapshotChart,
        sqlMapStatement,
        sqlMapParseStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        staleResult,
        staleResultReason,
        sourceDeleted,
    } = viewState;
    const { resultsPanelRef } = panels;

    const showPreviousResult = Boolean(execution && retainedExecutionResult && visibleResultsView === 'results');
    const resultsRun = showPreviousResult ? retainedExecutionResult!.run : run;
    const resultsPage = showPreviousResult ? retainedExecutionResult!.page : resultPage;
    const resultsPageIndex = showPreviousResult ? retainedExecutionResult!.pageIndex : page;
    const executionSql = execution?.sql.replace(/\s+/g, ' ').trim();
    const executionSqlPreview = executionSql && executionSql.length > 180 ? `${executionSql.slice(0, 177).trimEnd()}…` : executionSql;
    const failedScriptStatement = script?.statements.find(statement => statement.status === 'failed' && statement.error);
    const failureError = failedAttempt?.error ?? failedScriptStatement?.error ?? (run?.status === 'failed' ? run.error : undefined);
    const failureSql = failedAttempt?.statementSql ?? failedScriptStatement?.sql ?? (run?.status === 'failed' ? run.sql : undefined);
    const previousSuccessfulResult = Boolean((failedAttempt || (failedScriptStatement && !failedScriptStatement.runId)) && run?.resultState === 'reopenable' && run.status !== 'failed');
    const resultProvenance = visibleResultsView !== 'sqlmap' && !execution
        ? previousSuccessfulResult
            ? { description: copy.common.previousResultsDescription, failed: true }
            : !failedAttempt && staleResult
                ? { description: staleResultReason ?? 'SQL text, selection, or bound parameters changed since this run.', sourceDeleted }
                : undefined
        : undefined;

    if (!run && !execution && !failedAttempt && !failedScriptStatement && visibleResultsView !== 'sqlmap' && !detached) return null;

    return <section
        ref={resultsPanelRef}
        className={cx('results-surface', experience === 'expert' && 'results-expert', panels.resultsCollapsed && 'is-collapsed')}
        aria-label={resultsPanelLabel}
    >
        <div className="results-header">
            <div className="results-title">
                <span className="results-mark"><Icon name={visibleResultsView === 'sqlmap' || visibleResultsView === 'pipeline' || visibleResultsView === 'indexes' || visibleResultsView === 'runtime' ? 'pipeline' : 'chart'}/></span>
                <div><span className="eyebrow">{resultsEyebrow}</span><h2>{resultsTitle}</h2></div>
                {detached && panels.resultsCollapsed && failureError && visibleResultsView !== 'sqlmap'
                    ? <span className="result-execution-header" data-run-status="failed" role="status"><span className="status-light is-error"/>{copy.common.queryFailed}</span>
                    : detached && panels.resultsCollapsed && execution && visibleResultsView !== 'sqlmap'
                    ? <span className="result-execution-header"><span className="loading-orbit" aria-hidden="true"/>{copy.common.statusRunning}</span>
                    : detached && !failureError && !execution && run && visibleResultsView !== 'sqlmap' && <Status run={run} copy={copy.common}/>}
                {resultProvenance && <span
                    className={cx('result-provenance-header', resultProvenance.failed && 'is-failed-attempt', resultProvenance.sourceDeleted && 'is-source-deleted')}
                    role="status"
                    aria-live="polite"
                    aria-label={resultProvenance.description}
                    title={resultProvenance.description}
                >
                    <span className="status-light is-warning" aria-hidden="true"/>
                    <strong>{resultProvenance.failed ? copy.common.previousResults : 'Previous result'}</strong>
                    {!resultProvenance.failed && <small>{resultProvenance.description}</small>}
                </span>}
            </div>
            <div className="results-actions">
                {run && resultTabs.length > 1 && <div className="results-tabs" role="tablist" aria-label={copy.common.workspaceOutput}>{resultTabs.map(tab => <button key={tab} role="tab" aria-selected={visibleResultsView === tab} type="button" onClick={() => actions.onSelectView(tab)}>{resultsTabLabel(tab, copy.common)}{tab === 'chart' && retainedSnapshot && <span className="suggested-dot"/>}</button>)}</div>}
                <div ref={setTableToolbar} className="results-table-tools" hidden={panels.resultsCollapsed}/>
                {detached
                    ? <Button variant="ghost" className="panel-window-button" aria-label={copy.common.dockResultsPanel} title={copy.common.dockResultsPanel} onClick={actions.onDockDetached}><Icon name="dock"/></Button>
                    : !panels.compactViewport && <Button variant="ghost" className="panel-window-button" aria-label={copy.common.openResultsInNewWindow} title={copy.common.openResultsInNewWindow} onClick={actions.onOpenDetached}><Icon name="newWindow"/></Button>}
                <Button variant="ghost" className="panel-collapse-button" aria-label={`${panels.resultsCollapsed ? copy.common.expand : copy.common.collapse} ${resultsPanelLabel}`} aria-expanded={!panels.resultsCollapsed} aria-controls="query-results-content" title={panels.resultsCollapsed ? copy.common.expandOutput : copy.common.collapseOutput} onClick={() => panels.setResultsCollapsed(value => !value)}><Icon className="panel-toggle-icon" name="chevron"/></Button>
            </div>
        </div>
        <ScrollEdgeFrame<HTMLDivElement> className="results-content-frame" hidden={panels.resultsCollapsed}>{ref => <div id="query-results-content" ref={ref} className={cx('panel-content results-content', ['insights', 'indexes', 'plan', 'pipeline', 'runtime'].includes(visibleResultsView) && 'results-content-scrollable')} hidden={panels.resultsCollapsed}>
            {detached && !run && !execution && !failedAttempt && visibleResultsView !== 'sqlmap' && <div className="detached-results-empty"><Icon name="chart"/><span>{copy.common.detachedResultsEmpty}</span></div>}
            {visibleResultsView === 'sqlmap' && <SqlFlowView copy={copy.common} sql={sqlMapStatement?.sql ?? active.sql} sourceOffset={sqlMapStatement?.from ?? 0} parseResult={sqlMapParseStatement?.result} parserEnabled={nativeParserEnabled} parserStatus={nativeParserStatus} parseDurationMs={nativeParseSnapshot?.elapsedMs} connectionId={connection.id} parameters={active.parameters} analyzerAvailable={queryTreeAvailable} analyzerUnavailableReason={queryTreeUnavailableReason} onRevealRange={actions.onRevealRange}/>}
            {failureError && visibleResultsView !== 'sqlmap' && <QueryFailureNotice
                key={`${failureError.code}:${failureError.message}:${failureSql}`}
                error={failureError} sql={failureSql} copy={copy.common}
                errorRange={viewState.editorErrorContext?.error === failureError ? viewState.editorErrorRange : undefined}
                draftSql={active.sql} onRevealRange={actions.onRevealRange}
            />}
            {execution && visibleResultsView !== 'sqlmap' && <div className={cx('result-execution-progress', !showPreviousResult && 'is-initial')} aria-busy="true">
                <div className="result-execution-heading"><span className="loading-orbit" aria-hidden="true"/><span role="status" aria-live="polite">{copy.common.statusRunning}</span><strong className="result-execution-query" title={active.name}>{active.name}</strong>{showPreviousResult && <span className="result-execution-previous">Previous result</span>}</div>
                <pre className="result-execution-sql is-preview">{executionSqlPreview}</pre>
                {execution.sql.length > 180 && <details className="result-execution-details"><summary>{copy.common.expandQuery}</summary><pre className="result-execution-sql is-full">{execution.sql}</pre></details>}
            </div>}
            {visibleResultsView === 'results' && script && <ScriptResults script={script} runs={history} activeRunId={run?.id} onSelectRun={actions.onSelectScriptRun} onCancel={actions.onCancel} cancelDisabled={cancelling} cancelAfterCurrentStatement={connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID}/>}
            {resultsRun && !(failureError && resultsRun.resultState !== 'reopenable') && visibleResultsView === 'results' && (!execution || showPreviousResult) && <ResultGrid key={resultsRun.id} run={resultsRun} page={resultsPage} pageIndex={resultsPageIndex} loading={!resultsPage && resultsRun.resultState === 'reopenable'} onPage={actions.onPage} showPagination={!showPreviousResult} obscured={showPreviousResult} toolbarContainer={tableToolbar}/>}
            {run && visibleResultsView === 'indexes' && <ExplainIndexesView analysis={explainIndexAnalysis} loading={!retainedSnapshot && run.resultState === 'reopenable'} copy={copy.common}/>}
            {run && visibleResultsView === 'plan' && <ExplainPlanView plan={explainPlan} loading={!retainedSnapshot && run.resultState === 'reopenable'} copy={copy.common}/>}
            {run && visibleResultsView === 'pipeline' && (pipelineResult
                ? <PipelineGraph pipeline={pipelineResult} copy={copy.common} heading={copy.common.pipelineGraph} subheading={copy.common.pipelineGraphDescription}/>
                : <div className="pipeline-graph-empty" role="status">{copy.common.pipelineNoOutput}</div>)}
            {run && visibleResultsView === 'runtime' && <ExplainAnalyzeView evidence={analyzeEvidence} loading={!retainedSnapshot && run.resultState === 'reopenable'} copy={copy.common}/>}
            {run && visibleResultsView === 'chart' && snapshotChart?.config.kind === 'table'
                ? <div className="chart-table-fallback"><div className="chart-table-notice" role="status">{copy.chart.fallbackNoMeasure}</div><ResultGrid key={`${run.id}-chart-table`} run={run} page={resultPage} pageIndex={page} loading={!resultPage && run.resultState === 'reopenable'} onPage={actions.onPage} toolbarContainer={tableToolbar}/></div>
                : run && visibleResultsView === 'chart' && <ChartView result={retainedSnapshot} loading={!retainedSnapshot && run.resultState === 'reopenable'} chart={active.chart} onChart={chart => actions.onPatch({ chart })} copy={copy} locale={locale}/>}
            {run && visibleResultsView === 'map' && <GeoView result={retainedSnapshot} loading={!retainedSnapshot && run.resultState === 'reopenable'} locale={locale}/>}
            {run && visibleResultsView === 'insights' && <InsightsView comparison={{ connectionId: connection.id, trusted, history, initialRun: run, profiles: profilesByRun, pipelines: pipelinesByRun, queryLogAvailable: connection.manifest?.queryLog.available === true }} run={run} profile={profile} pipeline={pipeline} pipelineAvailable={Boolean(trusted && connection.manifest?.pipeline.available)} flamegraph={flamegraph} flamegraphCapability={trusted ? connection.manifest?.traceLog : { available: false, reason: 'Trust this connection to inspect profiler samples.' }} onLoad={actions.onLoadProfile} onLoadPipeline={actions.onLoadPipeline} onLoadFlamegraph={actions.onLoadFlamegraph} loading={busy === 'save'}/>}
        </div>}</ScrollEdgeFrame>
    </section>;
}
