import type { Copy } from '../i18n';
import { Button, Icon } from './ui';

export function DetachedResultsPlaceholder({
    title,
    eyebrow,
    queryName,
    copy,
    collapsed,
    onFocus,
    onDock,
}: {
    title: string;
    eyebrow: string;
    queryName: string;
    copy: Copy['common'];
    collapsed: boolean;
    onFocus: () => void;
    onDock: () => void;
}) {
    return <section className={`results-surface detached-results-placeholder${collapsed ? ' is-collapsed' : ''}`} aria-label={copy.detachedResultsStatus}>
        <div className="results-header">
            <div className="results-title">
                <span className="results-mark"><Icon name="chart"/></span>
                <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
            </div>
            <div className="results-actions detached-results-actions">
                <span className="detached-results-query" title={queryName}>{queryName}</span>
                <Button variant="secondary" className="toolbar-small" onClick={onFocus}>{copy.focusResultsPanel}</Button>
                <Button variant="ghost" className="panel-window-button" aria-label={copy.dockResultsPanel} title={copy.dockResultsPanel} onClick={onDock}><Icon name="dock"/></Button>
            </div>
        </div>
        {!collapsed && <div className="panel-content detached-results-placeholder-content">
            <Icon name="newWindow"/>
            <div><strong>{copy.detachedResultsStatus}</strong><p>{copy.detachedResultsDescription}</p></div>
        </div>}
    </section>;
}
