import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { parameterNames, selectedStatement, splitSql } from '../shared/sql';
import type { Run, RunKind, Script } from '../shared/types';
import { DEFAULT_LIMITS } from '../shared/types';
import { rememberRunIds } from '../shared/workspace-view';
import { message, post } from './api';
import type { EditorHandle } from './components/SqlEditor';
import { terminal } from './components/ui';
import type { Copy, ExperienceLevel, Locale } from './i18n';
import type { SqlExample } from './sql-examples';
import { localizeSqlExample } from './sql-examples-locales';
import { isSchemaChangingSql, type useImportedTableReveal } from './useImportedTableReveal';
import type { usePendingExecution } from './usePendingExecution';
import type { useRunEvidence } from './useRunEvidence';
import type { useScopedValue } from './useScopedValue';
import type { useScriptExecution } from './useScriptExecution';
import type { WorkspaceFeedback, useWorkspaceNotifications } from './useWorkspaceNotifications';
import type { WorkspacePanelController } from './useWorkspacePanels';
import { apiErrorDetail, type FailedQueryError } from './workspace-helpers';
import { MAX_TABS, newDraft, type Draft, type WorkspaceState } from './workspace-state';
import type { BusyAction, Connected, ResultsView } from './workspace-types';

type WorkspaceExecutionOptions = {
    active: Draft;
    connection: Connected;
    trusted: boolean;
    experience: ExperienceLevel;
    demoMode: boolean;
    locale: Locale;
    copy: Copy;
    onSelectConnection: (id: string) => void;
    workspaceRef: RefObject<WorkspaceState>;
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
    editor: RefObject<EditorHandle | null>;
    update: (id: string, change: (draft: Draft) => Draft) => void;
    panels: WorkspacePanelController;
    evidence: ReturnType<typeof useRunEvidence>;
    importedReveal: ReturnType<typeof useImportedTableReveal>;
    pendingExecution: ReturnType<typeof usePendingExecution>;
    script?: Script;
    setScripts: Dispatch<SetStateAction<Record<string, Script>>>;
    scriptFollowRef: ReturnType<typeof useScriptExecution>;
    trackSchemaRefresh: (runId: string, draftId: string, baseline?: ReadonlySet<string>) => void;
    loadHistory: () => Promise<void>;
    busy: BusyAction;
    setBusy: Dispatch<SetStateAction<BusyAction>>;
    setCancelling: Dispatch<SetStateAction<boolean>>;
    setExampleChartRunId: Dispatch<SetStateAction<string | undefined>>;
    setError: ReturnType<typeof useWorkspaceNotifications>['setError'];
    setDraftFeedback: ReturnType<typeof useScopedValue<WorkspaceFeedback | undefined>>[1];
    clearFailedQueryError: (draftId: string) => void;
    storeFailedQueryError: (failure: FailedQueryError) => void;
    setViewForDraft: ReturnType<typeof useScopedValue<ResultsView>>[1];
};

