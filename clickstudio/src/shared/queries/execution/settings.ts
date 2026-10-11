export interface Limits {
    rows: number;
    bytes: number;
    seconds: number;
    memory: number;
    threads: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
    rows: 5000,
    bytes: 2000000,
    seconds: 30,
    memory: 536870912,
    threads: 4,
});

export const HARD_LIMITS: Readonly<Limits> = Object.freeze({
    rows: 20000,
    bytes: 5000000,
    seconds: 120,
    memory: 1073741824,
    threads: 8,
});
