import { ImportJobStatus } from './ImportJobStatus';
import {
    useImportWizardController,
    type ImportWizardControllerOptions,
} from './useImportWizardController';
import type { Copy } from '../i18n';
import { ImportFileStep } from './import/ImportFileStep';
import { ImportMappingStep } from './import/ImportMappingStep';
import { ImportReviewStep } from './import/ImportReviewStep';
import { ImportWizardFooter } from './import/ImportWizardFooter';
import { useImportWizardView } from './import/useImportWizardView';
import { ImportSqlFileStep } from './import/ImportSqlFileStep';
import { ImportWizardNotice } from './import/ImportWizardNotice';
import {
    ImportWizardHeader,
    ImportKindSelector,
    ImportStepNavigation,
} from './import/ImportWizardChrome';

type ImportWizardProps = ImportWizardControllerOptions & {
    onImportQuery: (name: string, sql: string) => boolean;
    importCopy: Copy['imports'];
};

export function ImportWizard({ onImportQuery, importCopy, ...controllerProps }: ImportWizardProps) {
    const controller = useImportWizardController(controllerProps);
    const {
        dialogRef,
        step,
        setStep,
        file,
        format,
        preview,
        setPreview,
        target,
        fields,
        setFields,
        mapping,
        setMapping,
        job,
        recoverableJobs,
        pendingImport,
        recoveryState,
        busy,
        error,
        setError,
        importUnavailable,
        browserDemoImport,
        browserCloudImport,
        availableTargets,
        lastExistingTarget,
        destinationColumns,
        creatingTable,
        createTableAlreadyExists,
        createTableName,
        setCreateTableName,
        createTableDatabase,
        setCreateTableDatabase,
        createColumns,
        generateId,
        setGenerateId,
        createColumnTypes,
        updateCreateColumn,
        selectedFields,
        destinationNames,
        duplicateDestinations,
        sampleColumns,
        closeWizard,
        openImportDestination,
        forgetImport,
        previewFile,
        changeTarget,
        previewMapping,
        commitImport,
        confirmUnknownImport,
    } = controller;
    const {
        errorAlertRef,
        hasCreateIdColumn,
        importableDatabases,
        mappedColumnCount,
        skippedColumnCount,
        omittedDestinationColumns,
        missingSourceFields,
        importKind,
        setImportKind,
        queryFile,
        queryFileError,
        openingQuery,
        selectedDestinationChoice,
        setDestinationChoice,
        liveMappingIssue,
        chooseQueryFile,
        closeQueryMode,
        importAnotherFile,
        chooseRowsFile,
        loadSampleFile,
        openQueryFile,
    } = useImportWizardView(controller, controllerProps, onImportQuery);
    return (
        <dialog
            ref={dialogRef}
            aria-labelledby="import-wizard-title"
            onCancel={event => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                if (openingQuery) return;
                if (importKind === 'query') closeQueryMode();
                else if (browserCloudImport || (!busy && job?.status !== 'running'))
                    void closeWizard();
            }}
            onClick={event => {
                if (event.target === dialogRef.current && !openingQuery) {
                    if (importKind === 'query') closeQueryMode();
                    else if (browserCloudImport || (!busy && job?.status !== 'running'))
                        void closeWizard();
                }
            }}
            className="import-wizard-dialog m-auto max-h-[min(90vh,800px)] w-[min(860px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow-dialog)]"
        >
            <div className="import-wizard-shell flex max-h-[min(90vh,800px)] flex-col">
                <ImportWizardHeader
                    {...{
                        browserDemoImport,
                        browserCloudImport,
                        importKind,
                        openingQuery,
                        busy,
                        job,
                        closeQueryMode,
                        closeWizard,
                    }}
                />

                <ImportKindSelector {...{ importKind, setImportKind, openingQuery }} />

                {importKind === 'rows' && <ImportStepNavigation step={step} />}

                <main
                    key={importKind === 'query' ? 'query' : step}
                    className={`import-wizard-main ${importKind === 'query' ? 'is-query' : `is-${step}`} min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7`}
                >
                    {importKind === 'query' ? (
                        <ImportSqlFileStep {...{ chooseQueryFile, queryFile, queryFileError }} />
                    ) : (
                        <>
                            <ImportWizardNotice
                                {...{
                                    browserDemoImport,
                                    browserCloudImport,
                                    error,
                                    recoveryState,
                                    errorAlertRef,
                                    importUnavailable,
                                    busy,
                                    step,
                                }}
                            />
                            {recoveryState === 'ready' && !importUnavailable && step === 'file' && (
                                <ImportFileStep
                                    {...{
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
                                    }}
                                />
                            )}

                            {recoveryState === 'ready' &&
                                !importUnavailable &&
                                step === 'mapping' &&
                                preview && (
                                    <ImportMappingStep
                                        {...{
                                            preview,
                                            importAnotherFile,
                                            busy,
                                            browserCloudImport,
                                            selectedDestinationChoice,
                                            availableTargets,
                                            setDestinationChoice,
                                            changeTarget,
                                            lastExistingTarget,
                                            target,
                                            createTableDatabase,
                                            setCreateTableDatabase,
                                            setError,
                                            importableDatabases,
                                            createTableAlreadyExists,
                                            createTableName,
                                            setCreateTableName,
                                            hasCreateIdColumn,
                                            generateId,
                                            setGenerateId,
                                            createColumns,
                                            updateCreateColumn,
                                            createColumnTypes,
                                            creatingTable,
                                            mappedColumnCount,
                                            skippedColumnCount,
                                            destinationColumns,
                                            destinationNames,
                                            liveMappingIssue,
                                            fields,
                                            setFields,
                                            setMapping,
                                            duplicateDestinations,
                                            sampleColumns,
                                        }}
                                    />
                                )}

                            {recoveryState === 'ready' &&
                                !importUnavailable &&
                                step === 'review' &&
                                mapping &&
                                preview && (
                                    <ImportReviewStep
                                        {...{
                                            browserDemoImport,
                                            creatingTable,
                                            mapping,
                                            browserCloudImport,
                                            mappedColumnCount,
                                            skippedColumnCount,
                                            omittedDestinationColumns,
                                            importCopy,
                                            missingSourceFields,
                                            preview,
                                            destinationColumns,
                                            generateId,
                                            hasCreateIdColumn,
                                        }}
                                    />
                                )}

                            {recoveryState === 'ready' &&
                                !importUnavailable &&
                                step === 'status' && (
                                    <ImportJobStatus
                                        job={job}
                                        pendingImport={pendingImport}
                                        browserDemoImport={browserDemoImport}
                                        browserCloudImport={browserCloudImport}
                                        recoverableJobCount={recoverableJobs.length}
                                        busy={busy}
                                        onConfirm={() => void confirmUnknownImport()}
                                        onOpenDestination={openImportDestination}
                                        onForget={forgetImport}
                                    />
                                )}
                        </>
                    )}
                </main>

                <ImportWizardFooter
                    {...{
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
                    }}
                />
            </div>
        </dialog>
    );
}
