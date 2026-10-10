export const WORKSPACE_PANEL_IDS = ['query', 'results'] as const;
export type WorkspacePanelId = (typeof WORKSPACE_PANEL_IDS)[number];
export const WORKSPACE_PANEL_MODES = ['docked', 'floating', 'maximized'] as const;
export type WorkspacePanelMode = (typeof WORKSPACE_PANEL_MODES)[number];

export type ViewportSize = { width: number; height: number };
export type PanelGeometry = { x: number; y: number; width: number; height: number };
export type WorkspacePanelState = {
    mode: WorkspacePanelMode;
    geometry: PanelGeometry;
    collapsed: boolean;
};
export type WorkspacePanelLayout = {
    version: 1;
    splitRatio: number;
    query: WorkspacePanelState;
    results: WorkspacePanelState;
};

export const WORKSPACE_LAYOUT_STORAGE_KEY = 'clickstudio:workspace-layout:v1';
export const PANEL_MARGIN = 8;
export const PANEL_MIN_WIDTH = 480;
export const PANEL_MIN_HEIGHT = 260;
export const PANEL_SPLIT_MIN = 0.25;
export const PANEL_SPLIT_MAX = 0.75;

const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), maximum);

function geometryLimits(viewport: ViewportSize) {
    const width = Math.max(1, viewport.width);
    const height = Math.max(1, viewport.height);
    const maxWidth = Math.max(1, width - PANEL_MARGIN * 2);
    const maxHeight = Math.max(1, height - PANEL_MARGIN * 2);
    return {
        width,
        height,
        maxWidth,
        maxHeight,
        minWidth: Math.min(PANEL_MIN_WIDTH, maxWidth),
        minHeight: Math.min(PANEL_MIN_HEIGHT, maxHeight),
    };
}

export function normalizePanelGeometry(
    geometry: PanelGeometry,
    viewport: ViewportSize,
): PanelGeometry {
    const limits = geometryLimits(viewport);
    const width = clamp(geometry.width, limits.minWidth, limits.maxWidth);
    const height = clamp(geometry.height, limits.minHeight, limits.maxHeight);
    const maxX = Math.max(PANEL_MARGIN, limits.width - width - PANEL_MARGIN);
    const maxY = Math.max(PANEL_MARGIN, limits.height - height - PANEL_MARGIN);
    return {
        x: clamp(geometry.x, PANEL_MARGIN, maxX),
        y: clamp(geometry.y, PANEL_MARGIN, maxY),
        width,
        height,
    };
}

export function defaultPanelGeometry(
    panel: WorkspacePanelId,
    viewport: ViewportSize,
): PanelGeometry {
    const limits = geometryLimits(viewport);
    const widthScale = panel === 'query' ? 0.72 : 0.76;
    const heightScale = panel === 'query' ? 0.62 : 0.58;
    const width = clamp(limits.width * widthScale, limits.minWidth, limits.maxWidth);
    const height = clamp(limits.height * heightScale, limits.minHeight, limits.maxHeight);
    const x = panel === 'query' ? PANEL_MARGIN + 24 : limits.width - width - PANEL_MARGIN - 24;
    const y = panel === 'query' ? PANEL_MARGIN + 56 : limits.height - height - PANEL_MARGIN - 48;
    return normalizePanelGeometry({ x, y, width, height }, viewport);
}

export function clampPanelSplitRatio(value: number): number {
    return clamp(value, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
}

function panelState(
    value: unknown,
    panel: WorkspacePanelId,
    viewport: ViewportSize,
): WorkspacePanelState {
    const fallback = defaultPanelGeometry(panel, viewport);
    if (!value || typeof value !== 'object')
        return { mode: 'docked', geometry: fallback, collapsed: false };
    const candidate = value as Partial<WorkspacePanelState>;
    const raw = candidate.geometry;
    const geometry =
        raw && finite(raw.x) && finite(raw.y) && finite(raw.width) && finite(raw.height)
            ? normalizePanelGeometry(raw, viewport)
            : fallback;
    return { mode: 'docked', geometry, collapsed: candidate.collapsed === true };
}

export function defaultWorkspacePanelLayout(viewport: ViewportSize): WorkspacePanelLayout {
    return {
        version: 1,
        splitRatio: 0.54,
        query: {
            mode: 'docked',
            geometry: defaultPanelGeometry('query', viewport),
            collapsed: false,
        },
        results: {
            mode: 'docked',
            geometry: defaultPanelGeometry('results', viewport),
            collapsed: false,
        },
    };
}

export function normalizeWorkspacePanelLayout(
    layout: WorkspacePanelLayout,
    viewport: ViewportSize,
): WorkspacePanelLayout {
    return {
        version: 1,
        splitRatio: clampPanelSplitRatio(layout.splitRatio),
        query: {
            ...layout.query,
            mode: 'docked',
            geometry: normalizePanelGeometry(layout.query.geometry, viewport),
        },
        results: {
            ...layout.results,
            mode: 'docked',
            geometry: normalizePanelGeometry(layout.results.geometry, viewport),
        },
    };
}

export function recoverWorkspacePanelLayout(
    raw: string | null,
    viewport: ViewportSize,
): WorkspacePanelLayout {
    if (!raw) return defaultWorkspacePanelLayout(viewport);
    try {
        const candidate = JSON.parse(raw) as {
            splitRatio?: unknown;
            query?: unknown;
            results?: unknown;
        };
        return {
            version: 1,
            splitRatio: finite(candidate.splitRatio)
                ? clampPanelSplitRatio(candidate.splitRatio)
                : 0.54,
            query: panelState(candidate.query, 'query', viewport),
            results: panelState(candidate.results, 'results', viewport),
        };
    } catch {
        return defaultWorkspacePanelLayout(viewport);
    }
}
