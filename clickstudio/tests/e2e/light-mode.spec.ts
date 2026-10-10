import { test, expect, type Locator } from '@playwright/test';
import { runButton, trust } from './helpers.js';

test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function expectReadableText(root: Locator, label: string) {
    const result = await root.evaluate(root => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgba = (color: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data];
        };
        const blend = (foreground: number[], background: number[]) => {
            const alpha = foreground[3]! / 255;
            return background.map((value, index) => index < 3 ? foreground[index]! * alpha + value * (1 - alpha) : 255);
        };
        const luminance = (color: number[]) => color.slice(0, 3).map(value => {
            const channel = value / 255;
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [0.2126, .7152, .0722][index]!, 0);
        const violations: { text: string; ratio: number }[] = [];
        let checked = 0;
        for (const element of root.querySelectorAll('*')) {
            if (!(element instanceof HTMLElement) || element.closest(':disabled, [hidden]')) continue;
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            if (!bounds.width || !bounds.height || style.visibility !== 'visible' || style.opacity === '0') continue;
            const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
            const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : '';
            if ((!text && !placeholder) || text === '·') continue;
            const ancestors: Element[] = [];
            for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) ancestors.unshift(ancestor);
            let backgrounds = [[255, 255, 255, 255]];
            for (const ancestor of ancestors) {
                const ancestorStyle = getComputedStyle(ancestor);
                backgrounds = backgrounds.map(background => blend(rgba(ancestorStyle.backgroundColor), background));
                const stops = ancestorStyle.backgroundImage.match(/(?:rgba?|color|oklab)\([^)]*\)/g);
                if (stops) {
                    backgrounds = backgrounds.flatMap(background => stops.map(stop => blend(rgba(stop), background)));
                    backgrounds.sort((left, right) => luminance(left) - luminance(right));
                    backgrounds = [backgrounds[0]!, backgrounds.at(-1)!];
                }
            }
            const foregroundColor = rgba(getComputedStyle(element, placeholder ? '::placeholder' : null).color);
            const ratio = Math.min(...backgrounds.map(background => {
                const foreground = blend(foregroundColor, background);
                const light = luminance(foreground), dark = luminance(background);
                return (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05);
            }));
            const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700;
            checked++;
            if (ratio < (large ? 3 : 4.5)) violations.push({ text: (placeholder || text).slice(0, 90), ratio });
        }
        return { checked, violations: violations.slice(0, 12) };
    });
    expect(result.checked, label).toBeGreaterThan(0);
    expect.soft(result.violations, label).toEqual([]);
}

for (const accent of ['Cyan accent', 'ClickHouse yellow accent']) {
    test(`Light mode keeps workspace and help text readable with ${accent}`, async ({ page }, info) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await trust(page);
        await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
        await page.getByRole('button', { name: accent, exact: true }).click();
        await runButton(page).click();
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
        await expectReadableText(page.locator('.application'), 'Workspace and objects');
        await expect(page.locator('.object-tree-scroll')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await page.screenshot({ path: info.outputPath('light-workspace.png') });

        await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
        const dependencies = page.getByRole('dialog', { name: 'Materialized view dependencies', exact: true });
        await dependencies.getByRole('button', { name: 'demo.monthly_report_mv: Refreshable MV', exact: true }).click();
        await expectReadableText(dependencies, 'Dependencies and selected object');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
        await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
        const storage = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
        await expectReadableText(storage, 'Storage parts');
        for (const section of ['Merges', 'Mutations']) {
            await storage.getByRole('button', { name: section, exact: true }).click();
            await expectReadableText(storage, section);
        }
        await storage.getByRole('button', { name: 'Close', exact: true }).click();

        for (const panel of ['Reference', 'AI']) {
            await page.locator('.icon-rail').getByRole('button', { name: panel, exact: true }).click();
            await expect(page.locator('.inspector-pane')).toBeVisible();
            await expectReadableText(page.locator('.inspector-pane'), panel);
        }

        await page.getByRole('button', { name: 'Help', exact: true }).click();
        const help = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
        await expect(help).toBeVisible();
        for (const section of ['tour', 'examples', 'workflows', 'assistant', 'reference', 'monitoring', 'query', 'geo', 'explain', 'storage', 'dependencies', 'compare']) {
            await help.getByTestId('help-section-' + section).click();
            await expect(help.getByTestId('help-section-' + section)).toHaveAttribute('aria-selected', 'true');
            await expectReadableText(help, section);
        }
        await help.getByTestId('help-section-monitoring').click();
        await page.screenshot({ path: info.outputPath('light-monitoring.png') });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        await expectReadableText(page.getByRole('dialog', { name: 'Export', exact: true }), 'Export');
        await page.keyboard.press('Escape');
        await page.route('**/api/session', route => route.fulfill({ json: { principal: { id: 'test-owner', role: 'owner' }, requiresLogin: false, demo: false } }));
        await page.reload();
        await page.getByRole('button', { name: 'Connect Cloud', exact: true }).click();
        const connection = page.getByRole('dialog', { name: 'Connect to your service', exact: true });
        await expect(connection).toBeVisible();
        await expectReadableText(connection, 'Cloud connection');
        await page.route('**/api/session', route => route.fulfill({ json: { principal: null, requiresLogin: true, demo: false } }));
        await page.reload();
        await expect(page.locator('.auth-card')).toBeVisible();
        await expectReadableText(page.locator('.auth-screen'), 'Login');
    });

    test(`Light mode keeps import steps and query-file controls readable with ${accent}`, async ({ page }, info) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await trust(page);
        await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
        await page.getByRole('button', { name: accent, exact: true }).click();
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
        await expect(dialog).toBeVisible();
        await expectReadableText(dialog, 'File import');
        await expect(dialog.locator('.import-step-item.is-current .import-step-number')).toHaveCSS('color', accent === 'Cyan accent' ? 'rgb(255, 255, 255)' : 'rgb(21, 25, 26)');
        await page.screenshot({ path: info.outputPath('light-import.png') });
        await dialog.locator('.import-kind-button.is-query').click();
        await expect(dialog.locator('.import-file-picker-query')).toBeVisible();
        await expectReadableText(dialog, 'SQL file');
        await page.setViewportSize({ width: 390, height: 844 });
        await expectReadableText(dialog, 'Mobile import');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    });
}

