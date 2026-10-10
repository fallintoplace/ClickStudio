import type { WorkspaceFeedback } from '../useWorkspaceNotifications';
import { Button, cx } from './ui';

export function WorkspaceInlineNotice({
    feedback,
    onRetry,
}: {
    feedback?: WorkspaceFeedback;
    onRetry?: () => void;
}) {
    if (!feedback) return null;
    return (
        <div
            className={cx('workspace-inline-notice', `is-${feedback.tone}`)}
            role={feedback.tone === 'info' ? 'status' : 'alert'}
        >
            <div>
                <p>{feedback.message}</p>
                {feedback.detail && (
                    <details>
                        <summary>Details</summary>
                        <pre>{feedback.detail}</pre>
                    </details>
                )}
            </div>
            {(onRetry || feedback.retry) && (
                <Button
                    variant="secondary"
                    className="toolbar-small"
                    onClick={onRetry ?? feedback.retry}
                >
                    Retry
                </Button>
            )}
        </div>
    );
}
