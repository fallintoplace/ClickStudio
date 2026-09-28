import { useState } from 'react';
import { displayValue, filterRows } from '../../shared/results';
import type { ResultPage, Run } from '../../shared/types';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';
import { Button, cx, terminal } from './ui';
import { statementOutcome } from '../statement-outcome';

export function ResultGrid({ run, page, pageIndex, loading, onPage, showPagination = true, obscured = false }: { run: Run; page?: ResultPage; pageIndex: number; loading: boolean; onPage: (page: number) => void; showPagination?: boolean; obscured?: boolean }) {
    const [filter, setFilter] = useState('');
    if (run.resultState === 'expired') return <div className="result-empty-state"><span className="empty-result-icon">⌛</span><strong>Result retention expired</strong><p>The SQL and query ID are still available. Run it again to fetch fresh data.</p></div>;
    if (run.resultState !== 'reopenable') return <div className="result-empty-state">{terminal(run) ? <span className="empty-result-icon">!</span> : <span className="loading-orbit"/>}<strong>{terminal(run) ? 'No retained result' : 'Query is running'}</strong><p>{terminal(run) ? 'This run did not produce result rows.' : 'The live execution status appears in the bottom bar.'}</p></div>;
    if (loading || !page) return <div className="result-loading"><span className="loading-orbit"/><span>Loading retained rows…</span></div>;
    if (page.columns.length === 0 && page.rows.length === 0 && page.totalRows === 0 && page.completeness !== 'truncated')
        return <div className="result-empty-state" role="status"><strong>{statementOutcome(run)}</strong><p>No result set was returned.</p></div>;
    const searchableRows = page.rows.map(row => row.map(value => displayValue(value).toLocaleLowerCase()).join('\u0001'));
    const matchingRows = new Set(filterRows(page.rows, filter, searchableRows));
    const visibleRows = page.rows.flatMap((row, index) => matchingRows.has(row) ? [{ row, index }] : []);
    const pageCount = Math.max(1, Math.ceil(page.totalRows / 200));
    const emptyRowsMessage = page.totalRows > 0
        ? 'No retained rows are available on this page.'
        : page.completeness === 'truncated'
            ? 'No rows fit in the retained result. The query may still have matched rows; the result limits left none to keep.'
            : 'This query returned zero rows.';
    return <div className={cx('result-grid-wrap animate-enter', obscured && 'is-pending-previous-result')} aria-busy={obscured || undefined} inert={obscured || undefined}>
        <ScrollEdgeFrame<HTMLDivElement> className="data-table-scroll-frame">{(ref, edges) => <>
            {(edges.left || edges.right) && <div className="result-scroll-hint" aria-hidden="true"><span>↔</span>Scroll horizontally to view all {page.columns.length} columns</div>}
            <div ref={ref} className="data-table-scroll" role="region" aria-label={edges.left || edges.right ? 'Retained query rows. Scroll horizontally to view all columns.' : 'Retained query rows'} tabIndex={edges.left || edges.right ? 0 : undefined}>
                <table className="data-table" aria-label="Retained query rows">
                    <thead><tr><th className="row-number">#</th>{page.columns.map((column, index) => <th key={`${column.name}-${index}`}><span>{column.name}</span><small>{column.type}</small></th>)}</tr></thead>
                    <tbody>{visibleRows.map(({ row, index: rowIndex }) => <tr key={`${page.offset}-${rowIndex}`} style={{ animationDelay: `${Math.min(rowIndex, 12) * 16}ms` }}><td className="row-number">{page.offset + rowIndex + 1}</td>{row.map((value, index) => <td key={index} title={displayValue(value)} className={value === null ? 'cell-null' : ''}>{displayValue(value)}</td>)}</tr>)}</tbody>
                </table>
                {page.rows.length === 0 ? <div className="no-rows" role="status">{emptyRowsMessage}</div> : visibleRows.length === 0 && <div className="no-rows">No rows match on this page.</div>}
            </div>
        </>}</ScrollEdgeFrame>
        {(showPagination || page.completeness === 'truncated') && <div className="table-pagination">
            <div className="table-pagination-summary">
                {showPagination && <span>Showing {page.rows.length.toLocaleString()} of {page.totalRows.toLocaleString()} retained rows <i>·</i> filter applies to this page only</span>}
                {page.completeness === 'truncated' && <span className="result-completeness"><span className="status-light is-warning"/>Retained prefix · truncated</span>}
                {showPagination && filter.trim() && <span>{visibleRows.length} matches on this page</span>}
            </div>
            {showPagination && <label className="result-filter"><span>Find on this page</span><input type="search" aria-label="Filter current page" placeholder="Filter rows" value={filter} onChange={event => setFilter(event.target.value)}/></label>}
            {showPagination && pageCount > 1 && <div className="table-pagination-controls">
                <span>Page {pageIndex + 1} of {pageCount}</span>
                <Button variant="secondary" disabled={pageIndex === 0} onClick={() => onPage(0)}>First</Button>
                <Button variant="secondary" disabled={pageIndex === 0} onClick={() => onPage(pageIndex - 1)}>←</Button>
                <Button variant="secondary" disabled={pageIndex + 1 >= pageCount} onClick={() => onPage(pageIndex + 1)}>→</Button>
                <Button variant="secondary" disabled={pageIndex + 1 >= pageCount} onClick={() => onPage(pageCount - 1)}>Last</Button>
            </div>}
        </div>}
    </div>;
}
