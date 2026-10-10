import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { Result } from '../../shared/types.js';
import { GEO_HELP_CITIES } from '../../web/help-demos.js';
import { runButton, trust } from './helpers.js';

const cityOrder = [
    'San Francisco',
    'New York',
    'Buenos Aires',
    'Berlin',
    'Mexico City',
    'Bangkok',
    'Singapore',
    'Tokyo',
    'Santiago',
    'London',
    'Istanbul',
    'Cape Town',
    'Nairobi',
    'Dubai',
    'Mumbai',
    'São Paulo',
    'Vancouver',
    'Sydney',
    'Reykjavík',
    'Rome',
];
const cityRows = cityOrder.map(name => {
    const city = GEO_HELP_CITIES.find(city => city.city === name)!;
    return [city.city, city.events];
});
const zigzagRows = Array.from({ length: 32 }, (_, index) => {
    const time = new Date(Date.UTC(2026, 9, 1, index)).toISOString();
    return Array.from({ length: index % 2 ? 20 : 1 }, () => [time]);
}).flat();
const fixtures: Array<{
    name: string;
    data: Pick<Result, 'columns' | 'rows'>;
    lines: number;
    points: number;
}> = [
    {
        name: 'city lines',
        data: {
            columns: [
                { name: 'city', type: 'String' },
                { name: 'events', type: 'UInt64' },
            ],
            rows: cityRows,
        },
        lines: 1,
        points: 20,
    },
    {
        name: 'multiple series with missing values',
        data: {
            columns: [
                { name: 'city', type: 'String' },
                { name: 'events', type: 'UInt64' },
                { name: 'backup', type: 'Nullable(Int64)' },
            ],
            rows: cityRows.map(([city, events], index) => [
                city!,
                events!,
                index === 1 ? null : -Number(events),
            ]),
        },
        lines: 3,
        points: 39,
    },
    {
        name: 'row-count lines over time',
        data: { columns: [{ name: 'time', type: 'DateTime' }], rows: zigzagRows },
        lines: 1,
        points: 32,
    },
];

for (const reducedMotion of ['no-preference', 'reduce'] as const)
    for (const fixture of fixtures) {
        test(`Long ${fixture.name} stay fully drawn with ${reducedMotion} motion`, async ({
            page,
        }, info) => {
            await page.setViewportSize({ width: 1440, height: 1000 });
            await page.emulateMedia({ reducedMotion });
            await page.route('**/api/runs/*/snapshot', async route => {
                const response = await route.fetch();
                await route.fulfill({
                    response,
                    json: {
                        ...(await response.json()),
                        ...fixture.data,
                        totalRows: fixture.data.rows.length,
                        completeness: 'complete',
                    },
                });
            });
            await trust(page);
            await page.getByText('Standard', { exact: true }).click();
            if (reducedMotion === 'reduce') {
                await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
                await page
                    .getByRole('button', { name: 'ClickHouse yellow accent', exact: true })
                    .click();
            }
            await runButton(page).click();
            const results = page.getByRole('region', { name: 'Query results', exact: true });
            await results.getByRole('tab', { name: 'Chart', exact: true }).click();
            if (fixture.name !== 'row-count lines over time')
                await results
                    .getByRole('combobox', { name: 'Type', exact: true })
                    .selectOption('line');
            const lines = results.locator('.chart-line');
            await expect(lines).toHaveCount(fixture.lines);
            await expect(results.locator('.chart-point')).toHaveCount(fixture.points);
            const lengths = await lines.evaluateAll(elements =>
                elements.map(element => (element as SVGPolylineElement).getTotalLength()),
            );
            expect(Math.max(...lengths)).toBeGreaterThan(1400);
            await lines.evaluateAll(elements =>
                Promise.all(
                    elements.flatMap(element =>
                        element.getAnimations().map(animation => animation.finished),
                    ),
                ),
            );
            const scroll = results.locator('.chart-category-scroll');
            if (await scroll.count())
                await scroll.evaluate(element => {
                    element.scrollLeft = element.scrollWidth - element.clientWidth;
                });
            await page.mouse.move(0, 0);
            const canvas = results.locator('.chart-canvas');
            const actual = await canvas.screenshot({ animations: 'disabled' });
            await lines.evaluateAll(elements =>
                elements.forEach(element => {
                    (element as SVGPolylineElement).style.strokeDasharray = 'none';
                }),
            );
            const solid = await canvas.screenshot({ animations: 'disabled' });
            await info.attach('animated-line', { body: actual, contentType: 'image/png' });
            await info.attach('solid-line', { body: solid, contentType: 'image/png' });
            const actualImage = PNG.sync.read(actual),
                solidImage = PNG.sync.read(solid);
            expect({ width: actualImage.width, height: actualImage.height }).toEqual({
                width: solidImage.width,
                height: solidImage.height,
            });
            expect(
                pixelmatch(
                    actualImage.data,
                    solidImage.data,
                    null,
                    actualImage.width,
                    actualImage.height,
                    { threshold: 0.1 },
                ),
                'Finished lines should render the same pixels as solid strokes',
            ).toBe(0);
        });
    }
