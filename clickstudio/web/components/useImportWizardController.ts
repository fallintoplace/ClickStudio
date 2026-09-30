import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Json, Schema } from '../../shared/types';
import { mapImportRows } from '../../core/import-mapping';
import { useImportJobPolling } from './useImportJobPolling';
import { api, isFrontendDemoPreview, message, post, RequestError } from '../api';
import { checkClickHouseCloudImport, CLICKHOUSE_CLOUD_CONNECTION_ID, CloudRequestError, getClickHouseCloudConnection, importClickHouseCloudFile, loadClickHouseCloudSchema } from '../cloud-connection';
import { CREATE_TABLE_COLUMN_TYPES } from '../../shared/table-creation';
import { DEMO_IMPORT_SAMPLE_CSV, parseImportFile } from '../demo-import-data';
import { CREATE_CLOUD_TABLE_TARGET, cloudImportTargets, inferCloudImportColumns, preferredCloudImportDatabase, suggestCloudTableName, type CloudImportColumn } from '../cloud-import';
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

const retryPayloadMismatchMessage = 'This file, format, destination, and mapping could not be verified against the previous import. Choose the original file and mapping to retry, or start a new import.';

async function importPayloadFingerprint(file: File | undefined, format: ImportFormat | undefined, connectionId: string, table: string, fields: Record<string, string>): Promise<string | undefined> {
    const subtle = globalThis.crypto?.subtle;
    if (!file || !format || !subtle) return undefined;
    try {
        const fileDigest = await subtle.digest('SHA-256', await file.arrayBuffer());
        const fileHash = Array.from(new Uint8Array(fileDigest), byte => byte.toString(16).padStart(2, '0')).join('');
        const cloudConnection = connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID ? getClickHouseCloudConnection() : undefined;
        const payload = JSON.stringify({
            version: 1,
            connectionId,
            ...(cloudConnection ? { cloudHost: cloudConnection.host.toLowerCase(), cloudDatabase: cloudConnection.database } : {}),
            table,
            format,
            fileHash,
            fields: Object.entries(fields).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
        });
        const digest = await subtle.digest('SHA-256', new TextEncoder().encode(payload));
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        return `sha256-v1:${hash}`;
    } catch {
        return undefined;
    }
}

function canReuseImportRetry(pendingImport: PendingImport | undefined, fingerprint: string | undefined): boolean {
    return pendingImport?.retryDeduplicationToken !== undefined &&
        fingerprint !== undefined &&
        pendingImport.payloadFingerprint === fingerprint;
}

function pendingImportForJob(job: ImportJob, previous?: PendingImport): PendingImport {
    const sameJob = previous?.id === job.id ? previous : undefined;
    return {
        id: job.id,
        table: job.table,
        rows: job.rows,
        name: sameJob?.name ?? 'Previous import',
        ...(job.queryId ? { queryId: job.queryId } : sameJob?.queryId ? { queryId: sameJob.queryId } : {}),
        ...(job.deduplicationToken ? { deduplicationToken: job.deduplicationToken } : sameJob?.deduplicationToken ? { deduplicationToken: sameJob.deduplicationToken } : {}),
        ...(sameJob?.payloadFingerprint ? { payloadFingerprint: sameJob.payloadFingerprint } : {}),
        ...(sameJob?.retryDeduplicationToken !== undefined ? { retryDeduplicationToken: sameJob.retryDeduplicationToken } : {}),
        ...(sameJob?.retryOriginId ? { retryOriginId: sameJob.retryOriginId } : {}),
    };
}

function retryIntentForJob(job: ImportJob, previous?: PendingImport): PendingImport {
    const sameJob = previous?.id === job.id ? previous : undefined;
    const base = pendingImportForJob(job, sameJob);
    const retryDeduplicationToken = job.deduplicationToken !== undefined
        ? job.deduplicationToken
        : sameJob?.retryDeduplicationToken !== undefined
            ? sameJob.retryDeduplicationToken
            : sameJob?.deduplicationToken ?? null;
    return { ...base, retryDeduplicationToken };
}

function pendingImportForRecoveredJob(stored: PendingImport | undefined, recovered: ImportJob): PendingImport {
    if (stored && (stored.retryDeduplicationToken !== undefined || stored.id === recovered.id)) return stored;
    return pendingImportForJob(recovered);
}

function advanceRecoveredQueue(context: {
    resolvedJob: ImportJob;
    recoverableJobs: ImportJob[];
    retryIntent?: PendingImport;
    keepRetryForResolved?: boolean;
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    setRecoverableJobs: Dispatch<SetStateAction<ImportJob[]>>;
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
}): boolean {
    const { resolvedJob, recoverableJobs, retryIntent, keepRetryForResolved, setJob, setRecoverableJobs, savePendingImport, clearPendingImport } = context;
    const remaining = recoverableJobs.filter(item => item.id !== resolvedJob.id);
    const retryAttemptResolved = Boolean(resolvedJob.status === 'succeeded' && retryIntent?.retryOriginId !== undefined && retryIntent.id === resolvedJob.id);
    const preserveRetry = Boolean(retryIntent?.retryDeduplicationToken !== undefined && !retryAttemptResolved && (keepRetryForResolved || retryIntent.id !== resolvedJob.id));
    setRecoverableJobs(remaining);
    if (preserveRetry && retryIntent) savePendingImport(retryIntent);
    else clearPendingImport();
    const following = remaining[0];
    if (!following) return false;
    setJob(following);
    if (!preserveRetry) savePendingImport(pendingImportForJob(following));
    return true;
}

