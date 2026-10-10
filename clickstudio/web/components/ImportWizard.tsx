import { MAX_IMPORT_FILE_BYTES, IMPORT_FILE_SIZE_LABEL, IMPORT_ROW_LIMIT_LABEL } from '../../shared/import-limits';
import { MAX_SQL_FILE_BYTES, SQL_FILE_SIZE_LABEL } from '../../shared/query-limits';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { cloudImportDatabases, CREATE_CLOUD_TABLE_TARGET } from '../cloud-import';
import { ImportMappingError, mapImportRows, type ImportMappingColumn } from '../../core/import-mapping';
import { ImportJobStatus } from './ImportJobStatus';
import { ImportPreviewTable, ImportReviewRows } from './ImportPreviewTable';
import { formatImportColumnCount, formatImportRowCount, importSteps } from './import-wizard-model';
import { useImportWizardController, type ImportWizardControllerOptions } from './useImportWizardController';
import { Icon } from './ui';
import type { Copy } from '../i18n';
import type { Json } from '../../shared/types';

function fillImportCopy(template: string, values: Record<string, string>) {
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, key: string) => values[key] ?? placeholder);
}

function findLiveMappingIssue(sourceRows: Record<string, Json>[], fields: Record<string, string>, destinationColumns: ImportMappingColumn[]) {
    for (const [source, destination] of Object.entries(fields)) {
        const column = destinationColumns.find(candidate => candidate.name === destination);
        if (!column) continue;
        try {
            mapImportRows(sourceRows, [source], { [source]: destination }, [column]);
        } catch (caught) {
            if (caught instanceof ImportMappingError && ['IMPORT_NULL_VALUE', 'IMPORT_VALUE_TYPE'].includes(caught.code))
                return { source, message: caught.message };
        }
    }
    return undefined;
}

type ImportWizardProps = ImportWizardControllerOptions & {
    onImportQuery: (name: string, sql: string) => boolean;
    importCopy: Copy['imports'];
};

