import { randomUUID } from 'node:crypto';
import type { Principal } from '../shared/types.js';
import { CREATE_TABLE_COLUMN_TYPES, type CreateTableColumn } from '../shared/table-creation.js';
import { quoteIdentifier } from '../shared/sql.js';
import { requireThat } from './errors.js';
import { canWrite } from './guards.js';
import { audit, type Store } from './store.js';

export { CREATE_TABLE_COLUMN_TYPES } from '../shared/table-creation.js';
export type { CreateTableColumn, CreateTableColumnType } from '../shared/table-creation.js';

export interface CreateTableDriver {
    database(connectionId: string): string;
    createTable(connectionId: string, table: string, columns: CreateTableColumn[], orderBy: string, queryId: string): Promise<void>;
}

export function createTableSql(table: string, columns: CreateTableColumn[], orderBy: string): string {
    const parts = table.split('.');
    requireThat(parts.length === 2 && parts.every(part => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(part)), 400, 'TABLE_NAME', 'Use a database.table name with valid identifiers');
    requireThat(columns.length > 0 && columns.length <= 50, 400, 'TABLE_COLUMNS', 'A table needs 1–50 columns');
    requireThat(columns.every(column => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(column.name)), 400, 'TABLE_COLUMN_NAME', 'Column names must use letters, numbers, and underscores');
    requireThat(new Set(columns.map(column => column.name)).size === columns.length, 400, 'TABLE_COLUMN_DUPLICATE', 'Column names must be unique');
    requireThat(columns.every(column => CREATE_TABLE_COLUMN_TYPES.includes(column.type)), 400, 'TABLE_COLUMN_TYPE', 'Choose a supported column type');
    requireThat(columns.some(column => column.name === orderBy), 400, 'TABLE_ORDER_BY', 'Choose an existing column for the sorting key');
    const [database, name] = parts;
    return `CREATE TABLE ${quoteIdentifier(database!)}.${quoteIdentifier(name!)} (\n${columns.map(column => `    ${quoteIdentifier(column.name)} ${column.type}`).join(',\n')}\n) ENGINE = MergeTree ORDER BY ${quoteIdentifier(orderBy)}`;
}

export class TableCreationService {
    constructor(private readonly store: Store, private readonly driver: CreateTableDriver, private readonly trusted: (principal: Principal, connectionId: string) => boolean) { }

    async create(principal: Principal, connectionId: string, name: string, columns: CreateTableColumn[], orderBy: string, confirmation: string) {
        canWrite(principal);
        requireThat(this.trusted(principal, connectionId), 403, 'WORKSPACE_UNTRUSTED', 'Trust the destination connection first');
        requireThat(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name), 400, 'TABLE_NAME', 'Use a valid table name');
        const database = this.driver.database(connectionId), table = `${database}.${name}`;
        createTableSql(table, columns, orderBy);
        requireThat(confirmation === `CREATE TABLE ${table}`, 400, 'TABLE_CREATE_CONFIRMATION', 'Confirm the exact table name before creating it');
        const queryId = `clickstudio-create-table-${randomUUID()}`;
        audit(this.store, principal, 'table.create', table);
        await this.driver.createTable(connectionId, table, columns, orderBy, queryId);
        return { database: table.split('.')[0], table: table.split('.')[1], columns, orderBy, queryId };
    }
}
