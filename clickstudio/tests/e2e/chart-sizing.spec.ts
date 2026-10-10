import { expect, test } from '@playwright/test';
import type { Result } from '../../shared/types.js';
import { runButton, trust } from './helpers.js';

const eventRows = [
    ['PushEvent', 573_100_000],
    ['CreateEvent', 160_000_000],
    ['PullRequestEvent', 100_000_000],
    ['IssueCommentEvent', 30_000_000],
    ['IssuesEvent', 30_000_000],
];

for (const fixture of [
    {
        name: 'bar chart',
        data: {
            columns: [
                { name: 'event_type', type: 'String' },
                { name: 'event_rows', type: 'UInt64' },
            ],
            rows: eventRows,
        },
        kind: 'bar',
    },
    {
        name: 'line chart',
        data: {
            columns: [
                { name: 'event_type', type: 'String' },
                { name: 'event_rows', type: 'UInt64' },
            ],
            rows: eventRows,
        },
        kind: 'line',
    },
    {
        name: 'row-count chart',
        data: {
            columns: [{ name: 'event_type', type: 'String' }],
            rows: eventRows.map(([event]) => [event]),
        },
        kind: 'bar',
    },
] as const) {
    test(`${fixture.name} keeps its SVG geometry when the workspace resizes`, async ({ page }) => {
        await page.setViewportSize({ width: 1680, height: 950 });
        await page.route('**/api/runs/*/snapshot', async route => {
            const response = await route.fetch();
            await route.fulfill({
                response,
                json: {
                    ...(await response.json()),
                    ...fixture.data,
                    totalRows: fixture.data.rows.length,
                    completeness: 'complete',
                } satisfies Partial<Result>,
            });
        });
        await trust(page);
        await page.getByText('Standard', { exact: true }).click();
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await results.getByRole('tab', { name: 'Chart', exact: true }).click();
        if (fixture.kind === 'line')
            await results.getByRole('combobox', { name: 'Type', exact: true }).selectOption('line');

        const plot = results.locator('.chart-category-plot');
        await expect(plot).toBeVisible();
        for (const width of [1680, 1120, 900]) {
            await page.setViewportSize({ width, height: 950 });
            await expect
                .poll(async () =>
                    plot.evaluate(svg => {
                        const matrix = (svg as SVGSVGElement).getScreenCTM();
                        if (!matrix) return Number.POSITIVE_INFINITY;
                        return Math.abs(matrix.a / matrix.d - 1);
                    }),
                )
                .toBeLessThan(0.1);
        }
        if (fixture.kind === 'bar') {
            const bar = results.locator('.chart-category-plot .chart-bar').first();
            expect((await bar.boundingBox())?.width).toBeLessThan(36);
        }
    });
}
