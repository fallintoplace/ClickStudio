import type { SqlExample } from '../help/examples/sql-examples';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import type { FlamegraphSnapshot } from '../../shared/queries/inspection/flamegraph';
import type { NativeParserStatus, NativeParseSnapshot } from '../../shared/sql/parser';
import { exportCsv, recommendChart } from '../../shared/queries/results/results';
import { parameterNames, type SqlParameter } from '../../shared/sql/sql';
import type { ProfilePipeline, QueryProfile } from '../../shared/queries/inspection/types';
import type { QueryDocument } from '../../shared/queries/saved-queries/types';
import type { Result } from '../../shared/queries/results/types';
import type { Run, Script } from '../../shared/queries/execution/types';
import { sameSavedContent } from './queries/saved-queries/draft-save';
import {
    api,
    download,
    isFrontendDemoPreview,
    message,
    post,
    RequestError,
} from '../common/requests/api';
import { documentFailureNotice } from './layout/notifications/workspace-notification-policy';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../common/requests/sources/cloud-connection';
import type { EditorHandle } from './editor/components/SqlEditor';
import { terminal } from './queries/execution/status';
import type { HelpPanelSection } from '../help/WorkspaceHelpPanel';
import type { Copy, ExperienceLevel, Locale } from '../common/translations/i18n';
import { PLAYGROUND_CONNECTION_ID } from '../common/requests/sources/playground';
import { sqlExamplesFor } from '../help/examples/sql-examples';
import { useFailedQueryErrors } from './queries/execution/useFailedQueryErrors';
import {
    isSchemaChangingSql,
    useImportedTableReveal,
} from '../database/tables/useImportedTableReveal';
import { usePendingExecution } from './queries/execution/usePendingExecution';
import { useResultSnapshot } from './queries/execution/useResultSnapshot';
import { useRunEvidence } from './queries/execution/useRunEvidence';
import { useScopedValue } from '../common/browser/useScopedValue';
import { useScriptExecution } from './queries/execution/useScriptExecution';
import {
    useDefaultAssistantRunContext,
    useWorkspaceAssistant,
} from '../assistant/proposals/useWorkspaceAssistant';
import { useWorkspaceData } from './useWorkspaceData';
import { useWorkspacePanels } from './layout/panels/useWorkspacePanels';
import { useWorkspacePersistence } from './editor/drafts/useWorkspacePersistence';
import { useWorkspaceTabs } from './editor/tabs/useWorkspaceTabs';
import { initialWorkspaceState, workspaceStateKey } from './editor/drafts/workspace-initial-state';
import type { WorkspaceState } from './editor/drafts/workspace-state';
import { checkpoint, draftFromDocument, type Draft } from './editor/drafts/workspace-state';
import type {
    BusyAction,
    Connected,
    Inspector,
    ResultsView,
    WorkspaceActionRef,
    WorkspaceRunCapability,
    WorkspaceRunCapabilityAction,
} from './workspace-types';
import { useDetachedQueryEditor } from './layout/windows/useDetachedQueryEditor';
import { useWorkspaceDocumentSave } from './queries/saved-queries/useWorkspaceDocumentSave';
import { useWorkspaceExecution } from './queries/execution/useWorkspaceExecution';
import {
    useWorkspaceNotifications,
    type WorkspaceFeedback,
} from './layout/notifications/useWorkspaceNotifications';
import { useWorkspaceSqlFormatter } from './editor/formatting/useWorkspaceSqlFormatter';
import { useWorkspaceViewState } from './layout/useWorkspaceViewState';

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
    const { active, finishTabRename: updateTabRename } = tabs;
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
    const ui = useWorkspaceUiState({ experience, active });
    const {
        busy,
        setError,
        clearToast,
        setDraftFeedback,
        setSearch,
        setInspector,
        setDrawerOpen,
        inspector,
        setCompactViewport,
        inspectorRef,
        setRestoreRevisionConfirmation,
        drawerOpen,
    } = ui;

    useDismissVisibleDraftToast(active.id, clearToast);

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
    const currentConnection = connections.find(item => item.id === connection.id) ?? connection;
    const trusted = currentConnection.trusted;
    const runActionTitle = createRunActionTitle({
        trusted,
        busy,
        unsupportedParameters,
        connection,
        copy: copy.common,
    });

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
        (values: Partial<Draft>) => {
            update(active.id, draft => ({ ...draft, ...values }));
            setDraftFeedback(active.id, current =>
                current?.tone === 'info' ? undefined : current,
            );
        },
        [active.id, update, setDraftFeedback],
    );
    const formatActiveSql = useWorkspaceSqlFormatter(
        active,
        setWorkspace,
        editor,
        nativeParserEnabled,
        nativeParserStatus,
        Boolean(assistant.editorProposal),
    );

    const evidence = useRunEvidence({
        activeRunId,
        connectionId: connection.id,
        loadHistory,
        onRunUnavailable: clearUnavailableRun,
    });
    const { run, snapshot, setSnapshotForRun, setAssetReadFeedback } = evidence;
    const trackSchemaRefresh = useSchemaRefreshAfterDdl(
        run,
        connection.id,
        importedReveal.refreshAfterImportedSqlRun,
    );
    const selectableRunId = run && terminal(run) ? run.id : undefined;
    useDefaultAssistantRunContext(selectableRunId, includeRun, assistantBusy, setIncludeRun);
    const pendingExecution = usePendingExecution({ activeDraftId: active.id, busy, run, script });
    const [scriptReadFeedback, reportScriptReadError] = useScriptReadFeedback(active.scriptId);
    const scriptFollowRef = useScriptExecution({
        scriptId: active.scriptId,
        draftId: active.id,
        updateDraft: update,
        setScripts,
        loadHistory,
        setReadError: reportScriptReadError,
        onComplete: importedReveal.refreshAfterImportedSqlScript,
    });

    const executionView = useWorkspaceExecutionView({
        active,
        reviewingSql: Boolean(assistant.editorProposal),
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

    const reportDocumentFailure = createDocumentFailureReporter({
        workspaceRef,
        setWorkspace,
        setDraftFeedback,
        setError,
        panels: executionView.panels,
    });

    const saveDraft = useWorkspaceDocumentSave({
        active,
        reviewingSql: Boolean(assistant.editorProposal),
        busy,
        connectionId: connection.id,
        workspaceRef,
        inspectorRef,
        perform,
        updateDraft: update,
        setSavingDraftIds,
        setDocuments,
        loadDocumentRevisions,
        setDraftFeedback,
        clearToast,
        onFailure: (draft, caught) => reportDocumentFailure(draft, 'save', caught),
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
        data,
        setDraftFeedback,
        clearToast,
        reportDocumentFailure,
    });

    const loadSnapshot = useResultSnapshot({
        activeRunId,
        run,
        snapshot,
        setSnapshotForRun,
        onSnapshot: (runId, full) => {
            setAssetReadFeedback(runId, undefined);
            if (activeRunIdRef.current !== runId || workspaceRef.current.activeId !== active.id)
                return;
            const suggestion = recommendChart(full.columns, full.rows);
            if (active.chart.kind === 'table' && suggestion.config.kind !== 'table')
                patch({ chart: suggestion.config });
        },
    });

    const reportSnapshotFailure = useSnapshotReadFailure(loadSnapshot, setAssetReadFeedback);

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
            .catch(caught => reportSnapshotFailure(exampleChartRunId, caught))
            .finally(() => {
                setExampleChartRunId(current =>
                    current === exampleChartRunId ? undefined : current,
                );
            });
    }, [activeRunId, exampleChartRunId, loadSnapshot, run, reportSnapshotFailure, snapshot?.runId]);

    useEffect(() => {
        if (
            !run ||
            !['chart', 'map', 'indexes', 'plan', 'pipeline', 'runtime'].includes(view) ||
            !terminal(run) ||
            run.resultState !== 'reopenable' ||
            snapshot?.runId === run.id
        )
            return;
        void loadSnapshot().catch(caught => reportSnapshotFailure(run.id, caught));
    }, [loadSnapshot, run, reportSnapshotFailure, snapshot?.runId, view]);

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

    const trustConnection = () =>
        perform(
            async () => {
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
            },
            'save',
            caught =>
                setError('Couldn’t update connection access. Check its details and try again.', {
                    detail: message(caught),
                }),
        );
    trustActionRef.current = trustConnection;

    const testConnection = () =>
        perform(
            async () => {
                await post<Connected>(`/connections/${encodeURIComponent(connection.id)}/test`);
                await onRefreshConnections();
            },
            'save',
            caught =>
                setError('Couldn’t test the connection. Check its details and try again.', {
                    detail: message(caught),
                }),
        );
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
        scriptReadFeedback,
        update,
        inspectorDocked: drawerOpen,
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

