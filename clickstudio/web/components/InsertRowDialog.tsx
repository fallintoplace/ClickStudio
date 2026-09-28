import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SchemaColumn, SchemaTable } from '../../shared/types';
import { api, message, post } from '../api';
import { checkClickHouseCloudImport, CLICKHOUSE_CLOUD_CONNECTION_ID, CloudRequestError, getClickHouseCloudConnection, insertClickHouseCloudRow } from '../cloud-connection';

type Props = {
    connectionId: string;
    table: SchemaTable;
    columns: readonly SchemaColumn[];
    onClose: () => void;
    onInserted: () => void;
};

type Preview = { id: string; rowCount: number };
type Mapping = { id: string; table: string; rowCount: number };
type ImportJob = { id: string; table: string; rows: number; status: 'running' | 'succeeded' | 'unknown'; error?: string; reconciliationRequired?: boolean; reviewedAt?: string; queryId?: string; connectionId?: string };
type Step = 'edit' | 'review' | 'status';

function optionalColumn(column: SchemaColumn) {
    return Boolean(column.defaultKind) || /^Nullable\(/.test(column.type);
}

export function InsertRowDialog({ connectionId, table, columns, onClose, onInserted }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const reported = useRef(false);
    const name = `${table.database}.${table.name}`;
    const writableColumns = useMemo(() => columns.filter(column => !['MATERIALIZED', 'ALIAS'].includes(column.defaultKind)), [columns]);
    const [included, setIncluded] = useState<Record<string, boolean>>(() => Object.fromEntries(writableColumns.map(column => [column.name, !optionalColumn(column)])));
    const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(writableColumns.map(column => [column.name, ''])));
    const [allowed, setAllowed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [step, setStep] = useState<Step>('edit');
    const [preview, setPreview] = useState<Preview>();
    const [mapping, setMapping] = useState<Mapping>();
    const [job, setJob] = useState<ImportJob>();
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [setupError, setSetupError] = useState('');
    const cloudConnection = connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const row = useMemo(() => Object.fromEntries(writableColumns.filter(column => included[column.name]).map(column => [column.name, values[column.name] ?? ''])), [writableColumns, included, values]);
    const confirmationPhrase = 'INSERT 1 ROWS';
    const reportSuccess = useCallback(() => {
        if (reported.current) return;
        reported.current = true;
        onInserted();
    }, [onInserted]);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        let active = true;
        if (cloudConnection) {
            if (getClickHouseCloudConnection()) setAllowed(true);
            else setSetupError('Reconnect to ClickHouse Cloud before inserting a row.');
            setLoading(false);
            return () => {
                if (element.open) element.close();
            };
        }
        void api<string[]>(`/connections/${encodeURIComponent(connectionId)}/import-targets`).then(targets => {
            if (!Array.isArray(targets) || targets.some(target => typeof target !== 'string')) throw new Error('The connection returned an invalid list of insert targets.');
            if (active) setAllowed(targets.includes(name));
        }).catch(caught => {
            if (active) setSetupError(message(caught));
        }).finally(() => { if (active) setLoading(false); });
        return () => {
            active = false;
            if (element.open) element.close();
        };
    }, [connectionId, cloudConnection, name]);

    useEffect(() => {
        if (step !== 'status' || job?.status !== 'running' || busy) return;
        let active = true;
        const timer = window.setTimeout(() => {
            const status = job.queryId
                ? checkClickHouseCloudImport(job.queryId, job.table, job.rows)
                : api<ImportJob>(`/imports/${encodeURIComponent(job.id)}`);
            void status.then(next => {
                if (!active) return;
                setJob(next);
                if (next.status === 'succeeded') reportSuccess();
            }).catch(caught => {
                if (!active) return;
                if (job.queryId) setJob(current => current ? { ...current, status: 'unknown', error: `Could not confirm the insert status. Inspect ${name} before trying again.` } : current);
                setError(message(caught));
            });
        }, 1200);
        return () => { active = false; window.clearTimeout(timer); };
    }, [step, job, busy, reportSuccess]);

    async function reviewRow(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!allowed || loading || busy || Object.keys(row).length === 0) return;
        setBusy(true);
        setError('');
        let nextPreview: Preview | undefined;
        try {
            if (cloudConnection) {
                setMapping({ id: crypto.randomUUID(), table: name, rowCount: 1 });
                setStep('review');
                return;
            }
            nextPreview = await post<Preview>('/imports/preview', { name: `${table.name}-row.json`, source: JSON.stringify([row]), format: 'json' });
            const nextMapping = await post<Mapping>(`/imports/${encodeURIComponent(nextPreview.id)}/mapping`, {
                connectionId,
                table: name,
                fields: Object.fromEntries(Object.keys(row).map(column => [column, column])),
            });
            setPreview(nextPreview);
            setMapping(nextMapping);
            setStep('review');
        } catch (caught) {
            if (nextPreview) void api(`/imports/${encodeURIComponent(nextPreview.id)}`, { method: 'DELETE' }).catch(() => undefined);
            setError(message(caught));
        } finally {
            setBusy(false);
        }
    }

    async function insertRow() {
        if (!mapping || confirmation !== confirmationPhrase || busy) return;
        setBusy(true);
        setError('');
        const queryId = cloudConnection ? `clickstudio-import-${crypto.randomUUID()}` : undefined;
        setJob({ id: mapping.id, table: name, rows: 1, status: 'running', ...(queryId ? { queryId, connectionId } : {}) });
        setStep('status');
        try {
            const next = cloudConnection && queryId
                ? await insertClickHouseCloudRow({ table: name, columns, row, queryId })
                : await post<ImportJob>(`/imports/${encodeURIComponent(mapping.id)}/commit`, { confirmation });
            setJob(next);
            if (next.status === 'succeeded') reportSuccess();
        } catch (caught) {
            if (cloudConnection && caught instanceof CloudRequestError && caught.status < 500) {
                setStep('review');
                setJob(undefined);
                setError(message(caught));
            } else if (cloudConnection && queryId) {
                try {
                    const recovered = await checkClickHouseCloudImport(queryId, name, 1);
                    setJob(recovered);
                    if (recovered.status === 'succeeded') reportSuccess();
                } catch {
                    setJob({ id: mapping.id, table: name, rows: 1, queryId, connectionId, status: 'unknown', error: `Could not confirm whether the row reached ${name}. Inspect the table before trying again.` });
                }
            } else {
                try {
                    const recovered = await api<ImportJob>(`/imports/${encodeURIComponent(mapping.id)}`);
                    setJob(recovered);
                    if (recovered.status === 'succeeded') reportSuccess();
                } catch {
                    setStep('review');
                    setJob(undefined);
                    setError(message(caught));
                }
            }
        } finally {
            setBusy(false);
        }
    }

    async function reconcile() {
        if (!job || busy) return;
        setBusy(true);
        setError('');
        try {
            const next = job.queryId
                ? await checkClickHouseCloudImport(job.queryId, job.table, job.rows)
                : await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/reconcile`);
            setJob(next);
            if (next.status === 'succeeded') reportSuccess();
        } catch (caught) {
            setError(message(caught));
        } finally {
            setBusy(false);
        }
    }

    async function reviewUnknown() {
        if (!job || busy) return;
        setBusy(true);
        setError('');
        try {
            const next = job.queryId
                ? await checkClickHouseCloudImport(job.queryId, job.table, job.rows)
                : await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/review`, { inspected: true, noActiveInsert: true });
            const reviewed = job.queryId && next.status === 'unknown' ? { ...next, reviewedAt: new Date().toISOString() } : next;
            setJob(reviewed);
            if (reviewed.status === 'succeeded') reportSuccess();
        } catch (caught) {
            setError(message(caught));
        } finally {
            setBusy(false);
        }
    }

    function close() {
        if (busy || job?.status === 'running') return;
        if (preview && job?.status !== 'unknown') void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined);
        onClose();
    }

    const canClose = !busy && job?.status !== 'running';
    return <dialog ref={dialog} aria-labelledby="insert-row-title" onCancel={event => { event.preventDefault(); if (canClose) close(); }} onClick={event => { if (event.target === dialog.current && canClose) close(); }} className="m-auto max-h-[min(90vh,800px)] w-[min(760px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow)] backdrop:bg-black/70 backdrop:backdrop-blur-sm">
        <div className="flex max-h-[min(90vh,800px)] flex-col">
            <header className="flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-4 sm:px-7">
                <div><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">ClickHouse</span><h2 id="insert-row-title" className="mt-1 text-lg font-semibold tracking-tight">Insert row</h2><p className="mt-1 text-xs text-[var(--text-soft)]">Add one row to <code>{name}</code>.</p></div>
                <button type="button" aria-label="Close insert row" disabled={!canClose} onClick={close} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] disabled:opacity-40">Close</button>
            </header>
            <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
                {loading && <p role="status" className="text-sm text-[var(--text-soft)]">Checking insert access…</p>}
                {!loading && setupError && <p role="alert" className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 p-3 text-xs text-[var(--red)]">{setupError}</p>}
                {!loading && !setupError && !allowed && <p role="status" className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm text-[var(--text-soft)]">This table is not available in the connection database.</p>}
                {step === 'edit' && allowed && <form id="insert-row-form" onSubmit={event => void reviewRow(event)} className="space-y-3">
                    <p className="text-xs text-[var(--muted)]">Required columns are included. Leave defaulted or nullable columns out to use their ClickHouse defaults.</p>
                    {writableColumns.map(column => {
                        const optional = optionalColumn(column);
                        return <div key={column.name} className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--page)] p-3 sm:grid-cols-[minmax(9rem,.8fr)_minmax(0,1.5fr)] sm:items-center">
                            <div className="min-w-0"><strong className="block truncate text-xs">{column.name}</strong><code className="text-[10px] text-[var(--muted)]">{column.type}{column.defaultKind ? ` · ${column.defaultKind}` : ''}</code></div>
                            <div className="flex min-w-0 items-center gap-3">{optional && <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--text-soft)]"><input type="checkbox" checked={included[column.name] ?? false} onChange={event => setIncluded(current => ({ ...current, [column.name]: event.target.checked }))}/>Include</label>}<input aria-label={column.name} disabled={optional && !included[column.name]} value={values[column.name] ?? ''} onChange={event => setValues(current => ({ ...current, [column.name]: event.target.value }))} placeholder={optional ? 'Use default' : 'Value'} className="min-h-9 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 font-mono text-xs disabled:opacity-45" /></div>
                        </div>;
                    })}
                    {!writableColumns.length && <p role="status" className="rounded-lg border border-[var(--line)] p-3 text-xs text-[var(--muted)]">This table has no writable columns.</p>}
                </form>}
                {step === 'review' && <section aria-label="Review row" className="space-y-4"><p className="text-xs text-[var(--text-soft)]">Review the exact values before inserting.</p><pre className="max-h-64 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--page)] p-4 font-mono text-xs">{JSON.stringify(row, null, 2)}</pre><label className="grid gap-1.5 text-xs text-[var(--text-soft)]">Type <code className="text-[var(--accent)]">{confirmationPhrase}</code> to confirm<input aria-label={`Type ${confirmationPhrase} to confirm`} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} className="min-h-10 rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 font-mono text-xs" /></label></section>}
                {step === 'status' && job && <section aria-label="Insert status" className="space-y-3"><p role="status" className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm">{job.status === 'succeeded' ? `Inserted one row into ${name}.` : job.status === 'running' ? 'The insert is running. A second write to this table is blocked until it finishes.' : 'The insert outcome is not confirmed. Inspect the table before trying again.'}</p>{job.status === 'unknown' && <><p className="text-xs leading-relaxed text-[var(--text-soft)]">{job.error ?? 'The row may have been inserted. Check ClickHouse status, then inspect the destination before starting another write.'}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void reconcile()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-40">{busy ? 'Checking…' : 'Check ClickHouse status'}</button><button type="button" disabled={busy} onClick={() => void reviewUnknown()} className="rounded-lg border border-[var(--amber)]/40 px-3 py-2 text-xs disabled:opacity-40">I inspected the table; no insert is active</button></div></>}</section>}
                {error && <p role="alert" className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs text-[var(--red)]">{error}</p>}
            </main>
            <footer className="flex justify-end gap-2 border-t border-[var(--line)] bg-[var(--page)] px-5 py-3 sm:px-7">
                {step === 'edit' && allowed && <button type="submit" form="insert-row-form" disabled={loading || busy || !writableColumns.length || !Object.keys(row).length} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Preparing…' : 'Review row'}</button>}
                {step === 'review' && <><button type="button" disabled={busy} onClick={() => { setStep('edit'); setConfirmation(''); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-40">Back</button><button type="button" disabled={busy || confirmation !== confirmationPhrase} onClick={() => void insertRow()} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Inserting…' : 'Insert row'}</button></>}
                {step === 'status' && job?.status !== 'running' && <button type="button" onClick={close} disabled={busy} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] disabled:opacity-40">Done</button>}
            </footer>
        </div>
    </dialog>;
}
