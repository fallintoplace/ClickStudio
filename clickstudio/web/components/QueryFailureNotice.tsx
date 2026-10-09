import { useId, useState } from 'react';
import type { ApiError } from '../../shared/types';
import type { Copy } from '../i18n';
import { queryFailureSummary, sqlErrorLineColumn, type SqlErrorRange } from '../sql-error';
import { Button } from './ui';

export function QueryFailureNotice({ error, sql, copy, errorRange, draftSql, onRevealRange }: {
    error: ApiError;
    sql?: string;
    copy: Copy['common'];
    errorRange?: SqlErrorRange;
    draftSql: string;
    onRevealRange: (from: number, to: number) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const detailsId = useId();
    const diagnostic = queryFailureSummary(error);
    const location = errorRange ? sqlErrorLineColumn(draftSql, errorRange.from) : undefined;
    const summary = diagnostic.syntax
        ? diagnostic.token ? copy.errorNearToken.replace('{token}', diagnostic.token) : copy.syntaxErrorDescription
        : diagnostic.message || copy.queryFailed;
    return <div className="result-failure" data-testid="query-failure" role="alert">
        <div className="result-failure-heading">
            <span className="status-light is-error" aria-hidden="true"/>
            <div><div className="result-failure-title"><strong>{diagnostic.syntax ? copy.syntaxError : copy.queryFailed}</strong>{location && <span>{copy.errorLocation.replace('{line}', String(location.line)).replace('{column}', String(location.column))}</span>}</div><span>{summary}</span></div>
            <div className="result-failure-actions">
                {errorRange && <Button variant="ghost" onClick={() => onRevealRange(errorRange.from, errorRange.to)}>{copy.goToError}</Button>}
                <Button variant="ghost" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}>{copy.errorDetails}</Button>
            </div>
        </div>
        <div id={detailsId} className="result-failure-diagnostics" hidden={!expanded}>
            <span className="result-failure-code">{error.code}</span>
            <pre className="result-failure-detail">{error.message}</pre>
            {sql && <><span className="result-failure-sql-label">{copy.failedSql}</span><pre className="result-execution-sql is-full">{sql}</pre></>}
        </div>
    </div>;
}
