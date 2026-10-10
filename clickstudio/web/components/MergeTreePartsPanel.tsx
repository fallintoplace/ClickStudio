import { useEffect, useMemo, useState } from 'react';
import type { Connection, SchemaTable } from '../../shared/types';
import type { Copy } from '../i18n';
import { StorageExplorer } from './StorageExplorer';

export function MergeTreePartsPanel({
    connection,
    copy,
    tables,
    schemaLoading,
    trusted,
    active,
}: {
    connection: Pick<Connection, 'id' | 'dataSource'>;
    copy: Copy['common'];
    tables: SchemaTable[];
    schemaLoading: boolean;
    trusted: boolean;
    active: boolean;
}) {
    const mergeTreeTables = useMemo(
        () => tables.filter(table => table.engine.endsWith('MergeTree')),
        [tables],
    );
    const [selectedTableKey, setSelectedTableKey] = useState('');
    const [hasVisited, setHasVisited] = useState(false);
    const selectedTable =
        mergeTreeTables.find(table => `${table.database}.${table.name}` === selectedTableKey) ??
        mergeTreeTables[0];
    const showExplorer = active || hasVisited;

    useEffect(() => {
        if (active) setHasVisited(true);
    }, [active]);

    useEffect(() => {
        if (
            !selectedTable ||
            !mergeTreeTables.some(table => `${table.database}.${table.name}` === selectedTableKey)
        )
            setSelectedTableKey(
                selectedTable ? `${selectedTable.database}.${selectedTable.name}` : '',
            );
    }, [mergeTreeTables, selectedTable, selectedTableKey]);

    return (
        <div className="help-parts-browser">
            <div className="help-parts-browser-toolbar">
                <div className="help-parts-browser-title">
                    <span className="eyebrow">{copy.helpFeatureLabel}</span>
                    <strong>{copy.helpPartsTitle}</strong>
                </div>
                <label className="help-parts-table-picker">
                    <span className="eyebrow">{copy.helpSelectMergeTreeTable}</span>
                    <select
                        aria-label={copy.helpSelectMergeTreeTable}
                        value={
                            selectedTable ? `${selectedTable.database}.${selectedTable.name}` : ''
                        }
                        onChange={event => setSelectedTableKey(event.target.value)}
                        disabled={!trusted || schemaLoading || !mergeTreeTables.length}
                    >
                        {schemaLoading && <option value="">{copy.helpLoadingTables}</option>}
                        {!schemaLoading && !mergeTreeTables.length && (
                            <option value="">{copy.helpNoMergeTreeTables}</option>
                        )}
                        {mergeTreeTables.map(table => (
                            <option
                                key={`${table.database}.${table.name}`}
                                value={`${table.database}.${table.name}`}
                            >
                                {table.database}.{table.name}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {!trusted && <p className="help-parts-access-note">{copy.helpPartsRequiresTrust}</p>}
            {trusted && schemaLoading && (
                <p className="help-parts-empty" role="status">
                    {copy.helpLoadingTables}
                </p>
            )}
            {trusted && showExplorer && !schemaLoading && selectedTable && (
                <StorageExplorer
                    embedded
                    active={active}
                    connection={connection}
                    table={selectedTable}
                    copy={copy}
                />
            )}
            {trusted && !schemaLoading && !selectedTable && (
                <p className="help-parts-empty" role="status">
                    {copy.helpNoMergeTreeTables}
                </p>
            )}
        </div>
    );
}
