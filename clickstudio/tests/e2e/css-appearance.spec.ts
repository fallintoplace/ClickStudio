import { test, expect } from '@playwright/test';
import { runButton, trust } from './helpers.js';
import { chooseExistingTable, mockWritableWorkspace, previewCsv } from './import-helpers.js';
import { chooseExistingCloudTable, connectPreviewCloud, mockCloudEndpoint } from './cloud-import-helpers.js';
import { expectReferenceStyles } from './style-reference.js';

test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    await page.clock.setFixedTime(new Date('2026-10-10T10:00:00Z'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const theme of ['Light', 'Dark']) {
    for (const accent of ['Cyan accent', 'ClickHouse yellow accent']) {
        for (const mode of ['Standard', 'Experimental']) {
            test(`CSS preserves ${theme}, ${accent}, ${mode} workspace layouts`, async ({ page }, info) => {
                await page.setViewportSize({ width: 1600, height: 1000 });
                await trust(page);
                await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
                await page.getByRole('button', { name: accent, exact: true }).click();
                await page.getByText(mode, { exact: true }).click();
                await expectReferenceStyles(page, info, 'empty-workspace');
                await runButton(page).click();
                await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
                await expectReferenceStyles(page, info, 'query-results');
                await page.getByRole('button', { name: 'Collapse SQL query', exact: true }).click();
                await expectReferenceStyles(page, info, 'collapsed-query');
                await page.route(url => url.pathname.endsWith('/result'), async route => {
                    const response = await route.fetch();
                    await route.fulfill({ response, json: {
                        ...await response.json(),
                        columns: [{ name: 'label', type: 'String' }],
                        rows: Array.from({ length: 200 }, (_, index) => [`row-${index}`]),
                        totalRows: 240, offset: 0, nextOffset: 200,
                    } });
                });
                await runButton(page).click();
                await expect(page.locator('.results-header .result-pagination')).toBeVisible();
                await expectReferenceStyles(page, info, 'paged-results');
                for (const viewport of [{ width: 900, height: 740 }, { width: 390, height: 844 }]) {
                    await page.setViewportSize(viewport);
                    await expectReferenceStyles(page, info, `responsive-${viewport.width}`);
                }
                await page.setViewportSize({ width: 1440, height: 1000 });
                const results = page.getByRole('region', { name: 'Query results', exact: true });
                await results.getByRole('tab', { name: 'Chart', exact: true }).click();
                await expect(results.locator('.chart-toolbar')).toBeVisible();
                await expectReferenceStyles(page, info, 'compact-chart');
                await results.getByRole('button', { name: 'Measures', exact: true }).click();
                await expect(results.getByRole('dialog', { name: 'Measures', exact: true })).toBeVisible();
                await expectReferenceStyles(page, info, 'chart-measures');
                await page.keyboard.press('Escape');
                await results.getByRole('button', { name: 'Chart details', exact: true }).click();
                await expect(results.getByRole('dialog', { name: 'Chart details', exact: true })).toBeVisible();
                await expectReferenceStyles(page, info, 'chart-details');
                await page.keyboard.press('Escape');
                await page.setViewportSize({ width: 390, height: 844 });
                await expectReferenceStyles(page, info, 'compact-chart-mobile');
                await results.getByRole('button', { name: 'Measures', exact: true }).click();
                await expect(results.getByRole('dialog', { name: 'Measures', exact: true })).toBeVisible();
                await expectReferenceStyles(page, info, 'chart-measures-mobile');
            });
        }

        test(`CSS preserves ${theme}, ${accent} help and native explorers`, async ({ page }, info) => {
            await page.setViewportSize({ width: 1440, height: 1000 });
            await trust(page);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await page.getByRole('button', { name: accent, exact: true }).click();
            await page.getByRole('button', { name: 'Help', exact: true }).click();
            const help = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
            for (const section of ['tour', 'monitoring', 'query', 'geo', 'storage', 'dependencies', 'compare']) {
                await help.getByTestId(`help-section-${section}`).click();
                await expect(help.getByTestId(`help-section-${section}`)).toHaveAttribute('aria-selected', 'true');
                await expectReferenceStyles(page, info, `help-${section}`);
            }
            await page.keyboard.press('Escape');
            await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
            const lineage = page.getByRole('dialog', { name: 'Materialized view dependencies', exact: true });
            await expect(lineage.locator('.native-lineage-canvas')).toBeVisible();
            await expect(lineage.getByRole('button', { name: 'Refresh metadata', exact: true })).toBeEnabled();
            await expectReferenceStyles(page, info, 'native-dependencies');
            await page.keyboard.press('Escape');
            await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
            await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
            const storage = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
            for (const section of ['Parts', 'Merges', 'Mutations']) {
                await storage.getByRole('button', { name: section, exact: true }).click();
                if (section === 'Parts') await expect(storage.locator('.parts-graph-viewport')).toBeVisible();
                else {
                    await expect(storage.locator('.native-snapshot-meta time')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}/);
                    await expect(storage.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
                }
                await expectReferenceStyles(page, info, `native-${section}`);
            }
            await storage.getByRole('button', { name: 'Close', exact: true }).click();
            await page.setViewportSize({ width: 390, height: 844 });
            await page.getByRole('button', { name: 'Help', exact: true }).click();
            await help.getByTestId('help-section-storage').click();
            await expectReferenceStyles(page, info, 'storage-mobile');
        });

        test(`CSS preserves ${theme}, ${accent} Cloud import destinations`, async ({ page }, info) => {
            await page.setViewportSize({ width: 1440, height: 1000 });
            await mockWritableWorkspace(page);
            await mockCloudEndpoint(page);
            await connectPreviewCloud(page);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await page.getByRole('button', { name: accent, exact: true }).click();
            await page.getByRole('button', { name: 'Import', exact: true }).last().click();
            const dialog = await previewCsv(page);
            await expect(dialog.locator('.import-destination-choice')).toBeVisible();
            const compareSizes = async (state: string) => {
                for (const width of [1440, 600, 390]) {
                    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
                    await expectReferenceStyles(page, info, `${state}-${width}`);
                }
                await page.setViewportSize({ width: 1440, height: 1000 });
            };
            await compareSizes('cloud-choose-table');
            await chooseExistingCloudTable(dialog);
            await expect(dialog.getByLabel('Map day to destination')).toHaveValue('day');
            await compareSizes('cloud-existing-table');
            await dialog.getByRole('radio', { name: /Create a table/ }).check();
            await dialog.getByLabel('New table name').fill('imported_events');
            await expect(dialog.getByLabel('Type for day')).toHaveValue('Date');
            await compareSizes('cloud-create-table');
            await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
            await expect(dialog.getByRole('heading', { name: 'Ready to import into default.imported_events' })).toBeVisible();
            await compareSizes('cloud-review');
            await dialog.getByRole('button', { name: 'Create table and import', exact: true }).click();
            await expect(dialog).toContainText('2 source rows processed successfully');
            await compareSizes('cloud-success');
        });

        test(`CSS preserves ${theme}, ${accent} import states on desktop and mobile`, async ({ page }, info) => {
            await page.setViewportSize({ width: 1440, height: 1000 });
            await mockWritableWorkspace(page);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await page.getByRole('button', { name: accent, exact: true }).click();
            const rows = [{ day: '2026-01-01', events: '10' }, { day: '2026-01-02', events: '20' }];
            await page.route('**/api/imports/preview', route => route.fulfill({ status: 201, json: {
                id: 'input-1', name: 'events.csv', format: 'csv', columns: ['day', 'events'], rows, rowCount: 2,
            } }));
            await page.route('**/api/imports/input-1/mapping', route => route.fulfill({ json: {
                id: 'mapping-1', inputId: 'input-1', connectionId: 'live', table: 'demo.events', fields: { day: 'day', events: 'events' }, rows, rowCount: 2,
            } }));
            await page.route('**/api/imports/mapping-1/commit', route => route.fulfill({ json: {
                id: 'mapping-1', table: 'demo.events', rows: 2, status: 'succeeded',
            } }));
            await page.getByRole('button', { name: 'Import', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
            const compareSizes = async (state: string) => {
                for (const width of [1440, 600, 390]) {
                    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
                    await expectReferenceStyles(page, info, `${state}-${width}`);
                }
                await page.setViewportSize({ width: 1440, height: 1000 });
            };
            await compareSizes('file');
            await dialog.locator('.import-file-picker').hover();
            await expectReferenceStyles(page, info, 'file-hover', page, false);
            await dialog.locator('.import-kind-button.is-query').click();
            await dialog.getByLabel('Choose a SQL query file').focus();
            await compareSizes('sql-file-focus');
            await dialog.getByLabel('Choose a SQL query file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') });
            await expect(dialog.getByRole('alert')).toBeVisible();
            await compareSizes('sql-file-error');
            await dialog.locator('.import-kind-button').first().click();
            await previewCsv(page);
            await compareSizes('mapping-disabled');
            await chooseExistingTable(dialog);
            const day = dialog.getByLabel('Map day to destination');
            await day.selectOption('events');
            await expect(day).toHaveAttribute('aria-invalid', 'true');
            await day.focus();
            await compareSizes('mapping-invalid');
            await day.selectOption('day');
            await dialog.getByLabel('Map day to destination').focus();
            await compareSizes('mapping-focus');
            await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
            await expect(dialog.getByRole('region', { name: 'Review import', exact: true })).toBeVisible();
            await compareSizes('review');
            await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();
            await expect(dialog).toContainText('2 source rows processed successfully');
            await compareSizes('success');
        });
    }
}
