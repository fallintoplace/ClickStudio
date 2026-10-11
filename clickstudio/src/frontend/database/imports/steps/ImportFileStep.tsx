import { IMPORT_FILE_SIZE_LABEL } from '../../../../shared/database/imports/limits';
import { api } from '../../../common/requests/api';
import { ImportPreviewTable } from '../preview/ImportPreviewTable';
import { formatImportColumnCount, formatImportRowCount } from '../state/import-wizard-model';
import { useImportWizardController } from '../useImportWizardController';
import { Icon } from '../../../common/components/icons';

export function ImportFileStep({
    preview,
    browserDemoImport,
    loadSampleFile,
    busy,
    chooseRowsFile,
    file,
    format,
    browserCloudImport,
    setPreview,
    setMapping,
    setStep,
    setError,
    sampleColumns,
    availableTargets,
}: {
    preview: ReturnType<typeof useImportWizardController>['preview'];
    browserDemoImport: ReturnType<typeof useImportWizardController>['browserDemoImport'];
    loadSampleFile: () => void;
    busy: ReturnType<typeof useImportWizardController>['busy'];
    chooseRowsFile: (next?: File) => void;
    file: ReturnType<typeof useImportWizardController>['file'];
    format: ReturnType<typeof useImportWizardController>['format'];
    browserCloudImport: ReturnType<typeof useImportWizardController>['browserCloudImport'];
    setPreview: ReturnType<typeof useImportWizardController>['setPreview'];
    setMapping: ReturnType<typeof useImportWizardController>['setMapping'];
    setStep: ReturnType<typeof useImportWizardController>['setStep'];
    setError: ReturnType<typeof useImportWizardController>['setError'];
    sampleColumns: ReturnType<typeof useImportWizardController>['sampleColumns'];
    availableTargets: ReturnType<typeof useImportWizardController>['availableTargets'];
}) {
    return (
        <section aria-label="Choose and preview a file">
            {!preview ? (
                <>
                    {browserDemoImport && (
                        <div className="import-sample-card flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line-bright)] bg-[var(--page)] p-4">
                            <div>
                                <strong className="block text-sm">Try a sample import</strong>
                                <span className="mt-1 block text-xs text-[var(--muted)]">
                                    Six rows of marketing data, ready to preview.
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={loadSampleFile}
                                disabled={Boolean(busy)}
                                className="rounded-lg border border-[var(--line-bright)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--panel-hover)] disabled:opacity-50"
                            >
                                {busy === 'preview' ? 'Loading sample…' : 'Load sample file'}
                            </button>
                        </div>
                    )}
                    <label className="import-file-picker import-file-picker-rows">
                        <span className="import-file-icon" aria-hidden="true">
                            <Icon name="importFile" />
                        </span>
                        <span className="import-file-copy">
                            <strong>Choose a data file</strong>
                            <small>
                                CSV, JSON, NDJSON, or JSONL · up to {IMPORT_FILE_SIZE_LABEL}
                            </small>
                        </span>
                        <input
                            aria-label="Choose a CSV, JSON, or NDJSON file"
                            type="file"
                            accept=".csv,.json,.ndjson,.jsonl,text/csv,application/json"
                            onChange={event => chooseRowsFile(event.target.files?.[0])}
                            className="import-file-input"
                        />
                    </label>
                    {file && (
                        <div className="import-selected-file flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--page)] px-4 py-3 text-xs">
                            <span className="min-w-0 truncate font-medium">{file.name}</span>
                            <span className="text-[var(--muted)]">
                                {format ? format.toUpperCase() : 'Unsupported'} ·{' '}
                                {(file.size / 1024).toFixed(1)} KB
                            </span>
                        </div>
                    )}
                </>
            ) : (
                <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <span className="text-xs font-semibold">{preview.name}</span>
                            <p className="mt-1 text-[11px] text-[var(--muted)]">
                                {formatImportRowCount(preview.rowCount)} ·{' '}
                                {formatImportColumnCount(preview.columns.length)} ·{' '}
                                {preview.format.toUpperCase()}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                if (!browserCloudImport)
                                    void api(`/imports/${encodeURIComponent(preview.id)}`, {
                                        method: 'DELETE',
                                    }).catch(() => undefined);
                                setPreview(undefined);
                                setMapping(undefined);
                                setStep('file');
                                setError('');
                            }}
                            className="rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] text-[var(--text-soft)] hover:bg-[var(--panel-hover)]"
                        >
                            Choose another file
                        </button>
                    </div>
                    <ImportPreviewTable preview={preview} columns={sampleColumns} />
                </>
            )}
            {preview && availableTargets.length === 0 && !browserCloudImport && (
                <div
                    role="status"
                    className="rounded-lg border border-[var(--line)] p-3 text-xs text-[var(--muted)]"
                >
                    No configured import destination is available for this connection.
                </div>
            )}
        </section>
    );
}
