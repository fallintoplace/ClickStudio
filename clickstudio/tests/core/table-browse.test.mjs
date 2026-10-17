import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseTableBrowseRequest,
    buildTableBrowseSql,
    tableBrowseDraftSql,
    MAX_BROWSE_PAGE,
} from '../../.core-build/src/shared/database/browse/table-browse.js';

const columns = [
    { name: 'event_id', type: 'UInt64' },
    { name: 'message', type: 'String' },
    { name: 'events', type: 'Array(UInt64)' },
];

test('table browser validates paging and sorts only verified scalar columns', () => {
    const page = parseTableBrowseRequest({
        database: 'analytics',
        table: 'events',
        orderColumn: 'event_id',
        direction: 'desc',
        page: 2,
    });
    const result = buildTableBrowseSql(page, columns);
    assert.match(result.sql, /ORDER BY .*event_id.* DESC LIMIT 201 OFFSET 400/);
    assert.deepEqual(result.parameters, {});
    assert.throws(() => buildTableBrowseSql({ ...page, orderColumn: 'bad' }, columns));
    assert.throws(() => buildTableBrowseSql({ ...page, orderColumn: 'events' }, columns));
    assert.throws(() => parseTableBrowseRequest({ ...page, page: MAX_BROWSE_PAGE + 1 }));
});
test('table browser quotes identifiers and binds user input, never interpolates values', () => {
    const req = {
        database: 'db',
        table: 'tab',
        orderColumn: 'event_id',
        direction: 'asc',
        page: 0,
        filterColumn: 'message',
        filterValue: "a' OR 1=1 --",
    };
    const query = buildTableBrowseSql(req, columns);
    assert.match(query.sql, /toString\(.*message.*\) = \{browseValue:String\}/);
    assert.ok(!query.sql.includes('OR 1=1'));
    assert.deepEqual(query.parameters, { browseValue: "a' OR 1=1 --" });
    assert.ok(tableBrowseDraftSql(req, columns).includes("a\\' OR 1=1 --"));
});
test('table browser requires column and value together', () => {
    const req = {
        database: 'db',
        table: 'tab',
        orderColumn: 'event_id',
        direction: 'asc',
        page: 0,
    };
    assert.throws(() => parseTableBrowseRequest({ ...req, filterColumn: 'message' }));
    assert.throws(() => parseTableBrowseRequest({ ...req, filterValue: 'x' }));
});

test('table browser projects only the requested column window', () => {
    const wide = Array.from({ length: 30 }, (_, index) => ({
        name: 'col_' + index,
        type: 'String',
    }));
    const input = {
        database: 'analytics',
        table: 'wide_events',
        orderColumn: 'col_0',
        direction: 'asc',
        page: 1,
        columnStart: 12,
    };
    const generated = buildTableBrowseSql(input, wide);
    assert.equal(generated.columnStart, 12);
    assert.equal(generated.totalColumns, 30);
    assert.match(generated.sql, /^SELECT `col_12`, `col_13`/);
    assert.match(generated.sql, /`col_23` FROM/);
    assert.doesNotMatch(generated.sql, /SELECT \*/);
    assert.doesNotMatch(generated.sql, /`col_24`/);
    assert.match(generated.sql, /ORDER BY `col_0` ASC LIMIT 201 OFFSET 200/);
    assert.throws(() => buildTableBrowseSql({ ...input, columnStart: 30 }, wide), /column window/);
    assert.throws(() => parseTableBrowseRequest({ ...input, columnStart: 501 }), /column window/);
});
test('editable SQL keeps pagination text inside filter values unchanged', () => {
    const input = {
        database: 'db',
        table: 'events',
        orderColumn: 'event_id',
        direction: 'asc',
        page: 0,
        filterColumn: 'message',
        filterValue: 'alpha LIMIT 201 OFFSET beta',
    };
    const draft = tableBrowseDraftSql(input, columns);
    assert.ok(draft.includes("'alpha LIMIT 201 OFFSET beta'"));
    assert.match(draft, /LIMIT 200 OFFSET 0$/);
    assert.equal((draft.match(/LIMIT 201 OFFSET/g) ?? []).length, 1);
});
