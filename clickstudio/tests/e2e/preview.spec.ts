import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { openWorkspacePanel } from './helpers.js';

const previewCloudSchema = {
    connectionId: 'clickhouse-cloud',
    fetchedAt: '2026-09-28T00:00:00.000Z',
    tables: [{ database: 'default', name: 'events', engine: 'MergeTree' }],
    columns: [
        { database: 'default', table: 'events', name: 'day', type: 'Date', defaultKind: '', comment: '' },
        { database: 'default', table: 'events', name: 'events', type: 'UInt64', defaultKind: '', comment: '' },
    ],
    warnings: [],
    truncated: false,
};

async function mockCloudEndpoint(page: Page, commitOutcome: 'success' | 'unknown' = 'success', cloudSchema = previewCloudSchema, onSchemaAfterImport?: () => void) {
    const imports: string[] = [];
    let activeSchema = cloudSchema;
    let importSucceeded = false;
    await page.route('**/api/cloud', async route => {
        const request = route.request();
        const contentType = request.headers()['content-type'] ?? '';
        if (contentType.startsWith('multipart/form-data')) {
            const body = request.postData() ?? '';
            imports.push(body);
            const queryId = body.match(/name="queryId"\r\n\r\n([^\r\n]+)/)?.[1] ?? 'clickstudio-import-00000000-0000-4000-8000-000000000000';
            const table = body.match(/name="target"\r\n\r\n([^\r\n]+)/)?.[1] ?? 'default.events';
            const format = body.match(/name="format"\r\n\r\n([^\r\n]+)/)?.[1];
            const fileContents = body.match(/name="file"; filename="[^\"]+"\r\nContent-Type: [^\r\n]+\r\n\r\n([\s\S]*?)\r\n--/)?.[1] ?? '';
            const rows = format === 'json'
                ? (JSON.parse(fileContents) as unknown[]).length
                : format === 'ndjson'
                    ? fileContents.split(/\r?\n/).filter(Boolean).length
                    : Math.max(0, fileContents.trim().split(/\r?\n/).length - 1);
            const id = queryId.replace('clickstudio-import-', '');
            if (commitOutcome === 'unknown') {
                await route.fulfill({ status: 502, json: { error: { code: 'CLICKHOUSE_ERROR', message: 'The request ended before the insert response arrived.' } } });
                return;
            }
            const createValue = body.match(/name="createTable"\r\n\r\n([^\r\n]+)/)?.[1];
            const createTable = createValue ? JSON.parse(createValue) as { name: string; columns: { name: string; type: string }[]; generateId: boolean } : undefined;
            const targetValue = createTable ? `default.${createTable.name}` : table;
            if (createTable) {
                activeSchema = {
                    ...activeSchema,
                    tables: [...activeSchema.tables.filter(item => item.name !== createTable.name), { database: 'default', name: createTable.name, engine: 'MergeTree' }],
                    columns: [...activeSchema.columns.filter(item => item.table !== createTable.name), ...createTable.columns.map(column => ({ database: 'default', table: createTable.name, name: column.name, type: column.type, defaultKind: '', comment: '' })), ...(createTable.generateId ? [{ database: 'default', table: createTable.name, name: 'id', type: 'UInt64', defaultKind: 'DEFAULT', comment: '' }] : [])],
                };
            }
            importSucceeded = true;
            await route.fulfill({ json: { id, connectionId: 'clickhouse-cloud', table: targetValue, queryId, rows, createdAt: '2026-09-28T00:00:00.000Z', status: 'succeeded' } });
            return;
        }
        const body = request.postDataJSON() as { action?: string; queryId?: string; table?: string; rows?: number };
        if (body.action === 'test') {
            await route.fulfill({ json: { host: 'service.region.provider.clickhouse.cloud:8443', database: 'default', username: 'demo', serverVersion: '26.1', queryLog: { available: true }, queryLogSource: 'user_query_log', replication: { available: false, reason: 'Unavailable in this preview test.' } } });
            return;
        }
        if (body.action === 'schema') {
            if (importSucceeded) onSchemaAfterImport?.();
            await route.fulfill({ json: activeSchema });
            return;
        }
        if (body.action === 'import-status') {
            await route.fulfill({ json: { id: (body.queryId ?? '').replace('clickstudio-import-', ''), connectionId: 'clickhouse-cloud', table: body.table, queryId: body.queryId, rows: body.rows, createdAt: '2026-09-28T00:00:00.000Z', status: 'unknown', error: 'ClickHouse could not confirm the insert. The rows may already be there.' } });
            return;
        }
        await route.fulfill({ status: 409, json: { error: { code: 'UNEXPECTED_ACTION', message: 'Unexpected Cloud action in this import test.' } } });
    });
    return imports;
}

