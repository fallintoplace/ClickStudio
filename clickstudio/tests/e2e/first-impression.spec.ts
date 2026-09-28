import { test, expect } from '@playwright/test';
import { trust } from './helpers.js';

test('Experimental mode uses the Standard right inspector layout', async ({ page }) => {
    await trust(page);

    const content = page.locator('.workspace-content');
    await expect(content).not.toHaveClass(/has-run/);
    await expect(page.getByRole('region', { name: 'Query results', exact: true })).toHaveCount(0);
    await expect(page.locator('.empty-workspace')).toHaveCount(0);
    const rail = page.locator('.icon-rail');
    const inspector = page.locator('.inspector-pane.is-docked-inspector');
    const workspace = page.locator('.workspace-main');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Objects', exact: true })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Reference', exact: true })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'AI', exact: true })).toBeVisible();
    await expect(inspector).toBeVisible();
    await expect(inspector.locator('.inspector-tabs')).toBeVisible();
    await expect(inspector.getByRole('heading', { name: 'Objects', exact: true })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Objects', exact: true })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Reference', exact: true })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'AI', exact: true })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Close inspector', exact: true })).toBeVisible();

    for (const width of [1280, 1120, 851]) {
        await page.setViewportSize({ width, height: 900 });
        const railBounds = await rail.evaluate(element => element.getBoundingClientRect().toJSON());
        const workspaceBounds = await workspace.evaluate(element => element.getBoundingClientRect().toJSON());
        const inspectorBounds = await inspector.evaluate(element => element.getBoundingClientRect().toJSON());
        expect(railBounds.right).toBeLessThanOrEqual(workspaceBounds.left + 1);
        expect(workspaceBounds.right).toBeLessThanOrEqual(inspectorBounds.left + 1);
        expect(inspectorBounds.width).toBeGreaterThanOrEqual(320);
    }

    await page.setViewportSize({ width: 850, height: 900 });
    await expect(inspector).toHaveCount(0);
    await page.setViewportSize({ width: 851, height: 900 });
    await expect(inspector).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 720 });
    const browser = inspector.getByRole('navigation', { name: 'Workspace browser', exact: true });
    await browser.getByRole('button', { name: 'Reference', exact: true }).click();
    await expect(inspector.getByRole('heading', { name: 'Reference', exact: true })).toBeVisible();
    await rail.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(inspector.getByRole('heading', { name: 'AI', exact: true })).toBeVisible();
    await expect(page.locator('.assistant-panel')).toBeVisible();

    await inspector.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await expect(inspector).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'AI', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await rail.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', { name: 'AI', exact: true })).toBeVisible();

    await inspector.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Queries', exact: true }).click();
    await expect(inspector.getByRole('heading', { name: 'Queries', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
});

test('One Run button and the explain actions stay visible in Experimental mode', async ({ page }) => {
    await trust(page);
    const actions = page.getByRole('group', { name: 'Run actions', exact: true });
    const run = actions.getByRole('button', { name: 'Run', exact: true });
    await expect(run).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Run script', exact: true })).toHaveCount(0);
    await expect(actions.getByRole('button', { name: 'EXPLAIN INDEXES', exact: true })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'EXPLAIN PLAN', exact: true })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'EXPLAIN PIPELINE', exact: true })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'EXPLAIN ANALYZE', exact: true })).toBeVisible();
    await expect(run).toBeEnabled();
    await run.focus();
    await expect(run).toBeFocused();
});

test('EXPLAIN INDEXES opens an interactive index graph and keeps the raw result available', async ({ page }) => {
    await trust(page);
    await page.getByTestId('run-action-explain').click();

    const graph = page.getByRole('region', { name: 'Index pruning graph · Graph', exact: true });
    await expect(graph).toBeVisible();
    await expect(graph.locator('[data-node-id]')).toHaveCount(6);
    await expect(page.locator('.pipeline-graph-heading')).toContainText('4 index checks');

    const bloomIndex = graph.locator('[data-node-id]').filter({ hasText: 'tenant_bloom' });
    await expect(bloomIndex).toBeVisible();
    await bloomIndex.click();
    const inspection = page.locator('.pipeline-node-inspector[aria-label="Selected index details"]');
    await expect(inspection).toContainText('tenant_bloom');
    await expect(inspection).toContainText('Granules');
    await expect(inspection).toContainText('4 / 12');

    const controls = page.getByRole('group', { name: 'Graph view controls', exact: true });
    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const zoomBeforeEditorFocus = await controls.getByLabel('Zoom level').innerText();
    const selectedId = await graph.locator('[data-node-id][aria-pressed="true"]').getAttribute('data-node-id');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(editor).toBeFocused();
    await expect(graph.locator('[data-node-id][aria-pressed="true"]')).toHaveAttribute('data-node-id', selectedId!);
    await expect(controls.getByLabel('Zoom level')).toHaveText(zoomBeforeEditorFocus);

    await page.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
});

