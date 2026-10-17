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
const validName = (value: unknown) =>
    typeof value === 'string' && value.length >= 1 && value.length <= 128;
export function parseTableBrowseRequest(value: unknown): TableBrowseRequest {
    if (!isRecord(value)) throw new BrowseValidationError('Invalid table browsing request.');
    if (![value.database, value.table, value.orderColumn].every(validName))
        throw new BrowseValidationError('Choose a valid table and sort column.');
    if (value.direction !== 'asc' && value.direction !== 'desc')
        throw new BrowseValidationError('Choose ascending or descending order.');
    if (!Number.isSafeInteger(value.page) || (value.page as number) < 0 ||
        (value.page as number) > MAX_BROWSE_PAGE)
        throw new BrowseValidationError('Browse the first 25 pages, or narrow the table with a filter.');
    if ((value.filterColumn === undefined) !== (value.filterValue === undefined))
        throw new BrowseValidationError('Choose both a filter column and a value.');
    if (value.filterColumn !== undefined && !validName(value.filterColumn))
        throw new BrowseValidationError('Choose an existing filter column.');
    if (value.filterValue !== undefined &&
        (typeof value.filterValue !== 'string' || value.filterValue.length > 256))
        throw new BrowseValidationError('Filter values must be at most 256 characters.');
    return {
        database: value.database as string,
        table: value.table as string,
        orderColumn: value.orderColumn as string,
        direction: value.direction,
        page: value.page as number,
        ...(typeof value.filterColumn === 'string' ? { filterColumn: value.filterColumn } : {}),
        ...(typeof value.filterValue === 'string' ? { filterValue: value.filterValue } : {}),
    };
}

export function browseColumnSupported(type: string): boolean {
    return /^(?:U?Int\d+|Float\d+|Decimal|String|FixedString|Date|DateTime|UUID|IPv[46]|Enum)/.test(baseType(type));
}

/** Generated from verified table columns, not from arbitrary SQL fragments. */
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
    const sql = 'SELECT * FROM ' + table + where +
        ' ORDER BY ' + quoteIdentifier(order.name) + ' ' + request.direction.toUpperCase() +
        ' LIMIT ' + (BROWSE_PAGE_ROWS + 1) + ' OFFSET ' + (request.page * BROWSE_PAGE_ROWS);
    return {
        sql,
        parameters: request.filterColumn ? { browseValue: request.filterValue ?? '' } : {},
    };
}

/** Make a standalone editable SQL draft, preserving typed execution for the API. */
export function tableBrowseDraftSql(input: TableBrowseRequest, columns: readonly Column[]) {
    const { sql } = buildTableBrowseSql(input, columns);
    return input.filterColumn
        ? sql.replace('{browseValue:String}', quoteStringLiteral(input.filterValue ?? ''))
        : sql;
}

export function isTableBrowsePage(value: unknown): value is TableBrowsePage {
    return isRecord(value) &&
        Array.isArray(value.columns) && value.columns.length <= MAX_BROWSE_COLUMNS &&
        value.columns.every(column => isRecord(column) && typeof column.name === 'string' && typeof column.type === 'string') &&
        Array.isArray(value.rows) && value.rows.length <= BROWSE_PAGE_ROWS &&
        value.rows.every(row => Array.isArray(row) && row.length === (value.columns as unknown[]).length && row.every(isJson)) &&
        Number.isSafeInteger(value.page) && (value.page as number) >= 0 &&
        typeof value.hasMore === 'boolean' &&
        typeof value.queryId === 'string' &&
        value.scope === 'live-table' &&
        typeof value.warning === 'string';
}
