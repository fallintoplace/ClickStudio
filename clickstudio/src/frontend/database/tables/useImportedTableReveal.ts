import { useCallback, useRef, useState } from 'react';
import { lexSql } from '../../../shared/sql/sql';
import type { Schema } from '../../../shared/database/schema/types';
import type { Script } from '../../../shared/queries/execution/types';
import type { ImportJob } from '../imports/state/import-wizard-model';
import { isFrontendDemoPreview } from '../../common/requests/api';
import type { WorkspaceFeedback } from '../../workspace/layout/notifications/useWorkspaceNotifications';
import type { ImportedTableTarget, Inspector } from '../../workspace/workspace-types';

type Options = {
    connectionId: string;
    demoMode: boolean;
    canRevealSqlTables: boolean;
    loadSchema: (refresh?: boolean) => Promise<Schema | undefined>;
    setSearch: (search: string) => void;
    setInspector: (inspector: Inspector) => void;
    setDrawerOpen: (open: boolean) => void;
    openInspectorDrawer: boolean;
};

export function isSchemaChangingSql(sql: string) {
    try {
        const firstWord = lexSql(sql)
            .find(token => token.kind === 'word')
            ?.text.toUpperCase();
        return (
            firstWord === 'CREATE' ||
            firstWord === 'ALTER' ||
            firstWord === 'DROP' ||
            firstWord === 'RENAME'
        );
    } catch {
        return false;
    }
}

function tableNames(schema: Schema) {
    return new Set(schema.tables.map(table => `${table.database}.${table.name}`));
}

function firstNewTable(schema: Schema | undefined, previousTableNames: ReadonlySet<string>) {
    return schema?.tables.find(table => !previousTableNames.has(`${table.database}.${table.name}`));
}

export function useImportedTableReveal({
    connectionId,
    demoMode,
    canRevealSqlTables,
    loadSchema,
    setSearch,
    setInspector,
    setDrawerOpen,
    openInspectorDrawer,
}: Options) {
    const [importFeedback, setImportFeedback] = useState<WorkspaceFeedback>();
    const [importedTableTarget, setImportedTableTarget] = useState<ImportedTableTarget>();
    const latestImportIdRef = useRef<string | undefined>(undefined);
    const importedSqlDraftIdsRef = useRef(new Set<string>());
    const importedSqlScriptBaselinesRef = useRef(new Map<string, ReadonlySet<string>>());

    const revealInspector = useCallback(() => {
        setInspector('schema');
        if (openInspectorDrawer) setDrawerOpen(true);
    }, [openInspectorDrawer, setDrawerOpen, setInspector]);

    const onImportedSqlTableCreated = useCallback(
        (id: string, table: string) => {
            latestImportIdRef.current = id;
            setSearch('');
            setImportedTableTarget({ id, table, source: 'sql' });
            revealInspector();
        },
        [revealInspector, setSearch],
    );

    const markImportedSqlDraft = useCallback((id: string) => {
        importedSqlDraftIdsRef.current.add(id);
    }, []);

    const captureImportedSqlBaseline = useCallback(
        async (draftId: string, schemaChanges: boolean) => {
            if (
                !schemaChanges ||
                !canRevealSqlTables ||
                !importedSqlDraftIdsRef.current.has(draftId)
            )
                return undefined;
            const before = await loadSchema(true);
            return before ? tableNames(before) : undefined;
        },
        [canRevealSqlTables, loadSchema],
    );

    const rememberImportedSqlScript = useCallback(
        (draftId: string, scriptId: string, baseline?: ReadonlySet<string>) => {
            if (!baseline) return;
            importedSqlDraftIdsRef.current.delete(draftId);
            importedSqlScriptBaselinesRef.current.set(scriptId, baseline);
        },
        [],
    );

    const refreshAfterImportedSqlRun = useCallback(
        (draftId: string, runId: string, baseline?: ReadonlySet<string>) => {
            const refresh = loadSchema(true);
            if (!baseline) return;
            importedSqlDraftIdsRef.current.delete(draftId);
            void refresh.then(schema => {
                const table = firstNewTable(schema, baseline);
                if (table)
                    onImportedSqlTableCreated(`sql:${runId}`, `${table.database}.${table.name}`);
            });
        },
        [loadSchema, onImportedSqlTableCreated],
    );

    const refreshAfterImportedSqlScript = useCallback(
        (script: Script) => {
            if (script.connectionId !== connectionId || !canRevealSqlTables) return;
            const baseline = importedSqlScriptBaselinesRef.current.get(script.id);
            importedSqlScriptBaselinesRef.current.delete(script.id);
            if (
                !script.statements.some(
                    statement =>
                        (statement.status === 'succeeded' || statement.status === 'truncated') &&
                        isSchemaChangingSql(statement.sql),
                )
            )
                return;
            const refresh = loadSchema(true);
            if (baseline)
                void refresh.then(schema => {
                    const table = firstNewTable(schema, baseline);
                    if (table)
                        onImportedSqlTableCreated(
                            `sql:${script.id}`,
                            `${table.database}.${table.name}`,
                        );
                });
        },
        [canRevealSqlTables, connectionId, loadSchema, onImportedSqlTableCreated],
    );

    const onImported = useCallback(
        (job: ImportJob) => {
            if (demoMode && isFrontendDemoPreview && connectionId === 'demo') {
                return;
            }

            latestImportIdRef.current = job.id;
            setSearch('');
            setImportedTableTarget({
                id: job.id,
                table: job.table,
                rows: job.rows,
                source: 'rows',
            });
            revealInspector();
            setImportFeedback(undefined);
            void loadSchema(true).then(refreshedSchema => {
                if (latestImportIdRef.current !== job.id) return;
                if (
                    !refreshedSchema?.tables.some(
                        table => `${table.database}.${table.name}` === job.table,
                    )
                )
                    setImportFeedback({
                        tone: 'warning',
                        message: `Import completed. Refresh Objects to find “${job.table}”.`,
                    });
            });
        },
        [connectionId, demoMode, loadSchema, revealInspector, setSearch],
    );

    const onUnconfirmedDestination = useCallback(
        (job: ImportJob) => {
            if (job.status !== 'unknown' || !job.tableExists || !job.table) return;
            latestImportIdRef.current = job.id;
            setSearch('');
            setImportedTableTarget({ id: job.id, table: job.table, source: 'partial' });
            revealInspector();
            setImportFeedback({
                tone: 'warning',
                message: `Import not confirmed. Check the rows in “${job.table}” before importing again.`,
            });
            void loadSchema(true);
        },
        [loadSchema, revealInspector, setSearch],
    );

    const onImportedTableRevealed = useCallback((target: ImportedTableTarget) => {
        if (latestImportIdRef.current !== target.id) return;
        latestImportIdRef.current = undefined;
        setImportedTableTarget(current => (current?.id === target.id ? undefined : current));
        if (target.source !== 'partial') setImportFeedback(undefined);
    }, []);

    return {
        importedTableTarget,
        importFeedback,
        onImported,
        onUnconfirmedDestination,
        onImportedTableRevealed,
        onImportedSqlTableCreated,
        markImportedSqlDraft,
        captureImportedSqlBaseline,
        rememberImportedSqlScript,
        refreshAfterImportedSqlRun,
        refreshAfterImportedSqlScript,
    };
}
