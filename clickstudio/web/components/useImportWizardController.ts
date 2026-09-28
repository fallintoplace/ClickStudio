import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Json, Schema } from '../../shared/types';
import { useImportJobPolling } from './useImportJobPolling';
import { api, isFrontendDemoPreview, message, post, RequestError } from '../api';
import { checkClickHouseCloudImport, CLICKHOUSE_CLOUD_CONNECTION_ID, CloudRequestError, getClickHouseCloudConnection, importClickHouseCloudFile, loadClickHouseCloudSchema } from '../cloud-connection';
import { CREATE_TABLE_COLUMN_TYPES } from '../../shared/table-creation';
import { DEMO_IMPORT_SAMPLE_CSV, parseImportFile } from '../demo-import-data';
import { CREATE_CLOUD_TABLE_TARGET, cloudImportTargets, inferCloudImportColumns, suggestCloudTableName, type CloudImportColumn } from '../cloud-import';
import {
    MAX_FILE_BYTES,
    fileFormat,
    importStateKey,
    initialFields,
    isPendingImport,
    loadImportSetup,
    writableColumns,
    type BusyAction,
    type ImportFormat,
    type ImportJob,
    type ImportMapping,
    type ImportPreview,
    type PendingImport,
    type Step,
} from './import-wizard-model';

async function loadConnectionImportSetup(connectionId: string, cloudImport: boolean, signal?: AbortSignal): Promise<[string[], Schema]> {
    if (cloudImport) {
        const nextSchema = await loadClickHouseCloudSchema();
        return [cloudImportTargets(nextSchema), nextSchema];
    }
    return await loadImportSetup(connectionId, signal);
}

type ImportActionSetters = {
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    setStep: Dispatch<SetStateAction<Step>>;
    setBusy: Dispatch<SetStateAction<BusyAction>>;
    setError: Dispatch<SetStateAction<string>>;
    setMapping: Dispatch<SetStateAction<ImportMapping | undefined>>;
    setTargets: Dispatch<SetStateAction<string[]>>;
    setSchema: Dispatch<SetStateAction<Schema | undefined>>;
    setTarget: Dispatch<SetStateAction<string>>;
    setFields: Dispatch<SetStateAction<Record<string, string>>>;
    setRecoveryState: Dispatch<SetStateAction<'checking' | 'ready' | 'failed'>>;
    setRecoverableJobs: Dispatch<SetStateAction<ImportJob[]>>;
    setPendingImport: Dispatch<SetStateAction<PendingImport | undefined>>;
    setImportUnavailable: Dispatch<SetStateAction<string>>;
};

