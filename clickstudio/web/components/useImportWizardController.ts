import {
    MAX_IMPORT_FILE_BYTES,
    IMPORT_PREVIEW_ROWS,
    IMPORT_FILE_SIZE_LABEL,
} from '../../shared/import-limits';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Json, Schema, SchemaColumn } from '../../shared/types';
import { mapImportRows } from '../../core/import-mapping';
import { useImportJobPolling } from './useImportJobPolling';
import { api, isFrontendDemoPreview, message, post, RequestError } from '../api';
import {
    checkClickHouseCloudImport,
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    CloudRequestError,
    getClickHouseCloudConnection,
    importClickHouseCloudFile,
    loadClickHouseCloudSchema,
} from '../cloud-connection';
import { CREATE_TABLE_COLUMN_TYPES } from '../../shared/table-creation';
import { DEMO_IMPORT_SAMPLE_CSV, parseImportFile } from '../demo-import-data';
import {
    CREATE_CLOUD_TABLE_TARGET,
    cloudImportTargets,
    inferCloudImportColumns,
    preferredCloudImportDatabase,
    suggestCloudTableName,
    type CloudImportColumn,
} from '../cloud-import';
import {
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

function importFailureMessage(error: unknown) {
    if (error instanceof RequestError && error.detail.code === 'IMPORT_VALUE_TYPE')
        return error.message;
    if (error instanceof CloudRequestError && error.code === 'CLICKHOUSE_ERROR') {
        const column = error.message.match(/\bkey\s+['"`]?([^:'"`\s)]+)/i)?.[1];
        const row = error.message.match(/\(at row\s+(\d+)\)/i)?.[1];
        if (/cannot parse input/i.test(error.message)) {
            const location = [
                column ? `column ${JSON.stringify(column)}` : '',
                row ? `row ${row}` : '',
            ]
                .filter(Boolean)
                .join(' at ');
            return `ClickHouse could not parse an imported value${location ? ` for ${location}` : ''}. Check that the file values match the destination column types.`;
        }
        return error.message
            .replace(/\s*:\s*While executing\b[\s\S]*$/i, '')
            .replace(/\s+/g, ' ')
            .slice(0, 500);
    }
    return message(error);
}

async function loadConnectionImportSetup(
    connectionId: string,
    cloudImport: boolean,
    signal?: AbortSignal,
): Promise<[string[], Schema]> {
    if (cloudImport) {
        const nextSchema = await loadClickHouseCloudSchema();
        return [cloudImportTargets(nextSchema), nextSchema];
    }
    return await loadImportSetup(connectionId, signal);
}

function pendingImportForJob(job: ImportJob, previous?: PendingImport): PendingImport {
    const sameJob = previous?.id === job.id ? previous : undefined;
    const getPendingQueryId = () => {
        if (job.queryId) {
            return { queryId: job.queryId };
        }

        if (sameJob?.queryId) {
            return { queryId: sameJob.queryId };
        }

        return {};
    };
    const getPendingDeduplicationToken = () => {
        if (job.deduplicationToken) {
            return { deduplicationToken: job.deduplicationToken };
        }

        if (sameJob?.deduplicationToken) {
            return { deduplicationToken: sameJob.deduplicationToken };
        }

        return {};
    };
    return {
        id: job.id,
        table: job.table,
        rows: job.rows,
        name: sameJob?.name ?? 'Previous import',
        ...getPendingQueryId(),
        ...getPendingDeduplicationToken(),
        ...(sameJob?.inspectionOpened ? { inspectionOpened: true } : {}),
    };
}

function advanceRecoveredQueue(context: {
    resolvedJob: ImportJob;
    recoverableJobs: ImportJob[];
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    setRecoverableJobs: Dispatch<SetStateAction<ImportJob[]>>;
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
}): boolean {
    const {
        resolvedJob,
        recoverableJobs,
        setJob,
        setRecoverableJobs,
        savePendingImport,
        clearPendingImport,
    } = context;
    const remaining = recoverableJobs.filter(item => item.id !== resolvedJob.id);
    setRecoverableJobs(remaining);
    clearPendingImport();
    const following = remaining[0];
    if (!following) return false;
    setJob(following);
    savePendingImport(pendingImportForJob(following));
    return true;
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
    setFile: Dispatch<SetStateAction<File | undefined>>;
    setFormat: Dispatch<SetStateAction<ImportFormat | undefined>>;
    setPreview: Dispatch<SetStateAction<ImportPreview | undefined>>;
    setCloudRows: Dispatch<SetStateAction<Record<string, Json>[]>>;
    setCreateTableName: Dispatch<SetStateAction<string>>;
    setCreateTableDatabase: Dispatch<SetStateAction<string>>;
    setCreateColumns: Dispatch<SetStateAction<CloudImportColumn[]>>;
    setGenerateId: Dispatch<SetStateAction<boolean>>;
    reportedJobRef: { current: string | undefined };
    reportedInspectionRef: { current: string | undefined };
    onImportedRef: { current: (job: ImportJob) => void };
    onTableNeedsInspectionRef: { current: (job: ImportJob) => void };
};

function useImportWizardRecovery(context: ImportWizardRecoveryContext) {
    const {
        open,
        connectionId,
        importConnectionId,
        trusted,
        demoMode,
        browserDemoImport,
        browserCloudImport,
        setStep,
        setFile,
        setFormat,
        setPreview,
        setCloudRows,
        setSchema,
        setTargets,
        setTarget,
        setLastExistingTarget,
        setCreateTableName,
        setCreateTableDatabase,
        setCreateColumns,
        setFields,
        setMapping,
        setJob,
        setRecoverableJobs,
        setPendingImport,
        setBusy,
        setError,
        setGenerateId,
        setImportUnavailable,
        setRecoveryState,
        reportedJobRef,
        reportedInspectionRef,
        onImportedRef,
        onTableNeedsInspectionRef,
    } = context;

    useEffect(() => {
        function reportImported(job: ImportJob) {
            if (reportedJobRef.current === job.id) return;
            reportedJobRef.current = job.id;
            onImportedRef.current(job);
        }
        function reportDestinationNeedsInspection(job: ImportJob) {
            if (
                job.status !== 'unknown' ||
                !job.tableExists ||
                !job.table ||
                reportedInspectionRef.current === job.id
            )
                return;
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
        setGenerateId(true);
        setImportUnavailable('');
        setRecoveryState('checking');
        reportedJobRef.current = undefined;

        if (
            (demoMode && !browserDemoImport && !browserCloudImport) ||
            (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID && !browserCloudImport)
        ) {
            setRecoveryState('ready');
            setImportUnavailable(importUnavailableReason(connectionId));
            return () => {
                current = false;
                controller.abort();
            };
        }
        if (!trusted) {
            setRecoveryState('ready');
            setImportUnavailable('Trust this connection before importing data.');
            return () => {
                current = false;
                controller.abort();
            };
        }

        const key = importStateKey(importConnectionId);
        let stored: PendingImport | undefined;
        try {
            const value = localStorage.getItem(key);
            if (value) {
                const parsed: unknown = JSON.parse(value);
                if (isPendingImport(parsed)) stored = parsed;
            }
        } catch {}

        if (
            stored &&
            !stored.queryId &&
            ('retryDeduplicationToken' in stored || 'retryOriginId' in stored)
        ) {
            try {
                localStorage.removeItem(key);
            } catch {}
            stored = undefined;
        }

        if (browserCloudImport) {
            setBusy('recover');
            void (async () => {
                try {
                    if (stored?.queryId) {
                        const recovered = await checkClickHouseCloudImport(
                            stored.queryId,
                            stored.table,
                            stored.rows,
                            stored.deduplicationToken,
                        );
                        if (!current) return;
                        if (recovered.status === 'succeeded') {
                            try {
                                localStorage.removeItem(key);
                            } catch {}
                            setPendingImport(undefined);
                        } else {
                            const pending = pendingImportForJob(recovered, stored);
                            setPendingImport(pending);
                            try {
                                localStorage.setItem(key, JSON.stringify(pending));
                            } catch {}
                        }
                        setJob(recovered);
                        setRecoverableJobs(recovered.status === 'succeeded' ? [] : [recovered]);
                        setStep('status');
                        if (recovered.status === 'succeeded') reportImported(recovered);
                        else reportDestinationNeedsInspection(recovered);
                        setRecoveryState('ready');
                        return;
                    }
                    if (stored) {
                        try {
                            localStorage.removeItem(key);
                        } catch {}
                    }
                    setPendingImport(undefined);
                    setStep('file');
                    setBusy('setup');
                    const [nextTargets, nextSchema] = await loadConnectionImportSetup(
                        importConnectionId,
                        true,
                        controller.signal,
                    );
                    if (!current) return;
                    setTargets(nextTargets);
                    setSchema(nextSchema);
                    setCreateTableDatabase(
                        preferredCloudImportDatabase(
                            nextSchema,
                            getClickHouseCloudConnection()?.database ?? '',
                        ),
                    );
                    setLastExistingTarget('');
                    setTarget('');
                    setRecoveryState('ready');
                } catch (caught) {
                    if (!current) return;
                    setRecoveryState('failed');
                    setError(`Could not check Cloud import status: ${message(caught)}`);
                } finally {
                    if (current) setBusy('');
                }
            })();
            return () => {
                current = false;
                controller.abort();
            };
        }

        setBusy('recover');
        void api<ImportJob[]>(
            `/imports?connectionId=${encodeURIComponent(importConnectionId)}&recoverable=true`,
            { signal: controller.signal },
        )
            .then(async jobs => {
                if (!current) return;
                setRecoverableJobs(jobs);
                const recovered = jobs.find(item => item.id === stored?.id) ?? jobs[0];
                if (recovered) {
                    const pending = pendingImportForJob(recovered, stored);
                    setPendingImport(pending);
                    setJob(recovered);
                    setStep('status');
                    try {
                        localStorage.setItem(key, JSON.stringify(pending));
                    } catch {}
                    setRecoveryState('ready');
                    setBusy('');
                    return;
                }
                if (stored) {
                    try {
                        localStorage.removeItem(key);
                    } catch {}
                }
                setPendingImport(undefined);
                setStep('file');
                setBusy('setup');
                try {
                    const [nextTargets, nextSchema] = await loadConnectionImportSetup(
                        importConnectionId,
                        false,
                        controller.signal,
                    );
                    if (!current) return;
                    setTargets(nextTargets);
                    setSchema(nextSchema);
                    const hasTarget = nextTargets.some(table =>
                        nextSchema.tables.some(item => `${item.database}.${item.name}` === table),
                    );
                    if (!hasTarget)
                        setImportUnavailable(
                            'No import targets are configured for this connection. Ask the workspace owner to allow a destination table.',
                        );
                } catch (caught) {
                    if (current) setError(message(caught));
                }
                if (current) setRecoveryState('ready');
            })
            .catch(caught => {
                if (!current) return;
                setRecoveryState('failed');
                setError(`Could not check for unresolved imports: ${message(caught)}`);
            })
            .finally(() => {
                if (current) setBusy('');
            });

        return () => {
            current = false;
            controller.abort();
        };
    }, [
        open,
        connectionId,
        importConnectionId,
        trusted,
        demoMode,
        browserDemoImport,
        browserCloudImport,
        onImportedRef,
        onTableNeedsInspectionRef,
        reportedInspectionRef,
        reportedJobRef,
        setBusy,
        setCloudRows,
        setCreateColumns,
        setCreateTableDatabase,
        setCreateTableName,
        setError,
        setFields,
        setFile,
        setFormat,
        setGenerateId,
        setImportUnavailable,
        setJob,
        setLastExistingTarget,
        setMapping,
        setPendingImport,
        setPreview,
        setRecoverableJobs,
        setRecoveryState,
        setSchema,
        setStep,
        setTarget,
        setTargets,
    ]);
}

type ForgetCloudImportContext = Pick<
    ImportActionSetters,
    | 'setStep'
    | 'setFields'
    | 'setRecoverableJobs'
    | 'setJob'
    | 'setBusy'
    | 'setError'
    | 'setTargets'
    | 'setSchema'
    | 'setTarget'
    | 'setLastExistingTarget'
    | 'setImportUnavailable'
> & {
    job?: ImportJob;
    busy: BusyAction;
    browserCloudImport: boolean;
    importConnectionId: string;
    clearPendingImport: () => void;
    chooseFile: (file?: File) => void;
};

async function forgetCloudImport(context: ForgetCloudImportContext) {
    const {
        job,
        busy,
        browserCloudImport,
        importConnectionId,
        clearPendingImport,
        chooseFile,
        setRecoverableJobs,
        setFields,
        setStep,
        setJob,
        setBusy,
        setError,
        setTargets,
        setSchema,
        setTarget,
        setLastExistingTarget,
        setImportUnavailable,
    } = context;
    if (
        !browserCloudImport ||
        !job ||
        busy ||
        (job.status !== 'running' && job.status !== 'unknown')
    )
        return;
    clearPendingImport();
    setJob(undefined);
    setRecoverableJobs(items => items.filter(item => item.id !== job.id));
    chooseFile(undefined);
    setFields({});
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

async function runCommitImport(
    context: ImportActionSetters & {
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
    },
) {
    const {
        mapping: initialMapping,
        busy,
        browserDemoImport,
        browserCloudImport,
        file,
        format,
        creatingTable,
        schema,
        createTableDatabase,
        createTableName,
        createColumns,
        generateId,
        importConnectionId,
        preview,
        setJob,
        setStep,
        setBusy,
        setError,
        setMapping,
        setTargets,
        setSchema,
        setTarget,
        setLastExistingTarget,
        setFields,
        setRecoveryState,
        setRecoverableJobs,
        setPendingImport,
        savePendingImport,
        clearPendingImport,
        rememberJob,
    } = context;
    if (!initialMapping || busy) return;
    const deduplicationToken = initialMapping.deduplicationToken ?? crypto.randomUUID();
    const mapping: ImportMapping = {
        ...initialMapping,
        ...(initialMapping.deduplicationToken === deduplicationToken ? {} : { deduplicationToken }),
    };
    setMapping(mapping);
    const queryId = browserCloudImport ? `clickstudio-import-${mapping.id}` : undefined;
    const record: PendingImport = {
        id: mapping.id,
        table: mapping.table,
        rows: mapping.rowCount,
        name: preview?.name ?? 'Selected file',
        deduplicationToken,
        ...(queryId ? { queryId } : {}),
    };
    savePendingImport(record);
    setJob({
        id: mapping.id,
        table: mapping.table,
        rows: mapping.rowCount,
        ...(deduplicationToken ? { deduplicationToken } : {}),
        status: 'running',
        ...(queryId ? { queryId } : {}),
    });
    setStep('status');
    setBusy('commit');
    setError('');
    const refreshCloudMapping = async (caught: CloudRequestError) => {
        if (caught.code === 'TABLE_EXISTS' && creatingTable) {
            setMapping(undefined);
            setStep('mapping');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(
                    importConnectionId,
                    true,
                );
                setTargets(nextTargets);
                setSchema(nextSchema);
                setError('');
            } catch (refreshError) {
                setError(
                    `Table ${mapping.table} already exists. Change the table name or choose Add to a table. Could not refresh the table list: ${message(refreshError)}`,
                );
            }
        } else if (caught.code === 'SCHEMA_CHANGED') {
            setMapping(undefined);
            setStep('mapping');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(
                    importConnectionId,
                    true,
                );
                setTargets(nextTargets);
                setSchema(nextSchema);
                let nextTarget: string;

                if (nextTargets.includes(mapping.table)) {
                    nextTarget = mapping.table;
                } else if (creatingTable) {
                    nextTarget = CREATE_CLOUD_TABLE_TARGET;
                } else {
                    nextTarget = '';
                }
                setTarget(nextTarget);
                setLastExistingTarget(
                    nextTarget && nextTarget !== CREATE_CLOUD_TABLE_TARGET ? nextTarget : '',
                );
                if (nextTarget !== CREATE_CLOUD_TABLE_TARGET)
                    setFields(
                        initialFields(
                            preview?.columns ?? [],
                            writableColumns(nextSchema, nextTarget),
                        ),
                    );
                setError(
                    'The destination schema changed. Review the updated mapping before importing.',
                );
            } catch (refreshError) {
                setError(
                    `The destination schema changed. Refresh failed: ${message(refreshError)}`,
                );
            }
        } else setError(message(caught));
    };
    const recoverCloudImport = async (caught: unknown, queryId: string) => {
        if (caught instanceof CloudRequestError && caught.code === 'CLICKHOUSE_ERROR') {
            setJob(undefined);
            clearPendingImport();
            setMapping(undefined);
            setStep('mapping');
            setError(importFailureMessage(caught));
            return;
        }
        if (caught instanceof CloudRequestError && caught.status < 500) {
            setJob(undefined);
            clearPendingImport();
            setStep('review');
            await refreshCloudMapping(caught);
            return;
        }
        try {
            const status = await checkClickHouseCloudImport(
                queryId,
                mapping.table,
                mapping.rowCount,
                deduplicationToken,
            );
            rememberJob(status);
        } catch {
            rememberJob({
                id: mapping.id,
                connectionId: importConnectionId,
                table: mapping.table,
                rows: mapping.rowCount,
                queryId,
                ...(deduplicationToken ? { deduplicationToken } : {}),
                status: 'unknown',
                error: 'ClickHouse could not confirm the import. The rows may already be there.',
            });
        }
        return;
    };
    const refreshServerMapping = async () => {
        setJob(undefined);
        clearPendingImport();
        setMapping(undefined);
        setStep('mapping');
        try {
            const [nextTargets, nextSchema] = await Promise.all([
                api<string[]>(
                    `/connections/${encodeURIComponent(importConnectionId)}/import-targets`,
                ),
                api<Schema>(`/connections/${encodeURIComponent(importConnectionId)}/schema`),
            ]);
            setTargets(nextTargets);
            setSchema(nextSchema);
            const nextTarget =
                nextTargets.find(
                    table =>
                        table === mapping.table &&
                        nextSchema.tables.some(item => `${item.database}.${item.name}` === table),
                ) ?? '';
            setTarget(nextTarget);
            setLastExistingTarget(nextTarget);
            setFields(
                initialFields(preview?.columns ?? [], writableColumns(nextSchema, nextTarget)),
            );
            setError(
                'The destination schema changed. Review the updated mapping before importing.',
            );
        } catch (refreshError) {
            setError(`The destination schema changed. Refresh failed: ${message(refreshError)}`);
        }
        return;
    };
    const recoverUnresolvedImport = async (caught: RequestError) => {
        setBusy('recover');
        try {
            const jobs = await api<ImportJob[]>(
                `/imports?connectionId=${encodeURIComponent(importConnectionId)}&recoverable=true`,
            );
            setRecoverableJobs(jobs);
            const unresolved = jobs[0];
            if (unresolved) {
                const pending = {
                    id: unresolved.id,
                    table: unresolved.table,
                    rows: unresolved.rows,
                    name: 'Previous import',
                    ...(unresolved.deduplicationToken
                        ? { deduplicationToken: unresolved.deduplicationToken }
                        : {}),
                };
                setJob(unresolved);
                setPendingImport(pending);
                setStep('status');
                try {
                    localStorage.setItem(
                        importStateKey(importConnectionId),
                        JSON.stringify(pending),
                    );
                } catch {}
            } else {
                setStep('review');
                setError(message(caught));
            }
        } catch (recoveryError) {
            setRecoveryState('failed');
            setError(`Could not check for unresolved imports: ${message(recoveryError)}`);
        }
        return;
    };
    const recoverCommit = async (caught: unknown) => {
        if (browserCloudImport && queryId) {
            await recoverCloudImport(caught, queryId);
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
            await refreshServerMapping();
            return;
        }
        if (caught instanceof RequestError && caught.detail.code === 'IMPORT_UNRESOLVED') {
            await recoverUnresolvedImport(caught);
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
            rememberJob({
                id: mapping.id,
                table: mapping.table,
                rows: mapping.rowCount,
                status: 'unknown',
                reconciliationRequired: true,
                error: 'The server could not confirm this insert. Check for the saved import job before starting another write.',
            });
        }
    };
    try {
        let next: ImportJob;
        if (browserCloudImport) {
            if (!file || !format || !queryId)
                throw new Error('Choose the file again before starting this import.');
            const expectedColumns = creatingTable
                ? undefined
                : schema?.columns
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
                ...(creatingTable
                    ? {
                          createTable: {
                              database: createTableDatabase,
                              name: createTableName,
                              columns: createColumns,
                              generateId,
                          },
                      }
                    : {}),
            });
        } else {
            next = await post<ImportJob>(`/imports/${encodeURIComponent(mapping.id)}/commit`);
        }
        rememberJob(next);
    } catch (caught) {
        await recoverCommit(caught);
    } finally {
        setBusy('');
    }
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
    if (connectionId === 'playground')
        return 'File imports are disabled on the public read-only ClickHouse Playground connection.';
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID)
        return 'Reconnect to ClickHouse Cloud before importing rows.';
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
    const {
        browserDemoImport,
        browserCloudImport,
        target,
        file,
        format,
        busy,
        setFile,
        setFormat,
        setPreview,
        setMapping,
        setFields,
        setCloudRows,
        setCreateColumns,
        setCreateTableName,
        setJob,
        setError,
        setGenerateId,
        setStep,
        setBusy,
        setTarget,
        setLastExistingTarget,
    } = context;

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
        if (!next) {
            setFormat(undefined);
            return;
        }
        const nextFormat = fileFormat(next);
        setFormat(nextFormat);
        if (!nextFormat) setError('Choose a .csv, .json, .ndjson, or .jsonl file.');
        else if (next.size > MAX_IMPORT_FILE_BYTES)
            setError(`This file is larger than the ${IMPORT_FILE_SIZE_LABEL} import limit.`);
    }

    async function previewSelectedFile(nextFile: File, nextFormat: ImportFormat) {
        if (nextFile.size > MAX_IMPORT_FILE_BYTES || busy) return;
        setBusy('preview');
        setError('');
        try {
            const source = await nextFile.text();
            let next: ImportPreview;
            if (browserCloudImport) {
                const parsed = parseImportFile(source, nextFormat);
                if (!parsed.rows.length) throw new Error('The input contains no data rows.');
                setCloudRows(parsed.rows);
                next = {
                    id: crypto.randomUUID(),
                    name: nextFile.name.slice(0, 128),
                    format: nextFormat,
                    columns: parsed.columns,
                    rows: parsed.rows.slice(0, IMPORT_PREVIEW_ROWS),
                    rowCount: parsed.rows.length,
                };
            } else {
                setCloudRows([]);
                next = await post<ImportPreview>('/imports/preview', {
                    name: nextFile.name,
                    source,
                    format: nextFormat,
                });
            }
            setPreview(next);
            setStep('mapping');
            setError('');
        } catch (caught) {
            setError(importFailureMessage(caught));
        } finally {
            setBusy('');
        }
    }

    async function previewFile() {
        if (!file || !format || file.size > MAX_IMPORT_FILE_BYTES || busy) return;
        await previewSelectedFile(file, format);
    }

    async function previewSampleFile() {
        if (!browserDemoImport || busy) return;
        const sample = new File([DEMO_IMPORT_SAMPLE_CSV], 'interview-marketing-snapshot.csv', {
            type: 'text/csv',
        });
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
    recoverableJobs: ImportJob[];
    busy: BusyAction;
    browserCloudImport: boolean;
    rememberJob: (job: ImportJob) => void;
    setJob: ImportActionSetters['setJob'];
    setRecoverableJobs: ImportActionSetters['setRecoverableJobs'];
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
};

