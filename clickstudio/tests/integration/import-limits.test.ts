import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../../core/imports.js';
import { mapImportRows } from '../../core/import-mapping.js';
import { parseImportFile } from '../../web/demo-import-data.js';
import type { ImportFormat } from '../../shared/import-limits.js';

const parsers = { server: parseInput, browser: parseImportFile };

function encodeRows(rows: Record<string, string>[], format: ImportFormat): string {
    if (format === 'json') return JSON.stringify(rows);
    if (format === 'ndjson') return rows.map(row => JSON.stringify(row)).join('\n');
    const columns = Object.keys(rows[0]!);
    return [columns.join(','), ...rows.map(row => columns.map(column => row[column]).join(','))].join('\n');
}

for (const format of ['csv', 'json', 'ndjson'] as const) {
    test(`${format} imports accept 10,000 rows and reject the next row in both parsers`, () => {
        const rows = Array.from({ length: 10_000 }, (_, index) => ({ value: String(index) }));
        const accepted = encodeRows(rows, format);
        const rejected = encodeRows([...rows, { value: 'extra' }], format);
        for (const parse of Object.values(parsers)) {
            const result = parse(accepted, format);
            assert.equal(result.rows.length, 10_000);
            assert.equal(result.rows.at(-1)?.value, '9999');
            assert.throws(() => parse(rejected, format), /limited to|1–10,000/);
        }
    });

    test(`${format} imports accept 200 columns and reject a 201st column in both parsers`, () => {
        const row = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`column_${index}`, 'value']));
        for (const parse of Object.values(parsers)) {
            assert.equal(parse(encodeRows([row], format), format).columns.length, 200);
            assert.throws(() => parse(encodeRows([{ ...row, extra: 'value' }], format), format), /1–200/);
        }
    });

    test(`${format} imports keep the 256-character field name boundary in both parsers`, () => {
        const name = 'n'.repeat(256);
        for (const parse of Object.values(parsers)) {
            assert.equal(parse(encodeRows([{ [name]: 'value' }], format), format).columns[0], name);
            assert.throws(() => parse(encodeRows([{ [name + 'n']: 'value' }], format), format), /column names|field name/);
        }
    });

    test(`${format} imports measure the 2 MB file boundary in UTF-8 bytes in both parsers`, () => {
        const empty = encodeRows([{ value: '' }], format);
        const availableBytes = 2_000_000 - Buffer.byteLength(empty);
        const value = 'é'.repeat(Math.floor(availableBytes / 2)) + 'a'.repeat(availableBytes % 2);
        const accepted = encodeRows([{ value }], format);
        const rejected = encodeRows([{ value: value + 'a' }], format);
        assert.equal(Buffer.byteLength(accepted), 2_000_000);
        assert.equal(Buffer.byteLength(rejected), 2_000_001);
        assert.ok(rejected.length < 2_000_000);
        for (const parse of Object.values(parsers)) {
            assert.equal(parse(accepted, format).rows[0]?.value, value);
            assert.throws(() => parse(rejected, format), /limited to 2 MB/);
        }
    });
}

test('Import mapping accepts 200 unique destinations and rejects a 201st mapping', () => {
    const columns = Array.from({ length: 201 }, (_, index) => ({ name: `column_${index}`, type: 'String', defaultKind: '' }));
    const row = Object.fromEntries(columns.map(column => [column.name, 'value']));
    const fields = Object.fromEntries(columns.slice(0, 200).map(column => [column.name, column.name]));
    assert.equal(Object.keys(mapImportRows([row], Object.keys(row), fields, columns.slice(0, 200)).rows[0]!).length, 200);
    assert.throws(() => mapImportRows([row], Object.keys(row), { ...fields, column_200: 'column_200' }, columns), { code: 'IMPORT_MAPPING' });
});

test('Import mapping still rejects duplicate destinations below the column limit', () => {
    assert.throws(() => mapImportRows([{ a: '1', b: '2' }], ['a', 'b'], { a: 'value', b: 'value' }, [{ name: 'value', type: 'String', defaultKind: '' }]), { code: 'IMPORT_MAPPING' });
});
