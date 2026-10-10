import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { replaceSql } from './helpers.js';

const sql =
    "SELECT /* aggregate */ quantile(0.50)(number) AS p50_ms, 1000000, -2, 'frontend', 'it''s', true, NULL, {limit:UInt64}, \"quoted name\", `FROM`, `toDate`, `UInt64`, \"SELECT\" FROM numbers(7) -- latency";
const tokens = [
    'SELECT',
    '/* aggregate */',
    'quantile',
    'p50_ms',
    '0.50',
    '1000000',
    '-2',
    "'frontend'",
    "'it''s'",
    'true',
    'NULL',
    '{limit:UInt64}',
    'quoted name',
    '`FROM`',
    '`toDate`',
    '`UInt64`',
    '"SELECT"',
    'FROM',
    'numbers',
    '-- latency',
];

async function tokenContrast(page: Page, selected: boolean) {
    return page.locator('.cm-content').evaluate(
        (content, { tokens, selected }) => {
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
                return background.map((value, index) =>
                    index < 3 ? foreground[index]! * alpha + value * (1 - alpha) : 255,
                );
            };
            const luminance = (color: number[]) =>
                color
                    .slice(0, 3)
                    .map(value => {
                        const channel = value / 255;
                        return channel <= 0.04045
                            ? channel / 12.92
                            : ((channel + 0.055) / 1.055) ** 2.4;
                    })
                    .reduce(
                        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!,
                        0,
                    );
            const editor = content.closest('.cm-editor')!;
            const panel = rgba(getComputedStyle(editor).backgroundColor);
            const selection = editor.querySelector('.cm-selectionBackground');
            if (selected && !selection) throw new Error('The selection highlight is missing');
            return tokens.map(token => {
                const start = content.textContent!.indexOf(token);
                if (start < 0) throw new Error(`Missing token: ${token}`);
                const end = start + token.length;
                const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
                let node: Node | null;
                let offset = 0;
                const ratios: number[] = [];
                while ((node = walker.nextNode())) {
                    const nextOffset = offset + node.textContent!.length;
                    if (nextOffset > start && offset < end) {
                        const element = node.parentElement!;
                        const foreground = rgba(getComputedStyle(element).color);
                        const line = element.closest('.cm-line')!;
                        let background = panel;
                        if (selected)
                            background = blend(
                                rgba(getComputedStyle(selection!).backgroundColor),
                                background,
                            );
                        background = blend(
                            rgba(getComputedStyle(line).backgroundColor),
                            background,
                        );
                        const light = luminance(foreground);
                        const dark = luminance(background);
                        ratios.push(
                            (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
                        );
                    }
                    offset = nextOffset;
                }
                if (!ratios.length) throw new Error(`No rendered text for token: ${token}`);
                return { token, ratio: Math.min(...ratios) };
            });
        },
        { tokens, selected },
    );
}

