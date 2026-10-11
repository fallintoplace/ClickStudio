export const MONITOR_CONDITIONS = ['changed', 'nonempty', 'failure'] as const;
export type MonitorCondition = (typeof MONITOR_CONDITIONS)[number];
