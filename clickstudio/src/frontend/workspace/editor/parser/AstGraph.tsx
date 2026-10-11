import { useMemo } from 'react';
import { buildNativeAstTree } from './ast';
import type { Copy } from '../../../common/translations/i18n';
import { TreeGraph } from '../../../common/components/TreeGraph';

function category(type: string) {
    if (type === 'Function') return 'function';
    if (type === 'Literal') return 'literal';
    if (type === 'Identifier' || type === 'TableIdentifier') return 'identifier';
    if (type === 'ExpressionList') return 'list';
    if (/Query|Select/.test(type)) return 'query';
    return 'other';
}

export function AstGraph({ ast, copy }: { ast: unknown; copy: Copy['common'] }) {
    const model = useMemo(() => buildNativeAstTree(ast), [ast]);
    return (
        <TreeGraph
            model={model}
            copy={copy}
            resetKey={ast}
            category={category}
            presentation={{
                label: copy.sqlFlowNativeAst,
                heading: copy.sqlFlowNativeAst,
                hint: copy.sqlAstGraphHint,
                empty: copy.sqlAstUnavailable,
                truncated: copy.sqlAstTruncatedWarning,
                selectedNode: copy.sqlAstSelectedNode,
                typeAttribute: 'data-ast-node-type',
                pathAttribute: 'data-ast-node-path',
            }}
        />
    );
}
