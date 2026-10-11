import type { ChartKind } from './chart-types.js';

export interface CandlestickConfig {
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    bid?: number;
    ask?: number;
    spread?: number;
    quoteActivity?: number;
}

export interface ChartConfig {
    kind: ChartKind;
    x: number;
    groupBy?: number;
    ys: number[];
    title: string;
    candlestick?: CandlestickConfig;
}
