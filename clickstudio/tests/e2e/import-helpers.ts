import { expect, type Locator, type Page } from '@playwright/test';

export const schema = {
    connectionId: 'live',
    fetchedAt: '2026-09-23T00:00:00.000Z',
    tables: [{ database: 'demo', name: 'events', engine: 'MergeTree' }],
    columns: [
        { database: 'demo', table: 'events', name: 'day', type: 'Date', defaultKind: '', comment: '' },
        { database: 'demo', table: 'events', name: 'events', type: 'UInt64', defaultKind: '', comment: '' },
    ],
    warnings: [],
    truncated: false,
};

export async function mockWritableWorkspace(page: Page, targets = ['demo.events'], workspaceSchema = schema) {
    await page.route('**/api/session', route => route.fulfill({ json: { principal: { id: 'test-owner', role: 'owner' }, requiresLogin: false, demo: false } }));
    await page.route('**/api/connections', route => route.fulfill({ json: [{
        id: 'live', name: 'Test database', host: 'https://clickhouse.example', database: 'demo', username: 'reader', readonly: true, trusted: true,
        limits: { rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4 },
        manifest: { version: 1, serverVersion: '26.1', testedAt: '2026-09-23T00:00:00.000Z', schema: { available: true }, progress: { available: true }, cancellation: { available: true }, explain: { available: true }, pipeline: { available: true }, queryLog: { available: true }, documentation: { available: false }, import: { available: true }, scripts: { available: true }, parameters: { available: true } },
    }] }));
    await page.route('**/api/connections/live/schema', route => route.fulfill({ json: workspaceSchema }));
    await page.route('**/api/connections/live/import-targets', route => route.fulfill({ json: targets }));
    await page.route('**/api/runs**', route => route.fulfill({ json: [] }));
    await page.route('**/api/documents**', route => route.fulfill({ json: [] }));
    await page.route(url => url.pathname === '/api/imports' && url.searchParams.get('recoverable') === 'true', route => route.fulfill({ json: [] }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
}

export async function previewCsv(page: Page) {
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-01-01,10\n2026-01-02,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue', exact: true }).click();
    await expect(dialog).toContainText(/\d+ rows? · 2 columns · CSV/);
    await expect(dialog.getByRole('region', { name: 'Map source columns' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Preview your rows' })).toBeVisible();
    return dialog;
}

export async function chooseExistingTable(dialog: Locator) {
    const target = dialog.getByLabel('Import target table');
    await expect(target).toHaveValue('');
    await target.selectOption('demo.events');
}
