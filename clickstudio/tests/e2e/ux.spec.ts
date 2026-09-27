import { test, expect, type Page } from '@playwright/test';
import { openBlankSql, runButton, trust } from './helpers.js';

function countRuns(page: Page) {
    let count = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') count++;
    });
    return () => count;
}

test('A no-match row filter stays local and can be cleared without rerunning SQL', async ({ page }) => {
    const runs = countRuns(page);
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results' });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    const filter = results.getByRole('searchbox', { name: 'Filter current page' });
    await filter.fill('no-row-can-match-this');
    await expect(results.getByText('No rows match on this page.')).toBeVisible();
    await expect(results.getByText('This query returned zero rows.')).toHaveCount(0);
    await filter.fill('');
    await expect(results.locator('tbody tr')).toHaveCount(7);
    expect(runs()).toBe(1);
});

test('SQL document tabs support arrow and Home/End keyboard navigation', async ({ page }) => {
    await trust(page);
    await openBlankSql(page);
    await openBlankSql(page);
    const tabs = page.getByRole('tablist', { name: 'SQL documents' }).getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await tabs.first().focus();
    await tabs.first().press('End');
    await expect(tabs.last()).toBeFocused();
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await tabs.last().press('Home');
    await expect(tabs.first()).toBeFocused();
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await tabs.first().press('ArrowLeft');
    await expect(tabs.last()).toBeFocused();
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
});

test('Retained-result pagination reaches the end without rerunning SQL', async ({ page }) => {
    let runs = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runs++;
    });
    await page.route(url => url.pathname.endsWith('/result'), async route => {
        const response = await route.fetch();
        const result = await response.json();
        const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
        const rows = Array.from({ length: Math.min(200, 450 - offset) }, (_, index) => [`row-${offset + index}`]);
        await route.fulfill({ response, json: {
            ...result,
            columns: [{ name: 'label', type: 'String' }],
            rows,
            offset,
            totalRows: 450,
            nextOffset: offset + rows.length < 450 ? offset + rows.length : null,
            completeness: 'complete',
        } });
    });
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(results.locator('tbody tr')).toHaveCount(200);
    await results.getByRole('button', { name: 'Last', exact: true }).click();
    await expect(results.getByText('Page 3 of 3')).toBeVisible();
    await expect(results.locator('tbody tr')).toHaveCount(50);
    await expect(results.getByText(/Showing 50 of 450 retained rows/)).toBeVisible();
    expect(runs).toBe(1);
});
