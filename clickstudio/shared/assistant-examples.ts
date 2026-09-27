import type { AssistantAction } from './types.js';

export interface AssistantExampleTable {
    database: string;
    table: string;
}

export interface AssistantContextExample {
    id: string;
    name: string;
    description: string;
    dataset: string;
    connectionId: string;
    keywords: readonly string[];
    tables: readonly AssistantExampleTable[];
    sql: string;
}

export const ONTIME_FLIGHT_DELAY_EXAMPLE = {
    id: 'ontime-flight-delay-operations',
    name: 'Flight Delay Operations',
    description: 'Spot seasonal departure-delay risk across nine years of US flight operations.',
    dataset: 'US flights',
    connectionId: 'playground',
    keywords: ['flight', 'flights', 'airline', 'airlines', 'airport', 'airports', 'ontime', 'delay', 'delays', 'delayed', 'departure', 'departures', 'depdelay'],
    tables: [{ database: 'ontime', table: 'ontime' }],
    sql: `SELECT
    Year AS year,
    Month AS month,
    round(100.0 * countIf(DepDelay > 10) / count(), 1) AS delayed_pct
FROM ontime.ontime
WHERE Year BETWEEN 2000 AND 2008
GROUP BY year, month
ORDER BY year, month`,
} as const satisfies AssistantContextExample;

export function selectAssistantExamples(input: {
    action: AssistantAction;
    connectionId: string;
    question: string;
    sql: string;
    evidenceSql?: string;
}): readonly AssistantContextExample[] {
    if (input.action !== 'ask' && input.action !== 'generate') return [];

    const words = new Set(input.question.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
    const referencesOnTime = /\bontime\s*\.\s*ontime\b/i.test([input.sql, input.evidenceSql].filter(Boolean).join('\n'));
    if (ONTIME_FLIGHT_DELAY_EXAMPLE.connectionId !== input.connectionId ||
        (!referencesOnTime && !ONTIME_FLIGHT_DELAY_EXAMPLE.keywords.some(keyword => words.has(keyword))))
        return [];

    return [ONTIME_FLIGHT_DELAY_EXAMPLE];
}
