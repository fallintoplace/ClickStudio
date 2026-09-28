import { quoteIdentifier } from './sql.js';

const systemDatabases = new Set(['system', 'information_schema']);

export function isSystemDatabaseName(database: string) {
    return systemDatabases.has(database.toLowerCase());
}

export function canDropTableTarget(database: string, table: string) {
    const validName = (value: string) => value.length > 0 && value.length <= 128 && [...value].every(character => {
        const code = character.charCodeAt(0);
        return code >= 0x20 && code !== 0x7f;
    });
    return validName(database) && validName(table) && !isSystemDatabaseName(database);
}

export function tableDeletionConfirmation(database: string, table: string) {
    return `${database}.${table}`;
}

export function dropTableSql(database: string, table: string) {
    return `DROP TABLE IF EXISTS ${quoteIdentifier(database)}.${quoteIdentifier(table)}`;
}

export function isViewEngine(engine: string) {
    return engine.toLowerCase().includes('view');
}