async function runCommitImport(context: ImportActionSetters & {
    mapping?: ImportMapping;
    busy: BusyAction;
    browserDemoImport: boolean;
    browserCloudImport: boolean;
    file?: File;
    format?: ImportFormat;
    creatingTable: boolean;
    schema?: Schema;
    createTableDatabase: string;
    createTableName: string;
    createColumns: CloudImportColumn[];
    generateId: boolean;
    importConnectionId: string;
    preview?: ImportPreview;
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
    rememberJob: (job: ImportJob) => void;
}) {
    const { mapping, busy, browserDemoImport, browserCloudImport, file, format, creatingTable, schema, createTableDatabase, createTableName, createColumns, generateId, importConnectionId, preview,
        setJob, setStep, setBusy, setError, setMapping, setTargets, setSchema, setTarget, setFields, setRecoveryState, setRecoverableJobs, setPendingImport, savePendingImport, clearPendingImport, rememberJob } = context;
    if (!mapping || busy) return;
    const queryId = browserCloudImport ? `clickstudio-import-${mapping.id}` : undefined;
    const record: PendingImport = { id: mapping.id, table: mapping.table, rows: mapping.rowCount, name: preview?.name ?? 'Selected file', ...(queryId ? { queryId } : {}) };
    savePendingImport(record);
    setJob({ id: mapping.id, table: mapping.table, rows: mapping.rowCount, status: 'running', ...(queryId ? { queryId } : {}) });
    setStep('status');
    setBusy('commit');
    setError('');
    try {
        let next: ImportJob;
        if (browserCloudImport) {
            if (!file || !format || !queryId) throw new Error('Choose the file again before starting this import.');
            const expectedColumns = creatingTable ? undefined : schema?.columns
                .filter(column => `${column.database}.${column.table}` === mapping.table)
                .map(({ name, type, defaultKind }) => ({ name, type, defaultKind }));
            next = await importClickHouseCloudFile({
                file,
                format,
                target: mapping.table,
                fields: mapping.fields,
                queryId,
                ...(expectedColumns ? { expectedColumns } : {}),
                ...(creatingTable ? { createTable: { database: createTableDatabase, name: createTableName, columns: createColumns, generateId } } : {}),
            });
        } else {
            next = await post<ImportJob>(`/imports/${encodeURIComponent(mapping.id)}/commit`);
        }
        rememberJob(next);
    } catch (caught) {
        if (browserCloudImport && queryId) {
            if (caught instanceof CloudRequestError && caught.status < 500) {
                setJob(undefined);
                clearPendingImport();
                setStep('review');
                if (caught.code === 'SCHEMA_CHANGED') {
                    setMapping(undefined);
                    setStep('mapping');
                    try {
                        const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, true);
                        setTargets(nextTargets);
                        setSchema(nextSchema);
                        setTarget(nextTargets.includes(mapping.table) ? mapping.table : nextTargets[0] ?? CREATE_CLOUD_TABLE_TARGET);
                        setFields(initialFields(preview?.columns ?? [], writableColumns(nextSchema, mapping.table)));
                        setError('The destination schema changed. Review the updated mapping before importing.');
                    } catch (refreshError) { setError(`The destination schema changed. Refresh failed: ${message(refreshError)}`); }
                } else setError(message(caught));
                return;
            }
            try {
                const status = await checkClickHouseCloudImport(queryId, mapping.table, mapping.rowCount);
                rememberJob(status);
            } catch {
                rememberJob({ id: mapping.id, connectionId: importConnectionId, table: mapping.table, rows: mapping.rowCount, queryId, status: 'unknown', error: 'ClickHouse could not confirm the import. The rows may already be there.' });
            }
            return;
        }
        if (browserDemoImport) {
            setJob(undefined);
            clearPendingImport();
            setStep('review');
            setError(message(caught));
            return;
        }
        if (caught instanceof RequestError && caught.detail.code === 'SCHEMA_CHANGED') {
            setJob(undefined);
            clearPendingImport();
            setMapping(undefined);
            setStep('mapping');
            try {
                const [nextTargets, nextSchema] = await Promise.all([
                    api<string[]>(`/connections/${encodeURIComponent(importConnectionId)}/import-targets`),
                    api<Schema>(`/connections/${encodeURIComponent(importConnectionId)}/schema`),
                ]);
                setTargets(nextTargets);
                setSchema(nextSchema);
                const nextTarget = nextTargets.find(table => table === mapping.table && nextSchema.tables.some(item => `${item.database}.${item.name}` === table))
                    ?? nextTargets.find(table => nextSchema.tables.some(item => `${item.database}.${item.name}` === table))
                    ?? '';
                setTarget(nextTarget);
                setFields(initialFields(preview?.columns ?? [], writableColumns(nextSchema, nextTarget)));
                setError('The destination schema changed. Review the updated mapping before importing.');
            } catch (refreshError) {
                setError(`The destination schema changed. Refresh failed: ${message(refreshError)}`);
            }
            return;
        }
        if (caught instanceof RequestError && caught.detail.code === 'IMPORT_UNRESOLVED') {
            setBusy('recover');
            try {
                const jobs = await api<ImportJob[]>(`/imports?connectionId=${encodeURIComponent(importConnectionId)}&recoverable=true`);
                setRecoverableJobs(jobs);
                const unresolved = jobs[0];
                if (unresolved) {
                    const pending = { id: unresolved.id, table: unresolved.table, rows: unresolved.rows, name: 'Previous import' };
                    setJob(unresolved);
                    setPendingImport(pending);
                    setStep('status');
                    try { localStorage.setItem(importStateKey(importConnectionId), JSON.stringify(pending)); } catch { }
                } else {
                    setStep('review');
                    setError(message(caught));
                }
            } catch (recoveryError) {
                setRecoveryState('failed');
                setError(`Could not check for unresolved imports: ${message(recoveryError)}`);
            }
            return;
        }
        if (caught instanceof RequestError && caught.status < 500) {
            setJob(undefined);
            clearPendingImport();
            setStep('review');
            setError(message(caught));
            return;
        }
        setError('The response was interrupted. Checking the saved import status…');
        try {
            const next = await api<ImportJob>(`/imports/${encodeURIComponent(mapping.id)}`);
            rememberJob(next);
        } catch {
            rememberJob({ id: mapping.id, table: mapping.table, rows: mapping.rowCount, status: 'unknown', reconciliationRequired: true, error: 'The server could not confirm this insert. Check for the saved import job before starting another write.' });
        }
    } finally { setBusy(''); }
}

