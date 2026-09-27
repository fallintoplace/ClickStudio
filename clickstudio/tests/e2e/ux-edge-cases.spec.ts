import { test, expect } from '@playwright/test';
import { trust } from './helpers.js';

test('An empty truncated retained result does not claim the query matched no rows', async ({ page }) => {
    await page.route(url => url.pathname.endsWith('/result'), async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: { ...result, rows: [], totalRows: 0, nextOffset: null, completeness: 'truncated' } });
    });
    await trust(page);
    await page.getByTestId('run-button').click();
    const results = page.getByRole('region', { name: 'Query results' });
    await expect(results.getByText(/No rows fit in the retained result\./)).toBeVisible();
    await expect(results.getByText('This query returned zero rows.')).toHaveCount(0);
});

test('Switching between result and chart views keeps the same execution selected', async ({ page }) => {
    let runs = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runs++;
    });
    await trust(page);
    await page.getByTestId('run-button').click();
    const results = page.getByRole('region', { name: 'Query results' });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('svg[role="img"]')).toBeVisible();
    await expect(results.getByRole('table')).toHaveCount(0);
    await results.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    expect(runs).toBe(1);
});
