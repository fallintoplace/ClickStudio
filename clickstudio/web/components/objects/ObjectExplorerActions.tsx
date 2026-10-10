import { Button, Icon } from '../ui';
import type { ObjectExplorerProps } from './object-explorer-types';
import type { ObjectExplorerView } from './useObjectExplorerState';

export function ObjectExplorerActions({
    selectedTable,
    connection,
    trusted,
    copy,
    setCreateTableOpen,
    insertableTable,
    setInsertRowTarget,
    deletableTable,
    setDeleteTableTarget,
}: {
    selectedTable: ObjectExplorerView['selectedTable'];
    connection: ObjectExplorerProps['connection'];
    trusted: ObjectExplorerProps['trusted'];
    copy: ObjectExplorerProps['copy'];
    setCreateTableOpen: ObjectExplorerView['setCreateTableOpen'];
    insertableTable: ObjectExplorerView['insertableTable'];
    setInsertRowTarget: ObjectExplorerView['setInsertRowTarget'];
    deletableTable: ObjectExplorerView['deletableTable'];
    setDeleteTableTarget: ObjectExplorerView['setDeleteTableTarget'];
}) {
    return (
        <div
            className="object-explorer-action-bar"
            role="group"
            aria-label={
                selectedTable
                    ? `Actions for ${selectedTable.table.database}.${selectedTable.table.name}`
                    : 'Table actions'
            }
        >
            {connection.dataSource !== 'fixture' && (
                <Button
                    variant="secondary"
                    className="toolbar-small object-create-table-action"
                    disabled={!trusted}
                    title={!trusted ? copy.runActionTrustRequired : undefined}
                    onClick={() => setCreateTableOpen(true)}
                >
                    <Icon name="table" />
                    {copy.newTable}
                </Button>
            )}
            {connection.dataSource !== 'fixture' && insertableTable && (
                <Button
                    variant="secondary"
                    className="toolbar-small"
                    disabled={!trusted}
                    title={!trusted ? copy.runActionTrustRequired : undefined}
                    onClick={() =>
                        setInsertRowTarget({
                            table: insertableTable.table,
                            columns: insertableTable.columns,
                        })
                    }
                >
                    <Icon name="plus" />
                    {copy.insertRow}
                </Button>
            )}
            {connection.dataSource !== 'fixture' && deletableTable && (
                <Button
                    variant="danger"
                    className="toolbar-small object-delete-table-action"
                    disabled={!trusted}
                    title={!trusted ? copy.runActionTrustRequired : undefined}
                    onClick={() => setDeleteTableTarget(deletableTable)}
                >
                    <Icon name="trash" />
                    {copy.deleteTable}
                </Button>
            )}
            {selectedTable && (
                <span
                    className="object-action-context"
                    title={`${selectedTable.table.database}.${selectedTable.table.name}`}
                >
                    <span>Selected</span>
                    <code>
                        {selectedTable.table.database}.{selectedTable.table.name}
                    </code>
                </span>
            )}
        </div>
    );
}

export function ObjectExplorerSearch({
    search,
    changeSearch,
    copy,
}: {
    search: ObjectExplorerProps['search'];
    changeSearch: (value: string) => void;
    copy: ObjectExplorerProps['copy'];
}) {
    return (
        <div className="inspector-search object-search">
            <Icon name="search" />
            <input
                data-testid="schema-search"
                value={search}
                onChange={event => changeSearch(event.target.value)}
                placeholder={copy.objectSearch}
                aria-label={copy.objectSearch}
            />
            {search && (
                <button
                    type="button"
                    className="object-search-clear"
                    aria-label="Clear object search"
                    onClick={() => changeSearch('')}
                >
                    ×
                </button>
            )}
        </div>
    );
}