export function createExampleDraft(example: SqlExample, locale: Locale, copy: Copy['common']) {
    const name =
        example.category === 'schema'
            ? copy.examplePreviewTable.replace('{table}', example.name.replace(/^Preview /, ''))
            : localizeSqlExample(example, locale).name;
    const draft = newDraft(`${name}.sql`, example.sql);
    draft.chart = {
        ...example.chart,
        title: locale === 'en' ? example.chart.title : name,
        ys: [...example.chart.ys],
        ...(example.chart.candlestick ? { candlestick: { ...example.chart.candlestick } } : {}),
    };
    return draft;
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

export function useWorkspaceExecution({
    active,
    connection,
    trusted,
    experience,
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
}: WorkspaceExecutionOptions) {
    const executionFailureRef = useRef<{ id: string; name: string } | undefined>(undefined);
    const executionInFlightRef = useRef(false);
    const cancellingRef = useRef(false);
    const { run, setRunForRun } = evidence;

    const perform = async (
        task: () => Promise<void>,
        kind: BusyAction = 'save',
        onFailure?: (caught: unknown) => void,
    ) => {
        if (busy) return;
        setBusy(kind);
        try {
            await task();
        } catch (caught) {
            if (executionFailureRef.current) {
                const failedDraft = executionFailureRef.current;
                executionFailureRef.current = undefined;
                if (workspaceRef.current.activeId !== failedDraft.id) {
                    const canOpen = workspaceRef.current.tabs.some(
                        item => item.id === failedDraft.id,
                    );
                    setError(
                        `“${failedDraft.name}” failed.${canOpen ? ' Open the tab to see the error.' : ''}`,
                        {
                            context: `query:${failedDraft.id}`,
                            detail: message(caught),
                            action: canOpen
                                ? {
                                      label: 'Open tab',
                                      onSelect: () => {
                                          if (
                                              !workspaceRef.current.tabs.some(
                                                  item => item.id === failedDraft.id,
                                              )
                                          )
                                              return;
                                          setWorkspace(current => ({
                                              ...current,
                                              activeId: failedDraft.id,
                                          }));
                                          panels.revealPanelTemporarily('results', failedDraft.id);
                                      },
                                  }
                                : undefined,
                        },
                    );
                }
            } else if (onFailure) {
                onFailure(caught);
            } else {
                setDraftFeedback(active.id, { tone: 'warning', message: message(caught) }, true);
            }
        } finally {
            setBusy('');
        }
    };
    const performExecution = async (task: () => Promise<void>, kind: BusyAction = 'run') => {
        if (executionInFlightRef.current) return;
        executionInFlightRef.current = true;
        try {
            await perform(task, kind);
        } finally {
            executionInFlightRef.current = false;
        }
    };

    const addDraft = (draft: Draft) => {
        if (workspaceRef.current.tabs.length >= MAX_TABS) {
            setError(`${MAX_TABS} tabs open. Close one to create another.`, {
                tone: 'warning',
                timeoutMs: 5000,
            });
            return false;
        }
        setWorkspace(current => ({
            ...current,
            tabs: [...current.tabs, draft],
            activeId: draft.id,
        }));
        return true;
    };
    const openNewDraft = (draft: Draft, revealQuery = false) => {
        if (!addDraft(draft)) return false;
        if (revealQuery) panels.revealPanelTemporarily('query', draft.id);
        return true;
    };
    const recordFailedQueryError = (failure: FailedQueryError) => {
        executionFailureRef.current = {
            id: failure.draftId,
            name:
                (
                    workspaceRef.current.tabs.find(draft => draft.id === failure.draftId) ??
                    workspaceRef.current.closedTabs?.find(draft => draft.id === failure.draftId)
                )?.name ?? 'Query',
        };
        storeFailedQueryError(failure);
        if (workspaceRef.current.activeId !== failure.draftId) return;
        setViewForDraft(failure.draftId, 'results', true);
        panels.revealPanelTemporarily('results', failure.draftId);
    };

    const executeSqlForDraft = createDraftExecutor({
        performExecution,
        trusted,
        connection,
        importedReveal,
        experience,
        clearFailedQueryError,
        active,
        pendingExecution,
        recordFailedQueryError,
        scriptFollowRef,
        setScripts,
        update,
        setViewForDraft,
        setExampleChartRunId,
        trackSchemaRefresh,
        editor,
        panels,
        loadHistory,
        evidence,
    });

    const runExample = (example: SqlExample, output: 'results' | 'chart' | 'map') => {
        if (busy || executionInFlightRef.current) {
            setError(copy.common.runActionWait, { tone: 'warning', timeoutMs: 5000 });
            return true;
        }
        if (!trusted) {
            setError(copy.common.runActionTrustRequired, { tone: 'warning', timeoutMs: 5000 });
            return true;
        }
        const draft = createExampleDraft(example, locale, copy.common);
        if (!openNewDraft(draft, true)) return true;
        void executeSqlForDraft(draft, draft.sql, {
            view: output,
            expandResults: true,
            trackChartRun: true,
        });
        return true;
    };

    const execute = (kind: RunKind = 'query', sqlOverride?: string) => {
        const editorSnapshot = editor.current?.snapshot() ?? {
            sql: active.sql,
            from: active.from,
            to: active.to,
        };
        const selection =
            editorSnapshot.to > editorSnapshot.from
                ? editorSnapshot.sql.slice(editorSnapshot.from, editorSnapshot.to)
                : undefined;
        const selected = selectedStatement(
            editorSnapshot.sql,
            editorSnapshot.from,
            editorSnapshot.to,
        );
        const sql =
            sqlOverride ??
            (kind === 'query' ? (selection ?? editorSnapshot.sql) : (selected?.sql ?? ''));
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
        try {
            if (scriptId) {
                const cancelled = await post<Script>(
                    `/scripts/${encodeURIComponent(scriptId)}/cancel`,
                );
                setScripts(current => ({ ...current, [cancelled.id]: cancelled }));
            } else if (runId) {
                setRunForRun(runId, await post<Run>(`/runs/${encodeURIComponent(runId)}/cancel`));
            }
        } catch (caught) {
            setError('Couldn’t confirm cancellation. Check the query status.', {
                tone: 'warning',
                detail: message(caught),
            });
        } finally {
            cancellingRef.current = false;
            setCancelling(false);
        }
    };

    const openRun = (selected: Run) => {
        if (selected.connectionId !== connection.id) {
            onSelectConnection(selected.connectionId);
            return;
        }
        const draft = newDraft(
            `${selected.kind === 'query' ? 'Query' : selected.kind.toUpperCase()} ${new Date(selected.createdAt).toLocaleTimeString()}.sql`,
            selected.sql,
        );
        draft.parameters = selected.parameters;
        draft.activeRunId = selected.id;
        draft.runIds = [selected.id];
        if (!addDraft(draft)) return;
        const getSelectedView = (): ResultsView => {
            switch (selected.kind) {
                case 'plan':
                    return 'plan';

                case 'pipeline':
                    return 'pipeline';

                case 'analyze':
                    return 'runtime';

                default:
                    return 'results';
            }
        };
        setViewForDraft(draft.id, getSelectedView(), true);
        panels.revealPanelTemporarily('results', draft.id);
    };

    const openSqlDraft = (name: string, sql: string, run: boolean, reuseExisting = false) => {
        if (run && (busy || executionInFlightRef.current)) {
            setError(copy.common.runActionWait, { tone: 'warning', timeoutMs: 5000 });
            return;
        }
        if (run && !trusted) {
            setError(copy.common.runActionTrustRequired, { tone: 'warning', timeoutMs: 5000 });
            return;
        }
        if (
            run &&
            reuseExisting &&
            activateMatchingPreviewDraft(
                workspaceRef.current.tabs,
                name,
                sql,
                id => setWorkspace(current => ({ ...current, activeId: id })),
                draft => {
                    void executeSqlForDraft(draft, draft.sql, {
                        expandResults: true,
                        trackChartRun: true,
                        preview: true,
                    });
                },
            )
        )
            return;
        const draft = newDraft(name, sql);
        if (!openNewDraft(draft, !run)) return;
        if (!run) {
            window.requestAnimationFrame(() => editor.current?.focus());
            return;
        }
        void executeSqlForDraft(draft, draft.sql, {
            expandResults: true,
            trackChartRun: true,
            preview: true,
        });
    };
    const startBlankSql = () => {
        if (!openNewDraft(newDraft(), true)) return false;
        window.requestAnimationFrame(() => editor.current?.focus());
        return true;
    };
    return {
        perform,
        execute,
        runExample,
        cancel,
        openRun,
        openNewDraft,
        openSqlDraft,
        startBlankSql,
        addDraft,
    };
}

function createDraftExecutor({
    performExecution,
    trusted,
    connection,
    importedReveal,
    experience,
    clearFailedQueryError,
    active,
    pendingExecution,
    recordFailedQueryError,
    scriptFollowRef,
    setScripts,
    update,
    setViewForDraft,
    setExampleChartRunId,
    trackSchemaRefresh,
    editor,
    panels,
    loadHistory,
    evidence,
}: {
    performExecution: (task: () => Promise<void>, kind?: BusyAction) => Promise<void>;
    trusted: WorkspaceExecutionOptions['trusted'];
    connection: WorkspaceExecutionOptions['connection'];
    importedReveal: WorkspaceExecutionOptions['importedReveal'];
    experience: WorkspaceExecutionOptions['experience'];
    clearFailedQueryError: WorkspaceExecutionOptions['clearFailedQueryError'];
    active: WorkspaceExecutionOptions['active'];
    pendingExecution: WorkspaceExecutionOptions['pendingExecution'];
    recordFailedQueryError: (failure: FailedQueryError) => void;
    scriptFollowRef: WorkspaceExecutionOptions['scriptFollowRef'];
    setScripts: WorkspaceExecutionOptions['setScripts'];
    update: WorkspaceExecutionOptions['update'];
    setViewForDraft: WorkspaceExecutionOptions['setViewForDraft'];
    setExampleChartRunId: WorkspaceExecutionOptions['setExampleChartRunId'];
    trackSchemaRefresh: WorkspaceExecutionOptions['trackSchemaRefresh'];
    editor: WorkspaceExecutionOptions['editor'];
    panels: WorkspaceExecutionOptions['panels'];
    loadHistory: WorkspaceExecutionOptions['loadHistory'];
    evidence: WorkspaceExecutionOptions['evidence'];
}) {
    const { run, resultPage, page, setRunForRun } = evidence;

    return (
        draft: Draft,
        sql: string,
        options: {
            kind?: RunKind;
            view?: ResultsView;
            sourceRange?: { from: number; to: number };
            draftSql?: string;
            expandResults?: boolean;
            trackChartRun?: boolean;
            preview?: boolean;
        } = {},
    ) => {
        const kind = options.kind ?? 'query';
        let statements: ReturnType<typeof splitSql> = [];
        let parseError: unknown;
        let parseFailed = false;
        try {
            statements = splitSql(sql);
        } catch (caught) {
            parseFailed = true;
            parseError = caught;
        }
        const isScript = kind === 'query' && statements.length > 1;
        const statement = isScript ? undefined : statements[0];
        const draftSql = options.draftSql ?? draft.sql;
        const sourceRange =
            options.sourceRange ?? (sql === draft.sql && statement ? statement : undefined);

        return performExecution(
            async () => {
                const validateExecutionRequest = () => {
                    if (parseFailed) throw parseError;
                    if (!trusted)
                        throw new Error(
                            'Review and trust this read only connection before running SQL.',
                        );
                    if (isScript && connection.manifest?.scripts.available !== true)
                        throw new Error(
                            connection.manifest?.scripts.reason ??
                                'Scripts are unavailable on this connection.',
                        );
                    if (kind === 'explain' && connection.manifest?.explain.available === false)
                        throw new Error(
                            connection.manifest.explain.reason ??
                                'EXPLAIN is unavailable on this connection.',
                        );
                    const explainPlan =
                        connection.manifest?.explainPlan ?? connection.manifest?.explain;
                    if (kind === 'plan' && explainPlan?.available === false)
                        throw new Error(
                            explainPlan.reason ?? 'EXPLAIN PLAN is unavailable on this connection.',
                        );
                    const explainPipeline =
                        connection.manifest?.explainPipeline ?? connection.manifest?.pipeline;
                    if (kind === 'pipeline' && explainPipeline?.available === false)
                        throw new Error(
                            explainPipeline.reason ??
                                'EXPLAIN PIPELINE is unavailable on this connection.',
                        );
                    const explainAnalyze = connection.manifest?.explainAnalyze;
                    if (kind === 'analyze' && explainAnalyze?.available === false)
                        throw new Error(
                            explainAnalyze.reason ??
                                'EXPLAIN ANALYZE is unavailable on this connection.',
                        );
                    if (statements.length === 0)
                        throw new Error('Write or select a SQL statement before running it.');
                    if (!isScript && statements.length > 1)
                        throw new Error('This action accepts exactly one SQL statement.');
                    if (
                        parameterNames(sql).length &&
                        connection.manifest?.parameters.available === false
                    )
                        throw new Error(
                            connection.manifest.parameters.reason ??
                                'Query parameters are unavailable on this connection.',
                        );
                };
                validateExecutionRequest();

                const importedSqlBaseline = await importedReveal.captureImportedSqlBaseline(
                    draft.id,
                    isScript
                        ? statements.some(item => isSchemaChangingSql(item.sql))
                        : Boolean(statement && isSchemaChangingSql(statement.sql)),
                );

                const payload = {
                    clientRequestId: crypto.randomUUID(),
                    connectionId: connection.id,
                    documentId: draft.serverId,
                    sql: isScript ? sql : statement!.sql,
                    parameters: draft.parameters,
                    parentRunId: draft.parentRunId,
                    kind,
                    limits: {
                        rows: connection.limits.rows || DEFAULT_LIMITS.rows,
                        seconds: connection.limits.seconds || DEFAULT_LIMITS.seconds,
                    },
                    tags: { workspace: 'clickstudio', experience },
                    ...(!isScript && sourceRange
                        ? { sourceFrom: sourceRange.from, sourceTo: sourceRange.to }
                        : {}),
                };
                clearFailedQueryError(draft.id);
                const previousResult =
                    draft.id === active.id && run && terminal(run) && resultPage
                        ? { draftId: draft.id, run, page: resultPage, pageIndex: page }
                        : undefined;

                const submitScript = async () => {
                    pendingExecution.start(
                        payload.clientRequestId,
                        draft.id,
                        payload.sql,
                        previousResult,
                    );
                    let created: Script;
                    try {
                        created = await post<Script>('/scripts', { ...payload, stopOnError: true });
                    } catch (caught) {
                        pendingExecution.clear(payload.clientRequestId);
                        recordFailedQueryError({
                            draftId: draft.id,
                            draftSql,
                            statementSql: payload.sql,
                            sourceFrom: 0,
                            error: apiErrorDetail(caught),
                        });
                        throw caught;
                    }
                    pendingExecution.acceptScript(payload.clientRequestId, created.id);
                    importedReveal.rememberImportedSqlScript(
                        draft.id,
                        created.id,
                        importedSqlBaseline,
                    );
                    scriptFollowRef.current = { scriptId: created.id, enabled: true };
                    setScripts(current => ({ ...current, [created.id]: created }));
                    const first = created.statements.find(item => item.runId);
                    update(draft.id, current =>
                        first?.runId
                            ? {
                                  ...current,
                                  activeRunId: first.runId,
                                  scriptId: created.id,
                                  runIds: rememberRunIds(current.runIds, [first.runId]),
                              }
                            : { ...current, scriptId: created.id },
                    );
                    setViewForDraft(draft.id, 'results', true);
                    if (options.trackChartRun) setExampleChartRunId(undefined);
                };
                const submitRun = async () => {
                    pendingExecution.start(
                        payload.clientRequestId,
                        draft.id,
                        payload.sql,
                        previousResult,
                    );
                    let created: Run;
                    try {
                        created = await post<Run>('/runs', payload);
                    } catch (caught) {
                        pendingExecution.clear(payload.clientRequestId);
                        if (statement)
                            recordFailedQueryError({
                                draftId: draft.id,
                                draftSql,
                                statementSql: statement.sql,
                                sourceFrom: sourceRange?.from ?? 0,
                                error: apiErrorDetail(caught),
                            });
                        throw caught;
                    }
                    pendingExecution.acceptRun(payload.clientRequestId, created.id);
                    if (
                        connection.dataSource === 'clickhouse' &&
                        connection.readonly === false &&
                        statement &&
                        isSchemaChangingSql(statement.sql)
                    )
                        trackSchemaRefresh(created.id, draft.id, importedSqlBaseline);
                    setRunForRun(created.id, created, true);
                    const getExplainView = (): ResultsView => {
                        switch (kind) {
                            case 'explain':
                                return 'indexes';

                            case 'plan':
                                return 'plan';

                            case 'pipeline':
                                return 'pipeline';

                            case 'analyze':
                                return 'runtime';

                            default:
                                return options.view ?? 'results';
                        }
                    };
                    setViewForDraft(draft.id, getExplainView(), true);
                    update(draft.id, current => ({
                        ...current,
                        activeRunId: created.id,
                        scriptId: undefined,
                        runIds: rememberRunIds(current.runIds, [created.id]),
                    }));
                    if (draft.id === active.id) editor.current?.focus();
                    if (options.trackChartRun)
                        setExampleChartRunId(options.view === 'chart' ? created.id : undefined);
                };
                if (isScript) await submitScript();
                else await submitRun();
                if (options.expandResults) panels.revealPanelTemporarily('results', draft.id);
                void loadHistory().catch(() => undefined);
            },
            isScript ? 'script' : 'run',
        );
    };
}
