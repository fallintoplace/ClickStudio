import { test, expect } from '@playwright/test';
import { trust } from './helpers.js';
import {
    schema,
    mockWritableWorkspace,
    previewCsv,
    chooseExistingTable,
} from './import-helpers.js';

test('File import requires an explicit destination before review', async ({ page }) => {
    await mockWritableWorkspace(page);
    let mappingRequests = 0;
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
    await page.route('**/api/imports/input-1/mapping', route => {
        mappingRequests++;
        return route.fulfill({ json: {} });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = await previewCsv(page);

    await expect(dialog.getByLabel('Import target table')).toHaveValue('');
    await expect(dialog.locator('.import-mapping-empty-state')).toContainText('Choose a table');
    await expect(
        dialog.getByRole('button', { name: 'Choose a destination', exact: true }),
    ).toBeDisabled();
    expect(mappingRequests).toBe(0);

    await chooseExistingTable(dialog);
    await expect(dialog.getByLabel('Map day to destination')).toHaveValue('day');
    await expect(dialog.getByRole('button', { name: 'Review import', exact: true })).toBeEnabled();
});

test('File import previews, maps, and reports a successful insert without typed confirmation', async ({
    page,
}) => {
    await mockWritableWorkspace(page);
    let mappingBody: Record<string, unknown> | undefined;
    let commitBody: Record<string, unknown> | undefined;

    await page.route('**/api/imports/preview', route =>
        route.fulfill({
            status: 201,
            json: {
                id: 'input-1',
                name: 'events.csv',
                format: 'csv',
                columns: ['day', 'events'],
                rows: [
                    { day: '2026-01-01', events: '10' },
                    { day: '2026-01-02', events: '20' },
                ],
                rowCount: 2,
            },
        }),
    );
    await page.route('**/api/imports/input-1/mapping', async route => {
        mappingBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
            json: {
                id: 'mapping-1',
                inputId: 'input-1',
                connectionId: 'live',
                table: 'demo.events',
                fields: { day: 'day', events: 'events' },
                rows: [{ day: '2026-01-01', events: '10' }],
                rowCount: 2,
            },
        });
    });
    await page.route('**/api/imports/mapping-1/commit', async route => {
        commitBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
            json: { id: 'mapping-1', table: 'demo.events', rows: 2, status: 'succeeded' },
        });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = await previewCsv(page);
    await chooseExistingTable(dialog);
    const mappingColumnWidths = await dialog
        .locator('.import-column-map thead th')
        .evaluateAll(headers => headers.map(header => header.getBoundingClientRect().width));
    expect(mappingColumnWidths[1]).toBeGreaterThan(mappingColumnWidths[0]!);
    expect(mappingColumnWidths[2]).toBeLessThan(mappingColumnWidths[0]!);
    await expect(dialog.getByLabel('Map day to destination')).toHaveValue('day');
    await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
    const review = dialog.getByRole('region', { name: 'Review import', exact: true });
    await expect(
        review.getByRole('heading', { name: 'Ready to import into demo.events', exact: true }),
    ).toBeVisible();
    await expect(review.getByRole('definition').filter({ hasText: /^2 rows$/ })).toBeVisible();
    expect(commitBody).toBeUndefined();

    const commit = dialog.getByRole('button', { name: 'Import rows', exact: true });
    await expect(commit).toBeEnabled();
    await commit.click();

    await expect(dialog).toContainText('2 source rows processed successfully');
    expect(mappingBody).toMatchObject({
        connectionId: 'live',
        table: 'demo.events',
        fields: { day: 'day', events: 'events' },
    });
    expect(commitBody).toEqual({});
});

test('Import review explains sparse source values and unmapped default columns', async ({
    page,
}) => {
    const schemaWithDefaults = {
        ...schema,
        columns: [
            ...schema.columns,
            {
                database: 'demo',
                table: 'events',
                name: 'label',
                type: 'Nullable(String)',
                defaultKind: '',
                comment: '',
            },
            {
                database: 'demo',
                table: 'events',
                name: 'ingested_at',
                type: 'DateTime',
                defaultKind: 'DEFAULT',
                comment: '',
            },
        ],
    };
    await mockWritableWorkspace(page, ['demo.events'], schemaWithDefaults);
    await page.route('**/api/imports/preview', route =>
        route.fulfill({
            status: 201,
            json: {
                id: 'input-sparse',
                name: 'events.json',
                format: 'json',
                columns: ['day', 'events', 'label'],
                rows: [
                    { day: '2026-01-01', events: 10, label: 'first' },
                    { day: '2026-01-02', events: 20 },
                ],
                rowCount: 2,
            },
        }),
    );
    await page.route('**/api/imports/input-sparse/mapping', route =>
        route.fulfill({
            json: {
                id: 'mapping-sparse',
                inputId: 'input-sparse',
                connectionId: 'live',
                table: 'demo.events',
                fields: { day: 'day', events: 'events', label: 'label' },
                rows: [
                    { day: '2026-01-01', events: 10, label: 'first' },
                    { day: '2026-01-02', events: 20 },
                ],
                missingFields: { label: 1 },
                rowCount: 2,
            },
        }),
    );

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
            '[{"day":"2026-01-01","events":10,"label":"first"},{"day":"2026-01-02","events":20}]',
        ),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingTable(dialog);
    await dialog.getByRole('button', { name: 'Review import' }).click();

    const review = dialog.getByRole('region', { name: 'Review import', exact: true });
    await expect(review).toContainText(
        'Unmapped destination columns use ClickHouse defaults: ingested_at.',
    );
    await expect(review).toContainText(
        'label is missing in 1 input row. ClickHouse will apply the default for label.',
    );
});