test('EXPLAIN PLAN opens a graph with a tree view and keeps the raw result available', async ({ page }) => {
    await trust(page);
    await page.getByTestId('run-action-explain-plan').click();

    const plan = page.locator('.results-surface[aria-label="Logical query plan"]');
    await expect(plan).toContainText('Expression');
    await expect(plan).toContainText('ReadFromFixture');
    await expect(plan).toContainText('Fixture only; the SQL was not evaluated.');
    await expect(plan.locator('.explain-plan-heading')).not.toContainText('no runtime measurements');
    await expect(plan.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Logical query plan', exact: true })).toHaveCount(1);
    const graph = plan.getByRole('region', { name: 'Logical query plan · Graph', exact: true });
    await expect(graph).toBeVisible();
    const graphNodes = graph.locator('[data-node-id]');
    await expect(graphNodes).toHaveCount(2);
    await expect(graph.locator('[data-node-id][tabindex="0"]')).toHaveCount(1);
    await expect(graph.locator('[data-node-id][tabindex="-1"]')).toHaveCount(1);
    const initiallySelected = graph.locator('[data-node-id][aria-pressed="true"]');
    const initialNodeId = await initiallySelected.getAttribute('data-node-id');
    expect(initialNodeId).not.toBeNull();
    await initiallySelected.focus();
    await page.keyboard.press('ArrowDown');
    const keyboardSelected = graph.locator('[data-node-id][aria-pressed="true"]');
    await expect(keyboardSelected).not.toHaveAttribute('data-node-id', initialNodeId!);
    await expect(keyboardSelected).toBeFocused();

    const controls = plan.getByRole('group', { name: 'Graph view controls', exact: true });
    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const zoomBeforeEditorFocus = await controls.getByLabel('Zoom level').innerText();
    const selectedNodeId = await keyboardSelected.getAttribute('data-node-id');
    expect(selectedNodeId).not.toBeNull();
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(editor).toBeFocused();
    await expect(graph.locator('[data-node-id][aria-pressed="true"]')).toHaveAttribute('data-node-id', selectedNodeId!);
    await expect(controls.getByLabel('Zoom level')).toHaveText(zoomBeforeEditorFocus);

    await expect(plan.locator('.explain-plan-heading-actions > strong')).toBeVisible();
    const headingHeight = await plan.locator('.explain-plan-heading').evaluate(element => element.getBoundingClientRect().height);
    expect(headingHeight).toBeLessThan(56);
    await plan.getByRole('button', { name: 'Tree', exact: true }).click();
    await expect(plan.locator('.explain-plan-tree')).toBeVisible();
    await plan.getByRole('button', { name: 'Graph', exact: true }).click();
    await expect(plan.getByRole('region', { name: 'Logical query plan · Graph', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
});

test('EXPLAIN ANALYZE opens a measured runtime graph and retains the raw result', async ({ page }) => {
    await trust(page);
    await page.getByTestId('run-action-explain-analyze').click();

    const runtime = page.locator('.results-surface[aria-label="Runtime"]');
    await expect(runtime.locator('.runtime-summary-grid')).toContainText('31.42 ms');
    await expect(runtime.locator('.runtime-summary-grid')).toContainText('29.34 ms');
    const graph = runtime.getByRole('region', { name: 'Runtime · Graph', exact: true });
    await expect(graph).toBeVisible();
    await expect(graph.locator('[data-node-id]')).toHaveCount(5);
    await expect(graph).toContainText('ReadFromMergeTree');

    const read = graph.locator('[data-node-id]').filter({ hasText: 'ReadFromMergeTree' });
    await read.click();
    const inspection = runtime.locator('.pipeline-node-inspector');
    await expect(inspection).toContainText('ReadFromMergeTree');
    await expect(inspection).toContainText('1.24 million');
    await expect(inspection).toContainText('87.6%');

    await page.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
});

test('EXPLAIN PIPELINE opens an interactive ClickHouse operator graph', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 644 });
    await trust(page);
    await page.getByTestId('run-action-explain-pipeline').click();

    const graph = page.getByRole('region', { name: 'Scrollable operator graph', exact: true });
    const controls = page.getByRole('group', { name: 'Graph view controls', exact: true });
    const initiallySelected = graph.locator('[data-node-id][aria-pressed="true"]');
    await expect(initiallySelected).toBeVisible();
    const selectedIsInGraphViewport = await graph.evaluate(element => {
        const selectedNode = element.querySelector('[data-node-id][aria-pressed="true"]');
        if (!selectedNode) return false;
        const viewport = element.getBoundingClientRect();
        const node = selectedNode.getBoundingClientRect();
        return node.right > viewport.left && node.left < viewport.right && node.bottom > viewport.top && node.top < viewport.bottom;
    });
    expect(selectedIsInGraphViewport).toBe(true);
    const filter = graph.locator('[data-node-id]').filter({ hasText: 'FilterTransform' });
    await expect(filter).toBeVisible();
    await filter.click();
    await expect(page.locator('.pipeline-node-inspector')).toContainText('FilterTransform');
    await expect(page.locator('.pipeline-node-inspector')).toContainText('planned');

    const graphMetrics = await graph.evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(graphMetrics.scrollHeight).toBeGreaterThan(graphMetrics.clientHeight);
    const lastNode = graph.locator('[data-node-id]').last();
    await graph.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(lastNode).toBeInViewport();

    const svg = graph.locator('svg');
    const initialWidth = Number(await svg.getAttribute('width'));
    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect.poll(async () => Number(await svg.getAttribute('width'))).toBeGreaterThan(initialWidth);
    await controls.getByRole('button', { name: 'Focus node', exact: true }).click();
    await expect(controls.getByLabel('Zoom level')).toHaveText('100%');
    await controls.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await expect(controls.getByLabel('Zoom level')).not.toHaveText('100%');

    const resultsContent = page.locator('#query-results-content');
    const resultsMetrics = await resultsContent.evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(resultsMetrics.scrollHeight).toBeGreaterThan(resultsMetrics.clientHeight);
    await resultsContent.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator('.pipeline-node-inspector')).toBeInViewport();

    const zoomBeforeEditorFocus = await controls.getByLabel('Zoom level').innerText();
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(editor).toBeFocused();
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(controls.getByLabel('Zoom level')).toHaveText(zoomBeforeEditorFocus);
});

