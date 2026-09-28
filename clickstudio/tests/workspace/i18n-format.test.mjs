import assert from 'node:assert/strict';
import test from 'node:test';

const { formatCopy } = await import('../../.workspace-build/web/i18n-format.js');

for (const value of ['$&', '$`', "$'", '$$', 'orders_$&_2026']) {
    test(`Copy interpolation preserves literal replacement characters: ${value}`, () => {
        assert.equal(formatCopy('Preview {table}', { table: value }), `Preview ${value}`);
    });
}

test('Copy interpolation replaces every occurrence of each named placeholder', () => {
    assert.equal(
        formatCopy('{table}: {shown} of {total} rows in {table}', { table: 'events', shown: 0, total: 42 }),
        'events: 0 of 42 rows in events',
    );
});

test('Copy interpolation respects the order chosen by a translation', () => {
    assert.equal(
        formatCopy('共 {total} 行，显示 {shown} 行：{table}', { table: '事件', shown: 3, total: 42 }),
        '共 42 行，显示 3 行：事件',
    );
});

test('Inserted values are not recursively interpreted as placeholders', () => {
    assert.equal(
        formatCopy('{table}: {count}', { table: 'events_{count}', count: 7 }),
        'events_{count}: 7',
    );
});

test('Missing placeholders remain visible and typed SQL parameters are untouched', () => {
    assert.equal(
        formatCopy('{known} {missing} {id:UInt64} {}', { known: 'value', id: 7 }),
        'value {missing} {id:UInt64} {}',
    );
});

test('Copy interpolation accepts empty strings, numbers, and indexed placeholder names', () => {
    assert.equal(formatCopy('{name}|{row_1}|{delta}', { name: '', row_1: 0, delta: -1.5 }), '|0|-1.5');
    assert.equal(formatCopy('No parameters here', {}), 'No parameters here');
    assert.equal(formatCopy('', { unused: 'value' }), '');
});

test('Only explicitly supplied parameters are interpolated', () => {
    const inherited = Object.create({ table: 'inherited' });
    const template = '{table} {constructor} {toString}';
    assert.equal(formatCopy(template, inherited), template);
    assert.equal(formatCopy('{constructor}', { constructor: 'explicit' }), 'explicit');
    const parameters = Object.freeze({ table: 'events' });
    assert.equal(formatCopy('{table}', parameters), 'events');
    assert.deepEqual(parameters, { table: 'events' });
});
