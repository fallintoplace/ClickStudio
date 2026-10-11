import test from 'node:test';
import assert from 'node:assert/strict';
import {
    splitSql,
    lexSql,
    selectedStatement,
    parameterNames,
    quoteIdentifier,
    formatSql,
    hasSqlComments,
    hasTopLevelOutputFormat,
} from '../../.core-build/src/shared/sql/sql.js';
import { guardSql } from '../../.core-build/src/backend/queries/execution/guards.js';
import {
    limits,
    runRequest,
    validateJson,
} from '../../.core-build/src/backend/system/requests/validation.js';
const cases = [
    ["SELECT ';'; SELECT 2", 2],
    ["SELECT 'it\\\'s;ok'; SELECT 2", 2],
    ["SELECT 'it''s;ok'; SELECT 2", 2],
    ['SELECT `a;b`; SELECT "c;d"', 2],
    ['-- ;\nSELECT 1; -- only comment;', 1],
    ['/* outer ; /* inner ; */ */ SELECT 1; SELECT 2', 2],
    ['SELECT $tag$a;b$tag$; SELECT $$c;d$$;', 2],
    ['# comment;\nSELECT 1;', 1],
    ['-- comment only', 0],
    ['; ; SELECT 1;;;', 1],
    ['SELECT 1 /* ; */; SELECT 2', 2],
    ['SELECT [1,2]; SELECT {value:String}', 2],
];
for (const [sql, n] of cases)
    test(`SQL boundaries: ${sql}`, () => assert.equal(splitSql(sql).length, n));
for (const sql of ["SELECT 'oops", 'SELECT `oops', 'SELECT $$oops', 'SELECT 1 /*oops'])
    test(`Unclosed tokens reject: ${sql}`, () => assert.throws(() => splitSql(sql)));
test('Ranges preserve original source', () => {
    const sql = '  -- hello\nSELECT 1;\n SELECT 2;';
    for (const s of splitSql(sql)) assert.equal(sql.slice(s.from, s.to), s.sql);
});
test('Current statement and selected range', () => {
    const sql = 'SELECT 1;\nSELECT 2';
    assert.equal(selectedStatement(sql, 12, 12).sql, 'SELECT 2');
    assert.equal(selectedStatement(sql, 7, 8).sql, '1');
});
test('Typed parameters ignore comments and literals', () =>
    assert.deepEqual(parameterNames("SELECT {a:Nullable(UInt64)}, '{b:String}' -- {c:Int32}"), [
        { name: 'a', type: 'Nullable(UInt64)' },
    ]));
test('Inconsistent parameter types reject', () =>
    assert.throws(() => parameterNames('SELECT {a:Int32}, {a:String}')));
test('Identifier quoting cannot end the identifier', () =>
    assert.equal(quoteIdentifier('a`b'), '`a\\`b`'));
for (const sql of [
    'SELECT 1',
    'SELECT * FROM system.tables',
    "SELECT 'DROP'",
    'WITH 1 AS n SELECT n',
    'EXPLAIN SELECT 1',
    'EXPLAIN ANALYZE SELECT 1',
    'SHOW CREATE TABLE events',
    'SHOW CREATE DATABASE analytics',
    'SHOW CREATE VIEW recent_events',
    'SHOW CREATE DICTIONARY event_types',
    'SHOW CREATE USER analyst',
    'SHOW CREATE ROLE reader',
    'SHOW CREATE ROW POLICY tenant_policy ON events',
    'SHOW CREATE QUOTA analyst_quota',
    'SHOW CREATE SETTINGS PROFILE analyst_profile',
    'SHOW SETTINGS',
    "SHOW SETTINGS LIKE 'max_threads'",
    "SHOW CHANGED SETTINGS ILIKE '%memory%'",
])
    test(`Read-only accepts ${sql}`, () => assert.doesNotThrow(() => guardSql(sql)));
