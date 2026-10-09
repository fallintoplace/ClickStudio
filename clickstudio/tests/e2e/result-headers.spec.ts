import { test, expect } from '@playwright/test';
import { openResultFilter, runButton, trust } from './helpers.js';

const longName = 'latency_for_all_frontend_services_over_the_current_observation_window';
const longType = 'Array(Tuple(service_name String, latency Nullable(Decimal(18, 2)), observed_at DateTime64(6)))';
const columns = [
    { name: 'x', type: 'Bool' },
    { name: 'i', type: 'Int8' },
    { name: 'd', type: 'Date' },
    { name: 'minute', type: 'DateTime' },
    { name: 'p50_ms', type: 'Float64' },
    { name: 'latency', type: 'Nullable(Decimal(18, 2))' },
    { name: longName, type: longType },
    { name: 'same', type: 'String' },
    { name: 'same', type: 'UInt64' },
];

for (const theme of ['Light', 'Dark']) for (const mode of ['Standard', 'Experimental']) {
    test(`${theme} ${mode} keeps result headers compact with full metadata available`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width: 1100, height: 820 });
        await page.route(url => url.pathname.endsWith('/result'), async route => {
            const response = await route.fetch();
            const result = await response.json();
            await route.fulfill({ response, json: {
                ...result, columns,
                rows: Array.from({ length: 100 }, (_, index) => [true, index, '2026-01-01', '2026-01-01 12:00:00', 59.99, '123.45', '[]', `entry-${index}`, index]),
                offset: 0, totalRows: 100, nextOffset: null, completeness: 'complete',
            } });
        });
        await trust(page);
        await page.getByText(mode, { exact: true }).click();
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await runButton(page).click();
        const table = page.locator('.data-table');
        await expect(table).toBeVisible();
        const headers = table.locator('th[data-type-group]');
        await expect(headers).toHaveCount(columns.length);
        const measurements = await headers.evaluateAll(elements => elements.map(element => {
            const name = element.querySelector('span')!;
            const type = element.querySelector('small')!;
            const nameRect = name.getBoundingClientRect();
            const typeRect = type.getBoundingClientRect();
            return {
                height: element.getBoundingClientRect().height,
                nameWidth: nameRect.width,
                typeWidth: typeRect.width,
                nameBottom: nameRect.bottom,
                typeBottom: typeRect.bottom,
                typeLeft: typeRect.left,
                nameRight: nameRect.right,
            };
        }));
        for (const [index, measurement] of measurements.entries()) {
            expect(measurement.height, `column ${index} height`).toBeGreaterThanOrEqual(32);
            expect(measurement.height, `column ${index} height`).toBeLessThanOrEqual(36);
            expect(measurement.nameWidth, `column ${index} visible name`).toBeGreaterThan(0);
            expect(measurement.typeWidth, `column ${index} visible type`).toBeGreaterThan(0);
            expect(measurement.typeLeft - measurement.nameRight).toBeCloseTo(8, 0);
            expect(Math.abs(measurement.nameBottom - measurement.typeBottom)).toBeLessThanOrEqual(2);
        }
        await expect(headers.first().locator('span')).toHaveCSS('font-size', '10px');
        await expect(headers.first().locator('small')).toHaveCSS('font-size', '9px');
        await expect(headers.first().locator('small')).toHaveCSS('border-width', '0px');
        await expect(headers.first().locator('small')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        const muted = await page.locator('html').evaluate(element => {
            const hex = getComputedStyle(element).getPropertyValue('--muted').trim().slice(1);
            return `rgb(${[0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
        });
        await expect(headers.first().locator('small')).toHaveCSS('color', muted);
        const complex = headers.nth(6);
        await expect(complex).toHaveAttribute('scope', 'col');
        const clipped = await complex.locator('.result-column-heading').evaluate(element => {
            const name = element.querySelector('span')!;
            const type = element.querySelector('small')!;
            return { width: element.getBoundingClientRect().width, name: name.scrollWidth > name.clientWidth, type: type.scrollWidth > type.clientWidth };
        });
        expect(clipped.width).toBeLessThanOrEqual(300);
        expect(clipped.name).toBe(true);
        expect(clipped.type).toBe(true);
        await complex.hover();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip).toHaveText(`${longName}${longType}`);
        await tooltip.hover();
        await page.waitForTimeout(200);
        await expect(tooltip).toBeVisible();
        const bounds = await tooltip.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(8);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1092);
        await page.keyboard.press('Escape');
        await expect(tooltip).toBeHidden();
        await complex.hover();
        await expect(tooltip).toBeVisible();
        await page.mouse.move(0, 0);
        await expect(tooltip).toBeHidden();
        await page.keyboard.press('Tab');
        await complex.focus();
        await expect(complex).toHaveCSS('outline-style', 'solid');
        await expect(tooltip).toHaveText(`${longName}${longType}`);
        await expect(complex).toHaveAttribute('aria-describedby', await tooltip.getAttribute('id') ?? '');
        await page.keyboard.press('Escape');
        await expect(tooltip).toBeHidden();
        await expect(complex).toBeFocused();
        const scroll = page.locator('.data-table-scroll');
        await scroll.evaluate(element => { element.scrollTop = 100; element.scrollLeft = 80; });
        const sticky = await scroll.evaluate(element => ({ top: element.getBoundingClientRect().top, headerTop: element.querySelector('th')!.getBoundingClientRect().top }));
        expect(Math.abs(sticky.headerTop - sticky.top)).toBeLessThanOrEqual(2);
        const filter = await openResultFilter(page);
        await filter.fill('entry-99');
        await expect(table.locator('tbody tr')).toHaveCount(1);
        await expect(table.locator('tbody .row-number')).toHaveText('100');
        await expect(headers.nth(7).locator('small')).toHaveText('String');
        await expect(headers.nth(8).locator('small')).toHaveText('UInt64');
    });
}

test('Very long result types remain readable and scrollable in a narrow viewport', async ({ page }) => {
    const type = `Tuple(${Array.from({ length: 80 }, (_, index) => `field_${index} Nullable(Decimal(18, 2))`).join(', ')})`;
    await page.setViewportSize({ width: 390, height: 720 });
    await page.route(url => url.pathname.endsWith('/result'), async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: { ...result, columns: [{ name: 'payload', type }], rows: [['()']], offset: 0, totalRows: 1, nextOffset: null } });
    });
    await trust(page);
    await runButton(page).click();
    const header = page.locator('.data-table th[data-type-group]');
    await header.focus();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText(`payload${type}`);
    const bounds = await tooltip.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(8);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(382);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(712);
    await page.keyboard.press('PageDown');
    await expect.poll(() => tooltip.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('PageUp');
    await expect.poll(() => tooltip.evaluate(element => element.scrollTop)).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => tooltip.evaluate(element => element.scrollTop)).toBe(24);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => tooltip.evaluate(element => element.scrollTop)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(header).toBeFocused();
});
