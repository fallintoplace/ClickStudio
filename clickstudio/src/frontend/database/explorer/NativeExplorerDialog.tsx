import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../common/components/ui';

export function NativeExplorerDialog({
    title,
    description,
    onClose,
    children,
    closeLabel = 'Close explorer',
}: {
    closeLabel?: string;
    title: string;
    description?: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const root = useRef<HTMLElement>(null),
        close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        const previous =
            document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const dialog = root.current;
        dialog?.focus();
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close.current();
            }
            if (event.key !== 'Tab' || !dialog) return;
            const controls = [
                ...dialog.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"], summary',
                ),
            ].filter(element => element.getClientRects().length > 0);
            const first = controls[0],
                last = controls.at(-1);
            if (!first) {
                event.preventDefault();
                dialog.focus();
            } else if (
                event.shiftKey &&
                (document.activeElement === first || document.activeElement === dialog)
            ) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        dialog?.addEventListener('keydown', keydown);
        return () => {
            dialog?.removeEventListener('keydown', keydown);
            if (previous?.isConnected) previous.focus();
        };
    }, []);
    return (
        <div className="parts-explorer-layer native-explorer-layer">
            <button
                type="button"
                className="parts-explorer-scrim"
                aria-label={closeLabel}
                onClick={onClose}
            />
            <section
                ref={root}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="parts-explorer-dialog native-dialog"
            >
                <header className="native-heading">
                    <div>
                        <span className="eyebrow">CLICKHOUSE NATIVE</span>
                        <h2>{title}</h2>
                        {description && <p>{description}</p>}
                    </div>
                    <Button aria-label={closeLabel} onClick={onClose}>
                        Close ×
                    </Button>
                </header>
                {children}
            </section>
        </div>
    );
}
