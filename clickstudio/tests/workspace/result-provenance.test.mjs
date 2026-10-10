import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedResultChange } from '../../.workspace-build/web/result-provenance.js';

const run = Object.freeze({
    sql: 'SELECT 1',
    parameters: Object.freeze({ n: '9007199254740993' }),
    connectionId: 'demo',
});
const draft = Object.freeze({
    sql: 'SELECT 1;',
    parameters: run.parameters,
    connectionId: run.connectionId,
});

test('Selection and cursor positions do not invalidate executed SQL', () => {
    for (const [from, to] of [
        [0, 0],
        [1, 5],
        [9, 15],
        [20, 20],
    ])
        assert.equal(
            retainedResultChange(run, { ...draft, sql: 'SELECT 1;\nSELECT 2;', from, to }),
            undefined,
        );
});

test('Editing another statement keeps the selected result current', () => {
    assert.equal(retainedResultChange(run, { ...draft, sql: 'SELECT 3; SELECT 1;' }), undefined);
    assert.equal(retainedResultChange(run, { ...draft, sql: 'SELECT 1; SELECT 4;' }), undefined);
    assert.equal(retainedResultChange(run, { ...draft, sql: 'SELECT 2; SELECT 4;' }), 'query');
});

test('The executed range stays current when a selected query is part of a larger statement', () => {
    const source = { ...run, sourceFrom: 0, sourceTo: 8 };
    assert.equal(retainedResultChange(source, { ...draft, sql: 'SELECT 1 AS value' }), undefined);
    assert.equal(retainedResultChange(source, { ...draft, sql: 'SELECT 2 AS value' }), 'query');
});

test('Moving an unchanged statement does not make retained results stale', () => {
    const source = { ...run, sourceFrom: 0, sourceTo: 8 };
    assert.equal(
        retainedResultChange(source, { ...draft, sql: 'SELECT 3;\nSELECT 1;' }),
        undefined,
    );
    assert.equal(retainedResultChange({ ...source, sourceTo: 500 }, draft), undefined);
});

test('Matching text inside a string, comment or larger statement does not impersonate the executed query', () => {
    for (const sql of [
        "SELECT 'SELECT 1'",
        'SELECT 11',
        '-- SELECT 1\nSELECT 2',
        'SELECT 2 /* SELECT 1 */',
        'SELECT * FROM (SELECT 1)',
    ])
        assert.equal(retainedResultChange(run, { ...draft, sql }), 'query');
});

test('SQL edits and malformed or empty drafts remain stale until restored', () => {
    for (const sql of ['', 'SELECT 2', "SELECT 'unfinished", '/*'])
        assert.equal(retainedResultChange(run, { ...draft, sql }), 'query');
    assert.equal(retainedResultChange(run, { ...draft, sql: '\nSELECT 1;\n' }), undefined);
    assert.equal(retainedResultChange({ ...run, sql: '' }, { ...draft, sql: '' }), 'query');
});

test('Parameter values stay exact and key order is irrelevant', () => {
    assert.equal(
        retainedResultChange(run, { ...draft, parameters: { n: '9007199254740994' } }),
        'parameters',
    );
    assert.equal(retainedResultChange(run, { ...draft, parameters: {} }), 'parameters');
    const source = { ...run, parameters: { a: '1', b: '2' } };
    assert.equal(
        retainedResultChange(source, { ...draft, parameters: { b: '2', a: '1' } }),
        undefined,
    );
});

test('A different connection is explicit even if SQL and parameters match', () => {
    assert.equal(retainedResultChange(run, { ...draft, connectionId: 'other' }), 'connection');
});

test('Change priority is stable and comparison never mutates stored evidence', () => {
    assert.equal(retainedResultChange(run, { ...draft, sql: 'SELECT 2', parameters: {} }), 'query');
    assert.equal(
        retainedResultChange(run, {
            ...draft,
            sql: 'SELECT 2',
            parameters: {},
            connectionId: 'other',
        }),
        'connection',
    );
    assert.deepEqual(run, {
        sql: 'SELECT 1',
        parameters: { n: '9007199254740993' },
        connectionId: 'demo',
    });
});
