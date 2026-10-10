import { test, expect } from '@playwright/test';
import { mockWritableWorkspace, previewCsv, chooseExistingTable } from './import-helpers.js';

test.beforeEach(async ({ page }) => {
    await mockWritableWorkspace(page);
    await page.route('**/api/imports/preview', route =>
        route.fulfill({
            status: 201,
            json: {
                id: 'input-1',
                name: 'events.csv',
                format: 'csv',
                columns: ['day', 'events'],
                rows: [{ day: '2026-01-01', events: '10' }],
                rowCount: 1,
            },
        }),
    );
    await page.getByRole('button', { name: 'Import', exact: true }).click();
});

test('Canceling the data file picker keeps the selected file ready to preview', async ({
    page,
}) => {
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    const picker = dialog.getByLabel('Choose a CSV, JSON, or NDJSON file');
    await picker.setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-01-01,10\n'),
    });
    await expect(dialog.locator('.import-selected-file')).toContainText('events.csv');
    await picker.dispatchEvent('cancel');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.import-selected-file')).toContainText('events.csv');
    await expect(dialog.getByRole('button', { name: 'Read file and continue' })).toBeEnabled();
});

test('Switching import types preserves row mappings and the selected SQL file', async ({
    page,
}) => {
    const dialog = await previewCsv(page);
    await chooseExistingTable(dialog);
    await dialog.getByLabel('Map events to destination').selectOption('');
    await dialog.getByRole('button', { name: /Open SQL file/ }).click();
    await dialog.getByLabel('Choose a SQL query file').setInputFiles({
        name: 'saved-query.sql',
        mimeType: 'application/sql',
        buffer: Buffer.from('SELECT 42'),
    });
    await dialog.getByRole('button', { name: /Rows CSV/ }).click();
    await expect(dialog.getByLabel('Import target table')).toHaveValue('demo.events');
    await expect(dialog.getByLabel('Map events to destination')).toHaveValue('');
    await expect(dialog.getByLabel('Map day to destination')).toHaveValue('day');
    await dialog.getByRole('button', { name: /Open SQL file/ }).click();
    await expect(dialog.locator('.import-selected-file')).toContainText('saved-query.sql');
    await expect(dialog.getByRole('button', { name: 'Open query', exact: true })).toBeEnabled();
});

test('Reopening import resets the SQL file and starts in rows mode', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByRole('button', { name: /Open SQL file/ }).click();
    await dialog.getByLabel('Choose a SQL query file').setInputFiles({
        name: 'saved-query.sql',
        mimeType: 'application/sql',
        buffer: Buffer.from('SELECT 42'),
    });
    await dialog.getByRole('button', { name: 'Close import wizard' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByLabel('Choose a CSV, JSON, or NDJSON file')).toBeVisible();
    await dialog.getByRole('button', { name: /Open SQL file/ }).click();
    await expect(dialog.locator('.import-selected-file')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Open query', exact: true })).toBeDisabled();
});

test('Opening a SQL file creates a draft without executing it', async ({ page }) => {
    let runRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests++;
    });
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByRole('button', { name: /Open SQL file/ }).click();
    await dialog.getByLabel('Choose a SQL query file').setInputFiles({
        name: 'saved-query.sql',
        mimeType: 'application/sql',
        buffer: Buffer.from('SELECT 42'),
    });
    await dialog.getByRole('button', { name: 'Open query', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('tab', { name: 'saved-query.sql', exact: true })).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('SELECT 42');
    expect(runRequests).toBe(0);
});
