import { useMemo } from 'react';
import type { QueryDocument, Result, Run } from '../shared/types';
import { parseExplainPlan } from '../shared/explain-plan';
import { parseExplainAnalyze } from '../shared/explain-analyze';
import { parseExplainIndexAnalysis } from '../shared/explain-indexes';
import { parsePipelineResult } from '../shared/profile';
import { matchesDraft } from '../shared/evidence';
import { recommendChart } from '../shared/results';
import { draftSaveStatus } from '../shared/workspace-view';
import type { NativeParseSnapshot } from '../shared/native-parser';
import type { Copy, ExperienceLevel } from './i18n';
import { sqlErrorRangeInDraft } from './sql-error';
import type { Connected, ResultsView } from './workspace-types';
import type { Draft } from './workspace-state';
import {
    resultPanelAriaLabel,
    resultsViewTitle,
    resultsViews,
    safeSelectedStatement,
    safeStatementCount,
    type FailedQueryError,
} from './workspace-helpers';

export function useWorkspaceViewState({
    active,
    connection,
    documents,
    documentsLoaded,
    documentsReadError,
    savingDraftIds,
    history,
    run,
    failedQueryError,
    copy,
    experience,
    view,
    trusted,
    unsupportedParameters,
    nativeParseSnapshot,
    snapshot,
}: {
    active: Draft;
    connection: Connected;
    documents: QueryDocument[];
    documentsLoaded: boolean;
    documentsReadError: boolean;
    savingDraftIds: Record<string, boolean>;
    history: Run[];
    run?: Run;
    failedQueryError?: FailedQueryError;
    copy: Copy;
    experience: ExperienceLevel;
    view: ResultsView;
    trusted: boolean;
    unsupportedParameters: boolean;
    nativeParseSnapshot?: NativeParseSnapshot;
    snapshot?: Result;
}) {
    const sortedHistory = useMemo(() => [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [history]);
    const savedDocument = documents.find(document => document.id === active.serverId);
    const saveStatus = draftSaveStatus(active, connection.id, savedDocument, {
        saving: Boolean(savingDraftIds[active.id]),
        pending: !documentsLoaded,
        readError: documentsReadError,
    });
    const statementCount = safeStatementCount(active.sql);
    const runSourceSql = run && run.sourceFrom !== undefined && run.sourceTo !== undefined && run.sourceTo <= active.sql.length
        ? active.sql.slice(run.sourceFrom, run.sourceTo)
        : safeSelectedStatement(active.sql, active.from, active.to)?.sql;
    const selectedRunStatement = safeSelectedStatement(active.sql, active.from, active.to);
    const runErrorContext = run?.error && (run.sql === active.sql || run.sql === selectedRunStatement?.sql)
        ? { draftId: active.id, draftSql: active.sql, statementSql: run.sql, sourceFrom: run.sourceFrom ?? (run.sql === active.sql ? 0 : selectedRunStatement?.from ?? 0), error: run.error }
        : undefined;
    const requestErrorContext = failedQueryError?.draftId === active.id && failedQueryError.draftSql === active.sql ? failedQueryError : undefined;
    const editorErrorContext = requestErrorContext ?? runErrorContext;
    const editorErrorRange = editorErrorContext
        ? sqlErrorRangeInDraft(active.sql, editorErrorContext.statementSql, editorErrorContext.sourceFrom, editorErrorContext.error)
        : undefined;
    const invalidatedSource = run && active.activeRunId === run.id && active.invalidatedSource?.runId === run.id
        ? active.invalidatedSource
        : undefined;
    const staleResult = Boolean(run && (invalidatedSource || !runSourceSql || run.connectionId !== connection.id || !matchesDraft(run, runSourceSql, active.parameters)));
    const staleResultReason = invalidatedSource
        ? `The source table ${invalidatedSource.database}.${invalidatedSource.table} was deleted after this run.`
        : staleResult ? 'SQL text, selection, or bound parameters changed since this run.' : undefined;
    const requestedResultsView = experience === 'beginner' && view === 'insights' ? 'results' : view;
    const sqlMapStatement = safeSelectedStatement(active.sql, active.from, active.from);
    const queryTreeCapability = connection.manifest?.queryTree ?? connection.manifest?.explain;
    const queryTreeAvailable = trusted && !unsupportedParameters && queryTreeCapability?.available !== false;
    const queryTreeUnavailableReason = !trusted ? copy.common.runActionTrustRequired
        : unsupportedParameters ? connection.manifest?.parameters.reason ?? copy.common.runActionRemoveParameters
            : queryTreeCapability?.reason;
    const sqlMapParseStatement = sqlMapStatement && nativeParseSnapshot?.statements.find(statement =>
        statement.from === sqlMapStatement.from
        && statement.to === sqlMapStatement.to
        && active.sql.slice(statement.from, statement.to) === statement.sql);
    const resultTabs = resultsViews(run, experience);
    const visibleResultsView = resultTabs.includes(requestedResultsView) ? requestedResultsView : 'results';
    const retainedSnapshot = run && snapshot?.runId === run.id ? snapshot : undefined;
    const explainPlanOutput = run?.kind === 'plan' ? retainedSnapshot?.rows[0]?.[0] : undefined;
    const explainPlan = useMemo(() => parseExplainPlan(explainPlanOutput), [explainPlanOutput]);
    const explainIndexRows = run?.kind === 'explain' ? retainedSnapshot?.rows : undefined;
    const explainIndexAnalysis = useMemo(() => explainIndexRows ? parseExplainIndexAnalysis(explainIndexRows) : undefined, [explainIndexRows]);
    const pipelineOutputRows = run?.kind === 'pipeline' ? retainedSnapshot?.rows : undefined;
    const pipelineResult = useMemo(() => pipelineOutputRows
        ? parsePipelineResult(pipelineOutputRows.map(row => row[0]).filter((value): value is string => typeof value === 'string'))
        : undefined, [pipelineOutputRows]);
    const analyzeOutput = run?.kind === 'analyze'
        ? retainedSnapshot?.rows.map(row => row[0]).filter((value): value is string => typeof value === 'string').join('\n')
        : undefined;
    const analyzeEvidence = useMemo(() => parseExplainAnalyze(analyzeOutput), [analyzeOutput]);
    const resultsTitle = resultsViewTitle(visibleResultsView, copy.common);
    const resultsEyebrow = visibleResultsView === 'sqlmap' ? copy.common.queryVisualization : copy.common.workspaceOutput;
    const resultsPanelLabel = resultPanelAriaLabel(visibleResultsView, copy.common);
    const snapshotChart = retainedSnapshot ? recommendChart(retainedSnapshot.columns, retainedSnapshot.rows) : undefined;

    return {
        sortedHistory,
        savedDocument,
        saveStatus,
        statementCount,
        editorErrorContext,
        editorErrorRange,
        staleResult,
        staleResultReason,
        sourceDeleted: Boolean(invalidatedSource),
        requestedResultsView,
        sqlMapStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        sqlMapParseStatement,
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
    };
}

export type WorkspaceViewState = ReturnType<typeof useWorkspaceViewState>;
