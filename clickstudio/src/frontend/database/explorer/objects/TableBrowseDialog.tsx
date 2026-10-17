import { useEffect, useRef, useState } from 'react';
import type { SchemaColumn, SchemaTable } from '../../../../shared/database/schema/types';
import type { Connected } from '../../../workspace/workspace-types';
import type { OpenSqlDraft } from '../../../queries/execution/sql-draft-observer';
import {
    BROWSE_PAGE_ROWS,
    BROWSE_PAGE_COLUMNS,
    MAX_BROWSE_PAGE,
    browseColumnSupported,
    isTableBrowsePage,
    tableBrowseDraftSql,
    type TableBrowseRequest,
    type TableBrowsePage,
} from '../../../../shared/database/browse/table-browse';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../../shared/database/connections/cloud-policy';
import { browseClickHouseCloudTable } from '../../connections/cloud-connection';
import { post, message } from '../../../api/client';
import { previewResultCell } from '../../../../shared/queries/results/results';
import { useDialogFocus } from '../../../ui/focus/useDialogFocus';
import { Button } from '../../../ui/components/primitives';
import { CellInspector, type InspectedCell } from '../../../queries/results/CellInspector';

function browseStatus(error: string, loading: boolean, result?: TableBrowsePage) {
    if (error) return error;
    if (loading) return 'Loading table page…';
    if (!result) return 'No page loaded';
    if (result.rows.length === 0) return 'No matching rows on this page';
    const first = result.page * BROWSE_PAGE_ROWS + 1;
    const last = result.page * BROWSE_PAGE_ROWS + result.rows.length;
    const suffix = result.hasMore ? ' · More available' : ' · End of result';
    return 'Rows ' + first.toLocaleString() + '-' + last.toLocaleString() + suffix;
}

