export const RUN_KINDS = ['query', 'explain', 'plan', 'pipeline', 'analyze'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_STATUSES = [
    'queued',
    'running',
    'succeeded',
    'truncated',
    'failed',
    'cancelled',
    'timed_out',
    'interrupted',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES = [
    'succeeded',
    'truncated',
    'failed',
    'cancelled',
    'timed_out',
    'interrupted',
] as const satisfies readonly RunStatus[];
export function isTerminalRunStatus(status: RunStatus): boolean {
    return TERMINAL_RUN_STATUSES.some(candidate => candidate === status);
}

export const RUN_RESULT_STATES = ['pending', 'reopenable', 'expired', 'unavailable'] as const;
export type RunResultState = (typeof RUN_RESULT_STATES)[number];

export const SCRIPT_STATUSES = [
    'running',
    'succeeded',
    'partial',
    'failed',
    'cancelled',
    'interrupted',
] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

export const RESULT_COMPLETENESS = ['complete', 'truncated'] as const;
export type ResultCompleteness = (typeof RESULT_COMPLETENESS)[number];

export const RUN_EVENT_TYPES = ['state', 'progress'] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];
