import { test, expect, type Page } from '@playwright/test';
import { jsonRecord, openBlankSql, openWorkspacePanel, replaceSql, runIdentity, runScript, trust, trustCurrentConnection, useAdvancedMode } from './helpers.js';

const generatedSql = 'SELECT day, events FROM demo.events ORDER BY day';

async function beginInCompactMode(page: Page) {
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'beginner'));
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'SQL editor', exact: true })).toBeVisible();
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(page.getByTestId('format-sql')).toBeVisible();
    await expect(page.getByTestId('run-button')).toHaveCount(1);
    await expect(page.getByTestId('save-query')).toHaveCount(0);
    await expect(page.locator('.draft-status')).toHaveCount(0);
    await expect(page.locator('.restore-sql-trigger')).toHaveCount(0);
    await expect(page.locator('.revision-history-trigger')).toHaveCount(0);
    await expect(page.locator('.editor-control-rail')).toHaveCount(0);
    await expect(page.locator('.editor-heading-tools')).toHaveCount(0);
    await expect(page.locator('.parser-switch')).toHaveCount(0);
    await expect(page.getByTestId('new-sql')).toBeVisible();
    await expect(page.locator('.document-tabs.is-compact-single')).toBeVisible();
    const tab = page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab');
    const documentName = await page.getByRole('textbox', { name: 'SQL document name', exact: true }).inputValue();
    await expect(tab).toHaveCount(1);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toHaveAttribute('aria-label', documentName);
    await expect(tab.getByRole('button', { name: /^Close / })).toHaveCount(0);
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', /^document-tab-/);
    await expect(page.getByRole('textbox', { name: 'Describe your data question', exact: true })).toHaveCount(0);
    await trustCurrentConnection(page);
}

test('Standard exposes assignment actions and can run a query without opening AI', async ({ page }) => {
    let contextRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/assistant/context') contextRequests++;
    });
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'beginner'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const editor = page.getByRole('textbox', { name: 'SQL editor', exact: true });
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('SELECT');
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(page.getByTestId('format-sql')).toBeVisible();
    await expect(page.getByTestId('run-button')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
    const exportButton = page.getByRole('button', { name: 'Export', exact: true });
    await expect(exportButton).toBeDisabled();
    await expect(page.locator('.editor-control-rail')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Describe your data question', exact: true })).toHaveCount(0);

    const runQuery = page.getByTestId('run-button');
    if (await runQuery.isDisabled()) {
        await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
        await expect(runQuery).toBeEnabled();
    }
    await runQuery.click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows', exact: true })).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Results', exact: true })).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Chart', exact: true })).toBeVisible();
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-workspace, .chart-table-fallback')).toBeVisible();
    await results.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(exportButton).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    await expect(page.getByRole('status').filter({ hasText: 'Sample results were generated. Query SQL was not sent to ClickHouse.' })).toBeVisible();
    expect(contextRequests).toBe(0);
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toHaveCount(0);

    const queryId = await page.locator('.execution-bar code').innerText();
    await useAdvancedMode(page);
    await expect(page.locator('.cm-content')).toContainText('SELECT');
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(page.getByTestId('save-query')).toBeVisible();
    await expect(page.locator('.editor-control-rail')).toBeVisible();
    await expect(page.locator('.parser-switch')).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Chart', exact: true })).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab')).toHaveCount(1);
    await page.getByText('Standard', { exact: true }).click();
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
    await expect(results.getByRole('table', { name: 'Retained query rows', exact: true })).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Chart', exact: true })).toBeVisible();
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(page.locator('.parser-switch')).toHaveCount(0);
});

test('Standard keeps AI open after successful and failed query runs', async ({ page }) => {
    await beginInCompactMode(page);
    await page.getByTestId('open-ai').click();

    const assistant = page.locator('.assistant-panel');
    const question = page.getByRole('textbox', { name: 'Ask AI', exact: true });
    const runButton = page.getByTestId('run-button');
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(assistant).toBeVisible();
    await expect(runButton).toBeEnabled();
    await question.fill('Keep the AI panel open');

    await runButton.click();
    await expect(results.getByRole('table', { name: 'Retained query rows', exact: true })).toBeVisible();
    await expect(assistant).toBeVisible();
    await expect(question).toHaveValue('Keep the AI panel open');

    const runRoute = (url: URL) => url.pathname === '/api/runs';
    await page.route(runRoute, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fulfill({ status: 400, json: { error: { code: 'SYNTAX_ERROR', message: 'Syntax error at position 15', position: 15 } } });
    });

    try {
        await replaceSql(page, 'SELECT * FROM missing_table');
        await runButton.click();
        await expect(results.getByTestId('query-failure')).toContainText('SYNTAX_ERROR');
        await expect(assistant).toBeVisible();
        await expect(question).toHaveValue('Keep the AI panel open');
    } finally {
        await page.unroute(runRoute);
    }
});

