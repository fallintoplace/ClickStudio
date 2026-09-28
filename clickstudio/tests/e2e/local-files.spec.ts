import { test, expect, type Page } from '@playwright/test';

function countWrites(page: Page) {
    let writes = 0;
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (['POST', 'PUT', 'DELETE'].includes(request.method()) && /^\/api\/(runs|scripts|documents|workspace|assistant|imports)/.test(path)) writes++;
    });
    return () => writes;
}

function countQuerySubmissions(page: Page) {
    let submissions = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)) submissions++;
    });
    return () => submissions;
}

test('Local SQL drafts recover after reload without running a query', async ({ page }) => {
    const submissions = countQuerySubmissions(page);
    await page.goto('/');
    await page.getByRole('textbox', { name: 'SQL document name', exact: true }).fill('Local draft.sql');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT 42 AS answer');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'SQL document name', exact: true })).toHaveValue('Local draft.sql');
    await expect(page.locator('.cm-content')).toHaveText('SELECT 42 AS answer');
    expect(submissions()).toBe(0);
});

test('Export local drafts downloads the current browser workspace without server writes', async ({ page }) => {
    const writes = countWrites(page);
    await page.addInitScript(() => {
        const createObjectURL = URL.createObjectURL.bind(URL);
        URL.createObjectURL = value => {
            if (value instanceof Blob) {
                (window as Window & { __localDraftExport?: Promise<string> }).__localDraftExport = value.text();
            }
            return createObjectURL(value);
        };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT 42 AS answer');
    await page.getByTitle('Export local drafts').click();
    await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __localDraftExport?: Promise<string> }).__localDraftExport))).toBe(true);
    const json = await page.evaluate(async () => await (window as Window & { __localDraftExport?: Promise<string> }).__localDraftExport);
    const backup = JSON.parse(json!) as { version: number; tabs: { name: string; sql: string }[] };
    expect(backup.version).toBe(1);
    expect(backup.tabs).toContainEqual(expect.objectContaining({ name: 'Getting started.sql', sql: 'SELECT 42 AS answer' }));
    expect(writes()).toBe(0);
});
