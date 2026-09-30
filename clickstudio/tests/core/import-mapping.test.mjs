import test from 'node:test';
import assert from 'node:assert/strict';
import { mapImportRows } from '../../.core-build/core/import-mapping.js';

function mapValue(value, type) {
    return mapImportRows([{ source: value }], ['source'], { source: 'target' }, [
        { name: 'target', type, defaultKind: '' },
    ]).rows[0].target;
}

test('Integer mappings preserve the full UInt64 range', () => {
    assert.equal(mapValue('18446744073709551615', 'UInt64'), '18446744073709551615');
    assert.equal(mapValue('00042', 'UInt64'), '00042');
});

test('Integer mappings reject date text with the source and destination in the error', () => {
    assert.throws(() => mapValue('2026-01-01', 'UInt64'), error => {
        assert.equal(error.code, 'IMPORT_VALUE_TYPE');
        assert.match(error.message, /row 1/);
        assert.match(error.message, /source.*2026-01-01/);
        assert.match(error.message, /target.*UInt64/);
        return true;
    });
});

test('Integer mappings reject unsigned negatives and values outside integer bounds', () => {
    assert.throws(() => mapValue('-1', 'UInt64'), { code: 'IMPORT_VALUE_TYPE' });
    assert.throws(() => mapValue('18446744073709551616', 'UInt64'), { code: 'IMPORT_VALUE_TYPE' });
    assert.equal(mapValue('-128', 'Int8'), '-128');
    assert.equal(mapValue('127', 'Int8'), '127');
    assert.throws(() => mapValue('-129', 'Int8'), { code: 'IMPORT_VALUE_TYPE' });
    assert.throws(() => mapValue('128', 'Int8'), { code: 'IMPORT_VALUE_TYPE' });
});

test('Integer mappings unwrap nullable and low-cardinality types', () => {
    assert.equal(mapValue('7', 'LowCardinality(Nullable(UInt64))'), '7');
    assert.equal(mapValue(null, 'Nullable(UInt64)'), null);
});

test('Other destination types remain for ClickHouse to validate', () => {
    assert.equal(mapValue('2026-01-01', 'Date'), '2026-01-01');
});
