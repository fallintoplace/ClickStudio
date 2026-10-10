import { useEffect, useRef, useState } from 'react';
import type { WorkspaceToastMessage } from '../useWorkspaceNotifications';
import { cx, Icon } from './ui';

export function WorkspaceToast({
    notification,
    onDismiss,
}: {
    notification: WorkspaceToastMessage;
    onDismiss?: () => void;
}) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const remaining = useRef(notification.timeoutMs ?? 0);
    const paused = hovered || focused;

    useEffect(() => {
        if (notification.timeoutMs === null || paused || !onDismiss) return;
        const started = performance.now();
        const timer = window.setTimeout(onDismiss, remaining.current);
        return () => {
            window.clearTimeout(timer);
            remaining.current = Math.max(0, remaining.current - (performance.now() - started));
        };
    }, [notification.timeoutMs, onDismiss, paused]);

    return (
        <div
            className={cx(
                'toast animate-enter',
                `toast-${notification.tone}`,
                paused && 'is-paused',
            )}
            role="alert"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
            }}
        >
            <span aria-hidden="true">!</span>
            <div className="toast-content">
                <p>{notification.message}</p>
                {notification.detail && (
                    <details>
                        <summary>Details</summary>
                        <pre>{notification.detail}</pre>
                    </details>
                )}
            </div>
            {notification.action && (
                <button
                    className="toast-action"
                    onClick={() => {
                        notification.action?.onSelect();
                        onDismiss?.();
                    }}
                >
                    {notification.action.label}
                </button>
            )}
            {onDismiss && (
                <button
                    className="toast-dismiss"
                    onClick={onDismiss}
                    aria-label={notification.tone === 'error' ? 'Dismiss error' : 'Dismiss message'}
                >
                    <Icon name="close" />
                </button>
            )}
            {notification.timeoutMs !== null && (
                <div
                    className="toast-timer"
                    style={{ animationDuration: `${notification.timeoutMs}ms` }}
                    aria-hidden="true"
                />
            )}
        </div>
    );
}
