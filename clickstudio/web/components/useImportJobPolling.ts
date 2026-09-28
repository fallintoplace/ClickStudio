import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { api, message, post } from '../api';
import { checkClickHouseCloudImport } from '../cloud-connection';
import type { BusyAction, ImportJob, Step } from './import-wizard-model';

export function useImportJobPolling({
    open,
    step,
    job,
    setJob,
    setRecoverableJobs,
    setBusy,
    setError,
    onSucceeded,
    onNeedsInspection,
    cloudImport = false,
}: {
    open: boolean;
    step: Step;
    job?: ImportJob;
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    setRecoverableJobs: Dispatch<SetStateAction<ImportJob[]>>;
    setBusy: Dispatch<SetStateAction<BusyAction>>;
    setError: Dispatch<SetStateAction<string>>;
    onSucceeded: (job: ImportJob) => void;
    onNeedsInspection: (job: ImportJob) => void;
    cloudImport?: boolean;
}) {
    const onSucceededRef = useRef(onSucceeded);
    const onNeedsInspectionRef = useRef(onNeedsInspection);
    onSucceededRef.current = onSucceeded;
    onNeedsInspectionRef.current = onNeedsInspection;

    useEffect(() => {
        if (!open || step !== 'status' || job?.status !== 'running') return;
        let current = true;
        let polling = false;
        const poll = async () => {
            if (polling) return;
            polling = true;
            try {
                const next = cloudImport && job.queryId
                    ? await checkClickHouseCloudImport(job.queryId, job.table, job.rows)
                    : job.reconciliationRequired
                        ? await post<ImportJob>(`/imports/${encodeURIComponent(job.id)}/reconcile`)
                        : await api<ImportJob>(`/imports/${encodeURIComponent(job.id)}`);
                if (!current) return;
                setJob(next);
                setRecoverableJobs(items => next.status === 'succeeded' || next.reviewedAt
                    ? items.filter(item => item.id !== next.id)
                    : items.map(item => item.id === next.id ? next : item));
                setBusy('');
                if (next.status === 'succeeded') onSucceededRef.current(next);
                else if (next.status === 'unknown' && next.tableExists) onNeedsInspectionRef.current(next);
            } catch (caught) {
                if (current) setError(`Could not refresh import status: ${message(caught)}`);
            } finally {
                polling = false;
            }
        };
        const timer = window.setInterval(() => void poll(), job.reconciliationRequired ? 1500 : 900);
        return () => {
            current = false;
            window.clearInterval(timer);
        };
    }, [open, step, cloudImport, job?.id, job?.queryId, job?.table, job?.rows, job?.status, job?.reconciliationRequired, setBusy, setError, setJob, setRecoverableJobs]);
}
