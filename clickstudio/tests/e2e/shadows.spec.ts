import { test, expect, type Locator, type Page } from '@playwright/test';
import { openResultFilter, replaceSql, runButton, trust } from './helpers.js';

const shadow = (locator: Locator) =>
    locator
        .evaluate(element => getComputedStyle(element).boxShadow)
        .then(value => value.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px, /g, ''));
const backdrop = (locator: Locator, native = false) =>
    locator.evaluate((element, isNative) => {
        const style = getComputedStyle(element, isNative ? '::backdrop' : undefined);
        return { color: style.backgroundColor, filter: style.backdropFilter };
    }, native);

async function expectWrappedSearchFocus(input: Locator, wrapper: Locator) {
    await input.focus();
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS('outline-style', 'none');
    await expect(input).toHaveCSS('box-shadow', 'none');
    await expect.poll(() => shadow(wrapper)).toMatch(/0px 0px 0px 2px/);
    await input.press('Tab');
    await expect.poll(() => shadow(wrapper)).toMatch(/^(none|.+ 0px 0px 0px 0px)$/);
}

async function expectNeutralWorkspace(page: Page) {
    const panel = await page
        .locator('.editor-surface')
        .evaluate(element => getComputedStyle(element).backgroundColor);
    const line = await page
        .locator('.topbar')
        .evaluate(element => getComputedStyle(element).borderBottomColor);
    const hoverPalette = await page.locator('html').evaluate(element => {
        const style = getComputedStyle(element);
        const color = (token: string) => {
            const hex = style.getPropertyValue(token).trim().slice(1);
            return `rgb(${[0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
        };
        return {
            background: color('--panel-hover'),
            border: color('--line-bright'),
            text: color('--text'),
        };
    });
    for (const selector of [
        '.application',
        '.topbar',
        '.document-tabs',
        '.editor-heading',
        '.results-header',
        '.inspector-header',
        '.inspector-pane',
    ]) {
        await expect(page.locator(selector)).toHaveCSS('background-image', 'none');
        expect(
            await page
                .locator(selector)
                .evaluate(element => getComputedStyle(element).backgroundColor),
        ).toMatch(/^rgb\(/);
    }
    await expect(page.locator('.topbar')).toHaveCSS('backdrop-filter', 'none');
    const header = await page
        .locator('.editor-heading')
        .evaluate(element => getComputedStyle(element).backgroundColor);
    await expect(page.locator('.results-header')).toHaveCSS('background-color', header);
    await expect(page.locator('.inspector-header')).toHaveCSS('background-color', header);
    await expect(page.locator('.inspector-pane')).toHaveCSS('background-color', panel);
    const accent = await runButton(page).evaluate(
        element => getComputedStyle(element).backgroundImage,
    );
    const lightTheme = await page
        .locator('html')
        .evaluate(element => element.dataset.theme === 'click-light');
    if (lightTheme) expect(accent).toBe('none');
    else expect(accent).toContain('linear-gradient');
    const selected = await page
        .locator('.document-tab.is-active')
        .evaluate(element => getComputedStyle(element).boxShadow);
    expect(selected).not.toBe('none');
    for (const control of [
        page.getByTestId('save-query'),
        page.locator('.panel-window-button').first(),
        page.locator('.panel-collapse-button').first(),
    ]) {
        await expect(control).toHaveCSS('background-image', 'none');
        await expect(control).toHaveCSS('background-color', panel);
        await expect(control).toHaveCSS('border-color', line);
        await control.hover();
        await expect(control).toHaveCSS('background-image', 'none');
        await expect(control).toHaveCSS('background-color', hoverPalette.background);
        await expect(control).toHaveCSS('border-color', hoverPalette.border);
        await expect(control).toHaveCSS('color', hoverPalette.text);
    }
}

async function expectCompactToolbar(page: Page) {
    await expect(runButton(page)).toHaveCSS('height', '32px');
    await expect(runButton(page)).toHaveCSS('font-size', '11px');
    await expect(page.getByTestId('save-query')).toHaveCSS('height', '28px');
    await expect(page.getByTestId('format-sql')).toHaveCSS('height', '28px');
    await expect(page.locator('.results-tabs')).toHaveCSS('height', '28px');
    for (const selector of ['.editor-heading', '.results-header']) {
        const header = page.locator(selector);
        await expect(header).toHaveCSS('height', '48px');
        const bounds = await header.boundingBox();
        expect(bounds).not.toBeNull();
        for (const control of await header.locator('.button-base').all()) {
            const before = await control.boundingBox();
            expect(before).not.toBeNull();
            expect(before!.x).toBeGreaterThanOrEqual(bounds!.x);
            expect(before!.x + before!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
            expect(
                Math.abs(before!.y + before!.height / 2 - (bounds!.y + bounds!.height / 2)),
            ).toBeLessThanOrEqual(1);
            await control.hover();
            await expect(control).toHaveCSS('transform', 'none');
        }
        for (const control of await header
            .locator('.panel-window-button, .panel-collapse-button')
            .all()) {
            await expect(control).toHaveCSS('width', '28px');
            await expect(control).toHaveCSS('height', '28px');
        }
    }
}

for (const theme of ['Dark', 'Light'])
    for (const mode of ['Standard', 'Experimental']) {
        test(`${theme} ${mode} keeps workspace panels flat and overlay depth neutral across accents`, async ({
            page,
        }) => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.setViewportSize({ width: 1440, height: 900 });
            await trust(page);
            await page.getByText(mode, { exact: true }).click();
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await runButton(page).click();
            await expect(page.locator('.data-table')).toBeVisible();
            await expectCompactToolbar(page);
            const editor = page.locator('.editor-surface');
            await page.locator('.cm-content').focus();
            await expect(editor).toHaveCSS('box-shadow', 'none');
            await expect(page.locator('.results-surface')).toHaveCSS('box-shadow', 'none');
            await expect(page.locator('.topbar')).toHaveCSS('box-shadow', 'none');
            const filter = await openResultFilter(page);
            await expect(filter).toHaveCSS('height', '28px');
            await page.keyboard.press('Tab');
            await filter.focus();
            await expect(filter).toHaveCSS('outline-style', 'solid');
            await expect(filter).toHaveCSS('outline-width', '2px');
            expect(await shadow(filter)).toMatch(/0px 0px 0px 2px/);
            await filter.fill('2026-01-02');
            await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
            await filter.fill('');
            for (const selector of [
                '.editor-surface',
                '.results-surface',
                '[data-testid="run-button"]',
                '[data-testid="save-query"]',
                '.panel-window-button',
                '.panel-collapse-button',
                '[aria-label="Filter current page"]',
            ]) {
                await expect(page.locator(selector).first()).toHaveCSS('border-radius', '4px');
            }
            await expect(page.locator('.topbar-control-rail')).toHaveCSS('border-radius', '0px');
            await expect(page.locator('.document-tab.is-active')).toHaveCSS(
                'border-radius',
                '4px 4px 0px 0px',
            );
            await expect(page.locator('.data-table th small').first()).toHaveCSS(
                'border-radius',
                '2px',
            );
            await expect(page.locator('.data-table th').first()).toHaveCSS('border-radius', '0px');
            await expect(page.locator('.accent-mode-swatch').first()).toHaveCSS(
                'border-radius',
                '50%',
            );
            await expect(page.locator('.status-light').first()).toHaveCSS('border-radius', '50%');
            const inspector = page.locator('.inspector-pane.is-docked-inspector');
            if (!(await inspector.isVisible()))
                await page
                    .locator('.icon-rail')
                    .getByRole('button', { name: 'Objects', exact: true })
                    .click();
            await expect(inspector).toHaveCSS('border-radius', '0px');
            await expect(inspector.locator('.object-tree-scroll')).toHaveCSS(
                'border-radius',
                '4px',
            );
            await expect(inspector.locator('.object-tree-count').first()).toHaveCSS(
                'border-radius',
                '2px',
            );
            await expectWrappedSearchFocus(
                inspector.getByTestId('schema-search'),
                inspector.locator('.object-search'),
            );
            await expectNeutralWorkspace(page);

            await page.locator('.connection-trigger').click();
            const menu = page.getByRole('dialog', { name: 'Connection details', exact: true });
            await expect(menu).toBeVisible();
            await expect(menu).toHaveCSS('border-radius', '4px');
            const menuShadow = await shadow(menu);
            expect(menuShadow).not.toBe('none');
            await page.locator('.connection-trigger').click();
            await page.getByRole('button', { name: 'Help', exact: true }).click();
            const help = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
            await expect(help).toBeVisible();
            await expect(help).toHaveCSS('border-radius', '4px');
            const dialogShadow = await shadow(help);
            expect(dialogShadow).not.toBe(menuShadow);
            const scrim = await backdrop(page.locator('.workspace-help-backdrop'));
            await help.getByTestId('help-section-examples').click();
            await expectWrappedSearchFocus(
                help.getByTestId('sql-example-search'),
                help.locator('.sql-example-search'),
            );
            await help.getByTestId('help-section-reference').click();
            await expectWrappedSearchFocus(
                help.getByRole('textbox', { name: 'Search ClickHouse…', exact: true }),
                help.locator('.reference-search'),
            );
            await help.getByTestId('help-section-examples').click();
            const category = help.locator('.sql-example-category').first();
            await page.keyboard.press('Tab');
            await category.focus();
            await expect(category).toHaveCSS('outline-style', 'solid');
            await expect(category).toHaveCSS('outline-offset', '-3px');
            await page.keyboard.press('Escape');
            await expect(help).toBeHidden();

            await page
                .getByRole('button', { name: 'ClickHouse yellow accent', exact: true })
                .click();
            await expect(editor).toHaveCSS('border-radius', '4px');
            await expect(runButton(page)).toHaveCSS('border-radius', '4px');
            await expectNeutralWorkspace(page);
            await expectWrappedSearchFocus(
                inspector.getByTestId('schema-search'),
                inspector.locator('.object-search'),
            );
            await page.getByRole('button', { name: 'Help', exact: true }).click();
            await help.getByTestId('help-section-examples').click();
            await expectWrappedSearchFocus(
                help.getByTestId('sql-example-search'),
                help.locator('.sql-example-search'),
            );
            await help.getByTestId('help-section-reference').click();
            await expectWrappedSearchFocus(
                help.getByRole('textbox', { name: 'Search ClickHouse…', exact: true }),
                help.locator('.reference-search'),
            );
            await page.keyboard.press('Escape');
            await expect(help).toBeHidden();
            await page.locator('.connection-trigger').click();
            await expect(menu).toHaveCSS('box-shadow', menuShadow);
            await page.locator('.connection-trigger').click();
            await page.getByRole('button', { name: 'Export', exact: true }).click();
            const exportDialog = page.getByRole('dialog', { name: 'Export', exact: true });
            await expect(exportDialog).toBeVisible();
            await expect(exportDialog).toHaveCSS('border-radius', '4px');
            await expect(exportDialog.locator('.export-option').first()).toHaveCSS(
                'border-radius',
                '4px',
            );
            await expect(
                exportDialog.getByRole('button', { name: 'Close export options', exact: true }),
            ).toHaveCSS('border-radius', '4px');
            await expect.poll(() => shadow(exportDialog)).toBe(dialogShadow);
            expect(await backdrop(exportDialog, true)).toEqual(scrim);
            await page.keyboard.press('Escape');
            await expect(exportDialog).toBeHidden();

            await page.getByRole('button', { name: 'Import', exact: true }).click();
            const importDialog = page.getByRole('dialog', { name: 'Import data', exact: true });
            await expect(importDialog).toBeVisible();
            await expect(importDialog).toHaveCSS('box-shadow', dialogShadow);
            expect(await backdrop(importDialog, true)).toEqual(scrim);
            await expect(importDialog).toHaveCSS('border-radius', '4px');
            const step = importDialog.locator('.import-step-item.is-current .import-step-number');
            await expect(step).toHaveCSS('border-radius', '0px');
            await expect(step).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            const stepColors = await step.evaluate(element => {
                const style = getComputedStyle(element);
                return { text: style.color, fill: style.backgroundColor };
            });
            expect(stepColors.text).not.toBe(stepColors.fill);
            await page.keyboard.press('Escape');
            await expect(importDialog).toBeHidden();
            await expect(runButton(page)).toHaveCSS('border-radius', '4px');
            await expect(runButton(page)).toHaveCSS('height', '32px');
            await expect(page.getByTestId('save-query')).toHaveCSS('height', '28px');
            await runButton(page).click({ trial: true });

            const otherTheme = theme === 'Dark' ? 'Light' : 'Dark';
            await page.getByRole('radio', { name: `${otherTheme} theme`, exact: true }).click();
            await page.getByRole('button', { name: 'Help', exact: true }).click();
            expect(await shadow(help)).not.toBe(dialogShadow);
            expect((await backdrop(page.locator('.workspace-help-backdrop'))).color).not.toBe(
                scrim.color,
            );
            await page.keyboard.press('Escape');
            await expect(runButton(page)).toBeEnabled();
        });
    }

for (const theme of ['Dark', 'Light'])
    test(`${theme} scroll cues track overflow without covering sticky headers or row numbers`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 900, height: 900 });
        await page.route(
            url => url.pathname.endsWith('/result'),
            async route => {
                const response = await route.fetch();
                const result = await response.json();
                await route.fulfill({
                    response,
                    json: {
                        ...result,
                        columns: Array.from({ length: 8 }, (_, index) => ({
                            name: `column_${index}`,
                            type: 'String',
                        })),
                        rows: Array.from({ length: 100 }, (_, index) =>
                            Array.from({ length: 8 }, () => `row-${index}`),
                        ),
                        offset: 0,
                        totalRows: 100,
                        nextOffset: null,
                        completeness: 'complete',
                    },
                });
            },
        );
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
        await scroll.evaluate(element => {
            element.scrollTop = element.scrollHeight;
            element.scrollLeft = element.scrollWidth;
        });
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
            const overlay = cell
                .closest('.data-table-scroll-frame')!
                .querySelector<HTMLElement>('.scroll-edge-shadows')!;
            const previous = overlay.style.pointerEvents;
            try {
                overlay.style.pointerEvents = 'auto';
                const rect = cell.getBoundingClientRect();
                const target = document.elementFromPoint(
                    rect.left + rect.width / 2,
                    rect.top + rect.height / 2,
                );
                return target === cell || cell.contains(target);
            } finally {
                overlay.style.pointerEvents = previous;
            }
        });
        expect(stickyCellOnTop).toBe(true);
        await (await openResultFilter(page)).fill('row-99');
        await expect(frame.locator('tbody tr')).toHaveCount(1);
        await expect(top).not.toHaveClass(/is-visible/);
        await expect(bottom).not.toHaveClass(/is-visible/);

        await replaceSql(
            page,
            `SELECT 1\n${'-- A long editor line '.repeat(15)}\n${'-- line\n'.repeat(100)}`,
        );
        const editorFrame = page.locator('.sql-editor-scroll-frame');
        await expect(editorFrame.locator('.scroll-edge-shadow.is-top')).toHaveClass(/is-visible/);
        const editorScroll = page.locator('.cm-scroller');
        await editorScroll.evaluate(element => {
            element.scrollTop = 0;
            element.scrollLeft = 0;
        });
        await expect(editorFrame.locator('.scroll-edge-shadow.is-top')).not.toHaveClass(
            /is-visible/,
        );
        await expect(editorFrame.locator('.scroll-edge-shadow.is-bottom')).toHaveClass(
            /is-visible/,
        );
        await expect(editorFrame.locator('.scroll-edge-shadow.is-right')).toHaveClass(/is-visible/);
        await expect(editorFrame.locator('.scroll-edge-shadow.is-bottom')).toHaveCSS(
            'height',
            '12px',
        );
    });