async function runReviewUnknownImport(context: ImportActionSetters & {
    job?: ImportJob;
    busy: BusyAction;
    browserCloudImport: boolean;
    importConnectionId: string;
    recoverableJobs: ImportJob[];
    clearPendingImport: () => void;
    rememberJob: (job: ImportJob) => void;
}) {
    const { job, busy, browserCloudImport, importConnectionId, recoverableJobs, clearPendingImport, rememberJob,
        setJob, setStep, setBusy, setError, setTargets, setSchema, setTarget, setRecoverableJobs, setPendingImport, setImportUnavailable } = context;
    if (!job || job.status !== 'unknown' || busy) return;
    setBusy('review');
    setError('');
    try {
        if (browserCloudImport && job.queryId) {
            const status = await checkClickHouseCloudImport(job.queryId, job.table, job.rows);
            if (status.status !== 'unknown') {
                rememberJob(status);
                return;
            }
            rememberJob({ ...status, reviewedAt: new Date().toISOString() });
            clearPendingImport();
            setRecoverableJobs([]);
            setJob(undefined);
            setStep('file');
            setBusy('setup');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, true);
                setTargets(nextTargets);
                setSchema(nextSchema);
                setTarget(nextTargets.includes(job.table) ? job.table : nextTargets[0] ?? CREATE_CLOUD_TABLE_TARGET);
                setError('');
            } catch (caught) { setError(message(caught)); }
            finally { setBusy(''); }
            return;
        }
        const next = await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/review`, { inspected: true, noActiveInsert: true });
        if (!next.reviewedAt) {
            rememberJob(next);
            return;
        }
        const remaining = recoverableJobs.filter(item => item.id !== next.id);
        setRecoverableJobs(remaining);
        clearPendingImport();
        setError('');
        if (remaining.length) {
            const following = remaining[0]!;
            setJob(following);
            setPendingImport({ id: following.id, table: following.table, rows: following.rows, name: 'Previous import' });
            try { localStorage.setItem(importStateKey(importConnectionId), JSON.stringify({ id: following.id, table: following.table, rows: following.rows, name: 'Previous import' })); } catch { }
        } else {
            setJob(undefined);
            setStep('file');
            setBusy('setup');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, false);
                setTargets(nextTargets);
                setSchema(nextSchema);
                const first = nextTargets.includes(job.table) && nextSchema.tables.some(item => `${item.database}.${item.name}` === job.table)
                    ? job.table
                    : nextTargets.find(table => nextSchema.tables.some(item => `${item.database}.${item.name}` === table)) ?? '';
                setTarget(first);
                setImportUnavailable(first ? '' : 'No import targets are configured for this connection. Ask the workspace owner to allow a destination table.');
            } catch (caught) { setError(message(caught)); }
            finally { setBusy(''); }
        }
    } catch (caught) { setError(`Could not record the import review: ${message(caught)}`); }
    finally { setBusy(''); }
}

export type ImportWizardControllerOptions = {
    open: boolean;
    connectionId: string;
    trusted: boolean;
    demoMode: boolean;
    onClose: () => void;
    onImported: (job: ImportJob) => void;
    onTableNeedsInspection: (job: ImportJob) => void;
};

function importUnavailableReason(connectionId: string) {
    if (connectionId === 'playground') return 'File imports are disabled on the public read-only ClickHouse Playground connection.';
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) return 'File import is not available for this Cloud connection yet. Use SQL to create tables and insert data.';
    return 'File imports are disabled in sample data. This workspace never writes to a database.';
}

type ImportWizardFileActionContext = {
    browserDemoImport: boolean;
    browserCloudImport: boolean;
    target: string;
    file?: File;
    format?: ImportFormat;
    busy: BusyAction;
    setFile: Dispatch<SetStateAction<File | undefined>>;
    setFormat: Dispatch<SetStateAction<ImportFormat | undefined>>;
    setPreview: Dispatch<SetStateAction<ImportPreview | undefined>>;
    setMapping: Dispatch<SetStateAction<ImportMapping | undefined>>;
    setCloudRows: Dispatch<SetStateAction<Record<string, Json>[]>>;
    setCreateColumns: Dispatch<SetStateAction<CloudImportColumn[]>>;
    setCreateTableName: Dispatch<SetStateAction<string>>;
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    setError: Dispatch<SetStateAction<string>>;
    setGenerateId: Dispatch<SetStateAction<boolean>>;
    setStep: Dispatch<SetStateAction<Step>>;
    setBusy: Dispatch<SetStateAction<BusyAction>>;
};

function createImportWizardFileActions(context: ImportWizardFileActionContext) {
    const { browserDemoImport, browserCloudImport, target, file, format, busy,
        setFile, setFormat, setPreview, setMapping, setCloudRows, setCreateColumns, setCreateTableName,
        setJob, setError, setGenerateId, setStep, setBusy } = context;

    function chooseFile(next?: File) {
        setFile(next);
        setPreview(undefined);
        setMapping(undefined);
        setCloudRows([]);
        setCreateColumns([]);
        if (browserCloudImport && target === CREATE_CLOUD_TABLE_TARGET) setCreateTableName('');
        setJob(undefined);
        setError('');
        setGenerateId(true);
        if (!next) { setFormat(undefined); return; }
        const nextFormat = fileFormat(next);
        setFormat(nextFormat);
        if (!nextFormat) setError('Choose a .csv, .json, .ndjson, or .jsonl file.');
        else if (next.size > MAX_FILE_BYTES) setError('This file is larger than the 2 MB import limit.');
    }

    async function previewSelectedFile(nextFile: File, nextFormat: ImportFormat) {
        if (nextFile.size > MAX_FILE_BYTES || busy) return;
        setBusy('preview');
        setError('');
        try {
            const source = await nextFile.text();
            let next: ImportPreview;
            if (browserCloudImport) {
                const parsed = parseImportFile(source, nextFormat);
                if (!parsed.rows.length) throw new Error('The input contains no data rows.');
                setCloudRows(parsed.rows);
                next = { id: crypto.randomUUID(), name: nextFile.name.slice(0, 128), format: nextFormat, columns: parsed.columns, rows: parsed.rows.slice(0, 20), rowCount: parsed.rows.length };
            } else {
                setCloudRows([]);
                next = await post<ImportPreview>('/imports/preview', { name: nextFile.name, source, format: nextFormat });
            }
            setPreview(next);
            setStep('file');
            setError('');
        } catch (caught) {
            setError(message(caught));
        } finally { setBusy(''); }
    }

    async function previewFile() {
        if (!file || !format || file.size > MAX_FILE_BYTES || busy) return;
        await previewSelectedFile(file, format);
    }

    async function previewSampleFile() {
        if (!browserDemoImport || busy) return;
        const sample = new File([DEMO_IMPORT_SAMPLE_CSV], 'interview-marketing-snapshot.csv', { type: 'text/csv' });
        setFile(sample);
        setFormat('csv');
        setError('');
        await previewSelectedFile(sample, 'csv');
    }

    return { chooseFile, previewFile, previewSampleFile };
}

type ConfirmUnknownImportContext = Pick<ImportActionSetters, 'setBusy' | 'setError'> & {
    job?: ImportJob;
    busy: BusyAction;
    browserCloudImport: boolean;
    rememberJob: (job: ImportJob) => void;
    clearPendingImport: () => void;
};

async function runConfirmUnknownImport(context: ConfirmUnknownImportContext) {
    const { job, busy, browserCloudImport, rememberJob, clearPendingImport, setBusy, setError } = context;
    if (!job || job.status !== 'unknown' || busy) return;
    setBusy('review');
    setError('');
    try {
        let checked = job;
        if (!browserCloudImport) {
            checked = job.reviewedAt
                ? await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/reconcile`)
                : await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/review`, { inspected: true, noActiveInsert: true });
            if (checked.status !== 'unknown') {
                rememberJob(checked);
                return;
            }
            if (!checked.reviewedAt) {
                rememberJob(checked);
                return;
            }
        }
        clearPendingImport();
        rememberJob({ ...checked, status: 'succeeded', error: undefined, reviewedAt: checked.reviewedAt ?? new Date().toISOString() });
    } catch (caught) {
        setError(`Could not confirm the imported rows: ${message(caught)}`);
    } finally { setBusy(''); }
}

type RetryUnknownImportContext = ImportActionSetters & {
    job?: ImportJob;
    busy: BusyAction;
    preview?: ImportPreview;
    mapping?: ImportMapping;
    browserCloudImport: boolean;
    file?: File;
    format?: ImportFormat;
    reviewUnknownImport: () => Promise<void>;
    schema?: Schema;
    target: string;
    creatingTable: boolean;
    cloudRows: Record<string, Json>[];
    createTableDatabase: string;
    createTableName: string;
    createColumns: CloudImportColumn[];
    generateId: boolean;
    setCreateTableName: Dispatch<SetStateAction<string>>;
    setCreateTableDatabase: Dispatch<SetStateAction<string>>;
    setCreateColumns: Dispatch<SetStateAction<CloudImportColumn[]>>;
    importConnectionId: string;
    browserDemoImport: boolean;
    setRetryAttemptedFor: Dispatch<SetStateAction<string | undefined>>;
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
    rememberJob: (job: ImportJob) => void;
};

async function runRetryUnknownImport(context: RetryUnknownImportContext) {
    const { job, busy, preview, mapping, browserCloudImport, file, format, reviewUnknownImport, schema, target, creatingTable,
        cloudRows, createTableDatabase, createTableName, createColumns, generateId, setCreateTableName, setCreateColumns, setCreateTableDatabase, importConnectionId,
        browserDemoImport, setRetryAttemptedFor,
        savePendingImport, clearPendingImport, rememberJob,
        setJob, setStep, setBusy, setError, setMapping, setTargets, setSchema, setTarget, setFields, setRecoveryState,
        setRecoverableJobs, setPendingImport, setImportUnavailable } = context;
    if (!job || job.status !== 'unknown' || busy) return;
    if (!preview || !mapping || (browserCloudImport && (!file || !format))) {
        await reviewUnknownImport();
        return;
    }
    setBusy('review');
    setError('');
    try {
        let checked: ImportJob;
        if (browserCloudImport) {
            if (!job.queryId) throw new Error('This Cloud import has no status id. Choose the file again before retrying.');
            checked = await checkClickHouseCloudImport(job.queryId, job.table, job.rows);
        } else {
            checked = await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/reconcile`);
        }
        if (checked.status !== 'unknown') {
            rememberJob(checked);
            return;
        }
        if (!browserCloudImport && !checked.reviewedAt) {
            checked = await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/review`, { inspected: true, noActiveInsert: true });
            if (checked.status !== 'unknown') {
                rememberJob(checked);
                return;
            }
            if (!checked.reviewedAt) {
                rememberJob(checked);
                return;
            }
        }

        let retrySchema = schema;
        let retryTarget = target;
        let retryCreatingTable = creatingTable;
        let retryCreateTableDatabase = createTableDatabase;
        let retryCreateTableName = createTableName;
        let retryMapping: ImportMapping;
        if (browserCloudImport) {
            retrySchema = await loadClickHouseCloudSchema();
            const tableExists = retrySchema.tables.some(table => `${table.database}.${table.name}` === job.table);
            if (retryCreatingTable && tableExists) {
                retryCreatingTable = false;
                retryTarget = job.table;
                const writableNames = new Set(writableColumns(retrySchema, job.table).map(column => column.name));
                if (Object.values(mapping.fields).some(column => !writableNames.has(column))) {
                    setSchema(retrySchema);
                    setTarget(job.table);
                    setFields(initialFields(preview.columns, writableColumns(retrySchema, job.table)));
                    setMapping(undefined);
                    setJob(checked);
                    setStep('mapping');
                    setError('The table is already there. Check the column mapping before retrying.');
                    return;
                }
            } else if (!retryCreatingTable && !tableExists) {
                setSchema(retrySchema);
                setTarget(CREATE_CLOUD_TABLE_TARGET);
                const columns = inferCloudImportColumns(cloudRows.length ? cloudRows : preview.rows, preview.columns);
                setCreateColumns(columns);
                retryCreateTableDatabase = job.table.split('.')[0] || getClickHouseCloudConnection()?.database || 'default';
                retryCreateTableName = job.table.split('.').at(-1) || createTableName;
                setCreateTableDatabase(retryCreateTableDatabase);
                setCreateTableName(retryCreateTableName);
                setFields(Object.fromEntries(columns.map(column => [column.source, column.name])));
                setMapping(undefined);
                setJob(checked);
                setStep('mapping');
                setError('The destination table is not available now. Choose a table before retrying.');
                return;
            } else {
                retryTarget = retryCreatingTable ? CREATE_CLOUD_TABLE_TARGET : job.table;
                if (retryCreatingTable) {
                    retryCreateTableDatabase = job.table.split('.')[0] || getClickHouseCloudConnection()?.database || 'default';
                    retryCreateTableName = job.table.split('.').at(-1) || createTableName;
                    setCreateTableDatabase(retryCreateTableDatabase);
                    setCreateTableName(retryCreateTableName);
                }
            }
            retryMapping = { ...mapping, id: crypto.randomUUID(), table: job.table };
            setSchema(retrySchema);
            setTarget(retryTarget);
        } else {
            retryMapping = await post<ImportMapping>(`/imports/${encodeURIComponent(preview.id)}/mapping`, {
                connectionId: importConnectionId,
                table: mapping.table,
                fields: mapping.fields,
            });
        }

        setRetryAttemptedFor(retryMapping.id);
        setMapping(retryMapping);
        setFields(retryMapping.fields);
        setJob(checked);
        setRecoverableJobs(current => current.filter(item => item.id !== job.id));
        clearPendingImport();
        await runCommitImport({
            mapping: retryMapping, busy: '',
            browserDemoImport, browserCloudImport, file, format, creatingTable: retryCreatingTable, schema: retrySchema,
            createTableDatabase: retryCreateTableDatabase, createTableName: retryCreateTableName, createColumns, generateId, importConnectionId, preview,
            setJob, setStep, setBusy, setError, setMapping, setTargets, setSchema, setTarget, setFields,
            setRecoveryState, setRecoverableJobs, setPendingImport, setImportUnavailable,
            savePendingImport, clearPendingImport, rememberJob,
        });
    } catch (caught) {
        setJob(job);
        setError(`Could not prepare the retry: ${message(caught)}`);
    } finally { setBusy(''); }
}

export function useImportWizardController({ open, connectionId, trusted, demoMode, onClose, onImported, onTableNeedsInspection }: ImportWizardControllerOptions) {
    const browserDemoImport = demoMode && isFrontendDemoPreview && connectionId === 'demo';
    const browserCloudImport = demoMode && isFrontendDemoPreview && connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const importConnectionId = browserDemoImport ? 'demo' : connectionId;
    const dialogRef = useRef<HTMLDialogElement>(null);
    const onImportedRef = useRef(onImported);
    const onTableNeedsInspectionRef = useRef(onTableNeedsInspection);
    const reportedJobRef = useRef<string | undefined>(undefined);
    const reportedInspectionRef = useRef<string | undefined>(undefined);
    onImportedRef.current = onImported;
    onTableNeedsInspectionRef.current = onTableNeedsInspection;

    const [step, setStep] = useState<Step>('file');
    const [file, setFile] = useState<File>();
    const [format, setFormat] = useState<ImportFormat>();
    const [preview, setPreview] = useState<ImportPreview>();
    const [cloudRows, setCloudRows] = useState<Record<string, Json>[]>([]);
    const [schema, setSchema] = useState<Schema>();
    const [targets, setTargets] = useState<string[]>([]);
    const [target, setTarget] = useState('');
    const [lastExistingTarget, setLastExistingTarget] = useState('');
    const [createTableDatabase, setCreateTableDatabase] = useState(() => getClickHouseCloudConnection()?.database ?? '');
    const [createTableName, setCreateTableName] = useState('');
    const [createColumns, setCreateColumns] = useState<CloudImportColumn[]>([]);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [mapping, setMapping] = useState<ImportMapping>();
    const [job, setJob] = useState<ImportJob>();
    const [recoverableJobs, setRecoverableJobs] = useState<ImportJob[]>([]);
    const [pendingImport, setPendingImport] = useState<PendingImport>();
    const [recoveryState, setRecoveryState] = useState<'checking' | 'ready' | 'failed'>('checking');
    const [recoveryAttempt, setRecoveryAttempt] = useState(0);
    const [busy, setBusy] = useState<BusyAction>('');
    const [error, setError] = useState('');
    const [retryAttemptedFor, setRetryAttemptedFor] = useState<string>();
    const [generateId, setGenerateId] = useState(true);
    const [importUnavailable, setImportUnavailable] = useState('');

    const availableTargets = useMemo(() => targets.filter(table => schema?.tables.some(item => `${item.database}.${item.name}` === table)), [schema, targets]);
    const creatingTable = browserCloudImport && target === CREATE_CLOUD_TABLE_TARGET;
    const destinationColumns = useMemo(() => creatingTable
        ? createColumns.map(column => ({ database: createTableDatabase, table: createTableName, name: column.name, type: column.type, defaultKind: '', comment: '' }))
        : writableColumns(schema, target), [creatingTable, createColumns, createTableDatabase, createTableName, schema, target]);
    const selectedFields = useMemo(() => Object.fromEntries(Object.entries(fields).filter(([, destination]) => Boolean(destination))), [fields]);
    const destinationNames = Object.values(selectedFields);
    const duplicateDestinations = new Set(destinationNames).size !== destinationNames.length;
    const sampleColumns = preview?.columns.slice(0, 6) ?? [];
    const { chooseFile, previewFile, previewSampleFile } = createImportWizardFileActions({
        browserDemoImport, browserCloudImport, target, file, format, busy,
        setFile, setFormat, setPreview, setMapping, setCloudRows, setCreateColumns, setCreateTableName,
        setJob, setError, setGenerateId, setStep, setBusy,
    });

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    useEffect(() => {
        if (!open) return;
        let current = true;
        const controller = new AbortController();
        setStep('file');
        setFile(undefined);
        setFormat(undefined);
        setPreview(undefined);
        setCloudRows([]);
        setSchema(undefined);
        setTargets([]);
        setTarget('');
        setLastExistingTarget('');
        setCreateTableName('');
        setCreateTableDatabase(getClickHouseCloudConnection()?.database ?? '');
        setCreateColumns([]);
        setFields({});
        setMapping(undefined);
        setJob(undefined);
        setRecoverableJobs([]);
        setPendingImport(undefined);
        setBusy('');
        setError('');
        setRetryAttemptedFor(undefined);
        setGenerateId(true);
        setImportUnavailable('');
        setRecoveryState('checking');
        reportedJobRef.current = undefined;

        if (demoMode && !browserDemoImport && !browserCloudImport) {
            setRecoveryState('ready');
            setImportUnavailable(importUnavailableReason(connectionId));
            return () => { current = false; controller.abort(); };
        }
        if (!trusted) {
            setRecoveryState('ready');
            setImportUnavailable('Trust this connection before importing data.');
            return () => { current = false; controller.abort(); };
        }

        const key = importStateKey(importConnectionId);
        let stored: PendingImport | undefined;
        try {
            const value = localStorage.getItem(key);
            if (value) {
                const parsed: unknown = JSON.parse(value);
                if (isPendingImport(parsed)) stored = parsed;
            }
        } catch { }

        if (browserCloudImport) {
            setBusy('recover');
            void (async () => {
                try {
                    if (stored?.queryId) {
                        const recovered = await checkClickHouseCloudImport(stored.queryId, stored.table, stored.rows);
                        if (!current) return;
                        setPendingImport(stored);
                        setJob(recovered);
                        setRecoverableJobs(recovered.status === 'succeeded' ? [] : [recovered]);
                        setStep('status');
                        try { localStorage.setItem(key, JSON.stringify(stored)); } catch { }
                        if (recovered.status === 'succeeded') reportImported(recovered);
                        else reportDestinationNeedsInspection(recovered);
                        setRecoveryState('ready');
                        return;
                    }
                    if (stored) {
                        try { localStorage.removeItem(key); } catch { }
                    }
                    setPendingImport(undefined);
                    setStep('file');
                    setBusy('setup');
                    const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, true, controller.signal);
                    if (!current) return;
                    setTargets(nextTargets);
                    setSchema(nextSchema);
                    setLastExistingTarget(nextTargets[0] ?? '');
                    setTarget(nextTargets[0] ?? CREATE_CLOUD_TABLE_TARGET);
                    setRecoveryState('ready');
                } catch (caught) {
                    if (!current) return;
                    setRecoveryState('failed');
                    setError(`Could not check Cloud import status: ${message(caught)}`);
                } finally { if (current) setBusy(''); }
            })();
            return () => { current = false; controller.abort(); };
        }

        setBusy('recover');
        void api<ImportJob[]>(`/imports?connectionId=${encodeURIComponent(importConnectionId)}&recoverable=true`, { signal: controller.signal }).then(async jobs => {
            if (!current) return;
            setRecoverableJobs(jobs);
            const recovered = jobs.find(item => item.id === stored?.id) ?? jobs[0];
            if (recovered) {
                const pending = stored?.id === recovered.id ? stored : { id: recovered.id, table: recovered.table, rows: recovered.rows, name: 'Previous import' };
                setPendingImport(pending);
                setJob(recovered);
                setStep('status');
                try { localStorage.setItem(key, JSON.stringify(pending)); } catch { }
                setRecoveryState('ready');
                setBusy('');
                return;
            }
            if (stored) {
                try { localStorage.removeItem(key); } catch { }
            }
            setPendingImport(undefined);
            setStep('file');
            setBusy('setup');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, false, controller.signal);
                if (!current) return;
                setTargets(nextTargets);
                setSchema(nextSchema);
                const first = nextTargets.find(table => nextSchema.tables.some(item => `${item.database}.${item.name}` === table)) ?? '';
                setLastExistingTarget(first);
                setTarget(first);
                if (!first) setImportUnavailable('No import targets are configured for this connection. Ask the workspace owner to allow a destination table.');
            } catch (caught) {
                if (current) setError(message(caught));
            }
            if (current) setRecoveryState('ready');
        }).catch(caught => {
            if (!current) return;
            setRecoveryState('failed');
            setError(`Could not check for unresolved imports: ${message(caught)}`);
        }).finally(() => { if (current) setBusy(''); });

        return () => { current = false; controller.abort(); };
    }, [open, connectionId, importConnectionId, trusted, demoMode, browserDemoImport, browserCloudImport, recoveryAttempt]);

    useImportJobPolling({
        open,
        step,
        job,
        setJob,
        setRecoverableJobs,
        setBusy,
        setError,
        onSucceeded: reportImported,
        cloudImport: browserCloudImport,
    });

    function reportImported(job: ImportJob) {
        if (reportedJobRef.current === job.id) return;
        reportedJobRef.current = job.id;
        onImportedRef.current(job);
    }

    function reportDestinationNeedsInspection(job: ImportJob) {
        if (job.status !== 'unknown' || !job.tableExists || !job.table || reportedInspectionRef.current === job.id) return;
        reportedInspectionRef.current = job.id;
        onTableNeedsInspectionRef.current(job);
    }

    function rememberJob(next: ImportJob) {
        setJob(next);
        setRecoverableJobs(current => next.status === 'succeeded' || next.reviewedAt
            ? current.filter(item => item.id !== next.id)
            : current.some(item => item.id === next.id)
                ? current.map(item => item.id === next.id ? next : item)
                : [next, ...current]);
        if (next.status === 'succeeded') reportImported(next);
        else reportDestinationNeedsInspection(next);
    }

    function savePendingImport(value: PendingImport) {
        setPendingImport(value);
        try { localStorage.setItem(importStateKey(importConnectionId), JSON.stringify(value)); } catch { }
    }

    function clearPendingImport() {
        try { localStorage.removeItem(importStateKey(importConnectionId)); } catch { }
        setPendingImport(undefined);
    }

    const actionSetters: ImportActionSetters = {
        setJob, setStep, setBusy, setError, setMapping, setTargets, setSchema, setTarget, setFields,
        setRecoveryState, setRecoverableJobs, setPendingImport, setImportUnavailable,
    };

    async function closeWizard() {
        if (busy || job?.status === 'running') return;
        if (preview?.id && !browserCloudImport) {
            void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined);
        }
        if (recoveryState === 'ready' && (job?.status !== 'unknown' || job.reviewedAt)) clearPendingImport();
        onClose();
    }

    function startMapping() {
        if (!preview || (!target && !browserCloudImport)) return;
        if (browserCloudImport && target === CREATE_CLOUD_TABLE_TARGET) {
            const columns = inferCloudImportColumns(cloudRows.length ? cloudRows : preview.rows, preview.columns);
            setCreateColumns(columns);
            setCreateTableName(createTableName || suggestCloudTableName(preview.name));
            setFields(Object.fromEntries(columns.map(column => [column.source, column.name])));
            setGenerateId(!columns.some(column => column.name.toLowerCase() === 'id'));
        } else {
            setFields(initialFields(preview.columns, writableColumns(schema, target)));
        }
        setMapping(undefined);
        setError('');
        setStep('mapping');
    }

    function changeTarget(next: string) {
        if (next !== CREATE_CLOUD_TABLE_TARGET) setLastExistingTarget(next);
        setTarget(next);
        if (browserCloudImport && next === CREATE_CLOUD_TABLE_TARGET && preview) {
            const columns = inferCloudImportColumns(cloudRows.length ? cloudRows : preview.rows, preview.columns);
            setCreateColumns(columns);
            setCreateTableName(suggestCloudTableName(preview.name));
            setFields(Object.fromEntries(columns.map(column => [column.source, column.name])));
            setGenerateId(!columns.some(column => column.name.toLowerCase() === 'id'));
        } else {
            setFields(initialFields(preview?.columns ?? [], writableColumns(schema, next)));
        }
        setMapping(undefined);
        setError('');
    }

    function updateCreateColumn(source: string, key: 'name' | 'type', value: string) {
        setCreateColumns(current => {
            const next = current.map(column => column.source === source ? { ...column, [key]: value } as CloudImportColumn : column);
            if (key === 'name') {
                const hadId = current.some(column => column.name.toLowerCase() === 'id');
                const hasId = next.some(column => column.name.toLowerCase() === 'id');
                if (hadId !== hasId) setGenerateId(!hasId);
            }
            return next;
        });
        if (key === 'name') setFields(current => ({ ...current, [source]: value }));
        setMapping(undefined);
        setError('');
    }

    async function previewMapping() {
        if (!preview || !target || !destinationNames.length || duplicateDestinations || busy) return;
        setBusy('mapping');
        setError('');
        try {
            let next: ImportMapping;
            if (browserCloudImport) {
                const cloud = getClickHouseCloudConnection();
                if (!cloud) throw new Error('Reconnect to ClickHouse Cloud before reviewing the import.');
                const table = creatingTable ? `${createTableDatabase}.${createTableName}` : target;
                if (creatingTable && !schema?.databases?.includes(createTableDatabase)) throw new Error('Choose a database visible to this ClickHouse user.');
                if (creatingTable && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(createTableName)) throw new Error('Use letters, numbers, and underscores for the new table name.');
                next = { id: crypto.randomUUID(), inputId: preview.id, connectionId: importConnectionId, table, fields: selectedFields, rows: [], rowCount: preview.rowCount };
            } else {
                next = await post<ImportMapping>(`/imports/${encodeURIComponent(preview.id)}/mapping`, {
                    connectionId: importConnectionId,
                    table: target,
                    fields: selectedFields,
                });
            }
            setMapping(next);
            setStep('review');
        } catch (caught) {
            setError(message(caught));
        } finally { setBusy(''); }
    }

    async function commitImport() {
        await runCommitImport({
            mapping, busy, browserDemoImport, browserCloudImport, file, format,
            creatingTable, schema, createTableDatabase, createTableName, createColumns, generateId, importConnectionId, preview,
            ...actionSetters,
            savePendingImport, clearPendingImport, rememberJob,
        });
    }

    async function reconcileJob() {
        if (!job || busy) return;
        setBusy('reconcile');
        setError('');
        try {
            const next = browserCloudImport && job.queryId
                ? await checkClickHouseCloudImport(job.queryId, job.table, job.rows)
                : await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/reconcile`);
            rememberJob(next);
        } catch (caught) { setError(`Could not check ClickHouse import status: ${message(caught)}`); }
        finally { setBusy(''); }
    }

    async function reviewUnknownImport() {
        await runReviewUnknownImport({
            job, busy, browserCloudImport, importConnectionId, recoverableJobs,
            ...actionSetters,
            clearPendingImport, rememberJob,
        });
    }

    async function confirmUnknownImport() {
        await runConfirmUnknownImport({ job, busy, browserCloudImport, rememberJob, clearPendingImport, setBusy, setError });
    }

    async function retryUnknownImport() {
        await runRetryUnknownImport({
            job, busy, preview, mapping, browserCloudImport, file, format, reviewUnknownImport,
            schema, target, creatingTable, cloudRows, createTableDatabase, createTableName, createColumns, generateId, importConnectionId,
            setCreateTableName, setCreateTableDatabase, setCreateColumns, browserDemoImport, setRetryAttemptedFor, ...actionSetters,
            savePendingImport, clearPendingImport, rememberJob,
        });
    }

    return {
        dialogRef,
        step,
        setStep,
        file,
        format,
        preview,
        setPreview,
        target,
        schema,
        lastExistingTarget,
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
        generateId,
        setGenerateId,
        importUnavailable,
        browserDemoImport,
        availableTargets,
        destinationColumns,
        selectedFields,
        destinationNames,
        duplicateDestinations,
        sampleColumns,
        browserCloudImport,
        creatingTable,
        createTableName,
        setCreateTableName,
        createTableDatabase,
        setCreateTableDatabase,
        createColumns,
        createColumnTypes: CREATE_TABLE_COLUMN_TYPES,
        updateCreateColumn,
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
    };
}
