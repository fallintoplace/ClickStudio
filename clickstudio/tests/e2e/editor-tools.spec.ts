import { test, expect, type Page } from '@playwright/test';
import { trust } from './helpers.js';

function readSql(page: Page) {
    return page.locator('.cm-content').evaluate(editor => Array.from(editor.querySelectorAll('.cm-line')).map(line => line.textContent ?? '').join('\n'));
}

async function replaceSql(page: Page, sql: string) {
    const editor = page.locator('.cm-content');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect.poll(() => readSql(page)).toBe(sql);
}

test('statement navigation stays keyboard-accessible without executing SQL', async ({ page }) => {
    await trust(page);
    let runs = 0;
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runs++; });
    const sql = "SELECT 'a;b';\nSELECT 2;\nSELECT 3;";
    await replaceSql(page, sql);
    await expect(page.getByTestId('sql-editor-tools')).toHaveCount(0);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Alt+PageUp');
    await page.keyboard.press('Alt+PageDown');
    await expect.poll(() => readSql(page)).toBe(sql);
    expect(runs).toBe(0);
});

test('keyword completion is available outside strings and comments', async ({ page }) => {
    await trust(page);
    await replaceSql(page, 'SEL');
    await page.keyboard.press('Control+Space');
    await expect(page.getByRole('option', { name: 'SELECT', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await replaceSql(page, '-- SEL');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
    await replaceSql(page, "SELECT 'SEL");
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
});