function useDismissVisibleDraftToast(
    draftId: string,
    clearToast: ReturnType<typeof useWorkspaceNotifications>['clearToast'],
) {
    useEffect(() => {
        clearToast(`draft:${draftId}`);
        clearToast(`query:${draftId}`);
    }, [draftId, clearToast]);
}

function createRunActionTitle(options: Parameters<typeof workspaceRunActionTitle>[2]) {
    return (capability: WorkspaceRunCapability | undefined, action: WorkspaceRunCapabilityAction) =>
        workspaceRunActionTitle(capability, action, options);
}

function useSnapshotReadFailure(
    loadSnapshot: ReturnType<typeof useResultSnapshot>,
    setAssetReadFeedback: ReturnType<typeof useRunEvidence>['setAssetReadFeedback'],
) {
    const reportSnapshotFailure = useCallback(
        function report(runId: string, caught: unknown) {
            setAssetReadFeedback(runId, {
                tone: 'error',
                message: 'Couldn’t load the result data. Try again.',
                detail: message(caught),
                retry: () => void loadSnapshot().catch(next => report(runId, next)),
            });
        },
        [loadSnapshot, setAssetReadFeedback],
    );

    return reportSnapshotFailure;
}

function useScriptReadFeedback(scriptId?: string) {
    const [scriptReadFeedback, setScriptReadFeedback] = useScopedValue<
        WorkspaceFeedback | undefined
    >(scriptId);
    const reportScriptReadError = useCallback(
        (detail: string) => {
            if (!scriptId) return;
            setScriptReadFeedback(
                scriptId,
                detail
                    ? {
                          tone: 'warning',
                          message: 'Couldn’t refresh the script status. Retrying…',
                          detail,
                      }
                    : undefined,
            );
        },
        [scriptId, setScriptReadFeedback],
    );
    return [scriptReadFeedback, reportScriptReadError] as const;
}

