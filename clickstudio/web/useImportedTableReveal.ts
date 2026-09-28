import { useCallback, useRef, useState } from 'react';
import type { Schema } from '../shared/types';
import type { ImportJob } from './components/import-wizard-model';
import { isFrontendDemoPreview } from './api';
import type { ImportedTableTarget, Inspector } from './workspace-types';

type Options = {
    connectionId: string;
    demoMode: boolean;
    loadSchema: (refresh?: boolean) => Promise<Schema | undefined>;
    setSearch: (search: string) => void;
    showInspector: (inspector: Inspector) => void;
    setNotice: (notice: string) => void;
};

export function useImportedTableReveal({ connectionId, demoMode, loadSchema, setSearch, showInspector, setNotice }: Options) {
    const [importedTableTarget, setImportedTableTarget] = useState<ImportedTableTarget>();
    const latestImportIdRef = useRef<string | undefined>(undefined);

    const onImported = useCallback((job: ImportJob) => {
        if (demoMode && isFrontendDemoPreview && connectionId === 'demo') {
            setNotice('Interview rows saved in this browser. Switch to Sample data and query demo.interview_imports.');
            return;
        }

        latestImportIdRef.current = job.id;
        setSearch('');
        setImportedTableTarget({ id: job.id, table: job.table, rows: job.rows });
        showInspector('schema');
        setNotice(`Import complete. Refreshing the table list for ${job.table}…`);
        void loadSchema(true).then(refreshedSchema => {
            if (latestImportIdRef.current !== job.id) return;
            if (!refreshedSchema?.tables.some(table => `${table.database}.${table.name}` === job.table))
                setNotice(`Import succeeded, but ${job.table} is not in the table list yet. Use Refresh to try again.`);
        });
    }, [connectionId, demoMode, loadSchema, setNotice, setSearch, showInspector]);

    const onImportedTableRevealed = useCallback((target: ImportedTableTarget) => {
        if (latestImportIdRef.current !== target.id) return;
        latestImportIdRef.current = undefined;
        setImportedTableTarget(current => current?.id === target.id ? undefined : current);
        setNotice(`Imported ${target.rows.toLocaleString()} ${target.rows === 1 ? 'row' : 'rows'} into ${target.table}. The table is selected in Objects.`);
    }, [setNotice]);

    return { importedTableTarget, onImported, onImportedTableRevealed };
}