async function runConfirmUnknownImport(context: ConfirmUnknownImportContext) {
    const { job, busy, browserCloudImport, rememberJob, setBusy, setError } = context;
    if (!job || job.status !== 'unknown' || busy) return;
    setBusy('review');
    setError('');
    try {
        let checked = job;
        if (!browserCloudImport) {
            checked = job.reviewedAt
                ? await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/reconcile`)
                : await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/review`, {
                      inspected: true,
                      noActiveInsert: true,
                  });
            if (checked.status !== 'unknown') {
                rememberJob(checked);
                if (checked.status === 'succeeded')
                    advanceRecoveredQueue({ resolvedJob: checked, ...context });
                return;
            }
            if (!checked.reviewedAt) {
                rememberJob(checked);
                return;
            }
        }
        const succeeded = {
            ...checked,
            status: 'succeeded' as const,
            error: undefined,
            reviewedAt: checked.reviewedAt ?? new Date().toISOString(),
        };
        rememberJob(succeeded);
        advanceRecoveredQueue({ resolvedJob: succeeded, ...context });
    } catch (caught) {
        setError(`Could not confirm the imported rows: ${message(caught)}`);
    } finally {
        setBusy('');
    }
}

function updateRecoverableJobs(current: ImportJob[], next: ImportJob): ImportJob[] {
    if (next.status === 'succeeded' || next.reviewedAt)
        return current.filter(item => item.id !== next.id);
    if (current.some(item => item.id === next.id))
        return current.map(item => (item.id === next.id ? next : item));
    return [next, ...current];
}

