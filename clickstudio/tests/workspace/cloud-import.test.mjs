import test from 'node:test';
import assert from 'node:assert/strict';
import {
    cloudImportTargets,
    inferCloudImportColumns,
    inferCloudImportType,
    suggestCloudTableName,
} from '../../.workspace-build/web/cloud-import.js';

test('Cloud import targets include tables and exclude view engines', () => {
    const schema = {
        tables: [
            { database: 'default', name: 'events', engine: 'MergeTree' },
            { database: 'default', name: 'memory_events', engine: 'Memory' },
            { database: 'default', name: 'events_view', engine: 'View' },
            { database: 'default', name: 'events_mv', engine: 'MaterializedView' },
        ],
    };

    assert.deepEqual(cloudImportTargets(schema), ['default.events', 'default.memory_events']);
});

test('Cloud schema inference handles dates, integer bounds, decimals, UUIDs, and string fallback', () => {
    const rows = [
        {
            day: '2026-09-21',
            count: '12',
            signed: '-2',
            price: '12.40',
            id: '550e8400-e29b-41d4-a716-446655440000',
            label: 'north',
        },
        {
            day: '2026-09-22',
            count: '18',
            signed: '0',
            price: '3.10',
            id: '550e8400-e29b-41d4-a716-446655440001',
            label: 'south',
        },
    ];

    assert.deepEqual(inferCloudImportColumns(rows, Object.keys(rows[0])), [
        { source: 'day', name: 'day', type: 'Date' },
        { source: 'count', name: 'count', type: 'UInt64' },
        { source: 'signed', name: 'signed', type: 'Int64' },
        { source: 'price', name: 'price', type: 'Decimal(18, 2)' },
        { source: 'id', name: 'id', type: 'UUID' },
        { source: 'label', name: 'label', type: 'String' },
    ]);
    assert.equal(inferCloudImportType([{ number: '18446744073709551616' }], 'number'), 'String');
    assert.equal(inferCloudImportType([{ value: '12' }, { value: '' }], 'value'), 'String');
    assert.equal(inferCloudImportType([{ value: { nested: true } }], 'value'), 'String');
});

test('Cloud schema inference recognizes JSON booleans, including nullable values', () => {
    assert.equal(inferCloudImportType([{ enabled: true }, { enabled: false }], 'enabled'), 'Bool');
    assert.equal(
        inferCloudImportType([{ enabled: true }, { enabled: null }, { enabled: false }], 'enabled'),
        'Bool',
    );
    assert.deepEqual(
        inferCloudImportColumns([{ enabled: true }, { enabled: false }], ['enabled']),
        [{ source: 'enabled', name: 'enabled', type: 'Bool' }],
    );
});

test('Cloud schema inference keeps Boolean-looking strings and mixed types as String', () => {
    assert.equal(
        inferCloudImportType([{ enabled: 'true' }, { enabled: 'false' }], 'enabled'),
        'String',
    );
    assert.equal(
        inferCloudImportType([{ enabled: true }, { enabled: 'false' }], 'enabled'),
        'String',
    );
    assert.equal(inferCloudImportType([{ enabled: true }, { enabled: 1 }], 'enabled'), 'String');
    assert.equal(inferCloudImportType([{ enabled: null }, { enabled: null }], 'enabled'), 'String');
});

test('Cloud table suggestion creates a safe name from a file name', () => {
    assert.equal(suggestCloudTableName('Daily events 2026.csv'), 'Daily_events_2026');
    assert.equal(suggestCloudTableName('2026-report.json'), 'import_2026_report');
    assert.equal(suggestCloudTableName('.csv'), 'imported_data');
});

test('New table column names are safe and unique after normalization', () => {
    const columns = inferCloudImportColumns([{}], ['1 event', 'first name', 'first-name']);

    assert.deepEqual(
        columns.map(column => column.name),
        ['column_1', 'first_name', 'first_name_2'],
    );
});
