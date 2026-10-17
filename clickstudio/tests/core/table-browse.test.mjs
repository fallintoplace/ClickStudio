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
