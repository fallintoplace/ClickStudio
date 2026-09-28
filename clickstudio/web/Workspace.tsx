import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import type { ProfilePipeline, QueryDocument, QueryProfile, Result, Run, RunKind, Schema, SchemaTable, Script } from '../shared/types';
import { DEFAULT_LIMITS } from '../shared/types';
import { exportCsv, recommendChart } from '../shared/results';
import { parameterNames, selectedStatement, splitSql } from '../shared/sql';
import { sqlReferencesQualifiedTable } from '../shared/table-deletion';
import { api, download, isFrontendDemoPreview, message, post } from './api';
import { PLAYGROUND_CONNECTION_ID } from './playground';
import type { EditorHandle } from './components/SqlEditor';
import { ImportWizard } from './components/ImportWizard';
import { ExportDialog } from './components/ExportDialog';
import { WorkspaceHelpPanel, type HelpPanelSection } from './components/WorkspaceHelpPanel';
import { HelpButton } from './components/HelpButton';
import { RestoreSqlMenu } from './components/RestoreSqlMenu';
import { OverlayPortal } from './components/OverlayPortal';
import { ObservabilityExplorer } from './components/ObservabilityExplorer';
import { InspectorPane, type InspectorPaneProps } from './components/InspectorPane';
import { Button, cx, Icon, inspectorLabel, terminal } from './components/ui';
import { ExecutionBar, RailButton } from './components/WorkspaceChrome';
import { WorkspaceDocumentTabs } from './components/WorkspaceDocumentTabs';
import { WorkspaceQueryPanel } from './components/WorkspaceQueryPanel';
import { EXPERT_BROWSE_NAVIGATION, EXPERT_EXECUTION_NAVIGATION, PRIMARY_INSPECTOR_NAVIGATION } from './inspector-navigation';
import { DetachedQueryPlaceholder } from './components/DetachedQueryPlaceholder';
import { DetachedResultsPlaceholder } from './components/DetachedResultsPlaceholder';
import { WorkspaceResultsPanel } from './components/WorkspaceResultsPanel';
import { WorkspacePanelSplitter } from './components/WorkspacePanelSplitter';
import { checkpoint, closeDraft, draftFromDocument, MAX_TABS, newDraft, reopenDraft, type Draft } from './workspace-state';
import { rememberRunIds, sameSavedContent } from '../shared/workspace-view';
import type { NativeParseSnapshot, NativeParserStatus } from '../shared/native-parser';
import type { FlamegraphSnapshot } from '../shared/flamegraph';
import { useWorkspacePersistence } from './useWorkspacePersistence';
import { useRunEvidence } from './useRunEvidence';
import { useResultSnapshot } from './useResultSnapshot';
import { useWorkspaceTabs } from './useWorkspaceTabs';
import { useWorkspaceData } from './useWorkspaceData';
import { isSchemaChangingSql, useImportedTableReveal } from './useImportedTableReveal';
import { useDefaultAssistantRunContext, useWorkspaceAssistant } from './useWorkspaceAssistant';
import { useWorkspacePanels } from './useWorkspacePanels';
import { useScopedValue } from './useScopedValue';
import { useScriptExecution } from './useScriptExecution';
import { usePendingExecution } from './usePendingExecution';
import { useFailedQueryErrors } from './useFailedQueryErrors';
import { sqlExamplesFor, type SqlExample } from './sql-examples';
import { localizeSqlExample } from './sql-examples-locales';
import type { Copy, ExperienceLevel, Locale } from './i18n';
import type {
    BusyAction,
    Connected,
    Inspector,
    ResultsView,
    WorkspaceActionRef,
    WorkspaceRunCapability,
    WorkspaceRunCapabilityAction,
} from './workspace-types';
import { initialWorkspaceState, workspaceStateKey } from './workspace-initial-state';
import type { WorkspaceState } from './workspace-state';

import {
    apiErrorDetail,
    focusEditor,
    helpParseDuration,
    helpParseResult,
    helpQueryLogAvailable,
    helpStatementOffset,
    helpStatementSql,
    insertEditorText,
    revealEditorRange,
    safeStatementCount,
    type FailedQueryError,
} from './workspace-helpers';
import { useWorkspaceNotifications, WORKSPACE_TOAST_TIMEOUT_MS } from './useWorkspaceNotifications';
import { useWorkspaceViewState } from './useWorkspaceViewState';
import { useDetachedQueryEditor } from './useDetachedQueryEditor';
import { useDetachedResultsPanel } from './useDetachedResultsPanel';
import { useWorkspaceSqlFormatter } from './useWorkspaceSqlFormatter';
import { useWorkspaceDocumentSave } from './useWorkspaceDocumentSave';

type WorkspaceProps = Readonly<{
    connection: Connected;
    connectionLabel: string;
    connections: readonly Connected[];
    onSelectConnection: (id: Connected['id']) => void;
    onRefreshConnections: () => Promise<void>;
    trustActionRef: WorkspaceActionRef;
    testConnectionActionRef: WorkspaceActionRef;
    demoMode: boolean;
    experience: ExperienceLevel;
    nativeParserEnabled: boolean;
    dark: boolean;
    copy: Copy;
    locale: Locale;
}>;

async function loadAssistantRunContext(run: Run | undefined, snapshot: Result | undefined, signal: AbortSignal) {
    if (!run || !terminal(run)) throw new Error('Wait for the latest run to finish before including it.');
    const result = run.resultState === 'reopenable'
        ? snapshot?.runId === run.id ? snapshot : await api<Result>(`/runs/${encodeURIComponent(run.id)}/snapshot`, { signal })
        : undefined;
    signal.throwIfAborted();
    return { result, evidenceSql: run.sql, error: run.error?.message };
}

function openImportedSqlQuery(name: string, sql: string, openDraft: (draft: Draft) => boolean, markImported: (id: string) => void, setNotice: (notice: string) => void) {
    const draft = newDraft(name, sql);
    const opened = openDraft(draft);
    if (opened) { markImported(draft.id); setNotice(`${name} opened in a new query tab. It has not been run.`); }
    return opened;
}

function createExampleDraft(example: SqlExample, locale: Locale, copy: Copy['common']) {
    const name = example.category === 'schema'
        ? copy.examplePreviewTable.replace('{table}', example.name.replace(/^Preview /, ''))
        : localizeSqlExample(example, locale).name;
    const draft = newDraft(`${name}.sql`, example.sql);
    draft.chart = { ...example.chart, title: locale === 'en' ? example.chart.title : name, ys: [...example.chart.ys], ...(example.chart.candlestick ? { candlestick: { ...example.chart.candlestick } } : {}) };
    return draft;
}

function workspaceAfterTableDeleted(state: WorkspaceState, table: Pick<SchemaTable, 'database' | 'name'>): WorkspaceState {
    return { ...state, tabs: state.tabs.map(draft => draft.activeRunId && sqlReferencesQualifiedTable(draft.sql, table.database, table.name)
        ? { ...draft, invalidatedSource: { database: table.database, table: table.name, runId: draft.activeRunId } }
        : draft) };
}

