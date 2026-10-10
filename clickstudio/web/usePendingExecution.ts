import { useState } from 'react';
import type { ResultPage, Run, Script } from '../shared/types';
import { terminal } from './components/ui';
import type { BusyAction } from './workspace-types';

type PendingExecution = Readonly<{
    requestId: string;
    draftId: string;
    sql: string;
    runId?: string;
    scriptId?: string;
}>;

type RetainedExecutionResult = Readonly<{
    draftId: string;
    run: Run;
    page: ResultPage;
    pageIndex: number;
}>;

export function usePendingExecution({
    activeDraftId,
    busy,
    run,
    script,
}: {
    activeDraftId: string;
    busy: BusyAction;
    run?: Run;
    script?: Script;
}) {
    const [pending, setPending] = useState<PendingExecution>();
    const [retainedResult, setRetainedResult] = useState<RetainedExecutionResult>();
    const current = pending?.draftId === activeDraftId ? pending : undefined;
    const isPending = Boolean(
        current &&
        (current.scriptId
            ? script?.id !== current.scriptId || script?.status === 'running'
            : current.runId
              ? run?.id !== current.runId || !terminal(run)
              : busy === 'run' || busy === 'script'),
    );

    return {
        execution: isPending ? current : undefined,
        retainedExecutionResult:
            isPending && retainedResult?.draftId === activeDraftId ? retainedResult : undefined,
        start: (
            requestId: string,
            draftId: string,
            sql: string,
            previousResult?: RetainedExecutionResult,
        ) => {
            setRetainedResult(previousResult);
            setPending({ requestId, draftId, sql });
        },
        clear: (requestId: string) =>
            setPending(value => (value?.requestId === requestId ? undefined : value)),
        acceptRun: (requestId: string, runId: string) =>
            setPending(value => (value?.requestId === requestId ? { ...value, runId } : value)),
        acceptScript: (requestId: string, scriptId: string) =>
            setPending(value => (value?.requestId === requestId ? { ...value, scriptId } : value)),
    };
}
