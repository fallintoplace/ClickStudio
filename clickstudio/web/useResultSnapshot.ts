import { useCallback, useRef } from 'react';
import type { Result, Run } from '../shared/types';
import { api } from './api';

type SnapshotSetter = (
    target: string,
    next: Result | ((current: Result | undefined) => Result),
    allowInactive?: boolean,
) => void;

export function useResultSnapshot({
    activeRunId,
    run,
    snapshot,
    setSnapshotForRun,
    onSnapshot,
}: {
    activeRunId?: string;
    run?: Run;
    snapshot?: Result;
    setSnapshotForRun: SnapshotSetter;
    onSnapshot: (runId: string, result: Result) => void;
}) {
    const requests = useRef(new Map<string, Promise<Result>>());
    const onSnapshotRef = useRef(onSnapshot);
    onSnapshotRef.current = onSnapshot;
    return useCallback(async () => {
        if (
            !activeRunId ||
            snapshot?.runId === activeRunId ||
            !run ||
            run.resultState !== 'reopenable'
        )
            return;
        const runId = activeRunId;
        let request = requests.current.get(runId);
        if (!request) {
            request = api<Result>(`/runs/${encodeURIComponent(runId)}/snapshot`);
            requests.current.set(runId, request);
        }
        try {
            const full = await request;
            setSnapshotForRun(runId, full);
            onSnapshotRef.current(runId, full);
        } finally {
            if (requests.current.get(runId) === request) requests.current.delete(runId);
        }
    }, [activeRunId, run, setSnapshotForRun, snapshot]);
}