async function connectPreviewCloud(page: Page) {
    await page.goto('/');
    await page.locator('.connection-trigger').click();
    await page.getByRole('button', { name: 'Connect ClickHouse Cloud' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect to your service' });
    await dialog.getByLabel('HTTPS host').fill('service.region.provider.clickhouse.cloud:8443');
    await dialog.getByLabel('Database').fill('default');
    await dialog.getByLabel('Username').fill('demo');
    await dialog.getByLabel('Password').fill('demo-password');
    await dialog.getByRole('button', { name: 'Connect service' }).click();
    await expect(page.locator('.connection-trigger')).toContainText('CLICKHOUSE CLOUD');
}

test('Static production preview loads the native parser and exports retained sample results', async ({ page }) => {
    const documentationRequests: string[] = [];
    page.on('request', request => {
        const payload = `${request.url()}\n${request.postData() ?? ''}`;
        if (payload.includes('system.documentation')) documentationRequests.push(payload);
    });
    const wasmResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/assets/clickhouse-parser.wasm');
    await page.goto('/');

    const wasmResponse = await wasmResponsePromise;
    expect(wasmResponse.status()).toBe(200);
    expect(wasmResponse.headers()['content-type']).toMatch(/^application\/wasm/);
    expect(Array.from((await wasmResponse.body()).subarray(0, 4))).toEqual([0, 97, 115, 109]);

    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('Ready · local WebAssembly')).toBeVisible();
    await expect(page.getByText('Valid ClickHouse SQL')).toBeVisible();

    await page.locator('.connection-trigger').click();
    await page.getByRole('dialog', { name: 'Data source options' })
        .getByRole('button', { name: /Sample data/ }).click();

    await page.getByRole('button', { name: 'Reference', exact: true }).click();
    await expect(page.getByTestId('reference-source')).toContainText('Offline ClickHouse reference');
    await page.getByTestId('reference-search').fill('MergeTree');
    const mergeTree = page.getByRole('option', { name: /MergeTree Table Engine/ }).first();
    await expect(mergeTree).toBeVisible();
    await mergeTree.click();
    const article = page.getByRole('article', { name: 'Table Engine: MergeTree' });
    await expect(article).toContainText('general-purpose engine');
    await expect(article.locator('.reference-markdown code')).toContainText('ORDER BY');
    await article.getByRole('button', { name: 'Insert name', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('MergeTree');
    expect(documentationRequests).toEqual([]);

    await page.getByRole('button', { name: 'Objects', exact: true }).click();
    await page.getByTestId('schema-search').fill('events');
    const table = page.getByRole('button', { name: 'events MergeTree', exact: true });
    await expect(table).toBeVisible();
    await table.click();

    await page.locator('.inspector-footer').getByRole('button', { name: 'Export', exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export' });
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        exportDialog.getByRole('button', { name: /Export rows/ }).click(),
    ]);
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv.split('\r\n')[0]).toContain('day');
    expect(csv).toContain('events');
    await page.locator('.inspector-footer').getByRole('button', { name: 'Export', exact: true }).click();
    const [queryDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: /Export query/ }).click(),
    ]);
    expect(queryDownload.suggestedFilename()).toMatch(/\.sql$/);
    expect(await readFile(await queryDownload.path(), 'utf8')).toContain('SELECT');
});

