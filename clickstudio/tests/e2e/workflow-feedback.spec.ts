import { test, expect, type Page } from '@playwright/test';
import type { QueryDocument, Run } from '../../shared/types.js';
import { openWorkspacePanel, runButton, trust } from './helpers.js';

async function replaceSql(page: Page, sql: string) {
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect(page.locator('.cm-content')).toContainText(sql);
}

test('Reopening and saving a metric keeps its saved contract and dependency', async ({ page }) => {
    const savedDocument: QueryDocument = {
        id: 'saved-metric',
        owner: 'local-owner',
        name: 'Daily revenue',
        connectionId: 'demo',
        sql: 'SELECT {currency:String}',
        revision: 4,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        parameters: { currency: 'USD' },
        chart: { kind: 'line', x: 0, ys: [1], title: 'Revenue by day' },
        runId: 'saved-metric-run',
        parentDocumentId: 'metric-parent',
        dependencies: ['metric-source'],
        kind: 'metric',
        metric: {
            definition: 'sum(amount)',
            grain: 'day',
            dimensions: ['region'],
            timezone: 'UTC',
            filters: 'paid',
            nullTreatment: 'exclude',
            sourceColumns: ['orders.amount'],
        },
    };
    const savedRun: Run = {
        id: 'saved-metric-run',
        queryId: 'saved-metric-query',
        owner: 'local-owner',
        connectionId: 'demo',
        dataSource: 'fixture',
        sql: savedDocument.sql,
        kind: 'query',
        parameters: savedDocument.parameters,
        limits: { rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4 },
        tags: {},
        status: 'succeeded',
        createdAt: savedDocument.createdAt,
        elapsedMs: 12,
        rowCount: 1,
        bytes: 8,
        columns: [{ name: 'amount', type: 'UInt64' }],
        warnings: [],
        sequence: 1,
        resultState: 'expired',
        requestedBy: 'local-owner',
        executedAs: 'fixture-reader',
        permissionSnapshot: { readonly: true, role: 'owner' },
        retryPolicy: 'never',
    };
    let savePayload: Record<string, unknown> | undefined;
    await page.route(
        url => url.pathname === '/api/documents' && url.searchParams.get('trash') === 'true',
        route => route.fulfill({ json: [savedDocument] }),
    );
    await page.route('**/api/runs/saved-metric-run', route => route.fulfill({ json: savedRun }));
    await page.route(
        url => url.pathname === '/api/documents/saved-metric' && url.searchParams.size === 0,
        async route => {
            if (route.request().method() !== 'PUT') return route.continue();
            savePayload = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({
                json: {
                    ...savedDocument,
                    ...savePayload,
                    revision: 5,
                    updatedAt: '2026-01-03T00:00:00.000Z',
                },
            });
        },
    );
    await trust(page);
    const browser = page.getByRole('navigation', { name: 'Workspace browser', exact: true });
    await browser.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Queries', exact: true }).click();
    await page.getByRole('button', { name: /Daily revenue/ }).click();
    await expect(page.locator('.cm-content')).toContainText(savedDocument.sql);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', savedRun.queryId);
    await page.getByTestId('save-query').click();
    await expect.poll(() => savePayload).toBeDefined();
    expect(savePayload).toMatchObject({
        baseRevision: 4,
        parameters: savedDocument.parameters,
        chart: savedDocument.chart,
        runId: savedDocument.runId,
        parentDocumentId: savedDocument.parentDocumentId,
        kind: 'metric',
        metric: savedDocument.metric,
        dependencies: savedDocument.dependencies,
    });
});

test('Saving a query creates a revision and later edits stay local', async ({ page }) => {
    await trust(page);
    await replaceSql(page, 'SELECT 111');
    let saveRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/documents')
            saveRequests++;
    });
    const saveResponse = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    const response = await saveResponse;
    expect(response.ok()).toBe(true);
    const saved = (await response.json()) as { revision: number; sql: string };
    expect(saved).toMatchObject({ revision: 1, sql: 'SELECT 111' });
    await replaceSql(page, 'SELECT 222');
    await expect(page.locator('.cm-content')).toContainText('SELECT 222');
    expect(saveRequests).toBe(1);
});