test('Experimental panels stay reachable through the workspace rail and More', async ({ page }) => {
    await trust(page);
    await page.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Runs', exact: true }).click();
    await expect(page.locator('.inspector-header h2')).toHaveText('Run history');

    await page.locator('.icon-rail').getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.locator('.inspector-header h2')).toHaveText('AI');
    await expect(page.locator('.assistant-panel')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('SELECT');
});

test('Mobile expert navigation opens the browser drawer and keeps its tabs usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await trust(page);

    await page.locator('.icon-rail').getByRole('button', { name: 'Objects', exact: true }).click();
    const drawer = page.locator('.inspector-pane.is-docked-inspector');
    await expect(drawer).toBeVisible();
    const browser = drawer.getByRole('navigation', { name: 'Workspace browser', exact: true });
    await expect(browser.getByRole('button', { name: 'Objects', exact: true })).toBeVisible();
    await expect(browser.getByRole('button', { name: 'Reference', exact: true })).toBeVisible();
    await browser.getByRole('button', { name: 'Reference', exact: true }).click();
    await expect(drawer.locator('.inspector-header h2')).toHaveText('Reference');
    await browser.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Queries', exact: true }).click();
    await expect(drawer.locator('.inspector-header h2')).toHaveText('Queries');
    await drawer.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await expect(drawer).toHaveCount(0);
});
