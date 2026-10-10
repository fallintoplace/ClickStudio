import { cloudImportDatabases, CREATE_CLOUD_TABLE_TARGET } from '../../cloud-import';
import { ImportPreviewTable } from '../ImportPreviewTable';
import {
    formatImportColumnCount,
    formatImportRowCount,
    type ImportPreview,
} from '../import-wizard-model';
import { useImportWizardController } from '../useImportWizardController';
import { Icon } from '../ui';
import { ImportNewTableForm } from './ImportNewTableForm';
import { ImportColumnMapping } from './ImportColumnMapping';

export function ImportMappingStep({
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
}: {
    preview: ImportPreview;
    importAnotherFile: () => void;
    busy: ReturnType<typeof useImportWizardController>['busy'];
    browserCloudImport: ReturnType<typeof useImportWizardController>['browserCloudImport'];
    selectedDestinationChoice: 'existing' | 'create' | undefined;
    availableTargets: ReturnType<typeof useImportWizardController>['availableTargets'];
    setDestinationChoice: import('react').Dispatch<
        import('react').SetStateAction<'existing' | 'create' | undefined>
    >;
    changeTarget: ReturnType<typeof useImportWizardController>['changeTarget'];
    lastExistingTarget: ReturnType<typeof useImportWizardController>['lastExistingTarget'];
    target: ReturnType<typeof useImportWizardController>['target'];
    createTableDatabase: ReturnType<typeof useImportWizardController>['createTableDatabase'];
    setCreateTableDatabase: ReturnType<typeof useImportWizardController>['setCreateTableDatabase'];
    setError: ReturnType<typeof useImportWizardController>['setError'];
    importableDatabases: ReturnType<typeof cloudImportDatabases>;
    createTableAlreadyExists: ReturnType<
        typeof useImportWizardController
    >['createTableAlreadyExists'];
    createTableName: ReturnType<typeof useImportWizardController>['createTableName'];
    setCreateTableName: ReturnType<typeof useImportWizardController>['setCreateTableName'];
    hasCreateIdColumn: boolean;
    generateId: ReturnType<typeof useImportWizardController>['generateId'];
    setGenerateId: ReturnType<typeof useImportWizardController>['setGenerateId'];
    createColumns: ReturnType<typeof useImportWizardController>['createColumns'];
    updateCreateColumn: ReturnType<typeof useImportWizardController>['updateCreateColumn'];
    createColumnTypes: ReturnType<typeof useImportWizardController>['createColumnTypes'];
    creatingTable: ReturnType<typeof useImportWizardController>['creatingTable'];
    mappedColumnCount: number;
    skippedColumnCount: number;
    destinationColumns: ReturnType<typeof useImportWizardController>['destinationColumns'];
    destinationNames: ReturnType<typeof useImportWizardController>['destinationNames'];
    liveMappingIssue: { source: string; message: string } | undefined;
    fields: ReturnType<typeof useImportWizardController>['fields'];
    setFields: ReturnType<typeof useImportWizardController>['setFields'];
    setMapping: ReturnType<typeof useImportWizardController>['setMapping'];
    duplicateDestinations: ReturnType<typeof useImportWizardController>['duplicateDestinations'];
    sampleColumns: ReturnType<typeof useImportWizardController>['sampleColumns'];
}) {
    const getDestinationHeading = () => {
        if (browserCloudImport) {
            if (selectedDestinationChoice === 'existing') {
                return 'Choose a table';
            }

            return 'Choose where the rows go';
        }

        return 'Choose a table';
    };
    const getDestinationInstructions = () => {
        if (browserCloudImport) {
            if (selectedDestinationChoice === 'existing') {
                return 'Select a table above. Matching columns will be filled in for you.';
            }

            return 'Choose “Add to a table” or “Create a table” to continue.';
        }

        return 'Select a destination above. Matching columns will be filled in for you.';
    };
    return (
        <section aria-label="Map source columns" className="import-mapping-step import-setup">
            <div className="import-setup-source">
                <span className="import-setup-source-icon" aria-hidden="true">
                    <Icon name="importFile" />
                </span>
                <div className="import-setup-source-copy">
                    <span className="import-setup-kicker">SOURCE FILE</span>
                    <strong title={preview.name}>{preview.name}</strong>
                    <span>
                        {formatImportRowCount(preview.rowCount)} ·{' '}
                        {formatImportColumnCount(preview.columns.length)} ·{' '}
                        {preview.format.toUpperCase()}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={importAnotherFile}
                    disabled={Boolean(busy)}
                    className="import-change-file"
                >
                    Change file
                </button>
            </div>

            {browserCloudImport && (
                <fieldset className="import-destination-choice">
                    <legend>Where should the rows go?</legend>
                    <div className="import-destination-options">
                        <label
                            className={`import-destination-option${selectedDestinationChoice === 'existing' ? ' is-selected' : ''}${!availableTargets.length ? ' is-disabled' : ''}`}
                        >
                            <input
                                type="radio"
                                name="import-destination"
                                value="existing"
                                checked={selectedDestinationChoice === 'existing'}
                                disabled={!availableTargets.length}
                                onChange={() => {
                                    setDestinationChoice('existing');
                                    changeTarget(
                                        availableTargets.includes(lastExistingTarget)
                                            ? lastExistingTarget
                                            : '',
                                    );
                                }}
                            />
                            <span className="import-destination-option-index" aria-hidden="true">
                                01
                            </span>
                            <span className="import-destination-option-copy">
                                <strong className="import-destination-option-title">
                                    Add to a table
                                </strong>
                                <small className="import-destination-option-description">
                                    Choose a table that already exists.
                                </small>
                            </span>
                        </label>
                        <label
                            className={`import-destination-option${selectedDestinationChoice === 'create' ? ' is-selected' : ''}`}
                        >
                            <input
                                type="radio"
                                name="import-destination"
                                value="create"
                                checked={selectedDestinationChoice === 'create'}
                                onChange={() => {
                                    setDestinationChoice('create');
                                    changeTarget(CREATE_CLOUD_TABLE_TARGET);
                                }}
                            />
                            <span className="import-destination-option-index" aria-hidden="true">
                                02
                            </span>
                            <span className="import-destination-option-copy">
                                <strong className="import-destination-option-title">
                                    Create a table
                                </strong>
                                <small className="import-destination-option-description">
                                    Build a new table from this file.
                                </small>
                            </span>
                        </label>
                    </div>
                    {selectedDestinationChoice === 'existing' && (
                        <div className="import-destination-select-shell">
                            <label className="import-destination-select">
                                DESTINATION TABLE
                                <select
                                    aria-label="Import target table"
                                    value={target}
                                    onChange={event => changeTarget(event.target.value)}
                                >
                                    <option value="">Choose a table…</option>
                                    {availableTargets.map(table => (
                                        <option key={table} value={table}>
                                            {table}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <span className="import-destination-helper">
                                You can only add rows to a table with compatible columns.
                            </span>
                        </div>
                    )}
                </fieldset>
            )}

            {!browserCloudImport && (
                <div className="import-destination-panel">
                    <div className="import-section-heading">
                        <span className="import-setup-kicker">DESTINATION</span>
                        <h3>Choose a table</h3>
                    </div>
                    <label className="import-destination-select">
                        CLICKHOUSE TABLE
                        <select
                            aria-label="Import target table"
                            value={target}
                            onChange={event => changeTarget(event.target.value)}
                        >
                            <option value="">Choose a table…</option>
                            {availableTargets.map(table => (
                                <option key={table} value={table}>
                                    {table}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            )}

            {browserCloudImport && selectedDestinationChoice === 'create' && (
                <ImportNewTableForm
                    {...{
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
                    }}
                />
            )}

            <div className="import-setup-columns">
                <div className="import-mapping-content">
                    <div className="import-mapping-heading">
                        <div>
                            <span className="import-setup-kicker">COLUMN ROUTING</span>
                            <h3>Match columns</h3>
                            <p>We matched columns with the same name. Change any match below.</p>
                        </div>
                        {(target || creatingTable) && (
                            <div className="import-mapping-counts" aria-live="polite">
                                <span>
                                    <strong>{mappedColumnCount}</strong> mapped
                                </span>
                                <span>
                                    <strong>{skippedColumnCount}</strong> skipped
                                </span>
                            </div>
                        )}
                    </div>
                    {!target && !creatingTable && (
                        <div role="status" className="import-mapping-empty-state">
                            <span
                                className="import-mapping-empty-state-marker"
                                aria-hidden="true"
                            />
                            <div>
                                <strong>{getDestinationHeading()}</strong>
                                <p>{getDestinationInstructions()}</p>
                            </div>
                        </div>
                    )}
                    {destinationColumns.length > 0 && destinationNames.length === 0 && (
                        <div role="status" className="import-mapping-empty-state">
                            <span
                                className="import-mapping-empty-state-marker"
                                aria-hidden="true"
                            />
                            <div>
                                <strong>No columns mapped yet</strong>
                                <p>
                                    Map at least one source column. Skipped columns will not be
                                    imported.
                                </p>
                                {browserCloudImport && !creatingTable && (
                                    <p className="import-mapping-empty-state-hint">
                                        If this file should define the schema, choose “Create a
                                        table” above.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                    {(target || creatingTable) && (
                        <ImportColumnMapping
                            {...{
                                preview,
                                liveMappingIssue,
                                destinationColumns,
                                fields,
                                setFields,
                                setMapping,
                                setError,
                            }}
                        />
                    )}
                    {duplicateDestinations && (
                        <p role="alert" className="import-inline-error">
                            Each destination column can be used only once.
                        </p>
                    )}
                    {target && !creatingTable && !destinationColumns.length && (
                        <p role="alert" className="import-inline-error">
                            The selected table has no writable columns in the loaded schema.
                        </p>
                    )}
                </div>
                <div className="import-setup-preview">
                    <div className="import-section-heading">
                        <span className="import-setup-kicker">DATA SAMPLE</span>
                        <h3>Preview your rows</h3>
                    </div>
                    <ImportPreviewTable preview={preview} columns={sampleColumns} />
                </div>
            </div>
        </section>
    );
}
