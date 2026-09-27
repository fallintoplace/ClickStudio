import { test, expect, type Page } from '@playwright/test';
import { openBlankSql, openWorkspacePanel, runIdentity, runScript, runButton, trust, trustCurrentConnection, useAdvancedMode } from './helpers.js';

declare global {
    interface Window {
        __nativeParserResult: unknown;
        __parserParseCount?: number;
        __delayNativeParser?: boolean;
        __resolveDelayedNativeParse: () => void;
        __pendingParserFormat?: number;
        __failParserWorker: () => void;
    }
}

async function replaceSql(page: Page, sql: string) {
    const editor = page.locator('.cm-content');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect.poll(async () => (await editor.innerText()).replace(/\s/g, ''))
        .toContain(sql.replace(/\s/g, ''));
}

async function runQuery(page: Page) {
    const runResponse = page.waitForResponse(response => {
        const request = response.request();
        return request.method() === 'POST' && new URL(response.url()).pathname === '/api/runs';
    });
    await runButton(page).click();
    const run = runIdentity(await (await runResponse).json());
    await expect(page.locator('.execution-bar code')).toHaveText(run.queryId);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    return results;
}

function parserWorkerStub(initialStatus: 'ready' | 'unavailable', initialResult: unknown = {}) {
    return `(() => {
        const NativeWorker = window.Worker;
        let attempts = 0;
        window.__nativeParserResult = ${JSON.stringify(initialResult)};
        class FakeParserWorker extends EventTarget {
            constructor() {
                super();
                const status = attempts++ === 0 ? ${JSON.stringify(initialStatus)} : 'ready';
                window.__testParserWorker = this;
                queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { kind: 'status', status, reason: 'Temporary parser failure' } })));
            }
            postMessage(request) {
                if (request.kind === 'parseMany') {
                    window.__parserParseCount = (window.__parserParseCount || 0) + 1;
                    const reply = { id: request.id, kind: 'parseMany', ok: true, results: request.sql.map(() => window.__nativeParserResult) };
                    if (window.__delayNativeParser) window.__resolveDelayedNativeParse = () => this.dispatchEvent(new MessageEvent('message', { data: reply }));
                    else queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: reply })));
                }
                else window.__pendingParserFormat = request.id;
            }
            terminate() {}
        }
        window.Worker = new Proxy(NativeWorker, {
            construct(target, args, newTarget) {
                if (String(args[0]).includes('clickhouse-native-parser.worker')) return new FakeParserWorker();
                return Reflect.construct(target, args, newTarget);
            },
        });
        window.__failParserWorker = () => window.__testParserWorker.dispatchEvent(new ErrorEvent('error', { message: 'Temporary parser failure' }));
    })();`;
}

test('Run evidence stays with its draft through tab and mode switches', async ({ page }) => {
    let runRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runRequests++;
    });
    await trust(page);
    await useAdvancedMode(page);
    const results = await runQuery(page);
    const firstQueryId = await page.locator('.execution-bar code').innerText();

    await openBlankSql(page);
    const secondResults = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(secondResults.getByRole('table', { name: 'Retained query rows' })).toHaveCount(0);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    await expect(page.locator('.execution-bar code')).toHaveCount(0);

    await runQuery(page);
    const secondQueryId = await page.locator('.execution-bar code').innerText();
    expect(secondQueryId).not.toBe(firstQueryId);

    await page.getByRole('tab').filter({ hasText: 'Getting started.sql' }).click();
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(page.locator('.execution-bar code')).toHaveText(firstQueryId);
    await page.getByText('Standard', { exact: true }).click();
    await expect(page.locator('.execution-bar code')).toHaveText(firstQueryId);
    await page.getByText('Experimental', { exact: true }).click();
    await expect(page.locator('.execution-bar code')).toHaveText(firstQueryId);
    await expect(page.getByRole('group', { name: 'Workspace layouts' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Workspace browser' })).toBeVisible();
    expect(runRequests).toBe(2);
});

test('Run button submits the live CodeMirror document before React catches up', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    const sql = 'SELECT 42 AS button_snapshot';
    await replaceSql(page, 'SELECT 1 AS previous_draft');

    const submitted = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs');
    await page.locator('.cm-content').evaluate((element, currentSql) => {
        const content = element as HTMLElement;
        content.focus();
        document.execCommand('selectAll');
        if (!document.execCommand('insertText', false, currentSql))
            throw new Error('Could not update the CodeMirror document synchronously.');
        content.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true,
        }));
        const runButton = document.querySelector<HTMLButtonElement>('[data-testid="run-button"]');
        if (!runButton) throw new Error('Run button is missing.');
        runButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, sql);
    const request = await submitted;
    expect((request.postDataJSON() as { sql: string }).sql).toBe(sql);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
});

test('Two Run button clicks in one task submit only one request', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    await replaceSql(page, 'SELECT 42 AS single_submission');

    let runRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runRequests++;
    });
    await page.evaluate(() => {
        const runButton = document.querySelector<HTMLButtonElement>('[data-testid="run-button"]');
        if (!runButton) throw new Error('Run button is missing.');
        const click = () => runButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        click();
        click();
    });
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(runRequests).toBe(1);
});

test('SQL editor keyboard commands do not execute statements or scripts', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    await replaceSql(page, 'SELECT 42 AS button_only');

    let runRequests = 0, scriptRequests = 0;
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && path === '/api/runs') runRequests++;
        if (request.method() === 'POST' && path === '/api/scripts') scriptRequests++;
    });
    await page.locator('.cm-content').evaluate(element => {
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
        for (const shiftKey of [false, true])
            element.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
                metaKey: isMac, ctrlKey: !isMac, shiftKey,
            }));
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(runRequests).toBe(0);
    expect(scriptRequests).toBe(0);
});

test('SQL tabs rename by double-click without an F2 command', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    const tab = page.getByRole('tab', { name: 'Getting started.sql', exact: true });
    await tab.focus();
    await page.keyboard.press('F2');
    await expect(page.getByRole('textbox', { name: 'Rename Getting started.sql', exact: true })).toHaveCount(0);
    await tab.getByText('Getting started.sql', { exact: true }).dblclick();
    await expect(page.getByRole('textbox', { name: 'Rename Getting started.sql', exact: true })).toBeVisible();
});

