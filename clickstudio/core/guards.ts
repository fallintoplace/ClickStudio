import { EXPLORATION_FORMAT_ERROR, hasTopLevelOutputFormat, lexSql, parameterNames, splitSql, SqlSyntaxError } from '../shared/sql.js';
import type { Principal, RunRequest } from '../shared/types.js';
import { AppError, requireThat } from './errors.js';
export function mustOwn(principal: Principal, owner: string) {
    requireThat(principal.id === owner, 404, 'NOT_FOUND', 'Resource not found');
}
export function canWrite(principal: Principal) {
    requireThat(principal.role === 'owner', 403, 'ROLE_READ_ONLY', 'This identity cannot change or execute workspace objects');
}
const forbidden = new Set(['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME',
    'ATTACH', 'DETACH', 'OPTIMIZE', 'SYSTEM', 'GRANT', 'REVOKE', 'KILL', 'SET', 'SETTINGS', 'OUTFILE']);
/** Defensive UX guard only. Restricted ClickHouse credentials are the authorization boundary. */
export function guardSql(sql: string, parameters: Record<string, string> = {}): void {
    try {
        const statements = splitSql(sql);
        requireThat(statements.length === 1, 400, 'SINGLE_STATEMENT', 'Run one statement, or use Run script');
        const tokens = lexSql(statements[0]!.sql);
        const words = tokens.filter(t => t.kind === 'word');
        const first = words[0]?.text.toUpperCase();
        const showCreate = first === 'SHOW' && words[1]?.text.toUpperCase() === 'CREATE';
        let showSettings = first === 'SHOW' && words[1]?.text.toUpperCase() === 'SETTINGS' ? words[1] : undefined;
        if (first === 'SHOW' && words[1]?.text.toUpperCase() === 'CHANGED' && words[2]?.text.toUpperCase() === 'SETTINGS')
            showSettings = words[2];
        if (showCreate && words[2]?.text.toUpperCase() === 'SETTINGS' && words[3]?.text.toUpperCase() === 'PROFILE')
            showSettings = words[2];
        requireThat(first && ['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(first), 403, 'READ_ONLY_SQL', 'Only read-only SQL is enabled', 'Use the separately authorized import flow for data insertion.');
        requireThat(!hasTopLevelOutputFormat(statements[0]!.sql), 403, 'READ_ONLY_SQL', EXPLORATION_FORMAT_ERROR);
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]!;
            if (token.kind !== 'word')
                continue;
            const upper = token.text.toUpperCase();
            if (upper === 'CREATE' && showCreate && token === words[1])
                continue;
            if (upper === 'SETTINGS' && token === showSettings)
                continue;
            // `system.tables` is a qualified identifier, not a SYSTEM command.
            if (upper === 'SYSTEM' && tokens[i + 1]?.text === '.')
                continue;
            requireThat(!forbidden.has(upper), 403, 'READ_ONLY_SQL', `${upper} is not allowed in exploration SQL`, 'Use the limits form rather than SQL SETTINGS. Quote an identifier that shares a reserved word.');
            const external = /^(url|s3|s3cluster|azureblobstorage|hdfs|file|remote|remotesecure|mysql|postgresql|sqlite|executable|jdbc|odbc)$/i;
            requireThat(!(external.test(token.text) && tokens[i + 1]?.text === '('), 403, 'EXTERNAL_IO', 'External I/O table functions are not enabled in this workspace');
        }
        for (const p of parameterNames(sql))
            requireThat(Object.hasOwn(parameters, p.name), 400, 'MISSING_PARAMETER', `Provide parameter ${p.name} (${p.type})`);
    }
    catch (error) {
        if (error instanceof SqlSyntaxError)
            throw new AppError(400, 'SQL_BOUNDARY', error.message, undefined, error.position);
        throw error;
    }
}
export function guardRun(principal: Principal, request: RunRequest, trusted: boolean) {
    canWrite(principal);
    requireThat(trusted, 403, 'WORKSPACE_UNTRUSTED', 'Trust this connection before executing SQL', 'Review its host, database, identity and limits, then explicitly trust the connection.');
    guardSql(request.sql, request.parameters);
}
