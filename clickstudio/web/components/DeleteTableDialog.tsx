import { useEffect, useRef, useState } from 'react';
import { tableDeletionConfirmation } from '../../shared/table-deletion';
import type { SchemaTable } from '../../shared/types';
import { api } from '../api';
import { CLICKHOUSE_CLOUD_CONNECTION_ID, dropClickHouseCloudTable } from '../cloud-connection';

type Props = {
    connectionId: string;
    table: Pick<SchemaTable, 'database' | 'name'>;
    onClose: () => void;
    onDeleted: (table: Pick<SchemaTable, 'database' | 'name'>) => void;
};

export function DeleteTableDialog({ connectionId, table, onClose, onDeleted }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [busy, setBusy] = useState(false);
    const [confirmation, setConfirmation] = useState('');
    const [error, setError] = useState('');
    const name = tableDeletionConfirmation(table.database, table.name);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        return () => {
            if (element.open) element.close();
        };
    }, []);

    async function dropTable() {
        if (busy || confirmation !== name) return;
        setBusy(true);
        setError('');
        try {
            if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                await dropClickHouseCloudTable(table.database, table.name, confirmation);
            } else {
                await api(`/connections/${encodeURIComponent(connectionId)}/tables`, {
                    method: 'DELETE', body: { database: table.database, table: table.name, confirmation },
                });
            }
            onDeleted(table);
            onClose();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setBusy(false);
        }
    }

    return <dialog ref={dialog} aria-labelledby="delete-table-title" aria-describedby="delete-table-description" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === dialog.current && !busy) onClose(); }} className="m-auto w-[min(440px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow-dialog)]">
        <header className="flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-4">
            <div><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">ClickHouse</span><h2 id="delete-table-title" className="mt-1 text-lg font-semibold tracking-tight">Delete table</h2></div>
            <button type="button" aria-label="Close delete table" disabled={busy} onClick={onClose} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] disabled:opacity-40">Close</button>
        </header>
        <main className="space-y-3 px-5 py-5">
            <p id="delete-table-description" className="text-sm text-[var(--text-soft)]">Delete <code className="break-all text-[var(--text)]">{name}</code>? This cannot be undone.</p>
            <label className="grid gap-1.5 text-xs text-[var(--text-soft)]">Type <code className="text-[var(--accent)]">{name}</code> to confirm
                <input aria-label={`Type ${name} to confirm`} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} className="min-h-10 rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 font-mono text-xs" />
            </label>
            {error && <p role="alert" className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs text-[var(--red)]">{error}</p>}
        </main>
        <footer className="flex justify-end gap-2 border-t border-[var(--line)] bg-[var(--page)] px-5 py-3">
            <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] disabled:opacity-40">Cancel</button>
            <button type="button" disabled={busy || confirmation !== name} onClick={() => void dropTable()} className="rounded-lg bg-[var(--red)] px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Deleting…' : 'Delete table'}</button>
        </footer>
    </dialog>;
}
