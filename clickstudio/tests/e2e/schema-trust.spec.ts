import { test, expect, type Page, type Route } from '@playwright/test';

const schema = {
    connectionId: 'live',
    fetchedAt: '2026-09-23T00:00:00.000Z',
    tables: [{ database: 'analytics', name: 'events', engine: 'MergeTree', orderBy: '(tenant_id, day)', primaryKey: 'tenant_id, day', partitionKey: 'toYYYYMM(day)', samplingKey: 'tenant_id', ttlConfigured: true, rowEstimate: '1200000', sizeBytes: '1610612736', uncompressedBytes: '4294967296', parts: '20', activeParts: '18', projections: [{ name: 'by_day', type: 'Normal', sortingKey: 'day' }], skipIndexes: [{ name: 'tenant_bloom', type: 'bloom_filter', expression: 'tenant_id', granularity: '4' }] }],
    columns: [{ database: 'analytics', table: 'events', name: 'day', type: 'Date', defaultKind: '', comment: 'Event date' }],
    dictionaries: [{ database: 'analytics', name: 'campaign_lookup', status: 'LOADED', type: 'Hashed', keyColumns: 'campaign_id UInt64', attributeColumns: 'campaign_name String', elementCount: '18240', memoryBytes: '5242880', lastSuccessfulUpdate: '2026-09-23 08:15:00' }],
    warnings: [],
    truncated: false,
};

async function mockLiveWorkspace(page: Page, respondToSchema: (route: Route) => Promise<void>) {
    let trusted = true;
    let schemaRequests = 0;
    await page.route('**/api/session', route => route.fulfill({ json: { principal: { id: 'test-owner', role: 'owner' }, requiresLogin: false, demo: false } }));
    await page.route('**/api/connections', route => route.fulfill({ json: [{
        id: 'live', name: 'Test database', host: 'https://clickhouse.example', database: 'analytics', username: 'reader', readonly: true, trusted,
        limits: { rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4 },
        manifest: { version: 1, serverVersion: '26.1', testedAt: '2026-09-23T00:00:00.000Z', schema: { available: true }, progress: { available: true }, cancellation: { available: true }, explain: { available: true }, pipeline: { available: true }, queryLog: { available: true }, documentation: { available: false }, import: { available: false }, scripts: { available: true }, parameters: { available: true } },
    }] }));
    await page.route('**/api/connections/live/trust', async route => {
        trusted = Boolean((route.request().postDataJSON() as { trusted?: unknown }).trusted);
        await route.fulfill({ json: { trusted } });
    });
    await page.route('**/api/connections/live/schema', async route => {
        schemaRequests++;
        await respondToSchema(route);
    });
    await page.route('**/api/runs**', route => route.fulfill({ json: [] }));
    await page.route('**/api/documents**', route => route.fulfill({ json: [] }));
    await page.goto('/');
    await expect(page.getByTestId('run-button')).toBeEnabled();
    return { get schemaRequests() { return schemaRequests; } };
}

async function revokeAccess(page: Page) {
    await page.locator('.connection-trigger').click();
    await page.getByRole('dialog', { name: 'Connection details' }).getByRole('button', { name: 'Turn off read-only access', exact: true }).click();
    await expect(page.locator('.connection-quick-status')).toHaveText('Review needed');
    await expect(page.getByText('Schema is private', { exact: true })).toBeVisible();
}

async function replaceSql(page: Page, sql: string) {
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect(editor).toContainText(sql);
}

async function hoverToken(page: Page, token: string) {
    const point = await page.locator('.cm-content').evaluate((root, value) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const text = node.textContent ?? '', start = text.indexOf(value);
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + value.length);
            const bounds = range.getBoundingClientRect();
            return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
        }
        return undefined;
    }, token);
    if (!point) throw new Error(`Could not find SQL token ${token}`);
    await page.mouse.move(point.x, point.y);
}