function createDocumentFailureReporter({
    workspaceRef,
    setWorkspace,
    setDraftFeedback,
    setError,
    panels,
}: {
    workspaceRef: import('react').RefObject<WorkspaceState>;
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
    setDraftFeedback: ReturnType<typeof useWorkspaceUiState>['setDraftFeedback'];
    setError: ReturnType<typeof useWorkspaceNotifications>['setError'];
    panels: ReturnType<typeof useWorkspaceExecutionView>['panels'];
}) {
    return (draft: Pick<Draft, 'id' | 'name'>, operation: 'save' | 'restore', caught: unknown) => {
        const failure = documentFailureNotice(
            draft.name,
            operation,
            caught instanceof RequestError
                ? {
                      status: caught.status,
                      code: caught.detail.code,
                  }
                : {},
        );
        setDraftFeedback(draft.id, { ...failure, detail: message(caught) }, true);
        if (workspaceRef.current.activeId !== draft.id)
            setError(failure.message, {
                ...failure,
                detail: message(caught),
                context: `draft:${draft.id}`,
                action: workspaceRef.current.tabs.some(item => item.id === draft.id)
                    ? {
                          label: 'Open tab',
                          onSelect: () => {
                              if (!workspaceRef.current.tabs.some(item => item.id === draft.id))
                                  return;
                              setWorkspace(current => ({ ...current, activeId: draft.id }));
                              panels.revealPanelTemporarily('query', draft.id);
                          },
                      }
                    : undefined,
            });
    };
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
    const {
        run,
        snapshot,
        setProfileForRun,
        setPipelineForRun,
        setFlamegraphForRun,
        setAssetReadFeedback,
    } = evidence;
    const loadAsset = async (
        runId: string,
        label: string,
        task: () => Promise<void>,
    ): Promise<void> => {
        try {
            await task();
            setAssetReadFeedback(runId, undefined);
        } catch (caught) {
            setAssetReadFeedback(runId, {
                tone: 'error',
                message: `Couldn’t load ${label}. Try again.`,
                detail: message(caught),
                retry: () => void loadAsset(runId, label, task),
            });
        }
    };

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
            setError('Couldn’t prepare the CSV export. Try again.', { detail: message(caught) });
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
        await loadAsset(runId, 'the query profile', async () => {
            const response = await api<QueryProfile>(`/runs/${encodeURIComponent(runId)}/profile`);
            setProfileForRun(runId, response);
        });
    };

    const loadPipeline = async () => {
        if (!activeRunId) return;
        if (connection.manifest?.pipeline.available === false) return;
        const runId = activeRunId;
        await loadAsset(runId, 'the query pipeline', async () => {
            const response = await api<ProfilePipeline>(
                `/runs/${encodeURIComponent(runId)}/profile/pipeline`,
            );
            if (activeRunIdRef.current !== runId) return;
            setPipelineForRun(runId, response);
        });
    };

    const loadFlamegraph = async () => {
        if (!activeRunId || connection.manifest?.traceLog?.available !== true) return;
        const runId = activeRunId;
        await loadAsset(runId, 'the flamegraph', async () => {
            const response = await api<FlamegraphSnapshot>(
                `/runs/${encodeURIComponent(runId)}/profile/flamegraph`,
            );
            if (activeRunIdRef.current === runId) setFlamegraphForRun(runId, response);
        });
    };
    return { loadProfile, loadPipeline, loadFlamegraph, exportCurrentQuery, exportCurrentCsv };
}