test('Standard shows a single document tab and keeps tabs for multiple queries', async ({ page }) => {
    await beginInCompactMode(page);
    await expect(page.locator('.document-tabs.is-compact-single')).toBeVisible();
    await openBlankSql(page);
    const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab');
    await expect(page.locator('.document-tabs.is-compact-single')).toHaveCount(0);
    await expect(tabs).toHaveCount(2);
    await expect(page.getByTestId('new-sql')).toBeVisible();
    await expect(page.getByTestId('save-query')).toHaveCount(0);
    await tabs.last().getByRole('button', { name: /^Close / }).click();
    await expect(page.locator('.document-tabs.is-compact-single')).toBeVisible();
    await expect(tabs).toHaveCount(1);
    await expect(tabs).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('button', { name: /^Close / })).toHaveCount(0);
    await expect(page.locator('.restore-sql-trigger')).toHaveCount(0);
});

test('Switching to Experimental keeps the AI chat, query and run evidence', async ({ page }) => {
    const generations: Record<string, unknown>[] = [];
    const runRequests: Record<string, unknown>[] = [];
    let proposalBaseSql = '';
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests.push(jsonRecord(request.postDataJSON(), 'Run request'));
    });
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'SQL generation request');
        generations.push(body);
        proposalBaseSql = String(body.sql ?? '');
        await route.fulfill({ json: {
            id: 'test-proposal', owner: 'local-owner', connectionId: 'demo', action: 'ask', createdAt: '2026-09-23T00:00:00.000Z',
            baseSql: proposalBaseSql, responseId: 'test-response', model: 'test-model', promptVersion: 'test', contextSummary: ['Fixture-backed mock'], decision: 'pending',
            sql: generatedSql, summary: 'Show the sample event counts by day.', assumptions: [], tables: ['demo.events'], caveats: ['The demo fixture does not evaluate SQL.'], clarification: null, findings: [],
            quality: { evaluatorVersion: 'test', evaluatedAt: '2026-09-23T00:00:00.000Z', status: 'pass', score: 100, checks: [] },
        } });
    });
    await page.route('**/api/assistant/proposals/test-proposal/decision', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant decision request');
        const decision = body.decision;
        if (decision !== 'accepted' && decision !== 'rejected')
            throw new Error('Assistant decision request did not include a valid decision');
        await route.fulfill({ json: {
            id: 'test-proposal', owner: 'local-owner', connectionId: 'demo', action: 'ask', createdAt: '2026-09-23T00:00:00.000Z', decidedAt: '2026-09-23T00:00:01.000Z',
            baseSql: proposalBaseSql, responseId: 'test-response', model: 'test-model', promptVersion: 'test', contextSummary: ['Fixture-backed mock'], decision,
            sql: generatedSql, summary: 'Show the sample event counts by day.', assumptions: [], tables: ['demo.events'], caveats: [], clarification: null, findings: [],
        } });
    });

    await beginInCompactMode(page);
    await useAdvancedMode(page);
    await page.getByTestId('save-query').click();
    await expect(page.getByRole('status').filter({ hasText: 'revision 1' })).toBeVisible();
    await page.getByTestId('open-ai').click();
    const prompt = page.getByRole('textbox', { name: 'Ask AI', exact: true });
    await prompt.fill('Show event counts by day');
    await page.locator('.assistant-panel').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.proposal-card').getByText('Show the sample event counts by day.', { exact: true })).toBeVisible();
    await expect(page.locator('.proposal-card').getByTestId('sql-proposal-diff')).toBeVisible();
    expect(generations).toHaveLength(1);
    expect(generations[0]).toMatchObject({ action: 'ask', question: 'Show event counts by day', connectionId: 'demo' });
    expect(generations[0]?.schema).toBeTruthy();
    expect(runRequests).toHaveLength(0);
    await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText(generatedSql);
    expect(runRequests).toHaveLength(0);
    await page.getByTestId('run-button').click();

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.locator('[data-run-status="succeeded"]')).toBeVisible();
    await expect(results.getByRole('cell', { name: '2026-01-01', exact: true })).toBeVisible();
    const queryId = await page.locator('.execution-bar code').innerText();
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-canvas svg[role="img"]')).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toBeVisible();
    await results.getByRole('tab', { name: 'Insights', exact: true }).click();
    const loadDetails = results.getByRole('button', { name: 'Load execution details', exact: true });
    if (await loadDetails.count()) await loadDetails.click();
    await expect(results.getByText('Execution time', { exact: true })).toBeVisible();

    await expect(page.locator('.cm-content')).toContainText(generatedSql);
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
    await page.getByText('Standard', { exact: true }).click();
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Chart', exact: true })).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toHaveCount(0);
    await expect(results.getByRole('table', { name: 'Retained query rows', exact: true })).toBeVisible();
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
    await useAdvancedMode(page);
    await expect(page.locator('.assistant-user-message')).toContainText('Show event counts by day');
    await expect(prompt).toHaveValue('');
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('Standard can run a script and open its statement results', async ({ page }) => {
    await beginInCompactMode(page);
    await replaceSql(page, 'SELECT 1; SELECT 2;');
    await expect(page.getByTestId('run-button')).toBeEnabled();
    await runScript(page);

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const first = results.getByRole('button', { name: 'Statement 1: succeeded', exact: true });
    const second = results.getByRole('button', { name: 'Statement 2: succeeded', exact: true });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await first.click();
    await expect(results.getByRole('table', { name: 'Retained query rows', exact: true })).toBeVisible();
});

