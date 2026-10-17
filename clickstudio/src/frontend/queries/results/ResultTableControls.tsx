import { useEffect, useId, useState, type RefObject } from 'react';
import { Button, cx } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';
import { useResultControlsDock } from './useResultControlsDock';
import type { Column } from '../../../shared/common/values';

function ResultPagination({
    pageIndex,
    pageCount,
    loading,
    onPage,
    pageInput,
}: {
    pageIndex: number;
    pageCount: number;
    loading: boolean;
    onPage: (page: number) => void;
    pageInput: RefObject<HTMLInputElement | null>;
}) {
    const [jump, setJump] = useState(String(pageIndex + 1));
    const [previousPage, setPreviousPage] = useState(pageIndex);
    if (previousPage !== pageIndex) {
        setPreviousPage(pageIndex);
        setJump(String(pageIndex + 1));
    }
    return (
        <>
            <nav className="result-pagination" aria-label="Result pagination">
                <Button
                    variant="ghost"
                    aria-label="First page"
                    title="First page"
                    disabled={loading || pageIndex === 0}
                    onClick={() => onPage(0)}
                >
                    <Icon name="firstPage" />
                </Button>
                <Button
                    variant="ghost"
                    aria-label="Previous page"
                    title="Previous page"
                    disabled={loading || pageIndex === 0}
                    onClick={() => onPage(pageIndex - 1)}
                >
                    <Icon name="previousPage" />
                </Button>
                <span className="result-page-status" role="status" aria-live="polite">
                    Page {pageIndex + 1} of {pageCount}
                </span>
                <Button
                    variant="ghost"
                    aria-label="Next page"
                    title="Next page"
                    disabled={loading || pageIndex + 1 >= pageCount}
                    onClick={() => onPage(pageIndex + 1)}
                >
                    <Icon name="nextPage" />
                </Button>
                <Button
                    variant="ghost"
                    aria-label="Last page"
                    title="Last page"
                    disabled={loading || pageIndex + 1 >= pageCount}
                    onClick={() => onPage(pageCount - 1)}
                >
                    <Icon name="lastPage" />
                </Button>
            </nav>
            <form
                className="result-page-jump"
                onSubmit={event => {
                    event.preventDefault();
                    const next = Number(jump);
                    if (Number.isInteger(next) && next >= 1 && next <= pageCount && !loading)
                        onPage(next - 1);
                }}
            >
                <label>
                    Go to page
                    <input
                        ref={pageInput}
                        type="number"
                        min={1}
                        max={pageCount}
                        step={1}
                        required
                        value={jump}
                        disabled={loading}
                        onChange={event => setJump(event.target.value)}
                    />
                </label>
                <Button type="submit" disabled={loading}>
                    Go
                </Button>
            </form>
        </>
    );
}