test('A running query shows its submitted SQL and keeps previous rows until it ends', async ({ page }) => {
    await trust(page);
    await page.getByRole('textbox', { name: 'SQL document name', exact: true }).fill('Running query.sql');
    const previousRun = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
    await runButton(page).click();
    await previousRun;

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const table = results.getByRole('table', { name: 'Retained query rows' });
    await expect(table).toContainText('2026-01-01');
    await expect(results.locator('.result-execution-progress')).toHaveCount(0);

    let releaseRun: () => void = () => {};
    const runGate = new Promise<void>(resolve => { releaseRun = resolve; });
    let notifyRunRequest: () => void = () => {};
    const runRequest = new Promise<void>(resolve => { notifyRunRequest = resolve; });
    const runRoute = (url: URL) => url.pathname === '/api/runs';
    await page.route(runRoute, async route => {
        if (route.request().method() === 'POST') {
            notifyRunRequest();
            await runGate;
        }
        await route.continue();
    });
    try {
        const submittedSql = 'SELECT fixture_slow';
        await replaceSql(page, submittedSql);
        await runButton(page).click();
        await runRequest;

        const progress = results.locator('.result-execution-progress');
        await expect(progress).toBeVisible();
        await expect(progress).toContainText(submittedSql);
        await expect(progress.locator('.loading-orbit')).toBeVisible();
        await expect(progress).toContainText('Previous result');
        await expect(table).toContainText('2026-01-01');
        await expect(results.locator('.table-pagination')).toHaveCount(0);

        await replaceSql(page, "SELECT 'edited after submit' AS value");
        await expect(progress).toContainText(submittedSql);
        await expect(progress).not.toContainText('edited after submit');

        await openBlankSql(page);
        await expect(page.locator('.result-execution-progress')).toHaveCount(0);
        await page.getByRole('tab', { name: 'Running query.sql', exact: true }).click();
        await expect(progress).toBeVisible();

        const startedRun = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
        releaseRun();
        const run = runIdentity(await (await startedRun).json());
        const cancel = page.locator('.execution-bar').getByRole('button', { name: 'Cancel', exact: true });
        await expect(cancel).toBeVisible();
        await expect(progress).toBeVisible();
        await expect(table).toContainText('2026-01-01');

        const cancelled = page.waitForResponse(response => new URL(response.url()).pathname === `/api/runs/${run.id}/cancel`);
        await cancel.click();
        await cancelled;
        await expect(progress).toHaveCount(0);
    } finally {
        releaseRun();
        await page.unroute(runRoute);
    }
});

test('The execution indicator clears when run submission fails', async ({ page }) => {
    await trust(page);
    let releaseFailure: () => void = () => {};
    const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
    let notifyRunRequest: () => void = () => {};
    const runRequest = new Promise<void>(resolve => { notifyRunRequest = resolve; });
    const runRoute = (url: URL) => url.pathname === '/api/runs';
    await page.route(runRoute, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        notifyRunRequest();
        await failureGate;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary run failure' }) });
    });
    try {
        const submittedSql = 'SELECT fixture_submit_failure';
        await replaceSql(page, submittedSql);
        await runButton(page).click();
        await runRequest;
        const progress = page.locator('.result-execution-progress');
        await expect(progress).toBeVisible();
        await expect(progress).toContainText(submittedSql);

        releaseFailure();
        await expect(progress).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Query results', exact: true }).getByTestId('query-failure')).toContainText('NETWORK_RESPONSE');
    } finally {
        releaseFailure();
        await page.unroute(runRoute);
    }
});

test('A failed query stays in Results beside the previous success until retry', async ({ page }) => {
    await trust(page);
    const results = await runQuery(page);
    const failedTab = page.getByRole('tab').filter({ hasText: 'Getting started.sql' });
    let failNextRun = true;
    const runRoute = (url: URL) => url.pathname === '/api/runs';
    await page.route(runRoute, async route => {
        if (route.request().method() === 'POST' && failNextRun) {
            failNextRun = false;
            await route.fulfill({ status: 400, json: { error: { code: 'SYNTAX_ERROR', message: 'Syntax error at position 15', position: 15 } } });
            return;
        }
        await route.continue();
    });

    try {
        const submittedSql = 'SELECT * FROM missing_table';
        await replaceSql(page, submittedSql);
        const failedResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
        await runButton(page).click();
        await failedResponse;

        const failure = results.getByTestId('query-failure');
        await expect(failure).toContainText('SYNTAX_ERROR');
        await expect(failure).toContainText('Syntax error at position 15');
        await expect(failure.locator('pre.result-execution-sql')).toHaveText(submittedSql);
        await expect(results.locator('.result-provenance-header')).toContainText('Previous result');
        await expect(results.locator('.result-provenance-header')).toContainText('Latest attempt failed');
        await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'failed');
        await expect(page.locator('.execution-bar code')).toHaveCount(0);

        await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
        await expect(failure).toBeVisible();

        await openBlankSql(page);
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
        await expect(page.getByTestId('query-failure')).toHaveCount(0);
        await failedTab.click();
        await expect(failure).toBeVisible();

        await replaceSql(page, 'SELECT 1');
        const retryResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
        await runButton(page).click();
        await retryResponse;
        await expect(failure).toHaveCount(0);
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
        await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    } finally {
        await page.unroute(runRoute);
    }
});

test('A failed saved run shows its error in Results', async ({ page }) => {
    await trust(page);
    let failedRun: Record<string, unknown> | undefined;
    const runRoute = (url: URL) => url.pathname === '/api/runs';
    const runDetailRoute = (url: URL) => /^\/api\/runs\/[^/]+$/.test(url.pathname);
    await page.route(runDetailRoute, async route => {
        if (route.request().method() === 'GET' && failedRun) return route.fulfill({ json: failedRun });
        await route.continue();
    });
    await page.route(runRoute, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const response = await route.fetch();
        const run = await response.json() as Record<string, unknown>;
        failedRun = { ...run, status: 'failed', resultState: 'unavailable', error: { code: 'SYNTAX_ERROR', message: 'Syntax error at position 15' } };
        await route.fulfill({ response, json: failedRun });
    });

    try {
        await replaceSql(page, 'SELECT * FROM missing_table');
        const submitted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
        await runButton(page).click();
        await submitted;

        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await expect(results.getByTestId('query-failure')).toContainText('SYNTAX_ERROR');
        await expect(results.getByTestId('query-failure')).toContainText('Syntax error at position 15');
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'failed');
    } finally {
        await page.unroute(runRoute);
        await page.unroute(runDetailRoute);
    }
});

