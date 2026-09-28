export const CREATE_TABLE_COLUMN_TYPES = ['String', 'UInt64', 'Int64', 'Float64', 'Decimal(18, 2)', 'Date', 'DateTime', 'UUID'] as const;
export type CreateTableColumnType = (typeof CREATE_TABLE_COLUMN_TYPES)[number];

export interface CreateTableColumn {
    name: string;
    type: CreateTableColumnType;
    generatedId?: boolean;
}
