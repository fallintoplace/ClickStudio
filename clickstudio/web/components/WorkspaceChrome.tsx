import type { ReactNode } from 'react';
import type { Run, Script } from '../../shared/types';
import { Button, cx, formatBytes, formatCount, Icon, Status, terminal } from './ui';
import type { IconName } from './ui';
import type { RunEventState } from '../workspace-types';
import type { Copy } from '../i18n';
import { statementOutcome } from '../statement-outcome';

export type RunAction = {
    id: string;
    label: string;
    disabled?: boolean;
    title?: string;
    onSelect: () => void;
};

function DisabledRunAction({ action, label }: { action: RunAction; label: string }) {
    return (
        <span
            className="run-option-disabled-anchor"
            role="group"
            tabIndex={0}
            title={action.title}
            aria-label={`${action.label}: ${action.title}`}
        >
            <Button
                data-testid={`run-action-${action.id}`}
                aria-label={action.label}
                variant="secondary"
                className="run-option-button"
                disabled
                title={undefined}
                onClick={action.onSelect}
            >
                {label}
            </Button>
        </span>
    );
}

export function RunActionGroup({ actions, copy }: { actions: RunAction[]; copy: Copy['common'] }) {
    const explainActions = actions.filter(
        action => action.id === 'explain' || action.id.startsWith('explain-'),
    );
    const otherActions = actions.filter(
        action => action.id !== 'explain' && !action.id.startsWith('explain-'),
    );
    const explainGroupLabel = explainActions[0]?.label.split(/\s+/)[0] ?? '';
    const renderAction = (action: RunAction) => {
        const isExplainAction = action.id === 'explain' || action.id.startsWith('explain-');
        const label = isExplainAction ? action.label.replace(/^[^\s]+\s+/, '') : action.label;
        if (!action.disabled || !action.title)
            return (
                <Button
                    key={action.id}
                    data-testid={`run-action-${action.id}`}
                    aria-label={action.label}
                    variant="secondary"
                    className="run-option-button"
                    disabled={action.disabled}
                    title={action.title ?? action.label}
                    onClick={action.onSelect}
                >
                    {label}
                </Button>
            );
        return <DisabledRunAction key={action.id} action={action} label={label} />;
    };
    return (
        <div className="run-action-group" role="group" aria-label={copy.runActions}>
            {otherActions.map(renderAction)}
            {explainActions.length > 0 && (
                <div className="run-explain-actions" role="group" aria-label={explainGroupLabel}>
                    <span className="run-explain-label" aria-hidden="true">
                        {explainGroupLabel}
                    </span>
                    {explainActions.map(renderAction)}
                </div>
            )}
        </div>
    );
}

export function RailButton({
    icon,
    label,
    active,
    accent,
    disabled,
    testId,
    onClick,
}: {
    icon: IconName;
    label: string;
    active?: boolean;
    accent?: boolean;
    disabled?: boolean;
    testId?: string;
    onClick: () => void;
}) {
    return (
        <button
            className={cx('rail-icon-button', active && 'is-active', accent && 'is-accent')}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            data-testid={testId}
            onClick={onClick}
        >
            <Icon name={icon} />
            <span className="rail-tooltip">{label}</span>
        </button>
    );
}

