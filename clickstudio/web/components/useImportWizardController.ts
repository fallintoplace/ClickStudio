import { useEffect, useMemo, useRef, useState } from 'react';
import type { Schema } from '../../shared/types';
import { useImportJobPolling } from './useImportJobPolling';
import { api, isFrontendDemoPreview, message, post, RequestError } from '../api';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../cloud-connection';
import { DEMO_IMPORT_SAMPLE_CSV } from '../demo-import-data';
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

export type ImportWizardControllerOptions = {
    open: boolean;
    connectionId: string;
    trusted: boolean;
    demoMode: boolean;
    onClose: () => void;
    onImported: () => void;
};

function importUnavailableReason(connectionId: string) {
    if (connectionId === 'playground') return 'File imports are disabled on the public read-only ClickHouse Playground connection.';
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) return 'File import is not available for this Cloud connection yet. Use SQL to create tables and insert data.';
    return 'File imports are disabled in sample data. This workspace never writes to a database.';
}

export function useImportWizardController({ open, connectionId, trusted, demoMode, onClose, onImported }: ImportWizardControllerOptions) {
    const browserDemoImport = demoMode && isFrontendDemoPreview && connectionId === 'demo';
    const importConnectionId = browserDemoImport ? 'demo' : connectionId;
    const dialogRef = useRef<HTMLDialogElement>(null);
    const onImportedRef = useRef(onImported);
    const reportedJobRef = useRef<string | undefined>(undefined);
    onImportedRef.current = onImported;

    const [step, setStep] = useState<Step>('file');
    const [file, setFile] = useState<File>();
    const [format, setFormat] = useState<ImportFormat>();
    const [preview, setPreview] = useState<ImportPreview>();
    const [schema, setSchema] = useState<Schema>();
    const [targets, setTargets] = useState<string[]>([]);
    const [target, setTarget] = useState('');
    const [fields, setFields] = useState<Record<string, string>>({});
    const [mapping, setMapping] = useState<ImportMapping>();
    const [job, setJob] = useState<ImportJob>();
    const [recoverableJobs, setRecoverableJobs] = useState<ImportJob[]>([]);
    const [pendingImport, setPendingImport] = useState<PendingImport>();
    const [recoveryState, setRecoveryState] = useState<'checking' | 'ready' | 'failed'>('checking');
    const [recoveryAttempt, setRecoveryAttempt] = useState(0);
    const [busy, setBusy] = useState<BusyAction>('');
    const [error, setError] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [importUnavailable, setImportUnavailable] = useState('');

    const availableTargets = useMemo(() => targets.filter(table => schema?.tables.some(item => `${item.database}.${item.name}` === table)), [schema, targets]);
    const destinationColumns = useMemo(() => writableColumns(schema, target), [schema, target]);
    const selectedFields = useMemo(() => Object.fromEntries(Object.entries(fields).filter(([, destination]) => Boolean(destination))), [fields]);
    const destinationNames = Object.values(selectedFields);
    const duplicateDestinations = new Set(destinationNames).size !== destinationNames.length;
    const confirmationPhrase = mapping && !browserDemoImport ? `INSERT ${mapping.rowCount} ROWS` : '';
    const sampleColumns = preview?.columns.slice(0, 6) ?? [];

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
        setSchema(undefined);
        setTargets([]);
        setTarget('');
        setFields({});
        setMapping(undefined);
        setJob(undefined);
        setRecoverableJobs([]);
        setPendingImport(undefined);
        setBusy('');
        setError('');
        setConfirmation('');
        setImportUnavailable('');
        setRecoveryState('checking');
        reportedJobRef.current = undefined;

        if (demoMode && !browserDemoImport) {
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
                const [nextTargets, nextSchema] = await loadImportSetup(importConnectionId, controller.signal);
                if (!current) return;
                setTargets(nextTargets);
                setSchema(nextSchema);
                const first = nextTargets.find(table => nextSchema.tables.some(item => `${item.database}.${item.name}` === table)) ?? '';
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
    }, [open, connectionId, importConnectionId, trusted, demoMode, browserDemoImport, recoveryAttempt]);

    useImportJobPolling({
        open,
        step,
        job,
        setJob,
        setRecoverableJobs,
        setBusy,
        setError,
        onSucceeded: reportImported,
    });

    function reportImported(id: string) {
        if (reportedJobRef.current === id) return;
        reportedJobRef.current = id;
        onImportedRef.current();
    }

    function rememberJob(next: ImportJob) {
        setJob(next);
        setRecoverableJobs(current => next.status === 'succeeded' || next.reviewedAt
            ? current.filter(item => item.id !== next.id)
            : current.some(item => item.id === next.id)
                ? current.map(item => item.id === next.id ? next : item)
                : [next, ...current]);
        if (next.status === 'succeeded') reportImported(next.id);
    }

    function savePendingImport(value: PendingImport) {
        setPendingImport(value);
        try { localStorage.setItem(importStateKey(importConnectionId), JSON.stringify(value)); } catch { }
    }

    function clearPendingImport() {
        try { localStorage.removeItem(importStateKey(importConnectionId)); } catch { }
        setPendingImport(undefined);
    }

    async function closeWizard() {
        if (busy || job?.status === 'running') return;
        if (preview?.id) {
            void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined);
        }
        if (recoveryState === 'ready' && (job?.status !== 'unknown' || job.reviewedAt)) clearPendingImport();
        onClose();
    }

    function chooseFile(next?: File) {
        setFile(next);
        setPreview(undefined);
        setMapping(undefined);
        setJob(undefined);
        setError('');
        setConfirmation('');
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
            const next = await post<ImportPreview>('/imports/preview', { name: nextFile.name, source, format: nextFormat });
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

    function startMapping() {
        if (!preview || !target) return;
        setFields(initialFields(preview.columns, writableColumns(schema, target)));
        setMapping(undefined);
        setError('');
        setStep('mapping');
    }

    function changeTarget(next: string) {
        setTarget(next);
        setFields(initialFields(preview?.columns ?? [], writableColumns(schema, next)));
        setMapping(undefined);
        setConfirmation('');
        setError('');
    }

    async function previewMapping() {
        if (!preview || !target || !destinationNames.length || duplicateDestinations || busy) return;
        setBusy('mapping');
        setError('');
        try {
            const next = await post<ImportMapping>(`/imports/${encodeURIComponent(preview.id)}/mapping`, {
                connectionId: importConnectionId,
                table: target,
                fields: selectedFields,
            });
            setMapping(next);
            setConfirmation('');
            setStep('review');
        } catch (caught) {
            setError(message(caught));
        } finally { setBusy(''); }
    }

    async function commitImport() {
        if (!mapping || (!browserDemoImport && confirmation !== confirmationPhrase) || busy) return;
        const record = { id: mapping.id, table: mapping.table, rows: mapping.rowCount, name: preview?.name ?? 'Selected file' };
        savePendingImport(record);
        setJob({ id: mapping.id, table: mapping.table, rows: mapping.rowCount, status: 'running' });
        setStep('status');
        setBusy('commit');
        setError('');
        try {
            const next = await post<ImportJob>(`/imports/${encodeURIComponent(mapping.id)}/commit`, { confirmation });
            rememberJob(next);
        } catch (caught) {
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

    async function reconcileJob() {
        if (!job || busy) return;
        setBusy('reconcile');
        setError('');
        try {
            const next = await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/reconcile`);
            rememberJob(next);
        } catch (caught) { setError(`Could not check ClickHouse import status: ${message(caught)}`); }
        finally { setBusy(''); }
    }

    async function reviewUnknownImport() {
        if (!job || job.status !== 'unknown' || busy) return;
        setBusy('review');
        setError('');
        try {
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
                    const [nextTargets, nextSchema] = await loadImportSetup(importConnectionId);
                    setTargets(nextTargets);
                    setSchema(nextSchema);
                    const first = nextTargets.find(table => nextSchema.tables.some(item => `${item.database}.${item.name}` === table)) ?? '';
                    setTarget(first);
                    setImportUnavailable(first ? '' : 'No import targets are configured for this connection. Ask the workspace owner to allow a destination table.');
                } catch (caught) { setError(message(caught)); }
                finally { setBusy(''); }
            }
        } catch (caught) { setError(`Could not record the import review: ${message(caught)}`); }
        finally { setBusy(''); }
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
        availableTargets,
        destinationColumns,
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
    };
}
