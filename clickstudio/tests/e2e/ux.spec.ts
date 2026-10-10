import { test, expect, type Locator, type Page } from '@playwright/test';
import { openBlankSql, openResultFilter, runButton, trust } from './helpers.js';

function countRuns(page: Page) {
    let count = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') count++;
    });
    return () => count;
}

async function mockPaginatedResult(page: Page, totalRows = 450, completeness = 'complete') {
    await page.route(
        url => /\/(result|snapshot)$/.test(url.pathname),
        async route => {
            const response = await route.fetch();
            const result = await response.json();
            const url = new URL(route.request().url());
            const offset = Number(url.searchParams.get('offset') ?? 0);
            const count = url.pathname.endsWith('/snapshot') ? totalRows : 200;
            const rows = Array.from({ length: Math.min(count, totalRows - offset) }, (_, index) => [
                `row-${offset + index}`,
            ]);
            await route.fulfill({
                response,
                json: {
                    ...result,
                    columns: [{ name: 'label', type: 'String' }],
                    rows,
                    offset,
                    totalRows,
                    completeness,
                    nextOffset: offset + rows.length < totalRows ? offset + rows.length : null,
                },
            });
        },
    );
}

async function expectResultsToolbarFits(header: Locator) {
    await expect
        .poll(() =>
            header.evaluate(element => {
                const header = element.getBoundingClientRect();
                const tools = [
                    ...element.querySelectorAll(
                        '.result-row-count, .result-pagination, .result-pagination button, .result-filter, .result-filter-toggle, .result-filter-clear, .results-tabs, .panel-collapse-button',
                    ),
                ];
                return tools.every(tool => {
                    if (!tool.getClientRects().length) return true;
                    const rect = tool.getBoundingClientRect();
                    const icon = tool.matches('.result-pagination button')
                        ? tool.querySelector('svg')?.getBoundingClientRect()
                        : undefined;
                    return (
                        rect.left >= header.left &&
                        rect.right <= header.right &&
                        rect.top >= header.top &&
                        rect.bottom <= header.bottom &&
                        (!icon ||
                            (icon.width >= 15 &&
                                icon.height >= 15 &&
                                icon.left >= rect.left &&
                                icon.right <= rect.right))
                    );
                });
            }),
        )
        .toBe(true);
}

