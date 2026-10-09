import test from 'node:test';
import assert from 'node:assert/strict';
import { queryFailureSummary, sqlErrorRange, sqlErrorRangeInDraft, sqlErrorLineColumn, sqlErrorContext } from '../../.workspace-build/web/sql-error.js';

const error = message => ({ code: 'CLICKHOUSE_62', message });

test('SQL context shows five numbered lines around an error, including document offsets', () => {
    const sql = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n');
    for (const [line, expectedNumbers] of [[1, [1, 2, 3, 4, 5]], [6, [4, 5, 6, 7, 8]], [12, [8, 9, 10, 11, 12]]]) {
        const from = sql.indexOf(`line ${line}`);
        const context = sqlErrorContext(sql, { from, to: from + 4 });
        assert.deepEqual(context.map(row => row.number), expectedNumbers);
        assert.equal(context.find(row => row.marker)?.text, `line ${line}`);
        assert.equal(context.find(row => row.marker)?.marker, '^^^^');
    }
    assert.deepEqual(sqlErrorContext('SELECT\nGROUP', { from: 7, to: 8 }, 9).map(row => row.number), [10, 11]);
});

test('SQL context retains tabs and Unicode, handles CRLF and marks end of input', () => {
    const sql = "SELECT 'é😀'\r\n\tGROUP BY\r\n";
    const from = sql.indexOf('GROUP');
    assert.deepEqual(sqlErrorContext(sql, { from, to: from + 5 }), [
        { number: 1, text: "SELECT 'é😀'", marker: undefined },
        { number: 2, text: '\tGROUP BY', marker: '\t^^^^^' },
        { number: 3, text: '', marker: undefined },
    ]);
    assert.equal(sqlErrorContext(sql, { from: sql.length, to: sql.length }).at(-1).marker, '^');
    assert.equal(sqlErrorContext('SELECT', { from: 6, to: 6 })[0].marker, '      ^');
    assert.equal(sqlErrorContext('SELECT\n1', { from: 2, to: 8 })[0].marker, '  ^^^^');
});

test('SQL context uses the first five lines without a marker if the location is unknown or invalid', () => {
    const sql = 'SELECT 1\nSELECT 2\nSELECT 3\nSELECT 4\nSELECT 5\nSELECT 6';
    for (const range of [undefined, { from: -1, to: 1 }, { from: 4, to: 3 }, { from: 0, to: 99 }, { from: NaN, to: 1 }, { from: 0.5, to: 1 }, { from: 0, to: Infinity }]) {
        const context = sqlErrorContext(sql, range);
        assert.deepEqual(context.map(row => row.number), [1, 2, 3, 4, 5]);
        assert.ok(context.every(row => row.marker === undefined));
    }
    assert.deepEqual(sqlErrorContext('SELECT 1', undefined, -1), sqlErrorContext('SELECT 1'));
    assert.deepEqual(sqlErrorContext('SELECT 1', undefined, NaN), sqlErrorContext('SELECT 1'));
});

test('A ClickHouse syntax diagnostic summarizes the token without SQL or parser hints', () => {
    const detail = error('Syntax error: failed at position 10 (GROUP) (line 2, col 1): GROUP BY FORMAT JSON. Expected one of: token, expression.');
    const summary = queryFailureSummary(detail);
    assert.equal(summary.syntax, true);
    assert.equal(summary.token, 'GROUP');
    assert.deepEqual(sqlErrorRange('SELECT 1\nGROUP BY', detail), { from: 9, to: 10 });
    assert.deepEqual(sqlErrorLineColumn('SELECT 1\nGROUP BY', 9), { line: 2, column: 1 });
});

test('Generic errors retain a bounded readable preview without claiming a syntax error', () => {
    const detail = error('Table default.missing does not exist. In scope SELECT * FROM default.missing');
    assert.deepEqual(queryFailureSummary(detail), { syntax: false, token: undefined, message: 'Table default.missing does not exist.' });
    assert.equal(queryFailureSummary(error('x'.repeat(300))).message.length, 158);
    assert.equal(queryFailureSummary(error('Permission denied.\nStack trace follows')).message, 'Permission denied.');
    assert.equal(sqlErrorRange('SELECT 1', detail), undefined);
});

test('A syntax error without a token still has an honest generic diagnostic', () => {
    assert.equal(queryFailureSummary({ code: 'SYNTAX_ERROR', message: 'Invalid SQL' }).syntax, true);
    assert.equal(queryFailureSummary(error('Syntax error at position 15')).token, undefined);
    assert.equal(queryFailureSummary(error('')).message, '');
});

test('Server byte columns map Unicode to editor offsets', () => {
    const sql = "SELECT '😀é' GROUP";
    const from = sql.indexOf('GROUP');
    const column = new TextEncoder().encode(sql.slice(0, from)).length + 1;
    assert.deepEqual(sqlErrorRange(sql, error(`Syntax error (line 1, col ${column})`)), { from, to: from + 1 });
    assert.equal(sqlErrorRange(sql, error('Syntax error (line 1, col 10)')), undefined);
});

test('Invalid line, column and structured positions do not point at unrelated SQL', () => {
    for (const location of ['(line 0, col 1)', '(line 4, col 1)', '(line 1, col 99)', '(line 1, col 0)'])
        assert.equal(sqlErrorRange('SELECT 1', error(`Syntax error ${location}`)), undefined);
    for (const position of [-1, 99, 1.5, NaN, Infinity])
        assert.equal(sqlErrorRange('SELECT 1', { ...error('Syntax error (line 1, col 1)'), position }), undefined);
});

test('Structured offsets take precedence and end-of-input errors remain navigable', () => {
    assert.deepEqual(sqlErrorRange('SELECT 1', { ...error('Syntax error (line 1, col 1)'), position: 7 }), { from: 7, to: 8 });
    assert.deepEqual(sqlErrorRange('SELECT', error('Syntax error (line 1, col 7)')), { from: 6, to: 6 });
});

test('Submitted statement offsets translate into the full editor document', () => {
    const statement = 'SELECT 1\nGROUP BY', draft = `SELECT 2;\n${statement}`;
    const detail = error('Syntax error (line 2, col 1)');
    assert.deepEqual(sqlErrorRangeInDraft(draft, statement, 10, detail), { from: 19, to: 20 });
    assert.deepEqual(sqlErrorLineColumn(draft, 19), { line: 3, column: 1 });
    assert.equal(sqlErrorRangeInDraft('SELECT 2', statement, 0, detail), undefined);
    assert.equal(sqlErrorRangeInDraft(`${statement};${statement}`, statement, 1, detail), undefined);
});

test('Unknown functions only highlight an unambiguous call', () => {
    const detail = error('Unknown function missing');
    assert.deepEqual(sqlErrorRange('SELECT missing(1)', detail), { from: 7, to: 14 });
    assert.equal(sqlErrorRange('SELECT missing(1), missing(2)', detail), undefined);
});

test('Saved server runs use document positions without adding the statement offset twice', () => {
    const statement = 'SELECT 1\nGROUP BY', draft = `SELECT 2;\n${statement}`;
    const detail = { ...error('Syntax error'), position: 19 };
    assert.deepEqual(sqlErrorRangeInDraft(draft, statement, 10, detail, 'draft'), { from: 19, to: 20 });
    assert.deepEqual(sqlErrorRangeInDraft(`-- moved\n${draft}`, statement, 10, detail, 'draft'), { from: 28, to: 29 });
    assert.equal(sqlErrorRangeInDraft(draft, statement, 10, { ...detail, position: 2 }, 'draft'), undefined);
});
