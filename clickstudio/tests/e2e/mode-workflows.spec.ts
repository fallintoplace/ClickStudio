import { test, expect, type Page } from '@playwright/test';
import { jsonRecord, openBlankSql, openWorkspacePanel, runIdentity, trust, trustCurrentConnection, useAdvancedMode } from './helpers.js';

const generatedSql = 'SELECT day, events FROM demo.events ORDER BY day';

async function beginInCompactMode(page: Page) {
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'beginner'));
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'SQL editor', exact: true })).toBeVisible();
    await expect(page.getByTestId('open-ai')).toHaveCount(0);
    await expect(page.getByTestId('save-query')).toHaveCount(0);
    await expect(page.locator('.draft-status')).toHaveCount(0);
    await expect(page.locator('.restore-sql-trigger')).toHaveCount(0);
    await expect(page.locator('.revision-history-trigger')).toHaveCount(0);
    await expect(page.locator('.editor-control-rail')).toHaveCount(0);
    await expect(page.locator('.editor-heading-tools')).toHaveCount(0);
    await expect(page.locator('.parser-switch')).toHaveCount(0);
    await expect(page.getByTestId('run-statement')).toBeVisible();
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

test('Compact opens on SQL and can run a query without opening AI', async ({ page }) => {
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
    await expect(page.getByTestId('open-ai')).toHaveCount(0);
    await expect(page.locator('.editor-control-rail')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Describe your data question', exact: true })).toHaveCount(0);

    const runQuery = page.getByTestId('run-statement');
    if (await runQuery.isDisabled()) {
        await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
        await expect(runQuery).toBeEnabled();
    }
    await runQuery.click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows', exact: true })).toBeVisible();
    await expect(results.locator('.results-tabs')).toHaveCount(0);
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
    await expect(results.locator('.results-tabs')).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab')).toHaveCount(1);
    await page.getByText('Compact', { exact: true }).click();
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
    await expect(results.getByRole('table', { name: 'Retained query rows', exact: true })).toBeVisible();
    await expect(results.locator('.results-tabs')).toHaveCount(0);
    await expect(page.getByTestId('open-ai')).toHaveCount(0);
    await expect(page.locator('.parser-switch')).toHaveCount(0);
});

test('Compact shows a single document tab and keeps tabs for multiple queries', async ({ page }) => {
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

test('Switching to Advanced keeps the same AI question, query and run evidence', async ({ page }) => {
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
            id: 'test-proposal', owner: 'local-owner', connectionId: 'demo', action: 'generate', createdAt: '2026-09-23T00:00:00.000Z',
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
            id: 'test-proposal', owner: 'local-owner', connectionId: 'demo', action: 'generate', createdAt: '2026-09-23T00:00:00.000Z', decidedAt: '2026-09-23T00:00:01.000Z',
            baseSql: proposalBaseSql, responseId: 'test-response', model: 'test-model', promptVersion: 'test', contextSummary: ['Fixture-backed mock'], decision,
            sql: generatedSql, summary: 'Show the sample event counts by day.', assumptions: [], tables: ['demo.events'], caveats: [], clarification: null, findings: [],
        } });
    });

    await beginInCompactMode(page);
    await useAdvancedMode(page);
    await page.getByTestId('save-query').click();
    await expect(page.getByRole('status').filter({ hasText: 'revision 1' })).toBeVisible();
    await page.getByTestId('open-ai').click();
    const prompt = page.getByRole('textbox', { name: 'YOUR QUESTION', exact: true });
    await prompt.fill('Show event counts by day');
    await page.getByRole('button', { name: 'Generate SQL', exact: true }).click();
    await expect(page.getByTestId('sql-proposal-diff').getByText('Show the sample event counts by day.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('sql-proposal-diff')).toBeVisible();
    expect(generations).toHaveLength(1);
    expect(generations[0]).toMatchObject({ question: 'Show event counts by day', connectionId: 'demo' });
    expect(generations[0]?.schema).toBeTruthy();
    expect(runRequests).toHaveLength(0);
    await page.getByRole('button', { name: 'Accept SQL', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText(generatedSql);
    expect(runRequests).toHaveLength(0);
    await page.getByTestId('run-statement').click();

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
    await page.getByText('Compact', { exact: true }).click();
    await expect(page.getByTestId('open-ai')).toHaveCount(0);
    await expect(results.locator('.results-tabs')).toHaveCount(0);
    await expect(results.getByRole('table', { name: 'Retained query rows', exact: true })).toBeVisible();
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
    await useAdvancedMode(page);
    await expect(prompt).toHaveValue('Show event counts by day');
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('Advanced editor, insights, pipeline and AI copilot stay read-only until a user runs SQL', async ({ page }) => {
    const runRequests: unknown[] = [];
    const contexts: Record<string, unknown>[] = [];
    let proposalRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runRequests.push(request.postDataJSON());
    });
    await page.route('**/api/assistant/context', async route => {
        contexts.push(jsonRecord(route.request().postDataJSON(), 'Assistant context request'));
        await route.fulfill({ status: 201, json: { id: 'expert-context', summary: ['Current SQL, schema, and selected retained result are included.'] } });
    });
    await page.route('**/api/assistant/proposals', async route => {
        proposalRequests++;
        await route.fulfill({ json: {
            id: 'expert-proposal', owner: 'local-owner', connectionId: 'demo', action: 'performance', createdAt: '2026-09-23T00:00:00.000Z',
            baseSql: String(contexts[0]?.sql ?? ''), responseId: 'test-response', model: 'test-model', promptVersion: 'test', contextSummary: ['Fixture-backed mock'], decision: 'pending',
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
    await page.getByTestId('run-statement').click();
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
    await expect(page.locator('.assistant-task-picker input[type="radio"]')).toHaveCount(6);
    await page.locator('.assistant-panel input[type="radio"][value="performance"]').check();
    await page.locator('.assistant-panel textarea').fill('Why is this query slow?');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Preview context', exact: true }).click();
    await expect(page.getByText(/Current SQL, schema/)).toBeVisible();
    expect(contexts[0]).toMatchObject({ action: 'performance', question: 'Why is this query slow?', runId: activeRunId, includeResult: true });

    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Ask AI for a proposal', exact: true }).click();
    await expect(page.getByText('The fixture has no measured performance data.', { exact: true })).toBeVisible();
    expect(proposalRequests).toBe(1);
    expect(runRequests).toHaveLength(1);
    await expect(page.locator('.execution-bar code')).toHaveText(queryId);
});
