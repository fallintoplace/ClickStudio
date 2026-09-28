import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATE_TABLE_COLUMN_TYPES, TableCreationService, createTableSql } from '../../.core-build/core/table-creation.js';
import { MemoryStore } from '../../.core-build/core/store.js';
import { owner, viewer } from './helpers.mjs';

const columns = [{ name: 'id', type: 'UInt64' }, { name: 'event_name', type: 'String' }];

test('CREATE TABLE SQL quotes identifiers and uses a fixed MergeTree engine', () => {
    assert.equal(createTableSql('default.events', columns, 'id'), 'CREATE TABLE `default`.`events` (\n    `id` UInt64,\n    `event_name` String\n) ENGINE = MergeTree ORDER BY `id`');
});

test('CREATE TABLE SQL gives an omitted UInt64 id a generated default', () => {
    assert.equal(
        createTableSql('default.events', [{ name: 'id', type: 'UInt64', generatedId: true }], 'id'),
        'CREATE TABLE `default`.`events` (\n    `id` UInt64 DEFAULT generateSerialID(\'default.events\')\n) ENGINE = MergeTree ORDER BY `id`',
    );
    assert.throws(() => createTableSql('default.events', [{ name: 'event_id', type: 'UInt64', generatedId: true }], 'event_id'), { code: 'TABLE_GENERATED_ID' });
    assert.throws(() => createTableSql('default.events', [{ name: 'id', type: 'String', generatedId: true }], 'id'), { code: 'TABLE_GENERATED_ID' });
});

test('CREATE TABLE SQL accepts Bool columns', () => {
    assert.equal(createTableSql('default.flags', [{ name: 'enabled', type: 'Bool' }], 'enabled'),
        'CREATE TABLE `default`.`flags` (\n    `enabled` Bool\n) ENGINE = MergeTree ORDER BY `enabled`');
});

test('CREATE TABLE SQL accepts only bounded safe definitions', () => {
    assert.throws(() => createTableSql('default.events; DROP TABLE x', columns, 'id'), { code: 'TABLE_NAME' });
    assert.throws(() => createTableSql('default.events', [], 'id'), { code: 'TABLE_COLUMNS' });
    assert.throws(() => createTableSql('default.events', Array.from({ length: 51 }, (_, i) => ({ name: `c${i}`, type: 'String' })), 'c0'), { code: 'TABLE_COLUMNS' });
    assert.throws(() => createTableSql('default.events', [{ name: 'x', type: 'String' }, { name: 'x', type: 'String' }], 'x'), { code: 'TABLE_COLUMN_DUPLICATE' });
    assert.throws(() => createTableSql('default.events', [{ name: 'x`); DROP TABLE events; --', type: 'String' }], 'x`); DROP TABLE events; --'), { code: 'TABLE_COLUMN_NAME' });
    assert.throws(() => createTableSql('default.events', [{ name: 'x', type: 'String' }], 'missing'), { code: 'TABLE_ORDER_BY' });
    assert.deepEqual(CREATE_TABLE_COLUMN_TYPES, ['String', 'Bool', 'UInt64', 'Int64', 'Float64', 'Decimal(18, 2)', 'Date', 'DateTime', 'UUID']);
});

test('Table creation requires owner, trust, and valid database and table names', async () => {
    let creates = 0;
    const driver = { database: () => 'default', async createTable() { creates++; } };
    const service = new TableCreationService(new MemoryStore(), driver, (_principal, connectionId) => connectionId === 'trusted');
    await assert.rejects(service.create(viewer, 'trusted', 'default', 'events', columns, 'id'), { code: 'ROLE_READ_ONLY' });
    await assert.rejects(service.create(owner, 'untrusted', 'default', 'events', columns, 'id'), { code: 'WORKSPACE_UNTRUSTED' });
    await assert.rejects(service.create(owner, 'trusted', 'system', 'events', columns, 'id'), { code: 'TABLE_DATABASE' });
    await assert.rejects(service.create(owner, 'trusted', 'default', 'events; DROP TABLE x', columns, 'id'), { code: 'TABLE_NAME' });
    assert.equal(creates, 0);
});

test('Successful table creation uses the selected database and records an audit event', async () => {
    const store = new MemoryStore(), calls = [];
    const driver = { database: () => 'default', async createTable(...args) { calls.push(args); } };
    const service = new TableCreationService(store, driver, () => true);
    const result = await service.create(owner, 'local', 'analytics', 'events', columns, 'id');
    assert.equal(result.database, 'analytics');
    assert.equal(result.table, 'events');
    assert.deepEqual(calls[0].slice(0, 4), ['local', 'analytics.events', columns, 'id']);
    assert.match(calls[0][4], /^clickstudio-create-table-/);
    assert.equal(store.list('audit')[0].action, 'table.create');
    assert.equal(store.list('audit')[0].resourceId, 'analytics.events');
});
