import { test, expect, type Page } from '@playwright/test';

function countQuerySubmissions(page: Page) {
    let submissions = 0;
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
        )
            submissions++;
    });
    return () => submissions;
}

test('Local SQL drafts recover after reload without running a query', async ({ page }) => {
    const submissions = countQuerySubmissions(page);
    await page.goto('/');
    await page
        .getByRole('textbox', { name: 'SQL document name', exact: true })
        .fill('Local draft.sql');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT 42 AS answer');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'SQL document name', exact: true })).toHaveValue(
        'Local draft.sql',
    );
    await expect(page.locator('.cm-content')).toHaveText('SELECT 42 AS answer');
    expect(submissions()).toBe(0);
});
