import type { ResultCompleteness } from '../execution/status.js';
import type { Column, Row } from '../../common/values.js';

export interface Result {
    runId: string;
    queryId: string;
    columns: Column[];
    rows: Row[];
    completeness: ResultCompleteness;
    createdAt: string;
    expiresAt: string;
}

export interface ResultPage extends Omit<Result, 'rows'> {
    rows: Row[];
    offset: number;
    totalRows: number;
    nextOffset: number | null;
}
