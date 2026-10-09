import { readFile } from 'node:fs/promises';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Schema } from '../../shared/types.js';
import type { CloudConnectionTest } from '../../web/cloud-connection.js';
import { openWorkspacePanel } from './helpers.js';

const previewCloudSchema: Schema = {
    connectionId: 'clickhouse-cloud',
    fetchedAt: '2026-09-28T00:00:00.000Z',
    databases: ['default'],
    tables: [{ database: 'default', name: 'events', engine: 'MergeTree' }],
    columns: [
        { database: 'default', table: 'events', name: 'day', type: 'Date', defaultKind: '', comment: '' },
        { database: 'default', table: 'events', name: 'events', type: 'UInt64', defaultKind: '', comment: '' },
    ],
    warnings: [],
    truncated: false,
};

const previewCloudConnectionTest: CloudConnectionTest = {
    host: 'service.region.provider.clickhouse.cloud:8443',
    database: 'default',
    username: 'demo',
    serverVersion: '26.1',
    queryLog: { available: true },
    queryLogSource: 'user_query_log',
    replication: { available: false, reason: 'Unavailable in this preview test.' },
    progress: { available: false, reason: 'Unavailable in this preview test.' },
    cancellation: { available: false, reason: 'Unavailable in this preview test.' },
    explain: { available: false, reason: 'Unavailable in this preview test.' },
    explainPlan: { available: false, reason: 'Unavailable in this preview test.' },
    explainAnalyze: { available: false, reason: 'Unavailable in this preview test.' },
    queryTree: { available: false, reason: 'Unavailable in this preview test.' },
    explainPipeline: { available: false, reason: 'Unavailable in this preview test.' },
    pipeline: { available: false, reason: 'Unavailable in this preview test.' },
    traceLog: { available: false, reason: 'Unavailable in this preview test.' },
    documentation: { available: false, reason: 'Unavailable in this preview test.' },
    parameters: { available: false, reason: 'Unavailable in this preview test.' },
};

async function mockCloudEndpoint(page: Page, commitOutcome: 'success' | 'unknown' | 'running' = 'success', cloudSchema = previewCloudSchema, onSchemaAfterImport?: () => void) {
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
            const createValue = body.match(/name="createTable"\r\n\r\n([^\r\n]+)/)?.[1];
            const createTable = createValue ? JSON.parse(createValue) as { name: string; columns: { name: string; type: string }[]; generateId: boolean } : undefined;
            const targetValue = createTable ? `default.${createTable.name}` : table;
            const unresolvedOutcome = commitOutcome === 'unknown' || (commitOutcome === 'running' && imports.length === 1);
            if (unresolvedOutcome) {
                const status = commitOutcome === 'unknown' ? 'unknown' : 'running';
                await route.fulfill({ json: {
                    id, connectionId: 'clickhouse-cloud', table: targetValue, queryId, rows,
                    createdAt: '2026-09-28T00:00:00.000Z', status,
                    ...(status === 'unknown'
                        ? { tableExists: true, error: 'ClickHouse could not confirm the insert. The rows may already be there.' }
                        : { reconciliationRequired: true }),
                } });
                return;
            }
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
            await route.fulfill({ json: previewCloudConnectionTest });
            return;
        }
        if (body.action === 'schema') {
            if (importSucceeded) onSchemaAfterImport?.();
            await route.fulfill({ json: activeSchema });
            return;
        }
        if (body.action === 'import-status') {
            const running = commitOutcome === 'running';
            await route.fulfill({ json: { id: (body.queryId ?? '').replace('clickstudio-import-', ''), connectionId: 'clickhouse-cloud', table: body.table, queryId: body.queryId, rows: body.rows, createdAt: '2026-09-28T00:00:00.000Z', status: running ? 'running' : 'unknown', ...(!running ? { tableExists: true, error: 'ClickHouse could not confirm the insert. The rows may already be there.' } : { reconciliationRequired: true }) } });
            return;
        }
        await route.fulfill({ status: 409, json: { error: { code: 'UNEXPECTED_ACTION', message: 'Unexpected Cloud action in this import test.' } } });
    });
    return imports;
}

