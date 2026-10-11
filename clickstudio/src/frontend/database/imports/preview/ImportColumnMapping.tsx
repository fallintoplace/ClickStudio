import { type ImportPreview } from '../state/import-wizard-model';
import { useImportWizardController } from '../useImportWizardController';

export function ImportColumnMapping({
    preview,
    liveMappingIssue,
    destinationColumns,
    fields,
    setFields,
    setMapping,
    setError,
}: {
    preview: ImportPreview;
    liveMappingIssue: { source: string; message: string } | undefined;
    destinationColumns: ReturnType<typeof useImportWizardController>['destinationColumns'];
    fields: ReturnType<typeof useImportWizardController>['fields'];
    setFields: ReturnType<typeof useImportWizardController>['setFields'];
    setMapping: ReturnType<typeof useImportWizardController>['setMapping'];
    setError: ReturnType<typeof useImportWizardController>['setError'];
}) {
    return (
        <div className="import-column-map">
            <table className="w-full min-w-[540px] border-collapse text-left text-xs">
                <thead>
                    <tr>
                        <th>FROM FILE</th>
                        <th>TO TABLE</th>
                        <th>TYPE</th>
                    </tr>
                </thead>
                <tbody>
                    {preview.columns.map((source, sourceIndex) => {
                        const sourceIssue =
                            liveMappingIssue?.source === source ? liveMappingIssue : undefined;
                        const issueId = sourceIssue
                            ? `import-mapping-error-${sourceIndex}`
                            : undefined;
                        const destinationType = destinationColumns.find(
                            column => column.name === fields[source],
                        )?.type;
                        return (
                            <tr key={source}>
                                <th scope="row" title={source}>
                                    <code className="import-source-column-name">{source}</code>
                                </th>
                                <td>
                                    <select
                                        aria-label={`Map ${source} to destination`}
                                        aria-invalid={sourceIssue ? true : undefined}
                                        aria-describedby={issueId}
                                        value={fields[source] ?? ''}
                                        onChange={event => {
                                            setFields(current => ({
                                                ...current,
                                                [source]: event.target.value,
                                            }));
                                            setMapping(undefined);
                                            setError('');
                                        }}
                                    >
                                        <option value="">Skip column</option>
                                        {destinationColumns.map(column => (
                                            <option key={column.name} value={column.name}>
                                                {column.name}
                                            </option>
                                        ))}
                                    </select>
                                    {sourceIssue && (
                                        <p
                                            id={issueId}
                                            role="alert"
                                            className="mt-2 max-w-80 text-[11px] leading-relaxed text-[var(--red)]"
                                        >
                                            {sourceIssue.message}
                                        </p>
                                    )}
                                </td>
                                <td className="import-column-type-cell">
                                    <span className="import-column-type" title={destinationType}>
                                        {destinationType ?? '—'}
                                    </span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