function advanceRecoveredRetry(
    resolvedJob: ImportJob,
    recoverableJobs: ImportJob[],
    retryIntent: PendingImport,
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>,
    setRecoverableJobs: Dispatch<SetStateAction<ImportJob[]>>,
    savePendingImport: (value: PendingImport) => void,
    clearPendingImport: () => void,
) {
    advanceRecoveredQueue({ resolvedJob, recoverableJobs, retryIntent, setJob, setRecoverableJobs, savePendingImport, clearPendingImport });
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
    setLastExistingTarget: Dispatch<SetStateAction<string>>;
    setFields: Dispatch<SetStateAction<Record<string, string>>>;
    setRecoveryState: Dispatch<SetStateAction<'checking' | 'ready' | 'failed'>>;
    setRecoverableJobs: Dispatch<SetStateAction<ImportJob[]>>;
    setPendingImport: Dispatch<SetStateAction<PendingImport | undefined>>;
    setImportUnavailable: Dispatch<SetStateAction<string>>;
};

type ImportWizardRecoveryContext = ImportActionSetters & {
    open: boolean;
    connectionId: string;
    importConnectionId: string;
    trusted: boolean;
    demoMode: boolean;
    browserDemoImport: boolean;
    browserCloudImport: boolean;
    recoveryAttempt: number;
    setFile: Dispatch<SetStateAction<File | undefined>>;
    setFormat: Dispatch<SetStateAction<ImportFormat | undefined>>;
    setPreview: Dispatch<SetStateAction<ImportPreview | undefined>>;
    setCloudRows: Dispatch<SetStateAction<Record<string, Json>[]>>;
    setCreateTableName: Dispatch<SetStateAction<string>>;
    setCreateTableDatabase: Dispatch<SetStateAction<string>>;
    setCreateColumns: Dispatch<SetStateAction<CloudImportColumn[]>>;
    setRetryAttemptedFor: Dispatch<SetStateAction<string | undefined>>;
    setRetryImportConfirmed: Dispatch<SetStateAction<boolean>>;
    setGenerateId: Dispatch<SetStateAction<boolean>>;
    reportedJobRef: { current: string | undefined };
    reportedInspectionRef: { current: string | undefined };
    onImportedRef: { current: (job: ImportJob) => void };
    onTableNeedsInspectionRef: { current: (job: ImportJob) => void };
};

function useImportWizardRecovery(context: ImportWizardRecoveryContext) {
    const { open, connectionId, importConnectionId, trusted, demoMode, browserDemoImport, browserCloudImport, recoveryAttempt,
        setStep, setFile, setFormat, setPreview, setCloudRows, setSchema, setTargets, setTarget, setLastExistingTarget,
        setCreateTableName, setCreateTableDatabase, setCreateColumns, setFields, setMapping, setJob, setRecoverableJobs,
        setPendingImport, setBusy, setError, setRetryAttemptedFor, setRetryImportConfirmed, setGenerateId, setImportUnavailable,
        setRecoveryState, reportedJobRef, reportedInspectionRef, onImportedRef, onTableNeedsInspectionRef } = context;

    useEffect(() => {
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
        setRetryImportConfirmed(false);
        setGenerateId(true);
        setImportUnavailable('');
        setRecoveryState('checking');
        reportedJobRef.current = undefined;

        if ((demoMode && !browserDemoImport && !browserCloudImport) || (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID && !browserCloudImport)) {
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
                        const recovered = await checkClickHouseCloudImport(stored.queryId, stored.table, stored.rows, stored.deduplicationToken);
                        if (!current) return;
                        if (recovered.status === 'succeeded' && stored.retryOriginId !== undefined) {
                            try { localStorage.removeItem(key); } catch { }
                            setPendingImport(undefined);
                        } else setPendingImport(stored);
                        setJob(recovered);
                        setRecoverableJobs(recovered.status === 'succeeded' ? [] : [recovered]);
                        setStep('status');
                        if (recovered.status !== 'succeeded' || stored.retryOriginId === undefined) {
                            try { localStorage.setItem(key, JSON.stringify(stored)); } catch { }
                        }
                        if (recovered.status === 'succeeded') reportImported(recovered);
                        else reportDestinationNeedsInspection(recovered);
                        setRecoveryState('ready');
                        return;
                    }
                    if (stored && !(stored.retryDeduplicationToken !== undefined && !stored.queryId)) {
                        try { localStorage.removeItem(key); } catch { }
                    }
                    setPendingImport(stored?.retryDeduplicationToken !== undefined && !stored.queryId ? stored : undefined);
                    setStep('file');
                    setBusy('setup');
                    const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, true, controller.signal);
                    if (!current) return;
                    setTargets(nextTargets);
                    setSchema(nextSchema);
                    setCreateTableDatabase(preferredCloudImportDatabase(nextSchema, getClickHouseCloudConnection()?.database ?? ''));
                    setLastExistingTarget('');
                    setTarget('');
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
            let availableJobs = jobs;
            if (stored?.retryOriginId !== undefined && !jobs.some(item => item.id === stored?.id)) {
                try {
                    const retryAttempt = await api<ImportJob>(`/imports/${encodeURIComponent(stored.id)}`, { signal: controller.signal });
                    if (!current) return;
                    if (retryAttempt.status === 'succeeded') {
                        stored = undefined;
                        try { localStorage.removeItem(key); } catch { }
                        reportImported(retryAttempt);
                    } else availableJobs = [retryAttempt, ...jobs];
                } catch { }
            }
            if (!current) return;
            setRecoverableJobs(availableJobs);
            const recovered = availableJobs.find(item => item.id === stored?.id) ?? availableJobs[0];
            if (recovered) {
                const pending = pendingImportForRecoveredJob(stored, recovered);
                setPendingImport(pending);
                setJob(recovered);
                setStep('status');
                try { localStorage.setItem(key, JSON.stringify(pending)); } catch { }
                setRecoveryState('ready');
                setBusy('');
                return;
            }
            if (stored && !(stored.retryDeduplicationToken !== undefined && !stored.queryId)) {
                try { localStorage.removeItem(key); } catch { }
            }
            setPendingImport(stored?.retryDeduplicationToken !== undefined && !stored.queryId ? stored : undefined);
            setStep('file');
            setBusy('setup');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, false, controller.signal);
                if (!current) return;
                setTargets(nextTargets);
                setSchema(nextSchema);
                const hasTarget = nextTargets.some(table => nextSchema.tables.some(item => `${item.database}.${item.name}` === table));
                if (!hasTarget) setImportUnavailable('No import targets are configured for this connection. Ask the workspace owner to allow a destination table.');
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
    }, [open, connectionId, importConnectionId, trusted, demoMode, browserDemoImport, browserCloudImport, recoveryAttempt,
        onImportedRef, onTableNeedsInspectionRef, reportedInspectionRef, reportedJobRef, setBusy, setCloudRows, setCreateColumns,
        setCreateTableDatabase, setCreateTableName, setError, setFields, setFile, setFormat, setGenerateId,
        setImportUnavailable, setJob, setLastExistingTarget, setMapping, setPendingImport, setPreview, setRecoverableJobs,
        setRecoveryState, setRetryAttemptedFor, setRetryImportConfirmed, setSchema, setStep, setTarget, setTargets]);
}