async function connectPreviewCloud(page: Page) {
    await page.goto('/');
    const connectButton = page.getByRole('button', { name: 'Connect Cloud' });
    await expect(connectButton).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Data source options' })).toHaveCount(0);
    await connectButton.click();
    const dialog = page.getByRole('dialog', { name: 'Connect to your service' });
    await dialog.getByLabel('HTTPS host').fill('service.region.provider.clickhouse.cloud:8443');
    await dialog.getByLabel('Database').fill('default');
    await dialog.getByLabel('Username').fill('demo');
    await dialog.getByLabel('Password').fill('demo-password');
    await dialog.getByRole('button', { name: 'Connect service' }).click();
    await expect(page.locator('.connection-trigger')).toContainText('CLICKHOUSE CLOUD');
    await expect(page.getByRole('button', { name: 'Disconnect Cloud' })).toBeVisible();
}

async function chooseExistingCloudTable(dialog: Locator) {
    await dialog.getByRole('radio', { name: /Add to a table/ }).check();
    await dialog.getByLabel('Import target table').selectOption('default.events');
}

test('Cloud actions stay outside the source picker and disconnect preserves another source', async ({ page }) => {
    await mockCloudEndpoint(page);
    await page.setViewportSize({ width: 384, height: 768 });
    await connectPreviewCloud(page);

    const disconnectButton = page.getByRole('button', { name: 'Disconnect Cloud' });
    await expect(disconnectButton).toBeVisible();
    const bounds = await disconnectButton.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('Disconnect button should have a visible bounding box.');
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(384);

    await page.locator('.connection-trigger').click();
    await page.getByRole('dialog', { name: 'Data source options' })
        .getByRole('button', { name: /ClickHouse Playground/ }).click();
    await expect(page.locator('.connection-trigger')).toContainText('PLAYGROUND');
    await expect(disconnectButton).toBeVisible();

    await disconnectButton.click();
    await expect(page.locator('.connection-trigger')).toContainText('PLAYGROUND');
    await expect(page.getByRole('button', { name: 'Connect Cloud' })).toBeVisible();
});

test('Disconnecting the active Cloud source falls back to Playground', async ({ page }) => {
    await mockCloudEndpoint(page);
    await connectPreviewCloud(page);

    await page.getByRole('button', { name: 'Disconnect Cloud' }).click();

    await expect(page.locator('.connection-trigger')).toContainText('PLAYGROUND');
    await expect(page.getByRole('button', { name: 'Connect Cloud' })).toBeVisible();
});

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

    await page.getByRole('navigation', { name: 'Workspace browser' }).getByRole('button', { name: 'Reference' }).click();
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

    await page.getByRole('navigation', { name: 'Workspace browser' }).getByRole('button', { name: 'Objects' }).click();
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
    await page.getByRole('navigation', { name: 'Workspace browser' }).getByRole('button', { name: 'Reference' }).click();
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