async function expectThemeTokenColors(page: Page, theme: string) {
    for (const token of ['`FROM`', '`toDate`', '`UInt64`', '"SELECT"']) {
        await expect(page.locator('.cm-content span').filter({ hasText: token }).last()).toHaveCSS(
            'color',
            theme === 'Light' ? 'rgb(31, 31, 31)' : 'rgb(239, 248, 250)',
        );
    }
    await expect(
        page
            .locator('.cm-content span')
            .filter({ hasText: /^NULL$/ })
            .last(),
    ).toHaveCSS('color', theme === 'Light' ? 'rgb(0, 0, 255)' : 'rgb(197, 152, 255)');
    if (theme === 'Light') {
        for (const [token, color] of [
            ['SELECT', 'rgb(0, 0, 255)'],
            ["'frontend'", 'rgb(163, 21, 21)'],
            ['0.50', 'rgb(8, 118, 69)'],
            ['/* aggregate */', 'rgb(0, 112, 0)'],
            ['quantile', 'rgb(121, 94, 38)'],
        ] as const) {
            await expect(
                page
                    .locator('.cm-content span')
                    .filter({
                        hasText: new RegExp(`^${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
                    })
                    .last(),
            ).toHaveCSS('color', color);
        }
    }
}

for (const parser of ['ready', 'unavailable']) {
    test(`SQL tokens remain readable across themes and accents with the ${parser} parser`, async ({
        page,
    }) => {
        if (parser === 'unavailable')
            await page
                .context()
                .route('**/clickhouse-parser.wasm', route =>
                    route.fulfill({ status: 503, body: 'Parser unavailable' }),
                );
        await page.goto('/');
        await replaceSql(page, sql);
        if (parser === 'ready')
            await expect(
                page.locator('.cm-native-function').filter({ hasText: 'quantile' }),
            ).toBeVisible();
        else {
            await expect(
                page.getByRole('button', { name: 'Retry parser', exact: true }),
            ).toBeVisible();
            await expect(page.locator('.cm-native-function')).toHaveCount(0);
        }

        for (const theme of ['Dark', 'Light']) {
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await expectThemeTokenColors(page, theme);
            for (const accent of ['Cyan accent', 'ClickHouse yellow accent']) {
                await page.getByRole('button', { name: accent, exact: true }).click();
                for (const state of ['normal', 'active', 'selected']) {
                    const editor = page.locator('.cm-content');
                    if (state !== 'normal') {
                        await editor.focus();
                        await page.keyboard.press('ControlOrMeta+End');
                    }
                    if (state === 'selected') {
                        await page.keyboard.press('ControlOrMeta+a');
                        await expect(page.locator('.cm-selectionBackground')).toBeVisible();
                    }
                    for (const { token, ratio } of await tokenContrast(
                        page,
                        state === 'selected',
                    )) {
                        expect(
                            ratio,
                            `${parser}, ${theme}, ${accent}, ${state}: ${token}`,
                        ).toBeGreaterThanOrEqual(4.5);
                    }
                    await expect(editor).toHaveText(sql);
                    if (state === 'selected') await page.keyboard.press('ArrowRight');
                    await editor.evaluate(element => (element as HTMLElement).blur());
                }
            }
        }
    });
}

test('Light editor selections stay visible over the active line with both accents', async ({
    page,
}, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await replaceSql(page, `SELECT${' '.repeat(20)}1`);
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
    const editor = page.locator('.cm-content');
    for (const accent of ['Cyan accent', 'ClickHouse yellow accent']) {
        await page.getByRole('button', { name: accent, exact: true }).click();
        await editor.focus();
        await page.keyboard.press('ControlOrMeta+End');
        const before = PNG.sync.read(await page.screenshot({ caret: 'hide' }));
        await page.keyboard.press('ControlOrMeta+a');
        const selection = page.locator('.cm-selectionBackground');
        await expect(selection).toBeVisible();
        const bounds = (await selection.boundingBox())!;
        const after = PNG.sync.read(
            await page.screenshot({
                caret: 'hide',
                path: info.outputPath(`${accent}-selection.png`),
            }),
        );
        const x = Math.floor(bounds.x + bounds.width / 2),
            y = Math.floor(bounds.y + bounds.height / 2);
        const offset = (y * after.width + x) * 4;
        const change = [0, 1, 2].reduce(
            (sum, channel) =>
                sum + Math.abs(after.data[offset + channel]! - before.data[offset + channel]!),
            0,
        );
        expect(
            change,
            `${accent}: selected whitespace must visibly differ from the active line`,
        ).toBeGreaterThan(30);
        await page.keyboard.press('ArrowRight');
    }
});

test('Switching the editor theme preserves the cursor and undo history', async ({ page }) => {
    await page.goto('/');
    await replaceSql(page, 'SELECT 0.50');
    const editor = page.locator('.cm-content');
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText(' + 1');
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
    await page.getByRole('radio', { name: 'Dark theme', exact: true }).click();
    await editor.focus();
    await page.waitForTimeout(600);
    await page.keyboard.insertText(' + 2');
    await expect(editor).toHaveText('SELECT 0.50 + 1 + 2');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).toHaveText('SELECT 0.50 + 1');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).toHaveText('SELECT 0.50');
});
