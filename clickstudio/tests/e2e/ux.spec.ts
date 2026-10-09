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
    await expect(results.locator('.results-header').getByRole('searchbox')).toHaveAttribute('placeholder', 'Filter this page…');
    await expect(results.locator('.result-row-count')).toHaveText('7 rows');
    await expect(results.locator('.table-pagination')).toHaveCount(0);
    await filter.fill('no-row-can-match-this');
    await expect(results.locator('.result-row-count')).toHaveText('0 of 7 rows on this page');
    await expect(results.getByText('No rows match on this page.')).toBeVisible();
    await expect(results.getByText('This query returned zero rows.')).toHaveCount(0);
    await filter.fill('');
    await expect(results.locator('tbody tr')).toHaveCount(7);
    await expect(results.locator('.result-row-count')).toHaveText('7 rows');
    await filter.fill('2026-01-02');
    await expect(results.locator('.result-row-count')).toHaveText('1 of 7 rows on this page');
    await results.getByRole('button', { name: 'Collapse Query results', exact: true }).click();
    await expect(filter).toBeHidden();
    await results.getByRole('button', { name: 'Expand Query results', exact: true }).click();
    await expect(filter).toHaveValue('2026-01-02');
    await expect(results.locator('tbody tr')).toHaveCount(1);
    expect(runs()).toBe(1);
    await runButton(page).click();
    await expect(filter).toHaveValue('');
    await expect(results.locator('tbody tr')).toHaveCount(7);
    expect(runs()).toBe(2);
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
    await expect(results.locator('.result-row-count')).toHaveText('450 retained rows');
    await expect(results.getByText('1–200 of 450 retained rows', { exact: true })).toBeVisible();
    await expect(results.getByRole('button', { name: 'First', exact: true })).toBeDisabled();
    await results.getByRole('button', { name: 'Last', exact: true }).click();
    await expect(results.getByText('Page 3 of 3')).toBeVisible();
    await expect(results.locator('tbody tr')).toHaveCount(50);
    await expect(results.getByText('401–450 of 450 retained rows', { exact: true })).toBeVisible();
    await expect(results.getByRole('button', { name: 'Last', exact: true })).toBeDisabled();
    const filter = results.getByRole('searchbox', { name: 'Filter current page' });
    await filter.fill('row-449');
    await expect(results.locator('.result-row-count')).toHaveText('1 of 50 rows on this page');
    await expect(results.locator('tbody .row-number')).toHaveText('450');
    await results.getByRole('button', { name: 'First', exact: true }).click();
    await expect(results.getByText('Page 1 of 3')).toBeVisible();
    await expect(results.locator('.result-row-count')).toHaveText('0 of 200 rows on this page');
    await expect(results.getByText('No rows match on this page.')).toBeVisible();
    await filter.fill('');
    await results.getByRole('button', { name: '→', exact: true }).click();
    await expect(results.getByText('Page 2 of 3')).toBeVisible();
    await expect(results.getByText('201–400 of 450 retained rows', { exact: true })).toBeVisible();
    await results.getByRole('button', { name: '←', exact: true }).click();
    await expect(results.getByText('Page 1 of 3')).toBeVisible();
    expect(runs).toBe(1);
});

for (const mode of ['Standard', 'Experimental']) {
    test(`Results toolbar fits desktop and narrow screens in both themes in ${mode} mode`, async ({ page }) => {
        await trust(page);
        await page.getByText(mode, { exact: true }).click();
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        const header = results.locator('.results-header');
        const filter = header.getByRole('searchbox', { name: 'Filter current page' });
        for (const theme of ['Dark', 'Light']) {
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            for (const width of [1440, 720, 390]) {
                await page.setViewportSize({ width, height: 900 });
                await expect(filter).toBeVisible();
                await expect(header.locator('.result-row-count')).toHaveText('7 rows');
                await expect(results.locator('.table-pagination')).toHaveCount(0);
                const bounds = await header.evaluate(element => {
                    const header = element.getBoundingClientRect();
                    const tools = [...element.querySelectorAll('.result-row-count, .result-filter, .results-tabs, .panel-collapse-button')];
                    return tools.every(tool => {
                        const rect = tool.getBoundingClientRect();
                        return rect.left >= header.left && rect.right <= header.right && rect.top >= header.top && rect.bottom <= header.bottom;
                    });
                });
                expect(bounds).toBe(true);
                await filter.fill('2026-01-02');
                await expect(header.locator('.result-row-count')).toHaveText('1 of 7 rows on this page');
                await expect(results.locator('tbody tr')).toHaveCount(1);
                await filter.fill('');
            }
            await page.setViewportSize({ width: 1440, height: 900 });
        }
    });
}

for (const { rows, completeness } of [
    { rows: 7, completeness: 'truncated' },
    { rows: 0, completeness: 'truncated' },
    { rows: 0, completeness: 'complete' },
    { rows: 1, completeness: 'complete' },
]) {
    test(`Results toolbar reports ${rows} rows with ${completeness} retention without a pagination footer`, async ({ page }) => {
        await page.route(url => url.pathname.endsWith('/result'), async route => {
            const response = await route.fetch();
            const result = await response.json();
            await route.fulfill({ response, json: {
                ...result,
                columns: [{ name: 'label', type: 'String' }],
                rows: Array.from({ length: rows }, (_, index) => [`row-${index}`]),
                totalRows: rows,
                offset: 0,
                nextOffset: null,
                completeness,
            } });
        });
        await trust(page);
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await expect(results.locator('.result-row-count')).toHaveText(`${rows} ${rows === 1 ? 'row' : 'rows'}`);
        await expect(results.locator('.table-pagination')).toHaveCount(0);
        if (completeness === 'truncated') {
            await expect(results.locator('.results-header .result-completeness')).toContainText('Retained prefix · truncated');
            if (rows === 0) await expect(results.getByText(/No rows fit in the retained result/)).toBeVisible();
        } else {
            await expect(results.locator('.result-completeness')).toHaveCount(0);
            if (rows === 0) await expect(results.getByText('This query returned zero rows.')).toBeVisible();
        }
    });
}

test('A chart with no rows keeps its fallback table controls in the Results header', async ({ page }) => {
    await page.route(url => /\/(result|snapshot)$/.test(url.pathname), async route => {
        const runId = new URL(route.request().url()).pathname.split('/')[3];
        await route.fulfill({ json: {
            runId,
            queryId: 'empty-result-query',
            createdAt: '2026-10-09T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z',
            columns: [{ name: 'service', type: 'String' }],
            rows: [],
            totalRows: 0,
            offset: 0,
            nextOffset: null,
            completeness: 'complete',
        } });
    });
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-table-fallback')).toBeVisible();
    const filter = results.locator('.results-header').getByRole('searchbox', { name: 'Filter current page' });
    await expect(results.locator('.result-row-count')).toHaveText('0 rows');
    await filter.fill('frontend');
    await expect(results.locator('tbody tr')).toHaveCount(0);
    await expect(results.locator('.result-row-count')).toHaveText('0 of 0 rows on this page');
    await expect(results.getByText('This query returned zero rows.')).toBeVisible();
    await expect(results.locator('.table-pagination')).toHaveCount(0);
    await results.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(filter).toHaveValue('');
    await expect(results.locator('.result-table-toolbar')).toHaveCount(1);
    await expect(results.locator('.result-row-count')).toHaveText('0 rows');
});