test('Static production preview retries missing source metadata and uses native entries from offline search', async ({ page }) => {
    const requests: string[] = [];
    await page.route('https://sql-clickhouse.clickhouse.com:8443/**', async route => {
        const sql = route.request().postData() ?? '';
        if (!sql.includes('system.documentation')) return route.continue();
        requests.push(sql);
        if (sql.includes(', source')) {
            await route.fulfill({
                status: 500,
                headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' },
                body: "Code: 47. DB::Exception: Unknown expression identifier `source` in scope SELECT name, source FROM system.documentation. (UNKNOWN_IDENTIFIER) (version 26.1.0.0)",
            });
            return;
        }
        const details = sql.includes('version() AS serverVersion');
        const columns = details ? ['name', 'type', 'description', 'serverVersion'] : ['name', 'type'];
        const rows = details ? [['MergeTree', 'Table Engine', 'Live MergeTree documentation.', '26.1-test']] : [];
        const body = [JSON.stringify(columns), JSON.stringify(columns.map(() => 'String')), ...rows.map(row => JSON.stringify(row)), ''].join('\n');
        await route.fulfill({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }, body });
    });

    await page.goto('/');
    await page.getByRole('navigation', { name: 'Workspace browser' }).getByRole('button', { name: 'Reference' }).click();
    await page.getByTestId('reference-search').fill('MergeTree');
    const mergeTree = page.getByRole('option', { name: /MergeTree Table Engine/ }).first();
    await expect(mergeTree).toBeVisible();
    await expect(page.getByTestId('reference-source')).toContainText('Offline ClickHouse reference');
    await mergeTree.click();

    const article = page.getByRole('article', { name: 'Table Engine: MergeTree' });
    await expect(article).toContainText('Live MergeTree documentation.');
    await expect(article.locator('.reference-entry-heading small')).toHaveText('ClickHouse 26.1-test');
    expect(requests.filter(sql => sql.includes(', source')).length).toBeGreaterThanOrEqual(2);
    expect(requests.some(sql => sql.includes('name = {name:String}') && !sql.includes(', source'))).toBe(true);
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
    await expect(page.locator('.execution-bar')).not.toHaveAttribute('data-query-id');
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
    await page.getByRole('navigation', { name: 'Workspace browser' }).getByRole('button', { name: 'Objects' }).click();
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const graph = page.getByRole('dialog', { name: 'Materialized view dependencies', exact: true });
    await expect(graph).toContainText('SAMPLE DATA');
    await expect(graph.locator('.native-lineage-node')).toHaveCount(5);
    await expect(graph.locator('.native-lineage-node rect').first()).toHaveCSS('rx', '4px');
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
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await expect(dialog).toContainText('2 rows · 2 columns · CSV');
    const mappingStep = dialog.getByRole('region', { name: 'Map source columns' });
    await expect(mappingStep).toHaveCSS('row-gap', '15px');
    await chooseExistingCloudTable(dialog);
    await expect(dialog.getByRole('radio', { name: /Add to a table/ })).toBeChecked();
    await expect(dialog.getByLabel('Map day to destination')).toHaveValue('day');
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();

    await expect(dialog).toContainText('2 source rows processed successfully');
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain('name="file"; filename="events.csv"');
    expect(imports[0]).not.toContain('name="confirmation"');
    expect(imports[0]).toContain('name="fields"\r\n\r\n{"day":"day","events":"events"}');
});

test('ClickHouse Cloud import requires an exact table before review', async ({ page }) => {
    const imports = await mockCloudEndpoint(page);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();

    const existing = dialog.getByRole('radio', { name: /Add to a table/ });
    const create = dialog.getByRole('radio', { name: /Create a table/ });
    await expect(existing).toBeChecked();
    await expect(create).not.toBeChecked();
    await expect(dialog.getByLabel('Import target table')).toHaveValue('');
    await expect(dialog.locator('.import-mapping-empty-state')).toContainText('Choose a table');
    await expect(dialog.getByRole('button', { name: 'Choose a table', exact: true })).toBeDisabled();

    await existing.check();
    await expect(dialog.getByLabel('Import target table')).toHaveValue('');
    await dialog.getByLabel('Import target table').selectOption('default.events');
    await expect(dialog.getByLabel('Map day to destination')).toHaveValue('day');
    await expect(dialog.getByRole('button', { name: 'Review import', exact: true })).toBeEnabled();
    expect(imports).toHaveLength(0);
});

