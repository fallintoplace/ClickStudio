import express from 'express';
import {
    CREATE_TABLE_COLUMN_TYPES,
    TableCreationService,
    type CreateTableColumn,
} from './create-table.js';
import { TableDeletionService } from './delete-table.js';
import { requireThat } from '../../system/requests/errors.js';
import { choice, record, text } from '../../system/requests/validation.js';
import type { Driver } from '../../app/types.js';
import { body, principal, id } from '../../system/requests/http.js';

export function registerTableRoutes({
    app,
    tableCreation,
    tableDeletion,
    driver,
}: {
    app: ReturnType<typeof express>;
    tableCreation: TableCreationService;
    tableDeletion: TableDeletionService;
    driver: Driver;
}) {
    app.post('/api/connections/:id/tables', async (req, res) => {
        const v = body(req),
            columnsValue = v.columns;
        requireThat(
            Array.isArray(columnsValue) && columnsValue.length <= 50,
            400,
            'TABLE_COLUMNS',
            'A table needs 1–50 columns',
        );
        const columns: CreateTableColumn[] = columnsValue.map((value: unknown) => {
            const column = record(value, 'column');
            requireThat(
                column.generatedId === undefined || typeof column.generatedId === 'boolean',
                400,
                'TABLE_COLUMNS',
                'Check the generated ID option',
            );
            return {
                name: text(column.name, 'column name', 128),
                type: choice(
                    column.type,
                    CREATE_TABLE_COLUMN_TYPES,
                    400,
                    'TABLE_COLUMN_TYPE',
                    'Choose a supported column type',
                ),
                ...(column.generatedId === true ? { generatedId: true } : {}),
            };
        });
        res.status(201).json(
            await tableCreation.create(
                principal(res),
                id(req),
                text(v.database, 'database', 128),
                text(v.table, 'table', 128),
                columns,
                text(v.orderBy, 'sorting key', 128),
            ),
        );
    });
    app.delete('/api/connections/:id/tables', async (req, res) => {
        const v = body(req);
        res.json(
            await tableDeletion.drop(
                principal(res),
                id(req),
                text(v.database, 'database', 128),
                text(v.table, 'table', 128),
                text(v.confirmation, 'confirmation', 300),
            ),
        );
    });
    app.get('/api/connections/:id/import-targets', async (req, res) => {
        driver.connection(principal(res), id(req));
        res.json(await driver.targets(id(req)));
    });
}
