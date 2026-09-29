import type { ImportPreview } from './import-wizard-model';
import { displayImportValue } from './import-wizard-model';

export function ImportPreviewTable({ preview, columns }: { preview: ImportPreview; columns: string[] }) {
    return <div className="import-preview-table overflow-hidden rounded-xl border border-[var(--line)]">
        <div className="flex items-center justify-between gap-3 bg-[var(--page)] px-3 py-2 text-[10px] text-[var(--muted)]"><span>Sample rows</span><span>Showing {preview.rows.length} of {preview.rowCount.toLocaleString()} · {columns.length} of {preview.columns.length} columns</span></div>
        <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[440px] border-collapse text-left text-[10px]">
                <thead className="sticky top-0 bg-[var(--panel-raised)] text-[var(--muted)]"><tr>{columns.map(column => <th key={column} className="max-w-[180px] truncate px-3 py-2 font-semibold" title={column}>{column}</th>)}</tr></thead>
                <tbody>{preview.rows.map((row, index) => <tr key={index} className="border-t border-[var(--line)]">{columns.map(column => <td key={column} className="max-w-[180px] truncate px-3 py-2 text-[var(--text-soft)]" title={displayImportValue(row[column])}>{displayImportValue(row[column])}</td>)}</tr>)}</tbody>
            </table>
        </div>
    </div>;
}
