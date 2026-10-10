import type { IconName } from './components/ui.js';
import type { Inspector } from './workspace-types.js';

type PrimaryInspector = 'schema' | 'reference' | 'assistant';
type InspectorCopyKey = 'objects' | 'reference' | 'assistant' | 'queries' | 'history';

export type PrimaryInspectorDestination = Readonly<{
    group: 'primary';
    id: PrimaryInspector;
    icon: IconName;
    copyKey: InspectorCopyKey;
}>;

export type SecondaryInspectorDestination = Readonly<{
    group: 'more';
    id: Exclude<Inspector, PrimaryInspector>;
    icon: IconName;
    copyKey?: 'queries' | 'history';
    expertOnly?: boolean;
    requiresRun?: boolean;
    railSection?: 'browse' | 'execution';
}>;

type InspectorNavigationDestination = PrimaryInspectorDestination | SecondaryInspectorDestination;

export const INSPECTOR_NAVIGATION: readonly InspectorNavigationDestination[] = [
    { group: 'primary', id: 'schema', icon: 'schema', copyKey: 'objects' },
    { group: 'primary', id: 'reference', icon: 'reference', copyKey: 'reference' },
    { group: 'primary', id: 'assistant', icon: 'assistant', copyKey: 'assistant' },
    { group: 'more', id: 'history', icon: 'history', copyKey: 'history', railSection: 'browse' },
    {
        group: 'more',
        id: 'documents',
        icon: 'documents',
        copyKey: 'queries',
        railSection: 'browse',
    },
    { group: 'more', id: 'revisions', icon: 'history' },
    {
        group: 'more',
        id: 'details',
        icon: 'details',
        expertOnly: true,
        requiresRun: true,
        railSection: 'execution',
    },
    {
        group: 'more',
        id: 'pipeline',
        icon: 'pipeline',
        expertOnly: true,
        requiresRun: true,
        railSection: 'execution',
    },
    { group: 'more', id: 'parser', icon: 'parser', expertOnly: true, railSection: 'execution' },
];

export const PRIMARY_INSPECTOR_NAVIGATION = INSPECTOR_NAVIGATION.filter(
    (item): item is PrimaryInspectorDestination => item.group === 'primary',
);

export const EXPERT_BROWSE_NAVIGATION = INSPECTOR_NAVIGATION.filter(
    (item): item is SecondaryInspectorDestination =>
        item.group === 'more' && item.railSection === 'browse',
);

export const EXPERT_EXECUTION_NAVIGATION = INSPECTOR_NAVIGATION.filter(
    (item): item is SecondaryInspectorDestination =>
        item.group === 'more' && item.railSection === 'execution',
);

export function inspectorMoreNavigation(
    expert: boolean,
    hasRun: boolean,
): readonly SecondaryInspectorDestination[] {
    return INSPECTOR_NAVIGATION.filter(
        (item): item is SecondaryInspectorDestination =>
            item.group === 'more' && (!item.expertOnly || expert) && (!item.requiresRun || hasRun),
    );
}
