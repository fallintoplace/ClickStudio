import type { ApiError } from '../../shared/types';
import type { Copy } from '../i18n';
import { queryFailureSummary, sqlErrorExcerpt, type SqlErrorRange } from '../sql-error';

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
    return <div className="result-failure" data-testid="query-failure">
        <div className="result-failure-message" role="alert">
            <div className="result-failure-heading">
                <span className="status-light is-error" aria-hidden="true"/>
                <h3>{title}</h3>
                {location && <span className="result-failure-location">{copy.errorLocation.replace('{line}', String(location.line)).replace('{column}', String(location.column))}</span>}
            </div>
            <pre className="result-failure-detail"><span className="result-failure-code">[{error.code}]</span> {error.message}</pre>
        </div>
        {sql && <><h3 className="result-failure-sql-label">{copy.failedSql}</h3><pre className="result-execution-sql is-full">{sqlErrorExcerpt(sql, errorRange)}</pre></>}
    </div>;
}
