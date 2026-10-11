import type { Statement } from '../../../shared/sql/sql.js';

export function cloudResultStreamQuery(statement: Pick<Statement, 'sql'>): string {
    return `${statement.sql}\nFORMAT JSONCompactEachRowWithNamesAndTypes`;
}
