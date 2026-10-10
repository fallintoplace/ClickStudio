import type { SqlExample } from './sql-examples';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import type { FlamegraphSnapshot } from '../shared/flamegraph';
import type { NativeParserStatus, NativeParseSnapshot } from '../shared/native-parser';
import { exportCsv, recommendChart } from '../shared/results';
import { parameterNames, type SqlParameter } from '../shared/sql';
import type {
    ProfilePipeline,
    QueryDocument,
    QueryProfile,
    Result,
    Run,
    Script,
} from '../shared/types';
import { sameSavedContent } from '../shared/workspace-view';
import { api, download, isFrontendDemoPreview, message, post } from './api';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from './cloud-connection';
import type { EditorHandle } from './components/SqlEditor';
import { terminal } from './components/ui';
import type { HelpPanelSection } from './components/WorkspaceHelpPanel';
import type { Copy, ExperienceLevel, Locale } from './i18n';
import { PLAYGROUND_CONNECTION_ID } from './playground';
import { sqlExamplesFor } from './sql-examples';
import { useFailedQueryErrors } from './useFailedQueryErrors';
import { isSchemaChangingSql, useImportedTableReveal } from './useImportedTableReveal';
import { usePendingExecution } from './usePendingExecution';
import { useResultSnapshot } from './useResultSnapshot';
import { useRunEvidence } from './useRunEvidence';
import { useScopedValue } from './useScopedValue';
import { useScriptExecution } from './useScriptExecution';
import { useDefaultAssistantRunContext, useWorkspaceAssistant } from './useWorkspaceAssistant';
import { useWorkspaceData } from './useWorkspaceData';
import { useWorkspacePanels } from './useWorkspacePanels';
import { useWorkspacePersistence } from './useWorkspacePersistence';
import { useWorkspaceTabs } from './useWorkspaceTabs';
import { initialWorkspaceState, workspaceStateKey } from './workspace-initial-state';
import type { WorkspaceState } from './workspace-state';
import { checkpoint, draftFromDocument, type Draft } from './workspace-state';
import type {
    BusyAction,
    Connected,
    Inspector,
    ResultsView,
    WorkspaceActionRef,
    WorkspaceRunCapability,
    WorkspaceRunCapabilityAction,
} from './workspace-types';

import { useDetachedQueryEditor } from './useDetachedQueryEditor';
import { useWorkspaceDocumentSave } from './useWorkspaceDocumentSave';
import { useWorkspaceExecution } from './useWorkspaceExecution';
import { useWorkspaceNotifications } from './useWorkspaceNotifications';
import { useWorkspaceSqlFormatter } from './useWorkspaceSqlFormatter';
import { useWorkspaceViewState } from './useWorkspaceViewState';

export type WorkspaceProps = Readonly<{
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

function workspaceWithUpdatedDraft(
    state: WorkspaceState,
    id: string,
    change: (draft: Draft) => Draft,
): WorkspaceState {
    return { ...state, tabs: state.tabs.map(draft => (draft.id === id ? change(draft) : draft)) };
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
        if (action === 'script' && connection.id === PLAYGROUND_CONNECTION_ID)
            return copy.playgroundScriptUnavailable;
        return capability.reason;
    }
    if (action === 'explain-analyze') return copy.runtimeExecutesQuery;
    return undefined;
}

function useSchemaRefreshAfterDdl(
    run: Run | undefined,
    connectionId: string,
    refreshAfterRun: (draftId: string, runId: string, baseline?: ReadonlySet<string>) => void,
) {
    const pending = useRef(new Map<string, { draftId: string; baseline?: ReadonlySet<string> }>());
    const track = useCallback((runId: string, draftId: string, baseline?: ReadonlySet<string>) => {
        pending.current.set(runId, { draftId, baseline });
    }, []);
    useEffect(() => {
        if (!run || run.connectionId !== connectionId || !terminal(run)) return;
        const refresh = pending.current.get(run.id);
        if (!refresh) return;
        pending.current.delete(run.id);
        if (run.status === 'succeeded' && isSchemaChangingSql(run.sql))
            refreshAfterRun(refresh.draftId, run.id, refresh.baseline);
    }, [connectionId, refreshAfterRun, run]);
    return track;
}

