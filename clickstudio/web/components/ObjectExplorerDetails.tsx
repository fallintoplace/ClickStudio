import type { SchemaTable } from '../../shared/types';
import { tableQuerySql, type ExplorerSelection } from '../../shared/object-explorer';
import { quoteIdentifier } from '../../shared/sql';
import type { Copy } from '../i18n';
import { Button, cx, formatBytes, formatCount, Icon } from './ui';

export function ObjectDetails({ copy, selection, trusted, copiedId, onClose, onInsert, onCopy, onOpenSqlDraft, onOpenReference, onOpenParts }: {
    copy: Copy['common'];
    selection: ExplorerSelection;
    trusted: boolean;
    copiedId?: string;
    onClose?: () => void;
    onInsert: (value: string) => void;
    onCopy: (value: string, id: string) => void;
    onOpenSqlDraft: (name: string, sql: string, run: boolean) => void;
    onOpenReference: (name: string, type: string) => void;
    onOpenParts: (table: SchemaTable) => void;
}) {
    if (selection.kind === 'relation') {
        const { table, columns } = selection;
        const qualified = qualifiedTableName(table);
        return <section className="object-details" aria-label="Selected object">{onClose && <button type="button" className="object-details-close" aria-label="Close object details" onClick={onClose}>×</button>}
            <div className="object-details-hero"><span className={cx('object-kind-badge', selection.relationKind === 'view' && 'is-view')}>{selection.relationKind === 'view' ? 'VIEW' : 'TABLE'}</span><strong>{table.name}</strong><code>{table.database}.{table.name}</code><small>{table.engine} · {tableSummary(table, copy)}</small></div>
            <div className="object-relation-actions">
                <div className="object-action-grid">
                    <Button variant="primary" className="toolbar-small object-preview-action" disabled={!trusted} title={!trusted ? copy.runActionTrustRequired : undefined} onClick={() => onOpenSqlDraft(`Preview ${table.name}.sql`, tableQuerySql(table, columns, 'preview'), true)}><Icon name="table"/>{copy.previewRows}</Button>
                    <Button variant="secondary" className="toolbar-small object-generate-action" onClick={() => onOpenSqlDraft(`Select ${table.name}.sql`, tableQuerySql(table, columns, 'select'), false)}><Icon name="parser"/>{copy.generateSelect}</Button>
                </div>
                <div className="object-utility-actions">
                    <Button variant="ghost" className="toolbar-small" onClick={() => onInsert(qualified)}><Icon name="plus"/>{copy.insertName}</Button>
                    <Button variant="ghost" className="toolbar-small" onClick={() => void onCopy(qualified, selection.id)}><Icon name="copy"/>{copiedId === selection.id ? copy.copied : copy.copyName}</Button>
                </div>
            </div>
            {(table.engine.endsWith('MergeTree') || table.database === 'system') && <div className="object-reference-actions">
                {table.engine.endsWith('MergeTree') && <Button variant="secondary" className="toolbar-small object-parts-action" disabled={!trusted} title={!trusted ? copy.runActionTrustRequired : undefined} onClick={() => onOpenParts(table)}><Icon name="chart"/>{copy.partsVisualize}</Button>}
                {table.database === 'system' && <Button variant="ghost" className="toolbar-small" onClick={() => onOpenReference(table.name, 'System Table')}><Icon name="reference"/>{copy.referenceSystemTable}</Button>}
            </div>}
            <TableMetadata table={table}/>
        </section>;
    }

    if (selection.kind === 'column') {
        const quoted = quoteIdentifier(selection.column.name);
        return <section className="object-details" aria-label="Selected object">{onClose && <button type="button" className="object-details-close" aria-label="Close object details" onClick={onClose}>×</button>}
            <div className="object-details-hero"><span className="object-kind-badge">COLUMN</span><strong>{selection.column.name}</strong><code>{selection.table.database}.{selection.table.name}</code><small>{selection.column.type}</small></div>
            <div className="object-action-grid compact">
                <Button variant="secondary" className="toolbar-small" onClick={() => onInsert(quoted)}>{copy.insertName}</Button>
                <Button variant="ghost" className="toolbar-small" onClick={() => void onCopy(quoted, selection.id)}>{copiedId === selection.id ? copy.copied : copy.copyName}</Button>
            </div>
            <div className="object-fact-list">
                <ObjectFact label="TYPE" value={selection.column.type}/>
                {selection.column.defaultKind && <ObjectFact label="DEFAULT" value={selection.column.defaultKind}/>}
                {selection.column.comment && <ObjectFact label="COMMENT" value={selection.column.comment}/>}
            </div>
        </section>;
    }

    if (selection.kind === 'dictionary') {
        const dictionary = selection.dictionary;
        const qualified = dictionary.database ? `${quoteIdentifier(dictionary.database)}.${quoteIdentifier(dictionary.name)}` : quoteIdentifier(dictionary.name);
        return <section className="object-details" aria-label="Selected object">{onClose && <button type="button" className="object-details-close" aria-label="Close object details" onClick={onClose}>×</button>}
            <div className="object-details-hero"><span className="object-kind-badge is-dictionary">DICTIONARY</span><strong>{dictionary.name}</strong><code>{dictionary.database || 'Server level'}</code><small>{dictionary.type || 'Dictionary'} · {dictionary.status.toLowerCase().replaceAll('_', ' ')}</small></div>
            <div className="object-action-grid compact">
                <Button variant="secondary" className="toolbar-small" onClick={() => onInsert(qualified)}>{copy.insertName}</Button>
                <Button variant="ghost" className="toolbar-small" onClick={() => void onCopy(qualified, selection.id)}>{copiedId === selection.id ? copy.copied : copy.copyName}</Button>
            </div>
            <div className="object-fact-list">
                {dictionary.keyColumns && <ObjectFact label="KEY" value={dictionary.keyColumns}/>}
                {dictionary.attributeColumns && <ObjectFact label="ATTRIBUTES" value={dictionary.attributeColumns}/>}
                {dictionary.elementCount && <ObjectFact label="ENTRIES" value={formatCount(dictionary.elementCount)}/>}
                {dictionary.memoryBytes && <ObjectFact label="MEMORY" value={formatBytes(dictionary.memoryBytes)}/>}
                {dictionary.lastSuccessfulUpdate && <ObjectFact label="LAST UPDATED" value={dictionary.lastSuccessfulUpdate}/>}
            </div>
        </section>;
    }

    if (selection.kind === 'projection') {
        return <section className="object-details" aria-label="Selected object">{onClose && <button type="button" className="object-details-close" aria-label="Close object details" onClick={onClose}>×</button>}<div className="object-details-hero"><span className="object-kind-badge">PROJECTION</span><strong>{selection.projection.name}</strong><code>{selection.table.database}.{selection.table.name}</code><small>{selection.projection.type}</small></div><div className="object-fact-list">{selection.projection.sortingKey && <ObjectFact label="SORTING KEY" value={selection.projection.sortingKey}/>}</div></section>;
    }

    return <section className="object-details" aria-label="Selected object">{onClose && <button type="button" className="object-details-close" aria-label="Close object details" onClick={onClose}>×</button>}<div className="object-details-hero"><span className="object-kind-badge">SKIP INDEX</span><strong>{selection.index.name}</strong><code>{selection.table.database}.{selection.table.name}</code><small>{selection.index.type}</small></div><div className="object-fact-list"><ObjectFact label="EXPRESSION" value={selection.index.expression}/><ObjectFact label="GRANULARITY" value={selection.index.granularity}/></div></section>;
}

