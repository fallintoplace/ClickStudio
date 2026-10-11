import { useEffect, useRef } from 'react';
import { Button } from '../../../common/components/ui';
import { Icon } from '../../../common/components/icons';

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
            className="transfer-dialog"
        >
            <header className="transfer-dialog-header">
                <div>
                    <h2 id="export-dialog-title" className="transfer-dialog-title">
                        Export
                    </h2>
                    <p className="transfer-dialog-description">
                        Choose the query or its result rows.
                    </p>
                </div>
                <Button aria-label="Close export options" onClick={onClose}>
                    Close
                </Button>
            </header>
            <div className="transfer-dialog-body grid gap-2 overflow-y-auto">
                <button
                    type="button"
                    disabled={!queryAvailable}
                    onClick={onExportQuery}
                    className="export-option transfer-dialog-option"
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
                    className="export-option transfer-dialog-option"
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
