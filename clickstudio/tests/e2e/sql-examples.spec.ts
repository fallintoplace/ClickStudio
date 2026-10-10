import { test, expect } from '@playwright/test';
import { openSqlExamples, trust } from './helpers.js';

test('SQL examples open in a new tab without changing or running the current query', async ({
    page,
}) => {
    let runRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests++;
    });

    await trust(page);
    const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab');
    const originalTab = tabs.first();
    const originalName = await originalTab.getAttribute('aria-label');
    const originalSql = await page.locator('.cm-content').textContent();
    const collapseButton = page.getByRole('button', { name: 'Collapse SQL query', exact: true });
    const collapseButtonRight = await collapseButton.evaluate(
        element => element.getBoundingClientRect().right,
    );
    expect(collapseButtonRight).toBeLessThanOrEqual(page.viewportSize()!.width);
    await collapseButton.click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();

    const dialog = await openSqlExamples(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Sample data', { exact: true })).toBeVisible();
    await dialog.getByTestId('sql-example-search').fill('Top countries');
    const example = dialog.getByTestId('sql-example-preview-starter-top-countries');
    await expect(example).toBeVisible();
    await example.click();
    await expect(dialog.locator('.sql-example-preview code')).toContainText('FROM events');
    await dialog.getByTestId('open-sql-example').click();

    await expect(tabs.last()).toHaveAttribute('aria-label', 'Top countries.sql');
    await expect(page.locator('.cm-content')).toContainText('FROM events');
    await expect(page.locator('#sql-editor-content')).toBeVisible();
    await expect(page.locator('.cm-content')).toBeFocused();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    await expect(page.locator('.execution-bar')).not.toHaveAttribute('data-query-id');
    expect(originalName).not.toBeNull();
    await page.getByRole('tab', { name: originalName!, exact: true }).click();
    await expect.poll(() => page.locator('.cm-content').textContent()).toBe(originalSql);
    await expect(page.locator('#sql-editor-content')).toBeHidden();
    expect(runRequests).toBe(0);
    await expect(dialog).toHaveCount(0);
});

test('SQL examples search handles no matches and Escape restores focus', async ({ page }) => {
    await trust(page);
    const trigger = page.getByRole('button', { name: 'Help', exact: true });
    const dialog = await openSqlExamples(page);
    const search = dialog.getByTestId('sql-example-search');
    await search.fill('query-with-no-matching-example');
    await expect(dialog.getByRole('status')).toHaveText('No examples match your search.');
    await search.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
});

test('Help section navigation preserves search until the panel is reopened', async ({ page }) => {
    await trust(page);
    const trigger = page.getByRole('button', { name: 'Help', exact: true });
    const dialog = await openSqlExamples(page);
    const search = dialog.getByTestId('sql-example-search');
    await search.fill('Top countries');
    const examplesTab = dialog.getByTestId('help-section-examples');
    await examplesTab.click();
    await examplesTab.press('End');
    const compareTab = dialog.getByTestId('help-section-compare');
    await expect(compareTab).toBeFocused();
    await expect(compareTab).toHaveAttribute('aria-selected', 'true');
    await compareTab.press('Home');
    const tourTab = dialog.getByTestId('help-section-tour');
    await expect(tourTab).toBeFocused();
    await tourTab.press('ArrowRight');
    await expect(examplesTab).toBeFocused();
    await expect(search).toHaveValue('Top countries');
    await expect(dialog.getByTestId('sql-example-preview-starter-top-countries')).toBeVisible();
    await expect(page.locator('#root')).toHaveJSProperty('inert', true);
    await examplesTab.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator('#root')).toHaveJSProperty('inert', false);
    await openSqlExamples(page);
    await expect(search).toHaveValue('');
});

test('Help tour exposes ClickStudio native workflows from one place', async ({ page }) => {
    await trust(page);
    await expect(page.getByRole('button', { name: 'Open observability' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
    await expect(dialog).toBeVisible();

    for (const section of [
        'tour',
        'examples',
        'workflows',
        'monitoring',
        'query',
        'geo',
        'explain',
        'storage',
        'dependencies',
        'compare',
        'reference',
    ])
        await expect(dialog.getByTestId('help-section-' + section)).toBeVisible();

    const tabs = dialog
        .getByRole('tablist', { name: 'Explore ClickStudio sections' })
        .getByRole('tab');
    await expect(tabs.first()).toHaveAttribute('data-testid', 'help-section-tour');
    await expect(dialog.getByTestId('help-section-tour')).toHaveAttribute('aria-selected', 'true');
    await dialog.getByTestId('help-section-workflows').click();
    await expect(dialog.getByText('Bind typed values', { exact: true })).toBeVisible();
    await expect(
        dialog.getByText(/executes all SQL in the editor and stops after the first error/),
    ).toBeVisible();

    await dialog.getByTestId('help-section-monitoring').click();
    await expect(dialog.getByRole('heading', { name: 'Workload', exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Replication', exact: true })).toBeVisible();

    await dialog.getByTestId('help-section-geo').click();
    await expect(
        dialog.getByText('Native geometry on a spatial canvas', { exact: true }),
    ).toBeVisible();
    await expect(dialog.locator('.workspace-help-geo-copy code')).toContainText(
        '(13.405, 52.52)::Point',
    );
    await expect(dialog.getByTestId('run-geo-example')).toBeVisible();

    await dialog.getByTestId('help-section-storage').click();
    await expect(dialog.getByRole('button', { name: 'Parts', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Merges', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Mutations', exact: true })).toBeVisible();

    await dialog.getByTestId('help-section-explain').click();
    await expect(dialog.getByRole('button', { name: /EXPLAIN PLAN/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /EXPLAIN PIPELINE/ })).toBeVisible();

    await dialog.getByTestId('help-section-monitoring').click();
    await dialog.getByRole('button', { name: 'Open monitoring', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Monitoring', exact: true })).toBeVisible();
});
