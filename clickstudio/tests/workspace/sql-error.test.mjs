import test from 'node:test';
import assert from 'node:assert/strict';
import { queryFailureSummary, sqlErrorRange, sqlErrorRangeInDraft, sqlErrorLineColumn, sqlErrorExcerpt } from '../../.workspace-build/web/sql-error.js';

const error = message => ({ code: 'CLICKHOUSE_62', message });

test('Failed SQL preserves every line and places a caret below the submitted error', () => {
    assert.equal(sqlErrorExcerpt('SELECT 1\nGROUP BY\nORDER BY 1', { from: 9, to: 14 }), 'SELECT 1\nGROUP BY\n^^^^^\nORDER BY 1');
    assert.equal(sqlErrorExcerpt('\tSELECT missing(1)', { from: 8, to: 15 }), '\tSELECT missing(1)\n\t       ^^^^^^^');
    assert.equal(sqlErrorExcerpt('SELECT', { from: 6, to: 6 }), 'SELECT\n      ^');
    assert.equal(sqlErrorExcerpt('\nSELECT', { from: 0, to: 0 }), '\n^\nSELECT');
    assert.equal(sqlErrorExcerpt('SELECT\n', { from: 7, to: 7 }), 'SELECT\n\n^');
    assert.equal(sqlErrorExcerpt('SELECT\n1', { from: 2, to: 8 }), 'SELECT\n  ^^^^\n1');
});

test('Unknown or invalid error spans leave the submitted SQL untouched', () => {
    assert.equal(sqlErrorExcerpt('SELECT 1'), 'SELECT 1');
    for (const range of [{ from: -1, to: 1 }, { from: 4, to: 3 }, { from: 0, to: 99 }, { from: NaN, to: 1 }, { from: 0.5, to: 1 }, { from: 0, to: Infinity }])
        assert.equal(sqlErrorExcerpt('SELECT 1', range), 'SELECT 1');
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