type ForgetCloudImportContext = Pick<ImportActionSetters,
    'setStep' | 'setFields' | 'setRecoverableJobs' | 'setJob' | 'setPendingImport' | 'setBusy' | 'setError'
    | 'setTargets' | 'setSchema' | 'setTarget' | 'setLastExistingTarget' | 'setImportUnavailable'> & {
    job?: ImportJob;
    pendingImport?: PendingImport;
    busy: BusyAction;
    browserCloudImport: boolean;
    importConnectionId: string;
    clearPendingImport: () => void;
    chooseFile: (file?: File) => void;
    setRetryAttemptedFor: Dispatch<SetStateAction<string | undefined>>;
};

async function forgetCloudImport(context: ForgetCloudImportContext) {
    const {
        job, pendingImport, busy, browserCloudImport, importConnectionId, clearPendingImport, chooseFile,
        setRecoverableJobs, setFields, setRetryAttemptedFor, setStep, setJob, setPendingImport,
        setBusy, setError, setTargets, setSchema, setTarget, setLastExistingTarget, setImportUnavailable,
    } = context;
    if (!browserCloudImport || !job || busy || (job.status !== 'running' && job.status !== 'unknown')) return;
    if (pendingImport?.retryDeduplicationToken !== undefined && pendingImport.id !== job.id) setPendingImport(pendingImport);
    else {
        clearPendingImport();
        setPendingImport(undefined);
    }
    setJob(undefined);
    setRecoverableJobs(items => items.filter(item => item.id !== job.id));
    chooseFile(undefined);
    setFields({});
    setRetryAttemptedFor(undefined);
    setStep('file');
    setBusy('setup');
    setError('');
    setImportUnavailable('');
    try {
        const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, true);
        setTargets(nextTargets);
        setSchema(nextSchema);
        setTarget('');
        setLastExistingTarget('');
    } catch (caught) {
        setError(`Could not load ClickHouse Cloud tables: ${message(caught)}`);
    } finally {
        setBusy('');
    }
}

