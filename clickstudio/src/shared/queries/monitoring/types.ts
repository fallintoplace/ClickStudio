import type { MonitorCondition } from './conditions.js';

export interface Monitor {
    id: string;
    owner: string;
    publishedId: string;
    intervalSeconds: number;
    paused: boolean;
    createdAt: string;
    nextAt: string;
    lastRunId?: string;
    lastHash?: string;
    condition: MonitorCondition;
}

export interface Notice {
    id: string;
    owner: string;
    monitorId: string;
    runId: string;
    createdAt: string;
    reason: MonitorCondition;
    read: boolean;
}