test('ClickHouse Cloud import explains when no source columns are mapped', async ({ page }) => {
    await mockCloudEndpoint(page);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'clickstudio-json-export.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('event_id,message,active,id\n1,hello,true,42\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);

    const mappingStep = dialog.getByRole('region', { name: 'Map source columns' });
    const mappingCounts = mappingStep.locator('.import-mapping-counts');
    const emptyState = mappingStep.getByRole('status');
    await expect(mappingCounts).toContainText('0 mapped');
    await expect(mappingCounts).toContainText('4 skipped');
    await expect(emptyState).toContainText('No columns mapped yet');
    await expect(emptyState).toContainText('Skipped columns will not be imported.');
    await expect(emptyState).toContainText('Create a table');
    for (const source of ['event_id', 'message', 'active', 'id']) {
        await expect(dialog.getByLabel(`Map ${source} to destination`)).toHaveValue('');
    }
    await expect(dialog.getByRole('button', { name: 'Map a column first', exact: true })).toBeDisabled();

    await dialog.getByLabel('Map message to destination').selectOption('day');
    await expect(mappingCounts).toContainText('1 mapped');
    await expect(mappingCounts).toContainText('3 skipped');
    await expect(emptyState).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Review import', exact: true })).toBeEnabled();
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
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await dialog.getByRole('radio', { name: /Create a table/ }).check();
    await expect(dialog.getByLabel('New table name')).toHaveValue('interview_events');
    await expect(dialog.getByLabel('Type for day')).toHaveValue('Date');
    await expect(dialog.getByLabel('Type for events')).toHaveValue('UInt64');
    await expect(dialog.getByRole('checkbox', { name: /Add a generated id/ })).toBeChecked();
    await dialog.getByLabel('New table name').fill('interview_events');
    const mappingCounts = dialog.locator('.import-mapping-counts');
    await expect(mappingCounts).toContainText('2 mapped');
    await expect(mappingCounts).toContainText('0 skipped');
    await dialog.getByLabel('New column name for day').fill('event_day');
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await expect(dialog.getByRole('heading', { name: 'Ready to import into default.interview_events' })).toBeVisible();
    await expect(dialog.locator('.import-review-metrics')).toContainText('2 rows');
    const generatedIdRow = dialog.getByRole('row', { name: /Generated id/ });
    await expect(generatedIdRow).toContainText('ClickHouse');
    await expect(generatedIdRow).toContainText('UInt64');
    await dialog.getByRole('button', { name: 'Create table and import' }).click();

    await expect(dialog).toContainText('2 source rows processed successfully');
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
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await dialog.getByRole('radio', { name: /Create a table/ }).check();
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Create table and import' }).click();
    await expect(dialog).toContainText('1 source row processed successfully');
    await expect.poll(() => schemaRefreshesAfterImport).toBeGreaterThan(0);

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('region', { name: 'Selected object' })).toContainText('default.interview_events');
    await page.getByRole('button', { name: '‹ Objects', exact: true }).click();
    await expect(page.getByRole('button', { name: 'interview_events MergeTree', exact: true })).toBeVisible();
});