test('File import review lists skipped columns and success can start another import', async ({
    page,
}) => {
    await mockWritableWorkspace(page);
    let previewRequests = 0;
    let mappingBody: Record<string, unknown> | undefined;
    await page.route('**/api/imports/preview', async route => {
        previewRequests++;
        await route.fulfill({
            status: 201,
            json: {
                id: `input-${previewRequests}`,
                name: 'events.csv',
                format: 'csv',
                columns: ['day', 'events', 'unused'],
                rows: [{ day: '2026-01-01', events: '10', unused: 'not imported' }],
                rowCount: 1,
            },
        });
    });
    await page.route('**/api/imports/input-1/mapping', async route => {
        mappingBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
            json: {
                id: 'mapping-1',
                inputId: 'input-1',
                connectionId: 'live',
                table: 'demo.events',
                fields: { day: 'day', events: 'events' },
                rows: [{ day: '2026-01-01', events: '10' }],
                rowCount: 1,
            },
        });
    });
    await page.route('**/api/imports/mapping-1/commit', route =>
        route.fulfill({
            json: { id: 'mapping-1', table: 'demo.events', rows: 1, status: 'succeeded' },
        }),
    );
    await page.route('**/api/imports/input-1', route =>
        route.request().method() === 'DELETE'
            ? route.fulfill({ json: { ok: true } })
            : route.fallback(),
    );

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    const input = dialog.getByLabel('Choose a CSV, JSON, or NDJSON file');
    await input.setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events,unused\n2026-01-01,10,not imported\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue', exact: true }).click();
    await chooseExistingTable(dialog);
    const mappingCounts = dialog.locator('.import-mapping-counts');
    await expect(mappingCounts).toContainText('2 mapped');
    await expect(mappingCounts).toContainText('1 skipped');
    await dialog.getByLabel('Map events to destination').selectOption('');
    await expect(mappingCounts).toContainText('1 mapped');
    await expect(mappingCounts).toContainText('2 skipped');
    await dialog.getByLabel('Map events to destination').selectOption('events');
    await expect(mappingCounts).toContainText('2 mapped');
    await expect(mappingCounts).toContainText('1 skipped');
    await dialog.getByRole('button', { name: 'Review import', exact: true }).click();

    const mapping = dialog.getByRole('table', { name: 'Import column mapping' });
    await expect(mapping).toBeVisible();
    await expect(dialog).toContainText('2 mapped · 1 skipped');
    await expect(mapping.locator('tbody tr').nth(2)).toContainText('unused');
    await expect(mapping.locator('tbody tr').nth(2)).toContainText('Skipped');
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();
    await expect(dialog).toContainText('1 source row processed successfully');
    expect(mappingBody).toMatchObject({ fields: { day: 'day', events: 'events' } });
    await dialog.getByRole('button', { name: 'Import another file' }).click();

    await expect(dialog.getByLabel('Choose a CSV, JSON, or NDJSON file')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events,unused\n2026-01-01,10,not imported\n'),
    });
    await expect(
        dialog.getByRole('button', { name: 'Read file and continue', exact: true }),
    ).toBeEnabled();
    await dialog.getByRole('button', { name: 'Read file and continue', exact: true }).click();
    await expect(dialog).toContainText('1 row · 3 columns · CSV');
    expect(previewRequests).toBe(2);
});

test('File import rejects oversized files in the browser before upload', async ({ page }) => {
    await mockWritableWorkspace(page);
    let previewRequests = 0;
    await page.route('**/api/imports/preview', route => {
        previewRequests++;
        return route.fulfill({ status: 500, json: {} });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'large.csv',
        mimeType: 'text/csv',
        buffer: Buffer.alloc(2_000_001),
    });
    await expect(dialog.getByRole('alert')).toContainText('larger than the 2 MB import limit');
    await expect(dialog.getByRole('button', { name: 'Read file and continue' })).toBeDisabled();
    expect(previewRequests).toBe(0);
});

