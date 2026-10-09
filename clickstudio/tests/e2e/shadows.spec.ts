import { test, expect, type Locator } from '@playwright/test';
import { replaceSql, runButton, trust } from './helpers.js';

const shadow = (locator: Locator) => locator.evaluate(element => getComputedStyle(element).boxShadow)
    .then(value => value.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px, /g, ''));
const backdrop = (locator: Locator, native = false) => locator.evaluate((element, isNative) => {
    const style = getComputedStyle(element, isNative ? '::backdrop' : undefined);
    return { color: style.backgroundColor, filter: style.backdropFilter };
}, native);

for (const theme of ['Dark', 'Light']) for (const mode of ['Standard', 'Experimental']) {
    test(`${theme} ${mode} keeps workspace panels flat and overlay depth neutral across accents`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await trust(page);
        await page.getByText(mode, { exact: true }).click();
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await runButton(page).click();
        await expect(page.locator('.data-table')).toBeVisible();
        const editor = page.locator('.editor-surface');
        await page.locator('.cm-content').focus();
        await expect(editor).toHaveCSS('box-shadow', 'none');
        await expect(page.locator('.results-surface')).toHaveCSS('box-shadow', 'none');
        await expect(page.locator('.topbar')).toHaveCSS('box-shadow', 'none');
        const filter = page.getByRole('searchbox', { name: 'Filter current page' });
        await page.keyboard.press('Tab');
        await filter.focus();
        await expect(filter).toHaveCSS('outline-style', 'solid');
        await expect(filter).toHaveCSS('outline-width', '2px');
        expect(await shadow(filter)).toMatch(/0px 0px 0px 2px/);
        await filter.fill('2026-01-02');
        await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
        await filter.fill('');

        await page.locator('.connection-trigger').click();
        const menu = page.getByRole('dialog', { name: 'Connection details', exact: true });
        await expect(menu).toBeVisible();
        const menuShadow = await shadow(menu);
        expect(menuShadow).not.toBe('none');
        await page.locator('.connection-trigger').click();
        await page.getByRole('button', { name: 'Help', exact: true }).click();
        const help = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
        await expect(help).toBeVisible();
        const dialogShadow = await shadow(help);
        expect(dialogShadow).not.toBe(menuShadow);
        const scrim = await backdrop(page.locator('.workspace-help-backdrop'));
        await help.getByTestId('help-section-examples').click();
        const category = help.locator('.sql-example-category').first();
        await page.keyboard.press('Tab');
        await category.focus();
        await expect(category).toHaveCSS('outline-style', 'solid');
        await expect(category).toHaveCSS('outline-offset', '-3px');
        await page.keyboard.press('Escape');
        await expect(help).toBeHidden();

        await page.getByRole('button', { name: 'ClickHouse yellow accent', exact: true }).click();
        await page.locator('.connection-trigger').click();
        await expect(menu).toHaveCSS('box-shadow', menuShadow);
        await page.locator('.connection-trigger').click();
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        const exportDialog = page.getByRole('dialog', { name: 'Export', exact: true });
        await expect(exportDialog).toBeVisible();
        await expect.poll(() => shadow(exportDialog)).toBe(dialogShadow);
        expect(await backdrop(exportDialog, true)).toEqual(scrim);
        await page.keyboard.press('Escape');
        await expect(exportDialog).toBeHidden();

        await page.getByRole('button', { name: 'Import', exact: true }).click();
        const importDialog = page.getByRole('dialog', { name: 'Import data', exact: true });
        await expect(importDialog).toBeVisible();
        await expect(importDialog).toHaveCSS('box-shadow', dialogShadow);
        expect(await backdrop(importDialog, true)).toEqual(scrim);
        const step = importDialog.locator('.import-step-item.is-current .import-step-number');
        const stepColors = await step.evaluate(element => {
            const style = getComputedStyle(element);
            return { text: style.color, fill: style.backgroundColor };
        });
        expect(stepColors.text).not.toBe(stepColors.fill);
        await page.keyboard.press('Escape');
        await expect(importDialog).toBeHidden();

        const otherTheme = theme === 'Dark' ? 'Light' : 'Dark';
        await page.getByRole('radio', { name: `${otherTheme} theme`, exact: true }).click();
        await page.getByRole('button', { name: 'Help', exact: true }).click();
        expect(await shadow(help)).not.toBe(dialogShadow);
        expect((await backdrop(page.locator('.workspace-help-backdrop'))).color).not.toBe(scrim.color);
        await page.keyboard.press('Escape');
        await expect(runButton(page)).toBeEnabled();
    });
}