for (const sql of [
    'DELETE FROM t',
    'SELECT 1; DROP TABLE t',
    'SELECT 1 SETTINGS readonly=0',
    "SELECT * FROM url('http://example.invalid')",
    'SELECT 1 FORMAT CSV',
    'SHOW CREATE TABLE events SETTINGS readonly=0',
    'SHOW CREATE TABLE events FORMAT CSV',
    'SHOW SETTINGS FORMAT CSV',
])
    test(`Read-only guard rejects ${sql}`, () => assert.throws(() => guardSql(sql)));
test('Missing named parameter is explicit', () =>
    assert.throws(() => guardSql('SELECT {n:UInt64}'), { code: 'MISSING_PARAMETER' }));
for (const name of ['cluster', 'clusterAllReplicas', 'CLUSTER', 'ClUsTeRaLlRePlIcAs']) {
    for (const spacing of ['', ' ', '\n', ' /* comment */ '])
        test(`External I/O guard rejects ${name} with spacing ${JSON.stringify(spacing)}`, () => {
            assert.throws(() => guardSql(`SELECT ${name}${spacing}()`), { code: 'EXTERNAL_IO' });
        });
}
test('Cluster names in data, comments, and column identifiers remain valid', () => {
    for (const sql of [
        "SELECT 'cluster() clusterAllReplicas()'",
        'SELECT 1 /* cluster() */',
        'SELECT cluster, clusterAllReplicas FROM events',
        'SELECT `cluster` FROM events',
    ])
        assert.doesNotThrow(() => guardSql(sql));
});
test('SQL comment detection ignores comment markers inside quoted values', () => {
    assert.equal(hasSqlComments("SELECT '-- text', '/* text */', '# text'"), false);
    assert.equal(hasSqlComments('SELECT 1 -- note'), true);
    assert.equal(hasSqlComments('SELECT 1 /* note */'), true);
    assert.equal(hasSqlComments('SELECT 1 # note'), true);
});
test('Top-level output FORMAT detection ignores literals, comments, identifiers, and nested queries', () => {
    for (const sql of [
        "SELECT 'FORMAT JSONEachRow' AS note",
        'SELECT format FROM events',
        'SELECT (SELECT value FROM nested FORMAT JSONEachRow) AS value',
        'SELECT 1 -- FORMAT JSONEachRow',
        'SELECT 1 /* FORMAT JSONEachRow */',
    ])
        assert.equal(hasTopLevelOutputFormat(sql), false, sql);
    for (const sql of [
        'SELECT 1 FORMAT JSONEachRow',
        'SELECT 1 FORMAT JSONEachRow; -- trailing comment',
        "SELECT * FROM events INTO OUTFILE 'out.json' FORMAT JSONEachRow",
        'SELECT 1 SETTINGS max_threads = 2 FORMAT JSONEachRow',
    ])
        assert.equal(hasTopLevelOutputFormat(sql), true, sql);
});
test('Read-only guard gives the exploration message for output FORMAT', () => {
    assert.throws(() => guardSql('SELECT 1 FORMAT JSONEachRow'), {
        code: 'READ_ONLY_SQL',
        message: 'FORMAT is not allowed in exploration SQL',
    });
});
test('Read-only guard permits a column named format', () =>
    assert.doesNotThrow(() => guardSql('SELECT format FROM events')));