test('Revoking trust removes loaded schema from editor completion and hover', async ({ page }) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await expect(page.getByText('events', { exact: true }).first()).toBeVisible();
    await replaceSql(page, 'SELECT day FROM events');
    await hoverToken(page, 'day');
    await expect(page.locator('.sql-hover')).toContainText('Date');

    await revokeAccess(page);
    await replaceSql(page, 'SELECT * FROM ev');
    await page.keyboard.press('Control+Space');
    await expect(page.getByRole('option').filter({ hasText: 'events' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    await replaceSql(page, 'SELECT day FROM events');
    await hoverToken(page, 'day');
    await expect(page.locator('.sql-hover')).toHaveCount(0);
});

test('Object explorer shows ClickHouse metadata, searchable children, and generated SQL', async ({ page }) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));

    await expect(page.getByRole('tree', { name: 'Objects' })).toBeVisible();
    const eventsObject = page.getByText('events', { exact: true }).first();
    await expect(eventsObject).toBeVisible();
    await eventsObject.click();
    await expect(page.getByLabel('Selected object')).toContainText('MergeTree');
    await expect(page.getByLabel('Selected object')).toContainText('ORDER BY');
    await expect(page.getByLabel('Selected object')).toContainText('(tenant_id, day)');
    await expect(page.getByLabel('Selected object')).toContainText('PRIMARY KEY');
    await expect(page.getByLabel('Selected object')).toContainText('PARTITION BY');
    await expect(page.getByLabel('Selected object')).toContainText('SAMPLE BY');
    await expect(page.getByLabel('Selected object')).toContainText('Configured');
    await expect(page.getByLabel('Selected object')).toContainText('1.2M rows');
    await expect(page.getByLabel('Selected object')).toContainText('1.5 GiB');
    await expect(page.getByLabel('Selected object')).toContainText('18 active');

    const sqlTabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
    const originalTabName = await sqlTabs.getByRole('tab').first().getAttribute('aria-label');
    await page.locator('button[aria-controls="sql-editor-content"]').click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();
    await page.getByRole('button', { name: 'Generate SELECT', exact: true }).click();
    await expect(page.locator('#sql-editor-content')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('SELECT');
    await expect(page.locator('.cm-content')).toContainText('`day`');
    await expect(page.locator('.cm-content')).toContainText('FROM `analytics`.`events`');
    await sqlTabs.getByRole('tab', { name: originalTabName!, exact: true }).click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();

    const search = page.getByTestId('schema-search');
    await search.fill('tenant_bloom');
    await expect(page.getByText('tenant_bloom', { exact: true })).toBeVisible();

    await search.fill('campaign_lookup');
    await expect(page.getByText('campaign_lookup', { exact: true })).toBeVisible();
    await page.getByText('campaign_lookup', { exact: true }).click();
    await expect(page.getByLabel('Selected object')).toContainText('18.2K');
});

test('Standard hides advanced object actions and keeps the object header balanced', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'beginner'));
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await page.locator('.icon-rail').getByRole('button', { name: 'Objects', exact: true }).click();

    const heading = page.locator('.object-heading');
    await expect(heading.getByRole('button', { name: 'View dependencies', exact: true })).toHaveCount(0);
    const count = heading.locator(':scope > span');
    const refresh = heading.getByRole('button', { name: 'Refresh', exact: true });
    await expect(count).toContainText('OBJECTS');
    await expect(refresh).toBeVisible();

    const [headingBounds, countBounds, refreshBounds] = await Promise.all([
        heading.boundingBox(), count.boundingBox(), refresh.boundingBox(),
    ]);
    expect(headingBounds).not.toBeNull();
    expect(countBounds).not.toBeNull();
    expect(refreshBounds).not.toBeNull();
    expect(countBounds!.x - headingBounds!.x).toBeLessThanOrEqual(4);
    expect(headingBounds!.x + headingBounds!.width - refreshBounds!.x - refreshBounds!.width).toBeLessThanOrEqual(4);

    await page.getByText('events', { exact: true }).first().click();
    const details = page.getByLabel('Selected object');
    await expect(details.getByRole('button', { name: 'Preview rows', exact: true })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Generate SELECT', exact: true })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Visualize parts', exact: true })).toHaveCount(0);
    await expect(page.locator('.object-reference-actions')).toHaveCount(0);
});

