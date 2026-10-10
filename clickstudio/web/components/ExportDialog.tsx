import { useEffect, useRef } from 'react';
import { Button, Icon } from './ui';

export function ExportDialog({
    open,
    queryAvailable,
    rowsAvailable,
    onClose,
    onExportQuery,
    onExportRows,
}: {
    open: boolean;
    queryAvailable: boolean;
    rowsAvailable: boolean;
    onClose: () => void;
    onExportQuery: () => void;
    onExportRows: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby="export-dialog-title"
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
            onClick={event => {
                if (event.target === dialogRef.current) onClose();
            }}
            className="m-auto w-[min(480px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow-dialog)]"
        >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
                <div>
                    <h2 id="export-dialog-title" className="text-base font-semibold">
                        Export
                    </h2>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">
                        Choose the query or its result rows.
                    </p>
                </div>
                <Button aria-label="Close export options" onClick={onClose}>
                    Close
                </Button>
            </header>
            <div className="grid gap-2 p-5">
                <button
                    type="button"
                    disabled={!queryAvailable}
                    onClick={onExportQuery}
                    className="export-option flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-left transition hover:border-[var(--line-bright)] hover:bg-[var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                    <Icon name="documents" className="mt-0.5 shrink-0 text-[var(--accent)]" />
                    <span className="grid gap-1">
                        <strong className="text-sm">Export query (.sql)</strong>
                        <small className="text-xs text-[var(--muted)]">
                            Download the active SQL draft. It is not run.
                        </small>
                    </span>
                </button>
                <button
                    type="button"
                    disabled={!rowsAvailable}
                    onClick={onExportRows}
                    className="export-option flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-left transition hover:border-[var(--line-bright)] hover:bg-[var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                    <Icon name="table" className="mt-0.5 shrink-0 text-[var(--accent)]" />
                    <span className="grid gap-1">
                        <strong className="text-sm">Export rows (.csv)</strong>
                        <small className="text-xs text-[var(--muted)]">
                            Download rows from the latest query result.
                        </small>
                    </span>
                </button>
                {!rowsAvailable && (
                    <p className="pl-9 text-[11px] text-[var(--muted)]">
                        Run a query to export its rows.
                    </p>
                )}
            </div>
        </dialog>
    );
}
