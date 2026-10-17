import { isJson, isRecord, type Column, type Row } from '../../common/values.js';
import { baseType } from '../../queries/results/results.js';
import { quoteIdentifier, quoteStringLiteral } from '../../sql/sql.js';

export const BROWSE_PAGE_ROWS = 200;
export const MAX_BROWSE_PAGE = 24;
export const MAX_BROWSE_COLUMNS = 500;

export interface TableBrowseRequest {
    database: string;
    table: string;
    orderColumn: string;
    direction: 'asc' | 'desc';
    page: number;
    filterColumn?: string;
    filterValue?: string;
}
export interface TableBrowsePage {
    columns: Column[];
    rows: Row[];
    page: number;
    hasMore: boolean;
    queryId: string;
    scope: 'live-table';
    warning: string;
}
export class BrowseValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BrowseValidationError';
    }
}

function readBrowseName(value: unknown): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > 128)
        throw new BrowseValidationError('Choose a valid table and column.');
    return value;
}
function readBrowsePage(value: unknown): number {
    if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > MAX_BROWSE_PAGE
    )
        throw new BrowseValidationError(
            'Browse the first 25 pages, or narrow the table with a filter.',
        );
    return value;
}
export function parseTableBrowseRequest(value: unknown): TableBrowseRequest {
    if (!isRecord(value)) throw new BrowseValidationError('Invalid table browsing request.');
    const database = readBrowseName(value.database);
    const table = readBrowseName(value.table);
    const orderColumn = readBrowseName(value.orderColumn);
    const page = readBrowsePage(value.page);
    const direction = value.direction;
    if (direction !== 'asc' && direction !== 'desc')
        throw new BrowseValidationError('Choose ascending or descending order.');
    if ((value.filterColumn === undefined) !== (value.filterValue === undefined))
        throw new BrowseValidationError('Choose both a filter column and a value.');
    const filterColumn =
        value.filterColumn === undefined ? undefined : readBrowseName(value.filterColumn);
    const filterValue = value.filterValue;
    if (filterValue !== undefined && (typeof filterValue !== 'string' || filterValue.length > 256))
        throw new BrowseValidationError('Filter values must be at most 256 characters.');
    return {
        database,
        table,
        orderColumn,
        direction,
        page,
        ...(filterColumn !== undefined ? { filterColumn } : {}),
        ...(typeof filterValue === 'string' ? { filterValue } : {}),
    };
}
export function browseColumnSupported(type: string): boolean {
    return /^(?:U?Int\d+|Float\d+|Decimal|String|FixedString|Date|DateTime|UUID|IPv[46]|Enum)/.test(
        baseType(type),
    );
}

/** Generated from verified table columns, not arbitrary SQL fragments. */
export function buildTableBrowseSql(input: TableBrowseRequest, columns: readonly Column[]) {
    const request = parseTableBrowseRequest(input);
    if (columns.length === 0 || columns.length > MAX_BROWSE_COLUMNS)
        throw new BrowseValidationError('This table has too many columns for a bounded preview.');
    const byName = (name: string) => columns.find(column => column.name === name);
    const order = byName(request.orderColumn);
    if (!order || !browseColumnSupported(order.type))
        throw new BrowseValidationError('Choose an available scalar sort column.');
    if (request.filterColumn) {
        const filter = byName(request.filterColumn);
        if (!filter || !browseColumnSupported(filter.type))
            throw new BrowseValidationError('Choose an available scalar filter column.');
    }
    const table = quoteIdentifier(request.database) + '.' + quoteIdentifier(request.table);
    const where = request.filterColumn
        ? ' WHERE toString(' + quoteIdentifier(request.filterColumn) + ') = {browseValue:String}'
        : '';
    const sql =
        'SELECT * FROM ' +
        table +
        where +
        ' ORDER BY ' +
        quoteIdentifier(order.name) +
        ' ' +
        request.direction.toUpperCase() +
        ' LIMIT ' +
        (BROWSE_PAGE_ROWS + 1) +
        ' OFFSET ' +
        request.page * BROWSE_PAGE_ROWS;
    return {
        sql,
        parameters: request.filterColumn ? { browseValue: request.filterValue ?? '' } : {},
    };
}

/** Standalone editable SQL uses safe quoting; API execution remains parameterized. */
export function tableBrowseDraftSql(input: TableBrowseRequest, columns: readonly Column[]) {
    const { sql } = buildTableBrowseSql(input, columns);
    const display = input.filterColumn
        ? sql.replace('{browseValue:String}', quoteStringLiteral(input.filterValue ?? ''))
        : sql;
    return display.replace(
        ' LIMIT ' + (BROWSE_PAGE_ROWS + 1) + ' OFFSET ',
        ' LIMIT ' + BROWSE_PAGE_ROWS + ' OFFSET ',
    );
}

export function isTableBrowsePage(value: unknown): value is TableBrowsePage {
    if (!isRecord(value)) return false;
    const columns = value.columns;
    const rows = value.rows;
    if (
        !Array.isArray(columns) ||
        columns.length > MAX_BROWSE_COLUMNS ||
        !columns.every(
            column =>
                isRecord(column) &&
                typeof column.name === 'string' &&
                typeof column.type === 'string',
        )
    )
        return false;
    if (
        !Array.isArray(rows) ||
        rows.length > BROWSE_PAGE_ROWS ||
        !rows.every(row => Array.isArray(row) && row.length === columns.length && row.every(isJson))
    )
        return false;
    return (
        typeof value.page === 'number' &&
        Number.isSafeInteger(value.page) &&
        value.page >= 0 &&
        typeof value.hasMore === 'boolean' &&
        typeof value.queryId === 'string' &&
        value.scope === 'live-table' &&
        typeof value.warning === 'string'
    );
}
