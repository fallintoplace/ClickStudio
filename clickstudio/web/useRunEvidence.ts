import { DEFAULT_RESULT_PAGE_ROWS } from '../shared/query-limits';
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ProfilePipeline, QueryProfile, Result, ResultPage, Run } from '../shared/types';
import type { FlamegraphSnapshot } from '../shared/flamegraph';
import { parseRunEvent } from '../shared/run-wire';
import { api, isFrontendDemoPreview, message } from './api';
import { RetainedRunUnavailableError } from './demo-preview';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from './cloud-connection';
import { terminal } from './components/ui';
import { useScopedValue } from './useScopedValue';
import type { RunEventState } from './workspace-types';
import { startVisiblePolling } from './visible-polling';
import type { WorkspaceFeedback } from './useWorkspaceNotifications';

export function useRunEvidence({
    activeRunId,
    connectionId,
    loadHistory,
    onRunUnavailable,
}: {
    activeRunId?: string;
    connectionId: string;
    loadHistory: () => Promise<void>;
    onRunUnavailable: (runId: string) => void;
}) {
    const [run, setRunForRun] = useScopedValue<Run>(activeRunId);
    const [resultPageState, setResultPageForRun] = useScopedValue<{
        page: number;
        value: ResultPage;
    }>(activeRunId);
    const [snapshot, setSnapshotForRun] = useScopedValue<Result>(activeRunId);
    const [profile, setProfileForRun, profilesByRun] = useScopedValue<QueryProfile>(activeRunId);
    const [pipeline, setPipelineForRun, pipelinesByRun] =
        useScopedValue<ProfilePipeline>(activeRunId);
    const [flamegraph, setFlamegraphForRun, flamegraphsByRun] =
        useScopedValue<FlamegraphSnapshot>(activeRunId);
    const [storedPage, setPageForRun] = useScopedValue<number>(activeRunId);
    const page = storedPage ?? 0;
    const setPage = useCallback<Dispatch<SetStateAction<number>>>(
        next => {
            if (!activeRunId) return;
            setPageForRun(
                activeRunId,
                current => (typeof next === 'function' ? next(current ?? 0) : next),
                true,
            );
        },
        [activeRunId, setPageForRun],
    );
    const [runReadFeedback, setRunReadFeedback] = useScopedValue<WorkspaceFeedback | undefined>(
        activeRunId,
    );
    const [resultReadFeedback, setResultReadFeedback] = useScopedValue<
        WorkspaceFeedback | undefined
    >(activeRunId);
    const [assetReadFeedback, setAssetReadFeedback] = useScopedValue<WorkspaceFeedback | undefined>(
        activeRunId,
    );
    const [readAttempt, setReadAttempt] = useState(0);
    const retryRead = useCallback(() => setReadAttempt(current => current + 1), []);
    const [eventState, setEventState] = useState<RunEventState>('idle');
    const resultPage = resultPageState?.page === page ? resultPageState.value : undefined;
    const running = Boolean(run && !terminal(run));

    useEffect(() => {
        if (!activeRunId) return;
        let cancelled = false;
        void api<Run>(`/runs/${encodeURIComponent(activeRunId)}`)
            .then(next => {
                if (cancelled || next.connectionId !== connectionId) return;
                setRunForRun(activeRunId, next);
                setRunReadFeedback(activeRunId, undefined);
                if (terminal(next)) void loadHistory().catch(() => undefined);
            })
            .catch(caught => {
                if (cancelled) return;
                if (caught instanceof RetainedRunUnavailableError) {
                    onRunUnavailable(activeRunId);
                    return;
                }
                setRunReadFeedback(activeRunId, {
                    tone: 'warning',
                    message: 'Couldn’t load the query status. Retry to check its outcome.',
                    detail: message(caught),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [
        activeRunId,
        connectionId,
        loadHistory,
        onRunUnavailable,
        setRunReadFeedback,
        setRunForRun,
        readAttempt,
    ]);

    useEffect(() => {
        if (!activeRunId || !run || !terminal(run) || run.resultState !== 'reopenable') return;
        let cancelled = false;
        void api<ResultPage>(
            `/runs/${encodeURIComponent(activeRunId)}/result?offset=${page * DEFAULT_RESULT_PAGE_ROWS}&count=${DEFAULT_RESULT_PAGE_ROWS}`,
        )
            .then(next => {
                if (!cancelled) {
                    setResultPageForRun(activeRunId, { page, value: next });
                    setResultReadFeedback(activeRunId, undefined);
                }
            })
            .catch(caught => {
                if (!cancelled)
                    setResultReadFeedback(activeRunId, {
                        tone: 'error',
                        message: 'Couldn’t load the result rows. Try again.',
                        detail: message(caught),
                    });
            });
        return () => {
            cancelled = true;
        };
    }, [activeRunId, page, run, setResultReadFeedback, setResultPageForRun, readAttempt]);

    useEffect(() => {
        if (!activeRunId || !running) {
            setEventState('idle');
            return;
        }
        if (isFrontendDemoPreview || connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
            setEventState('idle');
            return;
        }
        setEventState('reconnecting');
        const stream = new EventSource(`/api/runs/${encodeURIComponent(activeRunId)}/events`);
        stream.onopen = () => setEventState('live');
        stream.onmessage = event => {
            try {
                const parsed: unknown = JSON.parse(event.data);
                const payload = parseRunEvent(parsed);
                if (payload.run.id !== activeRunId || payload.run.connectionId !== connectionId)
                    return;
                setRunReadFeedback(activeRunId, undefined);
                setRunForRun(activeRunId, current =>
                    !current || current.sequence <= payload.sequence ? payload.run : current,
                );
                if (terminal(payload.run)) {
                    stream.close();
                    setEventState('idle');
                    void loadHistory().catch(() => undefined);
                }
            } catch {
                setEventState('reconnecting');
            }
        };
        stream.onerror = () => setEventState('reconnecting');
        return () => stream.close();
    }, [activeRunId, connectionId, loadHistory, running, setRunForRun, setRunReadFeedback]);

    useEffect(() => {
        if (!running || eventState === 'live' || !activeRunId) return;
        return startVisiblePolling(
            async signal => {
                try {
                    const next = await api<Run>(`/runs/${encodeURIComponent(activeRunId)}`, {
                        signal,
                    });
                    if (signal.aborted || next.connectionId !== connectionId) return;
                    setRunForRun(activeRunId, current =>
                        !current || current.sequence <= next.sequence ? next : current,
                    );
                    setRunReadFeedback(activeRunId, undefined);
                    if (terminal(next)) void loadHistory().catch(() => undefined);
                } catch (caught) {
                    if (!signal.aborted)
                        setRunReadFeedback(activeRunId, {
                            tone: 'warning',
                            message: 'Couldn’t refresh the query status. Retrying…',
                            detail: message(caught),
                        });
                }
            },
            { intervalMs: 1500, immediate: false },
        );
    }, [
        activeRunId,
        connectionId,
        eventState,
        loadHistory,
        running,
        setRunForRun,
        setRunReadFeedback,
    ]);

    return {
        run,
        setRunForRun,
        page,
        setPage,
        resultPage,
        snapshot,
        setSnapshotForRun,
        profile,
        setProfileForRun,
        pipeline,
        setPipelineForRun,
        flamegraph,
        setFlamegraphForRun,
        profilesByRun,
        pipelinesByRun,
        flamegraphsByRun,
        eventState,
        runReadFeedback,
        resultReadFeedback,
        assetReadFeedback,
        setAssetReadFeedback,
        retryRead,
    };
}
