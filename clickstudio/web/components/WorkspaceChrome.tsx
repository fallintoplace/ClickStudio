import type { ReactNode } from 'react';
import type { Run, Script } from '../../shared/types';
import { Button, cx, formatBytes, formatCount, Icon, Status, terminal } from './ui';
import type { IconName } from './ui';
import type { RunEventState } from '../workspace-types';
import type { Copy } from '../i18n';

export type RunAction = {
    id: string;
    label: string;
    disabled?: boolean;
    title?: string;
    onSelect: () => void;
};

function DisabledRunAction({ action, label }: { action: RunAction; label: string }) {
    return <span className="run-option-disabled-anchor" role="group" tabIndex={0} title={action.title} aria-label={`${action.label}: ${action.title}`}>
        <Button data-testid={`run-action-${action.id}`} aria-label={action.label} variant="secondary" className="run-option-button" disabled title={undefined} onClick={action.onSelect}>{label}</Button>
    </span>;
}

export function RunActionGroup({ runLabel, runTitle, running, disabled, onRun, actions, copy }: {
    runLabel: string;
    runTitle?: string;
    running: boolean;
    disabled: boolean;
    onRun: () => void;
    actions: RunAction[];
    copy: Copy['common'];
}) {
    const explainActions = actions.filter(action => action.id === 'explain' || action.id.startsWith('explain-'));
    const otherActions = actions.filter(action => action.id !== 'explain' && !action.id.startsWith('explain-'));
    const explainGroupLabel = explainActions[0]?.label.split(/\s+/)[0] ?? '';
    const renderAction = (action: RunAction) => {
        const isExplainAction = action.id === 'explain' || action.id.startsWith('explain-');
        const label = isExplainAction ? action.label.replace(/^[^\s]+\s+/, '') : action.label;
        if (!action.disabled || !action.title)
            return <Button key={action.id} data-testid={`run-action-${action.id}`} aria-label={action.label} variant="secondary" className="run-option-button" disabled={action.disabled} title={action.title ?? action.label} onClick={action.onSelect}>{label}</Button>;
        return <DisabledRunAction key={action.id} action={action} label={label}/>;
    };
    return <div className="run-action-group" role="group" aria-label={copy.runActions}>
        <Button variant="primary" className="run-query-button" data-testid="run-button" aria-label={runLabel} title={runTitle} onClick={onRun} disabled={disabled}><Icon name="play"/>{running ? copy.running : runLabel}</Button>
        {otherActions.map(renderAction)}
        {explainActions.length > 0 && <div className="run-explain-actions" role="group" aria-label={explainGroupLabel}>
            <span className="run-explain-label" aria-hidden="true">{explainGroupLabel}</span>
            {explainActions.map(renderAction)}
        </div>}
    </div>;
}

export function RailButton({ icon, label, active, accent, disabled, onClick }: { icon: IconName; label: string; active?: boolean; accent?: boolean; disabled?: boolean; onClick: () => void }) {
    return <button className={cx('rail-icon-button', active && 'is-active', accent && 'is-accent')} type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}><Icon name={icon}/><span className="rail-tooltip">{label}</span></button>;
}

export function EmptyWorkspace({ onRun, beginner }: { onRun: () => void; beginner: boolean }) {
    return <div className="empty-workspace"><div className="empty-graphic"><span className="empty-orbit orbit-one"/><span className="empty-orbit orbit-two"/><span className="empty-core"><Icon name="bolt"/></span><span className="empty-spark spark-one"/><span className="empty-spark spark-two"/></div><span className="eyebrow">YOUR NEXT INSIGHT STARTS HERE</span><h3>Make the data<br/><em>say something.</em></h3><p>{beginner ? 'Run SQL to see your data. Select text to run only that selection.' : 'Run all SQL in the editor, or select SQL to run only that selection. Your query, run, and evidence stay linked.'}</p><Button variant="primary" onClick={onRun}><Icon name="play"/>Focus SQL editor</Button></div>;
}