for (const theme of ['Dark', 'Light']) test(`${theme} scroll cues track overflow without covering sticky headers or row numbers`, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.route(url => url.pathname.endsWith('/result'), async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: {
            ...result,
            columns: Array.from({ length: 8 }, (_, index) => ({ name: `column_${index}`, type: 'String' })),
            rows: Array.from({ length: 100 }, (_, index) => Array.from({ length: 8 }, () => `row-${index}`)),
            offset: 0, totalRows: 100, nextOffset: null, completeness: 'complete',
        } });
    });
    await trust(page);
    await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
    await runButton(page).click();
    const frame = page.locator('.data-table-scroll-frame');
    const scroll = frame.locator('.data-table-scroll');
    const top = frame.locator('.scroll-edge-shadow.is-top');
    const bottom = frame.locator('.scroll-edge-shadow.is-bottom');
    const left = frame.locator('.scroll-edge-shadow.is-left');
    const right = frame.locator('.scroll-edge-shadow.is-right');
    await expect(bottom).toHaveClass(/is-visible/);
    await expect(right).toHaveClass(/is-visible/);
    await expect(top).not.toHaveClass(/is-visible/);
    await expect(left).not.toHaveClass(/is-visible/);
    await expect(bottom).toHaveCSS('height', '12px');
    await expect(frame.locator('.scroll-edge-shadows')).toHaveCSS('pointer-events', 'none');
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
    await expect(top).toHaveClass(/is-visible/);
    await expect(left).toHaveClass(/is-visible/);
    await expect(bottom).not.toHaveClass(/is-visible/);
    await expect(right).not.toHaveClass(/is-visible/);
    const header = frame.locator('thead th').first();
    const rowNumber = frame.locator('tbody .row-number').last();
    const stacking = await frame.evaluate(element => {
        const overlay = element.querySelector('.scroll-edge-shadows')!;
        return {
            header: Number(getComputedStyle(element.querySelector('thead th')!).zIndex),
            row: Number(getComputedStyle(element.querySelector('tbody .row-number')!).zIndex),
            overlay: Number(getComputedStyle(overlay).zIndex),
        };
    });
    expect(stacking.header).toBeGreaterThan(stacking.overlay);
    expect(stacking.row).toBeGreaterThan(stacking.overlay);
    await expect(header).toBeVisible();
    await expect(rowNumber).toHaveText('100');
    await expect(rowNumber.locator('..')).toHaveCSS('transform', 'none');
    const stickyCellOnTop = await rowNumber.evaluate(cell => {
        const overlay = cell.closest('.data-table-scroll-frame')!.querySelector<HTMLElement>('.scroll-edge-shadows')!;
        const previous = overlay.style.pointerEvents;
        try {
            overlay.style.pointerEvents = 'auto';
            const rect = cell.getBoundingClientRect();
            const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return target === cell || cell.contains(target);
        } finally {
            overlay.style.pointerEvents = previous;
        }
    });
    expect(stickyCellOnTop).toBe(true);
    await page.getByRole('searchbox', { name: 'Filter current page' }).fill('row-99');
    await expect(frame.locator('tbody tr')).toHaveCount(1);
    await expect(top).not.toHaveClass(/is-visible/);
    await expect(bottom).not.toHaveClass(/is-visible/);

    await replaceSql(page, `SELECT 1\n${'-- A long editor line '.repeat(15)}\n${'-- line\n'.repeat(100)}`);
    const editorFrame = page.locator('.sql-editor-scroll-frame');
    await expect(editorFrame.locator('.scroll-edge-shadow.is-top')).toHaveClass(/is-visible/);
    const editorScroll = page.locator('.cm-scroller');
    await editorScroll.evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0; });
    await expect(editorFrame.locator('.scroll-edge-shadow.is-top')).not.toHaveClass(/is-visible/);
    await expect(editorFrame.locator('.scroll-edge-shadow.is-bottom')).toHaveClass(/is-visible/);
    await expect(editorFrame.locator('.scroll-edge-shadow.is-right')).toHaveClass(/is-visible/);
    await expect(editorFrame.locator('.scroll-edge-shadow.is-bottom')).toHaveCSS('height', '12px');
});
