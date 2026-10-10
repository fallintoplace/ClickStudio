import type { QueryTree } from '../../shared/query-tree';
import type { Copy } from '../i18n';
import { TreeGraph } from './TreeGraph';

function category(type: string) {
    if (type === 'FUNCTION' || type === 'LAMBDA') return 'function';
    if (type === 'CONSTANT' || type === 'OUTPUT') return 'literal';
    if (type === 'COLUMN' || type === 'TABLE' || type === 'IDENTIFIER') return 'identifier';
    if (type === 'LIST') return 'list';
    if (type === 'QUERY' || type === 'ANALYZER') return 'query';
    return 'other';
}

export function QueryTreeGraph({ tree, copy }: { tree: QueryTree; copy: Copy['common'] }) {
    return (
        <TreeGraph
            model={tree}
            copy={copy}
            category={category}
            presentation={{
                label: copy.sqlFlowAnalyzer,
                heading: copy.queryTreeServer,
                hint: copy.queryTreeGraphHint,
                empty: copy.queryTreeNoOutput,
                truncated: copy.queryTreeTruncatedWarning,
                selectedNode: copy.queryTreeSelectedNode,
                typeAttribute: 'data-query-tree-type',
                pathAttribute: 'data-query-tree-path',
                inspectorClass: 'query-tree-node-inspector',
            }}
        />
    );
}
