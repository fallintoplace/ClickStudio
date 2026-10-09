import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { ApiError } from '../../shared/types';
import type { Copy } from '../i18n';
import { queryFailureSummary, sqlErrorLineColumn, type SqlErrorRange } from '../sql-error';
import { Button, Icon } from './ui';

export function QueryFailureNotice({ error, sql, copy, errorRange, draftSql }: {
    error: ApiError;
    sql?: string;
    copy: Copy['common'];
    errorRange?: SqlErrorRange;
    draftSql: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const [position, setPosition] = useState<CSSProperties>();
    const details = useRef<HTMLDivElement>(null);
    const detailsId = useId();
    const diagnostic = queryFailureSummary(error);
    const location = errorRange ? sqlErrorLineColumn(draftSql, errorRange.from) : undefined;
    const title = diagnostic.syntax
        ? diagnostic.token ? copy.syntaxErrorNearToken.replace('{token}', diagnostic.token) : copy.syntaxError
        : copy.queryFailed;
    useEffect(() => {
        if (!expanded) return;
        const panel = details.current;
        const ownerDocument = panel?.ownerDocument;
        const ownerWindow = ownerDocument?.defaultView;
        if (!panel || !ownerDocument || !ownerWindow) return;
        const dismiss = (event: Event) => {
            if (event.type === 'scroll' && panel.contains(event.target as Node)) return;
            panel.hidePopover();
        };
        ownerWindow.addEventListener('resize', dismiss);
        ownerDocument.addEventListener('scroll', dismiss, true);
        return () => {
            ownerWindow.removeEventListener('resize', dismiss);
            ownerDocument.removeEventListener('scroll', dismiss, true);
        };
    }, [expanded]);
    return <div className="result-failure" data-testid="query-failure">
        <div className="result-failure-heading">
            <span className="status-light is-error" aria-hidden="true"/>
            <div className="result-failure-message" role="alert">
                <strong>{title}</strong>
                {!diagnostic.syntax && diagnostic.message && diagnostic.message !== title && <span>{diagnostic.message}</span>}
                {location && <span>{copy.errorLocation.replace('{line}', String(location.line)).replace('{column}', String(location.column))}</span>}
            </div>
            <div className="result-failure-actions">
                <Button variant="ghost" aria-expanded={expanded} aria-controls={detailsId} aria-haspopup="dialog" popoverTarget={detailsId} onClick={event => {
                    const ownerWindow = event.currentTarget.ownerDocument.defaultView;
                    if (!ownerWindow) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const width = Math.min(560, ownerWindow.innerWidth - 16);
                    const above = rect.top >= 180;
                    setPosition({
                        left: Math.max(8, Math.min(rect.right - width, ownerWindow.innerWidth - width - 8)),
                        top: above ? 'auto' : rect.bottom + 6,
                        bottom: above ? ownerWindow.innerHeight - rect.top + 6 : 'auto',
                        maxHeight: Math.min(420, above ? rect.top - 14 : ownerWindow.innerHeight - rect.bottom - 14),
                    });
                }}>{copy.errorDetails}</Button>
            </div>
        </div>
        <div ref={details} id={detailsId} popover="auto" role="dialog" aria-label={copy.errorDetails} className="result-failure-diagnostics" style={position} onToggle={event => setExpanded(event.newState === 'open')}>
            <div className="result-failure-diagnostics-heading"><span className="result-failure-code">{error.code}</span><Button variant="ghost" className="icon-only" aria-label={copy.closePanel} popoverTarget={detailsId} popoverTargetAction="hide"><Icon name="close"/></Button></div>
            <pre className="result-failure-detail">{error.message}</pre>
            {sql && <><span className="result-failure-sql-label">{copy.failedSql}</span><pre className="result-execution-sql is-full">{sql}</pre></>}
        </div>
    </div>;
}