function createRevisionRestorer({
    perform,
    workspaceRef,
    setRestoreRevisionConfirmation,
    update,
    data,
    setDraftFeedback,
    clearToast,
    reportDocumentFailure,
}: {
    perform: ReturnType<typeof useWorkspaceExecution>['perform'];
    workspaceRef: import('react').RefObject<WorkspaceState>;
    setRestoreRevisionConfirmation: import('react').Dispatch<
        import('react').SetStateAction<QueryDocument | undefined>
    >;
    update: (id: string, change: (draft: Draft) => Draft) => void;
    setDraftFeedback: ReturnType<typeof useScopedValue<WorkspaceFeedback | undefined>>[1];
    clearToast: ReturnType<typeof useWorkspaceNotifications>['clearToast'];
    reportDocumentFailure: (
        draft: Pick<Draft, 'id' | 'name'>,
        operation: 'save' | 'restore',
        caught: unknown,
    ) => void;
    data: ReturnType<typeof useWorkspaceData>;
}) {
    const {
        revisionsDocumentId,
        documentRevisions,
        documents,
        setDocuments,
        loadDocumentRevisions,
    } = data;

    return (revision: QueryDocument, confirmed = false) => {
        const target = workspaceRef.current.tabs.find(
            item => item.id === workspaceRef.current.activeId,
        );
        void perform(
            async () => {
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
                              ...checkpoint(
                                  current,
                                  `Before restoring Version ${revision.revision}`,
                              ),
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
                clearToast(`draft:${draft.id}`);
                setDraftFeedback(
                    draft.id,
                    {
                        tone: 'info',
                        message: editedDuringRestore
                            ? `Restored Version ${revision.revision} as Version ${restored.revision}. Edits made during restore are still in your draft.`
                            : `Restored Version ${revision.revision} as Version ${restored.revision}.`,
                    },
                    true,
                );
                await loadDocumentRevisions(restored.id);
            },
            'save',
            caught => {
                reportDocumentFailure(
                    target ?? { id: `document:${revision.id}`, name: revision.name },
                    'restore',
                    caught,
                );
            },
        );
    };
}

function useWorkspaceExecutionView({
    active,
    reviewingSql,
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
    reviewingSql: boolean;
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
        setDraftFeedback,
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
        active.activeRunId ||
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
        setError,
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
        reviewingSql,
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
        setDraftFeedback,
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

function useWorkspaceHelpState() {
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
    const openHelp = useCallback(
        (opener: HTMLButtonElement) => openHelpPanel('tour', opener),
        [openHelpPanel],
    );

    return {
        helpPanelOpen,
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
    active,
}: {
    experience: WorkspaceProps['experience'];
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
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        observabilityOpen,
        openHelp,
    } = useWorkspaceHelpState();
    const [busy, setBusy] = useState<BusyAction>('');
    const [cancelling, setCancelling] = useState(false);
    const { toast, setError, dismissToast, clearToast } = useWorkspaceNotifications();
    const [draftFeedback, setDraftFeedback] = useScopedValue<WorkspaceFeedback | undefined>(
        active.id,
    );
    const {
        error: failedQueryError,
        clear: clearFailedQueryError,
        record: storeFailedQueryError,
    } = useFailedQueryErrors(active.id);
    const [search, setSearch] = useState('');
    return {
        busy,
        setError,
        clearToast,
        setDraftFeedback,
        draftFeedback,
        toast,
        dismissToast,
        setSearch,
        setInspector,
        setDrawerOpen,
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
        setImportOpen,
        setExportOpen,
        helpPanelOpen,
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
    scriptReadFeedback,
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
    scriptReadFeedback: WorkspaceFeedback | undefined;
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
        setError,
        toast,
        dismissToast,
        draftFeedback,
        drawerOpen,
        setImportOpen,
        setExportOpen,
        clearFailedQueryError,
        helpPanelOpen,
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
        scriptReadFeedback,
        update,
        loadFlamegraph,
        inspectorDocked,
        setError,
        toast,
        dismissToast,
        draftFeedback,
        storageError,
        drawerOpen,
        setImportOpen,
        setExportOpen,
        workspace,
        savingDraftIds,
        finishTabRename,
        clearFailedQueryError,
        helpPanelOpen,
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