function BrowsePageRows({
    result,
    onInspectCell,
}: {
    result?: TableBrowsePage;
    onInspectCell: (cell: InspectedCell) => void;
}) {
    if (!result) return null;
    const visible = result.columns;
    return (
        <div
            className="table-browse-data-scroll"
            role="region"
            tabIndex={0}
            aria-label="Browsed table rows"
        >
            <table className="data-table" aria-label="Live table page">
                <thead>
                    <tr>
                        <th scope="col">#</th>
                        {visible.map((column, i) => (
                            <th scope="col" key={result.columnStart + i}>
                                {column.name}
                                <small className="result-type-badge">{column.type}</small>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            <td>{result.page * BROWSE_PAGE_ROWS + rowIndex + 1}</td>
                            {visible.map((column, columnIndex) => {
                                const idx = result.columnStart + columnIndex;
                                return (
                                    <td key={idx}>
                                        <button
                                            className="result-cell-trigger"
                                            type="button"
                                            title={previewResultCell(row[columnIndex])}
                                            onClick={() =>
                                                onInspectCell({
                                                    columnName: column.name,
                                                    columnType: column.type,
                                                    columnIndex: idx,
                                                    rowNumber:
                                                        result.page * BROWSE_PAGE_ROWS +
                                                        rowIndex +
                                                        1,
                                                    value: row[columnIndex],
                                                })
                                            }
                                        >
                                            {previewResultCell(row[columnIndex])}
                                        </button>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
            {result.rows.length === 0 && <p>No rows match this filter.</p>}
        </div>
    );
}

export function TableBrowseDialog({
    table,
    columns,
    connection,
    onClose,
    onOpenSqlDraft,
}: {
    table: SchemaTable;
    columns: readonly SchemaColumn[];
    connection: Connected;
    onClose: () => void;
    onOpenSqlDraft: OpenSqlDraft;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const sortable = columns.filter(column => browseColumnSupported(column.type));
    const [orderColumn, setOrderColumn] = useState(sortable[0]?.name ?? '');
    const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
    const [filterColumn, setFilterColumn] = useState('');
    const [filterValue, setFilterValue] = useState('');
    const [request, setRequest] = useState<TableBrowseRequest | undefined>(
        sortable.length
            ? {
                  database: table.database,
                  table: table.name,
                  orderColumn: sortable[0]!.name,
                  direction: 'asc',
                  page: 0,
                  columnStart: 0,
              }
            : undefined,
    );
    const [result, setResult] = useState<TableBrowsePage>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [totalColumns, setTotalColumns] = useState(columns.length);
    const [inspectedCell, setInspectedCell] = useState<InspectedCell>();
    const [pending, setPending] = useState(false);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        return () => element.close();
    }, []);
    useDialogFocus(dialog, { onClose, initialFocus: () => closeButton.current });

    useEffect(() => {
        if (!request) return;
        const controller = new AbortController();
        let current = true;
        setResult(undefined);
        setError('');
        setLoading(true);
        const promise =
            connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID
                ? browseClickHouseCloudTable(request, controller.signal)
                : post(
                      '/browse/table',
                      { ...request, connectionId: connection.id },
                      isTableBrowsePage,
                      { signal: controller.signal },
                  );
        void promise
            .then(page => {
                if (current) {
                    setResult(page);
                    setTotalColumns(page.totalColumns);
                }
            })
            .catch(caught => {
                if (current) setError(message(caught));
            })
            .finally(() => {
                if (current) setLoading(false);
            });
        return () => {
            current = false;
            controller.abort();
        };
    }, [connection.id, request]);

    const apply = () => {
        if (!orderColumn) return;
        setInspectedCell(undefined);
        setRequest({
            database: table.database,
            table: table.name,
            orderColumn,
            direction,
            page: 0,
            columnStart: 0,
            ...(filterColumn ? { filterColumn, filterValue } : {}),
        });
        setPending(false);
    };
    const move = (next: number) => {
        if (!request || next < 0 || next > MAX_BROWSE_PAGE) return;
        setInspectedCell(undefined);
        setRequest({ ...request, page: next });
    };
    const moveColumns = (next: number) => {
        if (!request || loading || next < 0 || next >= totalColumns) return;
        setInspectedCell(undefined);
        setRequest({ ...request, columnStart: next });
    };
    const openSql = () => {
        if (!request) return;
        onOpenSqlDraft(
            'Browse ' + table.name + '.sql',
            result?.draftSql ?? tableBrowseDraftSql(request, columns),
            false,
        );
        onClose();
    };
    const eligible = sortable.length > 0;
    const isLastPage = request?.page === MAX_BROWSE_PAGE;
    const columnStart = request?.columnStart ?? 0;
    return (
        <dialog
            ref={dialog}
            className="transfer-dialog table-browse-dialog"
            aria-labelledby="table-browse-title"
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
            onClick={event => {
                if (event.target === dialog.current) onClose();
            }}
        >
            <header className="transfer-dialog-header">
                <div>
                    <h2 id="table-browse-title" className="transfer-dialog-title">
                        Browse {table.database}.{table.name}
                    </h2>
                    <p className="transfer-dialog-description">
                        Live table · Small, read-only pages · Not an immutable snapshot
                    </p>
                </div>
                <button
                    type="button"
                    className="button-base button-ghost"
                    aria-label="Close table browser"
                    ref={closeButton}
                    onClick={onClose}
                >
                    Close
                </button>
            </header>
            {eligible ? (
                <div className="table-browse-controls">
                    <label>
                        Sort by
                        <select
                            aria-label="Browse sort column"
                            value={orderColumn}
                            onChange={event => {
                                setOrderColumn(event.target.value);
                                setPending(true);
                            }}
                        >
                            {sortable.map(column => (
                                <option key={column.name} value={column.name}>
                                    {column.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Direction
                        <select
                            aria-label="Browse sort direction"
                            value={direction}
                            onChange={event => {
                                setDirection(event.target.value === 'desc' ? 'desc' : 'asc');
                                setPending(true);
                            }}
                        >
                            <option value="asc">Ascending</option>
                            <option value="desc">Descending</option>
                        </select>
                    </label>
                    <label>
                        Filter column
                        <select
                            aria-label="Browse filter column"
                            value={filterColumn}
                            onChange={event => {
                                setFilterColumn(event.target.value);
                                setPending(true);
                            }}
                        >
                            <option value="">No filter</option>
                            {sortable.map(column => (
                                <option key={column.name} value={column.name}>
                                    {column.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Exact value
                        <input
                            aria-label="Browse filter value"
                            type="text"
                            maxLength={256}
                            value={filterValue}
                            disabled={!filterColumn}
                            onChange={event => {
                                setFilterValue(event.target.value);
                                setPending(true);
                            }}
                        />
                    </label>
                    <Button variant="primary" onClick={apply} disabled={!pending}>
                        Apply
                    </Button>
                </div>
            ) : (
                <p role="status">No scalar columns are available for ordered table browsing.</p>
            )}
            <p className="table-browse-warning">
                Sorting and exact-value filtering run new SQL on ClickHouse. Pages are limited to{' '}
                {MAX_BROWSE_PAGE + 1}. Duplicate sort values or concurrent table changes may cause
                overlapping or missing rows. This is not a consistent snapshot. Deep pages may be
                slow.
            </p>
            <div className="table-browse-actions">
                <span role="status">{browseStatus(error, loading, result)}</span>
                <Button
                    variant="secondary"
                    onClick={openSql}
                    disabled={!request || (!result && columnStart >= columns.length)}
                >
                    Open as SQL
                </Button>
            </div>
            {eligible && totalColumns > BROWSE_PAGE_COLUMNS && (
                <div className="table-browse-column-nav">
                    <span>
                        Columns {columnStart + 1}-
                        {Math.min(totalColumns, columnStart + BROWSE_PAGE_COLUMNS)}
                        of {totalColumns}
                    </span>
                    <Button
                        variant="ghost"
                        disabled={loading || columnStart === 0}
                        onClick={() => moveColumns(Math.max(0, columnStart - BROWSE_PAGE_COLUMNS))}
                    >
                        Previous columns
                    </Button>
                    <Button
                        variant="ghost"
                        disabled={loading || columnStart + BROWSE_PAGE_COLUMNS >= totalColumns}
                        onClick={() => moveColumns(columnStart + BROWSE_PAGE_COLUMNS)}
                    >
                        Next columns
                    </Button>
                </div>
            )}
            <BrowsePageRows result={result} onInspectCell={setInspectedCell} />
            <footer className="table-browse-pages">
                <span>
                    Page {(request?.page ?? 0) + 1} of at most {MAX_BROWSE_PAGE + 1}
                </span>
                <Button
                    variant="secondary"
                    disabled={loading || !request || request.page === 0}
                    onClick={() => move((request?.page ?? 0) - 1)}
                >
                    Previous page
                </Button>
                <Button
                    variant="secondary"
                    disabled={loading || !result?.hasMore || isLastPage}
                    onClick={() => move((request?.page ?? 0) + 1)}
                >
                    Next page
                </Button>
            </footer>
            {inspectedCell && (
                <CellInspector cell={inspectedCell} onClose={() => setInspectedCell(undefined)} />
            )}
        </dialog>
    );
}
