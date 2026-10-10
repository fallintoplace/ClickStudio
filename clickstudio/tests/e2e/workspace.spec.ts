import { test, expect, type Page } from '@playwright/test';
import {
    currentQueryId,
    openBlankSql,
    replaceSql,
    runButton,
    runIdentity,
    jsonRecord,
    trust,
    trustCurrentConnection,
} from './helpers.js';

function countRunRequests(page: Page) {
    let count = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') count++;
    });
    return () => count;
}

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} plus opens a blank SQL tab and preserves the current draft`, async ({ page }) => {
        await page.addInitScript(
            experience => localStorage.setItem('clickstudio:experience', experience),
            mode === 'Standard' ? 'beginner' : 'expert',
        );
        const runs = countRunRequests(page);
        await trust(page);
        const sql = 'SELECT 42 AS keep_my_draft';
        await replaceSql(page, sql);
        const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
        const originalTab = tabs.getByRole('tab').first();
        const originalName = await originalTab.getAttribute('aria-label');
        await page.getByRole('button', { name: 'Collapse SQL query', exact: true }).click();

        await page.getByTestId('new-sql').click();

        await expect(tabs.getByRole('tab')).toHaveCount(2);
        await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('.cm-content')).toHaveText('');
        await expect(page.locator('.cm-content')).toBeFocused();
        await expect(page.locator('#sql-editor-content')).toBeVisible();
        await expect(page.getByRole('dialog', { name: 'Explore ClickStudio' })).toHaveCount(0);
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
        expect(originalName).not.toBeNull();
        await page.getByRole('tab', { name: originalName!, exact: true }).click();
        await page.getByRole('button', { name: 'Expand SQL query', exact: true }).click();
        await expect(page.locator('.cm-content')).toHaveText(sql);
        expect(runs()).toBe(0);
    });
}

test('Execution IDs are available from copyable details instead of the footer', async ({
    page,
}) => {
    await trust(page);
    const response = page.waitForResponse(
        request =>
            request.request().method() === 'POST' &&
            new URL(request.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    const run = runIdentity(await (await response).json());

    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', run.queryId);
    await expect(page.locator('.execution-bar')).not.toContainText(run.queryId);
    await page.getByTestId('execution-details').click();
    const queryId = page.getByTestId('run-query-id');
    await expect(queryId.locator('strong')).toHaveText(run.queryId);
    await expect(queryId.locator('button[title="Copy query ID"]')).toBeVisible();
});

async function switchConnection(page: Page, name: string) {
    const picker = page.locator('.connection-trigger');
    await picker.click();
    await page
        .getByRole('dialog', { name: 'Connection details', exact: true })
        .getByRole('button')
        .filter({ hasText: name })
        .click();
    await expect(picker).toContainText(name);
}

test('Server version stays visible through execution and follows the active connection', async ({
    page,
}) => {
    const versions = ['26.6.1.2326', '25.8.4.13'];
    await page.route('**/api/connections', async route => {
        const response = await route.fetch();
        const connections: unknown[] = await response.json();
        await route.fulfill({
            response,
            json: connections.map((value, index) => {
                const connection = jsonRecord(value, 'Connection');
                return {
                    ...connection,
                    name: `Version ${index + 1}`,
                    dataSource: 'clickhouse',
                    manifest: {
                        ...jsonRecord(connection.manifest, 'Connection manifest'),
                        serverVersion: versions[index],
                    },
                };
            }),
        });
    });
    await page.goto('/');
    const footer = page.locator('.execution-bar');
    const version = footer.getByTestId('server-version');
    await expect(footer).toHaveAttribute('data-run-status', 'ready');
    await expect(version).toHaveText('ClickHouse 26.6.1.2326');
    await trustCurrentConnection(page);

    let releaseRun: () => void = () => {};
    const runGate = new Promise<void>(resolve => {
        releaseRun = resolve;
    });
    const runCollection = (url: URL) => url.pathname === '/api/runs';
    await page.route(runCollection, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const response = await route.fetch();
        await route.fulfill({
            response,
            json: {
                ...(await response.json()),
                status: 'running',
                serverVersion: 'old-run-version',
            },
        });
    });
    await page.route(/^.*\/api\/runs\/[^/]+(?:\/events)?$/, async route => {
        await runGate;
        await route.continue();
    });
    try {
        await runButton(page).click();
        await expect(footer).toHaveAttribute('data-run-status', 'running');
        await expect(version).toHaveText('ClickHouse 26.6.1.2326');
        await expect(footer.locator('.execution-link-state')).toHaveText('Reconnecting');
        for (const width of [320, 390, 900, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await expect(version).toBeInViewport();
            const bounds = await version.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
            expect(
                await footer.evaluate(element => element.scrollWidth - element.clientWidth),
            ).toBe(0);
        }
    } finally {
        releaseRun();
    }
    await expect(footer).toHaveAttribute('data-run-status', 'succeeded');
    await expect(version).toHaveText('ClickHouse 26.6.1.2326');
    await expect(footer).not.toContainText('Complete');

    await page.unroute(runCollection);
    await page.route(runCollection, route =>
        route.request().method() === 'POST'
            ? route.fulfill({ status: 400, json: { code: 'QUERY_TEST_FAILED', message: 'Failed' } })
            : route.continue(),
    );
    await runButton(page).click();
    await expect(footer).toHaveAttribute('data-run-status', 'failed');
    await expect(version).toHaveText('ClickHouse 26.6.1.2326');
    await openBlankSql(page);
    await expect(footer).toHaveAttribute('data-run-status', 'ready');
    await expect(version).toHaveText('ClickHouse 26.6.1.2326');
    await switchConnection(page, 'Version 2');
    await expect(version).toHaveText('ClickHouse 25.8.4.13');
    await switchConnection(page, 'Version 1');
    await expect(version).toHaveText('ClickHouse 26.6.1.2326');
});

test('Run, chart, save and reload preserve the same execution evidence', async ({ page }) => {
    const runs = countRunRequests(page);
    await trust(page);
    await page.getByTestId('run-button').click();
    const results = page.getByRole('region', { name: 'Query results' });
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await expect(results.getByRole('cell', { name: '2026-01-01', exact: true })).toBeVisible();
    const queryId = await currentQueryId(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('svg[role="img"]')).toBeVisible();
    const saveResponse = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    const saved = (await (await saveResponse).json()) as { revision: number };
    expect(saved.revision).toBe(1);
    await page.reload();
    const recovered = page.getByRole('region', { name: 'Query results' });
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await expect(recovered.getByRole('cell', { name: '2026-01-01', exact: true })).toBeVisible();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    expect(runs()).toBe(1);
});

test("Switching connections never reuses another connection's result", async ({ page }) => {
    await trust(page);
    await page.getByTestId('run-button').click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await switchConnection(page, 'Another sample');
    await trustCurrentConnection(page);
    await expect(page.getByRole('region', { name: 'Query results' })).toHaveCount(0);
    await switchConnection(page, 'Sample data');
    await expect(
        page
            .getByRole('region', { name: 'Query results' })
            .getByRole('cell', { name: '2026-01-01', exact: true }),
    ).toBeVisible();
});

test('Closing and reopening a result tab does not execute SQL again', async ({ page }) => {
    const runs = countRunRequests(page);
    await trust(page);
    await page
        .getByRole('textbox', { name: 'SQL document name', exact: true })
        .fill('Recoverable.sql');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT {value:UInt64}');
    await expect(editor).toContainText('SELECT {value:UInt64}');
    await page.getByRole('textbox', { name: 'value:UInt64', exact: true }).fill('9007199254740993');
    await page.getByTestId('run-button').click();
    const results = page.getByRole('region', { name: 'Query results' });
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    const queryId = await currentQueryId(page);
    await page.getByRole('button', { name: 'Close Recoverable.sql', exact: true }).click();
    await expect(results).toHaveCount(0);
    const restoreTrigger = page.getByRole('button', { name: 'Restore', exact: true });
    await restoreTrigger.click();
    const restoreMenu = page.getByRole('menu', { name: 'Recently closed SQL tabs', exact: true });
    const placement = await restoreMenu.evaluate(element => {
        const trigger = document.querySelector<HTMLElement>('.restore-sql-trigger');
        if (!trigger) throw new Error('Restore trigger missing');
        const menuRect = element.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        return {
            menuLeft: menuRect.left,
            menuRight: menuRect.right,
            triggerLeft: triggerRect.left,
            triggerRight: triggerRect.right,
            viewportWidth: window.innerWidth,
        };
    });
    expect(placement.menuLeft).toBeGreaterThanOrEqual(0);
    expect(placement.menuRight).toBeLessThanOrEqual(placement.viewportWidth);
    expect(placement.menuRight).toBeLessThanOrEqual(placement.triggerRight + 1);
    expect(placement.menuLeft).toBeLessThan(placement.triggerLeft);
    await restoreMenu.getByRole('menuitem', { name: /Recoverable\.sql/ }).click();
    await expect(page.getByRole('textbox', { name: 'SQL document name', exact: true })).toHaveValue(
        'Recoverable.sql',
    );
    await expect(page.getByRole('textbox', { name: 'value:UInt64', exact: true })).toHaveValue(
        '9007199254740993',
    );
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    expect(runs()).toBe(1);
});

test('overflowing SQL tabs keep controls visible and expose scroll buttons', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 800 });
    await trust(page);

    const names = [
        'Johnson & Johnson price history.sql',
        'Taxi trips by weekday and hour.sql',
        'EUR/USD monthly midpoint.sql',
        'Amazon customer review health.sql',
        'Service latency SLO.sql',
        'EUR/USD Pro market view.sql',
    ];

    for (const [index, name] of names.entries()) {
        await page.getByRole('textbox', { name: 'SQL document name', exact: true }).fill(name);
        if (index < names.length - 1) await openBlankSql(page);
    }

    const tabList = page.getByRole('tablist', { name: 'SQL documents', exact: true });
    const newSql = page.getByTestId('new-sql');
    const scrollLeft = page.getByTestId('scroll-sql-tabs-left');
    const scrollRight = page.getByTestId('scroll-sql-tabs-right');
    const activeTab = page.getByRole('tab', { name: names.at(-1)!, exact: true });

    await expect(newSql).toBeVisible();
    await expect(scrollLeft).toBeVisible();
    await expect(scrollRight).toBeVisible();
    await expect(activeTab).toBeVisible();
    await expect(scrollLeft).toBeEnabled();
    await expect(scrollRight).toBeDisabled();

    const layout = await tabList.evaluate(node => {
        const active = node.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        if (!active) throw new Error('Active SQL tab not found');
        const containerRect = node.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        return {
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
            scrollLeft: node.scrollLeft,
            activeWidth: activeRect.width,
            activeLeft: activeRect.left,
            activeRight: activeRect.right,
            containerLeft: containerRect.left,
            containerRight: containerRect.right,
        };
    });

    expect(layout.activeWidth).toBeGreaterThanOrEqual(160);
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
    expect(layout.activeLeft).toBeGreaterThanOrEqual(layout.containerLeft - 1);
    expect(layout.activeRight).toBeLessThanOrEqual(layout.containerRight + 1);

    await scrollLeft.click();
    await expect
        .poll(() => tabList.evaluate(node => node.scrollLeft))
        .toBeLessThan(layout.scrollLeft);
    await expect(scrollRight).toBeEnabled();
    await expect(newSql).toBeVisible();
});