export function useImportWizardController({
    open,
    connectionId,
    trusted,
    demoMode,
    onClose,
    onImported,
    onTableNeedsInspection,
}: ImportWizardControllerOptions) {
    const browserDemoImport = demoMode && isFrontendDemoPreview && connectionId === 'demo';
    const browserCloudImport =
        connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID && Boolean(getClickHouseCloudConnection());
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
    const [createTableDatabase, setCreateTableDatabase] = useState(
        () => getClickHouseCloudConnection()?.database ?? '',
    );
    const [createTableName, setCreateTableName] = useState('');
    const [createColumns, setCreateColumns] = useState<CloudImportColumn[]>([]);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [mapping, setMapping] = useState<ImportMapping>();
    const [job, setJob] = useState<ImportJob>();
    const [recoverableJobs, setRecoverableJobs] = useState<ImportJob[]>([]);
    const [pendingImport, setPendingImport] = useState<PendingImport>();
    const [recoveryState, setRecoveryState] = useState<'checking' | 'ready' | 'failed'>('checking');
    const [busy, setBusy] = useState<BusyAction>('');
    const [error, setError] = useState('');
    const [generateId, setGenerateId] = useState(true);
    const [importUnavailable, setImportUnavailable] = useState('');

    const availableTargets = useMemo(
        () =>
            targets.filter(table =>
                schema?.tables.some(item => `${item.database}.${item.name}` === table),
            ),
        [schema, targets],
    );
    const creatingTable = browserCloudImport && target === CREATE_CLOUD_TABLE_TARGET;
    const createTableAlreadyExists = Boolean(
        creatingTable &&
        schema?.tables.some(
            table => table.database === createTableDatabase && table.name === createTableName,
        ),
    );
    const destinationColumns = useMemo(
        () =>
            creatingTable
                ? createColumns.map(column => ({
                      database: createTableDatabase,
                      table: createTableName,
                      name: column.name,
                      type: `Nullable(${column.type})`,
                      defaultKind: '',
                      comment: '',
                  }))
                : writableColumns(schema, target),
        [creatingTable, createColumns, createTableDatabase, createTableName, schema, target],
    );
    const selectedFields = useMemo(
        () =>
            Object.fromEntries(
                Object.entries(fields).filter(([, destination]) => Boolean(destination)),
            ),
        [fields],
    );
    const destinationNames = Object.values(selectedFields);
    const duplicateDestinations = new Set(destinationNames).size !== destinationNames.length;
    const sampleColumns = preview?.columns.slice(0, 6) ?? [];
    const { chooseFile, previewFile, previewSampleFile } = createImportWizardFileActions({
        browserDemoImport,
        browserCloudImport,
        target,
        file,
        format,
        busy,
        setFile,
        setFormat,
        setPreview,
        setMapping,
        setFields,
        setCloudRows,
        setCreateColumns,
        setCreateTableName,
        setJob,
        setError,
        setGenerateId,
        setStep,
        setBusy,
        setTarget,
        setLastExistingTarget,
    });

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    useImportWizardRecovery({
        open,
        connectionId,
        importConnectionId,
        trusted,
        demoMode,
        browserDemoImport,
        browserCloudImport,
        setStep,
        setFile,
        setFormat,
        setPreview,
        setCloudRows,
        setSchema,
        setTargets,
        setTarget,
        setLastExistingTarget,
        setCreateTableName,
        setCreateTableDatabase,
        setCreateColumns,
        setFields,
        setMapping,
        setJob,
        setRecoverableJobs,
        setPendingImport,
        setBusy,
        setError,
        setGenerateId,
        setImportUnavailable,
        setRecoveryState,
        reportedJobRef,
        reportedInspectionRef,
        onImportedRef,
        onTableNeedsInspectionRef,
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
            advanceRecoveredQueue({
                resolvedJob: job,
                recoverableJobs,
                setJob,
                setRecoverableJobs,
                savePendingImport,
                clearPendingImport,
            });
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
        if (
            job.status !== 'unknown' ||
            !job.tableExists ||
            !job.table ||
            reportedInspectionRef.current === job.id
        )
            return;
        reportedInspectionRef.current = job.id;
        onTableNeedsInspectionRef.current(job);
    }

    function rememberJob(next: ImportJob) {
        setJob(next);
        setRecoverableJobs(current => updateRecoverableJobs(current, next));
        if (next.status === 'succeeded') reportImported(next);
        else reportDestinationNeedsInspection(next);
    }

    function savePendingImport(value: PendingImport) {
        setPendingImport(value);
        try {
            localStorage.setItem(importStateKey(importConnectionId), JSON.stringify(value));
        } catch {}
    }

    function clearPendingImport() {
        try {
            localStorage.removeItem(importStateKey(importConnectionId));
        } catch {}
        setPendingImport(undefined);
    }

    function openImportDestination() {
        if (!job || job.status !== 'unknown' || !job.tableExists || !job.table) return;
        savePendingImport({ ...pendingImportForJob(job, pendingImport), inspectionOpened: true });
        void closeWizard();
    }

    const actionSetters: ImportActionSetters = {
        setJob,
        setStep,
        setBusy,
        setError,
        setMapping,
        setTargets,
        setSchema,
        setTarget,
        setLastExistingTarget,
        setFields,
        setRecoveryState,
        setRecoverableJobs,
        setPendingImport,
        setImportUnavailable,
    };

    async function closeWizard() {
        if (!browserCloudImport && (busy || job?.status === 'running')) return;
        if (preview?.id && !browserCloudImport) {
            void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(
                () => undefined,
            );
        }
        if (
            recoveryState === 'ready' &&
            (job?.status !== 'unknown' || job.reviewedAt) &&
            (!browserCloudImport || job?.status !== 'running')
        )
            clearPendingImport();
        onClose();
    }

    function changeTarget(next: string) {
        if (next !== CREATE_CLOUD_TABLE_TARGET) setLastExistingTarget(next);
        setTarget(next);
        if (browserCloudImport && next === CREATE_CLOUD_TABLE_TARGET && preview) {
            const columns = inferCloudImportColumns(
                cloudRows.length ? cloudRows : preview.rows,
                preview.columns,
            );
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
            const next = current.map(column =>
                column.source === source
                    ? ({ ...column, [key]: value } as CloudImportColumn)
                    : column,
            );
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
        return await previewImportMapping({
            preview,
            target,
            destinationNames,
            duplicateDestinations,
            busy,
            creatingTable,
            createTableAlreadyExists,
            setError,
            createTableDatabase,
            createTableName,
            setBusy,
            browserCloudImport,
            schema,
            cloudRows,
            selectedFields,
            destinationColumns,
            importConnectionId,
            setMapping,
            setStep,
        });
    }

    async function commitImport() {
        await runCommitImport({
            mapping,
            busy,
            browserDemoImport,
            browserCloudImport,
            file,
            format,
            creatingTable,
            schema,
            createTableDatabase,
            createTableName,
            createColumns,
            generateId,
            importConnectionId,
            preview,
            ...actionSetters,
            savePendingImport,
            clearPendingImport,
            rememberJob,
        });
    }

    async function confirmUnknownImport() {
        await runConfirmUnknownImport({
            job,
            recoverableJobs,
            busy,
            browserCloudImport,
            rememberJob,
            ...actionSetters,
            savePendingImport,
            clearPendingImport,
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
        createTableAlreadyExists,
        createTableName,
        setCreateTableName,
        createTableDatabase,
        setCreateTableDatabase,
        createColumns,
        createColumnTypes: CREATE_TABLE_COLUMN_TYPES,
        updateCreateColumn,
        closeWizard,
        openImportDestination,
        forgetImport: () =>
            forgetCloudImport({
                job,
                busy,
                browserCloudImport,
                importConnectionId,
                clearPendingImport,
                chooseFile,
                ...actionSetters,
            }),
        chooseFile,
        previewFile,
        previewSampleFile,
        changeTarget,
        previewMapping,
        commitImport,
        confirmUnknownImport,
    };
}

async function previewImportMapping({
    preview,
    target,
    destinationNames,
    duplicateDestinations,
    busy,
    creatingTable,
    createTableAlreadyExists,
    setError,
    createTableDatabase,
    createTableName,
    setBusy,
    browserCloudImport,
    schema,
    cloudRows,
    selectedFields,
    destinationColumns,
    importConnectionId,
    setMapping,
    setStep,
}: {
    preview: ImportPreview | undefined;
    target: string;
    destinationNames: string[];
    duplicateDestinations: boolean;
    busy: BusyAction;
    creatingTable: boolean;
    createTableAlreadyExists: boolean;
    setError: import('react').Dispatch<import('react').SetStateAction<string>>;
    createTableDatabase: string;
    createTableName: string;
    setBusy: import('react').Dispatch<import('react').SetStateAction<BusyAction>>;
    browserCloudImport: boolean;
    schema: Schema | undefined;
    cloudRows: Record<string, Json>[];
    selectedFields: { [k: string]: string };
    destinationColumns: SchemaColumn[];
    importConnectionId: string;
    setMapping: import('react').Dispatch<import('react').SetStateAction<ImportMapping | undefined>>;
    setStep: Dispatch<SetStateAction<Step>>;
}) {
    if (!preview || !target || !destinationNames.length || duplicateDestinations || busy) return;
    if (creatingTable && createTableAlreadyExists) {
        setError(
            `Table ${createTableDatabase}.${createTableName} already exists. Choose a different name or add rows to the existing table.`,
        );
        return;
    }
    const table = creatingTable ? `${createTableDatabase}.${createTableName}` : target;
    setBusy('mapping');
    setError('');
    try {
        let next: ImportMapping;
        if (browserCloudImport) {
            const cloud = getClickHouseCloudConnection();
            if (!cloud)
                throw new Error('Reconnect to ClickHouse Cloud before reviewing the import.');
            if (creatingTable && !schema?.databases?.includes(createTableDatabase))
                throw new Error('Choose a database visible to this ClickHouse user.');
            if (creatingTable && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(createTableName))
                throw new Error('Use letters, numbers, and underscores for the new table name.');
            const sourceRows = cloudRows.length ? cloudRows : preview.rows;
            const mapped = mapImportRows(
                sourceRows,
                preview.columns,
                selectedFields,
                destinationColumns,
            );
            next = {
                id: crypto.randomUUID(),
                deduplicationToken: crypto.randomUUID(),
                inputId: preview.id,
                connectionId: importConnectionId,
                table,
                fields: selectedFields,
                rows: mapped.rows,
                rowCount: sourceRows.length,
                missingFields: mapped.missingFields,
            };
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
        setError(importFailureMessage(caught));
    } finally {
        setBusy('');
    }
}
