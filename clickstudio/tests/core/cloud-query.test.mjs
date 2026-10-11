import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudResultStreamQuery } from '../../.core-build/src/backend/database/clickhouse/query-format.js';
import { splitSql } from '../../.core-build/src/shared/sql/sql.js';

test('Cloud result format follows a normalized SQL statement', () => {
    for (const sql of ['SELECT 1;', 'SELECT 1; -- trailing comment', "SELECT ';'"]) {
        const [statement] = splitSql(sql);
        assert.ok(statement);
        assert.equal(
            cloudResultStreamQuery(statement),
            `${statement.sql}\nFORMAT JSONCompactEachRowWithNamesAndTypes`,
        );
        assert.doesNotMatch(cloudResultStreamQuery(statement), /;\s*\nFORMAT/);
    }
});
