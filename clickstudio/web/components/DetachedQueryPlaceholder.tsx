import type { Copy } from '../i18n';
import { Button, Icon } from './ui';

export function DetachedQueryPlaceholder({
    name,
    copy,
    collapsed,
    onFocus,
    onDock,
}: {
    name: string;
    copy: Copy['common'];
    collapsed: boolean;
    onFocus: () => void;
    onDock: () => void;
}) {
    return <section className="editor-surface detached-query-placeholder" aria-label={copy.detachedQueryStatus}>
        <div className="editor-heading">
            <div className="editor-file-heading">
                <span className="file-type-icon">SQL</span>
                <div className="document-name">
                    <span className="eyebrow">{copy.query}</span>
                    <span className="detached-query-name" title={name}>{name}</span>
                </div>
            </div>
            <div className="editor-heading-tools detached-query-status"><span className="editor-language-dot"/><span>{copy.detachedQueryStatus}</span></div>
            <div className="editor-heading-actions detached-query-actions">
                <Button variant="secondary" className="toolbar-small" onClick={onFocus}>{copy.focusQueryEditor}</Button>
                <Button variant="ghost" className="panel-window-button" aria-label={copy.dockQueryEditor} title={copy.dockQueryEditor} onClick={onDock}><Icon name="dock"/></Button>
            </div>
        </div>
        {!collapsed && <div className="panel-content detached-query-placeholder-content">
            <Icon name="newWindow"/>
            <div><strong>{copy.detachedQueryStatus}</strong><p>{copy.detachedQueryDescription}</p></div>
        </div>}
    </section>;
}
