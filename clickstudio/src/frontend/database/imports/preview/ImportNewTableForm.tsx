import { cloudImportDatabases } from '../state/cloud-import';
import { useImportWizardController } from '../useImportWizardController';

export function ImportNewTableForm({
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
}: {
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
}) {
    return (
        <div className="import-new-table-card">
            <div className="import-new-table-heading">
                <span className="import-setup-kicker">NEW TABLE</span>
                <strong>Confirm the table structure</strong>
                <small>Names and types are guessed from your file. You can edit them below.</small>
            </div>
            <div className="import-new-table-fields">
                <label>
                    DATABASE
                    <select
                        aria-label="New table database"
                        value={createTableDatabase}
                        onChange={event => {
                            setCreateTableDatabase(event.target.value);
                            setError('');
                        }}
                    >
                        {importableDatabases.map(database => (
                            <option key={database} value={database}>
                                {database}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    TABLE NAME
                    <input
                        aria-label="New table name"
                        aria-invalid={createTableAlreadyExists || undefined}
                        aria-describedby={
                            createTableAlreadyExists ? 'import-table-name-error' : undefined
                        }
                        value={createTableName}
                        onChange={event => {
                            setCreateTableName(event.target.value);
                            setError('');
                        }}
                        maxLength={128}
                    />
                </label>
            </div>
            {createTableAlreadyExists && (
                <p
                    id="import-table-name-error"
                    role="alert"
                    className="import-inline-error import-table-name-error"
                >
                    Table{' '}
                    <code>
                        {createTableDatabase}.{createTableName}
                    </code>{' '}
                    already exists. Enter a different name, or choose “Add to a table”.
                </p>
            )}
            {!importableDatabases.length && (
                <p role="status" className="import-table-hint">
                    No supported database is available. Databases with a period in the name cannot
                    be selected for row import.
                </p>
            )}
            {!hasCreateIdColumn ? (
                <label className="import-generated-id-option">
                    <input
                        type="checkbox"
                        checked={generateId}
                        onChange={event => setGenerateId(event.target.checked)}
                    />
                    <span>
                        <strong>Add a generated id</strong>
                        <small>ClickHouse assigns a UInt64 ID to each row.</small>
                    </span>
                </label>
            ) : (
                <p className="import-id-source-note">
                    Your file already has an <code>id</code> column.
                </p>
            )}
            <div className="import-create-columns">
                <div className="import-create-columns-heading">
                    <span>FILE COLUMN</span>
                    <span>TABLE COLUMN</span>
                    <span>TYPE</span>
                </div>
                {createColumns.map(column => (
                    <div key={column.source} className="import-create-column-row">
                        <span title={column.source}>{column.source}</span>
                        <input
                            aria-label={`New column name for ${column.source}`}
                            value={column.name}
                            onChange={event =>
                                updateCreateColumn(column.source, 'name', event.target.value)
                            }
                            maxLength={128}
                        />
                        <select
                            aria-label={`Type for ${column.source}`}
                            value={column.type}
                            onChange={event =>
                                updateCreateColumn(column.source, 'type', event.target.value)
                            }
                        >
                            {createColumnTypes.map(type => (
                                <option key={type} value={type}>
                                    {type}
                                </option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>
        </div>
    );
}
