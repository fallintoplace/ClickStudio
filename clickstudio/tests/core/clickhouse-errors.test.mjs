import test from 'node:test';
import assert from 'node:assert/strict';
import { parseError as parseNodeError } from '@clickhouse/client';
import { parseError as parseWebError } from '@clickhouse/client-web';

const serverError = 'Code: 62. DB::Exception: Syntax error: failed at position 39 (FORMAT) (line 2, col 1): FORMAT JSONCompactStringsEachRowWithNamesAndTypes. Expected one of: SETTINGS, ParallelWithClause, PARALLEL WITH, end of query. (SYNTAX_ERROR) (version 26.10.1.39301 (official build))';

test('ClickHouse client parsers keep the complete diagnostic when it contains a FORMAT token', () => {
    for (const parseError of [parseNodeError, parseWebError]) {
        const error = parseError(serverError);
        assert.equal(error.code, '62');
        assert.equal(error.type, 'SYNTAX_ERROR');
        assert.match(error.message, /Expected one of: SETTINGS, ParallelWithClause, PARALLEL WITH, end of query\./);
        assert.notEqual(error.message, 'Syntax error: failed at position 39');
    }
});

test('ClickHouse client parsers still recognize server errors without a version suffix', () => {
    for (const parseError of [parseNodeError, parseWebError]) {
        const error = parseError('Code: 62. DB::Exception: Syntax error. (SYNTAX_ERROR)');
        assert.equal(error.code, '62');
        assert.equal(error.type, 'SYNTAX_ERROR');
        assert.equal(error.message, 'Syntax error.');
    }
});
