import {
    MAX_SQL_FILE_BYTES,
    SQL_FILE_SIZE_LABEL,
} from '../../../../shared/queries/execution/limits';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../common/requests/api';
import { cloudImportDatabases } from './cloud-import';
import {
    ImportMappingError,
    mapImportRows,
    type ImportMappingColumn,
} from '../../../../shared/database/imports/mapping';
import {
    useImportWizardController,
    type ImportWizardControllerOptions,
} from '../useImportWizardController';
import type { Json } from '../../../../shared/common/values';

function findLiveMappingIssue(
    sourceRows: Record<string, Json>[],
    fields: Record<string, string>,
    destinationColumns: ImportMappingColumn[],
) {
    for (const [source, destination] of Object.entries(fields)) {
        const column = destinationColumns.find(candidate => candidate.name === destination);
        if (!column) continue;
        try {
            mapImportRows(sourceRows, [source], { [source]: destination }, [column]);
        } catch (caught) {
            if (
                caught instanceof ImportMappingError &&
                ['IMPORT_NULL_VALUE', 'IMPORT_VALUE_TYPE'].includes(caught.code)
            )
                return { source, message: caught.message };
        }
    }
    return undefined;
}

export function useImportWizardView(
    controller: ReturnType<typeof useImportWizardController>,
    controllerProps: Pick<ImportWizardControllerOptions, 'open' | 'onClose'>,
    onImportQuery: (name: string, sql: string) => boolean,
) {
    const {
        step,
        setStep,
        preview,
        target,
        schema,
        mapping,
        recoveryState,
        error,
        browserCloudImport,
        availableTargets,
        destinationColumns,
        creatingTable,
        createColumns,
        selectedFields,
        chooseFile,
        previewSampleFile,
    } = controller;
    const errorAlertRef = useRef<HTMLParagraphElement>(null);
    const hasCreateIdColumn = createColumns.some(column => column.name.toLowerCase() === 'id');
    const importableDatabases = cloudImportDatabases(schema);
    const mappedFields = mapping?.fields ?? selectedFields;
    const mappedColumnCount =
        preview?.columns.filter(source => Boolean(mappedFields[source])).length ?? 0;
    const skippedColumnCount = (preview?.columns.length ?? 0) - mappedColumnCount;
    const mappedDestinations = new Set(Object.values(mappedFields).filter(Boolean));
    const omittedDestinationColumns = destinationColumns.filter(
        column => !mappedDestinations.has(column.name),
    );
    const missingSourceFields = Object.entries(mapping?.missingFields ?? {}).filter(
        ([, count]) => count > 0,
    );
    const [importKind, setImportKind] = useState<'rows' | 'query'>('rows');
    const [queryFile, setQueryFile] = useState<File>();
    const [queryFileError, setQueryFileError] = useState('');
    const [openingQuery, setOpeningQuery] = useState(false);
    const [destinationChoice, setDestinationChoice] = useState<'existing' | 'create'>();
    const getDefaultDestinationChoice = (): 'existing' | 'create' | undefined => {
        if (creatingTable) {
            return 'create';
        }

        if (target) {
            return 'existing';
        }

        if (browserCloudImport && availableTargets.length) {
            return 'existing';
        }

        return undefined;
    };
    const selectedDestinationChoice = destinationChoice ?? getDefaultDestinationChoice();
    const liveMappingIssue = useMemo(() => {
        if (
            !preview ||
            importKind !== 'rows' ||
            step !== 'mapping' ||
            !target ||
            !destinationColumns.length
        )
            return undefined;
        return findLiveMappingIssue(preview.rows, selectedFields, destinationColumns);
    }, [destinationColumns, importKind, preview, selectedFields, step, target]);

    useEffect(() => {
        if (!controllerProps.open) {
            setDestinationChoice(undefined);
            return;
        }
        setImportKind('rows');
        setQueryFile(undefined);
        setQueryFileError('');
        setOpeningQuery(false);
        setDestinationChoice(undefined);
    }, [controllerProps.open]);

    useEffect(() => {
        if (!error || importKind !== 'rows' || recoveryState === 'failed') return;
        const alert = errorAlertRef.current;
        if (!alert) return;
        alert.focus({ preventScroll: true });
        alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [error, importKind, recoveryState]);

    function chooseQueryFile(next?: File) {
        setQueryFile(next);
        setQueryFileError('');
        if (!next) return;
        if (!next.name.toLowerCase().endsWith('.sql')) setQueryFileError('Choose a .sql file.');
        else if (next.size > MAX_SQL_FILE_BYTES)
            setQueryFileError(`SQL files must be ${SQL_FILE_SIZE_LABEL} or smaller.`);
    }

    function closeQueryMode() {
        if (preview?.id && !browserCloudImport)
            void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(
                () => undefined,
            );
        controllerProps.onClose();
    }

    function importAnotherFile() {
        if (preview?.id && !browserCloudImport)
            void api(`/imports/${encodeURIComponent(preview.id)}`, { method: 'DELETE' }).catch(
                () => undefined,
            );
        chooseFile(undefined);
        setDestinationChoice(undefined);
        setStep('file');
    }

    function chooseRowsFile(next?: File) {
        setDestinationChoice(undefined);
        chooseFile(next);
    }

    function loadSampleFile() {
        setDestinationChoice(undefined);
        void previewSampleFile();
    }

    async function openQueryFile() {
        if (!queryFile || queryFileError || openingQuery) return;
        setOpeningQuery(true);
        setQueryFileError('');
        try {
            const sql = await queryFile.text();
            if (!sql.trim()) {
                setQueryFileError('This SQL file is empty.');
                return;
            }
            const originalName =
                queryFile.name
                    .split(/[\\/]/)
                    .at(-1)
                    ?.replace(/\.sql$/i, '') ?? '';
            const safeName = originalName.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim();
            if (!onImportQuery(`${safeName || 'Imported query'}.sql`, sql)) return;
            closeQueryMode();
        } catch (caught) {
            setQueryFileError(
                caught instanceof Error ? caught.message : 'Could not read this SQL file.',
            );
        } finally {
            setOpeningQuery(false);
        }
    }
    return {
        errorAlertRef,
        hasCreateIdColumn,
        importableDatabases,
        mappedColumnCount,
        skippedColumnCount,
        omittedDestinationColumns,
        missingSourceFields,
        importKind,
        setImportKind,
        queryFile,
        queryFileError,
        openingQuery,
        selectedDestinationChoice,
        setDestinationChoice,
        liveMappingIssue,
        chooseQueryFile,
        closeQueryMode,
        importAnotherFile,
        chooseRowsFile,
        loadSampleFile,
        openQueryFile,
    };
}
