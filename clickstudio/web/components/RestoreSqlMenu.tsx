import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Copy } from '../i18n';
import type { Draft } from '../workspace-state';
import { Icon } from './ui';

export function RestoreSqlMenu({
    closedTabs,
    copy,
    onRestore,
}: {
    closedTabs: readonly Draft[];
    copy: Copy['common'];
    onRestore: (draftId: string) => boolean;
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const closeOnFocusOutside = (event: FocusEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const closeOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            trigger.current?.focus();
        };
        const frame = window.requestAnimationFrame(() =>
            menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(),
        );
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('focusin', closeOnFocusOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('focusin', closeOnFocusOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const items = Array.from(
            menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
        );
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
            event.key === 'ArrowDown'
                ? (current + 1) % items.length
                : event.key === 'ArrowUp'
                  ? (current - 1 + items.length) % items.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : undefined;
        if (next === undefined) return;
        event.preventDefault();
        items[next]?.focus();
    };

    return (
        <div className="restore-sql-menu" ref={root}>
            <button
                ref={trigger}
                type="button"
                className="new-tab-button new-tab-labeled restore-sql-trigger"
                aria-label={copy.restore}
                title={copy.restore}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls="restore-sql-menu-list"
                onClick={() => setOpen(value => !value)}
            >
                <Icon name="history" />
                <span>{copy.restore}</span>
                <Icon name="chevron" />
            </button>
            {open && (
                <div
                    id="restore-sql-menu-list"
                    className="restore-sql-menu-list"
                    role="menu"
                    aria-label={copy.closedSqlTabs}
                    ref={menu}
                    onKeyDown={moveMenuFocus}
                >
                    {closedTabs.map(draft => (
                        <button
                            key={draft.id}
                            type="button"
                            role="menuitem"
                            title={draft.name}
                            onClick={() => {
                                if (onRestore(draft.id)) setOpen(false);
                            }}
                        >
                            <Icon name="documents" />
                            <span className="restore-sql-item-copy">
                                <strong>{draft.name}</strong>
                                {draft.sql.trim() && (
                                    <small>{draft.sql.replace(/\s+/g, ' ').trim()}</small>
                                )}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