test('SQL formatter preserves literals and comments while laying out clauses', () => {
    const formatted = formatSql(
        "select 'a  from  b' as value -- keep  spaces\nfrom events where value = 'x;y' and id = 1;",
    );
    assert.ok(formatted.includes("'a  from  b'"));
    assert.ok(formatted.includes('-- keep  spaces'));
    assert.ok(formatted.includes("'x;y'"));
    assert.match(formatted, /\nFROM events\nWHERE/);
});
test('SQL formatter protects nested comments and heredocs byte-for-byte', () => {
    const nested = '/* outer  from /* inner  where */ order by */';
    const heredoc = '$tag$ keep  from  where\n and order by $tag$';
    const formatted = formatSql(
        `select ${nested} value from events where note = ${heredoc} and id = 1`,
    );
    assert.ok(formatted.includes(nested));
    assert.ok(formatted.includes(heredoc));
    assert.match(formatted, /\nFROM events\nWHERE/);
});
test('SQL formatter keeps a line break after inline comments', () => {
    const formatted = formatSql('select a -- keep this line\n, b from events');
    assert.ok(formatted.includes('-- keep this line\n,'));
});
test('Hard limits cannot be raised', () => assert.throws(() => limits({ rows: 1e8 })));
test('Unknown limit cannot exploit prototype', () =>
    assert.throws(() => limits(JSON.parse('{"__proto__":1}'))));
test('Unsafe JSON integers reject rather than lose precision', () =>
    assert.throws(() => validateJson(JSON.parse('{"id":18446744073709551615}'))));
test('Int64 encoded as a string remains lossless', () =>
    assert.equal(validateJson({ id: '18446744073709551615' }).id, '18446744073709551615'));
test('Request tags cannot smuggle arbitrary secret fields', () =>
    assert.throws(() =>
        runRequest({
            clientRequestId: 'a',
            connectionId: 'local',
            sql: 'SELECT 1',
            tags: { password: 'x' },
        }),
    ));
test('EXPLAIN PLAN is an accepted run kind', () =>
    assert.equal(
        runRequest({
            clientRequestId: 'plan-1',
            connectionId: 'local',
            sql: 'SELECT 1',
            kind: 'plan',
        }).kind,
        'plan',
    ));
test('EXPLAIN ANALYZE is an accepted run kind', () =>
    assert.equal(
        runRequest({
            clientRequestId: 'analyze-1',
            connectionId: 'local',
            sql: 'SELECT 1',
            kind: 'analyze',
        }).kind,
        'analyze',
    ));
test('Unknown explain run kinds are rejected', () =>
    assert.throws(
        () =>
            runRequest({
                clientRequestId: 'plan-2',
                connectionId: 'local',
                sql: 'SELECT 1',
                kind: 'explain-json',
            }),
        { code: 'INVALID_KIND' },
    ));
for (const experience of ['beginner', 'expert'])
    test(`Workspace mode ${experience} is a valid query tag`, () =>
        assert.equal(
            runRequest({
                clientRequestId: 'a',
                connectionId: 'local',
                sql: 'SELECT 1',
                tags: { workspace: 'clickstudio', experience },
            }).tags.experience,
            experience,
        ));

test('SQL token ranges preserve doubled quotes, escapes, heredocs, and nested comments', () => {
    const sql =
        "/* outer /* inner */ done */ SELECT 'it''s', `a``b`, \"c\\\"d\", $tag$a;b$tag$; SELECT 2";
    const tokens = lexSql(sql);
    for (const token of tokens) assert.equal(sql.slice(token.from, token.to), token.text);
    assert.deepEqual(
        tokens.filter(token => token.kind === 'quoted').map(token => token.text),
        ["'it''s'", '`a``b`', '"c\\"d"', '$tag$a;b$tag$'],
    );
    assert.equal(splitSql(sql).length, 2);
});

for (const [suffix, message] of [
    ["'unfinished\\", 'Unclosed quoted value or identifier'],
    ['"unfinished""', 'Unclosed quoted value or identifier'],
    ['`unfinished\\', 'Unclosed quoted value or identifier'],
    ['/* outer /* inner */', 'Unclosed block comment'],
    ['$tag$unfinished', 'Unclosed heredoc'],
]) {
    test(`Strict SQL scanning rejects ${suffix} while formatting preserves the draft`, () => {
        const prefix = 'select 1 from events where note = ';
        assert.throws(() => lexSql(prefix + suffix), {
            message,
            position: prefix.length,
        });
        assert.ok(formatSql(prefix + suffix).endsWith(suffix));
    });
}
