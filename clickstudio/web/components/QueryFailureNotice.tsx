import type { ApiError } from '../../shared/types';
import type { Copy } from '../i18n';
import { queryFailureSummary, sqlErrorContext, sqlErrorLineColumn, type SqlErrorRange } from '../sql-error';

export function QueryFailureNotice({ error, sql, copy, errorRange, location }: {
    error: ApiError;
    sql?: string;
    copy: Copy['common'];
    errorRange?: SqlErrorRange;
    location?: { line: number; column: number };
}) {
    const diagnostic = queryFailureSummary(error);
    const title = diagnostic.syntax
        ? diagnostic.token ? copy.syntaxErrorNearToken.replace('{token}', diagnostic.token) : copy.syntaxError
        : copy.queryFailed;
    const lineOffset = sql && errorRange && location ? location.line - sqlErrorLineColumn(sql, errorRange.from).line : 0;
    const context = sql ? sqlErrorContext(sql, errorRange, lineOffset) : [];
    return <div className="result-failure" data-testid="query-failure">
        <div className="result-failure-message" role="alert">
            <div className="result-failure-heading">
                <span className="status-light is-error" aria-hidden="true"/>
                <h3>{title}</h3>
                {location && <span className="result-failure-location">{copy.errorLocation.replace('{line}', String(location.line)).replace('{column}', String(location.column))}</span>}
                <code className="result-failure-code">{error.code}</code>
            </div>
            {!diagnostic.syntax && diagnostic.message && <p className="result-failure-summary">{diagnostic.message}</p>}
        </div>
        {sql && <><h3 className="result-failure-sql-label">{copy.failedSql}</h3><pre className="result-execution-sql is-context">{context.map(line => <span className={`result-failure-line${line.marker ? ' is-error' : ''}`} key={line.number}>
            <span className="result-failure-line-number" aria-hidden="true">{line.number}</span><span>{line.text}{line.marker && <span className="result-failure-marker">{'\n'}{line.marker}</span>}</span>
        </span>)}</pre></>}
        <details className="result-failure-diagnostics">
            <summary>{copy.errorDetails}</summary>
            <pre className="result-failure-detail">[{error.code}] {error.message}</pre>
            {sql && <><h3 className="result-failure-sql-label">{copy.failedSql}</h3><pre className="result-execution-sql is-full">{sql}</pre></>}
        </details>
    </div>;
}