test('Preview Rows keeps the saved query panel preference on the previous tab', async ({ page }) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await page.route('**/api/runs**', async route => {
        if (route.request().method() === 'POST') {
            await route.fulfill({ status: 503, json: { error: { code: 'MOCK_RUN_FAILURE', message: 'The preview request is mocked.' } } });
            return;
        }
        await route.fallback();
    });

    const sqlTabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
    const originalTabName = await sqlTabs.getByRole('tab').first().getAttribute('aria-label');
    await page.locator('button[aria-controls="sql-editor-content"]').click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();
    await page.getByText('events', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Preview rows', exact: true }).click();
    await expect(sqlTabs.getByRole('tab').last()).toHaveAttribute('aria-label', 'Preview events.sql');
    await expect(page.locator('#sql-editor-content')).toBeHidden();

    await sqlTabs.getByRole('tab', { name: originalTabName!, exact: true }).click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();
});

test('MergeTree storage opens a selectable, metric-switchable D3 parts explorer', async ({ page }) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await page.route('**/api/connections/live/table-parts', route => route.fulfill({ json: {
        database: 'analytics', table: 'events',
        parts: [
            { active: true, partition: '2026-09', name: '202609_1_1_0', rows: '120000', marks: '15', compressedBytes: '4096', uncompressedBytes: '8192', level: 0, minBlockNumber: '1', maxBlockNumber: '1', modifiedAt: '2026-09-24 08:00:00', diskName: 'default' },
            { active: true, partition: '2026-09', name: '202609_2_2_0', rows: '80000', marks: '10', compressedBytes: '2048', uncompressedBytes: '4096', level: 0, minBlockNumber: '2', maxBlockNumber: '2', modifiedAt: '2026-09-24 08:10:00', diskName: 'default' },
            { active: false, partition: '2026-09', name: '202609_3_3_0', rows: '35000', marks: '5', compressedBytes: '512', uncompressedBytes: '1024', level: 0, minBlockNumber: '3', maxBlockNumber: '3', modifiedAt: '2026-09-24 08:12:00', diskName: 'cold' },
        ],
        totalParts: '3', activeParts: '2', inactiveParts: '1', truncated: false, measuredAt: '2026-09-24T08:10:00.000Z',
        totals: { rows: '235000', marks: '30', compressedBytes: '6656', uncompressedBytes: '13312' },
    } }));

    await page.getByText('events', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.parts-map-row')).toHaveCount(3);
    await expect(dialog.locator('.parts-map-row.is-inactive')).toHaveCount(1);
    await expect(dialog.locator('.parts-graph-meta')).toContainText('6.5 KiB');

    const stateFilter = dialog.getByRole('group', { name: 'Part state' });
    await stateFilter.getByRole('button', { name: 'Inactive 1', exact: true }).click();
    await expect(dialog.locator('.parts-map-row')).toHaveCount(1);
    await dialog.locator('.parts-map-row.is-inactive').click();
    await expect(dialog.locator('.parts-inspector')).toContainText('Min block');
    await expect(dialog.locator('.parts-inspector')).toContainText('Disk');
    await expect(dialog.locator('.parts-inspector')).toContainText('cold');
    await stateFilter.getByRole('button', { name: 'All', exact: true }).click();
    await expect(dialog.locator('.parts-map-row')).toHaveCount(3);

    const metricControl = dialog.getByRole('group', { name: 'MergeTree parts' });
    await metricControl.getByRole('button', { name: 'Rows', exact: true }).click();
    await expect(metricControl.getByRole('button', { name: 'Rows', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Zoom into partition 2026-09', exact: true }).click();
    await expect(dialog.locator('.parts-breadcrumb')).toContainText('2026-09');
    await dialog.getByRole('group', { name: 'Part map' }).getByRole('button', { name: 'Galaxy', exact: true }).click();
    await expect(dialog.locator('.parts-graph-viewport')).toHaveClass(/is-galaxy/);

    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog).toHaveCount(0);
});

test('A schema response arriving after trust is revoked cannot restore editor metadata', async ({ page }) => {
    let releaseSchema!: () => void;
    let notifyStarted!: () => void;
    const gate = new Promise<void>(resolve => { releaseSchema = resolve; });
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    const state = await mockLiveWorkspace(page, async route => {
        notifyStarted();
        await gate;
        await route.fulfill({ json: schema });
    });
    await started;
    expect(state.schemaRequests).toBeGreaterThan(0);
    await revokeAccess(page);
    releaseSchema();
    await expect(page.getByText('Schema is private', { exact: true })).toBeVisible();
    await replaceSql(page, 'SELECT * FROM ev');
    await page.keyboard.press('Control+Space');
    await expect(page.getByRole('option').filter({ hasText: 'events' })).toHaveCount(0);
});
