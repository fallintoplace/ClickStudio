import { randomUUID } from 'node:crypto';
import type { Principal } from '../shared/types.js';
import { canDropTableTarget, tableDeletionConfirmation } from '../shared/table-deletion.js';
import { requireThat } from './errors.js';
import { canWrite } from './guards.js';
import { audit, type Store } from './store.js';

export interface TableDeletionDriver {
    database(connectionId: string): string;
    dropTable(connectionId: string, database: string, table: string, queryId: string): Promise<void>;
}

export class TableDeletionService {
    constructor(private readonly store: Store, private readonly driver: TableDeletionDriver, private readonly trusted: (principal: Principal, connectionId: string) => boolean) { }

    async drop(principal: Principal, connectionId: string, database: string, table: string, confirmation: string) {
        canWrite(principal);
        requireThat(this.trusted(principal, connectionId), 403, 'WORKSPACE_UNTRUSTED', 'Trust the destination connection first');
        requireThat(canDropTableTarget(database, table), 400, 'TABLE_DROP_TARGET', 'Choose a regular table outside a system database');
        requireThat(database === this.driver.database(connectionId), 403, 'TABLE_DROP_NOT_ALLOWED', 'Table deletion is limited to the connection database');
        requireThat(confirmation === tableDeletionConfirmation(database, table), 400, 'TABLE_DROP_CONFIRMATION', 'Type the exact table name to confirm deletion');
        const queryId = `clickstudio-drop-table-${randomUUID()}`;
        audit(this.store, principal, 'table.drop', `${database}.${table}`);
        await this.driver.dropTable(connectionId, database, table, queryId);
        return { database, table, queryId };
    }
}