function ObjectFact({ label, value }: { label: string; value: string }) {
    return <div className="object-fact"><span>{label}</span><code>{value}</code></div>;
}

function qualifiedTableName(table: SchemaTable) {
    return `${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}`;
}

function tableSummary(table: SchemaTable, copy: Copy['common']): string {
    const values = [
        table.rowEstimate == null ? undefined : `${formatCount(table.rowEstimate)} ${copy.rowsEstimated}`,
        table.sizeBytes == null ? undefined : formatBytes(table.sizeBytes),
        table.activeParts == null ? undefined : `${formatCount(table.activeParts)} ${copy.parts}`,
    ].filter((value): value is string => Boolean(value));
    return values.join(' · ') || (table.database === 'system' ? copy.systemTable : copy.metadataUnavailable);
}

function TableMetadata({ table }: { table: SchemaTable }) {
    const stats = [
        table.rowEstimate === undefined ? undefined : { label: 'Row estimate', value: table.rowEstimate === null ? 'Unavailable' : `${formatCount(table.rowEstimate)} rows`, detail: table.rowEstimate ?? undefined },
        table.sizeBytes === undefined ? undefined : { label: 'Reported size', value: table.sizeBytes === null ? 'Unavailable' : formatBytes(table.sizeBytes), detail: table.sizeBytes === null ? undefined : `ClickHouse reports ${table.sizeBytes} bytes. On-disk tables report compressed size; in-memory tables report an approximate memory size.` },
        table.uncompressedBytes === undefined ? undefined : { label: 'Uncompressed size', value: table.uncompressedBytes === null ? 'Unavailable' : formatBytes(table.uncompressedBytes), detail: table.uncompressedBytes ?? undefined },
        table.parts === undefined && table.activeParts === undefined ? undefined : { label: 'Parts', value: `${table.activeParts == null ? '—' : formatCount(table.activeParts)} active · ${table.parts == null ? '—' : formatCount(table.parts)} total`, detail: undefined },
    ].filter((stat): stat is NonNullable<typeof stat> => Boolean(stat));
    const keys = [
        ['ORDER BY', table.orderBy],
        ['PRIMARY KEY', table.primaryKey],
        ['PARTITION BY', table.partitionKey],
        ['SAMPLE BY', table.samplingKey],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));
    const hasKeyMetadata = table.orderBy !== undefined || table.primaryKey !== undefined || table.partitionKey !== undefined || table.samplingKey !== undefined;

    return <div className="schema-table-metadata">
        {stats.length > 0 && <div className="schema-stat-grid">{stats.map(stat => <div className="schema-stat" key={stat.label} title={stat.detail ? `${stat.label}: ${stat.detail}` : undefined}><span>{stat.label}</span><strong>{stat.value}</strong></div>)}</div>}
        {(keys.length > 0 || hasKeyMetadata) && <div className="schema-key-list">{keys.length ? keys.map(([label, value]) => <div className="schema-key" key={label}><span>{label}</span><code>{value}</code></div>) : <div className="schema-metadata-empty">No table keys configured</div>}</div>}
        {table.ttlConfigured !== undefined && <div className={cx('schema-ttl', table.ttlConfigured ? 'is-configured' : 'is-empty')}><span>TTL</span><strong>{table.ttlConfigured ? 'Configured' : 'None'}</strong></div>}
        {table.materializedViewTarget && <div className="schema-view-target"><span>WRITES TO</span><code>{table.materializedViewTarget}</code></div>}
    </div>;
}