test('Run Script shows the full submitted script while submission is pending', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    const submittedSql = `SELECT '${'x'.repeat(300)}';\nSELECT 2;`;
    await replaceSql(page, submittedSql);

    let releaseScript: () => void = () => {};
    const scriptGate = new Promise<void>(resolve => { releaseScript = resolve; });
    let notifyScriptRequest: () => void = () => {};
    const scriptRequest = new Promise<void>(resolve => { notifyScriptRequest = resolve; });
    const scriptRoute = (url: URL) => url.pathname === '/api/scripts';
    await page.route(scriptRoute, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        notifyScriptRequest();
        await scriptGate;
        await route.continue();
    });
    try {
        await runScript(page);
        await scriptRequest;
        const progress = page.locator('.result-execution-progress');
        await expect(progress).toBeVisible();
        await expect(progress.locator('pre.result-execution-sql:not(.is-full)')).not.toContainText('SELECT 2;');
        const fullSql = progress.locator('details');
        await expect(fullSql).toHaveCount(1);
        await fullSql.locator('summary').click();
        await expect(fullSql.locator('pre')).toHaveText(submittedSql);

        const startedScript = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/scripts');
        releaseScript();
        await startedScript;
    } finally {
        releaseScript();
        await page.unroute(scriptRoute);
    }
});

test('Query and result panels collapse to their headings', async ({ page }) => {
    await page.setViewportSize({ width: 1905, height: 1280 });
    await trust(page);
    const results = await runQuery(page);
    await page.getByText('Standard', { exact: true }).click();
    const queryPanel = page.locator('.editor-surface');
    const resultsPanel = results;

    await page.locator('button[aria-controls="sql-editor-content"]').click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();
    await expect.poll(async () => (await queryPanel.boundingBox())?.height ?? 0).toBeLessThan(80);
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();

    await page.locator('button[aria-controls="query-results-content"]').click();
    await expect(page.locator('#query-results-content')).toBeHidden();
    await expect.poll(async () => (await resultsPanel.boundingBox())?.height ?? 0).toBeLessThan(80);

    await page.locator('button[aria-controls="sql-editor-content"]').click();
    await expect(page.locator('#sql-editor-content')).toBeVisible();
    await page.locator('button[aria-controls="query-results-content"]').click();
    await expect(page.locator('#query-results-content')).toBeVisible();
});


test('Desktop workspace panels float, resize, maximize, and dock without losing content', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await trust(page);
    const results = await runQuery(page);
    const queryPanel = page.locator('.editor-surface');
    const editor = page.locator('#sql-editor-content .cm-content');

    const queryFloat = page.getByRole('button', { name: 'Float query panel', exact: true });
    const queryFloatBox = await queryFloat.boundingBox();
    expect(queryFloatBox).not.toBeNull();
    expect(queryFloatBox!.width).toBeGreaterThanOrEqual(34);
    expect(queryFloatBox!.height).toBeGreaterThanOrEqual(34);
    await queryFloat.click();
    await expect(queryPanel).toHaveClass(/is-floating/);
    await expect(editor).toContainText('SELECT');

    const beforeDrag = await queryPanel.boundingBox();
    const dragTarget = await queryPanel.locator('.file-type-icon').boundingBox();
    expect(beforeDrag).not.toBeNull();
    expect(dragTarget).not.toBeNull();
    await page.mouse.move(dragTarget!.x + dragTarget!.width / 2, dragTarget!.y + dragTarget!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragTarget!.x + 150, dragTarget!.y + 90, { steps: 5 });
    await page.mouse.up();
    const afterDrag = await queryPanel.boundingBox();
    expect(afterDrag).not.toBeNull();
    expect(afterDrag!.x).toBeGreaterThan(beforeDrag!.x + 60);
    expect(afterDrag!.y).toBeGreaterThan(beforeDrag!.y + 30);

    const resizeHandle = await queryPanel.locator('.workspace-panel-resize-handle.edge-se').boundingBox();
    expect(resizeHandle).not.toBeNull();
    await page.mouse.move(resizeHandle!.x + resizeHandle!.width / 2, resizeHandle!.y + resizeHandle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeHandle!.x + 120, resizeHandle!.y + 80, { steps: 5 });
    await page.mouse.up();
    const afterResize = await queryPanel.boundingBox();
    expect(afterResize).not.toBeNull();
    expect(afterResize!.width).toBeGreaterThan(afterDrag!.width + 70);
    expect(afterResize!.height).toBeGreaterThan(afterDrag!.height + 40);

    await page.getByRole('button', { name: 'Maximize query panel', exact: true }).click();
    const maximized = await queryPanel.boundingBox();
    expect(maximized).not.toBeNull();
    expect(maximized!.width).toBeGreaterThan(1360);
    expect(maximized!.height).toBeGreaterThan(960);

    await page.getByRole('button', { name: 'Restore query panel', exact: true }).click();
    await page.getByRole('button', { name: 'Dock query panel', exact: true }).click();
    await expect(queryPanel).not.toHaveClass(/is-floating/);
    await expect(editor).toContainText('SELECT');

    await page.getByRole('button', { name: 'Float output panel', exact: true }).click();
    await expect(results).toHaveClass(/is-floating/);
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await page.getByRole('button', { name: 'Dock output panel', exact: true }).click();
    await expect(results).not.toHaveClass(/is-floating/);
});

test('Desktop docked query and output panels resize with the splitter', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await trust(page);
    const results = await runQuery(page);
    const queryPanel = page.locator('.editor-surface');
    const splitter = page.getByRole('separator', { name: 'Resize query and output panels', exact: true });
    await expect(splitter).toBeVisible();

    const queryBefore = await queryPanel.boundingBox();
    const resultsBefore = await results.boundingBox();
    const splitBox = await splitter.boundingBox();
    expect(queryBefore).not.toBeNull();
    expect(resultsBefore).not.toBeNull();
    expect(splitBox).not.toBeNull();
    expect(Math.abs(splitBox!.y - (queryBefore!.y + queryBefore!.height))).toBeLessThanOrEqual(2);
    expect(Math.abs(resultsBefore!.y - (splitBox!.y + splitBox!.height))).toBeLessThanOrEqual(2);

    await page.mouse.move(splitBox!.x + splitBox!.width / 2, splitBox!.y + splitBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(splitBox!.x + splitBox!.width / 2, splitBox!.y + 100, { steps: 5 });
    await page.mouse.up();

    const queryAfter = await queryPanel.boundingBox();
    const resultsAfter = await results.boundingBox();
    const splitAfter = await splitter.boundingBox();
    expect(queryAfter).not.toBeNull();
    expect(resultsAfter).not.toBeNull();
    expect(splitAfter).not.toBeNull();
    expect(queryAfter!.height).toBeGreaterThan(queryBefore!.height + 45);
    expect(resultsAfter!.height).toBeLessThan(resultsBefore!.height - 45);
    expect(Math.abs(splitAfter!.y - (queryAfter!.y + queryAfter!.height))).toBeLessThanOrEqual(2);
    expect(Math.abs(resultsAfter!.y - (splitAfter!.y + splitAfter!.height))).toBeLessThanOrEqual(2);
});

