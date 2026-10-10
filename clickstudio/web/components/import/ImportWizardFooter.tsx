import {
    MAX_IMPORT_FILE_BYTES,
    IMPORT_FILE_SIZE_LABEL,
    IMPORT_ROW_LIMIT_LABEL,
} from '../../../shared/import-limits';
import { formatImportColumnCount } from '../import-wizard-model';
import { useImportWizardController } from '../useImportWizardController';

export function ImportWizardFooter({
    importKind,
    browserDemoImport,
    browserCloudImport,
    step,
    target,
    selectedFields,
    openQueryFile,
    queryFile,
    queryFileError,
    openingQuery,
    recoveryState,
    setStep,
    setError,
    busy,
    importUnavailable,
    previewFile,
    file,
    format,
    availableTargets,
    previewMapping,
    destinationNames,
    duplicateDestinations,
    destinationColumns,
    createTableAlreadyExists,
    liveMappingIssue,
    selectedDestinationChoice,
    commitImport,
    creatingTable,
    job,
    importAnotherFile,
    closeWizard,
}: {
    importKind: 'rows' | 'query';
    browserDemoImport: ReturnType<typeof useImportWizardController>['browserDemoImport'];
    browserCloudImport: ReturnType<typeof useImportWizardController>['browserCloudImport'];
    step: ReturnType<typeof useImportWizardController>['step'];
    target: ReturnType<typeof useImportWizardController>['target'];
    selectedFields: ReturnType<typeof useImportWizardController>['selectedFields'];
    openQueryFile: () => Promise<void>;
    queryFile: File | undefined;
    queryFileError: string;
    openingQuery: boolean;
    recoveryState: ReturnType<typeof useImportWizardController>['recoveryState'];
    setStep: ReturnType<typeof useImportWizardController>['setStep'];
    setError: ReturnType<typeof useImportWizardController>['setError'];
    busy: ReturnType<typeof useImportWizardController>['busy'];
    importUnavailable: ReturnType<typeof useImportWizardController>['importUnavailable'];
    previewFile: ReturnType<typeof useImportWizardController>['previewFile'];
    file: ReturnType<typeof useImportWizardController>['file'];
    format: ReturnType<typeof useImportWizardController>['format'];
    availableTargets: ReturnType<typeof useImportWizardController>['availableTargets'];
    previewMapping: ReturnType<typeof useImportWizardController>['previewMapping'];
    destinationNames: ReturnType<typeof useImportWizardController>['destinationNames'];
    duplicateDestinations: ReturnType<typeof useImportWizardController>['duplicateDestinations'];
    destinationColumns: ReturnType<typeof useImportWizardController>['destinationColumns'];
    createTableAlreadyExists: ReturnType<
        typeof useImportWizardController
    >['createTableAlreadyExists'];
    liveMappingIssue: { source: string; message: string } | undefined;
    selectedDestinationChoice: 'existing' | 'create' | undefined;
    commitImport: ReturnType<typeof useImportWizardController>['commitImport'];
    creatingTable: ReturnType<typeof useImportWizardController>['creatingTable'];
    job: ReturnType<typeof useImportWizardController>['job'];
    importAnotherFile: () => void;
    closeWizard: ReturnType<typeof useImportWizardController>['closeWizard'];
}) {
    const getStepHint = () => {
        if (importKind === 'query') {
            return 'SQL opens as a draft and does not run automatically';
        }

        if (browserDemoImport) {
            return 'Browser demo · nothing is written to ClickHouse';
        }

        if (browserCloudImport) {
            return `CSV, JSON, or NDJSON · up to ${IMPORT_FILE_SIZE_LABEL} and ${IMPORT_ROW_LIMIT_LABEL} rows`;
        }

        switch (step) {
            case 'file':
                return `CSV, JSON, or NDJSON · up to ${IMPORT_FILE_SIZE_LABEL} and ${IMPORT_ROW_LIMIT_LABEL} rows`;

            case 'mapping':
                if (target) {
                    return `${formatImportColumnCount(Object.keys(selectedFields).length)} mapped · review before writing`;
                }

                return 'Choose a table and match its columns';

            case 'review':
                return 'Review the destination and row count before writing';

            default:
                return 'Import status is checked with ClickHouse';
        }
    };
    const getReviewActionLabel = () => {
        if (busy === 'mapping') {
            return 'Checking mapping…';
        }

        if (liveMappingIssue) {
            return 'Fix column mapping';
        }

        if (!target) {
            if (browserCloudImport && selectedDestinationChoice === 'existing') {
                return 'Choose a table';
            }

            return 'Choose a destination';
        }

        if (createTableAlreadyExists) {
            return 'Choose another table name';
        }

        if (!destinationNames.length && destinationColumns.length > 0) {
            return 'Map a column first';
        }

        if (duplicateDestinations) {
            return 'Fix duplicate columns';
        }

        if (!destinationColumns.length) {
            return 'No writable columns';
        }

        return 'Review import';
    };
    const getCommitActionLabel = () => {
        if (busy === 'commit') {
            if (browserDemoImport) {
                return 'Saving…';
            }

            return 'Starting…';
        }

        if (creatingTable) {
            return 'Create table and import';
        }

        if (browserDemoImport) {
            return 'Save demo rows';
        }

        return 'Import rows';
    };
    return (
        <footer className="import-wizard-footer flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--page)] px-5 py-3 sm:px-7">
            <span className="import-wizard-footer-note text-[10px] text-[var(--muted)]">
                {getStepHint()}
            </span>
            <div className="flex items-center gap-2">
                {importKind === 'query' && (
                    <button
                        type="button"
                        onClick={() => void openQueryFile()}
                        disabled={!queryFile || Boolean(queryFileError) || openingQuery}
                        className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {openingQuery ? 'Opening…' : 'Open query'}
                    </button>
                )}
                {importKind === 'rows' && (
                    <>
                        {recoveryState === 'ready' && step === 'review' && (
                            <button
                                type="button"
                                onClick={() => {
                                    setStep('mapping');
                                    setError('');
                                }}
                                disabled={Boolean(busy)}
                                className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50"
                            >
                                Back
                            </button>
                        )}
                        {recoveryState === 'ready' && !importUnavailable && step === 'file' && (
                            <button
                                type="button"
                                onClick={() => void previewFile()}
                                disabled={
                                    !file ||
                                    !format ||
                                    file.size > MAX_IMPORT_FILE_BYTES ||
                                    Boolean(busy) ||
                                    (!availableTargets.length && !browserCloudImport)
                                }
                                className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {busy === 'preview' ? 'Reading file…' : 'Read file and continue'}
                            </button>
                        )}
                        {recoveryState === 'ready' && !importUnavailable && step === 'mapping' && (
                            <button
                                type="button"
                                onClick={() => void previewMapping()}
                                disabled={
                                    !target ||
                                    !destinationNames.length ||
                                    duplicateDestinations ||
                                    !destinationColumns.length ||
                                    createTableAlreadyExists ||
                                    Boolean(liveMappingIssue) ||
                                    Boolean(busy)
                                }
                                className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {getReviewActionLabel()}
                            </button>
                        )}
                        {recoveryState === 'ready' && !importUnavailable && step === 'review' && (
                            <button
                                type="button"
                                onClick={() => void commitImport()}
                                disabled={Boolean(busy)}
                                className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {getCommitActionLabel()}
                            </button>
                        )}
                        {recoveryState === 'ready' &&
                            step === 'status' &&
                            job?.status === 'succeeded' && (
                                <>
                                    <button
                                        type="button"
                                        onClick={importAnotherFile}
                                        disabled={Boolean(busy)}
                                        className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] transition hover:bg-[var(--panel-hover)] disabled:opacity-40"
                                    >
                                        Import another file
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void closeWizard()}
                                        disabled={Boolean(busy)}
                                        className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:opacity-40"
                                    >
                                        Done
                                    </button>
                                </>
                            )}
                    </>
                )}
            </div>
        </footer>
    );
}
