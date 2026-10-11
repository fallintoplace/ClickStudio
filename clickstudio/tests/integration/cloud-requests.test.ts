import test from 'node:test';
import assert from 'node:assert/strict';
import cloudApi from '../../api/cloud.js';
import * as cloud from '../../src/frontend/common/requests/sources/cloud-connection.js';

const credentials = {
    host: 'service.clickhouse.cloud:8443',
    database: 'default',
    username: 'reader',
    password: 'fixture-password',
};
const tested = {
    host: credentials.host,
    serverVersion: '25.1',
    queryLogSource: 'query_log',
    traceLogSource: 'symbolized',
};

test('Cloud wrappers preserve action spellings and their JSON request fields', async t => {
    const requests: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        requests.push(JSON.parse(String(options?.body)) as unknown);
        assert.equal(options?.method, 'POST');
        assert.equal(options?.credentials, 'same-origin');
        return Response.json(tested);
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials);
    await cloud.runClickHouseCloudSql('SELECT {value:String}', 'session-id', {
        queryId: 'query-id',
        parameters: { value: 'x' },
    });
    await cloud.loadClickHouseCloudSchema({ tableOffset: 1000 });
    await cloud.loadClickHouseCloudQueryTree('SELECT 1', {});
    await cloud.loadClickHouseCloudProgress('query-id');
    await cloud.cancelClickHouseCloudQuery('query-id');
    await cloud.loadClickHouseCloudProfileEvidence('query-id');
    await cloud.loadClickHouseCloudPipeline('SELECT 1', {});
    await cloud.loadClickHouseCloudFlamegraph(
        'query-id',
        '2026-10-10T12:00:00Z',
        '2026-10-10T12:01:00Z',
    );
    await cloud.searchClickHouseCloudDocumentation('sum', 'functions');
    await cloud.loadClickHouseCloudDocumentationEntry('sum', 'Function');
    await cloud.loadClickHouseCloudNativeExplorer(
        { kind: 'lineage', database: 'default' },
        new AbortController().signal,
    );
    await cloud.loadClickHouseCloudNativeExplorer(
        { kind: 'mutations', database: 'default', table: 'events' },
        new AbortController().signal,
    );
    await cloud.loadClickHouseCloudTableParts('default', 'events', new AbortController().signal);
    await cloud.createClickHouseCloudTable({
        database: 'default',
        name: 'events',
        columns: [{ name: 'value', type: 'String' }],
        orderBy: 'tuple()',
    });
    await cloud.dropClickHouseCloudTable('default', 'events', 'events');
    await cloud.checkClickHouseCloudImport('import-id', 'default.events', 2, 'deduplication-token');
    await cloud.loadClickHouseCloudWorkload(60, new AbortController().signal);
    await cloud.loadClickHouseCloudReplication(new AbortController().signal);

    const expected = [
        { action: 'test' },
        {
            action: 'run',
            sql: 'SELECT {value:String}',
            sessionId: 'session-id',
            queryId: 'query-id',
            parameters: { value: 'x' },
        },
        { action: 'schema', tableOffset: 1000 },
        { action: 'query-tree', sql: 'SELECT 1', parameters: {} },
        { action: 'progress', queryId: 'query-id' },
        { action: 'cancel', queryId: 'query-id' },
        { action: 'profile', queryId: 'query-id', source: 'query_log' },
        { action: 'pipeline', sql: 'SELECT 1', parameters: {} },
        {
            action: 'flamegraph',
            queryId: 'query-id',
            startDate: '2026-10-10',
            endDate: '2026-10-10',
            source: 'symbolized',
        },
        { action: 'documentation-search', query: 'sum', category: 'functions' },
        { action: 'documentation-entry', name: 'sum', type: 'Function', serverVersion: '25.1' },
        { action: 'native-explorer', kind: 'lineage', database: 'default' },
        { action: 'native-explorer', kind: 'mutations', database: 'default', table: 'events' },
        { action: 'table-parts', database: 'default', table: 'events' },
        {
            action: 'create-table',
            database: 'default',
            name: 'events',
            columns: [{ name: 'value', type: 'String' }],
            orderBy: 'tuple()',
        },
        { action: 'drop-table', database: 'default', table: 'events', confirmation: 'events' },
        {
            action: 'import-status',
            queryId: 'import-id',
            table: 'default.events',
            rows: 2,
            deduplicationToken: 'deduplication-token',
        },
        { action: 'workload', minutes: 60, source: 'query_log' },
        { action: 'replication' },
    ];
    assert.deepEqual(
        requests,
        expected.map(body => ({ ...body, credentials })),
    );
});

test('Local Cloud sessions continue to omit credentials from JSON and multipart requests', async t => {
    const requests: Array<{ url: unknown; options?: RequestInit }> = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
        requests.push({ url, options });
        return Response.json(tested);
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials, true);
    await cloud.runClickHouseCloudSql('SELECT 1');
    await cloud.importClickHouseCloudFile({
        file: new File(['value\nx'], 'rows.csv'),
        format: 'csv',
        target: 'default.events',
        fields: { value: 'value' },
        queryId: 'import-id',
    });
    assert.deepEqual(JSON.parse(String(requests[0]?.options?.body)), { credentials });
    assert.deepEqual(JSON.parse(String(requests[1]?.options?.body)), {
        action: 'run',
        sql: 'SELECT 1',
    });
    const form = requests[2]?.options?.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('action'), 'import-commit');
    assert.equal(form.has('credentials'), false);
    assert.equal(form.get('format'), 'csv');
    assert.equal(form.get('target'), 'default.events');
    assert.equal(form.get('queryId'), 'import-id');
    assert.equal(form.get('fields'), '{"value":"value"}');
    const file = form.get('file');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'rows.csv');
    assert.equal(await file.text(), 'value\nx');
});

test('Unknown Cloud JSON actions keep their error and credential validation precedence', async () => {
    const request = (body: unknown) =>
        new Request('http://localhost/api/cloud', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    for (const action of [
        'unknown',
        'constructor',
        'toString',
        '__proto__',
        'import-commit',
        null,
        1,
    ]) {
        const response = await cloudApi.fetch(request({ action, credentials }));
        assert.equal(response.status, 400);
        assert.equal(
            ((await response.json()) as { error: { code: string } }).error.code,
            'CLOUD_ACTION',
        );
    }
    const response = await cloudApi.fetch(request({ action: 'unknown' }));
    assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        'CLOUD_CREDENTIALS',
    );
});
