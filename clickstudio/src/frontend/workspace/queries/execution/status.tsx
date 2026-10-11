import { isTerminalRunStatus } from '../../../../shared/queries/execution/status';

import type { Run } from '../../../../shared/queries/execution/types';

import type { Copy } from '../../../common/translations/i18n';

import { cx } from '../../../common/components/ui.js';

export const terminal = (run?: Run) => Boolean(run && isTerminalRunStatus(run.status));

export function Status({ run, copy }: { run?: Run; copy?: Copy['common'] }) {
    let kind: 'is-running' | 'is-trusted' | 'is-warning' | 'is-error';

    if (terminal(run)) {
        switch (run?.status) {
            case 'succeeded':
                kind = 'is-trusted';
                break;
            case 'truncated':
                kind = 'is-warning';
                break;
            default:
                kind = 'is-error';
                break;
        }
    } else {
        kind = 'is-running';
    }
    const statusCopy: Partial<Record<NonNullable<Run>['status'], keyof Copy['common']>> = {
        queued: 'statusQueued',
        running: 'statusRunning',
        succeeded: 'statusSucceeded',
        truncated: 'statusTruncated',
        failed: 'queryFailed',
        cancelled: 'statusCancelled',
        timed_out: 'statusTimedOut',
        interrupted: 'statusInterrupted',
    };
    const key = run ? statusCopy[run.status] : undefined;
    const label = key && copy ? copy[key] : (run?.status ?? copy?.statusReady ?? 'Ready');
    return (
        <span
            data-run-status={run?.status ?? 'ready'}
            className="inline-flex items-center gap-2 text-[11px] capitalize text-muted"
        >
            <span className={cx('status-light', kind)} />
            {label}
        </span>
    );
}
