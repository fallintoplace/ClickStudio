import {
    MAX_IMPORT_FILE_BYTES,
    IMPORT_FILE_SIZE_LABEL,
    IMPORT_ROW_LIMIT_LABEL,
} from '../../../../shared/database/imports/limits';
import { Button } from '../../../common/components/ui';
import { formatImportColumnCount } from '../state/import-wizard-model';
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
        <footer className="import-wizard-footer">
            <span className="import-wizard-footer-note">{getStepHint()}</span>
            <div className="flex items-center gap-2">
                {importKind === 'query' && (
                    <Button
                        onClick={() => void openQueryFile()}
                        disabled={!queryFile || Boolean(queryFileError) || openingQuery}
                        variant="primary"
                    >
                        {openingQuery ? 'Opening…' : 'Open query'}
                    </Button>
                )}
                {importKind === 'rows' && (
                    <>
                        {recoveryState === 'ready' && step === 'review' && (
                            <Button
                                onClick={() => {
                                    setStep('mapping');
                                    setError('');
                                }}
                                disabled={Boolean(busy)}
                            >
                                Back
                            </Button>
                        )}
                        {recoveryState === 'ready' && !importUnavailable && step === 'file' && (
                            <Button
                                onClick={() => void previewFile()}
                                disabled={
                                    !file ||
                                    !format ||
                                    file.size > MAX_IMPORT_FILE_BYTES ||
                                    Boolean(busy) ||
                                    (!availableTargets.length && !browserCloudImport)
                                }
                                variant="primary"
                            >
                                {busy === 'preview' ? 'Reading file…' : 'Read file and continue'}
                            </Button>
                        )}
                        {recoveryState === 'ready' && !importUnavailable && step === 'mapping' && (
                            <Button
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
                                variant="primary"
                            >
                                {getReviewActionLabel()}
                            </Button>
                        )}
                        {recoveryState === 'ready' && !importUnavailable && step === 'review' && (
                            <Button
                                onClick={() => void commitImport()}
                                disabled={Boolean(busy)}
                                variant="primary"
                            >
                                {getCommitActionLabel()}
                            </Button>
                        )}
                        {recoveryState === 'ready' &&
                            step === 'status' &&
                            job?.status === 'succeeded' && (
                                <>
                                    <Button onClick={importAnotherFile} disabled={Boolean(busy)}>
                                        Import another file
                                    </Button>
                                    <Button
                                        onClick={() => void closeWizard()}
                                        disabled={Boolean(busy)}
                                        variant="primary"
                                    >
                                        Done
                                    </Button>
                                </>
                            )}
                    </>
                )}
            </div>
        </footer>
    );
}
