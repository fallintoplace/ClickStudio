import { clampPanelSplitRatio } from './workspace-layout';
import type { WorkspacePanelController } from './panels/useWorkspacePanels';

export function WorkspacePanelSplitter({ panels }: { panels: WorkspacePanelController }) {
    if (!panels.canSplitPanels) return null;
    return (
        <div
            className="workspace-panel-splitter"
            role="separator"
            aria-label="Resize query and output panels"
            aria-orientation="horizontal"
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(panels.panelLayout.splitRatio * 100)}
            tabIndex={0}
            onPointerDown={panels.startPanelSplit}
            onKeyDown={event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                const delta = event.key === 'ArrowUp' ? -0.05 : 0.05;
                panels.setPanelLayout(current => ({
                    ...current,
                    splitRatio: clampPanelSplitRatio(current.splitRatio + delta),
                }));
            }}
        >
            <span />
        </div>
    );
}
