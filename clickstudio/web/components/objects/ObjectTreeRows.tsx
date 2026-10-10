import { type CSSProperties } from 'react';
import type { SchemaTable } from '../../../shared/types';
import { quoteIdentifier } from '../../../shared/sql';
import { cx, Icon } from '../ui';

export function ExplorerGroupRow({
    level,
    label,
    count,
    expanded,
    onToggle,
    database = false,
    kind = 'table',
}: {
    level: number;
    label: string;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    database?: boolean;
    kind?: 'table' | 'view' | 'dictionary' | 'column' | 'projection' | 'index';
}) {
    return (
        <div
            role="treeitem"
            aria-level={level}
            aria-expanded={expanded}
            className={cx(
                'object-tree-row',
                'is-group',
                database && 'is-database',
                !database && `is-${kind}`,
            )}
            style={{ '--tree-indent': `${Math.max(0, level - 1) * 12}px` } as CSSProperties}
        >
            <button
                type="button"
                className="object-tree-toggle"
                aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
                onClick={onToggle}
            >
                <span className={cx(expanded && 'is-open')}>
                    <Icon name="chevron" />
                </span>
            </button>
            <button type="button" className="object-tree-main" title={label} onClick={onToggle}>
                <span className={cx('object-kind-glyph', database && 'is-database')}>
                    <Icon name={database ? 'database' : kind} />
                </span>
                <span className="object-tree-label">
                    <strong>{label}</strong>
                </span>
                <small className="object-tree-count">{count.toLocaleString()}</small>
            </button>
        </div>
    );
}

export function ObjectLeafRow({
    level,
    selected,
    glyph,
    label,
    meta,
    onSelect,
    onInsert,
    insertLabel,
}: {
    level: number;
    selected: boolean;
    glyph: 'column' | 'projection' | 'index' | 'dictionary';
    label: string;
    meta?: string;
    onSelect: () => void;
    onInsert?: () => void;
    insertLabel?: string;
}) {
    return (
        <div
            role="treeitem"
            aria-level={level}
            aria-selected={selected}
            className={cx(
                'object-tree-row',
                'is-object',
                'is-leaf',
                `is-${glyph}`,
                selected && 'is-selected',
            )}
            style={{ '--tree-indent': `${Math.max(0, level - 1) * 12}px` } as CSSProperties}
        >
            <span className="object-tree-toggle object-tree-spacer" />
            <button
                type="button"
                className="object-tree-main"
                title={meta ? `${label} · ${meta}` : label}
                onClick={onSelect}
            >
                <span className="object-kind-glyph">
                    <Icon name={glyph} />
                </span>
                <span className="object-tree-label">
                    <strong>{label}</strong>
                    {meta && <small>{meta}</small>}
                </span>
            </button>
            {onInsert && (
                <button
                    type="button"
                    className="object-tree-inline-action"
                    title={insertLabel}
                    aria-label={`${insertLabel}: ${label}`}
                    onClick={onInsert}
                >
                    <Icon name="plus" />
                </button>
            )}
        </div>
    );
}

export function qualifiedTableName(table: SchemaTable) {
    return `${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}`;
}