export function ImportWizard({ onImportQuery, importCopy, ...controllerProps }: ImportWizardProps) {
    const {
        dialogRef,
        step,
        setStep,
        file,
        format,
        preview,
        setPreview,
        target,
        schema,
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
        chooseFile,
        previewFile,
        previewSampleFile,
        changeTarget,
        previewMapping,
        commitImport,
        confirmUnknownImport,
    } = useImportWizardController(controllerProps);
    const errorAlertRef = useRef<HTMLParagraphElement>(null);
    const hasCreateIdColumn = createColumns.some(column => column.name.toLowerCase() === 'id');
    const importableDatabases = cloudImportDatabases(schema);
    const mappedFields = mapping?.fields ?? selectedFields;
    const mappedColumnCount = preview?.columns.filter(source => Boolean(mappedFields[source])).length ?? 0;
    const skippedColumnCount = (preview?.columns.length ?? 0) - mappedColumnCount;
    const mappedDestinations = new Set(Object.values(mappedFields).filter(Boolean));
    const omittedDestinationColumns = destinationColumns.filter(column => !mappedDestinations.has(column.name));
    const missingSourceFields = Object.entries(mapping?.missingFields ?? {}).filter(([, count]) => count > 0);
    const [importKind, setImportKind] = useState<'rows' | 'query'>('rows');
    const [queryFile, setQueryFile] = useState<File>();
    const [queryFileError, setQueryFileError] = useState('');
    const [openingQuery, setOpeningQuery] = useState(false);
    const [destinationChoice, setDestinationChoice] = useState<'existing' | 'create'>();
    const selectedDestinationChoice = destinationChoice ?? (creatingTable ? 'create' : target ? 'existing' : browserCloudImport && availableTargets.length ? 'existing' : undefined);
    const liveMappingIssue = useMemo(() => {
        if (!preview || importKind !== 'rows' || step !== 'mapping' || !target || !destinationColumns.length) return undefined;
        return findLiveMappingIssue(preview.rows, selectedFields, destinationColumns);
    }, [destinationColumns, importKind, preview, selectedFields, step, target]);

    useEffect(() => {
        if (!controllerProps.open) { setDestinationChoice(undefined); return; }
        setImportKind('rows');
        setQueryFile(undefined);
        setQueryFileError('');
        setOpeningQuery(false);
        setDestinationChoice(undefined);
    }, [controllerProps.open]);

    useEffect(() => {
        if (!error || importKind !== 'rows' || recoveryState === 'failed') return;
        const alert = errorAlertRef.current;
        if (!alert) return;
        alert.focus({ preventScroll: true });
        alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [error, importKind, recoveryState]);

    function chooseQueryFile(next?: File) {
        setQueryFile(next);
        setQueryFileError('');
        if (!next) return;
        if (!next.name.toLowerCase().endsWith('.sql')) setQueryFileError('Choose a .sql file.');
        else if (next.size > MAX_SQL_FILE_BYTES) setQueryFileError(`SQL files must be ${SQL_FILE_SIZE_LABEL} or smaller.`);
    }

    function closeQueryMode() {
        if (preview?.id && !browserCloudImport) void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined);
        controllerProps.onClose();
    }

    function importAnotherFile() {
        if (preview?.id && !browserCloudImport) void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined);
        chooseFile(undefined);
        setDestinationChoice(undefined);
        setStep('file');
    }

    function chooseRowsFile(next?: File) {
        setDestinationChoice(undefined);
        chooseFile(next);
    }

    function loadSampleFile() {
        setDestinationChoice(undefined);
        void previewSampleFile();
    }

    async function openQueryFile() {
        if (!queryFile || queryFileError || openingQuery) return;
        setOpeningQuery(true);
        setQueryFileError('');
        try {
            const sql = await queryFile.text();
            if (!sql.trim()) {
                setQueryFileError('This SQL file is empty.');
                return;
            }
            const originalName = queryFile.name.split(/[\\/]/).at(-1)?.replace(/\.sql$/i, '') ?? '';
            const safeName = originalName.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim();
            if (!onImportQuery(`${safeName || 'Imported query'}.sql`, sql)) return;
            closeQueryMode();
        } catch (caught) {
            setQueryFileError(caught instanceof Error ? caught.message : 'Could not read this SQL file.');
        } finally {
            setOpeningQuery(false);
        }
    }
    return <dialog
        ref={dialogRef}
        aria-labelledby="import-wizard-title"
        onCancel={event => { event.preventDefault(); if (openingQuery) return; if (importKind === 'query') closeQueryMode(); else if (browserCloudImport || (!busy && job?.status !== 'running')) void closeWizard(); }}
        onClick={event => { if (event.target === dialogRef.current && !openingQuery) { if (importKind === 'query') closeQueryMode(); else if (browserCloudImport || (!busy && job?.status !== 'running')) void closeWizard(); } }}
        className="import-wizard-dialog m-auto max-h-[min(90vh,800px)] w-[min(860px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow-dialog)]"
    >
        <div className="import-wizard-shell flex max-h-[min(90vh,800px)] flex-col">
            <header className="import-wizard-header flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-4 sm:px-7">
                <div className="min-w-0">
                    <span className="import-wizard-eyebrow text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{browserDemoImport ? 'Interview demo · browser sandbox' : browserCloudImport ? 'ClickHouse Cloud' : 'ClickHouse data'}</span>
                    <h2 id="import-wizard-title" className="import-wizard-title mt-1 text-lg font-semibold tracking-tight">Import data</h2>
                    <p className="import-wizard-description mt-1 text-xs text-[var(--text-soft)]">{importKind === 'query' ? 'Open a SQL file as a new draft. It will not run until you choose Run.' : browserDemoImport ? 'Preview, map, and save rows into this browser’s sample dataset.' : browserCloudImport ? 'Preview, map, and import rows with your connected Cloud account.' : 'Preview, map, and review rows before inserting them.'}</p>
                </div>
                <button type="button" aria-label="Close import wizard" disabled={openingQuery || (importKind === 'rows' && !browserCloudImport && (Boolean(busy) || job?.status === 'running'))} onClick={() => importKind === 'query' ? closeQueryMode() : void closeWizard()} className="import-wizard-close rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] transition hover:bg-[var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40">Close</button>
            </header>

            <div role="group" aria-label="Import type" className="import-kind-choice">
                <button type="button" aria-pressed={importKind === 'rows'} disabled={openingQuery} className={`import-kind-button is-rows${importKind === 'rows' ? ' is-selected' : ''}`} onClick={() => setImportKind('rows')}>
                    <span className="import-kind-icon" aria-hidden="true"><Icon name="importFile"/></span>
                    <span className="import-kind-copy"><strong>Rows</strong><small>CSV · JSON · NDJSON</small></span>
                </button>
                <button type="button" aria-pressed={importKind === 'query'} disabled={openingQuery} className={`import-kind-button is-query${importKind === 'query' ? ' is-selected' : ''}`} onClick={() => setImportKind('query')}>
                    <span className="import-kind-icon" aria-hidden="true"><Icon name="parser"/></span>
                    <span className="import-kind-copy"><strong>Open SQL file</strong><small>Start a new query draft.</small></span>
                </button>
            </div>

            {importKind === 'rows' && <nav aria-label="Import steps" className="import-wizard-steps grid grid-cols-4 border-b border-[var(--line)] bg-[var(--page)] px-3 py-2 sm:px-7">
                {importSteps.map((item, index) => {
                    const currentIndex = importSteps.findIndex(candidate => candidate.id === step);
                    const isCurrent = step === item.id;
                    const isComplete = currentIndex > index;
                    return <div key={item.id} aria-current={isCurrent ? 'step' : undefined} className={`import-step-item${isCurrent ? ' is-current' : ''}${isComplete ? ' is-complete' : ''}`}>
                        <span className="import-step-number" aria-hidden="true">{isComplete ? '✓' : index + 1}</span>
                        <span className="import-step-label">{item.label}</span>
                    </div>;
                })}
            </nav>}

            <main key={importKind === 'query' ? 'query' : step} className={`import-wizard-main ${importKind === 'query' ? 'is-query' : `is-${step}`} min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7`}>
                {importKind === 'query' ? <section aria-label="Import SQL query" className="space-y-4">
                    <div><h3 className="text-sm font-semibold">Open a SQL query file</h3><p className="mt-1 text-xs leading-relaxed text-[var(--text-soft)]">The file opens as a new draft. It will not run until you choose Run.</p></div>
                    <label className="import-file-picker import-file-picker-query import-query-picker">
                        <span className="import-file-icon" aria-hidden="true"><Icon name="parser"/></span>
                        <span className="import-file-copy"><strong>Choose a query file</strong><small>SQL · up to {SQL_FILE_SIZE_LABEL}</small></span>
                        <input aria-label="Choose a SQL query file" type="file" accept=".sql,text/plain,application/sql" onChange={event => chooseQueryFile(event.target.files?.[0])} className="import-file-input" />
                    </label>
                    {queryFile && <div className="import-selected-file flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--page)] px-4 py-3 text-xs"><span className="min-w-0 truncate font-medium">{queryFile.name}</span><span className="text-[var(--muted)]">SQL · {(queryFile.size / 1024).toFixed(1)} KB</span></div>}
                    {queryFileError && <p role="alert" className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs leading-relaxed text-[var(--red)]">{queryFileError}</p>}
                </section> : <>
                {browserDemoImport && <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3 text-xs leading-relaxed text-[var(--text-soft)]"><span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--accent)]"/><span><strong className="text-[var(--text)]">Vercel demo mode.</strong> Your file stays in this browser and is added to <code className="font-mono">demo.interview_imports</code>. Nothing is written to the public ClickHouse Playground.</span></div>}
                {browserCloudImport && <div role="status" className="import-permission-note mb-4 flex items-start gap-3 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3 text-xs leading-relaxed text-[var(--text-soft)]"><span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--accent)]"/><span><strong className="text-[var(--text)]">Cloud import.</strong> ClickHouse checks insert permission for an existing table and CREATE TABLE permission for a new table.</span></div>}
                {error && recoveryState !== 'failed' && <p ref={errorAlertRef} role="alert" tabIndex={-1} className="mb-4 whitespace-pre-wrap break-words rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs leading-relaxed text-[var(--red)] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--red)]">{error}</p>}
                {recoveryState === 'checking' && <div role="status" className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm text-[var(--text-soft)]">Checking for imports that need review before allowing another write…</div>}
                {recoveryState === 'failed' && <div role="alert" className="rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/5 p-4 text-sm text-[var(--red)]"><p>{error || 'Could not check whether an earlier import finished. Close and reopen the importer to check again.'}</p></div>}
                {recoveryState === 'ready' && importUnavailable && <div role="status" className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm text-[var(--text-soft)]">{importUnavailable}</div>}
                {recoveryState === 'ready' && busy === 'setup' && <div role="status" className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm text-[var(--text-soft)]">Loading destination tables…</div>}
                {recoveryState === 'ready' && busy === 'recover' && step === 'status' && <div role="status" className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--page)] p-3 text-xs text-[var(--text-soft)]">Checking the saved import status…</div>}

                {recoveryState === 'ready' && !importUnavailable && step === 'file' && <section aria-label="Choose and preview a file" className="space-y-4">
                    {!preview ? <>
                        {browserDemoImport && <div className="import-sample-card flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line-bright)] bg-[var(--page)] p-4"><div><strong className="block text-sm">Try a sample import</strong><span className="mt-1 block text-xs text-[var(--muted)]">Six rows of marketing data, ready to preview.</span></div><button type="button" onClick={loadSampleFile} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line-bright)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'preview' ? 'Loading sample…' : 'Load sample file'}</button></div>}
                        <label className="import-file-picker import-file-picker-rows">
                            <span className="import-file-icon" aria-hidden="true"><Icon name="importFile"/></span>
                            <span className="import-file-copy"><strong>Choose a data file</strong><small>CSV, JSON, NDJSON, or JSONL · up to {IMPORT_FILE_SIZE_LABEL}</small></span>
                            <input aria-label="Choose a CSV, JSON, or NDJSON file" type="file" accept=".csv,.json,.ndjson,.jsonl,text/csv,application/json" onChange={event => chooseRowsFile(event.target.files?.[0])} className="import-file-input" />
                        </label>
                        {file && <div className="import-selected-file flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--page)] px-4 py-3 text-xs"><span className="min-w-0 truncate font-medium">{file.name}</span><span className="text-[var(--muted)]">{format ? format.toUpperCase() : 'Unsupported'} · {(file.size / 1024).toFixed(1)} KB</span></div>}
                    </> : <>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div><span className="text-xs font-semibold">{preview.name}</span><p className="mt-1 text-[11px] text-[var(--muted)]">{formatImportRowCount(preview.rowCount)} · {formatImportColumnCount(preview.columns.length)} · {preview.format.toUpperCase()}</p></div>
                            <button type="button" onClick={() => { if (!browserCloudImport) void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined); setPreview(undefined); setMapping(undefined); setStep('file'); setError(''); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] text-[var(--text-soft)] hover:bg-[var(--panel-hover)]">Choose another file</button>
                        </div>
                        <ImportPreviewTable preview={preview} columns={sampleColumns}/>
                    </>}
                    {preview && availableTargets.length === 0 && !browserCloudImport && <div role="status" className="rounded-lg border border-[var(--line)] p-3 text-xs text-[var(--muted)]">No configured import destination is available for this connection.</div>}
                </section>}

                {recoveryState === 'ready' && !importUnavailable && step === 'mapping' && preview && <section aria-label="Map source columns" className="import-mapping-step import-setup">
                    <div className="import-setup-source">
                        <span className="import-setup-source-icon" aria-hidden="true"><Icon name="importFile"/></span>
                        <div className="import-setup-source-copy">
                            <span className="import-setup-kicker">SOURCE FILE</span>
                            <strong title={preview.name}>{preview.name}</strong>
                            <span>{formatImportRowCount(preview.rowCount)} · {formatImportColumnCount(preview.columns.length)} · {preview.format.toUpperCase()}</span>
                        </div>
                        <button type="button" onClick={importAnotherFile} disabled={Boolean(busy)} className="import-change-file">Change file</button>
                    </div>

                    {browserCloudImport && <fieldset className="import-destination-choice">
                        <legend>Where should the rows go?</legend>
                        <div className="import-destination-options">
                            <label className={`import-destination-option${selectedDestinationChoice === 'existing' ? ' is-selected' : ''}${!availableTargets.length ? ' is-disabled' : ''}`}>
                                <input type="radio" name="import-destination" value="existing" checked={selectedDestinationChoice === 'existing'} disabled={!availableTargets.length} onChange={() => { setDestinationChoice('existing'); changeTarget(availableTargets.includes(lastExistingTarget) ? lastExistingTarget : ''); }}/>
                                <span className="import-destination-option-index" aria-hidden="true">01</span>
                                <span className="import-destination-option-copy"><strong className="import-destination-option-title">Add to a table</strong><small className="import-destination-option-description">Choose a table that already exists.</small></span>
                            </label>
                            <label className={`import-destination-option${selectedDestinationChoice === 'create' ? ' is-selected' : ''}`}>
                                <input type="radio" name="import-destination" value="create" checked={selectedDestinationChoice === 'create'} onChange={() => { setDestinationChoice('create'); changeTarget(CREATE_CLOUD_TABLE_TARGET); }}/>
                                <span className="import-destination-option-index" aria-hidden="true">02</span>
                                <span className="import-destination-option-copy"><strong className="import-destination-option-title">Create a table</strong><small className="import-destination-option-description">Build a new table from this file.</small></span>
                            </label>
                        </div>
                        {selectedDestinationChoice === 'existing' && <div className="import-destination-select-shell">
                            <label className="import-destination-select">DESTINATION TABLE
                                <select aria-label="Import target table" value={target} onChange={event => changeTarget(event.target.value)}>
                                    <option value="">Choose a table…</option>
                                    {availableTargets.map(table => <option key={table} value={table}>{table}</option>)}
                                </select>
                            </label>
                            <span className="import-destination-helper">You can only add rows to a table with compatible columns.</span>
                        </div>}
                    </fieldset>}

                    {!browserCloudImport && <div className="import-destination-panel">
                        <div className="import-section-heading"><span className="import-setup-kicker">DESTINATION</span><h3>Choose a table</h3></div>
                        <label className="import-destination-select">CLICKHOUSE TABLE
                            <select aria-label="Import target table" value={target} onChange={event => changeTarget(event.target.value)}>
                                <option value="">Choose a table…</option>
                                {availableTargets.map(table => <option key={table} value={table}>{table}</option>)}
                            </select>
                        </label>
                    </div>}

                    {browserCloudImport && selectedDestinationChoice === 'create' && <div className="import-new-table-card">
                        <div className="import-new-table-heading"><span className="import-setup-kicker">NEW TABLE</span><strong>Confirm the table structure</strong><small>Names and types are guessed from your file. You can edit them below.</small></div>
                        <div className="import-new-table-fields">
                            <label>DATABASE
                                <select aria-label="New table database" value={createTableDatabase} onChange={event => { setCreateTableDatabase(event.target.value); setError(''); }}>
                                    {importableDatabases.map(database => <option key={database} value={database}>{database}</option>)}
                                </select>
                            </label>
                            <label>TABLE NAME
                                <input aria-label="New table name" aria-invalid={createTableAlreadyExists || undefined} aria-describedby={createTableAlreadyExists ? 'import-table-name-error' : undefined} value={createTableName} onChange={event => { setCreateTableName(event.target.value); setError(''); }} maxLength={128} />
                            </label>
                        </div>
                        {createTableAlreadyExists && <p id="import-table-name-error" role="alert" className="import-inline-error import-table-name-error">Table <code>{createTableDatabase}.{createTableName}</code> already exists. Enter a different name, or choose “Add to a table”.</p>}
                        {!importableDatabases.length && <p role="status" className="import-table-hint">No supported database is available. Databases with a period in the name cannot be selected for row import.</p>}
                        {!hasCreateIdColumn ? <label className="import-generated-id-option"><input type="checkbox" checked={generateId} onChange={event => setGenerateId(event.target.checked)}/><span><strong>Add a generated id</strong><small>ClickHouse assigns a UInt64 ID to each row.</small></span></label> : <p className="import-id-source-note">Your file already has an <code>id</code> column.</p>}
                        <div className="import-create-columns">
                            <div className="import-create-columns-heading"><span>FILE COLUMN</span><span>TABLE COLUMN</span><span>TYPE</span></div>
                            {createColumns.map(column => <div key={column.source} className="import-create-column-row">
                                <span title={column.source}>{column.source}</span>
                                <input aria-label={`New column name for ${column.source}`} value={column.name} onChange={event => updateCreateColumn(column.source, 'name', event.target.value)} maxLength={128} />
                                <select aria-label={`Type for ${column.source}`} value={column.type} onChange={event => updateCreateColumn(column.source, 'type', event.target.value)}>
                                    {createColumnTypes.map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                            </div>)}
                        </div>
                    </div>}

                    <div className="import-setup-columns">
                        <div className="import-mapping-content">
                            <div className="import-mapping-heading">
                                <div><span className="import-setup-kicker">COLUMN ROUTING</span><h3>Match columns</h3><p>We matched columns with the same name. Change any match below.</p></div>
                                {(target || creatingTable) && <div className="import-mapping-counts" aria-live="polite">
                                    <span><strong>{mappedColumnCount}</strong> mapped</span>
                                    <span><strong>{skippedColumnCount}</strong> skipped</span>
                                </div>}
                            </div>
                            {!target && !creatingTable && <div role="status" className="import-mapping-empty-state">
                                <span className="import-mapping-empty-state-marker" aria-hidden="true" />
                                <div>
                                    <strong>{browserCloudImport ? selectedDestinationChoice === 'existing' ? 'Choose a table' : 'Choose where the rows go' : 'Choose a table'}</strong>
                                    <p>{browserCloudImport ? selectedDestinationChoice === 'existing' ? 'Select a table above. Matching columns will be filled in for you.' : 'Choose “Add to a table” or “Create a table” to continue.' : 'Select a destination above. Matching columns will be filled in for you.'}</p>
                                </div>
                            </div>}
                            {destinationColumns.length > 0 && destinationNames.length === 0 && <div role="status" className="import-mapping-empty-state">
                                <span className="import-mapping-empty-state-marker" aria-hidden="true" />
                                <div>
                                    <strong>No columns mapped yet</strong>
                                    <p>Map at least one source column. Skipped columns will not be imported.</p>
                                    {browserCloudImport && !creatingTable && <p className="import-mapping-empty-state-hint">If this file should define the schema, choose “Create a table” above.</p>}
                                </div>
                            </div>}
                            {(target || creatingTable) && <div className="import-column-map">
                                <table className="w-full min-w-[540px] border-collapse text-left text-xs">
                                    <thead><tr><th>FROM FILE</th><th>TO TABLE</th><th>TYPE</th></tr></thead>
                                    <tbody>{preview.columns.map((source, sourceIndex) => {
                                        const sourceIssue = liveMappingIssue?.source === source ? liveMappingIssue : undefined;
                                        const issueId = sourceIssue ? `import-mapping-error-${sourceIndex}` : undefined;
                                        const destinationType = destinationColumns.find(column => column.name === fields[source])?.type;
                                        return <tr key={source}>
                                        <th scope="row" title={source}><code className="import-source-column-name">{source}</code></th>
                                        <td><select aria-label={`Map ${source} to destination`} aria-invalid={sourceIssue ? true : undefined} aria-describedby={issueId} value={fields[source] ?? ''} onChange={event => { setFields(current => ({ ...current, [source]: event.target.value })); setMapping(undefined); setError(''); }}><option value="">Skip column</option>{destinationColumns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</select>{sourceIssue && <p id={issueId} role="alert" className="mt-2 max-w-80 text-[11px] leading-relaxed text-[var(--red)]">{sourceIssue.message}</p>}</td>
                                        <td className="import-column-type-cell"><span className="import-column-type" title={destinationType}>{destinationType ?? '—'}</span></td>
                                    </tr>;
                                    })}</tbody>
                                </table>
                            </div>}
                            {duplicateDestinations && <p role="alert" className="import-inline-error">Each destination column can be used only once.</p>}
                            {target && !creatingTable && !destinationColumns.length && <p role="alert" className="import-inline-error">The selected table has no writable columns in the loaded schema.</p>}
                        </div>
                        <div className="import-setup-preview">
                            <div className="import-section-heading"><span className="import-setup-kicker">DATA SAMPLE</span><h3>Preview your rows</h3></div>
                            <ImportPreviewTable preview={preview} columns={sampleColumns}/>
                        </div>
                    </div>
                </section>}

                {recoveryState === 'ready' && !importUnavailable && step === 'review' && mapping && preview && <section aria-label="Review import" className="import-review-step space-y-4">
                    <div className="import-ready-card rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 sm:p-5">
                        <span className="import-ready-eyebrow text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{browserDemoImport ? 'Ready to save in browser demo' : creatingTable ? 'Ready to create and import' : 'Ready to insert'}</span>
                        <h3 className="import-ready-title mt-1 text-base font-semibold">Ready to import into <code className="rounded bg-[var(--page)] px-1.5 py-1 font-mono text-sm">{mapping.table}</code></h3>
                        <p className="mt-2 text-xs leading-relaxed text-[var(--text-soft)]">{browserDemoImport ? 'This adds rows to the Vercel interview sandbox in this browser. It does not write to ClickHouse.' : browserCloudImport ? creatingTable ? 'This creates a MergeTree table in the connected database, then inserts the file rows.' : 'This writes to the selected Cloud table. ClickHouse checks your account permissions and destination types.' : 'This writes data to the selected ClickHouse table. The mapping and destination schema were checked by the server.'}</p>
                        <dl className="import-review-metrics" aria-label="Import summary">
                            <div><dt>Rows</dt><dd>{formatImportRowCount(mapping.rowCount)}</dd></div>
                            <div><dt>Mapped</dt><dd>{formatImportColumnCount(mappedColumnCount)}</dd></div>
                            <div><dt>Skipped</dt><dd>{formatImportColumnCount(skippedColumnCount)}</dd></div>
                        </dl>
                    </div>
                    {omittedDestinationColumns.length > 0 && <p className="rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 py-2.5 text-xs leading-relaxed text-[var(--text-soft)]">{fillImportCopy(importCopy.reviewOmittedTargets, { columns: omittedDestinationColumns.map(column => column.name).join(', ') })}</p>}
                    {missingSourceFields.length > 0 && <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 py-2.5 text-xs leading-relaxed text-[var(--text-soft)]">
                        {missingSourceFields.map(([source, count]) => {
                            const destination = mapping.fields[source];
                            if (!destination) return null;
                            const rowLabel = count === 1 ? importCopy.inputRow : importCopy.inputRows;
                            return <p key={source}>{fillImportCopy(importCopy.reviewMissingValues, { source, count: count.toLocaleString(), rowLabel, destination })}</p>;
                        })}
                    </div>}
                    <ImportReviewRows key={mapping.id} rows={mapping.rows} columns={Object.values(mapping.fields)} copy={importCopy}/>
                    <div className="import-review-mapping rounded-xl border border-[var(--line)] bg-[var(--page)]">
                        <div className="import-review-mapping-header"><h4 className="text-xs font-semibold">Column mapping</h4><span>{mappedColumnCount} mapped · {skippedColumnCount} skipped</span></div>
                        <div className="import-review-mapping-list">
                            <table aria-label="Import column mapping">
                                <thead><tr><th scope="col">Source column</th><th scope="col">Destination column</th><th scope="col">Type</th></tr></thead>
                                <tbody>
                                    {preview.columns.map(source => {
                                        const destination = mapping.fields[source];
                                        const type = destinationColumns.find(column => column.name === destination)?.type;
                                        return <tr key={source}>
                                            <th scope="row" title={source}>{source}</th>
                                            <td>{destination ? <code>{destination}</code> : <span className="import-review-skipped">Skipped</span>}</td>
                                            <td>{type ?? '—'}</td>
                                        </tr>;
                                    })}
                                    {creatingTable && generateId && !hasCreateIdColumn && <tr className="is-generated"><th scope="row">Generated id</th><td><span>ClickHouse</span></td><td>UInt64</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>}

                {recoveryState === 'ready' && !importUnavailable && step === 'status' && <ImportJobStatus
                    job={job} pendingImport={pendingImport} browserDemoImport={browserDemoImport} browserCloudImport={browserCloudImport}
                    recoverableJobCount={recoverableJobs.length} busy={busy}
                    onConfirm={() => void confirmUnknownImport()} onOpenDestination={openImportDestination} onForget={forgetImport}
                />}
                </>}
            </main>

            <footer className="import-wizard-footer flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--page)] px-5 py-3 sm:px-7">
                <span className="import-wizard-footer-note text-[10px] text-[var(--muted)]">{importKind === 'query' ? 'SQL opens as a draft and does not run automatically' : browserDemoImport ? 'Browser demo · nothing is written to ClickHouse' : browserCloudImport ? `CSV, JSON, or NDJSON · up to ${IMPORT_FILE_SIZE_LABEL} and ${IMPORT_ROW_LIMIT_LABEL} rows` : step === 'file' ? `CSV, JSON, or NDJSON · up to ${IMPORT_FILE_SIZE_LABEL} and ${IMPORT_ROW_LIMIT_LABEL} rows` : step === 'mapping' ? target ? `${formatImportColumnCount(Object.keys(selectedFields).length)} mapped · review before writing` : 'Choose a table and match its columns' : step === 'review' ? 'Review the destination and row count before writing' : 'Import status is checked with ClickHouse'}</span>
                <div className="flex items-center gap-2">
                    {importKind === 'query' && <button type="button" onClick={() => void openQueryFile()} disabled={!queryFile || Boolean(queryFileError) || openingQuery} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{openingQuery ? 'Opening…' : 'Open query'}</button>}
                    {importKind === 'rows' && <>
                    {recoveryState === 'ready' && step === 'review' && <button type="button" onClick={() => { setStep('mapping'); setError(''); }} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">Back</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'file' && <button type="button" onClick={() => void previewFile()} disabled={!file || !format || file.size > MAX_IMPORT_FILE_BYTES || Boolean(busy) || (!availableTargets.length && !browserCloudImport)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'preview' ? 'Reading file…' : 'Read file and continue'}</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'mapping' && <button type="button" onClick={() => void previewMapping()} disabled={!target || !destinationNames.length || duplicateDestinations || !destinationColumns.length || createTableAlreadyExists || Boolean(liveMappingIssue) || Boolean(busy)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'mapping' ? 'Checking mapping…' : liveMappingIssue ? 'Fix column mapping' : !target ? browserCloudImport && selectedDestinationChoice === 'existing' ? 'Choose a table' : 'Choose a destination' : createTableAlreadyExists ? 'Choose another table name' : !destinationNames.length && destinationColumns.length > 0 ? 'Map a column first' : duplicateDestinations ? 'Fix duplicate columns' : !destinationColumns.length ? 'No writable columns' : 'Review import'}</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'review' && <button type="button" onClick={() => void commitImport()} disabled={Boolean(busy)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'commit' ? browserDemoImport ? 'Saving…' : 'Starting…' : creatingTable ? 'Create table and import' : browserDemoImport ? 'Save demo rows' : 'Import rows'}</button>}
                    {recoveryState === 'ready' && step === 'status' && job?.status === 'succeeded' && <>
                        <button type="button" onClick={importAnotherFile} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] transition hover:bg-[var(--panel-hover)] disabled:opacity-40">Import another file</button>
                        <button type="button" onClick={() => void closeWizard()} disabled={Boolean(busy)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:opacity-40">Done</button>
                    </>}
                    </>}
                </div>
            </footer>
        </div>
    </dialog>;
}
