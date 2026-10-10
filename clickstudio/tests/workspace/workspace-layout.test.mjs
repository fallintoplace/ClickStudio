import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PANEL_MARGIN,
    PANEL_MIN_HEIGHT,
    PANEL_MIN_WIDTH,
    clampPanelSplitRatio,
    defaultWorkspacePanelLayout,
    normalizePanelGeometry,
    normalizeWorkspacePanelLayout,
    recoverWorkspacePanelLayout,
} from '../../.workspace-build/web/workspace-layout.js';

const viewport = { width: 1440, height: 900 };

test('panel geometry stays recoverable inside the viewport', () => {
    const value = normalizePanelGeometry({ x: -900, y: 1200, width: 3000, height: 1800 }, viewport);
    assert.deepEqual(value, { x: PANEL_MARGIN, y: PANEL_MARGIN, width: 1424, height: 884 });
});

test('saved layouts are validated and normalized on recovery', () => {
    const recovered = recoverWorkspacePanelLayout(JSON.stringify({
        splitRatio: 0.99,
        query: { mode: 'floating', geometry: { x: 3000, y: 2000, width: 650, height: 400 } },
        results: { mode: 'wat', geometry: { x: 10, y: 10, width: 10, height: 10 } },
    }), viewport);
    assert.equal(recovered.splitRatio, 0.75);
    assert.equal(recovered.query.mode, 'docked');
    assert.equal(recovered.query.collapsed, false);
    assert.equal(recovered.query.geometry.x + recovered.query.geometry.width, viewport.width - PANEL_MARGIN);
    assert.equal(recovered.results.mode, 'docked');
    assert.equal(recovered.results.collapsed, false);
    assert.equal(recovered.results.geometry.width, PANEL_MIN_WIDTH);
    assert.equal(recovered.results.geometry.height, PANEL_MIN_HEIGHT);
});

test('saved collapsed panel preferences survive recovery', () => {
    const recovered = recoverWorkspacePanelLayout(JSON.stringify({
        query: { mode: 'docked', collapsed: true },
        results: { mode: 'floating', collapsed: false },
    }), viewport);
    assert.equal(recovered.query.collapsed, true);
    assert.equal(recovered.results.collapsed, false);
    assert.equal(recovered.results.mode, 'docked');
});

for (const mode of ['floating', 'maximized']) test(`saved ${mode} panels dock while preserving their preferences`, () => {
    const recovered = recoverWorkspacePanelLayout(JSON.stringify({
        version: 1,
        splitRatio: 0.63,
        query: { mode, collapsed: true },
        results: { mode, collapsed: false },
    }), viewport);
    assert.equal(recovered.query.mode, 'docked');
    assert.equal(recovered.results.mode, 'docked');
    assert.equal(recovered.query.collapsed, true);
    assert.equal(recovered.results.collapsed, false);
    assert.equal(recovered.splitRatio, 0.63);
    assert.deepEqual(recoverWorkspacePanelLayout(JSON.stringify(recovered), viewport), recovered);
});

test('viewport normalization docks legacy modes without resetting collapse or split preferences', () => {
    const layout = defaultWorkspacePanelLayout(viewport);
    layout.query.mode = 'floating';
    layout.query.collapsed = true;
    layout.results.mode = 'maximized';
    layout.splitRatio = 0.6;
    const normalized = normalizeWorkspacePanelLayout(layout, { width: 700, height: 500 });
    assert.equal(normalized.query.mode, 'docked');
    assert.equal(normalized.results.mode, 'docked');
    assert.equal(normalized.query.collapsed, true);
    assert.equal(normalized.splitRatio, 0.6);
    assert.equal(layout.query.mode, 'floating');
    assert.equal(layout.results.mode, 'maximized');
});

test('bad storage falls back to a stable docked layout', () => {
    const recovered = recoverWorkspacePanelLayout('{broken', viewport);
    const expected = defaultWorkspacePanelLayout(viewport);
    assert.deepEqual(recovered, expected);
});

test('split ratio stays useful for both docked panels', () => {
    assert.equal(clampPanelSplitRatio(-1), 0.25);
    assert.equal(clampPanelSplitRatio(0.6), 0.6);
    assert.equal(clampPanelSplitRatio(2), 0.75);
});
