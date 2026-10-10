import { type ReactNode } from 'react';
import type { SchemaDictionary } from '../../../shared/types';
import {
    explorerCategoryId,
    explorerDictionaryId,
    type ExplorerRelation,
    type ObjectExplorerModel,
} from '../../../shared/object-explorer';
import type { ObjectExplorerProps } from './object-explorer-types';
import { ExplorerGroupRow } from './ObjectTreeRows';
import { ObjectLeafRow } from './ObjectTreeRows';

export function ObjectTree({
    treeScroll,
    copy,
    model,
    expanded,
    toggle,
    renderRelation,
    selectedId,
    selectObject,
}: {
    treeScroll: import('react').RefObject<HTMLDivElement | null>;
    copy: ObjectExplorerProps['copy'];
    model: ObjectExplorerModel;
    expanded: (id: string, forced?: boolean) => boolean;
    toggle: (id: string) => void;
    renderRelation: (relation: ExplorerRelation, level: number) => import('react').ReactElement;
    selectedId: string | undefined;
    selectObject: (id: string) => void;
}) {
    return (
        <div className="object-tree-scroll" ref={treeScroll}>
            <div className="object-tree" role="tree" aria-label={copy.objects}>
                {model.databases.map(database => {
                    const databaseExpanded = expanded(database.id, Boolean(model.query));
                    return (
                        <div className="object-tree-branch" key={database.id}>
                            <ExplorerGroupRow
                                level={1}
                                label={database.name}
                                count={database.visibleObjectCount}
                                expanded={databaseExpanded}
                                onToggle={() => toggle(database.id)}
                                database
                            />
                            {databaseExpanded && (
                                <div role="group" className="object-tree-children">
                                    {database.tables.length > 0 && (
                                        <ObjectCategory
                                            label={copy.tables}
                                            kind="table"
                                            database={database.name}
                                            relations={database.tables}
                                            level={2}
                                            query={model.query}
                                            expanded={expanded}
                                            toggle={toggle}
                                            renderRelation={renderRelation}
                                        />
                                    )}
                                    {database.views.length > 0 && (
                                        <ObjectCategory
                                            label={copy.views}
                                            kind="view"
                                            database={database.name}
                                            relations={database.views}
                                            level={2}
                                            query={model.query}
                                            expanded={expanded}
                                            toggle={toggle}
                                            renderRelation={renderRelation}
                                        />
                                    )}
                                    {database.dictionaries.length > 0 && (
                                        <DictionaryCategory
                                            label={copy.dictionaries}
                                            database={database.name}
                                            dictionaries={database.dictionaries}
                                            level={2}
                                            query={model.query}
                                            expanded={expanded}
                                            toggle={toggle}
                                            selectedId={selectedId}
                                            onSelect={selectObject}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ObjectCategory({
    label,
    kind,
    database,
    relations,
    level,
    query,
    expanded,
    toggle,
    renderRelation,
}: {
    label: string;
    kind: 'table' | 'view';
    database: string;
    relations: readonly ExplorerRelation[];
    level: number;
    query: string;
    expanded: (id: string, forced?: boolean) => boolean;
    toggle: (id: string) => void;
    renderRelation: (relation: ExplorerRelation, level: number) => ReactNode;
}) {
    const id = explorerCategoryId(database, kind);
    const open = expanded(id, Boolean(query));
    return (
        <div className="object-tree-branch">
            <ExplorerGroupRow
                level={level}
                label={label}
                count={relations.length}
                expanded={open}
                onToggle={() => toggle(id)}
                kind={kind}
            />
            {open && (
                <div role="group">
                    {relations.map(relation => renderRelation(relation, level + 1))}
                </div>
            )}
        </div>
    );
}

function DictionaryCategory({
    label,
    database,
    dictionaries,
    level,
    query,
    expanded,
    toggle,
    selectedId,
    onSelect,
}: {
    label: string;
    database: string;
    dictionaries: readonly SchemaDictionary[];
    level: number;
    query: string;
    expanded: (id: string, forced?: boolean) => boolean;
    toggle: (id: string) => void;
    selectedId?: string;
    onSelect: (id: string) => void;
}) {
    const id = explorerCategoryId(database, 'dictionary');
    const open = expanded(id, Boolean(query));
    return (
        <div className="object-tree-branch">
            <ExplorerGroupRow
                level={level}
                label={label}
                count={dictionaries.length}
                expanded={open}
                onToggle={() => toggle(id)}
                kind="dictionary"
            />
            {open && (
                <div role="group">
                    {dictionaries.map(dictionary => {
                        const dictionaryId = explorerDictionaryId(
                            dictionary.database,
                            dictionary.name,
                        );
                        return (
                            <ObjectLeafRow
                                key={dictionaryId}
                                level={level + 1}
                                selected={selectedId === dictionaryId}
                                glyph="dictionary"
                                label={dictionary.name}
                                meta={dictionary.type || dictionary.status}
                                onSelect={() => onSelect(dictionaryId)}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}
