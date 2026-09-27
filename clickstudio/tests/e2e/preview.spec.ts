import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { openWorkspacePanel } from './helpers.js';

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

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.inspector-footer').getByRole('button', { name: 'Export', exact: true }).click(),
    ]);
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv.split('\r\n')[0]).toContain('day');
    expect(csv).toContain('events');
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
