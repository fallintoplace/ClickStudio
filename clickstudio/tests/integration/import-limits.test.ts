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
    return [
        columns.join(','),
        ...rows.map(row => columns.map(column => row[column]).join(',')),
    ].join('\n');
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
        const row = Object.fromEntries(
            Array.from({ length: 200 }, (_, index) => [`column_${index}`, 'value']),
        );
        for (const parse of Object.values(parsers)) {
            assert.equal(parse(encodeRows([row], format), format).columns.length, 200);
            assert.throws(
                () => parse(encodeRows([{ ...row, extra: 'value' }], format), format),
                /1–200/,
            );
        }
    });

    test(`${format} imports keep the 256-character field name boundary in both parsers`, () => {
        const name = 'n'.repeat(256);
        for (const parse of Object.values(parsers)) {
            assert.equal(parse(encodeRows([{ [name]: 'value' }], format), format).columns[0], name);
            assert.throws(
                () => parse(encodeRows([{ [name + 'n']: 'value' }], format), format),
                /column names|field name/,
            );
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
    const columns = Array.from({ length: 201 }, (_, index) => ({
        name: `column_${index}`,
        type: 'String',
        defaultKind: '',
    }));
    const row = Object.fromEntries(columns.map(column => [column.name, 'value']));
    const fields = Object.fromEntries(
        columns.slice(0, 200).map(column => [column.name, column.name]),
    );
    assert.equal(
        Object.keys(mapImportRows([row], Object.keys(row), fields, columns.slice(0, 200)).rows[0]!)
            .length,
        200,
    );
    assert.throws(
        () =>
            mapImportRows(
                [row],
                Object.keys(row),
                { ...fields, column_200: 'column_200' },
                columns,
            ),
        { code: 'IMPORT_MAPPING' },
    );
});

test('Import mapping still rejects duplicate destinations below the column limit', () => {
    assert.throws(
        () =>
            mapImportRows([{ a: '1', b: '2' }], ['a', 'b'], { a: 'value', b: 'value' }, [
                { name: 'value', type: 'String', defaultKind: '' },
            ]),
        { code: 'IMPORT_MAPPING' },
    );
});

const errorCases = [
    ['csv', 'a,a\n1,2', 'DUPLICATE_HEADERS', 'Duplicate CSV column names'],
    ['csv', 'a,b\n1', 'CSV_WIDTH', 'CSV row 2 has the wrong number of fields'],
    ['csv', 'a\n"oops', 'INVALID_CSV', 'Unclosed quoted CSV field'],
    ['csv', 'a\n"value"tail', 'INVALID_CSV', 'Unexpected character after a closing quote'],
    ['csv', 'a\nval"ue', 'INVALID_CSV', 'Quote in an unquoted field'],
    ['json', '{', 'INVALID_JSON', 'The uploaded JSON is invalid'],
    ['json', '[]', 'IMPORT_ROWS', 'Upload an array of 1–10,000 JSON objects'],
    ['ndjson', '\n \n', 'IMPORT_ROWS', 'Upload an array of 1–10,000 JSON objects'],
    ['json', '[null]', 'IMPORT_OBJECT', 'Every JSON row must be an object'],
    ['json', '[{}]', 'IMPORT_COLUMNS', 'Import previews support 1–200 columns'],
    ['json', '[{"":1}]', 'INVALID_HEADERS', 'Invalid JSON field name'],
    [
        'json',
        '[{"":9007199254740992}]',
        'UNSAFE_NUMBER',
        'Encode 64-bit integers as JSON strings to avoid precision loss',
    ],
] as const;

for (const [format, source, code, message] of errorCases) {
    test(`${format} parsing preserves the ${code} error contract`, () => {
        assert.throws(() => parseInput(source, format), { status: 400, code, message });
        assert.throws(
            () => parseImportFile(source, format),
            error => {
                assert.ok(error instanceof Error);
                assert.equal(error.message, message);
                assert.equal('status' in error, false);
                assert.equal('code' in error, false);
                return true;
            },
        );
    });
}

test('CSV row limits preserve custom server limits and distinct overflow messages', async () => {
    const { parseCsv } = await import('../../core/imports.js');
    assert.equal(parseCsv('a\n', 0).rows.length, 0);
    assert.equal(parseCsv('a\n1', 1).rows.length, 1);
    assert.throws(() => parseCsv('a\n1\n2', 1), {
        status: 413,
        code: 'IMPORT_ROW_LIMIT',
        message: 'Imports are limited to 1 rows',
    });
    const source = 'a\n' + '1\n'.repeat(10001);
    assert.throws(() => parseInput(source, 'csv'), {
        status: 413,
        code: 'IMPORT_ROW_LIMIT',
        message: 'Imports are limited to 10000 rows',
    });
    assert.throws(() => parseImportFile(source, 'csv'), {
        message: 'Imports are limited to 10,000 rows',
    });
});

test('Header-only CSV remains valid at the parser boundary', () => {
    for (const parse of Object.values(parsers))
        assert.deepEqual(parse('a,b\n', 'csv'), { columns: ['a', 'b'], rows: [] });
});

for (const format of ['json', 'ndjson'] as const) {
    test(`${format} parsing retains sparse rows, key order and null prototypes recursively`, () => {
        const rows = ['{"z":1,"__proto__":{"constructor":{"safe":true}}}', '{"later":2}'];
        const source = format === 'json' ? `[${rows.join(',')}]` : rows.join('\n');
        for (const parse of Object.values(parsers)) {
            const result = parse(source, format);
            assert.deepEqual(result.columns, ['z', '__proto__', 'later']);
            assert.equal(Object.hasOwn(result.rows[1]!, 'z'), false);
            const row = result.rows[0]!;
            assert.equal(Object.getPrototypeOf(row), null);
            assert.equal(Object.getPrototypeOf(row.__proto__), null);
            assert.equal(
                Object.getPrototypeOf((row.__proto__ as Record<string, unknown>).constructor),
                null,
            );
        }
    });

    test(`${format} parsing keeps the nesting depth boundary`, () => {
        function source(depth: number) {
            let value: unknown = 'leaf';
            for (let index = 0; index < depth; index++) value = { child: value };
            const row = JSON.stringify({ payload: value });
            return format === 'json' ? `[${row}]` : row;
        }
        for (const parse of Object.values(parsers)) {
            assert.equal(parse(source(29), format).rows.length, 1);
            assert.throws(() => parse(source(30), format), { message: 'JSON nesting is too deep' });
        }
    });
}

test('Exported JSON validation preserves structured errors for unsupported values', async () => {
    const { validateJson } = await import('../../core/validation.js');
    for (const value of [undefined, Symbol('value'), () => undefined, 1n])
        assert.throws(() => validateJson(value), {
            status: 400,
            code: 'INVALID_REQUEST',
            message: 'request must be an object',
        });
});