test('A no-match row filter stays local and can be cleared without rerunning SQL', async ({
    page,
}) => {
    const runs = countRuns(page);
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results' });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(results.getByRole('searchbox')).toBeHidden();
    const filter = await openResultFilter(results);
    await expect(filter).toBeFocused();
    await expect(results.locator('.results-header').getByRole('searchbox')).toHaveAttribute(
        'placeholder',
        'Filter this page…',
    );
    await expect(results.locator('.result-row-count')).toHaveText('7 rows');
    await expect(results.locator('.table-pagination, .result-pagination')).toHaveCount(0);
    await filter.fill('no-row-can-match-this');
    await expect(results.locator('.result-row-count')).toHaveText('0 of 7 rows');
    await expect(results.getByText('No rows match on this page.')).toBeVisible();
    await expect(results.getByText('This query returned zero rows.')).toHaveCount(0);
    await results.getByRole('button', { name: 'Clear row filter', exact: true }).click();
    await expect(filter).toBeHidden();
    await expect(results.getByRole('button', { name: 'Filter', exact: true })).toBeFocused();
    await expect(results.locator('tbody tr')).toHaveCount(7);
    await expect(results.locator('.result-row-count')).toHaveText('7 rows');
    await openResultFilter(results);
    await filter.fill('2026-01-02');
    await expect(results.locator('.result-row-count')).toHaveText('1 of 7 rows');
    await results.getByRole('button', { name: 'Collapse Query results', exact: true }).click();
    await expect(filter).toBeHidden();
    await results.getByRole('button', { name: 'Expand Query results', exact: true }).click();
    await expect(filter).toHaveValue('2026-01-02');
    await expect(results.locator('tbody tr')).toHaveCount(1);
    expect(runs()).toBe(1);
    await runButton(page).click();
    await expect(filter).toBeHidden();
    await expect(results.getByRole('button', { name: 'Filter', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
    );
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

for (const mode of ['Standard', 'Experimental'])
    test(`${mode} header pagination reaches the end without rerunning SQL`, async ({
        page,
    }, info) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const runs = countRuns(page);
        await mockPaginatedResult(page);
        await trust(page);
        await page.getByText(mode, { exact: true }).click();
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        const header = results.locator('.results-header');
        const pagination = header.getByRole('navigation', {
            name: 'Result pagination',
            exact: true,
        });
        await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
        await expect(results.locator('tbody tr')).toHaveCount(200);
        await expect(header.locator('.result-row-count')).toHaveText('1–200 / 450 rows');
        await expect(header.locator('.result-row-count')).toHaveAttribute(
            'title',
            '1–200 of 450 retained rows',
        );
        await expect(results.locator('.table-pagination')).toHaveCount(0);
        await expect(pagination.getByRole('button')).toHaveCount(4);
        for (const label of ['First page', 'Previous page', 'Next page', 'Last page']) {
            const button = pagination.getByRole('button', { name: label, exact: true });
            await expect(button).toHaveAttribute('title', label);
            await expect(button.locator('svg')).toHaveCount(1);
            await expect(button).toHaveText('');
        }
        await expect(
            pagination.getByRole('button', { name: 'First page', exact: true }),
        ).toBeDisabled();
        await expect(
            pagination.getByRole('button', { name: 'Previous page', exact: true }),
        ).toBeDisabled();
        await pagination.getByRole('button', { name: 'Last page', exact: true }).press('Enter');
        await expect(
            pagination.getByRole('status', { name: 'Page 3 of 3', exact: true }),
        ).toHaveText('3/3');
        await expect(results.locator('tbody tr')).toHaveCount(50);
        await expect(header.locator('.result-row-count')).toHaveText('401–450 / 450 rows');
        await expect(
            pagination.getByRole('button', { name: 'Last page', exact: true }),
        ).toBeDisabled();
        await expect(
            pagination.getByRole('button', { name: 'Next page', exact: true }),
        ).toBeDisabled();
        const filter = await openResultFilter(header);
        await filter.fill('row-449');
        await expect(header.locator('.result-row-count')).toHaveText('1 of 50 rows on this page');
        await expect(header.locator('.result-row-count')).toHaveAttribute(
            'title',
            '401–450 of 450 retained rows',
        );
        await expect(results.locator('tbody .row-number')).toHaveText('450');
        await pagination.getByRole('button', { name: 'First page', exact: true }).click();
        await expect(
            pagination.getByRole('status', { name: 'Page 1 of 3', exact: true }),
        ).toHaveText('1/3');
        await expect(header.locator('.result-row-count')).toHaveText('0 of 200 rows on this page');
        await expect(results.getByText('No rows match on this page.')).toBeVisible();
        await filter.fill('');
        await pagination.getByRole('button', { name: 'Next page', exact: true }).click();
        await expect(
            pagination.getByRole('status', { name: 'Page 2 of 3', exact: true }),
        ).toHaveText('2/3');
        await expect(header.locator('.result-row-count')).toHaveText('201–400 / 450 rows');
        for (const label of ['First page', 'Previous page', 'Next page', 'Last page'])
            await expect(
                pagination.getByRole('button', { name: label, exact: true }),
            ).toBeEnabled();
        await results.getByRole('button', { name: 'Collapse Query results', exact: true }).click();
        await expect(pagination).toBeHidden();
        await results.getByRole('button', { name: 'Expand Query results', exact: true }).click();
        await expect(
            pagination.getByRole('status', { name: 'Page 2 of 3', exact: true }),
        ).toBeVisible();
        await pagination.getByRole('button', { name: 'Previous page', exact: true }).click();
        await expect(
            pagination.getByRole('status', { name: 'Page 1 of 3', exact: true }),
        ).toHaveText('1/3');
        await header.getByRole('button', { name: 'Close row filter', exact: true }).click();
        for (const theme of ['Dark', 'Light']) {
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            for (const accent of ['Cyan accent', 'ClickHouse yellow accent']) {
                await page.getByRole('button', { name: accent, exact: true }).click();
                for (const width of [1440, 900]) {
                    await page.setViewportSize({ width, height: 1000 });
                    await expectResultsToolbarFits(header);
                    await openResultFilter(header);
                    await filter.fill('row-199');
                    await expect(header.locator('.result-row-count')).toHaveText(
                        '1 of 200 rows on this page',
                    );
                    await expectResultsToolbarFits(header);
                    await header
                        .getByRole('button', { name: 'Clear row filter', exact: true })
                        .click();
                    expect(
                        await page.evaluate(
                            () => document.documentElement.scrollWidth - innerWidth,
                        ),
                    ).toBeLessThanOrEqual(1);
                    if (
                        theme === 'Light' &&
                        accent === 'ClickHouse yellow accent' &&
                        width === 1440
                    )
                        await page.screenshot({ path: info.outputPath('pagination-header.png') });
                }
            }
        }
        expect(runs()).toBe(1);
    });

for (const mode of ['Standard', 'Experimental']) {
    test(`Results toolbar fits wide and narrow desktop windows in both themes in ${mode} mode`, async ({
        page,
    }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await trust(page);
        await page.getByText(mode, { exact: true }).click();
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        const header = results.locator('.results-header');
        const toggle = header.getByRole('button', { name: 'Filter', exact: true });
        const filter = header.getByRole('searchbox', { name: 'Filter current page', exact: true });
        const expectToolbarFits = () => expectResultsToolbarFits(header);
        for (const theme of ['Dark', 'Light']) {
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            for (const width of [1440, 900]) {
                await page.setViewportSize({ width, height: 900 });
                await expect
                    .poll(() =>
                        page.evaluate(() => {
                            const queryBounds = document
                                .querySelector('.editor-surface')!
                                .getBoundingClientRect();
                            const resultsBounds = document
                                .querySelector('.results-surface')!
                                .getBoundingClientRect();
                            return Math.abs(resultsBounds.top - queryBounds.bottom);
                        }),
                    )
                    .toBeLessThanOrEqual(1);
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
                await expect(filter).toBeHidden();
                await expectToolbarFits();
                await toggle.click();
                await expect(filter).toBeVisible();
                await expect(filter).toBeFocused();
                await expect(toggle).toBeHidden();
                await header.getByRole('button', { name: 'Close row filter', exact: true }).click();
                await expect(filter).toBeHidden();
                await expect(toggle).toBeFocused();
                await toggle.click();
                await filter.press('Escape');
                await expect(filter).toBeHidden();
                await expect(toggle).toBeFocused();
                await openResultFilter(header);
                await expect(header.locator('.result-row-count')).toHaveText('7 rows');
                await expect(results.locator('.table-pagination, .result-pagination')).toHaveCount(
                    0,
                );
                await expectToolbarFits();
                await filter.fill('2026-01-02');
                await expect(header.locator('.result-row-count')).toHaveText('1 of 7 rows');
                await expect(results.locator('tbody tr')).toHaveCount(1);
                await expectToolbarFits();
                await filter.press('Escape');
                await expect(filter).toHaveValue('2026-01-02');
                await expect(toggle).toBeHidden();
                await expect(filter).toBeVisible();
                await expect(filter).toBeFocused();
                await header.getByRole('button', { name: 'Clear row filter', exact: true }).click();
                await expect(filter).toBeHidden();
                await expect(toggle).toBeFocused();
                await expect(header.locator('.result-row-count')).toHaveText('7 rows');
                await expect(results.locator('tbody tr')).toHaveCount(7);
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
    test(`Results toolbar reports ${rows} rows with ${completeness} retention without a pagination footer`, async ({
        page,
    }) => {
        await page.route(
            url => url.pathname.endsWith('/result'),
            async route => {
                const response = await route.fetch();
                const result = await response.json();
                await route.fulfill({
                    response,
                    json: {
                        ...result,
                        columns: [{ name: 'label', type: 'String' }],
                        rows: Array.from({ length: rows }, (_, index) => [`row-${index}`]),
                        totalRows: rows,
                        offset: 0,
                        nextOffset: null,
                        completeness,
                    },
                });
            },
        );
        await trust(page);
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await expect(results.locator('.result-row-count')).toHaveText(
            `${rows} ${rows === 1 ? 'row' : 'rows'}`,
        );
        await expect(results.locator('.table-pagination, .result-pagination')).toHaveCount(0);
        if (completeness === 'truncated') {
            await expect(results.locator('.results-header .result-completeness')).toContainText(
                'Retained prefix · truncated',
            );
            if (rows === 0)
                await expect(results.getByText(/No rows fit in the retained result/)).toBeVisible();
        } else {
            await expect(results.locator('.result-completeness')).toHaveCount(0);
            if (rows === 0)
                await expect(results.getByText('This query returned zero rows.')).toBeVisible();
        }
    });
}

test('A chart with no rows keeps its fallback table controls in the Results header', async ({
    page,
}) => {
    await page.route(
        url => /\/(result|snapshot)$/.test(url.pathname),
        async route => {
            const runId = new URL(route.request().url()).pathname.split('/')[3];
            await route.fulfill({
                json: {
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
                },
            });
        },
    );
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-table-fallback')).toBeVisible();
    const filter = await openResultFilter(results.locator('.results-header'));
    await expect(results.locator('.result-row-count')).toHaveText('0 rows');
    await filter.fill('frontend');
    await expect(results.locator('tbody tr')).toHaveCount(0);
    await expect(results.locator('.result-row-count')).toHaveText('0 of 0 rows');
    await expect(results.getByText('This query returned zero rows.')).toBeVisible();
    await expect(results.locator('.table-pagination, .result-pagination')).toHaveCount(0);
    await results.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(filter).toBeHidden();
    await expect(results.getByRole('button', { name: 'Filter', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
    );
    await expect(results.locator('.result-table-toolbar')).toHaveCount(1);
    await expect(results.locator('.result-row-count')).toHaveText('0 rows');
});

test('Paged truncated results keep header navigation when returning from Chart', async ({
    page,
}) => {
    const runs = countRuns(page);
    await mockPaginatedResult(page, 250, 'truncated');
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const header = results.locator('.results-header');
    await expect(header.locator('.result-row-count')).toHaveText('1–200 / 250 rows');
    await expect(header.locator('.result-completeness')).toContainText(
        'Retained prefix · truncated',
    );
    const pagination = header.getByRole('navigation', { name: 'Result pagination', exact: true });
    await pagination.getByRole('button', { name: 'Last page', exact: true }).click();
    await expect(header.locator('.result-row-count')).toHaveText('201–250 / 250 rows');
    await expect(
        pagination.getByRole('status', { name: 'Page 2 of 2', exact: true }),
    ).toBeVisible();
    await (await openResultFilter(header)).fill('row-249');
    await expect(header.locator('.result-row-count')).toHaveText('1 of 50 rows on this page');
    await expectResultsToolbarFits(header);
    await expect(results.locator('.table-pagination')).toHaveCount(0);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(
        header.getByRole('navigation', { name: 'Result pagination', exact: true }),
    ).toHaveCount(0);
    await results.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(header.locator('.result-row-count')).toHaveText('201–250 / 250 rows');
    await expect(
        header.getByRole('navigation', { name: 'Result pagination', exact: true }),
    ).toHaveCount(1);
    await expect(header.locator('.result-completeness')).toContainText(
        'Retained prefix · truncated',
    );
    expect(runs()).toBe(1);
});
