import type { Run } from '../shared/types.js';
import { lexSql } from '../shared/sql.js';

function rowCountLabel(count: number, action: 'returned' | 'written') {
    const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(count);
    return `${formatted} ${count === 1 ? 'row' : 'rows'} ${action}`;
}

export function statementOutcome(run: Run) {
    if (run.columns.length > 0 || run.rowCount > 0) return rowCountLabel(run.rowCount, 'returned');

    const command = lexSql(run.sql)
        .find(token => token.kind === 'word')
        ?.text.toUpperCase();
    if (command === 'INSERT')
        return run.writtenRows === undefined
            ? 'INSERT completed · row count unavailable'
            : `INSERT completed · ${rowCountLabel(run.writtenRows, 'written')}`;
    if (command === 'CREATE')
        return run.writtenRows !== undefined && run.writtenRows > 0
            ? `CREATE completed · ${rowCountLabel(run.writtenRows, 'written')}`
            : 'CREATE completed';
    return `${command ?? 'Statement'} completed`;
}