export function ScriptResults({ script, runs, activeRunId, onSelectRun, onCancel, cancelDisabled, cancelAfterCurrentStatement = false }: {
    script: Script;
    runs: Run[];
    activeRunId?: string;
    onSelectRun: (runId: string) => void;
    onCancel: () => void;
    cancelDisabled: boolean;
    cancelAfterCurrentStatement?: boolean;
}) {
    const byId = new Map(runs.map(run => [run.id, run]));
    return <section className="script-results" aria-label="Script statement results">
        <div className="script-results-heading"><span><span className="eyebrow">SCRIPT EXECUTION</span><strong>{script.statements.length} statements <i>·</i> {script.status}</strong></span>{script.status === 'running' && (script.cancelled
            ? <span role="status">Finishing current statement…</span>
            : <Button variant="danger" className="toolbar-small" onClick={onCancel} disabled={cancelDisabled}>{cancelAfterCurrentStatement ? 'Stop after current statement' : 'Cancel script'}</Button>)}</div>
        <div className="script-statement-list">{script.statements.map((statement, index) => {
            const run = statement.runId ? byId.get(statement.runId) : undefined;
            const details = run?.error ? `${run.error.code}: ${run.error.message}` : statement.error ? `${statement.error.code}: ${statement.error.message}` : run ? `${run.rowCount.toLocaleString()} rows · ${Math.round(run.elapsedMs)} ms` : statement.status === 'pending' ? 'Waiting to run' : statement.status === 'running' ? 'Running' : statement.status === 'skipped' ? 'Skipped' : 'Not executed';
            return <button key={`${script.id}-${index}`} type="button" className={cx('script-statement', statement.runId === activeRunId && 'is-active')} aria-label={`Statement ${index + 1}: ${statement.status}`} aria-pressed={statement.runId === activeRunId} title={details} disabled={!statement.runId} onClick={() => statement.runId && onSelectRun(statement.runId)}>
                <span className="script-statement-index">{String(index + 1).padStart(2, '0')}</span><span className="script-statement-copy"><strong>Statement {index + 1}</strong><code>{statement.sql.replace(/\s+/g, ' ').slice(0, 72)}</code><small>{details}</small></span><span className={cx('script-status', `status-${statement.status}`)}>{statement.status}</span>
            </button>;
        })}</div>
    </section>;
}

export function ExecutionBar({ run, failedAttempt, eventState, onCancel, cancelling, scriptRunning, helpButton, copy }: { run?: Run; failedAttempt?: boolean; eventState: RunEventState; onCancel: () => void; cancelling: boolean; scriptRunning: boolean; helpButton: ReactNode; copy: Copy['common'] }) {
    const currentRun = failedAttempt ? undefined : run;
    const progress = currentRun?.progress;
    const executionInProgress = Boolean(currentRun && (!terminal(currentRun) || scriptRunning));
    const elapsedMs = currentRun ? terminal(currentRun) ? Math.round(currentRun.elapsedMs) : Math.max(0, Math.round(progress?.elapsedMs ?? currentRun.elapsedMs)) : undefined;

    return <footer className={cx('execution-bar', executionInProgress && 'is-running')} data-run-status={failedAttempt ? 'failed' : currentRun?.status ?? 'ready'}>
        <div className="execution-state">
            {failedAttempt
                ? <span className="execution-ready-state" role="status"><span className="status-light is-error"/>{copy.statusFailed}</span>
                : currentRun
                ? <Status run={currentRun} copy={copy}/>
                : <span className="execution-ready-state"><span className="status-light is-trusted"/>{copy.statusReady}</span>}
            {currentRun && scriptRunning && <span className="execution-kind">{copy.runScript.toUpperCase()}</span>}
            {currentRun && <>
                <span className="execution-separator"/>
                <strong>{elapsedMs?.toLocaleString()} ms</strong>
                <span className="execution-link-state">
                    <span className={cx('status-light', eventState === 'live' ? 'is-trusted' : eventState === 'reconnecting' ? 'is-warning' : '')}/>
                    {eventState === 'live' ? copy.statusLiveUpdates : eventState === 'reconnecting' ? copy.statusReconnecting : copy.statusComplete}
                </span>
            </>}
        </div>
        {currentRun && <div className="execution-telemetry">
            <span><strong>{progress?.readRows ? formatCount(progress.readRows) : '—'}</strong> {copy.rowsRead}</span>
            <span><strong>{progress?.readBytes ? formatBytes(progress.readBytes) : '—'}</strong> {copy.bytesRead}</span>
            <span><strong>{progress?.memory ? formatBytes(progress.memory) : '—'}</strong> {copy.memory}</span>
            {currentRun.kind !== 'query' && <span className="execution-kind">{currentRun.kind.toUpperCase()}</span>}
        </div>}
        <div className="execution-right">
            {currentRun && <code title={currentRun.queryId}>{currentRun.queryId}</code>}
            {currentRun && (scriptRunning || !terminal(currentRun)) && <Button variant="danger" className="cancel-execution" onClick={onCancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : scriptRunning ? `${copy.cancel} ${copy.runScript.toLowerCase()}` : copy.cancel}</Button>}
            {helpButton}
        </div>
        {executionInProgress && <span className="execution-progress-line"/>}
    </footer>;
}