test('Standard import opens from the left rail and formatting is available in the editor', async ({ page }) => {
    await beginInCompactMode(page);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const importDialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Close import wizard', exact: true }).click();

    await replaceSql(page, 'select 1 as value from numbers(1)');
    await page.getByTestId('format-sql').click();
    await expect(page.locator('.cm-content .cm-line')).toHaveText(['select 1 as value', 'FROM numbers(1)']);
});

test('Experimental insights and AI requests do not execute SQL', async ({ page }) => {
    const runRequests: unknown[] = [];
    const assistantRequests: Record<string, unknown>[] = [];
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runRequests.push(request.postDataJSON());
    });
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant request');
        assistantRequests.push(body);
        await route.fulfill({ json: {
            id: 'expert-proposal', owner: 'local-owner', connectionId: 'demo', action: 'ask', createdAt: '2026-09-23T00:00:00.000Z',
            baseSql: String(body.sql ?? ''), responseId: 'test-response', model: 'test-model', promptVersion: 'test', contextSummary: ['Fixture-backed mock'], decision: 'pending',
            sql: null, summary: 'The fixture has no measured performance data.', assumptions: [], tables: [], caveats: ['Demo runs do not measure ClickHouse performance.'], clarification: null,
            findings: [{ severity: 'low', message: 'No slowdown can be inferred from fixture data.', evidence: 'The sample driver is not a ClickHouse server.' }],
        } });
    });

    await trust(page);
    await useAdvancedMode(page);
    const editor = page.getByRole('textbox', { name: 'SQL editor', exact: true });
    await expect(editor).toBeVisible();
    const startedRun = page.waitForResponse(response =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/runs');
    await page.getByTestId('run-button').click();
    const activeRunId = runIdentity(await (await startedRun).json()).id;
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.locator('[data-run-status="succeeded"]')).toBeVisible();
    const queryId = await page.locator('.execution-bar code').innerText();

    await results.getByRole('tab', { name: 'Insights', exact: true }).click();
    const loadDetails = results.getByRole('button', { name: 'Load execution details', exact: true });
    if (await loadDetails.count()) await loadDetails.click();
    await expect(results.getByText('Execution time', { exact: true })).toBeVisible();

    await openWorkspacePanel(page, 'pipeline');
    await expect(page.locator('.pipeline-stage').first()).toBeVisible();
    await page.getByRole('button', { name: 'Open operator graph in Insights', exact: true }).click();
    await expect(results.getByRole('region', { name: 'Scrollable operator graph', exact: true })).toBeVisible();
    await page.getByTestId('open-ai').click();
    await expect(page.locator('.assistant-task-picker')).toHaveCount(0);
    const question = page.getByRole('textbox', { name: 'Ask AI', exact: true });
    await question.fill('Why is this query slow?');
    const assistantRequest = page.waitForRequest(request => {
        const path = new URL(request.url()).pathname;
        return request.method() === 'POST' && path === '/api/assistant/sql';
    });
    await question.press('Enter');
    await assistantRequest;
    await expect(page.getByText('The fixture has no measured performance data.', { exact: true })).toBeVisible();
    expect(assistantRequests).toHaveLength(1);
    expect(assistantRequests[0]).toMatchObject({ action: 'ask', question: 'Why is this query slow?', runId: activeRunId, includeRun: true });
    expect(assistantRequests[0]?.result).toBeTruthy();
    expect(runRequests).toHaveLength(1);
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
});
