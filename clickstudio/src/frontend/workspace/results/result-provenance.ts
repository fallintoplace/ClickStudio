import { sameParameters } from '../queries/history/evidence.js';
import { splitSql } from '../../../shared/sql/sql.js';
import type { Run } from '../../../shared/queries/execution/types.js';

type ResultSource = Pick<Run, 'sql' | 'parameters' | 'connectionId' | 'sourceFrom' | 'sourceTo'>;
type CurrentDraft = {
    sql: string;
    parameters: Readonly<Record<string, string>>;
    connectionId: string;
};

function containsExecutedSql(run: ResultSource, sql: string): boolean {
    const executed = run.sql.trim();
    if (!executed) return false;
    if (sql.trim() === executed) return true;
    if (
        run.sourceFrom !== undefined &&
        run.sourceTo !== undefined &&
        run.sourceFrom >= 0 &&
        run.sourceTo >= run.sourceFrom &&
        run.sourceTo <= sql.length &&
        sql.slice(run.sourceFrom, run.sourceTo).trim() === executed
    )
        return true;
    try {
        return splitSql(sql).some(statement => statement.sql.trim() === executed);
    } catch {
        return false;
    }
}

export function retainedResultChange(
    run: ResultSource,
    draft: CurrentDraft,
): 'query' | 'parameters' | 'connection' | undefined {
    if (run.connectionId !== draft.connectionId) return 'connection';
    if (!containsExecutedSql(run, draft.sql)) return 'query';
    if (!sameParameters(run.parameters, draft.parameters)) return 'parameters';
    return undefined;
}