function activateMatchingPreviewDraft(
    tabs: readonly Draft[],
    name: string,
    sql: string,
    activate: (draftId: string) => void,
    runPreview: (draft: Draft) => void,
) {
    const existing = tabs.find(draft => draft.name === name && draft.sql === sql);
    if (!existing) return false;
    activate(existing.id);
    runPreview(existing);
    return true;
}

type WorkspaceRunActionTitleContext = Readonly<{
    trusted: boolean;
    busy: BusyAction;
    unsupportedParameters: boolean;
    connection: Connected;
    copy: Copy['common'];
}>;

function workspaceRunActionTitle(
    capability: WorkspaceRunCapability | undefined,
    action: WorkspaceRunCapabilityAction,
    { trusted, busy, unsupportedParameters, connection, copy }: WorkspaceRunActionTitleContext,
) {
    if (!trusted) return copy.runActionTrustRequired;
    if (busy) return copy.runActionWait;
    if (unsupportedParameters) return copy.runActionRemoveParameters;
    if (capability?.available === false) {
        if (action === 'script' && connection.id === PLAYGROUND_CONNECTION_ID) return copy.playgroundScriptUnavailable;
        return capability.reason;
    }
    if (action === 'explain-analyze') return copy.runtimeExecutesQuery;
    return undefined;
}

function useSchemaRefreshAfterDdl(run: Run | undefined, connectionId: string, refreshAfterRun: (draftId: string, runId: string, baseline?: ReadonlySet<string>) => void) {
    const pending = useRef(new Map<string, { draftId: string; baseline?: ReadonlySet<string> }>());
    const track = useCallback((runId: string, draftId: string, baseline?: ReadonlySet<string>) => {
        pending.current.set(runId, { draftId, baseline });
    }, []);
    useEffect(() => {
        if (!run || run.connectionId !== connectionId || !terminal(run)) return;
        const refresh = pending.current.get(run.id);
        if (!refresh) return;
        pending.current.delete(run.id);
        if (run.status === 'succeeded' && isSchemaChangingSql(run.sql)) refreshAfterRun(refresh.draftId, run.id, refresh.baseline);
    }, [connectionId, refreshAfterRun, run]);
    return track;
}