export function useWorkspaceController({
    connection,
    connectionLabel,
    connections,
    onSelectConnection,
    onRefreshConnections,
    trustActionRef,
    testConnectionActionRef,
    demoMode,
    experience,
    nativeParserEnabled,
    copy,
    locale,
}: WorkspaceProps) {
    const key = workspaceStateKey(connection.id);
    const [workspace, setWorkspace] = useState(() => initialWorkspaceState(connection.id));
    const workspaceRef = useRef(workspace);
    workspaceRef.current = workspace;
    const tabs = useWorkspaceTabs(workspace, setWorkspace);
    const { active, revealActiveTab, finishTabRename: updateTabRename } = tabs;
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
    const [selectedScriptResult, setSelectedScriptResult] = useScopedValue<string>(active.id);
    const setView = useCallback<Dispatch<SetStateAction<ResultsView>>>(
        next => {
            setViewForDraft(
                active.id,
                current => (typeof next === 'function' ? next(current ?? 'results') : next),
                true,
            );
        },
        [active.id, setViewForDraft],
    );
    const [exampleChartRunId, setExampleChartRunId] = useState<string>();
    const ui = useWorkspaceUiState({ experience, revealActiveTab, active });
    const {
        busy,
        setError,
        setSearch,
        setInspector,
        setDrawerOpen,
        setNotice,
        inspector,
        setCompactViewport,
        inspectorRef,
        setRestoreRevisionConfirmation,
        drawerOpen,
    } = ui;

    const storageError = useWorkspacePersistence(key, workspace);
    const parameters = useMemo(() => {
        try {
            return parameterNames(active.sql);
        } catch {
            return [];
        }
    }, [active.sql]);
    const unsupportedParameters =
        parameters.length > 0 && connection.manifest?.parameters.available === false;
    const runActionTitle = (
        capability: WorkspaceRunCapability | undefined,
        action: WorkspaceRunCapabilityAction,
    ): string | undefined =>
        workspaceRunActionTitle(capability, action, {
            trusted,
            busy,
            unsupportedParameters,
            connection,
            copy: copy.common,
        });
    const currentConnection = connections.find(item => item.id === connection.id) ?? connection;
    const trusted = currentConnection.trusted;

    const assistant = useWorkspaceAssistant({
        active,
        activeRunId,
        connectionId: connection.id,
        trusted,
        workspaceRef,
        setWorkspace,
    });
    const { assistantBusy, includeRun, setIncludeRun } = assistant;
    const data = useWorkspaceData({
        connectionId: connection.id,
        trusted,
        activeServerId: active.serverId,
        setWorkspace,
        workspaceRef,
        setError,
    });
    const { schema, setDocuments, loadHistory, loadDocumentRevisions, loadSchema } = data;
    const importedReveal = useImportedTableReveal({
        connectionId: connection.id,
        demoMode,
        canRevealSqlTables: connection.dataSource === 'clickhouse' && connection.readonly === false,
        loadSchema,
        setSearch,
        setInspector,
        setDrawerOpen,
        openInspectorDrawer: true,
        setNotice,
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
    }, [experience, setCompactViewport, setDrawerOpen]);

    const update = useCallback(
        (id: string, change: (draft: Draft) => Draft) =>
            setWorkspace(current => workspaceWithUpdatedDraft(current, id, change)),
        [],
    );
    const clearUnavailableRun = useCallback(
        (runId: string) =>
            update(active.id, draft =>
                draft.activeRunId === runId ? { ...draft, activeRunId: undefined } : draft,
            ),
        [active.id, update],
    );
    const patch = useCallback(
        (values: Partial<Draft>) => update(active.id, draft => ({ ...draft, ...values })),
        [active.id, update],
    );
    const formatActiveSql = useWorkspaceSqlFormatter(
        active,
        setWorkspace,
        editor,
        nativeParserEnabled,
        nativeParserStatus,
    );

    const evidence = useRunEvidence({
        activeRunId,
        connectionId: connection.id,
        loadHistory,
        setError,
        onRunUnavailable: clearUnavailableRun,
    });
    const { run, snapshot, setSnapshotForRun } = evidence;
    const trackSchemaRefresh = useSchemaRefreshAfterDdl(
        run,
        connection.id,
        importedReveal.refreshAfterImportedSqlRun,
    );
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

    const executionView = useWorkspaceExecutionView({
        active,
        connection,
        savingDraftIds,
        script,
        selectedScriptResult,
        copy,
        experience,
        view,
        trusted,
        unsupportedParameters,
        nativeParseSnapshot,
        pendingExecution,
        editor,
        demoMode,
        locale,
        onSelectConnection,
        workspaceRef,
        setWorkspace,
        update,
        evidence,
        importedReveal,
        setScripts,
        scriptFollowRef,
        trackSchemaRefresh,
        setExampleChartRunId,
        setViewForDraft,
        data,
        ui,
    });
    const { perform, addDraft } = executionView;

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

    const finishTabRename = (
        id: string,
        value: string,
        restoreFocus = false,
        saveAfterRename = true,
    ) => {
        const renamedDraft = updateTabRename(id, value, restoreFocus);
        if (saveAfterRename && renamedDraft) void saveDraft(renamedDraft);
    };

    const restoreDocumentRevision = createRevisionRestorer({
        perform,
        workspaceRef,
        setRestoreRevisionConfirmation,
        update,
        setNotice,
        data,
    });

    const loadSnapshot = useResultSnapshot({
        activeRunId,
        run,
        snapshot,
        setSnapshotForRun,
        onSnapshot: (runId, full) => {
            if (activeRunIdRef.current !== runId || workspaceRef.current.activeId !== active.id)
                return;
            const suggestion = recommendChart(full.columns, full.rows);
            if (active.chart.kind === 'table' && suggestion.config.kind !== 'table')
                patch({ chart: suggestion.config });
        },
    });

    useEffect(() => {
        if (
            !exampleChartRunId ||
            exampleChartRunId !== activeRunId ||
            run?.id !== exampleChartRunId ||
            !terminal(run)
        )
            return;
        if (snapshot?.runId === exampleChartRunId || run.resultState !== 'reopenable') {
            setExampleChartRunId(undefined);
            return;
        }
        void loadSnapshot()
            .catch(caught => setError(message(caught)))
            .finally(() => {
                setExampleChartRunId(current =>
                    current === exampleChartRunId ? undefined : current,
                );
            });
    }, [activeRunId, exampleChartRunId, loadSnapshot, run, setError, snapshot?.runId]);

    useEffect(() => {
        if (
            !run ||
            !['chart', 'map', 'indexes', 'plan', 'pipeline', 'runtime'].includes(view) ||
            !terminal(run) ||
            run.resultState !== 'reopenable' ||
            snapshot?.runId === run.id
        )
            return;
        void loadSnapshot().catch(caught => setError(message(caught)));
    }, [loadSnapshot, run, setError, snapshot?.runId, view]);

    const exports = createWorkspaceExports({
        setError,
        active,
        activeRunId,
        connection,
        activeRunIdRef,
        evidence,
    });
    const { loadProfile, loadPipeline } = exports;

    const showInspector = (next: Inspector) => {
        setInspector(next);
        setDrawerOpen(true);
        if (next === 'profile') void perform(loadProfile, 'save');
        if (next === 'pipeline') void perform(loadPipeline, 'save');
    };
    const inspectorDocked = drawerOpen;

    const trustConnection = () =>
        perform(async () => {
            if (
                !trusted &&
                !demoMode &&
                !window.confirm(
                    `Check these connection details before continuing:\n\nConnection: ${connectionLabel}\nServer: ${connection.host}\nDatabase: ${connection.database}\nUser: ${connection.username}\nAccess: read-only\n\nAllow read-only access so you can run queries?`,
                )
            )
                return;
            await post(`/connections/${encodeURIComponent(connection.id)}/trust`, {
                trusted: !trusted,
                confirmation: connection.id,
            });
            await onRefreshConnections();
            setNotice(
                demoMode
                    ? 'Sample data is ready. You can explore the workspace.'
                    : trusted
                      ? 'Read-only access was turned off.'
                      : 'Connection is ready for read-only queries.',
            );
        }, 'save');
    trustActionRef.current = trustConnection;

    const testConnection = () =>
        perform(async () => {
            const tested = await post<Connected>(
                `/connections/${encodeURIComponent(connection.id)}/test`,
            );
            await onRefreshConnections();
            setNotice(
                `Connection tested · ClickHouse ${tested.manifest?.serverVersion ?? 'server'}. Review the connection, then trust it to run queries.`,
            );
        }, 'save');
    testConnectionActionRef.current = testConnection;

    const openDocument = (document: QueryDocument) => {
        addDraft(draftFromDocument(document));
    };
    return createWorkspaceControllerModel({
        tabs,
        assistant,
        data,
        evidence,
        showInspector,
        importedReveal,
        editor,
        setWorkspace,
        openDocument,
        setView,
        trusted,
        restoreDocumentRevision,
        selectableRunId,
        nativeParserStatus,
        nativeParseSnapshot,
        unsupportedParameters,
        parameters,
        pendingExecution,
        patch,
        saveDraft,
        formatActiveSql,
        runActionTitle,
        setNativeParserStatus,
        setNativeParseSnapshot,
        script,
        setSelectedScriptResult,
        scriptFollowRef,
        update,
        inspectorDocked,
        storageError,
        workspace,
        savingDraftIds,
        finishTabRename,
        sqlExamples,
        workspaceRef,
        emptySqlActionRef,
        ui,
        executionView,
        exports,
    });
}

