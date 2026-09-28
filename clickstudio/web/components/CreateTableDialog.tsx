import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CREATE_TABLE_COLUMN_TYPES, type CreateTableColumn } from '../../shared/table-creation';
import type { Connected } from '../workspace-types';
import { message, post } from '../api';
import { CLICKHOUSE_CLOUD_CONNECTION_ID, createClickHouseCloudTable } from '../cloud-connection';

type Props = {
    connection: Connected;
    onClose: () => void;
    onCreated: () => void;
};

const firstColumn: CreateTableColumn = { name: 'id', type: 'UInt64' };

export function CreateTableDialog({ connection, onClose, onCreated }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [table, setTable] = useState('');
    const [columns, setColumns] = useState<CreateTableColumn[]>([firstColumn]);
    const [orderBy, setOrderBy] = useState(firstColumn.name);
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState(false);
    const [error, setError] = useState('');
    const targetTable = useMemo(() => `${connection.database}.${table.trim()}`, [connection.database, table]);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        return () => {
            if (element.open) element.close();
        };
    }, []);

    useEffect(() => {
        if (!columns.some(column => column.name === orderBy)) setOrderBy(columns[0]?.name ?? '');
    }, [columns, orderBy]);

    function updateColumn(index: number, field: keyof CreateTableColumn, value: string) {
        setColumns(current => current.map((column, item) => item === index ? { ...column, [field]: value } as CreateTableColumn : column));
    }

    async function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !table.trim()) return;
        setBusy(true);
        setError('');
        try {
            if (connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                await createClickHouseCloudTable({ name: table.trim(), columns, orderBy });
            } else {
                await post(`/connections/${encodeURIComponent(connection.id)}/tables`, { table: table.trim(), columns, orderBy });
            }
            setCreated(true);
            onCreated();
        } catch (caught) {
            setError(message(caught));
        } finally {
            setBusy(false);
        }
    }

    return <dialog ref={dialog} aria-labelledby="create-table-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === dialog.current && !busy) onClose(); }} className="m-auto max-h-[min(90vh,800px)] w-[min(700px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow)] backdrop:bg-black/70 backdrop:backdrop-blur-sm">
        <form onSubmit={event => void create(event)} className="flex max-h-[min(90vh,800px)] flex-col">
            <header className="flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-4 sm:px-7">
                <div><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">ClickHouse</span><h2 id="create-table-title" className="mt-1 text-lg font-semibold tracking-tight">New table</h2><p className="mt-1 text-xs text-[var(--text-soft)]">Create an empty MergeTree table in <code>{connection.database}</code>.</p></div>
                <button type="button" aria-label="Close new table" disabled={busy} onClick={onClose} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] disabled:opacity-40">Close</button>
            </header>
            <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
                {!created && <>
                    <label className="grid gap-1.5 text-xs font-medium text-[var(--text-soft)]">Table name
                        <div className="flex min-h-10 items-center overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--page)]"><span className="border-r border-[var(--line)] px-3 font-mono text-xs text-[var(--muted)]">{connection.database}.</span><input aria-label="Table name" value={table} onChange={event => setTable(event.target.value)} required maxLength={128} pattern="[A-Za-z_][A-Za-z0-9_]{0,127}" className="min-w-0 flex-1 bg-transparent px-3 font-mono text-xs text-[var(--text)] outline-none" /></div>
                    </label>
                    <section aria-label="Table columns" className="space-y-2">
                        <div className="flex items-center justify-between"><h3 className="text-xs font-semibold">Columns</h3><button type="button" onClick={() => setColumns(current => [...current, { name: `column_${current.length + 1}`, type: 'String' }])} disabled={columns.length >= 50} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs disabled:opacity-40">Add column</button></div>
                        {columns.map((column, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,.8fr)_auto] items-end gap-2 rounded-lg border border-[var(--line)] bg-[var(--page)] p-3">
                            <label className="grid gap-1 text-[11px] text-[var(--muted)]">Name<input aria-label={`Column ${index + 1} name`} value={column.name} onChange={event => updateColumn(index, 'name', event.target.value)} required pattern="[A-Za-z_][A-Za-z0-9_]{0,127}" className="min-h-9 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 text-xs text-[var(--text)]" /></label>
                            <label className="grid gap-1 text-[11px] text-[var(--muted)]">Type<select aria-label={`Column ${index + 1} type`} value={column.type} onChange={event => updateColumn(index, 'type', event.target.value)} className="min-h-9 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 text-xs text-[var(--text)]">{CREATE_TABLE_COLUMN_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
                            <button type="button" aria-label={`Remove ${column.name || `column ${index + 1}`}`} disabled={columns.length === 1} onClick={() => setColumns(current => current.filter((_, item) => item !== index))} className="min-h-9 rounded-md border border-[var(--line)] px-2 text-xs disabled:opacity-30">Remove</button>
                        </div>)}
                    </section>
                    <label className="grid gap-1.5 text-xs font-medium text-[var(--text-soft)]">Sorting key
                        <select aria-label="Sorting key" value={orderBy} onChange={event => setOrderBy(event.target.value)} className="min-h-10 rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 text-[var(--text)]">{columns.map((column, index) => <option key={`${column.name}-${index}`} value={column.name}>{column.name || `Column ${index + 1}`}</option>)}</select>
                    </label>
                    <p className="text-[11px] text-[var(--muted)]">Supported types: String, UInt64, Int64, Float64, Decimal(18, 2), Date, DateTime, UUID.</p>
                </>}
                {created && <p role="status" className="rounded-xl border border-[var(--green)]/30 bg-[var(--green)]/5 p-4 text-sm">Created <code>{targetTable}</code>.</p>}
                {error && <p role="alert" className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs text-[var(--red)]">{error}</p>}
            </main>
            <footer className="flex justify-end gap-2 border-t border-[var(--line)] bg-[var(--page)] px-5 py-3 sm:px-7">
                {created ? <button type="button" onClick={onClose} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)]">Done</button> : <button type="submit" disabled={busy || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(table.trim()) || columns.some(column => !column.name.trim()) || new Set(columns.map(column => column.name)).size !== columns.length || !orderBy} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Creating…' : 'Create table'}</button>}
            </footer>
        </form>
    </dialog>;
}
