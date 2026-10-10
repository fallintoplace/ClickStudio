import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Copy } from '../i18n';
import { Button, Icon } from './ui';

function positionPopover(element: HTMLDivElement, button: HTMLButtonElement) {
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    const anchor = button.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, view.innerWidth - bounds.width - 8));
    const top =
        anchor.bottom + 6 + bounds.height <= view.innerHeight - 8
            ? anchor.bottom + 6
            : Math.max(8, anchor.top - bounds.height - 6);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
}

export function ChartPopover({
    label,
    closeLabel,
    trigger,
    children,
    iconOnly = false,
}: {
    label: string;
    closeLabel: string;
    trigger: ReactNode;
    children: ReactNode;
    iconOnly?: boolean;
}) {
    const id = useId();
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = panel.current;
        const document = element?.ownerDocument;
        const view = document?.defaultView;
        if (!element || !document || !view) return;
        const close = () => {
            if (element.matches(':popover-open')) element.hidePopover();
        };
        const positionOnScroll = (event: Event) => {
            if (
                element.matches(':popover-open') &&
                button.current &&
                !element.contains(event.target as Node)
            )
                positionPopover(element, button.current);
        };
        const closeOnFocusOutside = (event: FocusEvent) => {
            if (
                !element.contains(event.target as Node) &&
                !button.current?.contains(event.target as Node)
            )
                close();
        };
        view.addEventListener('resize', close);
        document.addEventListener('scroll', positionOnScroll, true);
        document.addEventListener('focusin', closeOnFocusOutside);
        return () => {
            view.removeEventListener('resize', close);
            document.removeEventListener('scroll', positionOnScroll, true);
            document.removeEventListener('focusin', closeOnFocusOutside);
        };
    }, []);

    return (
        <span className="chart-popover-control">
            <button
                ref={button}
                type="button"
                className={`button-base button-secondary chart-popover-trigger${iconOnly ? ' is-icon-only' : ''}`}
                popoverTarget={id}
                aria-label={label}
                aria-haspopup="dialog"
                title={label}
            >
                {trigger}
                {!iconOnly && <Icon name="chevron" />}
            </button>
            <div
                ref={panel}
                id={id}
                className="chart-popover"
                popover="auto"
                role="dialog"
                aria-label={label}
                tabIndex={-1}
                onToggle={event => {
                    if (event.newState !== 'open' || !button.current) return;
                    const element = event.currentTarget;
                    positionPopover(element, button.current);
                    (
                        element.querySelector<HTMLElement>(
                            'input:not(:disabled), select:not(:disabled)',
                        ) ?? element
                    ).focus({ preventScroll: true });
                }}
            >
                <div className="chart-popover-heading">
                    <strong>{label}</strong>
                    <Button
                        variant="ghost"
                        aria-label={`${closeLabel} ${label}`}
                        popoverTarget={id}
                        popoverTargetAction="hide"
                    >
                        <Icon name="close" />
                    </Button>
                </div>
                {children}
            </div>
        </span>
    );
}

export function ChartToolbar({
    title,
    description,
    copy,
    children,
}: {
    title?: string;
    description: string;
    copy: Copy['chart'];
    children: ReactNode;
}) {
    return (
        <div className="chart-toolbar">
            {title && <h3 title={title}>{title}</h3>}
            <div className="chart-controls">
                {children}
                <ChartPopover
                    label={copy.chartDetails}
                    closeLabel={copy.closeControls}
                    trigger={<Icon name="info" />}
                    iconOnly
                >
                    <p>{description}</p>
                </ChartPopover>
            </div>
        </div>
    );
}
