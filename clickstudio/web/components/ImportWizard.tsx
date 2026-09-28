import { useEffect, useState } from 'react';
import { api } from '../api';
import { CREATE_CLOUD_TABLE_TARGET } from '../cloud-import';
import { ImportPreviewTable } from './ImportPreviewTable';
import { displayImportValue, formatImportRowCount, MAX_FILE_BYTES, importSteps } from './import-wizard-model';
import { useImportWizardController, type ImportWizardControllerOptions } from './useImportWizardController';

const MAX_QUERY_FILE_BYTES = 200_000;

type ImportWizardProps = ImportWizardControllerOptions & {
    onImportQuery: (name: string, sql: string) => boolean;
};

export function ImportWizard({ onImportQuery, ...controllerProps }: ImportWizardProps) {
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
        setRecoveryAttempt,
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
        createTableName,
        setCreateTableName,
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
        chooseFile,
        previewFile,
        previewSampleFile,
        startMapping,
        changeTarget,
        previewMapping,
        commitImport,
        reconcileJob,
        reviewUnknownImport,
        confirmUnknownImport,
        retryUnknownImport,
        retryAttemptedFor,
    } = useImportWizardController(controllerProps);
    const canRetryUnknownImport = Boolean(job && job.status === 'unknown' && preview && mapping && (!browserCloudImport || (file && format)) && retryAttemptedFor !== job.id);
    const hasCreateIdColumn = createColumns.some(column => column.name.toLowerCase() === 'id');
    const [importKind, setImportKind] = useState<'rows' | 'query'>('rows');
    const [queryFile, setQueryFile] = useState<File>();
    const [queryFileError, setQueryFileError] = useState('');
    const [openingQuery, setOpeningQuery] = useState(false);

    useEffect(() => {
        if (!controllerProps.open) return;
        setImportKind('rows');
        setQueryFile(undefined);
        setQueryFileError('');
        setOpeningQuery(false);
    }, [controllerProps.open]);

    function chooseQueryFile(next?: File) {
        setQueryFile(next);
        setQueryFileError('');
        if (!next) return;
        if (!next.name.toLowerCase().endsWith('.sql')) setQueryFileError('Choose a .sql file.');
        else if (next.size > MAX_QUERY_FILE_BYTES) setQueryFileError('SQL files must be 200 KB or smaller.');
    }

    function closeQueryMode() {
        if (preview?.id && !browserCloudImport) void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined);
        controllerProps.onClose();
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
            const safeName = originalName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
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
        onCancel={event => { event.preventDefault(); if (openingQuery) return; if (importKind === 'query') closeQueryMode(); else if (!busy && job?.status !== 'running') void closeWizard(); }}
        onClick={event => { if (event.target === dialogRef.current && !openingQuery) { if (importKind === 'query') closeQueryMode(); else if (!busy && job?.status !== 'running') void closeWizard(); } }}
        className="import-wizard-dialog m-auto max-h-[min(90vh,800px)] w-[min(860px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow)] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
        <div className="import-wizard-shell flex max-h-[min(90vh,800px)] flex-col">
            <header className="import-wizard-header flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-4 sm:px-7">
                <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{browserDemoImport ? 'Interview demo · browser sandbox' : browserCloudImport ? 'ClickHouse Cloud' : 'ClickHouse data'}</span>
                    <h2 id="import-wizard-title" className="mt-1 text-lg font-semibold tracking-tight">Import data</h2>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">{importKind === 'query' ? 'Open a SQL file as a new draft. It will not run until you choose Run.' : browserDemoImport ? 'Preview, map, and save rows into this browser’s sample dataset.' : browserCloudImport ? 'Preview, map, and import rows with your connected Cloud account.' : 'Preview, map, and review rows before inserting them.'}</p>
                </div>
                <button type="button" aria-label="Close import wizard" disabled={openingQuery || (importKind === 'rows' && (Boolean(busy) || job?.status === 'running'))} onClick={() => importKind === 'query' ? closeQueryMode() : void closeWizard()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] transition hover:bg-[var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40">Close</button>
            </header>

            <div role="group" aria-label="Import type" className="import-kind-choice">
                <button type="button" aria-pressed={importKind === 'rows'} disabled={openingQuery} className={`import-kind-button${importKind === 'rows' ? ' is-selected' : ''}`} onClick={() => setImportKind('rows')}>
                    <strong>Import rows</strong><small>Add file rows to an existing or new table.</small>
                </button>
                <button type="button" aria-pressed={importKind === 'query'} disabled={openingQuery} className={`import-kind-button${importKind === 'query' ? ' is-selected' : ''}`} onClick={() => setImportKind('query')}>
                    <strong>Import query</strong><small>Open a .sql file in a new query tab.</small>
                </button>
            </div>

            {importKind === 'rows' && <nav aria-label="Import steps" className="import-wizard-steps grid grid-cols-4 border-b border-[var(--line)] bg-[var(--page)] px-3 py-2 sm:px-7">
                {importSteps.map((item, index) => {
                    const currentIndex = importSteps.findIndex(candidate => candidate.id === step);
                    return <div key={item.id} aria-current={step === item.id ? 'step' : undefined} className={`flex items-center gap-2 px-2 py-1 text-[10px] font-medium sm:text-xs ${step === item.id ? 'text-[var(--accent)]' : currentIndex > index ? 'text-[var(--text-soft)]' : 'text-[var(--muted)]'}`}><span className={`grid size-5 place-items-center rounded-full border text-[9px] ${step === item.id ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : currentIndex > index ? 'border-[var(--line-bright)] bg-[var(--panel-raised)]' : 'border-[var(--line)]'}`}>{index + 1}</span>{item.label}</div>;
                })}
            </nav>}

            <main className="import-wizard-main min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
                {importKind === 'query' ? <section aria-label="Import SQL query" className="space-y-4">
                    <div><h3 className="text-sm font-semibold">Open a SQL query file</h3><p className="mt-1 text-xs leading-relaxed text-[var(--text-soft)]">The file opens as a new draft. It will not run until you choose Run.</p></div>
                    <label className="import-query-picker block rounded-xl border border-dashed border-[var(--line-bright)] bg-[var(--page)] p-5 transition hover:border-[var(--accent)] sm:p-7">
                        <span className="block text-sm font-semibold">Choose a query file</span>
                        <span className="mt-1 block text-xs text-[var(--muted)]">SQL · up to 200 KB</span>
                        <input aria-label="Choose a SQL query file" type="file" accept=".sql,text/plain,application/sql" onChange={event => chooseQueryFile(event.target.files?.[0])} className="mt-4 block w-full cursor-pointer text-xs text-[var(--text-soft)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--panel-raised)] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[var(--text)] hover:file:bg-[var(--panel-hover)]" />
                    </label>
                    {queryFile && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--page)] px-4 py-3 text-xs"><span className="min-w-0 truncate font-medium">{queryFile.name}</span><span className="text-[var(--muted)]">SQL · {(queryFile.size / 1024).toFixed(1)} KB</span></div>}
                    {queryFileError && <p role="alert" className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs leading-relaxed text-[var(--red)]">{queryFileError}</p>}
                </section> : <>
                {browserDemoImport && <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3 text-xs leading-relaxed text-[var(--text-soft)]"><span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--accent)]"/><span><strong className="text-[var(--text)]">Vercel demo mode.</strong> Your file stays in this browser and is added to <code className="font-mono">demo.interview_imports</code>. Nothing is written to the public ClickHouse Playground.</span></div>}
                {browserCloudImport && <div role="status" className="import-permission-note mb-4 flex items-start gap-3 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3 text-xs leading-relaxed text-[var(--text-soft)]"><span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--accent)]"/><span><strong className="text-[var(--text)]">Cloud import.</strong> ClickHouse checks insert permission for an existing table and CREATE TABLE permission for a new table.</span></div>}
                {recoveryState === 'checking' && <div role="status" className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm text-[var(--text-soft)]">Checking for imports that need review before allowing another write…</div>}
                {recoveryState === 'failed' && <div role="alert" className="rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/5 p-4 text-sm text-[var(--red)]"><p>{error || 'Previous import status could not be checked. Review it before starting another write.'}</p><button type="button" onClick={() => { setError(''); setRecoveryAttempt(value => value + 1); }} className="mt-3 rounded-lg border border-current px-3 py-2 text-xs font-semibold">Retry recovery check</button></div>}
                {recoveryState === 'ready' && importUnavailable && <div role="status" className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm text-[var(--text-soft)]">{importUnavailable}</div>}
                {recoveryState === 'ready' && busy === 'setup' && <div role="status" className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm text-[var(--text-soft)]">Loading destination tables…</div>}
                {recoveryState === 'ready' && busy === 'recover' && step === 'status' && <div role="status" className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--page)] p-3 text-xs text-[var(--text-soft)]">Checking the saved import status…</div>}

                {recoveryState === 'ready' && !importUnavailable && step === 'file' && <section aria-label="Choose and preview a file" className="space-y-4">
                    {!preview ? <>
                        {browserDemoImport && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line-bright)] bg-[var(--page)] p-4"><div><strong className="block text-sm">Try a sample import</strong><span className="mt-1 block text-xs text-[var(--muted)]">Six rows of marketing data, ready to preview.</span></div><button type="button" onClick={() => void previewSampleFile()} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line-bright)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'preview' ? 'Loading sample…' : 'Load sample file'}</button></div>}
                        <label className="block rounded-xl border border-dashed border-[var(--line-bright)] bg-[var(--page)] p-5 transition hover:border-[var(--accent)] sm:p-7">
                            <span className="block text-sm font-semibold">Choose a data file</span>
                            <span className="mt-1 block text-xs text-[var(--muted)]">CSV, JSON, NDJSON, or JSONL · up to 2 MB</span>
                            <input aria-label="Choose a CSV, JSON, or NDJSON file" type="file" accept=".csv,.json,.ndjson,.jsonl,text/csv,application/json" onChange={event => chooseFile(event.target.files?.[0])} className="mt-4 block w-full cursor-pointer text-xs text-[var(--text-soft)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--panel-raised)] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[var(--text)] hover:file:bg-[var(--panel-hover)]" />
                        </label>
                        {file && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--page)] px-4 py-3 text-xs"><span className="min-w-0 truncate font-medium">{file.name}</span><span className="text-[var(--muted)]">{format ? format.toUpperCase() : 'Unsupported'} · {(file.size / 1024).toFixed(1)} KB</span></div>}
                    </> : <>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div><span className="text-xs font-semibold">{preview.name}</span><p className="mt-1 text-[11px] text-[var(--muted)]">{formatImportRowCount(preview.rowCount)} · {preview.columns.length} columns · {preview.format.toUpperCase()}</p></div>
                            <button type="button" onClick={() => { if (!browserCloudImport) void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined); setPreview(undefined); setMapping(undefined); setStep('file'); setError(''); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] text-[var(--text-soft)] hover:bg-[var(--panel-hover)]">Choose another file</button>
                        </div>
                        <ImportPreviewTable preview={preview} columns={sampleColumns}/>
                    </>}
                    {preview && availableTargets.length === 0 && !browserCloudImport && <div role="status" className="rounded-lg border border-[var(--line)] p-3 text-xs text-[var(--muted)]">No configured import destination is available for this connection.</div>}
                </section>}

                {recoveryState === 'ready' && !importUnavailable && step === 'mapping' && preview && <section aria-label="Map source columns" className="import-mapping-step space-y-4">
                    {browserCloudImport && <fieldset className="import-destination-choice">
                        <legend>Where should the rows go?</legend>
                        <label className={`import-destination-option${!creatingTable ? ' is-selected' : ''}${!availableTargets.length ? ' is-disabled' : ''}`}>
                            <input type="radio" name="import-destination" value="existing" checked={!creatingTable} disabled={!availableTargets.length} onChange={() => changeTarget(availableTargets.includes(lastExistingTarget) ? lastExistingTarget : availableTargets[0] ?? '')}/>
                            <span className="import-destination-option-copy"><strong className="import-destination-option-title">Use an existing table</strong><small className="import-destination-option-description">Add rows to a table that is already there.</small></span>
                        </label>
                        <label className={`import-destination-option${creatingTable ? ' is-selected' : ''}`}>
                            <input type="radio" name="import-destination" value="create" checked={creatingTable} onChange={() => changeTarget(CREATE_CLOUD_TABLE_TARGET)}/>
                            <span className="import-destination-option-copy"><strong className="import-destination-option-title">Create a new table from this file</strong><small className="import-destination-option-description">Choose a name and import the file into it.</small></span>
                        </label>
                    </fieldset>}
                    <div className={`import-map-overview${creatingTable ? ' is-create' : ''}`}>
                        {!creatingTable && <label className="import-destination-select grid gap-1.5 text-xs font-medium text-[var(--text-soft)]">Destination table
                            <select aria-label="Import target table" value={target} onChange={event => changeTarget(event.target.value)} className="min-h-10 rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 text-xs text-[var(--text)]">
                                {availableTargets.map(table => <option key={table} value={table}>{table}</option>)}
                            </select>
                        </label>}
                        <div className="import-source-summary"><span className="import-source-summary-label">File to import</span><strong>{formatImportRowCount(preview.rowCount)}</strong><span title={preview.name}>{preview.name} · {preview.columns.length} columns</span></div>
                    </div>
                    {creatingTable && <div className="import-new-table-card rounded-xl border border-[var(--line)] bg-[var(--page)] p-4">
                        <label className="grid max-w-sm gap-1.5 text-xs font-medium text-[var(--text-soft)]">New table name
                            <input aria-label="New table name" value={createTableName} onChange={event => setCreateTableName(event.target.value)} maxLength={128} className="min-h-10 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 font-mono text-xs text-[var(--text)]" />
                        </label>
                        {!hasCreateIdColumn ? <label className="import-generated-id-option mt-4"><input type="checkbox" checked={generateId} onChange={event => setGenerateId(event.target.checked)}/><span><strong>Add a generated id</strong><small>ClickHouse assigns a UInt64 ID to each row. You can leave it out later when inserting rows.</small></span></label> : <p className="import-id-source-note mt-3">The file has an <code>id</code> column. Its values will be imported.</p>}
                        <div className="mt-3 grid gap-2">
                            {createColumns.map(column => <div key={column.source} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(150px,0.8fr)]">
                                <span className="self-center truncate text-[11px] text-[var(--muted)]" title={column.source}>{column.source}</span>
                                <input aria-label={`New column name for ${column.source}`} value={column.name} onChange={event => updateCreateColumn(column.source, 'name', event.target.value)} maxLength={128} className="min-h-9 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 font-mono text-xs text-[var(--text)]" />
                                <select aria-label={`Type for ${column.source}`} value={column.type} onChange={event => updateCreateColumn(column.source, 'type', event.target.value)} className="min-h-9 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 font-mono text-xs text-[var(--text)]">
                                    {createColumnTypes.map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                            </div>)}
                        </div>
                    </div>}
                    <div className="import-column-map overflow-x-auto rounded-xl border border-[var(--line)]">
                        <table className="w-full min-w-[540px] border-collapse text-left text-xs">
                            <thead className="bg-[var(--page)] text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr><th className="px-3 py-2.5">Source column</th><th className="px-3 py-2.5">Destination column</th><th className="px-3 py-2.5">Type</th></tr></thead>
                            <tbody>{preview.columns.map(source => <tr key={source} className="border-t border-[var(--line)]">
                                <th scope="row" className="max-w-[220px] truncate px-3 py-2.5 font-medium text-[var(--text-soft)]" title={source}>{source}</th>
                                <td className="px-3 py-2"><select aria-label={`Map ${source} to destination`} value={fields[source] ?? ''} onChange={event => { setFields(current => ({ ...current, [source]: event.target.value })); setMapping(undefined); setError(''); }} className="min-h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--page)] px-2.5 text-xs text-[var(--text)]"><option value="">Skip column</option>{destinationColumns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</select></td>
                                <td className="px-3 py-2.5 font-mono text-[10px] text-[var(--muted)]">{destinationColumns.find(column => column.name === fields[source])?.type ?? '—'}</td>
                            </tr>)}</tbody>
                        </table>
                    </div>
                    {duplicateDestinations && <p role="alert" className="text-xs text-[var(--red)]">Each destination column can be used only once.</p>}
                    {!destinationColumns.length && <p role="alert" className="text-xs text-[var(--red)]">The selected table has no writable columns in the loaded schema.</p>}
                </section>}

                {recoveryState === 'ready' && !importUnavailable && step === 'review' && mapping && preview && <section aria-label="Review import" className="import-review-step space-y-4">
                    <div className="import-ready-card rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 sm:p-5">
                        <span className="import-ready-eyebrow text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{browserDemoImport ? 'Ready to save in browser demo' : creatingTable ? 'Ready to create and import' : 'Ready to insert'}</span>
                        <h3 className="import-ready-title mt-1 text-base font-semibold">{formatImportRowCount(mapping.rowCount)} into <code className="rounded bg-[var(--page)] px-1.5 py-1 font-mono text-sm">{mapping.table}</code></h3>
                        <p className="mt-2 text-xs leading-relaxed text-[var(--text-soft)]">{browserDemoImport ? 'This adds rows to the Vercel interview sandbox in this browser. It does not write to ClickHouse.' : browserCloudImport ? creatingTable ? 'This creates a MergeTree table in the connected database, then inserts the file rows.' : 'This writes to the selected Cloud table. ClickHouse checks your account permissions and destination types.' : 'This writes data to the selected ClickHouse table. The mapping and destination schema were checked by the server.'}</p>
                    </div>
                    <div className="import-review-mapping rounded-xl border border-[var(--line)] bg-[var(--page)] p-4">
                        <h4 className="text-xs font-semibold">Column mapping</h4>
                        <div className="import-review-mapping-list mt-3 flex flex-wrap gap-2">{Object.entries(mapping.fields).map(([source, destination]) => <span key={source} className="import-column-chip rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-[10px]"><span className="text-[var(--text-soft)]">{source}</span><span className="mx-1.5 text-[var(--muted)]">→</span><span className="font-medium">{destination}</span></span>)}{creatingTable && generateId && !hasCreateIdColumn && <span className="import-column-chip is-generated rounded-md border border-[var(--accent)]/30 bg-[var(--panel)] px-2.5 py-1.5 text-[10px]"><code>id</code><span className="mx-1.5 text-[var(--muted)]">→</span><span className="font-medium">Generated by ClickHouse</span></span>}</div>
                    </div>
                </section>}

                {recoveryState === 'ready' && !importUnavailable && step === 'status' && <section aria-label="Import status" className="space-y-4">
                    <div className={`rounded-xl border p-5 ${job?.status === 'succeeded' ? 'border-[var(--green)]/30 bg-[var(--green)]/5' : job?.status === 'unknown' ? 'border-[var(--amber)]/35 bg-[var(--amber)]/5' : 'border-[var(--line)] bg-[var(--page)]'}`}>
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{job?.status === 'succeeded' ? 'Import complete' : job?.status === 'unknown' ? 'Import not confirmed' : 'Import running'}</span>
                        <h3 role="status" className="mt-1 text-base font-semibold">{job?.status === 'succeeded' ? browserDemoImport ? `Saved ${formatImportRowCount(job.rows ?? pendingImport?.rows ?? 0)} to ${job.table ?? pendingImport?.table}` : `Inserted ${formatImportRowCount(job.rows ?? pendingImport?.rows ?? 0)} into ${job.table ?? pendingImport?.table}` : job?.status === 'unknown' ? 'We couldn’t confirm the import.' : `${browserDemoImport ? 'Saving' : 'Inserting'} ${formatImportRowCount(job?.rows ?? pendingImport?.rows ?? 0)}…`}</h3>
                        {job?.status === 'unknown' ? <p className="mt-2 text-xs leading-relaxed text-[var(--text-soft)]">ClickHouse couldn’t confirm the import. The rows may already be in {job.table ?? pendingImport?.table ?? 'the table'}. Check the table before choosing. A late first import may add duplicate rows.</p> : job?.status === 'running' ? <p className="mt-2 text-xs text-[var(--muted)]">{job.reconciliationRequired ? 'ClickHouse still reports this import as active. Status checks will continue.' : 'Keep this panel open while the server finishes.'} Wait for it to finish before starting another import.</p> : job?.status === 'succeeded' ? <p className="mt-2 text-xs text-[var(--text-soft)]">{browserDemoImport ? job.demoPersisted ? 'Rows are saved in this browser and are ready to inspect in the sample workspace.' : 'Rows are available in this tab. Browser storage was unavailable, so they will not survive a refresh.' : 'The schema has been refreshed for this connection.'}</p> : <p className="mt-2 text-xs text-[var(--muted)]">Checking the saved import job…</p>}
                    </div>
                    {browserDemoImport && job?.status === 'succeeded' && job.demoRows?.length ? <div className="overflow-hidden rounded-xl border border-[var(--line)]"><div className="flex items-center justify-between gap-3 bg-[var(--page)] px-4 py-3"><strong className="text-xs">Imported rows</strong><span className="text-[10px] text-[var(--muted)]">{formatImportRowCount(job.demoRows.length)} preview</span></div><div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse text-left text-xs"><thead className="bg-[var(--page)] text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr>{Object.keys(job.demoRows[0]!).map(column => <th key={column} className="px-3 py-2">{column}</th>)}</tr></thead><tbody>{job.demoRows.map((row, index) => <tr key={`${job.id}-${index}`} className="border-t border-[var(--line)]">{Object.keys(job.demoRows![0]!).map(column => <td key={column} className="px-3 py-2 text-[var(--text-soft)]">{displayImportValue(row[column])}</td>)}</tr>)}</tbody></table></div><p className="border-t border-[var(--line)] px-4 py-3 text-[11px] text-[var(--muted)]">To query them, switch to <strong className="text-[var(--text-soft)]">Sample data</strong> and run <code className="font-mono text-[var(--accent)]">SELECT * FROM demo.interview_imports</code>.</p></div> : null}
                    {recoverableJobs.length > 1 && <p className="text-xs text-[var(--muted)]">{recoverableJobs.length - 1} more import{recoverableJobs.length === 2 ? '' : 's'} need attention. They will be shown after this one.</p>}
                    {job?.status === 'unknown' && <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => void reconcileJob()} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'reconcile' ? 'Checking…' : 'Check status'}</button>
                        <button type="button" onClick={() => void confirmUnknownImport()} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'review' ? 'Checking…' : 'I see all rows'}</button>
                        {retryAttemptedFor === job.id ? <p className="self-center text-xs text-[var(--muted)]">This retry is also unconfirmed. Check the table before sending another import.</p> : <button type="button" onClick={() => void (canRetryUnknownImport ? retryUnknownImport() : reviewUnknownImport())} disabled={Boolean(busy)} className="rounded-lg border border-[var(--amber)]/40 px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'review' ? 'Checking…' : canRetryUnknownImport ? 'No rows; retry import' : 'No rows; choose file again'}</button>}
                    </div>}
                </section>}

                {error && recoveryState !== 'failed' && <p role="alert" className="mt-4 rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs leading-relaxed text-[var(--red)]">{error}</p>}
                </>}
            </main>

            <footer className="import-wizard-footer flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--page)] px-5 py-3 sm:px-7">
                <span className="text-[10px] text-[var(--muted)]">{importKind === 'query' ? 'SQL file · opens as a draft only' : browserDemoImport ? 'Browser demo · nothing is written to ClickHouse' : browserCloudImport ? 'Up to 2 MB · maximum 10,000 rows · ClickHouse Cloud permissions apply' : step === 'file' ? 'Up to 2 MB · maximum 10,000 rows' : step === 'mapping' ? `${Object.keys(selectedFields).length} columns mapped` : step === 'review' ? 'Review before writing' : 'Server-owned import status'}</span>
                <div className="flex items-center gap-2">
                    {importKind === 'query' && <button type="button" onClick={() => void openQueryFile()} disabled={!queryFile || Boolean(queryFileError) || openingQuery} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{openingQuery ? 'Opening…' : 'Open query'}</button>}
                    {importKind === 'rows' && <>
                    {recoveryState === 'ready' && step === 'mapping' && <button type="button" onClick={() => { setStep('file'); setError(''); }} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">Back</button>}
                    {recoveryState === 'ready' && step === 'review' && <button type="button" onClick={() => { setStep('mapping'); setError(''); }} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">Back</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'file' && !preview && <button type="button" onClick={() => void previewFile()} disabled={!file || !format || file.size > MAX_FILE_BYTES || Boolean(busy) || (!availableTargets.length && !browserCloudImport)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'preview' ? 'Reading file…' : 'Preview file'}</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'file' && preview && <button type="button" onClick={startMapping} disabled={availableTargets.length === 0 && !browserCloudImport} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">Map columns</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'mapping' && <button type="button" onClick={() => void previewMapping()} disabled={!target || !destinationNames.length || duplicateDestinations || !destinationColumns.length || Boolean(busy)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'mapping' ? 'Checking mapping…' : 'Review import'}</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'review' && <button type="button" onClick={() => void commitImport()} disabled={Boolean(busy)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'commit' ? browserDemoImport ? 'Saving…' : 'Starting…' : creatingTable ? 'Create table and import' : browserDemoImport ? 'Save demo rows' : 'Import rows'}</button>}
                    {recoveryState === 'ready' && step === 'status' && job?.status === 'succeeded' && <button type="button" onClick={() => void closeWizard()} disabled={Boolean(busy)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:opacity-40">Done</button>}
                    </>}
                </div>
            </footer>
        </div>
    </dialog>;
}