test('File import rejects unsupported file types before upload', async ({ page }) => {
    await mockWritableWorkspace(page);
    let previewRequests = 0;
    await page.route('**/api/imports/preview', route => {
        previewRequests++;
        return route.fulfill({ status: 500, json: {} });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('not csv'),
    });
    await expect(dialog.getByRole('alert')).toContainText(
        'Choose a .csv, .json, .ndjson, or .jsonl file',
    );
    await expect(dialog.getByRole('button', { name: 'Read file and continue' })).toBeDisabled();
    expect(previewRequests).toBe(0);
});

test('File import shows server mapping errors without attempting a write', async ({ page }) => {
    await mockWritableWorkspace(page);
    let commitRequests = 0;
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
    await page.route('**/api/imports/input-1/mapping', route =>
        route.fulfill({
            status: 400,
            json: {
                error: { code: 'IMPORT_MISSING_FIELD', message: 'An input row is missing events' },
            },
        }),
    );
    await page.route('**/api/imports/mapping-1/commit', route => {
        commitRequests++;
        return route.fulfill({ json: {} });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = await previewCsv(page);
    await chooseExistingTable(dialog);
    await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(
        'IMPORT_MISSING_FIELD: An input row is missing events',
    );
    await expect(dialog.getByRole('alert')).toBeFocused();
    expect(commitRequests).toBe(0);
});

test('File import explains when the connection has no allowlisted targets', async ({ page }) => {
    await mockWritableWorkspace(page, []);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await expect(dialog.getByRole('status')).toContainText('No import targets are configured');
    await expect(dialog.getByLabel('Choose a CSV, JSON, or NDJSON file')).toHaveCount(0);
});

test('File import reports an unknown insert without retrying automatically', async ({ page }) => {
    await mockWritableWorkspace(page);
    let commitRequests = 0;
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
    await page.route('**/api/imports/input-1/mapping', route =>
        route.fulfill({
            json: {
                id: 'mapping-1',
                inputId: 'input-1',
                connectionId: 'live',
                table: 'demo.events',
                fields: { day: 'day', events: 'events' },
                rows: [{ day: '2026-01-01', events: '10' }],
                rowCount: 1,
            },
        }),
    );
    await page.route('**/api/imports/mapping-1/commit', async route => {
        commitRequests++;
        await route.fulfill({
            json: {
                id: 'mapping-1',
                table: 'demo.events',
                rows: 1,
                status: 'unknown',
                error: 'The insert outcome is unknown.',
            },
        });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = await previewCsv(page);
    await chooseExistingTable(dialog);
    await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();

    await expect(dialog).toContainText('We couldn’t confirm the import.');
    await expect(dialog).toContainText('The insert outcome is unknown.');
    await expect(
        dialog.getByRole('button', { name: 'I checked; the rows are there' }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: /retry|rows missing/i })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Check status' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Import another file' })).toHaveCount(0);
    expect(commitRequests).toBe(1);
});

test('File import reloads the destination mapping when the server detects a schema change', async ({
    page,
}) => {
    await mockWritableWorkspace(page);
    let schemaRequests = 0;
    let commitRequests = 0;
    await page.route('**/api/connections/live/schema', route => {
        schemaRequests++;
        return route.fulfill({ json: schema });
    });
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
    await page.route('**/api/imports/input-1/mapping', route =>
        route.fulfill({
            json: {
                id: 'mapping-1',
                inputId: 'input-1',
                connectionId: 'live',
                table: 'demo.events',
                fields: { day: 'day', events: 'events' },
                rows: [{ day: '2026-01-01', events: '10' }],
                rowCount: 1,
            },
        }),
    );
    await page.route('**/api/imports/mapping-1/commit', route => {
        commitRequests++;
        return route.fulfill({
            status: 409,
            json: {
                error: {
                    code: 'SCHEMA_CHANGED',
                    message: 'The destination schema changed; review a new mapping',
                },
            },
        });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = await previewCsv(page);
    await chooseExistingTable(dialog);
    await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();

    await expect(dialog).toContainText(
        'The destination schema changed. Review the updated mapping',
    );
    await expect(dialog.getByRole('button', { name: 'Review import', exact: true })).toBeVisible();
    expect(schemaRequests).toBeGreaterThanOrEqual(2);
    expect(commitRequests).toBe(1);
});

test('File import recovers an ambiguous write without offering a retry', async ({ page }) => {
    await mockWritableWorkspace(page);
    let recoverable: Record<string, unknown>[] = [
        {
            id: 'saved-import',
            connectionId: 'live',
            table: 'demo.events',
            queryId: 'clickstudio-import-test',
            rows: 2,
            createdAt: '2026-09-23T00:00:00.000Z',
            status: 'unknown',
            reconciliationRequired: true,
            error: 'The insert outcome is unknown.',
        },
    ];
    let reviewBody: Record<string, unknown> | undefined,
        previewRequests = 0;
    await page.route(
        url => url.pathname === '/api/imports' && url.searchParams.get('recoverable') === 'true',
        route => route.fulfill({ json: recoverable }),
    );
    await page.route('**/api/imports/saved-import/review', async route => {
        reviewBody = route.request().postDataJSON() as Record<string, unknown>;
        const job = recoverable[0]!;
        recoverable = [];
        await route.fulfill({ json: { ...job, reviewedAt: '2026-09-23T00:02:00.000Z' } });
    });
    await page.route('**/api/imports/preview', route => {
        previewRequests++;
        return route.fulfill({ status: 500, json: {} });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await expect(dialog.getByRole('region', { name: 'Import status' })).toContainText(
        'We couldn’t confirm the import.',
    );
    await expect(dialog.getByLabel('Choose a CSV, JSON, or NDJSON file')).toHaveCount(0);
    await expect(dialog).toContainText('The insert outcome is unknown.');
    await expect(
        dialog.getByRole('button', { name: 'I checked; the rows are there' }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: /retry|rows missing/i })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Check status' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'I checked; the rows are there' }).click();
    await expect(dialog.getByRole('region', { name: 'Import status' })).toContainText(
        'You confirmed the imported rows in demo.events',
    );
    await expect(dialog.getByRole('button', { name: 'Import another file' })).toBeVisible();
    expect(reviewBody).toEqual({ inspected: true, noActiveInsert: true });
    expect(previewRequests).toBe(0);
});

test('File import stays blocked when recoverable job status cannot be loaded', async ({ page }) => {
    await mockWritableWorkspace(page);
    let previewRequests = 0;
    await page.route(
        url => url.pathname === '/api/imports' && url.searchParams.get('recoverable') === 'true',
        route =>
            route.fulfill({
                status: 503,
                json: { error: { code: 'TEMPORARY', message: 'Import status unavailable' } },
            }),
    );
    await page.route('**/api/imports/preview', route => {
        previewRequests++;
        return route.fulfill({ status: 500, json: {} });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await expect(dialog.getByRole('alert')).toContainText('Could not check for unresolved imports');
    await expect(dialog.getByRole('button', { name: 'Retry recovery check' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Close import wizard' })).toBeEnabled();
    await expect(dialog.getByLabel('Choose a CSV, JSON, or NDJSON file')).toHaveCount(0);
    expect(previewRequests).toBe(0);
});

test('Fixture workspace explains that imports never write sample data', async ({ page }) => {
    await trust(page);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await expect(dialog.getByRole('status')).toContainText(
        'This workspace never writes to a database',
    );
    await expect(dialog.getByLabel('Choose a CSV, JSON, or NDJSON file')).toHaveCount(0);
});

test('Import setup opens at the top and keeps actions visible on short and narrow screens', async ({
    page,
}) => {
    await mockWritableWorkspace(page);
    await page.route('**/api/imports/preview', route =>
        route.fulfill({
            status: 201,
            json: {
                id: 'input-1',
                name: 'events.csv',
                format: 'csv',
                columns: ['day', 'events'],
                rows: [
                    { day: '2026-01-01', events: '10' },
                    { day: '2026-01-02', events: '20' },
                ],
                rowCount: 2,
            },
        }),
    );

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 450 });
    const dialog = await previewCsv(page);
    const main = dialog.locator('.import-wizard-main');
    await expect(dialog.getByRole('region', { name: 'Map source columns' })).toBeVisible();
    expect(await main.evaluate(element => element.scrollTop)).toBe(0);

    for (const viewport of [
        { width: 1280, height: 450 },
        { width: 640, height: 640 },
        { width: 390, height: 600 },
    ]) {
        await page.setViewportSize(viewport);
        const bounds = await dialog.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
        await expect(dialog.getByRole('button', { name: 'Close import wizard' })).toBeInViewport();
        await expect(
            dialog.getByRole('button', { name: 'Choose a destination', exact: true }),
        ).toBeInViewport();
        expect(await main.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
        await main.evaluate(element => {
            element.scrollTop = element.scrollHeight;
        });
        await expect(dialog.locator('.import-preview-table tbody tr').last()).toBeInViewport();
    }
});
