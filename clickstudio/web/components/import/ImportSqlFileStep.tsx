import { SQL_FILE_SIZE_LABEL } from '../../../shared/query-limits';
import { Icon } from '../ui';

export function ImportSqlFileStep({
    chooseQueryFile,
    queryFile,
    queryFileError,
}: {
    chooseQueryFile: (next?: File) => void;
    queryFile: File | undefined;
    queryFileError: string;
}) {
    return (
        <section aria-label="Import SQL query" className="space-y-4">
            <div>
                <h3 className="text-sm font-semibold">Open a SQL query file</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-soft)]">
                    The file opens as a new draft. It will not run until you choose Run.
                </p>
            </div>
            <label className="import-file-picker import-file-picker-query import-query-picker">
                <span className="import-file-icon" aria-hidden="true">
                    <Icon name="parser" />
                </span>
                <span className="import-file-copy">
                    <strong>Choose a query file</strong>
                    <small>SQL · up to {SQL_FILE_SIZE_LABEL}</small>
                </span>
                <input
                    aria-label="Choose a SQL query file"
                    type="file"
                    accept=".sql,text/plain,application/sql"
                    onChange={event => chooseQueryFile(event.target.files?.[0])}
                    className="import-file-input"
                />
            </label>
            {queryFile && (
                <div className="import-selected-file flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--page)] px-4 py-3 text-xs">
                    <span className="min-w-0 truncate font-medium">{queryFile.name}</span>
                    <span className="text-[var(--muted)]">
                        SQL · {(queryFile.size / 1024).toFixed(1)} KB
                    </span>
                </div>
            )}
            {queryFileError && (
                <p
                    role="alert"
                    className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs leading-relaxed text-[var(--red)]"
                >
                    {queryFileError}
                </p>
            )}
        </section>
    );
}