test('Native parser can be retried after a temporary worker failure', async ({ page }) => {
    await page.addInitScript(parserWorkerStub('unavailable'));
    await trust(page);
    const retry = page.getByRole('button', { name: 'Retry parser', exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('Ready · local WebAssembly', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Number(window.__parserParseCount ?? 0))).toBeGreaterThan(0);
});

test('Experimental parser inspector shows native AST, UTF-8 semantic highlights, and expected tokens', async ({ page }) => {
    const sql = "SELECT '🙂', uniqExact(user_id) FROM events";
    const functionPrefix = "SELECT '🙂', ";
    const parserResponse = {
        ast: { type: 'SelectWithUnionQuery', children: [{ type: 'SelectQuery' }] },
        highlights: [
            { begin: new TextEncoder().encode(functionPrefix).length, end: new TextEncoder().encode(functionPrefix + 'uniqExact').length, type: 'function' },
            { begin: new TextEncoder().encode(functionPrefix + 'uniqExact(').length, end: new TextEncoder().encode(functionPrefix + 'uniqExact(user_id').length, type: 'identifier' },
        ],
    };
    await page.addInitScript(parserWorkerStub('ready', parserResponse));
    await page.goto('/');
    await replaceSql(page, sql);
    await expect(page.locator('.cm-native-function')).toHaveText('uniqExact');

    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('SelectWithUnionQuery', { exact: true })).toBeVisible();
    await page.getByText('View native AST', { exact: true }).click();
    await expect(page.getByText(/"type": "SelectWithUnionQuery"/)).toBeVisible();

    const invalidSql = 'SELECT 1 +';
    await page.evaluate(() => {
        window.__nativeParserResult = {
            error: { message: 'Syntax error', begin: 10, end: 10, expected: ['FROM', 'WHERE', 'GROUP BY'] },
        };
    });
    await replaceSql(page, invalidSql);
    await expect(page.getByText('Syntax error', { exact: true })).toBeVisible();
    await expect(page.getByText('GROUP BY', { exact: true })).toBeVisible();
});

test('SQL structure switches from logical flow to native AST', async ({ page }) => {
    const parserResponse = {
        ast: {
            type: 'SelectWithUnionQuery',
            union_mode: 'UNION_DEFAULT',
            list_of_selects: {
                type: 'ExpressionList',
                children: [{
                    type: 'SelectQuery',
                    select: {
                        type: 'ExpressionList',
                        children: [{
                            type: 'Function',
                            name: 'uniqExact',
                            arguments: { type: 'ExpressionList', children: [{ type: 'Identifier', name: 'user_id' }] },
                        }],
                    },
                    tables: {
                        type: 'TablesInSelectQuery',
                        children: [{ type: 'TableIdentifier', name_parts: ['analytics', 'events'] }],
                    },
                }],
            },
        },
        highlights: [],
    };
    await page.addInitScript(parserWorkerStub('ready', parserResponse));
    await page.goto('/');
    await replaceSql(page, 'SELECT uniqExact(user_id) FROM analytics.events');

    await page.getByRole('button', { name: 'Visualize SQL structure', exact: true }).click();
    const structure = page.locator('.sql-flow-view');
    const flow = structure.getByRole('button', { name: 'Logical flow', exact: true });
    const nativeAst = structure.getByRole('button', { name: 'Native AST', exact: true });
    await expect(flow).toHaveAttribute('aria-pressed', 'true');
    await expect(nativeAst).toBeEnabled();
    await expect(structure.locator('.sql-flow-heading p')).toHaveText('Click a stage to jump to its SQL.');
    await expect(structure.locator('.sql-flow-heading')).not.toContainText('not a server execution plan');
    const headingHeight = await structure.locator('.sql-flow-heading').evaluate(element => element.getBoundingClientRect().height);
    expect(headingHeight).toBeLessThan(64);

    await nativeAst.click();
    await expect(nativeAst).toHaveAttribute('aria-pressed', 'true');
    await expect(structure.locator('.sql-flow-heading p')).toHaveText('Select a node to inspect its parser fields.');
    await expect(structure.locator('.sql-flow-heading')).not.toContainText('server execution plan');
    await expect(structure.locator('[data-ast-node-type="SelectWithUnionQuery"]')).toBeVisible();
    const selectList = structure.locator('[data-ast-node-path="$.list_of_selects.children[0].select"]');
    await expect(selectList).toBeVisible();
    await selectList.dblclick();

    const fn = structure.locator('[data-ast-node-type="Function"]');
    await expect(fn).toBeVisible();
    await fn.click();
    await expect(structure.locator('.ast-node-inspector')).toContainText('uniqExact');
});

test('SQL structure loads the server analyzer tree', async ({ page }) => {
    await page.goto('/');
    await replaceSql(page, 'SELECT event_type, count() AS events FROM demo.events GROUP BY event_type');
    await page.getByRole('button', { name: 'Visualize SQL structure', exact: true }).click();
    const structure = page.locator('.sql-flow-view');
    const analyzer = structure.getByRole('button', { name: 'Analyzer', exact: true });
    await expect(analyzer).toBeEnabled();
    await analyzer.click();
    await expect(analyzer).toHaveAttribute('aria-pressed', 'true');
    await expect(structure.locator('.sql-flow-heading p')).toHaveText('Select a node to inspect resolved analyzer fields.');
    await expect(structure.locator('[data-query-tree-type="QUERY"]')).toBeVisible();
    const table = structure.locator('[data-query-tree-type="TABLE"]');
    await expect(table).toContainText('demo.events');
    await table.click();
    await expect(structure.locator('.query-tree-node-inspector')).toContainText('demo.events');
});

test('A delayed native parse cannot replace parser details for newer SQL', async ({ page }) => {
    const oldSql = 'SELECT old_fn()';
    const newSql = 'SELECT new_fn()';
    const oldResult = { ast: { type: 'OldStatement' }, highlights: [{ begin: 7, end: 13, type: 'function' }] };
    await page.addInitScript(parserWorkerStub('ready', oldResult));
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => Number(window.__parserParseCount ?? 0))).toBeGreaterThan(0);

    await page.evaluate(() => { window.__delayNativeParser = true; });
    await replaceSql(page, oldSql);
    await expect.poll(() => page.evaluate(() => Boolean(window.__resolveDelayedNativeParse))).toBe(true);
    await page.evaluate(() => {
        window.__nativeParserResult = {
            ast: { type: 'NewStatement' },
            highlights: [{ begin: 7, end: 13, type: 'function' }],
        };
        window.__delayNativeParser = false;
    });
    await replaceSql(page, newSql);
    await expect(page.locator('.cm-native-function')).toHaveText('new_fn');
    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('NewStatement', { exact: true })).toBeVisible();

    await page.evaluate(() => window.__resolveDelayedNativeParse());
    await expect(page.getByText('NewStatement', { exact: true })).toBeVisible();
    await expect(page.getByText('OldStatement', { exact: true })).toHaveCount(0);
});