export function Workspace({ connection, connectionLabel, connections, onSelectConnection, onRefreshConnections, trustActionRef, testConnectionActionRef, demoMode, experience, nativeParserEnabled, dark, copy, locale }: WorkspaceProps) {
    const key = workspaceStateKey(connection.id);
    const [workspace, setWorkspace] = useState(() => initialWorkspaceState(connection.id));
    const workspaceRef = useRef(workspace);
    workspaceRef.current = workspace;
    const {
        active, tabScrollerRef, tabScrollState, updateTabScrollState, scrollTabs,
        renamingTabId, tabRenameValue, setTabRenameValue,
        beginTabRename, finishTabRename: updateTabRename, cancelTabRename,
    } = useWorkspaceTabs(workspace, setWorkspace);
    const emptySqlActionRef = useRef<HTMLButtonElement>(null);
    const previousTabCount = useRef(workspace.tabs.length);
    useEffect(() => {
        const closedLastTab = previousTabCount.current > 0 && workspace.tabs.length === 0;
        previousTabCount.current = workspace.tabs.length;
        if (!closedLastTab) return;
        const frame = window.requestAnimationFrame(() => emptySqlActionRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [workspace.tabs.length]);
    const activeRunId = active.activeRunId;
    const activeRunIdRef = useRef(activeRunId);
    activeRunIdRef.current = activeRunId;
    const editor = useRef<EditorHandle>(null);
    const [nativeParserStatus, setNativeParserStatus] = useState<NativeParserStatus>('loading');
    const [nativeParseSnapshot, setNativeParseSnapshot] = useState<NativeParseSnapshot>();
    const [savingDraftIds, setSavingDraftIds] = useState<Record<string, boolean>>({});
    const [scripts, setScripts] = useState<Record<string, Script>>({});
    const script = active.scriptId ? scripts[active.scriptId] : undefined;
    const [draftView, setViewForDraft] = useScopedValue<ResultsView>(active.id);
    const view = draftView ?? 'results';
    const setView = useCallback<Dispatch<SetStateAction<ResultsView>>>(next => {
        setViewForDraft(active.id, current => typeof next === 'function' ? next(current ?? 'results') : next, true);
    }, [active.id, setViewForDraft]);
    const [exampleChartRunId, setExampleChartRunId] = useState<string>();
    const [inspector, setInspector] = useState<Inspector>('schema');
    const inspectorRef = useRef(inspector);
    inspectorRef.current = inspector;
    const [compactViewport, setCompactViewport] = useState(() => window.matchMedia('(max-width: 850px)').matches);
    const [drawerOpen, setDrawerOpen] = useState(() => experience === 'expert' && !window.matchMedia('(max-width: 850px)').matches);
    const [importOpen, setImportOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [helpPanelOpen, setHelpPanelOpen] = useState(false);
    const [observabilityOpen, setObservabilityOpen] = useState(false);
    const [helpPanelSection, setHelpPanelSection] = useState<HelpPanelSection>('tour');
    const helpPanelOpenerRef = useRef<HTMLButtonElement | null>(null);
    const openHelpPanel = useCallback((section: HelpPanelSection, opener: HTMLButtonElement) => {
        helpPanelOpenerRef.current = opener;
        setHelpPanelSection(section);
        setHelpPanelOpen(true);
    }, []);
    const closeHelpPanel = useCallback((restoreFocus = true) => {
        setHelpPanelOpen(false);
        if (restoreFocus) window.requestAnimationFrame(() => helpPanelOpenerRef.current?.focus());
    }, []);
    const openExamples = useCallback((opener: HTMLButtonElement) => openHelpPanel('examples', opener), [openHelpPanel]);
    const openHelp = useCallback((opener: HTMLButtonElement) => openHelpPanel('tour', opener), [openHelpPanel]);
    const [busy, setBusy] = useState<BusyAction>('');
    const [cancelling, setCancelling] = useState(false);
    const { error, setError, notice, setNotice } = useWorkspaceNotifications();
    const executionFailureRef = useRef(false);
    const executionInFlightRef = useRef(false);
    const { error: failedQueryError, clear: clearFailedQueryError, record: storeFailedQueryError } = useFailedQueryErrors(active.id);
    const [search, setSearch] = useState('');
    const storageError = useWorkspacePersistence(key, workspace);
    const parameters = useMemo(() => {
        try { return parameterNames(active.sql); } catch { return []; }
    }, [active.sql]);
    const unsupportedParameters = parameters.length > 0 && connection.manifest?.parameters.available === false;
    const runActionTitle = (capability: WorkspaceRunCapability | undefined, action: WorkspaceRunCapabilityAction): string | undefined =>
        workspaceRunActionTitle(capability, action, { trusted, busy, unsupportedParameters, connection, copy: copy.common });
    const currentConnection = connections.find(item => item.id === connection.id) ?? connection;
    const trusted = currentConnection.trusted;

    const {
        assistantQuestion,
        changeAssistantQuestion,
        assistantChats, activeAssistantChatId, assistantTurns, assistantChatStorageError,
        newAssistantChat, selectAssistantChat, renameAssistantChat, deleteAssistantChat,
        assistantBusy,
        assistantCancelable,
        assistantPhase,
        assistantError,
        assistantNotice,
        includeRun,
        setIncludeRun,
        requestAssistantSql,
        cancelAssistantRequest,
        decideAssistantProposal,
    } = useWorkspaceAssistant({
        active,
        activeRunId,
        connectionId: connection.id,
        trusted,
        workspaceRef,
        setWorkspace,
    });
    const {
        schema, schemaLoading, schemaError, serverVersion: playgroundServerVersion, serverVersionLoading: playgroundServerVersionLoading,
        documents, setDocuments, documentsLoaded, documentsReadError,
        documentRevisions, revisionsDocumentId, revisionLoading, revisionError,
        history, loadHistory, loadDocuments, loadDocumentRevisions, loadSchema, schemaLoadingMore, loadMoreSchema,
    } = useWorkspaceData({
        connectionId: connection.id,
        trusted,
        activeServerId: active.serverId,
        setWorkspace,
        workspaceRef,
        setError,
    });
    const importedReveal = useImportedTableReveal({
        connectionId: connection.id, demoMode,
        canRevealSqlTables: connection.dataSource === 'clickhouse' && connection.readonly === false,
        loadSchema, setSearch, setInspector, setDrawerOpen,
        openInspectorDrawer: true, setNotice,
    });
    const sqlExamples = useMemo(() => sqlExamplesFor(connection, schema), [connection, schema]);
    useEffect(() => {
        if (inspector === 'revisions') void loadDocumentRevisions(active.serverId);
    }, [active.serverId, inspector, loadDocumentRevisions]);

    useEffect(() => {
        const media = window.matchMedia('(max-width: 850px)');
        const update = () => {
            setCompactViewport(media.matches);
            if (experience === 'expert') setDrawerOpen(!media.matches);
            else if (!media.matches) setDrawerOpen(false);
        };
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, [experience]);
    const cancellingRef = useRef(false);

    useEffect(() => { setDrawerOpen(experience === 'expert' && !window.matchMedia('(max-width: 850px)').matches); }, [experience]);

    const update = useCallback((id: string, change: (draft: Draft) => Draft) => {
        setWorkspace(current => ({ ...current, tabs: current.tabs.map(draft => draft.id === id ? change(draft) : draft) }));
    }, []);
    const patch = useCallback((values: Partial<Draft>) => update(active.id, draft => ({ ...draft, ...values })), [active.id, update]);
    const formatActiveSql = useWorkspaceSqlFormatter(active, setWorkspace, editor, nativeParserEnabled, nativeParserStatus);

    const { run, setRunForRun, page, setPage, resultPage, snapshot, setSnapshotForRun, profile, setProfileForRun, pipeline, setPipelineForRun, flamegraph, setFlamegraphForRun, profilesByRun, pipelinesByRun, eventState } = useRunEvidence({
        activeRunId,
        connectionId: connection.id,
        loadHistory,
        setError,
    });
    const trackSchemaRefresh = useSchemaRefreshAfterDdl(run, connection.id, importedReveal.refreshAfterImportedSqlRun);
    const selectableRunId = run && terminal(run) ? run.id : undefined;
    useDefaultAssistantRunContext(selectableRunId, includeRun, assistantBusy, setIncludeRun);
    const pendingExecution = usePendingExecution({ activeDraftId: active.id, busy, run, script });
    const scriptFollowRef = useScriptExecution({
        scriptId: active.scriptId,
        draftId: active.id,
        updateDraft: update,
        setScripts,
        loadHistory,
        setError,
        onComplete: importedReveal.refreshAfterImportedSqlScript,
    });

    const perform = async (task: () => Promise<void>, kind: BusyAction = 'save') => {
        if (busy) return;
        setBusy(kind); setError(''); setNotice('');
        try { await task(); }
        catch (caught) {
            if (executionFailureRef.current) {
                executionFailureRef.current = false;
                setError(`${copy.common.statusFailed} · ${copy.common.queryResults}`);
            } else setError(message(caught));
        }
        finally { setBusy(''); }
    };
    const performExecution = async (task: () => Promise<void>, kind: BusyAction = 'run') => {
        if (executionInFlightRef.current) return;
        executionInFlightRef.current = true;
        try { await perform(task, kind); }
        finally { executionInFlightRef.current = false; }
    };

    const addDraft = (draft: Draft) => {
        if (workspaceRef.current.tabs.length >= MAX_TABS) { setError(`Close a tab before creating another. This workspace supports ${MAX_TABS} open drafts.`); return false; }
        setWorkspace(current => ({ ...current, tabs: [...current.tabs, draft], activeId: draft.id }));
        return true;
    };
    const openNewDraft = (draft: Draft, revealQuery = false) => {
        if (!addDraft(draft)) return false;
        if (revealQuery) panels.revealPanelTemporarily('query', draft.id);
        return true;
    };
    const recordFailedQueryError = (failure: FailedQueryError) => {
        executionFailureRef.current = true;
        storeFailedQueryError(failure);
        if (workspaceRef.current.activeId !== failure.draftId) return;
        setViewForDraft(failure.draftId, 'results', true);
        panels.revealPanelTemporarily('results', failure.draftId);
    };

    const executeSqlForDraft = (draft: Draft, sql: string, options: {
        kind?: RunKind;
        view?: ResultsView;
        sourceRange?: { from: number; to: number };
        draftSql?: string;
        expandResults?: boolean;
        trackChartRun?: boolean;
        preview?: boolean;
    } = {}) => {
        const kind = options.kind ?? 'query';
        let statements: ReturnType<typeof splitSql> = [];
        let parseError: unknown;
        let parseFailed = false;
        try { statements = splitSql(sql); }
        catch (caught) { parseFailed = true; parseError = caught; }
        const isScript = kind === 'query' && statements.length > 1;
        const statement = isScript ? undefined : statements[0];
        const draftSql = options.draftSql ?? draft.sql;
        const sourceRange = options.sourceRange ?? (sql === draft.sql && statement ? statement : undefined);

        return performExecution(async () => {
            if (parseFailed) throw parseError;
            if (!trusted) throw new Error('Review and trust this read only connection before running SQL.');
            if (isScript && connection.manifest?.scripts.available !== true)
                throw new Error(connection.manifest?.scripts.reason ?? 'Scripts are unavailable on this connection.');
            if (kind === 'explain' && connection.manifest?.explain.available === false)
                throw new Error(connection.manifest.explain.reason ?? 'EXPLAIN is unavailable on this connection.');
            const explainPlan = connection.manifest?.explainPlan ?? connection.manifest?.explain;
            if (kind === 'plan' && explainPlan?.available === false)
                throw new Error(explainPlan.reason ?? 'EXPLAIN PLAN is unavailable on this connection.');
            const explainPipeline = connection.manifest?.explainPipeline ?? connection.manifest?.pipeline;
            if (kind === 'pipeline' && explainPipeline?.available === false)
                throw new Error(explainPipeline.reason ?? 'EXPLAIN PIPELINE is unavailable on this connection.');
            const explainAnalyze = connection.manifest?.explainAnalyze;
            if (kind === 'analyze' && explainAnalyze?.available === false)
                throw new Error(explainAnalyze.reason ?? 'EXPLAIN ANALYZE is unavailable on this connection.');
            if (statements.length === 0) throw new Error('Write or select a SQL statement before running it.');
            if (!isScript && statements.length > 1)
                throw new Error('This action accepts exactly one SQL statement.');
            if (parameterNames(sql).length && connection.manifest?.parameters.available === false)
                throw new Error(connection.manifest.parameters.reason ?? 'Query parameters are unavailable on this connection.');

            const importedSqlBaseline = await importedReveal.captureImportedSqlBaseline(draft.id, isScript ? statements.some(item => isSchemaChangingSql(item.sql)) : Boolean(statement && isSchemaChangingSql(statement.sql)));

            const payload = {
                clientRequestId: crypto.randomUUID(), connectionId: connection.id, documentId: draft.serverId,
                sql: isScript ? sql : statement!.sql, parameters: draft.parameters,
                parentRunId: draft.parentRunId, kind, limits: { rows: connection.limits.rows || DEFAULT_LIMITS.rows, seconds: connection.limits.seconds || DEFAULT_LIMITS.seconds },
                tags: { workspace: 'clickstudio', experience },
                ...(!isScript && sourceRange ? { sourceFrom: sourceRange.from, sourceTo: sourceRange.to } : {}),
            };
            clearFailedQueryError(draft.id);
            const previousResult = draft.id === active.id && run && terminal(run) && resultPage
                ? { draftId: draft.id, run, page: resultPage, pageIndex: page }
                : undefined;

            if (isScript) {
                pendingExecution.start(payload.clientRequestId, draft.id, payload.sql, previousResult);
                let created: Script;
                try {
                    created = await post<Script>('/scripts', { ...payload, stopOnError: true });
                } catch (caught) {
                    pendingExecution.clear(payload.clientRequestId);
                    recordFailedQueryError({ draftId: draft.id, draftSql, statementSql: payload.sql, sourceFrom: 0, error: apiErrorDetail(caught) });
                    throw caught;
                }
                pendingExecution.acceptScript(payload.clientRequestId, created.id);
                importedReveal.rememberImportedSqlScript(draft.id, created.id, importedSqlBaseline);
                scriptFollowRef.current = { scriptId: created.id, enabled: true };
                setScripts(current => ({ ...current, [created.id]: created }));
                const first = created.statements.find(item => item.runId);
                update(draft.id, current => first?.runId
                    ? { ...current, activeRunId: first.runId, scriptId: created.id, runIds: rememberRunIds(current.runIds, [first.runId]) }
                    : { ...current, scriptId: created.id });
                setViewForDraft(draft.id, 'results', true);
                if (options.trackChartRun) setExampleChartRunId(undefined);
            } else {
                pendingExecution.start(payload.clientRequestId, draft.id, payload.sql, previousResult);
                let created: Run;
                try {
                    created = await post<Run>('/runs', payload);
                } catch (caught) {
                    pendingExecution.clear(payload.clientRequestId);
                    if (statement) recordFailedQueryError({ draftId: draft.id, draftSql, statementSql: statement.sql, sourceFrom: sourceRange?.from ?? 0, error: apiErrorDetail(caught) });
                    throw caught;
                }
                pendingExecution.acceptRun(payload.clientRequestId, created.id);
                if (connection.dataSource === 'clickhouse' && connection.readonly === false && statement && isSchemaChangingSql(statement.sql))
                    trackSchemaRefresh(created.id, draft.id, importedSqlBaseline);
                setRunForRun(created.id, created, true);
                setViewForDraft(draft.id, kind === 'explain' ? 'indexes' : kind === 'plan' ? 'plan' : kind === 'pipeline' ? 'pipeline' : kind === 'analyze' ? 'runtime' : options.view ?? 'results', true);
                update(draft.id, current => ({ ...current, activeRunId: created.id, scriptId: undefined, runIds: rememberRunIds(current.runIds, [created.id]) }));
                if (draft.id === active.id) editor.current?.focus();
                if (options.trackChartRun) setExampleChartRunId(options.view === 'chart' ? created.id : undefined);
            }
            if (options.expandResults) panels.revealPanelTemporarily('results', draft.id);
            if (!isFrontendDemoPreview)
                setNotice(demoMode
                    ? isScript ? 'Sample results were generated. Script SQL was not sent to ClickHouse.' : options.preview ? 'Sample preview generated. SQL was not sent to ClickHouse.' : 'Sample results were generated. Query SQL was not sent to ClickHouse.'
                    : isScript ? 'Script submitted to the selected ClickHouse connection.' : options.preview ? 'Table preview submitted to the selected ClickHouse connection.' : 'Query submitted to the selected ClickHouse connection.');
            void loadHistory().catch(() => undefined);
        }, isScript ? 'script' : 'run');
    };

    const runExample = (example: SqlExample, output: 'results' | 'chart' | 'map') => {
        if (busy || executionInFlightRef.current) { setError(copy.common.runActionWait); return true; }
        if (!trusted) { setError(copy.common.runActionTrustRequired); return true; }
        const draft = createExampleDraft(example, locale, copy.common);
        if (!openNewDraft(draft, true)) return true;
        void executeSqlForDraft(draft, draft.sql, { view: output, expandResults: true, trackChartRun: true });
        return true;
    };

    const execute = (kind: RunKind = 'query', sqlOverride?: string) => {
        const editorSnapshot = editor.current?.snapshot() ?? { sql: active.sql, from: active.from, to: active.to };
        const selection = editorSnapshot.to > editorSnapshot.from ? editorSnapshot.sql.slice(editorSnapshot.from, editorSnapshot.to) : undefined;
        const selected = selectedStatement(editorSnapshot.sql, editorSnapshot.from, editorSnapshot.to);
        const sql = sqlOverride ?? (kind === 'query' ? selection ?? editorSnapshot.sql : selected?.sql ?? '');
        const sourceRange = sqlOverride === undefined && !selection ? selected : undefined;
        return executeSqlForDraft(active, sql, { kind, sourceRange, draftSql: editorSnapshot.sql });
    };

    const cancel = async () => {
        if (cancellingRef.current) return;
        const scriptId = script?.status === 'running' ? script.id : undefined;
        const runId = !scriptId && run && !terminal(run) ? run.id : undefined;
        if (!scriptId && !runId) return;
        cancellingRef.current = true;
        setCancelling(true);
        setError('');
        try {
            if (scriptId) {
                const cancelled = await post<Script>(`/scripts/${encodeURIComponent(scriptId)}/cancel`);
                setScripts(current => ({ ...current, [cancelled.id]: cancelled }));
            } else if (runId) {
                setRunForRun(runId, await post<Run>(`/runs/${encodeURIComponent(runId)}/cancel`));
                setNotice('Cancellation requested. The server will confirm the final state.');
            }
        } catch (caught) {
            setError(message(caught));
        } finally {
            cancellingRef.current = false;
            setCancelling(false);
        }
    };

    const openRun = (selected: Run) => {
        if (selected.connectionId !== connection.id) { onSelectConnection(selected.connectionId); return; }
        const draft = newDraft(`${selected.kind === 'query' ? 'Query' : selected.kind.toUpperCase()} ${new Date(selected.createdAt).toLocaleTimeString()}.sql`, selected.sql);
        draft.parameters = selected.parameters;
        draft.activeRunId = selected.id;
        draft.runIds = [selected.id];
        if (!addDraft(draft)) return;
        setViewForDraft(draft.id, selected.kind === 'plan' ? 'plan' : selected.kind === 'pipeline' ? 'pipeline' : selected.kind === 'analyze' ? 'runtime' : 'results', true);
        panels.revealPanelTemporarily('results', draft.id);
        setNotice(`Opened retained run ${selected.queryId}. No query was rerun.`);
    };

    const saveDraft = useWorkspaceDocumentSave({
        active,
        busy,
        connectionId: connection.id,
        workspaceRef,
        inspectorRef,
        perform,
        updateDraft: update,
        setSavingDraftIds,
        setDocuments,
        setNotice,
        loadDocumentRevisions,
    });

    const finishTabRename = (id: string, value: string, restoreFocus = false, saveAfterRename = true) => {
        const renamedDraft = updateTabRename(id, value, restoreFocus);
        if (saveAfterRename && renamedDraft) void saveDraft(renamedDraft);
    };

    const restoreDocumentRevision = (revision: QueryDocument) => void perform(async () => {
        const draft = workspaceRef.current.tabs.find(item => item.id === workspaceRef.current.activeId);
        if (!draft?.serverId || draft.serverId !== revision.id) throw new Error('Open the saved query before restoring one of its versions.');
        const latestSaved = revisionsDocumentId === draft.serverId ? documentRevisions[0] : documents.find(document => document.id === draft.serverId);
        if (!latestSaved || latestSaved.deletedAt) throw new Error('The latest saved version could not be checked. Refresh saved queries and try again.');
        const hasUnsavedChanges = draft.baseRevision !== latestSaved.revision || !sameSavedContent(draft, latestSaved);
        if (hasUnsavedChanges && !window.confirm(`Restore Version ${revision.revision}? This will replace the current unsaved draft. The restored SQL will be saved as a new version.`)) return;
        const restoreBase: QueryDocument = {
            ...latestSaved,
            name: draft.name,
            sql: draft.sql,
            parameters: { ...draft.parameters },
            chart: { ...draft.chart, ys: [...draft.chart.ys] },
            runId: draft.activeRunId,
            parentDocumentId: draft.parentDocumentId,
            kind: draft.kind,
            metric: draft.metric ? { ...draft.metric, dimensions: [...draft.metric.dimensions], sourceColumns: [...draft.metric.sourceColumns] } : undefined,
            dependencies: [...draft.dependencies],
        };
        const restored = await post<QueryDocument>(`/documents/${encodeURIComponent(draft.serverId)}/restore-revision`, {
            revision: revision.revision,
            baseRevision: latestSaved.revision,
        });
        const currentDraft = workspaceRef.current.tabs.find(item => item.id === draft.id);
        const editedDuringRestore = Boolean(currentDraft && !sameSavedContent(currentDraft, restoreBase));
        update(draft.id, current => editedDuringRestore ? { ...current, baseRevision: restored.revision } : ({
            ...checkpoint(current, `Before restoring Version ${revision.revision}`),
            name: restored.name,
            sql: restored.sql,
            baseRevision: restored.revision,
            parameters: { ...restored.parameters },
            chart: { ...restored.chart, ys: [...restored.chart.ys] },
            activeRunId: undefined,
            scriptId: undefined,
            parentRunId: undefined,
            parentDocumentId: restored.parentDocumentId,
            kind: restored.kind,
            metric: restored.metric ? { ...restored.metric, dimensions: [...restored.metric.dimensions], sourceColumns: [...restored.metric.sourceColumns] } : undefined,
            dependencies: [...restored.dependencies],
            from: 0,
            to: 0,
        }));
        setDocuments(current => [restored, ...current.filter(document => document.id !== restored.id)]);
        setNotice(editedDuringRestore
            ? `Restored Version ${revision.revision} as Version ${restored.revision}. Edits made during restore are still in your draft.`
            : `Restored Version ${revision.revision} as Version ${restored.revision}.`);
        await loadDocumentRevisions(restored.id);
    }, 'save');

    const loadSnapshot = useResultSnapshot({
        activeRunId, run, snapshot, setSnapshotForRun,
        onSnapshot: (runId, full) => {
            if (activeRunIdRef.current !== runId || workspaceRef.current.activeId !== active.id) return;
            const suggestion = recommendChart(full.columns, full.rows);
            if (active.chart.kind === 'table' && suggestion.config.kind !== 'table') patch({ chart: suggestion.config });
        },
    });

    useEffect(() => {
        if (!exampleChartRunId || exampleChartRunId !== activeRunId || run?.id !== exampleChartRunId || !terminal(run)) return;
        if (snapshot?.runId === exampleChartRunId || run.resultState !== 'reopenable') {
            setExampleChartRunId(undefined);
            return;
        }
        void loadSnapshot().catch(caught => setError(message(caught))).finally(() => {
            setExampleChartRunId(current => current === exampleChartRunId ? undefined : current);
        });
    }, [activeRunId, exampleChartRunId, loadSnapshot, run, setError, snapshot?.runId]);

    useEffect(() => {
        if (!run || !['chart', 'map', 'indexes', 'plan', 'pipeline', 'runtime'].includes(view) || !terminal(run) || run.resultState !== 'reopenable' || snapshot?.runId === run.id) return;
        void loadSnapshot().catch(caught => setError(message(caught)));
    }, [loadSnapshot, run, setError, snapshot?.runId, view]);

    const exportCurrentCsv = async () => {
        if (!run) return;
        try {
            if (isFrontendDemoPreview) {
                const full = snapshot?.runId === run.id ? snapshot : await api<Result>(`/runs/${encodeURIComponent(run.id)}/snapshot`);
                download(`${run.queryId}.csv`, exportCsv(full), 'text/csv;charset=utf-8');
                return;
            }
            const link = document.createElement('a');
            link.href = `/api/runs/${encodeURIComponent(run.id)}/export?format=csv`;
            link.download = `${run.queryId}.csv`;
            link.click();
        } catch (caught) {
            setError(message(caught));
        }
    };

    const exportCurrentQuery = () => {
        const baseName = active.name.trim().replace(/\.sql$/i, '').replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim();
        download(`${baseName || 'query'}.sql`, active.sql, 'application/sql;charset=utf-8');
    };

    const loadProfile = async () => {
        if (!activeRunId) return;
        if (connection.manifest?.queryLog.available === false) return;
        const runId = activeRunId;
        const response = await api<QueryProfile>(`/runs/${encodeURIComponent(runId)}/profile`);
        setProfileForRun(runId, response);
    };

    const loadPipeline = async () => {
        if (!activeRunId) return;
        if (connection.manifest?.pipeline.available === false) return;
        const runId = activeRunId;
        const response = await api<ProfilePipeline>(`/runs/${encodeURIComponent(runId)}/profile/pipeline`);
        if (activeRunIdRef.current !== runId) return;
        setPipelineForRun(runId, response);
    };

    const loadFlamegraph = async () => {
        if (!activeRunId || connection.manifest?.traceLog?.available !== true) return;
        const runId = activeRunId;
        const response = await api<FlamegraphSnapshot>(`/runs/${encodeURIComponent(runId)}/profile/flamegraph`);
        if (activeRunIdRef.current === runId) setFlamegraphForRun(runId, response);
    };

    const showInspector = (next: Inspector) => {
        setInspector(next);
        setDrawerOpen(true);
        if (next === 'profile') void perform(loadProfile, 'save');
        if (next === 'pipeline') void perform(loadPipeline, 'save');
    };
    const inspectorDocked = drawerOpen;

    const trustConnection = () => perform(async () => {
        if (!trusted && !demoMode && !window.confirm(`Check these connection details before continuing:\n\nConnection: ${connectionLabel}\nServer: ${connection.host}\nDatabase: ${connection.database}\nUser: ${connection.username}\nAccess: read-only\n\nAllow read-only access so you can run queries?`)) return;
        await post(`/connections/${encodeURIComponent(connection.id)}/trust`, { trusted: !trusted, confirmation: connection.id });
        await onRefreshConnections();
        setNotice(demoMode ? 'Sample data is ready. You can explore the workspace.' : trusted ? 'Read-only access was turned off.' : 'Connection is ready for read-only queries.');
    }, 'save');
    trustActionRef.current = trustConnection;

    const testConnection = () => perform(async () => {
        const tested = await post<Connected>(`/connections/${encodeURIComponent(connection.id)}/test`);
        await onRefreshConnections();
        setNotice(`Connection tested · ClickHouse ${tested.manifest?.serverVersion ?? 'server'}. Review the connection, then trust it to run queries.`);
    }, 'save');
    testConnectionActionRef.current = testConnection;

    const viewState = useWorkspaceViewState({
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
    });

    const {
        sortedHistory,
        savedDocument,
        saveStatus,
        requestedResultsView,
        sqlMapStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        sqlMapParseStatement,
        visibleResultsView,
    } = viewState;


    const panels = useWorkspacePanels({
        activeDraftId: active.id,
        compactViewport,
        hasOutput: Boolean(run || requestedResultsView === 'sqlmap'),
    });
    const detachedEditor = useDetachedQueryEditor({ activeDraftId: active.id, activeName: active.name, experience, panels, editorRef: editor, copy: copy.common, setError, setNotice });
    const detachedResults = useDetachedResultsPanel({ activeDraftId: active.id, activeName: active.name, resultsTitle: viewState.resultsTitle, experience, panels, copy: copy.common, setError, setNotice });


    const openDocument = (document: QueryDocument) => {
        addDraft(draftFromDocument(document));
    };
    const openSqlDraft = (name: string, sql: string, run: boolean, reuseExisting = false) => {
        if (run && (busy || executionInFlightRef.current)) { setError(copy.common.runActionWait); return; }
        if (run && !trusted) { setError(copy.common.runActionTrustRequired); return; }
        if (run && reuseExisting && activateMatchingPreviewDraft(
            workspaceRef.current.tabs, name, sql,
            id => setWorkspace(current => ({ ...current, activeId: id })),
            draft => { void executeSqlForDraft(draft, draft.sql, { expandResults: true, trackChartRun: true, preview: true }); },
        )) return;
        const draft = newDraft(name, sql);
        if (!openNewDraft(draft, !run)) return;
        if (!run) {
            window.requestAnimationFrame(() => editor.current?.focus());
            return;
        }
        void executeSqlForDraft(draft, draft.sql, { expandResults: true, trackChartRun: true, preview: true });
    };
    const startBlankSql = () => {
        if (!openNewDraft(newDraft(), true)) return false;
        window.requestAnimationFrame(() => editor.current?.focus());
        return true;
    };
    const inspectorProps = {
        copy: copy.common,
        inspector,
        setInspector: showInspector,
        connection,
        serverVersion: connection.id === PLAYGROUND_CONNECTION_ID ? playgroundServerVersion : connection.manifest?.serverVersion,
        serverVersionLoading: connection.id === PLAYGROUND_CONNECTION_ID && playgroundServerVersionLoading,
        schema,
        schemaLoading,
        schemaLoadingMore,
        schemaError,
        search,
        setSearch,
        history: sortedHistory,
        documents,
        revisions: revisionsDocumentId === active.serverId ? documentRevisions : [],
        revisionsDocumentId,
        revisionLoading,
        revisionError,
        currentRevision: revisionsDocumentId === active.serverId
            ? documentRevisions[0]?.revision ?? savedDocument?.revision ?? active.baseRevision
            : savedDocument?.revision ?? active.baseRevision,
        unsavedDraft: saveStatus.state !== 'saved' && saveStatus.state !== 'checking',
        canRestoreRevision: Boolean(active.serverId && revisionsDocumentId === active.serverId && documentRevisions.length > 1 && !revisionLoading && !documentsReadError && savedDocument && !savedDocument.deletedAt),
        run,
        profile,
        pipeline,
        comparisonProfiles: profilesByRun,
        comparisonPipelines: pipelinesByRun,
        onRefreshSchema: () => void loadSchema(true),
        onLoadMoreSchema: () => void loadMoreSchema(),
        importedTableTarget: importedReveal.importedTableTarget,
        onImportedTableRevealed: importedReveal.onImportedTableRevealed,
        onRefreshHistory: () => void loadHistory(),
        onInsert: (value: string) => editor.current?.insert(value),
        onOpenSqlDraft: openSqlDraft,
        onTableDeleted: table => setWorkspace(current => workspaceAfterTableDeleted(current, table)),
        onOpenImport: () => setImportOpen(true),
        onOpenExport: () => setExportOpen(true),
        onOpenRun: openRun,
        onOpenDocument: openDocument,
        onLoadProfile: () => void perform(loadProfile, 'save'),
        onLoadPipeline: () => void perform(loadPipeline, 'save'),
        onOpenGraph: () => { setView('insights'); },
        connectionId: connection.id,
        sql: active.sql,
        trusted,
        onRefreshDocuments: () => void loadDocuments(),
        onRefreshRevisions: () => void loadDocumentRevisions(active.serverId),
        onRestoreRevision: restoreDocumentRevision,
        assistantQuestion,
        onAssistantQuestion: changeAssistantQuestion,
        assistantChats,
        activeAssistantChatId,
        assistantTurns,
        assistantChatStorageError,
        onNewAssistantChat: () => {
            newAssistantChat();
            if (selectableRunId) setIncludeRun(true);
        },
        onSelectAssistantChat: selectAssistantChat,
        onRenameAssistantChat: renameAssistantChat,
        onDeleteAssistantChat: deleteAssistantChat,
        assistantBusy,
        assistantCancelable,
        assistantPhase,
        assistantError,
        assistantNotice,
        nativeParserEnabled,
        nativeParserStatus,
        nativeParseSnapshot,
        onRetryParser: () => editor.current?.retryNativeParser(),
        onAskAI: (currentSchema?: Schema, serverVersion?: string, database?: string) => void requestAssistantSql(currentSchema, serverVersion, database, includeRun ? signal => loadAssistantRunContext(run, snapshot, signal) : undefined),
        onCancelAssistantRequest: cancelAssistantRequest,
        onDecideProposal: (turnId: string, decision: 'accepted' | 'rejected') => void decideAssistantProposal(turnId, decision),
        onRunQuery: sql => void execute('query', sql),
        runDisabled: sql => {
            if (!trusted || busy) return true;
            const statementCount = safeStatementCount(sql);
            if (statementCount !== undefined && statementCount > 1 && connection.manifest?.scripts.available !== true) return true;
            if (connection.manifest?.parameters.available !== false) return false;
            try { return parameterNames(sql).length > 0; } catch { return true; }
        },
        expert: experience === 'expert',
    } satisfies InspectorPaneProps;

    const queryPanel = <WorkspaceQueryPanel
        state={{ active, connection, schema, copy, experience, dark, nativeParserEnabled, nativeParserStatus,
            trusted, unsupportedParameters, parameters, busy, inspector, demoMode, view }}
        actions={{
            onPatch: patch,
            onToggleSqlMap: () => {
                setView(current => current === 'sqlmap' ? 'results' : 'sqlmap');
                panels.revealPanelTemporarily('results');
            },
            onOpenAssistant: () => showInspector('assistant'),
            onSave: saveDraft,
            onFormat: formatActiveSql,
            onRun: execute,
            runActionTitle,
            onConnectionAction: () => !demoMode && !connection.manifest
                ? testConnectionActionRef.current()
                : trustActionRef.current(),
            onNativeParserStatus: setNativeParserStatus,
            onNativeParseSnapshot: setNativeParseSnapshot,
            onOpenDetached: detachedEditor.openEditor,
            onDockDetached: detachedEditor.dockEditor,
        }}
        panels={panels}
        viewState={viewState}
        editorRef={editor}
        detached={Boolean(detachedEditor.detached)}
    />;

    const resultsPanel = <WorkspaceResultsPanel
        state={{ active, connection, copy, locale, run, failedAttempt: failedQueryError, script, history, page, resultPage, profile, pipeline, flamegraph, profilesByRun, pipelinesByRun, nativeParserEnabled, nativeParserStatus, nativeParseSnapshot, trusted, busy, execution: pendingExecution.execution, retainedExecutionResult: pendingExecution.retainedExecutionResult, cancelling, experience }}
        actions={{
            onSelectView: nextView => { setView(nextView); if (nextView === 'insights') void perform(loadProfile, 'save'); },
            onSelectScriptRun: runId => { if (active.scriptId) scriptFollowRef.current = { scriptId: active.scriptId, enabled: false }; update(active.id, draft => ({ ...draft, activeRunId: runId })); setView('results'); },
            onOpenDetached: detachedResults.openResults, onDockDetached: detachedResults.dockResults, onCancel: () => void cancel(), onPage: setPage, onPatch: patch,
            onLoadProfile: () => void perform(loadProfile, 'save'), onLoadPipeline: () => void perform(loadPipeline, 'save'), onLoadFlamegraph: () => void perform(loadFlamegraph, 'save'),
            onRevealRange: (from, to) => editor.current?.revealRange(from, to),
        }}
        panels={panels} viewState={viewState} detached={Boolean(detachedResults.detached)}
    />;

    return <div className={cx('workspace-root', experience === 'expert' && 'is-expert', experience === 'beginner' && 'is-beginner', inspectorDocked && 'has-inspector-dock')}>
        <OverlayPortal><div className="toast-stack">
            {error && <div className="toast toast-error animate-enter" role="alert"><span>!</span>{error}<button onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close"/></button><div key={error} className="toast-timer" style={{ animationDuration: `${WORKSPACE_TOAST_TIMEOUT_MS}ms` }} aria-hidden="true"/></div>}
            {notice && <div className="toast toast-success animate-enter" role="status"><span>✓</span>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message"><Icon name="close"/></button><div key={notice} className="toast-timer" style={{ animationDuration: `${WORKSPACE_TOAST_TIMEOUT_MS}ms` }} aria-hidden="true"/></div>}
            {storageError && <div className="toast toast-error" role="alert">Local draft storage could not save changes: {storageError}</div>}
        </div></OverlayPortal>

        <div className="workspace-layout">
            <aside className="icon-rail" aria-label="Workspace tools">
                <span className="rail-separator"/>
                {PRIMARY_INSPECTOR_NAVIGATION.map(item => <RailButton key={item.id} icon={item.icon} label={copy.common[item.copyKey]} active={inspector === item.id && drawerOpen} accent={item.id === 'assistant'} testId={experience === 'expert' && item.id === 'assistant' ? 'open-ai' : undefined} onClick={() => showInspector(item.id)}/>)}
                {experience === 'beginner' && <>
                    <span className="rail-spacer"/>
                    <span className="rail-separator"/>
                    <RailButton icon="importFile" label={copy.common.import} onClick={() => setImportOpen(true)}/>
                    <RailButton icon="exportFile" label={copy.common.export} onClick={() => setExportOpen(true)}/>
                </>}
                {experience === 'expert' && <div className="expert-rail-secondary">
                    <span className="rail-separator"/>
                    {EXPERT_BROWSE_NAVIGATION.map(item => <RailButton key={item.id} icon={item.icon} label={item.copyKey ? copy.common[item.copyKey] : inspectorLabel(item.id)} active={inspector === item.id && drawerOpen} onClick={() => showInspector(item.id)}/>)}
                    <span className="rail-spacer"/>
                    {EXPERT_EXECUTION_NAVIGATION.map(item => <RailButton key={item.id} icon={item.icon} label={inspectorLabel(item.id)} active={inspector === item.id && drawerOpen} onClick={() => showInspector(item.id)}/>)}
                    <span className="rail-separator"/><button className="rail-icon-button rail-icon-muted" type="button" title="Export local drafts" onClick={() => download('clickstudio-local-drafts.json', workspace)}><Icon name="settings"/></button>
                </div>}
            </aside>

            <main className="workspace-main">
                <WorkspaceDocumentTabs
                    workspace={workspace}
                    experience={experience}
                    activeId={active.id}
                    connectionId={connection.id}
                    documents={documents}
                    documentsLoaded={documentsLoaded}
                    documentsReadError={documentsReadError}
                    savingDraftIds={savingDraftIds}
                    tabScrollerRef={tabScrollerRef}
                    tabScrollState={tabScrollState}
                    updateTabScrollState={updateTabScrollState}
                    scrollTabs={scrollTabs}
                    renamingTabId={renamingTabId}
                    tabRenameValue={tabRenameValue}
                    setTabRenameValue={setTabRenameValue}
                    beginTabRename={beginTabRename}
                    finishTabRename={finishTabRename}
                    cancelTabRename={cancelTabRename}
                    onActivate={draftId => setWorkspace(current => ({ ...current, activeId: draftId }))}
                    onClose={draftId => {
                        if (workspace.tabs.length === 1) {
                            detachedEditor.closeEditor();
                            detachedResults.closeResults();
                        }
                        setWorkspace(current => closeDraft(current, draftId));
                        clearFailedQueryError(draftId);
                    }}
                    actions={<>
                    <button className={cx('new-tab-button', experience === 'expert' && 'new-tab-labeled')} data-testid="new-sql" type="button" aria-label={copy.common.newSql} title={copy.common.newSql} aria-haspopup="dialog" aria-expanded={helpPanelOpen} aria-controls="workspace-help-panel" onClick={event => openExamples(event.currentTarget)}><Icon name="plus"/>{experience === 'expert' && <span>{copy.common.newSql}</span>}</button>
                        <WorkspaceHelpPanel
                            open={helpPanelOpen}
                            section={helpPanelSection}
                            onSectionChange={setHelpPanelSection}
                            onClose={closeHelpPanel}
                            onOpenMonitoring={() => setObservabilityOpen(true)}
                            onOpenAssistant={() => showInspector('assistant')}
                            examples={sqlExamples}
                            sourceLabel={connectionLabel}
                            copy={copy.common}
                            locale={locale}
                            connection={connection}
                            databases={schema?.databases ?? [connection.database]}
                            tables={schema?.tables ?? []}
                            schemaLoaded={schema !== undefined}
                            schemaLoading={schemaLoading}
                            schemaError={schemaError}
                            onRefreshSchema={() => void loadSchema(true)}
                            trusted={trusted}
                            queryEngine={{
                                copy: copy.common,
                                sql: helpStatementSql(sqlMapStatement, active.sql),
                                sourceOffset: helpStatementOffset(sqlMapStatement),
                                parseResult: helpParseResult(sqlMapParseStatement),
                                parserEnabled: nativeParserEnabled,
                                parserStatus: nativeParserStatus,
                                parseDurationMs: helpParseDuration(nativeParseSnapshot),
                                connectionId: connection.id,
                                parameters: active.parameters,
                                analyzerAvailable: queryTreeAvailable,
                                analyzerUnavailableReason: queryTreeUnavailableReason,
                                onRevealRange: (from, to) => {
                                    closeHelpPanel(false);
                                    window.requestAnimationFrame(() => revealEditorRange(editor, from, to));
                                },
                            }}
                            busy={Boolean(busy)}
                            unsupportedParameters={unsupportedParameters}
                            onRunExplain={kind => void execute(kind)}
                            comparison={{
                                connectionId: connection.id,
                                trusted,
                                history,
                                initialRun: run,
                                profiles: profilesByRun,
                                pipelines: pipelinesByRun,
                                queryLogAvailable: helpQueryLogAvailable(connection),
                            }}
                            onReferenceInsert={value => {
                                insertEditorText(editor, value);
                                closeHelpPanel(false);
                                window.requestAnimationFrame(() => focusEditor(editor));
                            }}
                            onOpenExample={example => {
                                const draft = createExampleDraft(example, locale, copy.common);
                                if (!openNewDraft(draft, true)) return false;
                                window.requestAnimationFrame(() => editor.current?.focus());
                                return true;
                            }}
                            onRunExample={runExample}
                            onStartBlankSql={startBlankSql}
                        />
                        {!!workspace.closedTabs?.length && <RestoreSqlMenu closedTabs={workspace.closedTabs} copy={copy.common} onRestore={draftId => {
                            if (workspaceRef.current.tabs.length >= MAX_TABS) { setError(`Close a tab before restoring one. This workspace supports ${MAX_TABS} open drafts.`); return false; }
                            const restored = reopenDraft(workspaceRef.current, draftId);
                            setWorkspace(restored);
                            if (restored.activeId) panels.revealPanelTemporarily('query', restored.activeId);
                            window.requestAnimationFrame(() => editor.current?.focus());
                            return true;
                        }}/>}
                        {experience === 'expert' && active.serverId && <Button variant="ghost" className="revision-history-trigger" aria-label={`Version history for ${active.name}`} aria-pressed={inspector === 'revisions'} title="View saved versions" onClick={() => showInspector('revisions')}><Icon name="history"/><span>Versions</span></Button>}

                    </>}
                />
                {workspace.tabs.length > 0 ? <div
                    ref={panels.workspaceContentRef}
                    id="sql-document-panel"
                    role="tabpanel"
                    aria-labelledby={`document-tab-${active.id}`}
                    tabIndex={0}
                    style={panels.workspaceLayoutStyle}
                    className={cx(
                        'workspace-content',
                        experience === 'beginner' && 'beginner-workspace-content',
                        run && 'has-run',
                        visibleResultsView === 'sqlmap' && 'has-sql-map',
                        panels.queryCollapsed && 'is-query-collapsed',
                        (run || visibleResultsView === 'sqlmap') && panels.resultsCollapsed && 'is-results-collapsed',
                        panels.queryFloating && 'has-floating-query',
                        panels.resultsFloating && 'has-floating-results',
                        panels.canSplitPanels && 'has-panel-split',
                    )}
                >
                    {detachedEditor.detached
                        ? <DetachedQueryPlaceholder name={active.name} copy={copy.common} collapsed={panels.queryCollapsed} onFocus={detachedEditor.focusEditor} onDock={detachedEditor.dockEditor}/>
                        : queryPanel}

                    <WorkspacePanelSplitter panels={panels}/>

                    {detachedResults.detached
                        ? <DetachedResultsPlaceholder
                            title={viewState.resultsTitle}
                            eyebrow={viewState.resultsEyebrow}
                            queryName={active.name}
                            copy={copy.common}
                            collapsed={panels.resultsCollapsed}
                            onFocus={detachedResults.focusResults}
                            onDock={detachedResults.dockResults}
                        />
                        : resultsPanel}
                </div> : <section className="empty-sql-workspace" role="tabpanel" aria-label={copy.common.noSqlTabsOpen}>
                    <Icon name="documents"/>
                    <h2>{copy.common.noSqlTabsOpen}</h2>
                    <p>{copy.common.noSqlTabsOpenDescription}</p>
                    <button ref={emptySqlActionRef} type="button" className="button-base button-primary" onClick={startBlankSql}><Icon name="plus"/>{copy.common.startBlankSql}</button>
                </section>}
            </main>

            {inspectorDocked && <InspectorPane {...inspectorProps} docked onClose={() => setDrawerOpen(false)}/>}
        </div>
        {observabilityOpen && <OverlayPortal><ObservabilityExplorer connectionId={connection.id} connectionLabel={connectionLabel} trusted={trusted} queryLog={connection.manifest?.queryLog} replication={connection.manifest?.replication} onClose={() => setObservabilityOpen(false)}/></OverlayPortal>}
        <ImportWizard open={importOpen} connectionId={connection.id} trusted={trusted} demoMode={demoMode} onImportQuery={(name, sql) => openImportedSqlQuery(name, sql, openNewDraft, importedReveal.markImportedSqlDraft, setNotice)} onClose={() => setImportOpen(false)} onImported={importedReveal.onImported} onTableNeedsInspection={importedReveal.onUnconfirmedDestination}/>
        <ExportDialog open={exportOpen} queryAvailable={Boolean(active.sql.trim())} rowsAvailable={run?.resultState === 'reopenable'} onClose={() => setExportOpen(false)} onExportQuery={() => { setExportOpen(false); exportCurrentQuery(); }} onExportRows={() => { setExportOpen(false); void exportCurrentCsv(); }}/>
        <ExecutionBar run={run} failedAttempt={Boolean(failedQueryError)} eventState={eventState} onCancel={() => void cancel()} onOpenDetails={() => showInspector('details')} cancelling={cancelling} scriptRunning={script?.status === 'running'} copy={copy.common} helpButton={<HelpButton copy={copy.common} open={helpPanelOpen} onOpen={openHelp}/>}/>
        {detachedEditor.detached && createPortal(queryPanel, detachedEditor.detached.container)}
        {detachedResults.detached && createPortal(resultsPanel, detachedResults.detached.container)}
    </div>;
}
