import type { BusyAction, ImportJob, PendingImport } from '../state/import-wizard-model';
import { displayImportValue, formatImportRowCount } from '../state/import-wizard-model';

export function ImportJobStatus({
    job,
    pendingImport,
    browserDemoImport,
    browserCloudImport,
    recoverableJobCount,
    busy,
    onConfirm,
    onOpenDestination,
    onForget,
}: {
    job?: ImportJob;
    pendingImport?: PendingImport;
    browserDemoImport: boolean;
    browserCloudImport: boolean;
    recoverableJobCount: number;
    busy: BusyAction;
    onConfirm: () => void;
    onOpenDestination: () => void;
    onForget: () => void;
}) {
    const rowCount = job?.rows ?? pendingImport?.rows ?? 0;
    let statusTone: 'is-success' | 'is-unknown' | 'is-running' | 'is-checking';

    switch (job?.status) {
        case 'succeeded':
            statusTone = 'is-success';
            break;
        case 'unknown':
            statusTone = 'is-unknown';
            break;
        case 'running':
            statusTone = 'is-running';
            break;
        default:
            statusTone = 'is-checking';
            break;
    }
    const inspectableDestination =
        job?.status === 'unknown' && job.tableExists && Boolean(job.table);
    const destinationWasOpened =
        inspectableDestination && pendingImport?.id === job.id && pendingImport.inspectionOpened;

    const getStatusCardClass = () => {
        switch (job?.status) {
            case 'succeeded':
                return 'border-[var(--green)]/30 bg-[var(--green)]/5';

            case 'unknown':
                return 'border-[var(--amber)]/35 bg-[var(--amber)]/5';

            default:
                return 'border-[var(--line)] bg-[var(--page)]';
        }
    };
    const getStatusHeading = () => {
        switch (job?.status) {
            case 'succeeded':
                return 'Import complete';

            case 'unknown':
                return 'Import not confirmed';

            default:
                return 'Import running';
        }
    };
    const getStatusSummary = () => {
        switch (job?.status) {
            case 'succeeded':
                if (browserDemoImport) {
                    return `Saved ${formatImportRowCount(rowCount)} to ${job.table ?? pendingImport?.table}`;
                }

                if (job.reviewedAt) {
                    return `You confirmed the imported rows in ${job.table ?? pendingImport?.table}`;
                }

                return `${rowCount.toLocaleString()} source ${rowCount === 1 ? 'row' : 'rows'} processed successfully`;

            case 'unknown':
                if (inspectableDestination) {
                    return `ClickHouse couldn’t confirm the rows in ${job.table}.`;
                }

                return 'We couldn’t confirm the import.';

            default:
                return `${browserDemoImport ? 'Saving' : 'Inserting'} ${formatImportRowCount(rowCount)}…`;
        }
    };
    const renderStatusDetails = () => {
        switch (job?.status) {
            case 'unknown': {
                const getInspectionInstructions = () => {
                    if (inspectableDestination) {
                        if (destinationWasOpened) {
                            return `After checking ${job.table}, confirm whether the rows are there.`;
                        }

                        return `The table exists, but it may contain all, some, or none of this file’s rows. Open it to check.`;
                    }

                    return `ClickHouse couldn’t confirm the import. The rows may already be in ${job.table ?? pendingImport?.table ?? 'the table'}.`;
                };
                return (
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-soft)]">
                        {job.error ?? getInspectionInstructions()}
                    </p>
                );
            }
            case 'running':
                return (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                        {job.reconciliationRequired
                            ? 'ClickHouse still reports this import as active.'
                            : 'The server is still processing this import.'}{' '}
                        Close to leave it tracked, or forget its status to continue. Forgetting does
                        not cancel a write already sent to ClickHouse.
                    </p>
                );

            case 'succeeded': {
                const getDemoPersistenceMessage = () => {
                    if (browserDemoImport) {
                        if (job.demoPersisted) {
                            return 'Rows are saved in this browser and are ready to inspect in the sample workspace.';
                        }

                        return 'Rows are available in this tab. Browser storage was unavailable, so they will not survive a refresh.';
                    }

                    return 'Refreshing the object list and selecting the destination table.';
                };
                return (
                    <p className="mt-2 text-xs text-[var(--text-soft)]">
                        {getDemoPersistenceMessage()}
                    </p>
                );
            }
            default:
                return (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                        Checking the saved import job…
                    </p>
                );
        }
    };
    return (
        <section aria-label="Import status" className="space-y-4">
            <div
                className={`import-status-card ${statusTone} rounded-xl border p-5 ${getStatusCardClass()}`}
            >
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    {getStatusHeading()}
                </span>
                <h3 role="status" className="mt-1 text-base font-semibold">
                    {getStatusSummary()}
                </h3>
                {renderStatusDetails()}
            </div>
            {browserDemoImport && job?.status === 'succeeded' && job.demoRows?.length ? (
                <div className="overflow-hidden rounded-xl border border-[var(--line)]">
                    <div className="flex items-center justify-between gap-3 bg-[var(--page)] px-4 py-3">
                        <strong className="text-xs">Imported rows</strong>
                        <span className="text-[10px] text-[var(--muted)]">
                            {formatImportRowCount(job.demoRows.length)} preview
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] border-collapse text-left text-xs">
                            <thead className="bg-[var(--page)] text-[10px] uppercase tracking-wider text-[var(--muted)]">
                                <tr>
                                    {Object.keys(job.demoRows[0]!).map(column => (
                                        <th key={column} className="px-3 py-2">
                                            {column}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {job.demoRows.map((row, index) => (
                                    <tr
                                        key={`${job.id}-${index}`}
                                        className="border-t border-[var(--line)]"
                                    >
                                        {Object.keys(job.demoRows![0]!).map(column => (
                                            <td
                                                key={column}
                                                className="px-3 py-2 text-[var(--text-soft)]"
                                            >
                                                {displayImportValue(row[column])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="border-t border-[var(--line)] px-4 py-3 text-[11px] text-[var(--muted)]">
                        To query them, switch to{' '}
                        <strong className="text-[var(--text-soft)]">Sample data</strong> and run{' '}
                        <code className="font-mono text-[var(--accent)]">
                            SELECT * FROM demo.interview_imports
                        </code>
                        .
                    </p>
                </div>
            ) : null}
            {recoverableJobCount > 1 && (
                <p className="text-xs text-[var(--muted)]">
                    {recoverableJobCount - 1} more import{recoverableJobCount === 2 ? '' : 's'} need
                    attention. They will be shown after this one.
                </p>
            )}
            {job?.status === 'unknown' && (
                <div className="flex flex-wrap gap-2">
                    {inspectableDestination && !destinationWasOpened ? (
                        <button
                            type="button"
                            onClick={onOpenDestination}
                            disabled={Boolean(busy)}
                            className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50"
                        >
                            Open table to inspect
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={onConfirm}
                                disabled={Boolean(busy)}
                                className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50"
                            >
                                I checked; the rows are there
                            </button>
                        </>
                    )}
                </div>
            )}
            {browserCloudImport &&
                (job?.status === 'running' ||
                    (job?.status === 'unknown' && !inspectableDestination)) && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] p-3">
                        <p className="max-w-xl text-xs leading-relaxed text-[var(--muted)]">
                            Remove this import from the pending list to continue with another file.
                            This does not cancel a write already sent to ClickHouse.
                        </p>
                        <button
                            type="button"
                            onClick={onForget}
                            disabled={Boolean(busy)}
                            className="rounded-lg border border-[var(--amber)]/40 px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50"
                        >
                            Forget import and continue
                        </button>
                    </div>
                )}
        </section>
    );
}