test('Failed async formatting does not overwrite edits typed while it was pending', async ({ page }) => {
    await page.addInitScript(parserWorkerStub('ready'));
    await trust(page);
    await replaceSql(page, 'select old_value from old_table');
    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('Ready · local WebAssembly', { exact: true })).toBeVisible();
    await page.getByRole('group', { name: 'Format SQL' }).getByRole('button', { name: 'WASM', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__pendingParserFormat))).toBe(true);
    await replaceSql(page, 'select new_value from new_table');
    await page.evaluate(() => window.__failParserWorker());
    await expect(page.locator('.cm-content')).toContainText('new_value');
    await expect(page.locator('.cm-content')).not.toContainText('old_value');
});

test('Connection switches keep run evidence isolated and recover each connection workspace', async ({ page }) => {
    await trust(page);
    await runQuery(page);
    const firstQueryId = await page.locator('.execution-bar code').innerText();

    const picker = page.locator('.connection-trigger');
    await picker.click();
    await page.getByRole('dialog', { name: 'Connection details' }).getByRole('button', { name: /Another sample/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('connection')).toBe('demo-second');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    await expect(page.locator('.execution-bar code')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Query results', exact: true }).getByRole('table', { name: 'Retained query rows' })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.connection-trigger')).toContainText('Another sample');
    await trustCurrentConnection(page);
    await runQuery(page);
    const secondQueryId = await page.locator('.execution-bar code').innerText();
    expect(secondQueryId).not.toBe(firstQueryId);

    await picker.click();
    await page.getByRole('dialog', { name: 'Connection details' }).getByRole('button', { name: /Sample data/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('connection')).toBe('demo');
    await expect(page.locator('.execution-bar code')).toHaveText(firstQueryId);
});

test('Insights compare one run with its ClickHouse pipeline evidence', async ({ page }) => {
    await trust(page);
    const startedRunResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
    const results = await runQuery(page);
    const startedRun = runIdentity(await (await startedRunResponse).json());
    const queryPlan = page.getByRole('region', { name: 'Run and query plan comparison' });

    await results.getByRole('tab', { name: 'Insights', exact: true }).click();
    await expect(queryPlan).toContainText(startedRun.queryId);
    const pipelineRequest = page.waitForRequest(request => new URL(request.url()).pathname === `/api/runs/${startedRun.id}/profile/pipeline`);
    await queryPlan.getByRole('button', { name: 'Load ClickHouse pipeline', exact: true }).click();
    await pipelineRequest;
    await expect(queryPlan).toContainText('EXPLAIN PIPELINE');
    await expect(queryPlan).toContainText('ReadFromFixture');
    const graph = queryPlan.getByRole('region', { name: 'Scrollable operator graph' });
    await expect(graph.locator('[data-node-id]').filter({ hasText: 'Resize 2 → 1' })).toBeVisible();
    await graph.locator('[data-node-id]').filter({ hasText: 'Resize 2 → 1' }).click();
    await expect(queryPlan.locator('.pipeline-node-inspector')).toContainText('Resize 2 → 1');
    await expect(page.locator('.execution-bar code')).toHaveText(startedRun.queryId);
});

test('Refreshing a pipeline selects the first operator in the new graph', async ({ page }) => {
    let refreshCount = 0;
    await page.route(url => url.pathname.endsWith('/profile/pipeline'), async route => {
        refreshCount++;
        const label = refreshCount === 1 ? 'First' : 'Next';
        await route.fulfill({ json: {
            available: true, source: 'explain_pipeline', notice: 'Fixture pipeline',
            nodes: [
                { id: 'source', label: `${label} reader`, kind: 'read', status: 'planned' },
                { id: 'output', label: `${label} output`, kind: 'output', status: 'planned' },
            ],
            edges: [{ source: 'source', target: 'output' }],
        } });
    });
    await trust(page);
    await useAdvancedMode(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Insights', exact: true }).click();
    const section = page.getByRole('region', { name: 'Run and query plan comparison' });
    const load = section.getByRole('button', { name: 'Load ClickHouse pipeline', exact: true });
    await expect(load).toBeEnabled();
    const firstLoad = page.waitForResponse(response => response.url().includes('/profile/pipeline'));
    await load.click();
    await firstLoad;
    const graph = section.getByRole('region', { name: 'Scrollable operator graph' });
    await graph.locator('[data-node-id="output"]').click();
    await expect(section.locator('.pipeline-node-inspector')).toContainText('First output');

    const refresh = section.getByRole('button', { name: 'Refresh pipeline', exact: true });
    const refreshed = page.waitForResponse(response => response.url().includes('/profile/pipeline'));
    await refresh.click();
    await refreshed;
    await expect(section.locator('.pipeline-node-inspector')).toContainText('Next reader');
    await expect(graph.locator('[data-node-id="source"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(graph.locator('[data-node-id="output"]')).toHaveAttribute('aria-pressed', 'false');
});

test('Result filtering searches only the visible retained page without mutating the run', async ({ page }) => {
    await trust(page);
    const results = await runQuery(page);
    const queryId = await page.locator('.execution-bar code').innerText();
    const rows = results.locator('tbody tr');
    const filter = results.getByRole('searchbox', { name: 'Filter current page' });
    await expect(rows).toHaveCount(7);

    await filter.fill('2026-01-02');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('2026-01-02');
    await expect(results).toContainText('1 matches on this page');
    await filter.fill('no matching value');
    await expect(rows).toHaveCount(0);
    await expect(results).toContainText('No rows match on this page.');
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
});

test('SQL and parameter edits label old results without changing their run evidence', async ({ page }) => {
    let runRequests = 0;
    let submittedSql = '';
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') {
            runRequests++;
            submittedSql = (request.postDataJSON() as { sql: string }).sql;
        }
    });
    await trust(page);
    await useAdvancedMode(page);
    const results = await runQuery(page);
    const queryId = await page.locator('.execution-bar code').innerText();

    await replaceSql(page, 'SELECT 42');
    await expect(results.locator('.result-provenance')).toContainText('Result from previous execution');
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
    await replaceSql(page, submittedSql);
    await expect(results.locator('.result-provenance')).toHaveCount(0);

    await replaceSql(page, 'SELECT {threshold:UInt64}');
    await page.getByRole('textbox', { name: 'threshold:UInt64', exact: true }).fill('9007199254740993');
    await runQuery(page);
    const parameterRunId = await page.locator('.execution-bar code').innerText();
    await page.getByRole('textbox', { name: 'threshold:UInt64', exact: true }).fill('9007199254740994');
    await expect(results.locator('.result-provenance')).toContainText('bound parameters changed');
    await expect(page.locator('.execution-bar code')).toHaveText(parameterRunId);
    expect(runRequests).toBe(2);
});

test('Charts keep NULL missing and plot nullable negative values from zero', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: {
            ...result,
            columns: [{ name: 'label', type: 'String' }, { name: 'value', type: 'Nullable(Int64)' }],
            rows: [['negative', -6], ['missing', null], ['positive', 4]],
            totalRows: 3,
        } });
    });
    await trust(page);
    await useAdvancedMode(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-canvas svg[role="img"]')).toBeVisible();
    const measure = results.getByRole('group', { name: 'Measures' }).getByLabel('value');
    await expect(measure).toBeChecked();
    await expect(results.locator('.chart-footer')).toContainText('3 retained rows across 1 measure');
    const bars = results.locator('.chart-bar');
    await expect(bars).toHaveCount(2);
    expect(Number(await bars.nth(0).getAttribute('y'))).toBeCloseTo(100, 0);
    expect(Number(await bars.nth(1).getAttribute('y'))).toBeCloseTo(40, 0);
    await expect(results.locator('.chart-zero-line')).toHaveAttribute('y1', '100');
});