export function ScriptResults({
    script,
    runs,
    activeRunId,
    onSelectRun,
    onSelectError,
    errorSelected = false,
    onCancel,
    cancelDisabled,
    cancelAfterCurrentStatement = false,
}: {
    script: Script;
    runs: Run[];
    activeRunId?: string;
    onSelectRun: (runId: string) => void;
    onSelectError?: () => void;
    errorSelected?: boolean;
    onCancel: () => void;
    cancelDisabled: boolean;
    cancelAfterCurrentStatement?: boolean;
}) {
    const byId = new Map(runs.map(run => [run.id, run]));
    const statements = script.statements.map((statement, index) => {
        const run = statement.runId ? byId.get(statement.runId) : undefined;
        const details = run?.error
            ? `${run.error.code}: ${run.error.message}`
            : statement.error
              ? `${statement.error.code}: ${statement.error.message}`
              : run
                ? `${statementOutcome(run)} · ${Math.round(run.elapsedMs)} ms`
                : statement.status === 'pending'
                  ? 'Waiting to run'
                  : statement.status === 'running'
                    ? 'Running'
                    : statement.status === 'skipped'
                      ? 'Skipped'
                      : 'Not executed';
        return { statement, index, details };
    });
    return (
        <section
            className={cx('script-results', script.status !== 'running' && 'is-settled')}
            aria-label="Script statement results"
        >
            <div className="script-results-heading">
                <div className="script-results-summary">
                    <span className="eyebrow">SCRIPT EXECUTION</span>
                    <strong>
                        {script.statements.length} statements <i>·</i> {script.status}
                    </strong>
                </div>
                {script.status === 'running' &&
                    (script.cancelled ? (
                        <span className="script-cancel-status" role="status">
                            {cancelAfterCurrentStatement
                                ? 'Stopping after this query…'
                                : 'Cancelling script…'}
                        </span>
                    ) : (
                        <Button
                            variant="danger"
                            className="toolbar-small"
                            onClick={onCancel}
                            disabled={cancelDisabled}
                        >
                            {cancelAfterCurrentStatement
                                ? 'Stop after current statement'
                                : 'Cancel script'}
                        </Button>
                    ))}
            </div>
            <div
                className="script-statement-list"
                role="group"
                aria-label="Select a statement result"
            >
                {statements.map(({ statement, index, details }) => {
                    const active = statement.runId
                        ? !errorSelected && statement.runId === activeRunId
                        : Boolean(statement.error && errorSelected);
                    return (
                        <button
                            key={`${script.id}-${index}`}
                            type="button"
                            className={cx('script-statement', active && 'is-active')}
                            aria-label={`Statement ${index + 1}: ${statement.status}`}
                            aria-pressed={active}
                            title={`${statement.sql.replace(/\s+/g, ' ').slice(0, 160)} · ${details}`}
                            disabled={!statement.runId && !(statement.error && onSelectError)}
                            onClick={() =>
                                statement.runId ? onSelectRun(statement.runId) : onSelectError?.()
                            }
                        >
                            <span className="script-statement-index">
                                {String(index + 1).padStart(2, '0')}
                            </span>
                            <span className="script-statement-copy">
                                <strong>Statement {index + 1}</strong>
                                <code>{statement.sql.replace(/\s+/g, ' ').slice(0, 72)}</code>
                                <small>{details}</small>
                            </span>
                            <span className={cx('script-status', `status-${statement.status}`)}>
                                {statement.status}
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

export function ExecutionBar({
    run,
    failedAttempt,
    failureInToolbar,
    eventState,
    onOpenDetails,
    scriptRunning,
    helpButton,
    copy,
}: {
    run?: Run;
    failedAttempt?: boolean;
    failureInToolbar?: boolean;
    eventState: RunEventState;
    onOpenDetails: () => void;
    scriptRunning: boolean;
    helpButton: ReactNode;
    copy: Copy['common'];
}) {
    const currentRun = failedAttempt ? undefined : run;
    const progress = currentRun?.progress;
    const executionInProgress = Boolean(currentRun && (!terminal(currentRun) || scriptRunning));
    const elapsedMs = currentRun
        ? terminal(currentRun)
            ? Math.round(currentRun.elapsedMs)
            : Math.max(0, Math.round(progress?.elapsedMs ?? currentRun.elapsedMs))
        : undefined;

    const hasTelemetry = Boolean(
        progress &&
        (progress.readRows !== '' || progress.readBytes !== '' || progress.memory !== undefined),
    );

    return (
        <footer
            className={cx('execution-bar', executionInProgress && 'is-running')}
            data-run-status={failedAttempt ? 'failed' : (currentRun?.status ?? 'ready')}
            data-query-id={currentRun?.queryId}
        >
            <div className="execution-state">
                {!failureInToolbar &&
                    (failedAttempt ? (
                        <span className="execution-ready-state" role="status">
                            <span className="status-light is-error" />
                            {copy.queryFailed}
                        </span>
                    ) : currentRun ? (
                        <Status run={currentRun} copy={copy} />
                    ) : (
                        <span className="execution-ready-state">
                            <span className="status-light is-trusted" />
                            {copy.statusReady}
                        </span>
                    ))}
                {currentRun && scriptRunning && (
                    <span className="execution-kind">{copy.runScript.toUpperCase()}</span>
                )}
                {currentRun && (
                    <>
                        {!failureInToolbar && <span className="execution-separator" />}
                        <strong>{elapsedMs?.toLocaleString()} ms</strong>
                        <span className="execution-link-state">
                            <span
                                className={cx(
                                    'status-light',
                                    eventState === 'live'
                                        ? 'is-trusted'
                                        : eventState === 'reconnecting'
                                          ? 'is-warning'
                                          : '',
                                )}
                            />
                            {eventState === 'live'
                                ? copy.statusLiveUpdates
                                : eventState === 'reconnecting'
                                  ? copy.statusReconnecting
                                  : copy.statusComplete}
                        </span>
                    </>
                )}
            </div>
            {currentRun && (hasTelemetry || currentRun.kind !== 'query') && (
                <div className="execution-telemetry">
                    {progress?.readRows !== undefined && progress.readRows !== '' && (
                        <span>
                            <strong>{formatCount(progress.readRows)}</strong> {copy.rowsRead}
                        </span>
                    )}
                    {progress?.readBytes !== undefined && progress.readBytes !== '' && (
                        <span>
                            <strong>{formatBytes(progress.readBytes)}</strong> {copy.bytesRead}
                        </span>
                    )}
                    {progress?.memory !== undefined && progress.memory !== '' && (
                        <span>
                            <strong>{formatBytes(progress.memory)}</strong> {copy.memory}
                        </span>
                    )}
                    {currentRun.kind !== 'query' && (
                        <span className="execution-kind">{currentRun.kind.toUpperCase()}</span>
                    )}
                </div>
            )}
            <div className="execution-right">
                {currentRun && (
                    <Button
                        variant="ghost"
                        className="execution-details-button"
                        data-testid="execution-details"
                        aria-label="Execution details"
                        title="Open execution details"
                        onClick={onOpenDetails}
                    >
                        Details
                    </Button>
                )}
                {helpButton}
            </div>
            {executionInProgress && <span className="execution-progress-line" />}
        </footer>
    );
}
