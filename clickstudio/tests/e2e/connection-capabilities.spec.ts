import { test, expect } from '@playwright/test';

test('Connection review tests capabilities before trust and can retest after restart', async ({
    page,
}) => {
    let trusted = false;
    let manifest: Record<string, unknown> | undefined;
    let tests = 0;
    let trusts = 0;
    const connection = () => ({
        dataSource: 'clickhouse',
        id: 'live',
        name: 'Analytics',
        host: 'https://clickhouse.example',
        database: 'analytics',
        username: 'reader',
        readonly: true,
        limits: { rows: 5000, seconds: 30 },
        trusted,
        manifest,
    });

    await page.route('**/api/**', async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/api/session') {
            await route.fulfill({
                json: {
                    principal: { id: 'local-owner', role: 'owner' },
                    requiresLogin: false,
                    demo: false,
                },
            });
        } else if (pathname === '/api/connections' && request.method() === 'GET') {
            await route.fulfill({ json: [connection()] });
        } else if (pathname === '/api/connections/live/test' && request.method() === 'POST') {
            tests++;
            manifest = {
                version: 1,
                serverVersion: '24.6',
                testedAt: new Date().toISOString(),
                schema: { available: true },
                progress: { available: true },
                cancellation: { available: false },
                explain: { available: true },
                pipeline: { available: true },
                queryLog: { available: false },
                documentation: { available: false },
                import: { available: false },
                scripts: { available: true },
                parameters: { available: true },
            };
            await route.fulfill({ json: connection() });
        } else if (pathname === '/api/connections/live/trust' && request.method() === 'POST') {
            trusts++;
            trusted = request.postDataJSON().trusted === true;
            await route.fulfill({ json: { trusted } });
        } else if (pathname === '/api/connections/live/schema') {
            await route.fulfill({
                json: {
                    connectionId: 'live',
                    fetchedAt: new Date().toISOString(),
                    tables: [],
                    columns: [],
                    dictionaries: [],
                    warnings: [],
                    truncated: false,
                },
            });
        } else {
            await route.continue();
        }
    });

    await page.goto('/');
    await expect(page.locator('.connection-quick-status')).toHaveText('Test needed');
    await expect(page.getByTestId('server-version')).toHaveText('ClickHouse version unavailable');
    await page.locator('.connection-trigger').click();
    const menu = page.getByRole('dialog', { name: 'Connection details' });
    await menu.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect.poll(() => tests).toBe(1);
    await expect(page.locator('.connection-quick-status')).toHaveText('Review needed');
    await expect(page.getByTestId('server-version')).toHaveText('ClickHouse 24.6');
    await expect(menu.getByRole('button', { name: 'Trust connection', exact: true })).toBeVisible();
    expect(trusts).toBe(0);

    page.once('dialog', dialog => void dialog.accept());
    await menu.getByRole('button', { name: 'Trust connection', exact: true }).click();
    await expect(page.locator('.connection-quick-status')).toHaveText('Read-only');
    expect(trusts).toBe(1);

    manifest = undefined;
    await page.reload();
    await expect(page.locator('.connection-quick-status')).toHaveText('Retest needed');
    await expect(page.getByTestId('server-version')).toHaveText('ClickHouse version unavailable');
    await page.locator('.connection-trigger').click();
    const restartedMenu = page.getByRole('dialog', { name: 'Connection details' });
    await restartedMenu.getByRole('button', { name: 'Retest connection', exact: true }).click();
    await expect.poll(() => tests).toBe(2);
    await expect(page.locator('.connection-quick-status')).toHaveText('Read-only');
    expect(trusts).toBe(1);
});
