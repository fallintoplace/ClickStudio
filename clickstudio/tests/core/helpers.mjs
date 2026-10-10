import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { MemoryStore } from '../../.core-build/core/store.js';
import { RunService } from '../../.core-build/core/runs.js';
import { DEFAULT_LIMITS } from '../../.core-build/shared/types.js';
export const owner = { id: 'local-owner', role: 'owner' };
export const other = { id: 'other-owner', role: 'owner' };
export const viewer = { id: 'local-owner', role: 'viewer' };
export const columns = [{ name: 'n', type: 'UInt64' }];
export const schema = {
    connectionId: 'local',
    fetchedAt: new Date().toISOString(),
    truncated: false,
    warnings: [],
    tables: [{ database: 'default', name: 'events', engine: 'MergeTree' }],
    columns: [
        {
            database: 'default',
            table: 'events',
            name: 'n',
            type: 'UInt64',
            defaultKind: '',
            comment: '',
        },
    ],
};
export const connection = {
    id: 'local',
    name: 'Local',
    host: 'http://localhost:8123',
    database: 'default',
    username: 'reader',
    readonly: true,
    limits: { ...DEFAULT_LIMITS },
    manifest: {
        version: 1,
        serverVersion: 'fixture',
        testedAt: schema.fetchedAt,
        explain: { available: true },
        pipeline: { available: true },
    },
};
export function fixture(options = {}) {
    const store = options.store ?? new MemoryStore(),
        calls = [],
        kills = [];
    const driver = {
        async execute(run, signal, progress) {
            calls.push(run);
            progress({ readRows: '1', readBytes: '8', elapsedMs: 1 });
            if (options.execute) return options.execute(run, signal, progress);
            if (run.sql.includes('fail')) throw new Error('Known fixture failure');
            await sleep(options.delay ?? 2, undefined, { signal });
            return { columns, rows: [['1'], ['2']], truncated: false };
        },
        async cancel(run) {
            kills.push(run.id);
        },
    };
    const authorize =
        options.authorize ??
        ((_p, id) => {
            if (!['local', 'second'].includes(id)) throw new Error('No access');
            return { ...connection, id };
        });
    const runs = new RunService(store, driver, authorize, options);
    runs.trust(owner, 'local', true);
    return {
        store,
        driver,
        calls,
        kills,
        runs,
        authorize,
        request: (extra = {}) => ({
            clientRequestId: randomUUID(),
            connectionId: 'local',
            sql: 'SELECT number AS n FROM numbers(2)',
            ...extra,
        }),
    };
}
export async function until(fn, milliseconds = 1500) {
    const start = Date.now();
    while (Date.now() - start < milliseconds) {
        const value = fn();
        if (value) return value;
        await sleep(3);
    }
    throw new Error('Condition did not become true');
}
