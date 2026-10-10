import { test, expect } from '@playwright/test';
import { trust, openWorkspacePanel, runButton } from './helpers.js';

test('Materialized views have selectable dependency edges and refresh details', async ({
    page,
}, info) => {
    await trust(page);
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: 'Materialized view dependencies',
        exact: true,
    });
    await expect(dialog).toContainText('SAMPLE DATA');
    await expect(dialog).toHaveCSS('border-radius', '4px');
    await expect(dialog.locator('.native-lineage-node rect').first()).toHaveCSS('rx', '4px');
    await dialog
        .getByRole('button', { name: 'demo.monthly_report_mv: Refreshable MV', exact: true })
        .click();
    await expect(dialog.getByLabel('Selected object')).toContainText('EVERY 10 MINUTE');
    await expect(dialog.getByLabel('Selected object')).toContainText('8,400 ms');
    await expect(dialog.locator('.native-edge.edge-catalog-dependency')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('clickstudio-materialized-views.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'View dependencies', exact: true }),
    ).toBeFocused();
});

test('Storage tabs show merge flow and honest mutation completion', async ({ page }, info) => {
    await trust(page);
    await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
    await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
    await dialog.getByRole('button', { name: 'Merges', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Merge activity' })).toContainText('67%');
    await expect(dialog).toContainText('202609_101_105_1');
    await expect(dialog.getByRole('checkbox', { name: /Auto-refresh/ })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('clickstudio-merges.png') });
    await dialog.getByRole('button', { name: 'Mutations', exact: true }).click();
    await expect(dialog).toContainText('Parts remaining');
    await expect(dialog).toContainText('Incomplete · last attempt failed');
    await expect(dialog.getByRole('progressbar')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('clickstudio-mutations.png') });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
});

test('Run comparison selects two retained runs without executing another query', async ({
    page,
}, info) => {
    await trust(page);
    for (const sql of ['SELECT 1 AS value', 'SELECT 2 AS value']) {
        await page.locator('.cm-content').click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.insertText(sql);
        const submitted = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/runs',
        );
        await runButton(page).click();
        const next = (await (await submitted).json()) as { queryId: string };
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', next.queryId);
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
    }
    let submissions = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            submissions++;
    });
    await openWorkspacePanel(page, 'history');
    await page.getByRole('button', { name: 'Compare runs', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Compare query runs', exact: true });
    await expect(dialog.getByLabel('Before run')).toBeVisible();
    await expect(dialog.getByLabel('After run')).toBeVisible();
    await expect(dialog.locator('.native-comparison-table')).toContainText(
        'Client-observed elapsed time',
    );
    await dialog.getByRole('button', { name: 'Swap ⇄', exact: true }).click();
    await expect(dialog.locator('.native-comparison-table')).toContainText('Retained result rows');
    await expect(
        dialog.getByRole('rowheader', { name: /Client-observed elapsed time/ }),
    ).toBeInViewport();
    expect(
        (await dialog.locator('.native-comparison-table-scroll').boundingBox())?.height,
    ).toBeGreaterThan(200);
    await page.screenshot({ path: info.outputPath('clickstudio-run-comparison.png') });
    expect(submissions).toBe(0);
});

test('Denied metadata shows an actionable error, never substitute sample data', async ({
    page,
}) => {
    await trust(page);
    await page.route('**/api/connections/demo/native-explorer', route =>
        route.fulfill({
            status: 403,
            json: {
                error: {
                    code: 'CLICKHOUSE_PERMISSION',
                    message: 'Not enough privileges to read system.tables',
                },
            },
        }),
    );
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: 'Materialized view dependencies',
        exact: true,
    });
    await expect(dialog.getByRole('alert')).toContainText('Not enough privileges');
    await expect(dialog.locator('.native-lineage-node')).toHaveCount(0);
    await expect(dialog).not.toContainText('SAMPLE DATA');
});
