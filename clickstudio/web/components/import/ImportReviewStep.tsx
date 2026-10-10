import { ImportReviewRows } from '../ImportPreviewTable';
import {
    formatImportColumnCount,
    formatImportRowCount,
    type ImportMapping,
    type ImportPreview,
} from '../import-wizard-model';
import { useImportWizardController } from '../useImportWizardController';
import type { Copy } from '../../i18n';
import type { SchemaColumn } from '../../../shared/types';

function fillImportCopy(template: string, values: Record<string, string>) {
    return template.replace(
        /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
        (placeholder, key: string) => values[key] ?? placeholder,
    );
}

export function ImportReviewStep({
    browserDemoImport,
    creatingTable,
    mapping,
    browserCloudImport,
    mappedColumnCount,
    skippedColumnCount,
    omittedDestinationColumns,
    importCopy,
    missingSourceFields,
    preview,
    destinationColumns,
    generateId,
    hasCreateIdColumn,
}: {
    browserDemoImport: ReturnType<typeof useImportWizardController>['browserDemoImport'];
    creatingTable: ReturnType<typeof useImportWizardController>['creatingTable'];
    mapping: ImportMapping;
    browserCloudImport: ReturnType<typeof useImportWizardController>['browserCloudImport'];
    mappedColumnCount: number;
    skippedColumnCount: number;
    omittedDestinationColumns: SchemaColumn[];
    importCopy: Copy['imports'];
    missingSourceFields: [string, number][];
    preview: ImportPreview;
    destinationColumns: ReturnType<typeof useImportWizardController>['destinationColumns'];
    generateId: ReturnType<typeof useImportWizardController>['generateId'];
    hasCreateIdColumn: boolean;
}) {
    return (
        <section aria-label="Review import" className="import-review-step space-y-4">
            <div className="import-ready-card rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 sm:p-5">
                <span className="import-ready-eyebrow text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    {browserDemoImport
                        ? 'Ready to save in browser demo'
                        : creatingTable
                          ? 'Ready to create and import'
                          : 'Ready to insert'}
                </span>
                <h3 className="import-ready-title mt-1 text-base font-semibold">
                    Ready to import into{' '}
                    <code className="rounded bg-[var(--page)] px-1.5 py-1 font-mono text-sm">
                        {mapping.table}
                    </code>
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-[var(--text-soft)]">
                    {browserDemoImport
                        ? 'This adds rows to the Vercel interview sandbox in this browser. It does not write to ClickHouse.'
                        : browserCloudImport
                          ? creatingTable
                              ? 'This creates a MergeTree table in the connected database, then inserts the file rows.'
                              : 'This writes to the selected Cloud table. ClickHouse checks your account permissions and destination types.'
                          : 'This writes data to the selected ClickHouse table. The mapping and destination schema were checked by the server.'}
                </p>
                <dl className="import-review-metrics" aria-label="Import summary">
                    <div>
                        <dt>Rows</dt>
                        <dd>{formatImportRowCount(mapping.rowCount)}</dd>
                    </div>
                    <div>
                        <dt>Mapped</dt>
                        <dd>{formatImportColumnCount(mappedColumnCount)}</dd>
                    </div>
                    <div>
                        <dt>Skipped</dt>
                        <dd>{formatImportColumnCount(skippedColumnCount)}</dd>
                    </div>
                </dl>
            </div>
            {omittedDestinationColumns.length > 0 && (
                <p className="rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 py-2.5 text-xs leading-relaxed text-[var(--text-soft)]">
                    {fillImportCopy(importCopy.reviewOmittedTargets, {
                        columns: omittedDestinationColumns.map(column => column.name).join(', '),
                    })}
                </p>
            )}
            {missingSourceFields.length > 0 && (
                <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 py-2.5 text-xs leading-relaxed text-[var(--text-soft)]">
                    {missingSourceFields.map(([source, count]) => {
                        const destination = mapping.fields[source];
                        if (!destination) return null;
                        const rowLabel = count === 1 ? importCopy.inputRow : importCopy.inputRows;
                        return (
                            <p key={source}>
                                {fillImportCopy(importCopy.reviewMissingValues, {
                                    source,
                                    count: count.toLocaleString(),
                                    rowLabel,
                                    destination,
                                })}
                            </p>
                        );
                    })}
                </div>
            )}
            <ImportReviewRows
                key={mapping.id}
                rows={mapping.rows}
                columns={Object.values(mapping.fields)}
                copy={importCopy}
            />
            <div className="import-review-mapping rounded-xl border border-[var(--line)] bg-[var(--page)]">
                <div className="import-review-mapping-header">
                    <h4 className="text-xs font-semibold">Column mapping</h4>
                    <span>
                        {mappedColumnCount} mapped · {skippedColumnCount} skipped
                    </span>
                </div>
                <div className="import-review-mapping-list">
                    <table aria-label="Import column mapping">
                        <thead>
                            <tr>
                                <th scope="col">Source column</th>
                                <th scope="col">Destination column</th>
                                <th scope="col">Type</th>
                            </tr>
                        </thead>
                        <tbody>
                            {preview.columns.map(source => {
                                const destination = mapping.fields[source];
                                const type = destinationColumns.find(
                                    column => column.name === destination,
                                )?.type;
                                return (
                                    <tr key={source}>
                                        <th scope="row" title={source}>
                                            {source}
                                        </th>
                                        <td>
                                            {destination ? (
                                                <code>{destination}</code>
                                            ) : (
                                                <span className="import-review-skipped">
                                                    Skipped
                                                </span>
                                            )}
                                        </td>
                                        <td>{type ?? '—'}</td>
                                    </tr>
                                );
                            })}
                            {creatingTable && generateId && !hasCreateIdColumn && (
                                <tr className="is-generated">
                                    <th scope="row">Generated id</th>
                                    <td>
                                        <span>ClickHouse</span>
                                    </td>
                                    <td>UInt64</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
