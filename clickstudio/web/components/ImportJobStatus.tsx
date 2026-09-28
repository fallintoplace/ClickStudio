import type { BusyAction, ImportJob, PendingImport } from './import-wizard-model';
import { displayImportValue, formatImportRowCount } from './import-wizard-model';

export function ImportJobStatus({ job, pendingImport, browserDemoImport, recoverableJobCount, busy, retryAttempted, canRetry, onReconcile, onConfirm, onRetry }: {
    job?: ImportJob;
    pendingImport?: PendingImport;
    browserDemoImport: boolean;
    recoverableJobCount: number;
    busy: BusyAction;
    retryAttempted: boolean;
    canRetry: boolean;
    onReconcile: () => void;
    onConfirm: () => void;
    onRetry: () => void;
}) {
    return <section aria-label="Import status" className="space-y-4">
        <div className={`rounded-xl border p-5 ${job?.status === 'succeeded' ? 'border-[var(--green)]/30 bg-[var(--green)]/5' : job?.status === 'unknown' ? 'border-[var(--amber)]/35 bg-[var(--amber)]/5' : 'border-[var(--line)] bg-[var(--page)]'}`}>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{job?.status === 'succeeded' ? 'Import complete' : job?.status === 'unknown' ? job.tableExists ? 'Destination exists · rows unconfirmed' : 'Import not confirmed' : 'Import running'}</span>
            <h3 role="status" className="mt-1 text-base font-semibold">{job?.status === 'succeeded' ? browserDemoImport ? `Saved ${formatImportRowCount(job.rows ?? pendingImport?.rows ?? 0)} to ${job.table ?? pendingImport?.table}` : `Inserted ${formatImportRowCount(job.rows ?? pendingImport?.rows ?? 0)} into ${job.table ?? pendingImport?.table}` : job?.status === 'unknown' ? job.tableExists ? `${job.table} is ready to inspect; its rows are not confirmed.` : 'We couldn’t confirm the import.' : `${browserDemoImport ? 'Saving' : 'Inserting'} ${formatImportRowCount(job?.rows ?? pendingImport?.rows ?? 0)}…`}</h3>
            {job?.status === 'unknown' ? <p className="mt-2 text-xs leading-relaxed text-[var(--text-soft)]">{job.tableExists ? job.tableCreated ? `ClickHouse created ${job.table}. It did not confirm the row insert, so inspect the selected table before deciding whether to import again.` : `The destination ${job.table} exists, but ClickHouse did not confirm the row insert. Inspect the selected table before deciding whether to import again.` : `ClickHouse couldn’t confirm the import. The rows may already be in ${job.table ?? pendingImport?.table ?? 'the table'}. Check the table before choosing. A late first import may add duplicate rows.`}</p> : job?.status === 'running' ? <p className="mt-2 text-xs text-[var(--muted)]">{job.reconciliationRequired ? 'ClickHouse still reports this import as active. Status checks will continue.' : 'Keep this panel open while the server finishes.'} Wait for it to finish before starting another import.</p> : job?.status === 'succeeded' ? <p className="mt-2 text-xs text-[var(--text-soft)]">{browserDemoImport ? job.demoPersisted ? 'Rows are saved in this browser and are ready to inspect in the sample workspace.' : 'Rows are available in this tab. Browser storage was unavailable, so they will not survive a refresh.' : 'Refreshing the object list and selecting the destination table.'}</p> : <p className="mt-2 text-xs text-[var(--muted)]">Checking the saved import job…</p>}
        </div>
        {browserDemoImport && job?.status === 'succeeded' && job.demoRows?.length ? <div className="overflow-hidden rounded-xl border border-[var(--line)]"><div className="flex items-center justify-between gap-3 bg-[var(--page)] px-4 py-3"><strong className="text-xs">Imported rows</strong><span className="text-[10px] text-[var(--muted)]">{formatImportRowCount(job.demoRows.length)} preview</span></div><div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse text-left text-xs"><thead className="bg-[var(--page)] text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr>{Object.keys(job.demoRows[0]!).map(column => <th key={column} className="px-3 py-2">{column}</th>)}</tr></thead><tbody>{job.demoRows.map((row, index) => <tr key={`${job.id}-${index}`} className="border-t border-[var(--line)]">{Object.keys(job.demoRows![0]!).map(column => <td key={column} className="px-3 py-2 text-[var(--text-soft)]">{displayImportValue(row[column])}</td>)}</tr>)}</tbody></table></div><p className="border-t border-[var(--line)] px-4 py-3 text-[11px] text-[var(--muted)]">To query them, switch to <strong className="text-[var(--text-soft)]">Sample data</strong> and run <code className="font-mono text-[var(--accent)]">SELECT * FROM demo.interview_imports</code>.</p></div> : null}
        {recoverableJobCount > 1 && <p className="text-xs text-[var(--muted)]">{recoverableJobCount - 1} more import{recoverableJobCount === 2 ? '' : 's'} need attention. They will be shown after this one.</p>}
        {job?.status === 'unknown' && <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onReconcile} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'reconcile' ? 'Checking…' : 'Check status'}</button>
            <button type="button" onClick={onConfirm} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'review' ? 'Checking…' : 'I see all rows'}</button>
            {retryAttempted ? <p className="self-center text-xs text-[var(--muted)]">This retry is also unconfirmed. Check the table before sending another import.</p> : <button type="button" onClick={onRetry} disabled={Boolean(busy)} className="rounded-lg border border-[var(--amber)]/40 px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'review' ? 'Checking…' : canRetry ? 'No rows; retry import' : 'No rows; choose file again'}</button>}
        </div>}
    </section>;
}