export function ResultTableControls({
    filter,
    onFilter,
    matchingCount,
    pageRows,
    pageIndex,
    pageCount,
    retainedRange,
    loading,
    onPage,
    columns,
    hiddenColumns,
    pinnedColumns,
    columnSearch,
    onColumnSearch,
    onToggleColumn,
    onTogglePinned,
    onRestoreColumns,
    selectionMode,
    onToggleSelection,
}: {
    filter: string;
    onFilter: (filter: string) => void;
    matchingCount: number;
    pageRows: number;
    pageIndex: number;
    pageCount: number;
    retainedRange: string;
    loading: boolean;
    onPage: (page: number) => void;
    columns: Column[];
    hiddenColumns: Set<number>;
    pinnedColumns: Set<number>;
    columnSearch: string;
    onColumnSearch: (search: string) => void;
    onToggleColumn: (index: number) => void;
    onTogglePinned: (index: number) => void;
    onRestoreColumns: () => void;
    selectionMode: boolean;
    onToggleSelection: () => void;
}) {
    const id = useId();
    const dock = useResultControlsDock();
    useEffect(() => {
        if (dock.open && dock.target === 'columns')
            dock.columns.current?.focus({ preventScroll: true });
    }, [dock.columns, dock.open, dock.target]);
    const visibleColumnCount = columns.length - hiddenColumns.size;
    const panelName = dock.target === 'columns' ? 'columns' : 'search and pages';
    const duplicateCounts = new Map<string, number>();
    for (const column of columns)
        duplicateCounts.set(column.name, (duplicateCounts.get(column.name) ?? 0) + 1);
    const matchingColumns = columns.flatMap((column, index) =>
        `${column.name}\n${column.type}`
            .toLocaleLowerCase()
            .includes(columnSearch.toLocaleLowerCase())
            ? [{ column, index }]
            : [],
    );
    return (
        <div className="result-table-controls" ref={dock.anchor}>
            <button
                type="button"
                className={cx('result-search-toggle', filter && 'is-active')}
                aria-label="Search rows"
                aria-description={filter ? `Search active: ${filter}` : undefined}
                aria-expanded={dock.open && dock.target === 'search'}
                aria-haspopup="dialog"
                aria-controls={id}
                title={filter ? `Search active: ${filter}` : 'Search this page'}
                onClick={event => dock.show('search', event.currentTarget)}
            >
                <Icon name="search" />
                {filter && <span className="result-search-active" aria-label="Search active" />}
            </button>
            {pageCount > 1 && (
                <button
                    type="button"
                    className="result-pages-toggle"
                    aria-label={`Pages: Page ${pageIndex + 1} of ${pageCount}`}
                    aria-haspopup="dialog"
                    aria-controls={id}
                    aria-expanded={dock.open && dock.target === 'page'}
                    title={`Page ${pageIndex + 1} of ${pageCount}`}
                    onClick={event => dock.show('page', event.currentTarget)}
                >
                    {pageIndex + 1}/{pageCount} <Icon name="chevron" />
                </button>
            )}
            {columns.length > 0 && (
                <button
                    type="button"
                    className={cx('result-columns-toggle', hiddenColumns.size > 0 && 'is-active')}
                    aria-label={`Columns: ${visibleColumnCount} of ${columns.length} shown`}
                    aria-haspopup="dialog"
                    aria-controls={id}
                    aria-expanded={dock.open && dock.target === 'columns'}
                    title="Search, hide, and pin columns"
                    onClick={event => dock.show('columns', event.currentTarget)}
                >
                    <Icon name="column" />
                </button>
            )}
            <div
                ref={dock.panel}
                id={id}
                className="result-controls-panel"
                popover="manual"
                role="dialog"
                aria-label={dock.target === 'columns' ? 'Manage columns' : 'Search & pages'}
                aria-busy={loading || undefined}
                data-pinned={dock.pinned || undefined}
            >
                <div className="result-controls-heading">
                    <strong>{dock.target === 'columns' ? 'Columns' : 'Search & pages'}</strong>
                    {dock.pinned && (
                        <Button
                            variant="ghost"
                            className="result-controls-move"
                            aria-label={`Move ${panelName}`}
                            title={`Drag to move ${panelName}. Use arrow keys to move; Shift moves faster.`}
                            {...dock.moveHandle}
                        >
                            <Icon name="move" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        aria-label={`Keep ${panelName} open`}
                        aria-pressed={dock.pinned}
                        title={dock.pinned ? 'Unpin' : 'Keep open'}
                        onClick={dock.togglePin}
                    >
                        <Icon name="pin" />
                    </Button>
                    <Button
                        variant="ghost"
                        aria-label={`Close ${panelName}`}
                        title="Close"
                        onClick={() => dock.close(true)}
                    >
                        <Icon name="close" />
                    </Button>
                </div>
                {dock.target === 'columns' ? (
                    <div className="result-columns-panel">
                        <label className="result-search-label" htmlFor={`${id}-columns`}>
                            Search by name or type
                        </label>
                        <div className="result-filter-field">
                            <Icon name="search" className="result-filter-icon" />
                            <input
                                ref={dock.columns}
                                id={`${id}-columns`}
                                className="result-filter"
                                type="search"
                                placeholder="Find a column…"
                                value={columnSearch}
                                onChange={event => onColumnSearch(event.target.value)}
                            />
                        </div>
                        <div className="result-search-summary">
                            <span>
                                {visibleColumnCount} of {columns.length} columns shown
                            </span>
                            <Button variant="ghost" onClick={onRestoreColumns}>
                                Restore defaults
                            </Button>
                        </div>
                        <div
                            className="result-column-list"
                            role="group"
                            aria-label="Result columns"
                        >
                            {matchingColumns.length ? (
                                matchingColumns.map(({ column, index }) => {
                                    const duplicate = (duplicateCounts.get(column.name) ?? 0) > 1;
                                    const label = duplicate
                                        ? `${column.name} · column ${index + 1}`
                                        : column.name;
                                    return (
                                        <div className="result-column-option" key={index}>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={!hiddenColumns.has(index)}
                                                    aria-label={`${hiddenColumns.has(index) ? 'Show' : 'Hide'} ${label}`}
                                                    onChange={() => onToggleColumn(index)}
                                                />
                                                <span title={column.name}>{label}</span>
                                                <small title={column.type}>{column.type}</small>
                                            </label>
                                            <button
                                                type="button"
                                                className="result-column-pin"
                                                aria-label={`${pinnedColumns.has(index) ? 'Unpin' : 'Pin'} ${label} ${pinnedColumns.has(index) ? 'from' : 'to'} the left`}
                                                aria-pressed={pinnedColumns.has(index)}
                                                title={
                                                    pinnedColumns.has(index)
                                                        ? 'Unpin from left'
                                                        : 'Pin to left'
                                                }
                                                onClick={() => onTogglePinned(index)}
                                            >
                                                <Icon name="pin" />
                                            </button>
                                        </div>
                                    );
                                })
                            ) : (
                                <p className="result-column-empty">No matching columns.</p>
                            )}
                        </div>
                    </div>
                ) : (
                    <>
                        <label className="result-search-label" htmlFor={`${id}-search`}>
                            Search this page
                        </label>
                        <div className="result-filter-field">
                            <Icon name="search" className="result-filter-icon" />
                            <input
                                ref={dock.search}
                                id={`${id}-search`}
                                className="result-filter"
                                type="search"
                                placeholder="Find a value…"
                                value={filter}
                                onChange={event => onFilter(event.target.value)}
                            />
                        </div>
                        <div className="result-search-summary">
                            <Button
                                variant="ghost"
                                aria-pressed={selectionMode}
                                onClick={onToggleSelection}
                            >
                                {selectionMode ? 'Stop selecting cells' : 'Select cells'}
                            </Button>
                            <span className="result-match-count" role="status" aria-live="polite">
                                {loading
                                    ? 'Loading this page…'
                                    : `${matchingCount.toLocaleString()} of ${pageRows.toLocaleString()} rows on this page`}
                            </span>
                            {filter && (
                                <Button
                                    variant="ghost"
                                    aria-label="Clear row filter"
                                    onClick={() => {
                                        onFilter('');
                                        dock.search.current?.focus();
                                    }}
                                >
                                    Clear
                                </Button>
                            )}
                        </div>
                        {pageCount > 1 && (
                            <div className="result-controls-pages">
                                <ResultPagination
                                    pageIndex={pageIndex}
                                    pageCount={pageCount}
                                    loading={loading}
                                    onPage={onPage}
                                    pageInput={dock.page}
                                />
                                <span className="result-retained-range">
                                    {loading ? 'Loading retained rows…' : retainedRange}
                                </span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
