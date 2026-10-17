import {
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import type { SchemaColumn, SchemaTable } from '../../../../shared/database/schema/types';
import {
    explorerColumnId,
    explorerRelationId,
    tableQuerySql,
    type ExplorerSelection,
} from './object-explorer-model';
import { quoteIdentifier } from '../../../../shared/sql/sql';
import type { Copy } from '../../../ui/copy';
import { Button, cx } from '../../../ui/components/primitives';
import { formatBytes, formatCount } from '../../../browser/metric-formatters';
import { Icon } from '../../../ui/components/icons';
import { resultTypeGroup } from '../../../queries/results/result-type-group';
import type { OpenSqlDraft } from '../../../queries/execution/sql-draft-observer';

type ObjectDetailsProps = {
    copy: Copy['common'];
    selection: ExplorerSelection;
    tableActions?: ReactNode;
    trusted: boolean;
    expert: boolean;
    copiedId?: string;
    onClose?: () => void;
    onInsert: (value: string) => void;
    onCopy: (value: string, id: string) => void | Promise<void>;
    onOpenSqlDraft: OpenSqlDraft;
    onOpenReference: (name: string, type: string) => void;
    onOpenParts: (table: SchemaTable) => void;
    onSelect: (id: string) => void;
    search: string;
    onBrowseTable?: (selection: Extract<ExplorerSelection, { kind: 'relation' }>) => void;
    canBrowse?: boolean;
};

export function ObjectDetails({
    copy,
    selection,
    tableActions,
    trusted,
    expert,
    copiedId,
    onClose,
    onInsert,
    onCopy,
    onOpenSqlDraft,
    onOpenReference,
    onOpenParts,
    onSelect,
    search,
    onBrowseTable,
    canBrowse,
}: ObjectDetailsProps) {
    if (selection.kind === 'relation') {
        return (
            <RelationDetails
                key={selection.id}
                copy={copy}
                selection={selection}
                tableActions={tableActions}
                trusted={trusted}
                expert={expert}
                copiedId={copiedId}
                onClose={onClose}
                onCopy={onCopy}
                onOpenSqlDraft={onOpenSqlDraft}
                onOpenReference={onOpenReference}
                onOpenParts={onOpenParts}
                onSelect={onSelect}
                search={search}
                onBrowseTable={onBrowseTable}
                canBrowse={canBrowse}
            />
        );
    }

    if (selection.kind === 'column') {
        const quoted = quoteIdentifier(selection.column.name);
        return (
            <section className="object-details" data-kind="column" aria-label="Selected object">
                <button
                    type="button"
                    className="object-column-parent-action"
                    onClick={() =>
                        onSelect(explorerRelationId(selection.table.database, selection.table.name))
                    }
                >
                    <Icon name="table" />
                    {copy.backToTable}
                </button>
                {onClose && (
                    <button
                        type="button"
                        className="object-details-close"
                        aria-label="Close object details"
                        onClick={onClose}
                    >
                        ×
                    </button>
                )}
                <div className="object-details-hero">
                    <span className="object-kind-badge">COLUMN</span>
                    <strong>{selection.column.name}</strong>
                    <code>
                        {selection.table.database}.{selection.table.name}
                    </code>
                    <small>Type · {selection.column.type}</small>
                </div>
                <div className="object-action-grid compact">
                    <Button
                        variant="secondary"
                        className="toolbar-small"
                        onClick={() => onInsert(quoted)}
                    >
                        {copy.insertName}
                    </Button>
                    <Button
                        variant="ghost"
                        className="toolbar-small"
                        onClick={() => void onCopy(quoted, selection.id)}
                    >
                        {copiedId === selection.id ? copy.copied : copy.copyName}
                    </Button>
                </div>
                <div className="object-fact-list">
                    {selection.column.defaultKind && (
                        <ObjectFact label="DEFAULT" value={selection.column.defaultKind} />
                    )}
                    {selection.column.comment && (
                        <ObjectFact label="COMMENT" value={selection.column.comment} />
                    )}
                </div>
            </section>
        );
    }

    if (selection.kind === 'dictionary') {
        const dictionary = selection.dictionary;
        const qualified = dictionary.database
            ? `${quoteIdentifier(dictionary.database)}.${quoteIdentifier(dictionary.name)}`
            : quoteIdentifier(dictionary.name);
        return (
            <section className="object-details" data-kind="dictionary" aria-label="Selected object">
                {onClose && (
                    <button
                        type="button"
                        className="object-details-close"
                        aria-label="Close object details"
                        onClick={onClose}
                    >
                        ×
                    </button>
                )}
                <div className="object-details-hero">
                    <span className="object-kind-badge">DICTIONARY</span>
                    <strong>{dictionary.name}</strong>
                    <code>{dictionary.database || 'Server level'}</code>
                    <small>
                        {dictionary.type || 'Dictionary'} ·{' '}
                        {dictionary.status.toLowerCase().replaceAll('_', ' ')}
                    </small>
                </div>
                <div className="object-action-grid compact">
                    <Button
                        variant="secondary"
                        className="toolbar-small"
                        onClick={() => onInsert(qualified)}
                    >
                        {copy.insertName}
                    </Button>
                    <Button
                        variant="ghost"
                        className="toolbar-small"
                        onClick={() => void onCopy(qualified, selection.id)}
                    >
                        {copiedId === selection.id ? copy.copied : copy.copyName}
                    </Button>
                </div>
                <div className="object-fact-list">
                    {dictionary.keyColumns && (
                        <ObjectFact label="KEY" value={dictionary.keyColumns} />
                    )}
                    {dictionary.attributeColumns && (
                        <ObjectFact label="ATTRIBUTES" value={dictionary.attributeColumns} />
                    )}
                    {dictionary.elementCount && (
                        <ObjectFact label="ENTRIES" value={formatCount(dictionary.elementCount)} />
                    )}
                    {dictionary.memoryBytes && (
                        <ObjectFact label="MEMORY" value={formatBytes(dictionary.memoryBytes)} />
                    )}
                    {dictionary.lastSuccessfulUpdate && (
                        <ObjectFact label="LAST UPDATED" value={dictionary.lastSuccessfulUpdate} />
                    )}
                </div>
            </section>
        );
    }

    if (selection.kind === 'projection') {
        return (
            <section className="object-details" data-kind="projection" aria-label="Selected object">
                {onClose && (
                    <button
                        type="button"
                        className="object-details-close"
                        aria-label="Close object details"
                        onClick={onClose}
                    >
                        ×
                    </button>
                )}
                <div className="object-details-hero">
                    <span className="object-kind-badge">PROJECTION</span>
                    <strong>{selection.projection.name}</strong>
                    <code>
                        {selection.table.database}.{selection.table.name}
                    </code>
                    <small>{selection.projection.type}</small>
                </div>
                <div className="object-fact-list">
                    {selection.projection.sortingKey && (
                        <ObjectFact label="SORTING KEY" value={selection.projection.sortingKey} />
                    )}
                </div>
            </section>
        );
    }

    return (
        <section className="object-details" data-kind="skip-index" aria-label="Selected object">
            {onClose && (
                <button
                    type="button"
                    className="object-details-close"
                    aria-label="Close object details"
                    onClick={onClose}
                >
                    ×
                </button>
            )}
            <div className="object-details-hero">
                <span className="object-kind-badge">SKIP INDEX</span>
                <strong>{selection.index.name}</strong>
                <code>
                    {selection.table.database}.{selection.table.name}
                </code>
                <small>{selection.index.type}</small>
            </div>
            <div className="object-fact-list">
                <ObjectFact label="EXPRESSION" value={selection.index.expression} />
                <ObjectFact label="GRANULARITY" value={selection.index.granularity} />
            </div>
        </section>
    );
}

type RelationDetailsProps = Omit<ObjectDetailsProps, 'selection' | 'onInsert'> & {
    selection: Extract<ExplorerSelection, { kind: 'relation' }>;
};

function RelationDetails({
    copy,
    selection,
    tableActions,
    trusted,
    expert,
    copiedId,
    onClose,
    onCopy,
    onOpenSqlDraft,
    onOpenReference,
    onOpenParts,
    onSelect,
    search,
    onBrowseTable,
    canBrowse,
}: RelationDetailsProps) {
    const { table, columns } = selection;
    const qualified = qualifiedTableName(table);
    const [activeTab, setActiveTab] = useState<'columns' | 'overview'>('columns');
    const [columnSearch, setColumnSearch] = useState(() => {
        const query = search.trim();
        return columns.some(column =>
            `${column.name} ${column.type} ${column.defaultKind} ${column.comment}`
                .toLowerCase()
                .includes(query.toLowerCase()),
        )
            ? query
            : '';
    });
    const tabsId = useId();

    return (
        <section
            className="object-details"
            data-kind={selection.relationKind}
            aria-label="Selected object"
        >
            {onClose && (
                <button
                    type="button"
                    className="object-details-close"
                    aria-label="Close object details"
                    onClick={onClose}
                >
                    ×
                </button>
            )}
            <div className="object-details-hero">
                <div className="object-details-title">
                    <span className="object-kind-badge">
                        {selection.relationKind === 'view' ? 'VIEW' : 'TABLE'}
                    </span>
                    <strong>{table.name}</strong>
                </div>
                <code>
                    {table.database}.{table.name}
                </code>
                <small>
                    {table.engine} · {tableSummary(table, copy)}
                </small>
            </div>
            <div className="object-relation-actions">
                <div className="object-action-grid">
                    <Button
                        variant="primary"
                        className="toolbar-small object-preview-action"
                        disabled={!trusted}
                        title={!trusted ? copy.runActionTrustRequired : undefined}
                        onClick={() => {
                            const sql = tableQuerySql(table, columns, 'preview');
                            onOpenSqlDraft(
                                `Preview ${table.name}.sql`,
                                sql,
                                true,
                                true,
                                undefined,
                                { generatedPreviewSql: sql },
                            );
                        }}
                    >
                        <Icon name="table" />
                        {copy.previewRows}
                    </Button>
                    {selection.relationKind === 'table' && canBrowse && onBrowseTable && (
                        <Button variant="secondary" className="toolbar-small" disabled={!trusted}
                            title={!trusted ? copy.runActionTrustRequired : 'Browse bounded live table pages'}
                            onClick={() => onBrowseTable(selection)}>
                            <Icon name="table" />
                            Browse table
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        className="toolbar-small object-copy-name-action"
                        onClick={() => void onCopy(qualified, selection.id)}
                    >
                        <Icon name="copy" />
                        {copiedId === selection.id ? copy.copied : copy.copyName}
                    </Button>
                </div>
                {tableActions}
            </div>
            {expert && (table.engine.endsWith('MergeTree') || table.database === 'system') && (
                <div className="object-reference-actions">
                    {table.engine.endsWith('MergeTree') && (
                        <Button
                            variant="secondary"
                            className="toolbar-small object-parts-action"
                            disabled={!trusted}
                            title={!trusted ? copy.runActionTrustRequired : undefined}
                            onClick={() => onOpenParts(table)}
                        >
                            <Icon name="chart" />
                            {copy.partsVisualize}
                        </Button>
                    )}
                    {table.database === 'system' && (
                        <Button
                            variant="ghost"
                            className="toolbar-small"
                            onClick={() => onOpenReference(table.name, 'System Table')}
                        >
                            <Icon name="reference" />
                            {copy.referenceSystemTable}
                        </Button>
                    )}
                </div>
            )}
            <div className="object-detail-tabs" role="tablist" aria-label="Table details">
                <button
                    type="button"
                    role="tab"
                    id={`${tabsId}-columns-tab`}
                    aria-selected={activeTab === 'columns'}
                    aria-controls={`${tabsId}-columns-panel`}
                    onClick={() => setActiveTab('columns')}
                >
                    {copy.columns}
                    <span>{columns.length.toLocaleString()}</span>
                </button>
                <button
                    type="button"
                    role="tab"
                    id={`${tabsId}-overview-tab`}
                    aria-selected={activeTab === 'overview'}
                    aria-controls={`${tabsId}-overview-panel`}
                    onClick={() => setActiveTab('overview')}
                >
                    {copy.overview}
                </button>
            </div>
            <div
                className="object-detail-tab-panel"
                role="tabpanel"
                id={`${tabsId}-columns-panel`}
                aria-labelledby={`${tabsId}-columns-tab`}
                hidden={activeTab !== 'columns'}
            >
                <TableColumnsPanel
                    columns={columns}
                    search={columnSearch}
                    onSearch={setColumnSearch}
                    copy={copy}
                    onSelectColumn={column =>
                        onSelect(explorerColumnId(column.database, column.table, column.name))
                    }
                />
            </div>
            <div
                className="object-detail-tab-panel"
                role="tabpanel"
                id={`${tabsId}-overview-panel`}
                aria-labelledby={`${tabsId}-overview-tab`}
                hidden={activeTab !== 'overview'}
            >
                <TableMetadata table={table} />
            </div>
        </section>
    );
}

const COLUMN_ROW_HEIGHT = 36;
const COLUMN_OVERSCAN = 5;

function TableColumnsPanel({
    columns,
    search,
    onSearch,
    copy,
    onSelectColumn,
}: {
    columns: readonly SchemaColumn[];
    search: string;
    onSearch: (value: string) => void;
    copy: Copy['common'];
    onSelectColumn: (column: SchemaColumn) => void;
}) {
    const viewport = useRef<HTMLDivElement>(null);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return columns;
        return columns.filter(column =>
            `${column.name} ${column.type} ${column.defaultKind} ${column.comment}`
                .toLowerCase()
                .includes(query),
        );
    }, [columns, search]);
    const hasColumns = filtered.length > 0;
    const totalHeight = filtered.length * COLUMN_ROW_HEIGHT;
    const visibleCount = Math.ceil(viewportHeight / COLUMN_ROW_HEIGHT) + COLUMN_OVERSCAN * 2;
    const start = Math.min(
        Math.max(0, Math.floor(scrollTop / COLUMN_ROW_HEIGHT) - COLUMN_OVERSCAN),
        Math.max(0, filtered.length - visibleCount),
    );
    const visible = filtered.slice(start, start + visibleCount);

    useLayoutEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const measure = () => setViewportHeight(element.clientHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [hasColumns]);

    useEffect(() => {
        if (viewport.current) viewport.current.scrollTop = 0;
        setScrollTop(0);
    }, [search, columns]);

    return (
        <div className="object-columns-panel">
            <div className="object-columns-toolbar">
                <label className="object-column-search">
                    <Icon name="search" />
                    <input
                        value={search}
                        onChange={event => onSearch(event.target.value)}
                        placeholder={copy.searchColumns}
                        aria-label={copy.searchColumns}
                    />
                </label>
                <span aria-live="polite">
                    {filtered.length.toLocaleString()} / {columns.length.toLocaleString()}
                </span>
            </div>
            {filtered.length ? (
                <div
                    className="object-column-list-viewport"
                    ref={viewport}
                    style={
                        {
                            '--object-column-list-height': `${totalHeight}px`,
                        } as React.CSSProperties
                    }
                    onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
                >
                    <div className="object-column-list" role="list" style={{ height: totalHeight }}>
                        <div
                            className="object-column-list-window"
                            style={{ transform: `translateY(${start * COLUMN_ROW_HEIGHT}px)` }}
                        >
                            {visible.map(column => (
                                <div
                                    className="object-column-list-row"
                                    key={`${column.database}.${column.table}.${column.name}`}
                                    role="listitem"
                                    title={column.comment || undefined}
                                    aria-label={[
                                        column.name,
                                        column.type,
                                        column.defaultKind,
                                        column.comment,
                                    ]
                                        .filter(Boolean)
                                        .join(', ')}
                                    style={{ height: COLUMN_ROW_HEIGHT }}
                                >
                                    <span className="object-column-name">
                                        <button
                                            type="button"
                                            onClick={() => onSelectColumn(column)}
                                        >
                                            {column.name}
                                        </button>
                                        {column.defaultKind && <small>DEFAULT</small>}
                                    </span>
                                    <code
                                        className="result-type-badge"
                                        data-type-group={resultTypeGroup(column.type)}
                                        title={column.type}
                                    >
                                        {column.type}
                                    </code>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="object-columns-empty">
                    {columns.length ? copy.noColumnsMatch : copy.noColumnsAvailable}
                </div>
            )}
        </div>
    );
}

function ObjectFact({ label, value }: { label: string; value: string }) {
    return (
        <div className="object-fact">
            <span>{label}</span>
            <code>{value}</code>
        </div>
    );
}

function qualifiedTableName(table: SchemaTable) {
    return `${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}`;
}

function tableSummary(table: SchemaTable, copy: Copy['common']): string {
    const values = [
        table.rowEstimate == null
            ? undefined
            : `${formatCount(table.rowEstimate)} ${copy.rowsEstimated}`,
        table.sizeBytes == null ? undefined : formatBytes(table.sizeBytes),
        table.activeParts == null ? undefined : `${formatCount(table.activeParts)} ${copy.parts}`,
    ].filter((value): value is string => Boolean(value));
    return (
        values.join(' · ') ||
        (table.database === 'system' ? copy.systemTable : copy.metadataUnavailable)
    );
}

function TableMetadata({ table }: { table: SchemaTable }) {
    const stats = [
        table.rowEstimate === undefined
            ? undefined
            : {
                  label: 'Row estimate',
                  value:
                      table.rowEstimate === null
                          ? 'Unavailable'
                          : `${formatCount(table.rowEstimate)} rows`,
                  detail: table.rowEstimate ?? undefined,
              },
        table.sizeBytes === undefined
            ? undefined
            : {
                  label: 'Reported size',
                  value: table.sizeBytes === null ? 'Unavailable' : formatBytes(table.sizeBytes),
                  detail:
                      table.sizeBytes === null
                          ? undefined
                          : `ClickHouse reports ${table.sizeBytes} bytes. On-disk tables report compressed size; in-memory tables report an approximate memory size.`,
              },
        table.uncompressedBytes === undefined
            ? undefined
            : {
                  label: 'Uncompressed size',
                  value:
                      table.uncompressedBytes === null
                          ? 'Unavailable'
                          : formatBytes(table.uncompressedBytes),
                  detail: table.uncompressedBytes ?? undefined,
              },
        table.parts === undefined && table.activeParts === undefined
            ? undefined
            : {
                  label: 'Parts',
                  value: `${table.activeParts == null ? '—' : formatCount(table.activeParts)} active · ${table.parts == null ? '—' : formatCount(table.parts)} total`,
                  detail: undefined,
              },
    ].filter((stat): stat is NonNullable<typeof stat> => Boolean(stat));
    const keys = [
        ['ORDER BY', table.orderBy],
        ['PRIMARY KEY', table.primaryKey],
        ['PARTITION BY', table.partitionKey],
        ['SAMPLE BY', table.samplingKey],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));
    const hasKeyMetadata =
        table.orderBy !== undefined ||
        table.primaryKey !== undefined ||
        table.partitionKey !== undefined ||
        table.samplingKey !== undefined;

    return (
        <div className="schema-table-metadata">
            {stats.length > 0 && (
                <div className="schema-stat-grid">
                    {stats.map(stat => (
                        <div
                            className="schema-stat"
                            key={stat.label}
                            title={stat.detail ? `${stat.label}: ${stat.detail}` : undefined}
                        >
                            <span>{stat.label}</span>
                            <strong>{stat.value}</strong>
                        </div>
                    ))}
                </div>
            )}
            {(keys.length > 0 || hasKeyMetadata) && (
                <div className="schema-key-list">
                    {keys.length ? (
                        keys.map(([label, value]) => (
                            <div className="schema-key" key={label}>
                                <span>{label}</span>
                                <code>{value}</code>
                            </div>
                        ))
                    ) : (
                        <div className="schema-metadata-empty">No table keys configured</div>
                    )}
                </div>
            )}
            {table.ttlConfigured !== undefined && (
                <div
                    className={cx('schema-ttl', table.ttlConfigured ? 'is-configured' : 'is-empty')}
                >
                    <span>TTL</span>
                    <strong>{table.ttlConfigured ? 'Configured' : 'None'}</strong>
                </div>
            )}
            {table.materializedViewTarget && (
                <div className="schema-view-target">
                    <span>WRITES TO</span>
                    <code>{table.materializedViewTarget}</code>
                </div>
            )}
        </div>
    );
}