function createWorkspaceExports({
    setError,
    active,
    activeRunId,
    connection,
    activeRunIdRef,
    evidence,
}: {
    setError: ReturnType<typeof useWorkspaceNotifications>['setError'];
    active: ReturnType<typeof useWorkspaceTabs>['active'];
    activeRunId: string | undefined;
    connection: WorkspaceProps['connection'];
    activeRunIdRef: import('react').RefObject<string | undefined>;
    evidence: ReturnType<typeof useRunEvidence>;
}) {
    const { run, snapshot, setProfileForRun, setPipelineForRun, setFlamegraphForRun } = evidence;

    const exportCurrentCsv = async () => {
        if (!run) return;
        try {
            if (isFrontendDemoPreview || run.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                const full =
                    snapshot?.runId === run.id
                        ? snapshot
                        : await api<Result>(`/runs/${encodeURIComponent(run.id)}/snapshot`);
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
        const baseName = active.name
            .trim()
            .replace(/\.sql$/i, '')
            .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
            .trim();
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
        const response = await api<ProfilePipeline>(
            `/runs/${encodeURIComponent(runId)}/profile/pipeline`,
        );
        if (activeRunIdRef.current !== runId) return;
        setPipelineForRun(runId, response);
    };

    const loadFlamegraph = async () => {
        if (!activeRunId || connection.manifest?.traceLog?.available !== true) return;
        const runId = activeRunId;
        const response = await api<FlamegraphSnapshot>(
            `/runs/${encodeURIComponent(runId)}/profile/flamegraph`,
        );
        if (activeRunIdRef.current === runId) setFlamegraphForRun(runId, response);
    };
    return { loadProfile, loadPipeline, loadFlamegraph, exportCurrentQuery, exportCurrentCsv };
}

function createRevisionRestorer({
    perform,
    workspaceRef,
    setRestoreRevisionConfirmation,
    update,
    setNotice,
    data,
}: {
    perform: ReturnType<typeof useWorkspaceExecution>['perform'];
    workspaceRef: import('react').RefObject<WorkspaceState>;
    setRestoreRevisionConfirmation: import('react').Dispatch<
        import('react').SetStateAction<QueryDocument | undefined>
    >;
    update: (id: string, change: (draft: Draft) => Draft) => void;
    setNotice: ReturnType<typeof useWorkspaceNotifications>['setNotice'];
    data: ReturnType<typeof useWorkspaceData>;
}) {
    const {
        revisionsDocumentId,
        documentRevisions,
        documents,
        setDocuments,
        loadDocumentRevisions,
    } = data;

    return (revision: QueryDocument, confirmed = false) =>
        void perform(async () => {
            const draft = workspaceRef.current.tabs.find(
                item => item.id === workspaceRef.current.activeId,
            );
            if (!draft?.serverId || draft.serverId !== revision.id)
                throw new Error('Open the saved query before restoring one of its versions.');
            const latestSaved =
                revisionsDocumentId === draft.serverId
                    ? documentRevisions[0]
                    : documents.find(document => document.id === draft.serverId);
            if (!latestSaved || latestSaved.deletedAt)
                throw new Error(
                    'The latest saved version could not be checked. Refresh saved queries and try again.',
                );
            const hasUnsavedChanges =
                draft.baseRevision !== latestSaved.revision ||
                !sameSavedContent(draft, latestSaved);
            if (hasUnsavedChanges && !confirmed) {
                setRestoreRevisionConfirmation(revision);
                return;
            }
            const restoreBase: QueryDocument = {
                ...latestSaved,
                name: draft.name,
                sql: draft.sql,
                parameters: { ...draft.parameters },
                chart: { ...draft.chart, ys: [...draft.chart.ys] },
                runId: draft.activeRunId,
                parentDocumentId: draft.parentDocumentId,
                kind: draft.kind,
                metric: draft.metric
                    ? {
                          ...draft.metric,
                          dimensions: [...draft.metric.dimensions],
                          sourceColumns: [...draft.metric.sourceColumns],
                      }
                    : undefined,
                dependencies: [...draft.dependencies],
            };
            const restored = await post<QueryDocument>(
                `/documents/${encodeURIComponent(draft.serverId)}/restore-revision`,
                {
                    revision: revision.revision,
                    baseRevision: latestSaved.revision,
                },
            );
            const currentDraft = workspaceRef.current.tabs.find(item => item.id === draft.id);
            const editedDuringRestore = Boolean(
                currentDraft && !sameSavedContent(currentDraft, restoreBase),
            );
            update(draft.id, current =>
                editedDuringRestore
                    ? { ...current, baseRevision: restored.revision }
                    : {
                          ...checkpoint(current, `Before restoring Version ${revision.revision}`),
                          name: restored.name,
                          sql: restored.sql,
                          baseRevision: restored.revision,
                          parameters: { ...restored.parameters },
                          chart: { ...restored.chart, ys: [...restored.chart.ys] },
                          parentRunId: undefined,
                          parentDocumentId: restored.parentDocumentId,
                          kind: restored.kind,
                          metric: restored.metric
                              ? {
                                    ...restored.metric,
                                    dimensions: [...restored.metric.dimensions],
                                    sourceColumns: [...restored.metric.sourceColumns],
                                }
                              : undefined,
                          dependencies: [...restored.dependencies],
                          from: 0,
                          to: 0,
                      },
            );
            setDocuments(current => [
                restored,
                ...current.filter(document => document.id !== restored.id),
            ]);
            setNotice(
                editedDuringRestore
                    ? `Restored Version ${revision.revision} as Version ${restored.revision}. Edits made during restore are still in your draft.`
                    : `Restored Version ${revision.revision} as Version ${restored.revision}.`,
            );
            await loadDocumentRevisions(restored.id);
        }, 'save');
}

function useWorkspaceExecutionView({
    active,
    connection,
    savingDraftIds,
    script,
    selectedScriptResult,
    copy,
    experience,
    view,
    trusted,
    unsupportedParameters,
    nativeParseSnapshot,
    pendingExecution,
    editor,
    demoMode,
    locale,
    onSelectConnection,
    workspaceRef,
    setWorkspace,
    update,
    evidence,
    importedReveal,
    setScripts,
    scriptFollowRef,
    trackSchemaRefresh,
    setExampleChartRunId,
    setViewForDraft,
    data,
    ui,
}: {
    active: ReturnType<typeof useWorkspaceTabs>['active'];
    connection: WorkspaceProps['connection'];
    savingDraftIds: Record<string, boolean>;
    script: Script | undefined;
    selectedScriptResult: string | undefined;
    copy: WorkspaceProps['copy'];
    experience: WorkspaceProps['experience'];
    view: ResultsView;
    trusted: boolean;
    unsupportedParameters: boolean;
    nativeParseSnapshot: NativeParseSnapshot | undefined;
    pendingExecution: ReturnType<typeof usePendingExecution>;
    editor: import('react').RefObject<EditorHandle | null>;
    demoMode: WorkspaceProps['demoMode'];
    locale: WorkspaceProps['locale'];
    onSelectConnection: WorkspaceProps['onSelectConnection'];
    workspaceRef: import('react').RefObject<WorkspaceState>;
    setWorkspace: import('react').Dispatch<import('react').SetStateAction<WorkspaceState>>;
    update: (id: string, change: (draft: Draft) => Draft) => void;
    evidence: ReturnType<typeof useRunEvidence>;
    importedReveal: ReturnType<typeof useImportedTableReveal>;
    setScripts: import('react').Dispatch<import('react').SetStateAction<Record<string, Script>>>;
    scriptFollowRef: ReturnType<typeof useScriptExecution>;
    trackSchemaRefresh: ReturnType<typeof useSchemaRefreshAfterDdl>;
    setExampleChartRunId: import('react').Dispatch<
        import('react').SetStateAction<string | undefined>
    >;
    setViewForDraft: ReturnType<typeof useScopedValue<ResultsView>>[1];
    data: ReturnType<typeof useWorkspaceData>;
    ui: ReturnType<typeof useWorkspaceUiState>;
}) {
    const { documents, documentsLoaded, documentsReadError, history, loadHistory } = data;
    const { run, snapshot } = evidence;
    const {
        failedQueryError,
        compactViewport,
        setError,
        setNotice,
        busy,
        setBusy,
        setCancelling,
        clearFailedQueryError,
        storeFailedQueryError,
    } = ui;

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
        script,
        scriptResultSelected: selectedScriptResult === `${script?.id}:${active.activeRunId}`,
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

    const outputVisible = Boolean(
        run ||
        failedQueryError ||
        script ||
        pendingExecution.execution ||
        requestedResultsView === 'sqlmap',
    );
    const panels = useWorkspacePanels({
        activeDraftId: active.id,
        compactViewport,
        hasOutput: outputVisible,
    });
    const detachedEditor = useDetachedQueryEditor({
        activeDraftId: active.id,
        activeName: active.name,
        experience,
        panels,
        editorRef: editor,
        copy: copy.common,
        setError,
        setNotice,
    });

    const {
        perform,
        execute,
        runExample,
        cancel,
        openRun,
        openNewDraft,
        openSqlDraft,
        startBlankSql,
        addDraft,
    } = useWorkspaceExecution({
        active,
        connection,
        trusted,
        experience,
        demoMode,
        locale,
        copy,
        onSelectConnection,
        workspaceRef,
        setWorkspace,
        editor,
        update,
        panels,
        evidence,
        importedReveal,
        pendingExecution,
        script,
        setScripts,
        scriptFollowRef,
        trackSchemaRefresh,
        loadHistory,
        busy,
        setBusy,
        setCancelling,
        setExampleChartRunId,
        setError,
        setNotice,
        clearFailedQueryError,
        storeFailedQueryError,
        setViewForDraft,
    });

    return {
        perform,
        addDraft,
        sortedHistory,
        savedDocument,
        saveStatus,
        openSqlDraft,
        openRun,
        execute,
        cancel,
        detachedEditor,
        panels,
        viewState,
        sqlMapStatement,
        sqlMapParseStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        openNewDraft,
        runExample,
        startBlankSql,
        outputVisible,
        visibleResultsView,
    };
}

function useWorkspaceHelpState({
    revealActiveTab,
}: {
    revealActiveTab: ReturnType<typeof useWorkspaceTabs>['revealActiveTab'];
}) {
    const [helpPanelOpen, setHelpPanelOpen] = useState(false);
    const [observabilityOpen, setObservabilityOpen] = useState(false);
    const [helpPanelSection, setHelpPanelSection] = useState<HelpPanelSection>('tour');
    const helpPanelOpenerRef = useRef<HTMLButtonElement | null>(null);
    const openHelpPanel = useCallback(
        (section: HelpPanelSection, opener: HTMLButtonElement) => {
            helpPanelOpenerRef.current = opener;
            if (section === 'examples') revealActiveTab();
            setHelpPanelSection(section);
            setHelpPanelOpen(true);
        },
        [revealActiveTab],
    );
    const closeHelpPanel = useCallback((restoreFocus = true) => {
        setHelpPanelOpen(false);
        if (restoreFocus) window.requestAnimationFrame(() => helpPanelOpenerRef.current?.focus());
    }, []);
    const openExamples = useCallback(
        (opener: HTMLButtonElement) => openHelpPanel('examples', opener),
        [openHelpPanel],
    );
    const openHelp = useCallback(
        (opener: HTMLButtonElement) => openHelpPanel('tour', opener),
        [openHelpPanel],
    );

    return {
        helpPanelOpen,
        openExamples,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        observabilityOpen,
        openHelp,
    };
}

function useWorkspaceUiState({
    experience,
    revealActiveTab,
    active,
}: {
    experience: WorkspaceProps['experience'];
    revealActiveTab: ReturnType<typeof useWorkspaceTabs>['revealActiveTab'];
    active: ReturnType<typeof useWorkspaceTabs>['active'];
}) {
    const [inspectorsByExperience, setInspectorsByExperience] = useState<
        Record<ExperienceLevel, Inspector>
    >({
        beginner: 'schema',
        expert: 'schema',
    });
    const experienceRef = useRef(experience);
    experienceRef.current = experience;
    const inspector = inspectorsByExperience[experience];
    const setInspector = useCallback((next: Inspector) => {
        setInspectorsByExperience(current => ({ ...current, [experienceRef.current]: next }));
    }, []);
    const inspectorRef = useRef(inspector);
    inspectorRef.current = inspector;
    const [compactViewport, setCompactViewport] = useState(
        () => window.matchMedia('(max-width: 850px)').matches,
    );
    const [drawerOpen, setDrawerOpen] = useState(
        () => experience === 'expert' && !window.matchMedia('(max-width: 850px)').matches,
    );
    const [importOpen, setImportOpen] = useState(false),
        [exportOpen, setExportOpen] = useState(false);
    const [restoreRevisionConfirmation, setRestoreRevisionConfirmation] = useState<QueryDocument>();
    const {
        helpPanelOpen,
        openExamples,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        observabilityOpen,
        openHelp,
    } = useWorkspaceHelpState({ revealActiveTab });
    const [busy, setBusy] = useState<BusyAction>('');
    const [cancelling, setCancelling] = useState(false);
    const { error, setError, notice, setNotice } = useWorkspaceNotifications();
    const {
        error: failedQueryError,
        clear: clearFailedQueryError,
        record: storeFailedQueryError,
    } = useFailedQueryErrors(active.id);
    const [search, setSearch] = useState('');
    return {
        busy,
        setError,
        setSearch,
        setInspector,
        setDrawerOpen,
        setNotice,
        inspector,
        setCompactViewport,
        failedQueryError,
        compactViewport,
        setBusy,
        setCancelling,
        clearFailedQueryError,
        storeFailedQueryError,
        inspectorRef,
        setRestoreRevisionConfirmation,
        drawerOpen,
        search,
        cancelling,
        error,
        notice,
        setImportOpen,
        setExportOpen,
        helpPanelOpen,
        openExamples,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        observabilityOpen,
        importOpen,
        exportOpen,
        restoreRevisionConfirmation,
        openHelp,
    };
}

function createWorkspaceControllerModel({
    tabs,
    assistant,
    data,
    evidence,
    showInspector,
    importedReveal,
    editor,
    setWorkspace,
    openDocument,
    setView,
    trusted,
    restoreDocumentRevision,
    selectableRunId,
    nativeParserStatus,
    nativeParseSnapshot,
    unsupportedParameters,
    parameters,
    pendingExecution,
    patch,
    saveDraft,
    formatActiveSql,
    runActionTitle,
    setNativeParserStatus,
    setNativeParseSnapshot,
    script,
    setSelectedScriptResult,
    scriptFollowRef,
    update,
    inspectorDocked,
    storageError,
    workspace,
    savingDraftIds,
    finishTabRename,
    sqlExamples,
    workspaceRef,
    emptySqlActionRef,
    ui,
    executionView,
    exports,
}: {
    tabs: ReturnType<typeof useWorkspaceTabs>;
    assistant: ReturnType<typeof useWorkspaceAssistant>;
    data: ReturnType<typeof useWorkspaceData>;
    evidence: ReturnType<typeof useRunEvidence>;
    showInspector: (next: Inspector) => void;
    importedReveal: ReturnType<typeof useImportedTableReveal>;
    editor: import('react').RefObject<EditorHandle | null>;
    setWorkspace: import('react').Dispatch<import('react').SetStateAction<WorkspaceState>>;
    openDocument: (document: QueryDocument) => void;
    setView: Dispatch<SetStateAction<ResultsView>>;
    trusted: boolean;
    restoreDocumentRevision: ReturnType<typeof createRevisionRestorer>;
    selectableRunId: string | undefined;
    nativeParserStatus: NativeParserStatus;
    nativeParseSnapshot: NativeParseSnapshot | undefined;
    unsupportedParameters: boolean;
    parameters: SqlParameter[];
    pendingExecution: ReturnType<typeof usePendingExecution>;
    patch: (values: Partial<Draft>) => void;
    saveDraft: ReturnType<typeof useWorkspaceDocumentSave>;
    formatActiveSql: ReturnType<typeof useWorkspaceSqlFormatter>;
    runActionTitle: (
        capability: WorkspaceRunCapability | undefined,
        action: WorkspaceRunCapabilityAction,
    ) => string | undefined;
    setNativeParserStatus: import('react').Dispatch<
        import('react').SetStateAction<NativeParserStatus>
    >;
    setNativeParseSnapshot: import('react').Dispatch<
        import('react').SetStateAction<NativeParseSnapshot | undefined>
    >;
    script: Script | undefined;
    setSelectedScriptResult: ReturnType<typeof useScopedValue<string>>[1];
    scriptFollowRef: ReturnType<typeof useScriptExecution>;
    update: (id: string, change: (draft: Draft) => Draft) => void;
    inspectorDocked: boolean;
    storageError: ReturnType<typeof useWorkspacePersistence>;
    workspace: WorkspaceState;
    savingDraftIds: Record<string, boolean>;
    finishTabRename: (
        id: string,
        value: string,
        restoreFocus?: boolean,
        saveAfterRename?: boolean,
    ) => void;
    sqlExamples: SqlExample[];
    workspaceRef: import('react').RefObject<WorkspaceState>;
    emptySqlActionRef: import('react').RefObject<HTMLButtonElement | null>;
    ui: ReturnType<typeof useWorkspaceUiState>;
    executionView: ReturnType<typeof useWorkspaceExecutionView>;
    exports: ReturnType<typeof createWorkspaceExports>;
}) {
    const {
        inspector,
        search,
        setSearch,
        busy,
        cancelling,
        failedQueryError,
        error,
        setError,
        notice,
        setNotice,
        drawerOpen,
        setImportOpen,
        setExportOpen,
        clearFailedQueryError,
        helpPanelOpen,
        openExamples,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        setDrawerOpen,
        observabilityOpen,
        importOpen,
        exportOpen,
        restoreRevisionConfirmation,
        setRestoreRevisionConfirmation,
        openHelp,
    } = ui;
    const {
        sortedHistory,
        savedDocument,
        saveStatus,
        openSqlDraft,
        openRun,
        perform,
        execute,
        cancel,
        detachedEditor,
        panels,
        viewState,
        sqlMapStatement,
        sqlMapParseStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        openNewDraft,
        runExample,
        startBlankSql,
        outputVisible,
        visibleResultsView,
    } = executionView;
    const { loadProfile, loadPipeline, loadFlamegraph, exportCurrentQuery, exportCurrentCsv } =
        exports;

    return {
        tabs,
        assistant,
        data,
        evidence,
        inspector,
        showInspector,
        search,
        setSearch,
        sortedHistory,
        savedDocument,
        saveStatus,
        importedReveal,
        editor,
        openSqlDraft,
        setWorkspace,
        openRun,
        openDocument,
        perform,
        loadProfile,
        loadPipeline,
        setView,
        trusted,
        restoreDocumentRevision,
        selectableRunId,
        nativeParserStatus,
        nativeParseSnapshot,
        execute,
        busy,
        unsupportedParameters,
        parameters,
        pendingExecution,
        cancelling,
        patch,
        saveDraft,
        formatActiveSql,
        cancel,
        runActionTitle,
        setNativeParserStatus,
        setNativeParseSnapshot,
        detachedEditor,
        panels,
        viewState,
        failedQueryError,
        script,
        setSelectedScriptResult,
        scriptFollowRef,
        update,
        loadFlamegraph,
        inspectorDocked,
        error,
        setError,
        notice,
        setNotice,
        storageError,
        drawerOpen,
        setImportOpen,
        setExportOpen,
        workspace,
        savingDraftIds,
        finishTabRename,
        clearFailedQueryError,
        helpPanelOpen,
        openExamples,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        sqlExamples,
        sqlMapStatement,
        sqlMapParseStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        openNewDraft,
        runExample,
        startBlankSql,
        workspaceRef,
        outputVisible,
        visibleResultsView,
        emptySqlActionRef,
        setDrawerOpen,
        observabilityOpen,
        importOpen,
        exportOpen,
        exportCurrentQuery,
        exportCurrentCsv,
        restoreRevisionConfirmation,
        setRestoreRevisionConfirmation,
        openHelp,
    };
}
