import { useState } from 'react';
import type { Json } from '../../../../shared/common/values';
import type { Copy } from '../../../common/translations/i18n';
import type { ImportPreview } from '../state/import-wizard-model';
import { displayImportValue, formatImportColumnRange } from '../state/import-wizard-model';

const REVIEW_ROWS_PER_PAGE = 20;

function fillReviewCopy(template: string, values: Record<string, string>) {
    return template.replace(
        /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
        (placeholder, key: string) => values[key] ?? placeholder,
    );
}

export function ImportPreviewTable({
    preview,
    columns,
}: {
    preview: ImportPreview;
    columns: string[];
}) {
    return (
        <div className="import-preview-table overflow-hidden rounded-xl border border-[var(--line)]">
            <div className="flex items-center justify-between gap-3 bg-[var(--page)] px-3 py-2 text-[10px] text-[var(--muted)]">
                <span>Sample rows</span>
                <span>
                    Showing {preview.rows.length} of {preview.rowCount.toLocaleString()} ·{' '}
                    {formatImportColumnRange(columns.length, preview.columns.length)}
                </span>
            </div>
            <div className="max-h-64 overflow-auto">
                <table className="w-full border-collapse text-left text-[10px]">
                    <thead className="sticky top-0 bg-[var(--panel-raised)] text-[var(--muted)]">
                        <tr>
                            {columns.map(column => (
                                <th
                                    key={column}
                                    className="max-w-[180px] truncate px-3 py-2 font-semibold"
                                    title={column}
                                >
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {preview.rows.map((row, index) => (
                            <tr key={index} className="border-t border-[var(--line)]">
                                {columns.map(column => (
                                    <td
                                        key={column}
                                        className="max-w-[180px] truncate px-3 py-2 text-[var(--text-soft)]"
                                        title={displayImportValue(row[column])}
                                    >
                                        {displayImportValue(row[column])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function ImportReviewRows({
    rows,
    columns,
    copy,
}: {
    rows: Record<string, Json>[];
    columns: string[];
    copy: Copy['imports'];
}) {
    const [page, setPage] = useState(0);
    const pageCount = Math.max(1, Math.ceil(rows.length / REVIEW_ROWS_PER_PAGE));
    const currentPage = Math.min(page, pageCount - 1);
    const startIndex = currentPage * REVIEW_ROWS_PER_PAGE;
    const pageRows = rows.slice(startIndex, startIndex + REVIEW_ROWS_PER_PAGE);
    const startRow = rows.length ? startIndex + 1 : 0;
    const endRow = startIndex + pageRows.length;

    return (
        <section
            aria-label={copy.reviewRows}
            className="import-review-mapping rounded-xl border border-[var(--line)] bg-[var(--page)]"
        >
            <div className="import-review-mapping-header">
                <h4>{copy.reviewRows}</h4>
                <span>
                    {fillReviewCopy(copy.reviewRowRange, {
                        start: startRow.toLocaleString(),
                        end: endRow.toLocaleString(),
                        count: rows.length.toLocaleString(),
                    })}
                </span>
            </div>
            <p className="m-0 border-t border-[var(--line)] px-3 py-2 text-[10px] leading-relaxed text-[var(--muted)]">
                {copy.reviewRowsNote}
            </p>
            <div className="import-review-rows-list import-review-mapping-list">
                <table aria-label={copy.reviewRows}>
                    <thead>
                        <tr>
                            <th scope="col">{copy.reviewRowNumber}</th>
                            {columns.map(column => (
                                <th key={column} scope="col" title={column}>
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.map((row, index) => {
                            const rowNumber = startIndex + index + 1;
                            return (
                                <tr key={rowNumber}>
                                    <th scope="row">{rowNumber.toLocaleString()}</th>
                                    {columns.map(column => {
                                        const value = displayImportValue(row[column]);
                                        return (
                                            <td key={column} title={value}>
                                                {value}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {pageCount > 1 && (
                <nav
                    aria-label={copy.reviewRowsPagination}
                    className="import-review-rows-pagination flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-3 py-2 text-[10px]"
                >
                    <span>
                        {fillReviewCopy(copy.reviewPage, {
                            page: (currentPage + 1).toLocaleString(),
                            pages: pageCount.toLocaleString(),
                        })}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            aria-label={copy.reviewPreviousPage}
                            onClick={() => setPage(currentPage - 1)}
                            disabled={currentPage === 0}
                            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {copy.reviewPreviousPage}
                        </button>
                        <button
                            type="button"
                            aria-label={copy.reviewNextPage}
                            onClick={() => setPage(currentPage + 1)}
                            disabled={currentPage + 1 >= pageCount}
                            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-[var(--text-soft)] hover:bg-[var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {copy.reviewNextPage}
                        </button>
                    </div>
                </nav>
            )}
        </section>
    );
}
