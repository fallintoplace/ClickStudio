import type { Schema, SchemaTable } from '../../../shared/types';
import type { Connected, ImportedTableTarget } from '../../workspace-types';
import type { Copy } from '../../i18n';

export type ObjectExplorerProps = {
    copy: Copy['common'];
    connection: Connected;
    expert: boolean;
    schema?: Schema;
    schemaLoading: boolean;
    schemaLoadingMore?: boolean;
    schemaError: string;
    search: string;
    setSearch: (search: string) => void;
    trusted: boolean;
    onRefreshSchema: () => void;
    onLoadMoreSchema?: () => void;
    importedTableTarget?: ImportedTableTarget;
    onImportedTableRevealed: (target: ImportedTableTarget) => void;
    onInsert: (value: string) => void;
    onOpenSqlDraft: (name: string, sql: string, run: boolean, reuseExisting?: boolean) => void;
    onTableDeleted: (table: Pick<SchemaTable, 'database' | 'name'>) => void;
    onOpenReference: (name: string, type: string) => void;
    compact?: boolean;
};