test('Light heatmaps keep zero, null, missing, and saturated values readable with both accents', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: {
            ...result,
            columns: [{ name: 'weekday', type: 'String' }, { name: 'hour', type: 'DateTime' }, { name: 'trips', type: 'Nullable(UInt64)' }],
            rows: [['Mon', '2026-09-21 00:00:00', 0], ['Mon', '2026-09-21 01:00:00', 100], ['Tue', '2026-09-21 00:00:00', 55], ['Wed', '2026-09-21 00:00:00', null]],
            completeness: 'complete',
        } });
    });
    await trust(page);
    await runButton(page).click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await results.getByLabel('Type').selectOption('heatmap');
    await expect(results.locator('.heatmap-cell')).toHaveCount(6);
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
    for (const accent of ['Cyan accent', 'ClickHouse yellow accent']) {
        await page.getByRole('button', { name: accent, exact: true }).click();
        await expectReadableText(results, `Heatmap, ${accent}`);
        const fills = await results.locator('.heatmap-cell').evaluateAll(cells => cells.map(cell => getComputedStyle(cell).backgroundColor));
        expect(new Set(fills).size).toBeGreaterThanOrEqual(3);
        expect(fills).not.toContain('rgba(0, 0, 0, 0)');
    }
});

test('Mounted candlesticks update their marks and labels when theme or accent changes', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: {
            ...result,
            columns: ['time', 'open', 'high', 'low', 'close', 'bid', 'ask', 'spread', 'quote_activity'].map(name => ({ name, type: name === 'time' ? 'DateTime' : 'Float64' })),
            rows: [['2026-09-21 00:00:00', 10, 13, 9, 12, 11, 12, 1, 10], ['2026-09-21 01:00:00', 12, 13, 8, 9, 8, 9, 1, 20]],
            completeness: 'complete',
        } });
    });
    await trust(page);
    await runButton(page).click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await page.getByRole('region', { name: 'Query results', exact: true }).getByRole('tab', { name: 'Chart', exact: true }).click();
    const up = page.locator('.market-candle-body').first(), down = page.locator('.market-candle-body').last();
    await expect(up).toHaveCSS('fill', 'rgb(53, 233, 120)');
    await expect(down).toHaveCSS('fill', 'rgb(255, 107, 117)');
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
    await expect(up).toHaveCSS('fill', 'rgb(20, 108, 67)');
    await expect(down).toHaveCSS('fill', 'rgb(179, 48, 67)');
    await expect(page.locator('.market-axis text').first()).toHaveCSS('fill', 'rgb(97, 97, 97)');
    await page.getByRole('button', { name: 'ClickHouse yellow accent', exact: true }).click();
    await expect(page.locator('.market-bid-line')).toHaveCSS('stroke', 'rgb(107, 93, 0)');
    await page.getByRole('radio', { name: 'Dark theme', exact: true }).click();
    await expect(up).toHaveCSS('fill', 'rgb(53, 233, 120)');
    await expect(page.locator('.market-bid-line')).toHaveCSS('stroke', 'rgb(250, 255, 105)');
    await expect(page.locator('.market-candle')).toHaveCount(2);
});

test('Light mode preserves invalid field borders before and after focus with both accents', async ({ page }) => {
    await page.route('**/api/connections', async route => {
        const response = await route.fetch();
        const connections = await response.json();
        await route.fulfill({ response, json: connections.map((connection: Record<string, unknown>) => ({ ...connection, dataSource: 'clickhouse' })) });
    });
    await trust(page);
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New table', exact: true });
    const name = dialog.getByRole('textbox', { name: 'Table name', exact: true });
    for (const accent of ['Cyan accent', 'ClickHouse yellow accent']) {
        await page.getByRole('button', { name: accent, exact: true }).click();
        await page.getByRole('button', { name: 'New table', exact: true }).click();
        await name.fill('bad-name');
        await dialog.getByRole('textbox', { name: 'Column 1 name', exact: true }).focus();
        await expect(name).toHaveAttribute('aria-invalid', 'true');
        await expect(name).toHaveCSS('border-color', 'rgb(179, 48, 67)');
        await name.focus();
        await expect(name).toHaveCSS('border-color', 'rgb(179, 48, 67)');
        await expectReadableText(dialog, `Invalid field, ${accent}`);
        await name.fill('events');
        await expect(name).toHaveAttribute('aria-invalid', 'false');
        await expect(name).toHaveCSS('border-color', accent === 'Cyan accent' ? 'rgb(0, 108, 131)' : 'rgb(107, 93, 0)');
        await page.keyboard.press('Escape');
    }
});
