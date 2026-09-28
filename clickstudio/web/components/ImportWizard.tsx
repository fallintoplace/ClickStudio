import { api } from '../api';
import { ImportPreviewTable } from './ImportPreviewTable';
import { displayImportValue, MAX_FILE_BYTES, importSteps } from './import-wizard-model';
import { useImportWizardController, type ImportWizardControllerOptions } from './useImportWizardController';

type ImportWizardProps = ImportWizardControllerOptions;

export function ImportWizard(props: ImportWizardProps) {
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
        confirmation,
        setConfirmation,
        importUnavailable,
        browserDemoImport,
        browserCloudImport,
        availableTargets,
        destinationColumns,
        creatingTable,
        createTableName,
        setCreateTableName,
        createColumns,
        createColumnTypes,
        updateCreateColumn,
        selectedFields,
        destinationNames,
        duplicateDestinations,
        confirmationPhrase,
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
    } = useImportWizardController(props);
    return <dialog
        ref={dialogRef}
        aria-labelledby="import-wizard-title"
        onCancel={event => { event.preventDefault(); if (!busy && job?.status !== 'running') void closeWizard(); }}
        onClick={event => { if (event.target === dialogRef.current && !busy && job?.status !== 'running') void closeWizard(); }}
        className="m-auto max-h-[min(90vh,800px)] w-[min(860px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow)] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
        <div className="flex max-h-[min(90vh,800px)] flex-col">
            <header className="flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-4 sm:px-7">
                <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{browserDemoImport ? 'Interview demo · browser sandbox' : browserCloudImport ? 'ClickHouse Cloud' : 'ClickHouse data'}</span>
                    <h2 id="import-wizard-title" className="mt-1 text-lg font-semibold tracking-tight">Import data</h2>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">{browserDemoImport ? 'Preview, map, and save rows into this browser’s sample dataset.' : browserCloudImport ? 'Preview, map, and import rows with your connected Cloud account.' : 'Preview, map, and review rows before inserting them.'}</p>
                </div>
                <button type="button" aria-label="Close import wizard" disabled={Boolean(busy) || job?.status === 'running'} onClick={() => void closeWizard()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] transition hover:bg-[var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40">Close</button>
            </header>

            <nav aria-label="Import steps" className="grid grid-cols-4 border-b border-[var(--line)] bg-[var(--page)] px-3 py-2 sm:px-7">
                {importSteps.map((item, index) => {
                    const currentIndex = importSteps.findIndex(candidate => candidate.id === step);
                    return <div key={item.id} aria-current={step === item.id ? 'step' : undefined} className={`flex items-center gap-2 px-2 py-1 text-[10px] font-medium sm:text-xs ${step === item.id ? 'text-[var(--accent)]' : currentIndex > index ? 'text-[var(--text-soft)]' : 'text-[var(--muted)]'}`}><span className={`grid size-5 place-items-center rounded-full border text-[9px] ${step === item.id ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : currentIndex > index ? 'border-[var(--line-bright)] bg-[var(--panel-raised)]' : 'border-[var(--line)]'}`}>{index + 1}</span>{item.label}</div>;
                })}
            </nav>

            <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
                {browserDemoImport && <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3 text-xs leading-relaxed text-[var(--text-soft)]"><span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--accent)]"/><span><strong className="text-[var(--text)]">Vercel demo mode.</strong> Your file stays in this browser and is added to <code className="font-mono">demo.interview_imports</code>. Nothing is written to the public ClickHouse Playground.</span></div>}
                {browserCloudImport && <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3 text-xs leading-relaxed text-[var(--text-soft)]"><span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--accent)]"/><span><strong className="text-[var(--text)]">Cloud import.</strong> The connected ClickHouse user needs permission to insert into the selected table. Creating a table also needs CREATE TABLE permission.</span></div>}
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
                            <div><span className="text-xs font-semibold">{preview.name}</span><p className="mt-1 text-[11px] text-[var(--muted)]">{preview.rowCount.toLocaleString()} rows · {preview.columns.length} columns · {preview.format.toUpperCase()}</p></div>
                            <button type="button" onClick={() => { if (!browserCloudImport) void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined); setPreview(undefined); setMapping(undefined); setStep('file'); setError(''); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-[11px] text-[var(--text-soft)] hover:bg-[var(--panel-hover)]">Choose another file</button>
                        </div>
                        <ImportPreviewTable preview={preview} columns={sampleColumns}/>
                    </>}
                    {preview && availableTargets.length === 0 && !browserCloudImport && <div role="status" className="rounded-lg border border-[var(--line)] p-3 text-xs text-[var(--muted)]">No configured import destination is available for this connection.</div>}
                </section>}

                {recoveryState === 'ready' && !importUnavailable && step === 'mapping' && preview && <section aria-label="Map source columns" className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                        <label className="grid gap-1.5 text-xs font-medium text-[var(--text-soft)]">Destination table
                            <select aria-label="Import target table" value={target} onChange={event => changeTarget(event.target.value)} className="min-h-10 rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 text-xs text-[var(--text)]">
                                {browserCloudImport && <option value="__create_table_from_file__">Create table from file…</option>}
                                {availableTargets.map(table => <option key={table} value={table}>{table}</option>)}
                            </select>
                        </label>
                        <div className="rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 py-2 text-[11px] text-[var(--muted)]"><strong className="text-[var(--text-soft)]">{preview.rowCount.toLocaleString()} rows</strong> from {preview.name}. {browserDemoImport ? 'The sample schema is checked in this browser.' : browserCloudImport ? 'The import uses the connected Cloud user permissions.' : 'Values are sent as parsed; ClickHouse checks destination types.'}</div>
                    </div>
                    {creatingTable && <div className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4">
                        <label className="grid max-w-sm gap-1.5 text-xs font-medium text-[var(--text-soft)]">New table name
                            <input aria-label="New table name" value={createTableName} onChange={event => setCreateTableName(event.target.value)} maxLength={128} className="min-h-10 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 font-mono text-xs text-[var(--text)]" />
                        </label>
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
                    <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
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

                {recoveryState === 'ready' && !importUnavailable && step === 'review' && mapping && preview && <section aria-label="Review import" className="space-y-4">
                    <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 sm:p-5">
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{browserDemoImport ? 'Ready to save in browser demo' : 'Ready to insert'}</span>
                        <h3 className="mt-1 text-base font-semibold">{mapping.rowCount.toLocaleString()} rows into <code className="rounded bg-[var(--page)] px-1.5 py-1 font-mono text-sm">{mapping.table}</code></h3>
                        <p className="mt-2 text-xs leading-relaxed text-[var(--text-soft)]">{browserDemoImport ? 'This adds rows to the Vercel interview sandbox in this browser. It does not write to ClickHouse.' : browserCloudImport ? creatingTable ? 'This creates a MergeTree table in the connected database, then inserts the file rows.' : 'This writes to the selected Cloud table. ClickHouse checks your account permissions and destination types.' : 'This writes data to the selected ClickHouse table. The mapping and destination schema were checked by the server.'}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4">
                        <h4 className="text-xs font-semibold">Column mapping</h4>
                        <div className="mt-3 flex flex-wrap gap-2">{Object.entries(mapping.fields).map(([source, destination]) => <span key={source} className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-[10px]"><span className="text-[var(--text-soft)]">{source}</span><span className="mx-1.5 text-[var(--muted)]">→</span><span className="font-medium">{destination}</span></span>)}</div>
                    </div>
                    {!browserDemoImport && <label className="grid gap-1.5 text-xs font-medium text-[var(--text-soft)]">Type <code className="font-mono text-[var(--accent)]">{confirmationPhrase}</code> to confirm
                        <input aria-label={`Type ${confirmationPhrase} to confirm`} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} className="min-h-10 rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 font-mono text-xs text-[var(--text)] placeholder:text-[var(--muted)]" placeholder={confirmationPhrase}/>
                    </label>}
                </section>}

                {recoveryState === 'ready' && !importUnavailable && step === 'status' && <section aria-label="Import status" className="space-y-4">
                    <div className={`rounded-xl border p-5 ${job?.status === 'succeeded' ? 'border-[var(--green)]/30 bg-[var(--green)]/5' : job?.status === 'unknown' ? 'border-[var(--amber)]/35 bg-[var(--amber)]/5' : 'border-[var(--line)] bg-[var(--page)]'}`}>
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{job?.status === 'succeeded' ? 'Import complete' : job?.status === 'unknown' ? 'Import needs review' : 'Import running'}</span>
                        <h3 role="status" className="mt-1 text-base font-semibold">{job?.status === 'succeeded' ? browserDemoImport ? `Saved ${(job.rows ?? pendingImport?.rows ?? 0).toLocaleString()} rows to ${job.table ?? pendingImport?.table}` : `Inserted ${(job.rows ?? pendingImport?.rows ?? 0).toLocaleString()} rows into ${job.table ?? pendingImport?.table}` : job?.status === 'unknown' ? 'The insert outcome is not confirmed.' : `${browserDemoImport ? 'Saving' : 'Inserting'} ${(job?.rows ?? pendingImport?.rows ?? 0).toLocaleString()} rows…`}</h3>
                        {job?.status === 'unknown' ? <p className="mt-2 text-xs leading-relaxed text-[var(--text-soft)]">{job.error ?? 'The insert may have partially completed. Check ClickHouse status, then inspect the destination before starting another write.'} To clear the write block, inspect the destination and confirm no insert is still active. This does not mark the import successful or retry it.</p> : job?.status === 'running' ? <p className="mt-2 text-xs text-[var(--muted)]">{job.reconciliationRequired ? 'ClickHouse still reports this insert as active. Status checks will continue.' : 'Keep this panel open while the server finishes. Imports cannot be cancelled once started.'} A second write to this table is blocked until this import is resolved.</p> : job?.status === 'succeeded' ? <p className="mt-2 text-xs text-[var(--text-soft)]">{browserDemoImport ? job.demoPersisted ? 'Rows are saved in this browser and are ready to inspect in the sample workspace.' : 'Rows are available in this tab. Browser storage was unavailable, so they will not survive a refresh.' : 'The schema has been refreshed for this connection.'}</p> : <p className="mt-2 text-xs text-[var(--muted)]">Checking the saved import job…</p>}
                    </div>
                    {browserDemoImport && job?.status === 'succeeded' && job.demoRows?.length ? <div className="overflow-hidden rounded-xl border border-[var(--line)]"><div className="flex items-center justify-between gap-3 bg-[var(--page)] px-4 py-3"><strong className="text-xs">Imported rows</strong><span className="text-[10px] text-[var(--muted)]">{job.demoRows.length} row preview</span></div><div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse text-left text-xs"><thead className="bg-[var(--page)] text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr>{Object.keys(job.demoRows[0]!).map(column => <th key={column} className="px-3 py-2">{column}</th>)}</tr></thead><tbody>{job.demoRows.map((row, index) => <tr key={`${job.id}-${index}`} className="border-t border-[var(--line)]">{Object.keys(job.demoRows![0]!).map(column => <td key={column} className="px-3 py-2 text-[var(--text-soft)]">{displayImportValue(row[column])}</td>)}</tr>)}</tbody></table></div><p className="border-t border-[var(--line)] px-4 py-3 text-[11px] text-[var(--muted)]">To query them, switch to <strong className="text-[var(--text-soft)]">Sample data</strong> and run <code className="font-mono text-[var(--accent)]">SELECT * FROM demo.interview_imports</code>.</p></div> : null}
                    {recoverableJobs.length > 1 && <p className="text-xs text-[var(--muted)]">{recoverableJobs.length - 1} more import{recoverableJobs.length === 2 ? '' : 's'} need attention. They will be shown after this one.</p>}
                    {job?.status === 'unknown' && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void reconcileJob()} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'reconcile' ? 'Checking ClickHouse…' : 'Check ClickHouse status'}</button><button type="button" onClick={() => void reviewUnknownImport()} disabled={Boolean(busy)} className="rounded-lg border border-[var(--amber)]/40 px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">{busy === 'review' ? 'Recording review…' : 'I inspected the destination; no insert is active'}</button></div>}
                </section>}

                {error && recoveryState !== 'failed' && <p role="alert" className="mt-4 rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs leading-relaxed text-[var(--red)]">{error}</p>}
            </main>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--page)] px-5 py-3 sm:px-7">
                <span className="text-[10px] text-[var(--muted)]">{browserDemoImport ? 'Browser demo · nothing is written to ClickHouse' : browserCloudImport ? 'Up to 2 MB · maximum 10,000 rows · ClickHouse Cloud permissions apply' : step === 'file' ? 'Up to 2 MB · maximum 10,000 rows' : step === 'mapping' ? `${Object.keys(selectedFields).length} columns mapped` : step === 'review' ? 'Review before writing' : 'Server-owned import status'}</span>
                <div className="flex items-center gap-2">
                    {recoveryState === 'ready' && step === 'mapping' && <button type="button" onClick={() => { setStep('file'); setError(''); }} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">Back</button>}
                    {recoveryState === 'ready' && step === 'review' && <button type="button" onClick={() => { setStep('mapping'); setError(''); }} disabled={Boolean(busy)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:opacity-50">Back</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'file' && !preview && <button type="button" onClick={() => void previewFile()} disabled={!file || !format || file.size > MAX_FILE_BYTES || Boolean(busy) || availableTargets.length === 0} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'preview' ? 'Reading file…' : 'Preview file'}</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'file' && preview && <button type="button" onClick={startMapping} disabled={availableTargets.length === 0 && !browserCloudImport} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">Map columns</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'mapping' && <button type="button" onClick={() => void previewMapping()} disabled={!target || !destinationNames.length || duplicateDestinations || !destinationColumns.length || Boolean(busy)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'mapping' ? 'Checking mapping…' : 'Review import'}</button>}
                    {recoveryState === 'ready' && !importUnavailable && step === 'review' && <button type="button" onClick={() => void commitImport()} disabled={confirmation !== confirmationPhrase || Boolean(busy)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'commit' ? browserDemoImport ? 'Saving…' : 'Starting…' : browserDemoImport ? 'Save demo rows' : 'Import rows'}</button>}
                    {recoveryState === 'ready' && step === 'status' && job?.status !== 'running' && <button type="button" onClick={() => void closeWizard()} disabled={Boolean(busy)} className="rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] transition hover:brightness-105 disabled:opacity-40">Done</button>}
                </div>
            </footer>
        </div>
    </dialog>;
}
