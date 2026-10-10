import { test, expect } from '@playwright/test';
import { mockWritableWorkspace } from './import-helpers.js';
import { connectPreviewCloud, mockCloudEndpoint } from './cloud-import-helpers.js';

function gate() {
    let release: () => void = () => {};
    const wait = new Promise<void>(resolve => {
        release = resolve;
    });
    return { wait, release };
}

const recoverableImports = (url: URL) =>
    url.pathname === '/api/imports' && url.searchParams.get('recoverable') === 'true';

test('Import waits for recovery and destination loading with only a spinner', async ({
    page,
}, info) => {
    await mockWritableWorkspace(page);
    const recovery = gate();
    const destinations = gate();
    const destinationRequested = gate();
    await page.route(recoverableImports, async route => {
        await recovery.wait;
        await route.fulfill({ json: [] });
    });
    await page.route('**/api/connections/live/import-targets', async route => {
        destinationRequested.release();
        await destinations.wait;
        await route.fulfill({ json: ['demo.events'] });
    });
    try {
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
        const spinner = dialog.getByRole('status', { name: 'Loading import', exact: true });
        const picker = dialog.getByLabel('Choose a CSV, JSON, or NDJSON file');
        await expect(spinner).toBeVisible();
        await expect(spinner).toHaveCSS('width', '20px');
        await expect(dialog.locator('.import-loading-state')).toHaveText('');
        await expect(picker).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('import-loading.png') });
        recovery.release();
        await destinationRequested.wait;
        await expect(spinner).toBeVisible();
        await expect(picker).toHaveCount(0);
        destinations.release();
        await expect(picker).toBeVisible();
        await expect(spinner).toHaveCount(0);
    } finally {
        recovery.release();
        destinations.release();
    }
});

test('Import replaces its spinner with an error when recovery fails', async ({ page }) => {
    await mockWritableWorkspace(page);
    const recovery = gate();
    await page.route(recoverableImports, async route => {
        await recovery.wait;
        await route.fulfill({
            status: 503,
            json: { error: { code: 'UNAVAILABLE', message: 'Import history unavailable.' } },
        });
    });
    try {
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
        const spinner = dialog.getByRole('status', { name: 'Loading import', exact: true });
        await expect(spinner).toBeVisible();
        recovery.release();
        await expect(dialog.getByRole('alert')).toContainText('Import history unavailable.');
        await expect(spinner).toHaveCount(0);
        await expect(dialog.getByLabel('Choose a CSV, JSON, or NDJSON file')).toHaveCount(0);
        await expect(page.locator('.toast')).toHaveCount(0);
    } finally {
        recovery.release();
    }
});

test('Cloud connection and import startup preserve spinner sizes and reduced motion', async ({
    page,
}) => {
    await mockWritableWorkspace(page);
    await mockCloudEndpoint(page);
    const connection = gate();
    const schema = gate();
    let loadingSchema = false;
    await page.route('**/api/cloud', async route => {
        const body = route.request().postDataJSON() as { action?: string };
        if (body.action === 'test') await connection.wait;
        if (body.action === 'schema' && loadingSchema) await schema.wait;
        await route.fallback();
    });
    const connected = connectPreviewCloud(page);
    try {
        const connecting = page.getByRole('button', { name: 'Connecting…', exact: true });
        const smallSpinner = connecting.locator('.loading-orbit');
        await expect(smallSpinner).toBeVisible();
        await expect(smallSpinner).toHaveCSS('width', '12px');
        await expect(smallSpinner).toHaveCSS('height', '12px');
        await expect(smallSpinner).toHaveAttribute('aria-hidden', 'true');
        connection.release();
        await connected;
        loadingSchema = true;
        await page.getByRole('button', { name: 'Import', exact: true }).last().click();
        const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
        const spinner = dialog.getByRole('status', { name: 'Loading import', exact: true });
        await expect(spinner).toBeVisible();
        await expect(spinner).toHaveCSS('width', '20px');
        await expect(dialog.locator('.import-loading-state')).toHaveText('');
        await expect(dialog.getByLabel('Choose a CSV, JSON, or NDJSON file')).toHaveCount(0);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(spinner).toHaveCSS('animation-duration', '1e-05s');
        await expect(spinner).toHaveCSS('animation-iteration-count', '1');
        schema.release();
        await expect(dialog.getByLabel('Choose a CSV, JSON, or NDJSON file')).toBeVisible();
        await expect(spinner).toHaveCount(0);
    } finally {
        connection.release();
        schema.release();
        await connected;
    }
});