test('Charts sample the full retained range and report the sampled row count', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: {
            ...result,
            columns: [{ name: 'label', type: 'String' }, { name: 'value', type: 'Int64' }],
            rows: Array.from({ length: 350 }, (_, index) => [`row-${index + 1}`, index === 349 ? 1000000 : 1]),
            completeness: 'complete',
        } });
    });
    await trust(page);
    await useAdvancedMode(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-bar')).toHaveCount(240);
    await expect(results.locator('.chart-footer')).toContainText('240 sampled rows from 350 retained rows');
    await expect(results.locator('.chart-x-labels text').last()).toHaveText('row-350');
    expect(Number(await results.locator('.chart-bar').last().getAttribute('y'))).toBeCloseTo(40, 0);
});

test('Single-row numeric results render as a number and expose supported chart types', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: {
            ...result,
            columns: [{ name: 'event_count', type: 'UInt64' }],
            rows: [['42']],
            completeness: 'complete',
        } });
    });
    await trust(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-number-card')).toContainText('42');
    await expect(results.getByLabel('Type').locator('option')).toHaveText(['Number', 'Line', 'Bar', 'Scatter', 'Heatmap', 'Candlestick']);
});

test('Scatter charts plot the selected numeric axes', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: {
            ...result,
            columns: [{ name: 'distance', type: 'Float64' }, { name: 'fare', type: 'Float64' }],
            rows: [[1.2, 8.5], [2.4, 12], [5.1, 19.75]],
            completeness: 'complete',
        } });
    });
    await trust(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await results.getByLabel('Type').selectOption('scatter');
    await expect(results.locator('.chart-canvas svg[role="img"]')).toHaveAttribute('aria-label', /scatter chart/);
    await expect(results.locator('.chart-point')).toHaveCount(3);
    await expect(results.getByLabel('X measure').locator('option:enabled')).toHaveCount(1);
    await expect(results.locator('.chart-footer')).toContainText('3 plotted points');
});

test('Heatmaps retain observed groups and leave missing cells blank', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({ response, json: {
            ...result,
            columns: [{ name: 'weekday', type: 'String' }, { name: 'hour', type: 'DateTime' }, { name: 'trips', type: 'UInt64' }],
            rows: [['Mon', '2026-09-21 00:00:00', 5], ['Mon', '2026-09-21 01:00:00', 8], ['Tue', '2026-09-21 00:00:00', 3]],
            completeness: 'complete',
        } });
    });
    await trust(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await results.getByLabel('Type').selectOption('heatmap');
    await expect(results.locator('.heatmap-grid')).toBeVisible();
    await expect(results.locator('.heatmap-cell[aria-label="Tue, 2026-09-21 01:00:00: no returned row"]')).toBeVisible();
    await expect(results.locator('.heatmap-caption')).toContainText('blank cells had no returned group');
});

test('A delayed chart snapshot cannot update the draft after selecting another script result', async ({ page }) => {
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>(resolve => { releaseSnapshot = resolve; });
    let notifySnapshotStarted!: () => void;
    const snapshotStarted = new Promise<void>(resolve => { notifySnapshotStarted = resolve; });
    let notifySnapshotFinished!: () => void;
    const snapshotFinished = new Promise<void>(resolve => { notifySnapshotFinished = resolve; });
    let savePayload: Record<string, unknown> | undefined;
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        notifySnapshotStarted();
        await snapshotGate;
        await route.fulfill({ response, json: { ...result, columns: [{ name: 'value', type: 'UInt64' }], rows: [['42']], completeness: 'complete' } });
        notifySnapshotFinished();
    });
    await page.route(url => url.pathname === '/api/documents', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        savePayload = route.request().postDataJSON() as Record<string, unknown>;
        await route.continue();
    });
    try {
        await trust(page);
        await useAdvancedMode(page);
        await replaceSql(page, 'SELECT 1; SELECT 2;');
        await runScript(page);
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        const first = results.getByRole('button', { name: 'Statement 1: succeeded', exact: true });
        const second = results.getByRole('button', { name: 'Statement 2: succeeded', exact: true });
        await expect(first).toBeVisible();
        await expect(second).toBeVisible();
        await first.click();
        await results.getByRole('tab', { name: 'Chart', exact: true }).click();
        await snapshotStarted;
        await results.getByRole('tab', { name: 'Results', exact: true }).click();
        await second.click();
        await expect(second).toHaveAttribute('aria-pressed', 'true');
        releaseSnapshot();
        await snapshotFinished;
        await page.getByTestId('save-query').click();
        await expect.poll(() => savePayload).toBeDefined();
        expect((savePayload?.chart as { kind: string }).kind).toBe('table');
    } finally {
        releaseSnapshot();
    }
});