test('ClickHouse Cloud insert row leaves defaulted columns out and needs no typed confirmation', async ({ page }) => {
    const cloudSchema = {
        ...previewCloudSchema,
        columns: [...previewCloudSchema.columns, { database: 'default', table: 'events', name: 'created_at', type: 'DateTime', defaultKind: 'DEFAULT', comment: '' }],
    };
    const imports = await mockCloudEndpoint(page, 'success', cloudSchema);
    await connectPreviewCloud(page);
    await page.getByRole('navigation', { name: 'Workspace browser' }).getByRole('button', { name: 'Objects' }).click();
    await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
    await page.getByRole('button', { name: 'Insert row', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Insert row', exact: true });
    await dialog.getByLabel('day').fill('2026-09-28');
    await dialog.getByLabel('events').fill('12');
    await dialog.getByRole('button', { name: 'Review row' }).click();
    await expect(dialog.locator('pre')).toContainText('"day": "2026-09-28"');
    await expect(dialog.locator('pre')).not.toContainText('created_at');
    await dialog.getByRole('button', { name: 'Insert row', exact: true }).click();

    await expect(dialog).toContainText('ClickHouse acknowledged an insert request containing one row for default.events');
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
    await expect(dialog.getByRole('button', { name: 'Read file and continue' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();

    await expect(dialog.getByRole('radio', { name: /Add to a table/ })).toBeDisabled();
    const create = dialog.getByRole('radio', { name: /Create a table/ });
    await expect(create).not.toBeChecked();
    await create.check();
    await expect(create).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Add a generated id/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Create table and import' }).click();

    await expect(dialog).toContainText('1 source row processed successfully');
    expect(imports).toHaveLength(1);
    const createTable = imports[0]?.match(/name="createTable"\r\n\r\n([^\r\n]+)/)?.[1];
    expect(JSON.parse(createTable!)).toMatchObject({ name: 'events', generateId: true });
});

test('ClickHouse Cloud import flags invalid mappings before review and inspects unknown imports', async ({ page }) => {
    const schemaWithId = {
        ...previewCloudSchema,
        columns: [
            ...previewCloudSchema.columns.map(column => column.name === 'day' ? { ...column, type: 'Nullable(Date)' } : column),
            { database: 'default', table: 'events', name: 'id', type: 'UInt64', defaultKind: 'DEFAULT', comment: '' },
        ],
    };
    const imports = await mockCloudEndpoint(page, 'unknown', schemaWithId);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-01-01,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);
    const dayMapping = dialog.getByLabel('Map day to destination');
    await dayMapping.focus();
    await dayMapping.selectOption('id');

    const mappingError = dialog.locator('#import-mapping-error-0');
    await expect(mappingError).toContainText('Input row 1: "day" value "2026-01-01" cannot be inserted into "id" (UInt64).');
    await expect(dayMapping).toHaveAttribute('aria-invalid', 'true');
    await expect(dayMapping).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Fix column mapping' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Import rows', exact: true })).toHaveCount(0);
    expect(imports).toHaveLength(0);

    await dayMapping.selectOption('day');
    await expect(mappingError).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();

    await expect(dialog).toContainText('ClickHouse couldn’t confirm the rows in default.events.');
    await expect(dialog).toContainText('ClickHouse could not confirm the insert. The rows may already be there.');
    await expect(dialog.getByRole('button', { name: 'Open table to inspect' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Check status' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Rows missing/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Forget import and continue' })).toHaveCount(0);
    expect(imports).toHaveLength(1);

    await dialog.getByRole('button', { name: 'Open table to inspect' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'Selected object' })).toContainText('default.events');
    await expect(page.getByText(/default\.events in Objects\. Check whether the imported rows are there\./)).toBeVisible();

    await page.getByRole('button', { name: 'Import', exact: true }).last().click();
    await expect(dialog).toContainText('ClickHouse could not confirm the insert. The rows may already be there.');
    await expect(dialog.getByRole('button', { name: 'I checked; the rows are there' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /retry|rows missing/i })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Check status' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'I checked; the rows are there' }).click();
    await expect(dialog.locator('.import-status-card.is-success')).toContainText('You confirmed the imported rows in default.events');
    await expect(dialog.getByRole('button', { name: 'Import another file' })).toBeVisible();
    expect(imports).toHaveLength(1);
});

test('ClickHouse Cloud import can be confirmed after the user checks the selected table', async ({ page }) => {
    const imports = await mockCloudEndpoint(page, 'unknown');
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();
    await dialog.getByRole('button', { name: 'Open table to inspect' }).click();
    await expect(dialog).not.toBeVisible();

    await page.getByRole('button', { name: 'Import', exact: true }).last().click();
    await dialog.getByRole('button', { name: 'I checked; the rows are there' }).click();
    await expect(dialog.locator('.import-status-card.is-success')).toContainText('You confirmed the imported rows in default.events');
    expect(imports).toHaveLength(1);
});

test('ClickHouse Cloud import can be closed and forgotten so another file can be imported', async ({ page }) => {
    const imports = await mockCloudEndpoint(page, 'running');
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    let dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'stuck.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-27,10\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();
    await expect(dialog).toContainText('ClickHouse still reports this import as active.');
    await expect(dialog.getByRole('button', { name: 'Close import wizard' })).toBeEnabled();

    await dialog.getByRole('button', { name: 'Close import wizard' }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();
    dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await expect(dialog).toContainText('ClickHouse still reports this import as active.');
    await dialog.getByRole('button', { name: 'Forget import and continue' }).click();

    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'other.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-29,30\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();

    await expect(dialog).toContainText('1 source row processed successfully');
    expect(imports).toHaveLength(2);
    expect(imports[0]).toContain('filename="stuck.csv"');
    expect(imports[1]).toContain('filename="other.csv"');
});