async function runCommitImport(context: ImportActionSetters & {
    mapping?: ImportMapping;
    deduplicationToken?: string | null;
    retryPayloadFingerprint?: string;
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
    retryOriginId?: string;
    onSucceeded?: (job: ImportJob, pendingImport: PendingImport) => void;
}) {
    const { mapping: initialMapping, deduplicationToken: retryDeduplicationToken, retryPayloadFingerprint, retryOriginId, onSucceeded, busy, browserDemoImport, browserCloudImport, file, format, creatingTable, schema, createTableDatabase, createTableName, createColumns, generateId, importConnectionId, preview,
        setJob, setStep, setBusy, setError, setMapping, setTargets, setSchema, setTarget, setLastExistingTarget, setFields, setRecoveryState, setRecoverableJobs, setPendingImport, savePendingImport, clearPendingImport, rememberJob } = context;
    if (!initialMapping || busy) return;
    const currentPayloadFingerprint = await importPayloadFingerprint(file, format ?? preview?.format, initialMapping.connectionId, initialMapping.table, initialMapping.fields);
    if (retryDeduplicationToken !== undefined && (retryPayloadFingerprint === undefined || currentPayloadFingerprint !== retryPayloadFingerprint)) {
        setError(retryPayloadMismatchMessage);
        setStep('file');
        return;
    }
    const payloadFingerprint = currentPayloadFingerprint ?? initialMapping.payloadFingerprint;
    const useAutomaticDeduplication = retryDeduplicationToken === null ||
        (retryDeduplicationToken === undefined && initialMapping.deduplicationToken === null);
    const deduplicationToken = useAutomaticDeduplication
        ? undefined
        : retryDeduplicationToken ?? initialMapping.deduplicationToken ?? crypto.randomUUID();
    const mapping: ImportMapping = {
        ...initialMapping,
        ...(payloadFingerprint ? { payloadFingerprint } : {}),
        ...(initialMapping.deduplicationToken === deduplicationToken ? {} : { deduplicationToken }),
    };
    const preserveRetryForRemap = () => {
        if (retryDeduplicationToken === undefined) {
            clearPendingImport();
            return;
        }
        savePendingImport({
            id: mapping.id,
            table: mapping.table,
            rows: mapping.rowCount,
            name: preview?.name ?? 'Previous import',
            ...(retryDeduplicationToken ? { deduplicationToken: retryDeduplicationToken } : {}),
            ...(mapping.payloadFingerprint ? { payloadFingerprint: mapping.payloadFingerprint } : {}),
            retryDeduplicationToken,
            ...(retryOriginId !== undefined ? { retryOriginId } : {}),
        });
    };
    setMapping(mapping);
    const queryId = browserCloudImport ? `clickstudio-import-${mapping.id}` : undefined;
    const record: PendingImport = { id: mapping.id, table: mapping.table, rows: mapping.rowCount, name: preview?.name ?? 'Selected file', ...(deduplicationToken ? { deduplicationToken } : {}), ...(mapping.payloadFingerprint ? { payloadFingerprint: mapping.payloadFingerprint } : {}), ...(queryId ? { queryId } : {}), ...(retryOriginId !== undefined ? { retryDeduplicationToken: retryDeduplicationToken ?? null, retryOriginId } : {}) };
    savePendingImport(record);
    setJob({ id: mapping.id, table: mapping.table, rows: mapping.rowCount, ...(deduplicationToken ? { deduplicationToken } : {}), status: 'running', ...(queryId ? { queryId } : {}) });
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
                ...(deduplicationToken ? { deduplicationToken } : {}),
                ...(expectedColumns ? { expectedColumns } : {}),
                ...(creatingTable ? { createTable: { database: createTableDatabase, name: createTableName, columns: createColumns, generateId } } : {}),
            });
        } else {
            next = await post<ImportJob>(`/imports/${encodeURIComponent(mapping.id)}/commit`);
        }
        rememberJob(next);
        if (next.status === 'succeeded') onSucceeded?.(next, record);
    } catch (caught) {
        if (browserCloudImport && queryId) {
            if (caught instanceof CloudRequestError && caught.status < 500) {
                setJob(undefined);
                preserveRetryForRemap();
                setStep('review');
                if (caught.code === 'SCHEMA_CHANGED') {
                    setMapping(undefined);
                    setStep('mapping');
                    try {
                        const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, true);
                        setTargets(nextTargets);
                        setSchema(nextSchema);
                        const nextTarget = nextTargets.includes(mapping.table) ? mapping.table : creatingTable ? CREATE_CLOUD_TABLE_TARGET : '';
                        setTarget(nextTarget);
                        setLastExistingTarget(nextTarget && nextTarget !== CREATE_CLOUD_TABLE_TARGET ? nextTarget : '');
                        if (nextTarget !== CREATE_CLOUD_TABLE_TARGET)
                            setFields(initialFields(preview?.columns ?? [], writableColumns(nextSchema, nextTarget)));
                        setError('The destination schema changed. Review the updated mapping before importing.');
                    } catch (refreshError) { setError(`The destination schema changed. Refresh failed: ${message(refreshError)}`); }
                } else setError(message(caught));
                return;
            }
            try {
                const status = await checkClickHouseCloudImport(queryId, mapping.table, mapping.rowCount, deduplicationToken);
                rememberJob(status);
                if (status.status === 'succeeded') onSucceeded?.(status, record);
            } catch {
                rememberJob({ id: mapping.id, connectionId: importConnectionId, table: mapping.table, rows: mapping.rowCount, queryId, ...(deduplicationToken ? { deduplicationToken } : {}), status: 'unknown', error: 'ClickHouse could not confirm the import. The rows may already be there.' });
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
            preserveRetryForRemap();
            setMapping(undefined);
            setStep('mapping');
            try {
                const [nextTargets, nextSchema] = await Promise.all([
                    api<string[]>(`/connections/${encodeURIComponent(importConnectionId)}/import-targets`),
                    api<Schema>(`/connections/${encodeURIComponent(importConnectionId)}/schema`),
                ]);
                setTargets(nextTargets);
                setSchema(nextSchema);
                const nextTarget = nextTargets.find(table => table === mapping.table && nextSchema.tables.some(item => `${item.database}.${item.name}` === table)) ?? '';
                setTarget(nextTarget);
                setLastExistingTarget(nextTarget);
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
                    const pending = { id: unresolved.id, table: unresolved.table, rows: unresolved.rows, name: 'Previous import', ...(unresolved.deduplicationToken ? { deduplicationToken: unresolved.deduplicationToken } : {}) };
                    setJob(unresolved);
                    if (retryDeduplicationToken === undefined) setPendingImport(pending);
                    else preserveRetryForRemap();
                    setStep('status');
                    if (retryDeduplicationToken === undefined) {
                        try { localStorage.setItem(importStateKey(importConnectionId), JSON.stringify(pending)); } catch { }
                    }
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
            preserveRetryForRemap();
            setStep('review');
            setError(message(caught));
            return;
        }
        setError('The response was interrupted. Checking the saved import status…');
        try {
            const next = await api<ImportJob>(`/imports/${encodeURIComponent(mapping.id)}`);
            rememberJob(next);
            if (next.status === 'succeeded') onSucceeded?.(next, record);
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
    retryIntent?: PendingImport;
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
    rememberJob: (job: ImportJob) => void;
}): Promise<boolean> {
    const { job, busy, browserCloudImport, importConnectionId, retryIntent, rememberJob, savePendingImport,
        setJob, setStep, setBusy, setError, setTargets, setSchema, setTarget, setLastExistingTarget, setImportUnavailable } = context;
    if (!job || job.status !== 'unknown' || busy) return false;
    setBusy('review');
    setError('');
    try {
        if (browserCloudImport && job.queryId) {
            const status = await checkClickHouseCloudImport(job.queryId, job.table, job.rows, job.deduplicationToken);
            if (status.status !== 'unknown') {
                rememberJob(status);
                if (status.status === 'succeeded') advanceRecoveredQueue({ resolvedJob: status, retryIntent, ...context });
                else if (retryIntent?.id === status.id) savePendingImport(pendingImportForJob(status, retryIntent));
                return false;
            }
            const reviewed = { ...status, reviewedAt: new Date().toISOString() };
            rememberJob(reviewed);
            if (advanceRecoveredQueue({ resolvedJob: reviewed, retryIntent, keepRetryForResolved: true, ...context })) return false;
            setJob(undefined);
            setStep('file');
            setBusy('setup');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, true);
                setTargets(nextTargets);
                setSchema(nextSchema);
                setTarget('');
                setLastExistingTarget('');
                setError('');
            } catch (caught) { setError(message(caught)); }
            finally { setBusy(''); }
            return true;
        }
        const next = await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/review`, { inspected: true, noActiveInsert: true });
        if (next.status !== 'unknown') {
            rememberJob(next);
            if (next.status === 'succeeded') advanceRecoveredQueue({ resolvedJob: next, retryIntent, ...context });
            else if (retryIntent?.id === next.id) savePendingImport(pendingImportForJob(next, retryIntent));
            return false;
        }
        if (!next.reviewedAt) {
            rememberJob(next);
            if (retryIntent?.id === next.id) savePendingImport(pendingImportForJob(next, retryIntent));
            return false;
        }
        const hasFollowing = advanceRecoveredQueue({ resolvedJob: next, retryIntent, keepRetryForResolved: true, ...context });
        setError('');
        if (!hasFollowing) {
            setJob(undefined);
            setStep('file');
            setBusy('setup');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, false);
                setTargets(nextTargets);
                setSchema(nextSchema);
                const hasTarget = nextTargets.some(table => nextSchema.tables.some(item => `${item.database}.${item.name}` === table));
                setTarget('');
                setLastExistingTarget('');
                setImportUnavailable(hasTarget ? '' : 'No import targets are configured for this connection. Ask the workspace owner to allow a destination table.');
            } catch (caught) { setError(message(caught)); }
            finally { setBusy(''); }
            return true;
        }
        return false;
    } catch (caught) { setError(`Could not record the import review: ${message(caught)}`); return false; }
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
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) return 'Reconnect to ClickHouse Cloud before importing rows.';
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
    setFields: Dispatch<SetStateAction<Record<string, string>>>;
    setCloudRows: Dispatch<SetStateAction<Record<string, Json>[]>>;
    setCreateColumns: Dispatch<SetStateAction<CloudImportColumn[]>>;
    setCreateTableName: Dispatch<SetStateAction<string>>;
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    setError: Dispatch<SetStateAction<string>>;
    setGenerateId: Dispatch<SetStateAction<boolean>>;
    setStep: Dispatch<SetStateAction<Step>>;
    setBusy: Dispatch<SetStateAction<BusyAction>>;
    setTarget: Dispatch<SetStateAction<string>>;
    setLastExistingTarget: Dispatch<SetStateAction<string>>;
};

function createImportWizardFileActions(context: ImportWizardFileActionContext) {
    const { browserDemoImport, browserCloudImport, target, file, format, busy,
        setFile, setFormat, setPreview, setMapping, setFields, setCloudRows, setCreateColumns, setCreateTableName,
        setJob, setError, setGenerateId, setStep, setBusy, setTarget, setLastExistingTarget } = context;

    function chooseFile(next?: File) {
        setFile(next);
        setTarget('');
        setLastExistingTarget('');
        setPreview(undefined);
        setMapping(undefined);
        setFields({});
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
            setStep('mapping');
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
        setTarget('');
        setLastExistingTarget('');
        setFields({});
        setFormat('csv');
        setError('');
        await previewSelectedFile(sample, 'csv');
    }

    return { chooseFile, previewFile, previewSampleFile };
}

type ConfirmUnknownImportContext = Pick<ImportActionSetters, 'setBusy' | 'setError'> & {
    job?: ImportJob;
    pendingImport?: PendingImport;
    recoverableJobs: ImportJob[];
    busy: BusyAction;
    browserCloudImport: boolean;
    rememberJob: (job: ImportJob) => void;
    setJob: ImportActionSetters['setJob'];
    setRecoverableJobs: ImportActionSetters['setRecoverableJobs'];
    setPendingImport: ImportActionSetters['setPendingImport'];
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
};

async function runConfirmUnknownImport(context: ConfirmUnknownImportContext) {
    const { job, pendingImport, busy, browserCloudImport, rememberJob, setBusy, setError } = context;
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
                if (checked.status === 'succeeded') advanceRecoveredQueue({ resolvedJob: checked, retryIntent: pendingImport, ...context });
                return;
            }
            if (!checked.reviewedAt) {
                rememberJob(checked);
                return;
            }
        }
        const succeeded = { ...checked, status: 'succeeded' as const, error: undefined, reviewedAt: checked.reviewedAt ?? new Date().toISOString() };
        rememberJob(succeeded);
        advanceRecoveredQueue({ resolvedJob: succeeded, retryIntent: pendingImport, ...context });
    } catch (caught) {
        setError(`Could not confirm the imported rows: ${message(caught)}`);
    } finally { setBusy(''); }
}

type RetryUnknownImportContext = ImportActionSetters & {
    job?: ImportJob;
    pendingImport?: PendingImport;
    recoverableJobs: ImportJob[];
    busy: BusyAction;
    preview?: ImportPreview;
    mapping?: ImportMapping;
    browserCloudImport: boolean;
    file?: File;
    format?: ImportFormat;
    reviewUnknownImport: (retryIntent?: PendingImport) => Promise<boolean>;
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
    setRetryImportConfirmed: Dispatch<SetStateAction<boolean>>;
};

async function runRetryUnknownImport(context: RetryUnknownImportContext) {
    const { job, pendingImport, recoverableJobs, busy, preview, mapping, browserCloudImport, file, format, reviewUnknownImport, schema, target, creatingTable,
        cloudRows, createTableDatabase, createTableName, createColumns, generateId, setCreateTableName, setCreateColumns, setCreateTableDatabase, importConnectionId,
        browserDemoImport, setRetryAttemptedFor,
        savePendingImport, clearPendingImport, rememberJob, setRetryImportConfirmed,
        setJob, setStep, setBusy, setError, setMapping, setTargets, setSchema, setTarget, setLastExistingTarget, setFields, setRecoveryState,
        setRecoverableJobs, setPendingImport, setImportUnavailable } = context;
    if (!job || job.status !== 'unknown' || busy) return;
    if (!preview || !mapping || mapping.id !== job.id || (browserCloudImport && (!file || !format))) {
        const retryIntent = pendingImport?.retryDeduplicationToken !== undefined ? pendingImport : retryIntentForJob(job, pendingImport);
        savePendingImport(retryIntent);
        const reviewed = await reviewUnknownImport(retryIntent);
        if (reviewed) {
            savePendingImport(retryIntent);
            setRetryImportConfirmed(true);
        }
        return;
    }
    setBusy('review');
    setError('');
    try {
        let checked: ImportJob;
        if (browserCloudImport) {
            if (!job.queryId) throw new Error('This Cloud import has no status id. Choose the file again before retrying.');
            checked = await checkClickHouseCloudImport(job.queryId, job.table, job.rows, job.deduplicationToken);
        } else {
            checked = await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/reconcile`);
        }
        if (checked.status !== 'unknown') {
            rememberJob(checked);
            if (checked.status === 'succeeded') advanceRecoveredQueue({ resolvedJob: checked, retryIntent: pendingImport, ...context });
            return;
        }
        if (!browserCloudImport && !checked.reviewedAt) {
            checked = await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/review`, { inspected: true, noActiveInsert: true });
            if (checked.status !== 'unknown') {
                rememberJob(checked);
                if (checked.status === 'succeeded') advanceRecoveredQueue({ resolvedJob: checked, retryIntent: pendingImport, ...context });
                return;
            }
            if (!checked.reviewedAt) {
                rememberJob(checked);
                return;
            }
        }

        const retryIntent = retryIntentForJob(job, pendingImport);
        savePendingImport(retryIntent);
        setRetryImportConfirmed(true);
        const retryPayloadFingerprint = await importPayloadFingerprint(file, format ?? preview.format, importConnectionId, mapping.table, mapping.fields);
        if (!canReuseImportRetry(retryIntent, retryPayloadFingerprint)) {
            setStep('file');
            setError(retryPayloadMismatchMessage);
            return;
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
            retryMapping = { ...mapping, id: crypto.randomUUID(), table: job.table, deduplicationToken: job.deduplicationToken ?? mapping.deduplicationToken, payloadFingerprint: retryPayloadFingerprint };
            setSchema(retrySchema);
            setTarget(retryTarget);
        } else {
            retryMapping = await post<ImportMapping>(`/imports/${encodeURIComponent(preview.id)}/mapping`, {
                connectionId: importConnectionId,
                table: mapping.table,
                fields: mapping.fields,
                deduplicationToken: job.deduplicationToken ?? null,
            });
            retryMapping = { ...retryMapping, payloadFingerprint: retryPayloadFingerprint };
        }

        setRetryAttemptedFor(retryMapping.id);
        setMapping(retryMapping);
        setFields(retryMapping.fields);
        setJob(checked);
        const remainingRecoverableJobs = recoverableJobs.filter(item => item.id !== job.id);
        setRecoverableJobs(remainingRecoverableJobs);
        clearPendingImport();
        await runCommitImport({
            mapping: retryMapping, busy: '',
            deduplicationToken: job.deduplicationToken ?? null,
            retryPayloadFingerprint: retryIntent.payloadFingerprint,
            retryOriginId: retryIntent.id,
            onSucceeded: (resolvedJob, activeImport) => advanceRecoveredRetry(resolvedJob, remainingRecoverableJobs, activeImport, setJob, setRecoverableJobs, savePendingImport, clearPendingImport),
            browserDemoImport, browserCloudImport, file, format, creatingTable: retryCreatingTable, schema: retrySchema,
            createTableDatabase: retryCreateTableDatabase, createTableName: retryCreateTableName, createColumns, generateId, importConnectionId, preview,
            setJob, setStep, setBusy, setError, setMapping, setTargets, setSchema, setTarget, setLastExistingTarget, setFields,
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
    const browserCloudImport = connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID && Boolean(getClickHouseCloudConnection());
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
    const [retryImportConfirmed, setRetryImportConfirmed] = useState(false);
    const [generateId, setGenerateId] = useState(true);
    const [importUnavailable, setImportUnavailable] = useState('');

    const availableTargets = useMemo(() => targets.filter(table => schema?.tables.some(item => `${item.database}.${item.name}` === table)), [schema, targets]);
    const creatingTable = browserCloudImport && target === CREATE_CLOUD_TABLE_TARGET;
    const destinationColumns = useMemo(() => creatingTable
        ? createColumns.map(column => ({ database: createTableDatabase, table: createTableName, name: column.name, type: `Nullable(${column.type})`, defaultKind: '', comment: '' }))
        : writableColumns(schema, target), [creatingTable, createColumns, createTableDatabase, createTableName, schema, target]);
    const selectedFields = useMemo(() => Object.fromEntries(Object.entries(fields).filter(([, destination]) => Boolean(destination))), [fields]);
    const destinationNames = Object.values(selectedFields);
    const duplicateDestinations = new Set(destinationNames).size !== destinationNames.length;
    const sampleColumns = preview?.columns.slice(0, 6) ?? [];
    const { chooseFile, previewFile, previewSampleFile } = createImportWizardFileActions({
        browserDemoImport, browserCloudImport, target, file, format, busy,
        setFile, setFormat, setPreview, setMapping, setFields, setCloudRows, setCreateColumns, setCreateTableName,
        setJob, setError, setGenerateId, setStep, setBusy, setTarget, setLastExistingTarget,
    });

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    useImportWizardRecovery({
        open, connectionId, importConnectionId, trusted, demoMode, browserDemoImport, browserCloudImport, recoveryAttempt,
        setStep, setFile, setFormat, setPreview, setCloudRows, setSchema, setTargets, setTarget, setLastExistingTarget,
        setCreateTableName, setCreateTableDatabase, setCreateColumns, setFields, setMapping, setJob, setRecoverableJobs,
        setPendingImport, setBusy, setError, setRetryAttemptedFor, setRetryImportConfirmed, setGenerateId, setImportUnavailable,
        setRecoveryState, reportedJobRef, reportedInspectionRef, onImportedRef, onTableNeedsInspectionRef,
    });

    useImportJobPolling({
        open,
        step,
        job,
        setJob,
        setRecoverableJobs,
        setBusy,
        setError,
        onSucceeded: job => {
            reportImported(job);
            advanceRecoveredQueue({ resolvedJob: job, recoverableJobs, retryIntent: pendingImport, setJob, setRecoverableJobs, savePendingImport, clearPendingImport });
        },
        onNeedsInspection: reportDestinationNeedsInspection,
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
        setJob, setStep, setBusy, setError, setMapping, setTargets, setSchema, setTarget, setLastExistingTarget, setFields,
        setRecoveryState, setRecoverableJobs, setPendingImport, setImportUnavailable,
    };

    async function closeWizard() {
        if (!browserCloudImport && (busy || job?.status === 'running')) return;
        if (preview?.id && !browserCloudImport) {
            void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(() => undefined);
        }
        if (recoveryState === 'ready' && pendingImport?.retryDeduplicationToken === undefined && (job?.status !== 'unknown' || job.reviewedAt) && (!browserCloudImport || job?.status !== 'running')) clearPendingImport();
        onClose();
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
        if (!preview || !target || !destinationNames.length || duplicateDestinations || busy || pendingImport?.retryDeduplicationToken !== undefined && !retryImportConfirmed) return;
        const retryTable = creatingTable ? `${createTableDatabase}.${createTableName}` : target;
        if (retryImportConfirmed && pendingImport?.retryDeduplicationToken !== undefined && pendingImport.table !== retryTable) {
            setError(`Choose ${pendingImport.table} to retry this import, or go back and start a new import for another table.`);
            return;
        }
        setBusy('mapping');
        setError('');
        try {
            const payloadFingerprint = await importPayloadFingerprint(file, format ?? preview.format, importConnectionId, retryTable, selectedFields);
            const retrySelected = retryImportConfirmed && pendingImport?.retryDeduplicationToken !== undefined;
            const retryMapping = retrySelected && canReuseImportRetry(pendingImport, payloadFingerprint);
            if (retrySelected && !retryMapping) {
                setStep('file');
                throw new Error(retryPayloadMismatchMessage);
            }
            let next: ImportMapping;
            if (browserCloudImport) {
                const cloud = getClickHouseCloudConnection();
                if (!cloud) throw new Error('Reconnect to ClickHouse Cloud before reviewing the import.');
                const table = creatingTable ? `${createTableDatabase}.${createTableName}` : target;
                if (creatingTable && !schema?.databases?.includes(createTableDatabase)) throw new Error('Choose a database visible to this ClickHouse user.');
                if (creatingTable && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(createTableName)) throw new Error('Use letters, numbers, and underscores for the new table name.');
                const sourceRows = cloudRows.length ? cloudRows : preview.rows;
                const mapped = mapImportRows(sourceRows, preview.columns, selectedFields, destinationColumns);
                next = { id: crypto.randomUUID(), deduplicationToken: retryMapping ? pendingImport.retryDeduplicationToken! : crypto.randomUUID(), inputId: preview.id, connectionId: importConnectionId, table, fields: selectedFields, rows: mapped.rows, rowCount: sourceRows.length, missingFields: mapped.missingFields };
            } else {
                next = await post<ImportMapping>(`/imports/${encodeURIComponent(preview.id)}/mapping`, {
                    connectionId: importConnectionId,
                    table: target,
                    fields: selectedFields,
                    ...(retryMapping ? { deduplicationToken: pendingImport.retryDeduplicationToken } : {}),
                });
            }
            setMapping({ ...next, ...(payloadFingerprint ? { payloadFingerprint } : {}) });
            setStep('review');
        } catch (caught) {
            setError(message(caught));
        } finally { setBusy(''); }
    }

    async function commitImport() {
        if (mapping && retryImportConfirmed && pendingImport?.retryDeduplicationToken !== undefined && pendingImport.table !== mapping.table) {
            setError(`Choose ${pendingImport.table} to retry this import, or go back and start a new import for another table.`);
            return;
        }
        const retrySelected = Boolean(mapping && pendingImport && retryImportConfirmed && pendingImport.table === mapping.table && pendingImport.retryDeduplicationToken !== undefined);
        if (retrySelected && !canReuseImportRetry(pendingImport, mapping?.payloadFingerprint)) {
            setStep('file');
            setError(retryPayloadMismatchMessage);
            return;
        }
        const retryOriginId = retrySelected && mapping && pendingImport
            ? pendingImport.retryOriginId ?? pendingImport.id : undefined;
        await runCommitImport({
            mapping, busy, browserDemoImport, browserCloudImport, file, format,
            deduplicationToken: retrySelected && pendingImport
                ? pendingImport.retryDeduplicationToken
                : undefined,
            retryPayloadFingerprint: retrySelected ? pendingImport?.payloadFingerprint : undefined,
            retryOriginId,
            onSucceeded: retryOriginId === undefined ? undefined : (resolvedJob, activeImport) => advanceRecoveredRetry(resolvedJob, recoverableJobs, activeImport, setJob, setRecoverableJobs, savePendingImport, clearPendingImport),
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
            ? await checkClickHouseCloudImport(job.queryId, job.table, job.rows, job.deduplicationToken)
                : await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/reconcile`);
            rememberJob(next);
            if (next.status === 'succeeded') advanceRecoveredQueue({ resolvedJob: next, recoverableJobs, retryIntent: pendingImport, ...actionSetters, savePendingImport, clearPendingImport });
        } catch (caught) { setError(`Could not check ClickHouse import status: ${message(caught)}`); }
        finally { setBusy(''); }
    }

    async function reviewUnknownImport(retryIntent?: PendingImport) {
        return runReviewUnknownImport({
            job, busy, browserCloudImport, importConnectionId, recoverableJobs, retryIntent, savePendingImport,
            ...actionSetters,
            clearPendingImport, rememberJob,
        });
    }

    async function confirmUnknownImport() {
        await runConfirmUnknownImport({ job, pendingImport, recoverableJobs, busy, browserCloudImport, rememberJob, ...actionSetters, savePendingImport, clearPendingImport });
    }

    async function retryUnknownImport() {
        await runRetryUnknownImport({
            job, pendingImport, recoverableJobs, busy, preview, mapping, browserCloudImport, file, format, reviewUnknownImport,
            schema, target, creatingTable, cloudRows, createTableDatabase, createTableName, createColumns, generateId, importConnectionId,
            setCreateTableName, setCreateTableDatabase, setCreateColumns, browserDemoImport, setRetryAttemptedFor, ...actionSetters,
            savePendingImport, clearPendingImport, rememberJob, setRetryImportConfirmed,
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
        retryImportConfirmed,
        resumePendingRetry: () => { if (pendingImport?.retryDeduplicationToken !== undefined) setRetryImportConfirmed(true); },
        startNewImport: () => { if (pendingImport?.retryDeduplicationToken !== undefined) clearPendingImport(); setRetryImportConfirmed(false); },
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
        forgetImport: () => forgetCloudImport({ job, pendingImport, busy, browserCloudImport, importConnectionId, clearPendingImport, chooseFile, setRetryAttemptedFor, ...actionSetters }),
        chooseFile,
        previewFile,
        previewSampleFile,
        changeTarget,
        previewMapping,
        commitImport,
        reconcileJob,
        confirmUnknownImport,
        retryUnknownImport,
        retryAttemptedFor,
    };
}
