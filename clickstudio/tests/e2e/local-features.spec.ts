import { test, expect, type Page, type Download } from '@playwright/test';
import type { Result } from '../../shared/types.js';
import { trust } from './helpers.js';

function countRuns(page: Page) {
    let count = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)) count++;
    });
    return () => count;
}
async function resultPage(page: Page, transform: (result: Result) => Result) {
    await page.route(url => url.pathname.endsWith('/result'), async route => {
        const response = await route.fetch();
        const result = await response.json() as Result;
        await route.fulfill({ response, json: { ...result, ...transform(result) } });
    });
}
async function run(page: Page) {
    await page.getByTestId('run-button').click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    return results;
}
async function downloadedText(download: Download): Promise<string> {
    const stream = await download.createReadStream();
    if (!stream) throw new Error('Download stream unavailable');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}

test('Duplicate result-column names keep their values in the correct positions', async ({ page }) => {
    const runs = countRuns(page);
    await resultPage(page, result => ({ ...result,
        columns: [{ name: 'same', type: 'String' }, { name: 'same', type: 'UInt64' }],
        rows: [['text', '9007199254740993']],
    }));
    await trust(page);
    const results = await run(page);
    const headers = results.getByRole('table').locator('thead th');
    await expect(headers).toHaveCount(3);
    await expect(headers.nth(1)).toContainText('same');
    await expect(headers.nth(2)).toContainText('same');
    const cells = results.getByRole('table').locator('tbody tr').first().locator('td');
    await expect(cells.nth(1)).toHaveText('text');
    await expect(cells.nth(2)).toHaveText('9007199254740993');
    expect(runs()).toBe(1);
});

test('Result export downloads the complete retained CSV from the server', async ({ page }) => {
    const runs = countRuns(page);
    await trust(page);
    await run(page);
    await page.locator('.inspector-footer').getByRole('button', { name: 'Export', exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export', exact: true });
    await expect(exportDialog).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        exportDialog.getByRole('button', { name: /Export rows \(\.csv\)/ }).click(),
    ]);
    const csv = await downloadedText(download);
    expect(csv.split('\r\n')).toHaveLength(8);
    expect(csv.split('\r\n')[0]).toBe('day,events');
    expect(csv).toContain('2026-01-07,70');
    expect(runs()).toBe(1);
});

test('Wide retained results remain horizontally scrollable and keyboard accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await resultPage(page, result => ({ ...result,
        columns: Array.from({ length: 10 }, (_, index) => ({ name: `column_${index + 1}`, type: 'String' })),
        rows: [Array.from({ length: 10 }, (_, index) => `value ${index + 1}`)],
    }));
    await trust(page);

    const results = await run(page);
    const scroll = results.locator('.data-table-scroll');
    await expect(results.getByText('Scroll horizontally to view all 10 columns')).toHaveCount(0);
    await expect(scroll).toHaveAttribute('tabindex', '0');
    expect(await scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);

    await scroll.focus();
    await scroll.press('ArrowRight');
    await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});

for (const theme of ['light', 'dark']) test(`Retained results stay within a 390px ${theme} viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: theme === 'dark' ? 'Dark theme' : 'Light theme' }).click();
    await trust(page);
    const results = await run(page);
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
});