test('Refreshing run history replaces the visible list with the latest response', async ({ page }) => {
    let refreshed = false;
    const run = {
        id: 'history-refresh-run', status: 'succeeded', sql: 'SELECT refreshed_history_entry',
        createdAt: '2026-09-23T00:00:00.000Z', elapsedMs: 12, rowCount: 7,
    };
    await page.route(/\/api\/runs\?connectionId=demo$/, route => route.fulfill({ json: refreshed ? [run] : [] }));
    await trust(page);
    await openWorkspacePanel(page, 'history');
    await expect(page.getByText('No runs yet')).toBeVisible();
    refreshed = true;
    await page.getByRole('button', { name: /Refresh/ }).click();
    await expect(page.getByText('SELECT refreshed_history_entry')).toBeVisible();
});

test('Ask AI keeps chat history when SQL changes and sends prior messages with follow-ups', async ({ page }) => {
    const requests: Array<Record<string, unknown>> = [];
    await page.route('**/api/assistant/sql', async route => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        requests.push(body);
        await route.fulfill({ json: {
            id: `answer-${requests.length}`, owner: 'local-owner', connectionId: 'demo', action: 'ask', createdAt: '2026-09-23T00:00:00.000Z',
            baseSql: String(body.sql ?? ''), responseId: 'test-response', model: 'test-model', promptVersion: 'test', contextSummary: [], decision: 'pending',
            sql: null, summary: `Answer to ${String(body.question ?? '')}`, assumptions: [], tables: [], caveats: [], clarification: null, findings: [],
        } });
    });
    await trust(page);
    await useAdvancedMode(page);
    await runQuery(page);
    await page.getByTestId('open-ai').click();
    const question = page.getByRole('textbox', { name: 'Ask AI', exact: true });
    await question.fill('Show the old question');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toBeVisible();
    await expect(question).toBeInViewport();

    await replaceSql(page, 'SELECT 2');
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toBeVisible();
    await question.fill('And now?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Answer to And now?', { exact: true })).toBeVisible();

    expect(requests[0]?.includeRun).toBe(true);
    expect(requests[0]?.result).toBeTruthy();
    expect(requests[1]?.sql).toBe('SELECT 2');
    const previousTurn = JSON.parse(((requests[1]?.conversation as Array<{ role: string; content: string }>)[0]?.content ?? '{}')) as Record<string, unknown>;
    expect(previousTurn).toMatchObject({
        question: 'Show the old question', sql: requests[0]?.sql, includeRun: true, runId: requests[0]?.runId,
        runContext: { result: requests[0]?.result, evidenceSql: requests[0]?.evidenceSql },
    });
    expect(requests[1]?.conversation).toMatchObject([
        { role: 'user' },
        { role: 'assistant', content: JSON.stringify({ summary: 'Answer to Show the old question', clarification: null, sql: null, assumptions: [], tables: [], caveats: [], findings: [], decision: 'pending' }) },
    ]);

    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(page.locator('.assistant-empty-chat')).toBeVisible();
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toHaveCount(0);
    const chatHistory = page.getByRole('button', { name: 'Chat history: New chat', exact: true });
    await chatHistory.click();
    await page.getByRole('button', { name: 'Show the old question', exact: true }).click();
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toBeVisible();
    await expect(page.getByText('Answer to And now?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Chat history: Show the old question', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for Show the old question', exact: true }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    const conversationName = page.getByRole('textbox', { name: 'New name for Show the old question', exact: true });
    await conversationName.fill('Flight delay analysis');
    await page.getByRole('button', { name: 'Save conversation name', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Chat history: Flight delay analysis', exact: true })).toBeVisible();
    const chatHistoryPanel = page.getByRole('region', { name: 'Chat history', exact: true });
    await chatHistoryPanel.getByRole('button', { name: 'New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Chat history: New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Flight delay analysis', exact: true }).click();
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Conversation: Flight delay analysis' })).toBeVisible();
    await page.getByRole('button', { name: 'Chat history: Flight delay analysis', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for Flight delay analysis', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteConfirmation = page.getByRole('alertdialog', { name: 'Delete this conversation?', exact: true });
    await expect(deleteConfirmation).toBeVisible();
    await deleteConfirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(deleteConfirmation).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Conversation: Flight delay analysis', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(deleteConfirmation).toBeVisible();
    await deleteConfirmation.getByRole('button', { name: 'Delete conversation', exact: true }).click();
    await expect(page.locator('.assistant-empty-chat')).toBeVisible();
});

test('Ask AI shows a stop action while a response is in progress', async ({ page }) => {
    let releaseResponse: (() => void) | undefined;
    let markRequestStarted: (() => void) | undefined;
    const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
    const requestStarted = new Promise<void>(resolve => { markRequestStarted = resolve; });
    await page.route('**/api/assistant/sql', async route => {
        markRequestStarted?.();
        await responseGate;
        await route.fulfill({ json: {} }).catch(() => undefined);
    });

    try {
        await trust(page);
        await useAdvancedMode(page);
        await page.getByTestId('open-ai').click();
        const question = page.getByRole('textbox', { name: 'Ask AI', exact: true });
        await question.fill('Explain this query');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await requestStarted;

        const stop = page.getByRole('button', { name: 'Stop assistant response', exact: true });
        await expect(stop).toBeVisible();
        await stop.click();
        await expect(page.locator('.assistant-turn-error')).toHaveText('Request cancelled.');
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    } finally {
        releaseResponse?.();
    }
});

test('Ask AI keeps a custom conversation name after its first message', async ({ page }) => {
    await page.route('**/api/assistant/sql', async route => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ json: {
            id: 'custom-title-answer', owner: 'local-owner', connectionId: 'demo', action: 'ask', createdAt: '2026-09-23T00:00:00.000Z',
            baseSql: String(body.sql ?? ''), responseId: 'test-response', model: 'test-model', promptVersion: 'test', contextSummary: [], decision: 'pending',
            sql: null, summary: 'Custom title kept', assumptions: [], tables: [], caveats: [], clarification: null, findings: [],
        } });
    });
    await trust(page);
    await useAdvancedMode(page);
    await page.getByTestId('open-ai').click();
    await page.getByRole('button', { name: 'Chat history: New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByRole('textbox', { name: 'New name for New chat', exact: true }).fill('Flight lookup');
    await page.getByRole('button', { name: 'Save conversation name', exact: true }).click();
    await page.getByRole('textbox', { name: 'Ask AI', exact: true }).fill('Find a flight');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Custom title kept', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chat history: Flight lookup', exact: true })).toBeVisible();
});