test('Editing during a delayed save preserves the newer local SQL', async ({ page }) => {
    let release!: () => void,
        executions = 0;
    const wait = new Promise<void>(resolve => {
        release = resolve;
    });
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
        )
            executions++;
    });
    await page.route(
        url => url.pathname === '/api/documents',
        async route => {
            if (route.request().method() === 'POST') await wait;
            await route.continue();
        },
    );
    await trust(page);
    try {
        await replaceSql(page, 'SELECT 111');
        const saveRequest = page.waitForRequest(
            request =>
                request.method() === 'POST' && new URL(request.url()).pathname === '/api/documents',
        );
        const saveResponse = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/documents',
        );
        await page.getByTestId('save-query').click();
        const request = await saveRequest;
        expect(request.postDataJSON()).toMatchObject({ sql: 'SELECT 111' });
        await replaceSql(page, 'SELECT 222');
        release();
        const response = await saveResponse;
        expect(response.ok()).toBe(true);
        expect(await response.json()).toMatchObject({ sql: 'SELECT 111' });
        await expect(page.locator('.cm-content')).toContainText('SELECT 222');
        expect(executions).toBe(0);
    } finally {
        release();
    }
});

test('Chart snapshot loads while a save is still in progress', async ({ page }) => {
    let release!: () => void,
        snapshotRequests = 0;
    const wait = new Promise<void>(resolve => {
        release = resolve;
    });
    page.on('request', request => {
        if (
            request.method() === 'GET' &&
            /^\/api\/runs\/[^/]+\/snapshot$/.test(new URL(request.url()).pathname)
        )
            snapshotRequests++;
    });
    await page.route(
        url => url.pathname === '/api/documents' || /^\/api\/documents\/[^/]+$/.test(url.pathname),
        async route => {
            if (['POST', 'PUT'].includes(route.request().method())) await wait;
            await route.continue();
        },
    );
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    try {
        const saveRequest = page.waitForRequest(
            request =>
                request.method() === 'POST' && new URL(request.url()).pathname === '/api/documents',
        );
        await page.getByTestId('save-query').click();
        await saveRequest;
        await results.getByRole('tab', { name: 'Chart', exact: true }).click();
        await expect.poll(() => snapshotRequests).toBe(1);
        await expect(results.locator('.chart-workspace, .chart-table-fallback')).toBeVisible();
    } finally {
        release();
    }
});

function historyRun(): Run {
    return {
        id: 'recent-run',
        queryId: 'recent-query',
        connectionId: 'demo',
        dataSource: 'fixture',
        owner: 'local-owner',
        sql: 'SELECT history_refresh',
        kind: 'query',
        parameters: {},
        limits: { rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4 },
        tags: {},
        status: 'succeeded',
        createdAt: '2026-01-01T00:00:00.000Z',
        elapsedMs: 10,
        rowCount: 1,
        bytes: 8,
        columns: [],
        warnings: [],
        sequence: 1,
        resultState: 'expired',
        requestedBy: 'local-owner',
        executedAs: 'fixture-reader',
        permissionSnapshot: { readonly: true, role: 'owner' },
        retryPolicy: 'never',
    };
}

test('Refreshing run history shows the latest run without executing SQL', async ({ page }) => {
    let refresh = false,
        executions = 0;
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
        )
            executions++;
    });
    await page.route(
        url => url.pathname === '/api/runs' && url.searchParams.has('connectionId'),
        route => route.fulfill({ json: refresh ? [historyRun()] : [] }),
    );
    await trust(page);
    await openWorkspacePanel(page, 'history');
    const pane = page.locator('.inspector-pane');
    await expect(pane.getByText('No runs yet', { exact: true })).toBeVisible();
    refresh = true;
    await pane.getByRole('button', { name: '↻ Refresh', exact: true }).click();
    const historyCard = pane.locator('.history-card');
    await expect(historyCard).toContainText('SELECT history_refresh');
    await historyCard.click();
    await expect(page.locator('.cm-content')).toContainText('SELECT history_refresh');
    expect(executions).toBe(0);
});