test('Static production preview searches native Playground docs with bound query parameters', async ({ page }) => {
    const requests: Array<{ url: string; sql: string }> = [];
    await page.route('https://sql-clickhouse.clickhouse.com:8443/**', async route => {
        const request = route.request();
        const sql = request.postData() ?? '';
        if (!sql.includes('system.documentation')) return route.continue();
        requests.push({ url: request.url(), sql });
        const details = sql.includes('version() AS serverVersion');
        const columns = details ? ['name', 'type', 'description', 'source', 'serverVersion'] : ['name', 'type', 'source'];
        const values = details ? ['MergeTree', 'Table Engine', 'MergeTree docs. Use `ORDER BY` for the sorting key.', 'src/Storages/MergeTree', '24.6-test'] : ['MergeTree', 'Table Engine', 'src/Storages/MergeTree'];
        const body = [JSON.stringify(columns), JSON.stringify(columns.map(() => 'String')), JSON.stringify(values), ''].join('\n');
        await route.fulfill({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }, body });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Reference', exact: true }).click();
    await page.getByTestId('reference-search').fill('MergeTree');
    const mergeTree = page.getByRole('option', { name: /MergeTree Table Engine/ }).first();
    await expect(mergeTree).toBeVisible();
    await mergeTree.click();
    const article = page.getByRole('article', { name: 'Table Engine: MergeTree' });
    await expect(article).toContainText('MergeTree docs.');
    await expect(article.locator('.reference-markdown code')).toContainText('ORDER BY');
    expect(requests.some(request => request.sql.includes('{search:String}') && new URL(request.url).searchParams.get('param_search') === 'MergeTree')).toBe(true);
    expect(requests.some(request => request.sql.includes('name = {name:String}') && new URL(request.url).searchParams.get('param_name') === 'MergeTree')).toBe(true);
});

test('Playground examples preview real SQL and open a draft without executing it', async ({ page }) => {
    const exampleSqlRequests: string[] = [];
    page.on('request', request => {
        const requestText = `${request.url()}\n${request.postData() ?? ''}`;
        if (new URL(request.url()).hostname === 'sql-clickhouse.clickhouse.com' && requestText.includes('toDate(created_at) AS day'))
            exampleSqlRequests.push(requestText);
    });
    await page.goto('/');
    await page.getByTestId('new-sql').click();

    const dialog = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('ClickHouse Playground', { exact: true })).toBeVisible();
    await dialog.getByTestId('sql-example-category-openSource').click();
    const dailyActivity = dialog.getByTestId('sql-example-github-daily-activity');
    await expect(dailyActivity).toBeVisible();
    await dailyActivity.click();
    await expect(dialog.locator('.sql-example-preview code')).toContainText('FROM github.events');
    await dialog.getByTestId('open-sql-example').click();

    await expect(page.getByRole('tab', { name: 'Daily activity.sql', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content')).toContainText('FROM github.events');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    await expect(page.locator('.execution-bar code')).toHaveCount(0);
    expect(exampleSqlRequests).toEqual([]);
});

test('Charts filter opens a localized chart example in a new SQL tab without executing it', async ({ page }) => {
    const exampleSqlRequests: string[] = [];
    page.on('request', request => {
        const requestText = `${request.url()}\n${request.postData() ?? ''}`;
        if (new URL(request.url()).hostname === 'sql-clickhouse.clickhouse.com' && requestText.includes('toStartOfMonth(datetime) AS month'))
            exampleSqlRequests.push(requestText);
    });

    await page.goto('/');
    await page.getByTestId('new-sql').click();
    const dialog = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
    await dialog.getByTestId('sql-example-category-charts').click();

    const forexExample = dialog.getByTestId('sql-example-forex-eur-usd-monthly');
    await expect(forexExample).toBeVisible();
    await forexExample.click();
    await expect(dialog.locator('.sql-example-preview')).toContainText('Forex');
    await expect(dialog.locator('.sql-example-preview code')).toContainText('FROM forex.forex');
    await expect(dialog.locator('.sql-example-readonly')).toHaveText('Line chart');
    await dialog.getByTestId('open-sql-example').click();

    await expect(page.getByRole('tab', { name: 'EUR/USD monthly midpoint.sql', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content')).toContainText('FROM forex.forex');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    expect(exampleSqlRequests).toEqual([]);
});

test('Static preview includes materialized views and storage activity in sample mode', async ({ page }) => {
    await page.goto('/');
    await page.locator('.connection-trigger').click();
    await page.getByRole('dialog', { name: 'Data source options' }).getByRole('button', { name: /Sample data/ }).click();
    await page.getByRole('button', { name: 'Objects', exact: true }).click();
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const graph = page.getByRole('dialog', { name: 'Materialized view dependencies', exact: true });
    await expect(graph).toContainText('SAMPLE DATA');
    await expect(graph.locator('.native-lineage-node')).toHaveCount(5);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
    await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
    const storage = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
    await storage.getByRole('button', { name: 'Merges', exact: true }).click();
    await expect(storage).toContainText('67%');
    await expect(storage).toContainText('SAMPLE DATA');
});

test('Geo Help demo runs native Point values and renders twenty cities', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Help', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
    await dialog.getByTestId('help-section-geo').click();
    await expect(dialog.locator('.workspace-help-geo-copy code')).toContainText("(13.405, 52.52)::Point");
    await dialog.getByTestId('run-geo-example').click();

    await expect(page.getByRole('tab', { name: 'Native Point cities.sql', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded', { timeout: 30_000 });
    await expect(page.locator('.geo-map')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.geo-feature.geo-point')).toHaveCount(20);
    await expect(page.locator('.geo-map-caption')).toContainText('20 valid features');
    await expect(page.getByText('No returned rows contain valid longitude/latitude geometry for this selection.', { exact: true })).toHaveCount(0);
});

test('ClickHouse Cloud import maps and inserts into an existing table without typed confirmation', async ({ page }) => {
    const imports = await mockCloudEndpoint(page);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-27,10\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Preview file' }).click();
    await expect(dialog).toContainText('2 rows · 2 columns · CSV');
    await dialog.getByRole('button', { name: 'Map columns' }).click();
    await expect(dialog.getByRole('radio', { name: /Use an existing table/ })).toBeChecked();
    await expect(dialog.getByLabel('Map day to destination')).toHaveValue('day');
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows' }).click();

    await expect(dialog).toContainText('Inserted 2 rows into default.events');
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain('name="file"; filename="events.csv"');
    expect(imports[0]).not.toContain('name="confirmation"');
    expect(imports[0]).toContain('name="fields"\r\n\r\n{"day":"day","events":"events"}');
});

test('ClickHouse Cloud import creates a table with editable inferred columns', async ({ page }) => {
    const imports = await mockCloudEndpoint(page);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'interview events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-27,10\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Preview file' }).click();
    await dialog.getByRole('button', { name: 'Map columns' }).click();
    await dialog.getByRole('radio', { name: /Create a new table from this file/ }).check();
    await expect(dialog.getByLabel('New table name')).toHaveValue('interview_events');
    await expect(dialog.getByLabel('Type for day')).toHaveValue('Date');
    await expect(dialog.getByLabel('Type for events')).toHaveValue('UInt64');
    await expect(dialog.getByRole('checkbox', { name: /Add a generated id/ })).toBeChecked();
    await dialog.getByLabel('New table name').fill('interview_events');
    await dialog.getByLabel('New column name for day').fill('event_day');
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await expect(dialog).toContainText('2 rows into default.interview_events');
    await expect(dialog).toContainText('Generated by ClickHouse');
    await dialog.getByRole('button', { name: 'Create table and import' }).click();

    await expect(dialog).toContainText('Inserted 2 rows into default.interview_events');
    const createTable = imports[0]?.match(/name="createTable"\r\n\r\n([^\r\n]+)/)?.[1];
    expect(createTable).toBeTruthy();
    expect(JSON.parse(createTable!)).toMatchObject({ name: 'interview_events', generateId: true, columns: [{ source: 'day', name: 'event_day', type: 'Date' }, { source: 'events', name: 'events', type: 'UInt64' }] });
});

test('ClickHouse Cloud import refreshes and reveals the created table', async ({ page }) => {
    let schemaRefreshesAfterImport = 0;
    await mockCloudEndpoint(page, 'success', { ...previewCloudSchema, tables: [], columns: [] }, () => { schemaRefreshesAfterImport++; });
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'interview events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-27,10\n'),
    });
    await dialog.getByRole('button', { name: 'Preview file' }).click();
    await dialog.getByRole('button', { name: 'Map columns' }).click();
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Create table and import' }).click();
    await expect(dialog).toContainText('Inserted 1 row into default.interview_events');
    await expect.poll(() => schemaRefreshesAfterImport).toBeGreaterThan(0);

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('region', { name: 'Selected object' })).toContainText('default.interview_events');
    await expect(page.getByRole('button', { name: 'interview_events MergeTree', exact: true })).toBeVisible();
});

test('ClickHouse Cloud insert row leaves defaulted columns out and needs no typed confirmation', async ({ page }) => {
    const cloudSchema = {
        ...previewCloudSchema,
        columns: [...previewCloudSchema.columns, { database: 'default', table: 'events', name: 'created_at', type: 'DateTime', defaultKind: 'DEFAULT', comment: '' }],
    };
    const imports = await mockCloudEndpoint(page, 'success', cloudSchema);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Objects', exact: true }).click();
    await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
    await page.getByRole('button', { name: 'Insert row', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Insert row', exact: true });
    await dialog.getByLabel('day').fill('2026-09-28');
    await dialog.getByLabel('events').fill('12');
    await dialog.getByRole('button', { name: 'Review row' }).click();
    await expect(dialog.locator('pre')).toContainText('"day": "2026-09-28"');
    await expect(dialog.locator('pre')).not.toContainText('created_at');
    await dialog.getByRole('button', { name: 'Insert row', exact: true }).click();

    await expect(dialog).toContainText('Inserted one row into default.events.');
    expect(imports).toHaveLength(1);
    expect(imports[0]).not.toContain('name="confirmation"');
    expect(imports[0]).toContain('name="fields"\r\n\r\n{"day":"day","events":"events"}');
    const row = imports[0]!.match(/name="file"; filename="insert-row\.json"\r\nContent-Type: [^\r\n]+\r\n\r\n([\s\S]*?)\r\n--/)?.[1];
    expect(JSON.parse(row!)).toEqual([{ day: '2026-09-28', events: '12' }]);
});

test('ClickHouse Cloud can create a table from a file when no tables exist', async ({ page }) => {
    const imports = await mockCloudEndpoint(page, 'success', { ...previewCloudSchema, tables: [], columns: [] });
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('event,count\npurchase,2\n'),
    });
    await expect(dialog.getByRole('button', { name: 'Preview file' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Preview file' }).click();
    await dialog.getByRole('button', { name: 'Map columns' }).click();

    await expect(dialog.getByRole('radio', { name: /Use an existing table/ })).toBeDisabled();
    await expect(dialog.getByRole('radio', { name: /Create a new table from this file/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Add a generated id/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Create table and import' }).click();

    await expect(dialog).toContainText('Inserted 1 row into default.events');
    expect(imports).toHaveLength(1);
    const createTable = imports[0]?.match(/name="createTable"\r\n\r\n([^\r\n]+)/)?.[1];
    expect(JSON.parse(createTable!)).toMatchObject({ name: 'events', generateId: true });
});

test('ClickHouse Cloud import shows clear choices after an interrupted write', async ({ page }) => {
    const imports = await mockCloudEndpoint(page, 'unknown');
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Preview file' }).click();
    await dialog.getByRole('button', { name: 'Map columns' }).click();
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows' }).click();

    await expect(dialog).toContainText('We couldn’t confirm the import.');
    await expect(dialog).toContainText('A late first import may add duplicate rows.');
    await dialog.getByRole('button', { name: 'Check status' }).click();
    await expect(dialog).toContainText('We couldn’t confirm the import.');
    await expect(dialog.getByRole('button', { name: 'I see all rows' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'No rows; retry import' })).toBeVisible();
    expect(imports).toHaveLength(1);
});
