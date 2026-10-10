import type { Copy } from '../i18n';
import { Icon } from './ui';

export function HelpButton({
    copy,
    open,
    onOpen,
}: {
    copy: Copy['common'];
    open: boolean;
    onOpen: (opener: HTMLButtonElement) => void;
}) {
    return (
        <button
            type="button"
            className="help-button"
            aria-label={copy.help}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="workspace-help-panel"
            title={copy.help}
            onClick={event => onOpen(event.currentTarget)}
        >
            <Icon name="help" />
            <span>{copy.help}</span>
        </button>
    );
}