test('Scripts show each statement outcome and open that statement’s retained result', async ({ page }) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1; SELECT fixture_error; SELECT 3;');
    await runScript(page);

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByLabel('Script statement results')).toContainText('partial');
    const first = results.getByRole('button', { name: 'Statement 1: succeeded', exact: true });
    const second = results.getByRole('button', { name: 'Statement 2: failed', exact: true });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await expect(results.getByRole('button', { name: 'Statement 3: skipped', exact: true })).toBeVisible();

    await first.click();
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(results.locator('.result-provenance')).toHaveCount(0);
    await second.click();
    await expect(results.getByTestId('query-failure')).toContainText('FIXTURE_ERROR');
    await expect(page.locator('.cm-content')).toContainText('SELECT 1; SELECT fixture_error; SELECT 3;');
});

test('Script polling persists every statement run ID, including fast intermediate results', async ({ page }) => {
    await trust(page);
    const sql = 'SELECT 1; SELECT 2; SELECT 3;';
    await replaceSql(page, sql);
    const created = {
        id: 'script-fast', owner: 'local-owner', connectionId: 'demo', sql, createdAt: '2026-09-23T00:00:00.000Z',
        status: 'running', stopOnError: true, cancelled: false,
        statements: [
            { sql: 'SELECT 1', from: 0, to: 8, runId: 'run-a', status: 'succeeded' },
            { sql: 'SELECT 2', from: 10, to: 18, status: 'pending' },
            { sql: 'SELECT 3', from: 20, to: 28, status: 'pending' },
        ],
    };
    const completed = {
        ...created,
        status: 'succeeded',
        statements: [
            { sql: 'SELECT 1', from: 0, to: 8, runId: 'run-a', status: 'succeeded' },
            { sql: 'SELECT 2', from: 10, to: 18, runId: 'run-b', status: 'succeeded' },
            { sql: 'SELECT 3', from: 20, to: 28, runId: 'run-c', status: 'succeeded' },
        ],
    };
    await page.route('**/api/scripts', route => route.fulfill({ status: 202, json: created }));
    await page.route('**/api/scripts/script-fast', route => route.fulfill({ json: completed }));
    await page.route('**/api/runs/run-c', route => route.fulfill({ json: {
        id: 'run-c', queryId: 'query-c', owner: 'local-owner', connectionId: 'demo', dataSource: 'fixture',
        sql: 'SELECT 3', kind: 'query', parameters: {}, limits: { rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4 },
        tags: {}, status: 'succeeded', createdAt: created.createdAt, elapsedMs: 1, rowCount: 1, bytes: 8,
        columns: [], warnings: [], sequence: 1, resultState: 'expired', requestedBy: 'local-owner', executedAs: 'fixture-reader',
        permissionSnapshot: { readonly: true, role: 'owner' }, retryPolicy: 'never',
    } }));
    await runScript(page);

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('button', { name: 'Statement 3: succeeded', exact: true })).toBeVisible();
    const runIds = async () => page.evaluate(() => {
        const value = localStorage.getItem('clickstudio:workspace:demo:v1');
        if (!value) return [];
        const workspace = JSON.parse(value) as { tabs: { id: string; runIds: string[]; activeRunId?: string }[]; activeId: string };
        return workspace.tabs.find(tab => tab.id === workspace.activeId)?.runIds ?? [];
    });
    await expect.poll(runIds).toEqual(['run-a', 'run-b', 'run-c']);
    await expect.poll(async () => page.evaluate(() => {
        const workspace = JSON.parse(localStorage.getItem('clickstudio:workspace:demo:v1') ?? 'null');
        return workspace?.tabs.find((tab: { id: string }) => tab.id === workspace.activeId)?.activeRunId;
    })).toBe('run-c');

    await page.reload();
    await expect.poll(runIds).toEqual(['run-a', 'run-b', 'run-c']);
    await expect.poll(async () => page.evaluate(() => {
        const workspace = JSON.parse(localStorage.getItem('clickstudio:workspace:demo:v1') ?? 'null');
        return workspace?.tabs.find((tab: { id: string }) => tab.id === workspace.activeId)?.activeRunId;
    })).toBe('run-c');
});

test('Selecting an earlier script statement stops automatic following while later work runs', async ({ page }) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1; SELECT fixture_slow;');
    await runScript(page);

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const first = results.getByRole('button', { name: 'Statement 1: succeeded', exact: true });
    const second = results.getByRole('button', { name: 'Statement 2: running', exact: true });
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    const nextPoll = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname.startsWith('/api/scripts/'));
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await nextPoll;
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(second).toHaveAttribute('aria-pressed', 'false');
});

test('Cancelling a long-running query reaches a terminal cancelled state', async ({ page }) => {
    await trust(page);
    await replaceSql(page, 'SELECT fixture_slow');
    await runButton(page).click();
    const cancel = page.locator('.execution-bar').getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'cancelled', { timeout: 10000 });
});

test('Cancellation stays available while execution profile loading is pending', async ({ page }) => {
    let releaseProfile: () => void = () => {};
    const profileGate = new Promise<void>(resolve => { releaseProfile = () => resolve(); });
    await page.route(url => /\/api\/runs\/[^/]+\/profile$/.test(url.pathname), async route => {
        await profileGate;
        await route.continue();
    });
    try {
        await trust(page);
        await replaceSql(page, 'SELECT fixture_slow');
        const started = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
        await runButton(page).click();
        const run = runIdentity(await (await started).json());
        const cancel = page.locator('.execution-bar').getByRole('button', { name: 'Cancel', exact: true });
        await expect(cancel).toBeVisible();
        const profileRequest = page.waitForRequest(request => new URL(request.url()).pathname === `/api/runs/${run.id}/profile`);
        await page.locator('.results-tabs').getByRole('tab', { name: 'Insights', exact: true }).click();
        await profileRequest;
        await expect(cancel).toBeEnabled();
        const cancelled = page.waitForResponse(response => new URL(response.url()).pathname === `/api/runs/${run.id}/cancel`);
        await cancel.click();
        await cancelled;
        releaseProfile();
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'cancelled', { timeout: 10000 });
    } finally {
        releaseProfile();
    }
});

test('A query and its local draft recover after reload without rerunning', async ({ page }) => {
    let runRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runRequests++;
    });
    await trust(page);
    await page.getByRole('textbox', { name: 'SQL document name', exact: true }).fill('ClickStudio demo.sql');
    await replaceSql(page, "SELECT 'draft survives reload'");
    const results = await runQuery(page);
    const queryId = await page.locator('.execution-bar code').innerText();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload();

    await expect(page.getByRole('textbox', { name: 'SQL document name', exact: true })).toHaveValue('ClickStudio demo.sql');
    await expect(page.locator('.cm-content')).toContainText("SELECT 'draft survives reload'");
    await expect(page.getByRole('region', { name: 'Query results', exact: true }).getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
    expect(runRequests).toBe(1);
    await expect(results).toHaveCount(1);
});
