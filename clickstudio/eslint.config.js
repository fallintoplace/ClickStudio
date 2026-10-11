import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default defineConfig([
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/playwright-report/**',
            '**/test-results/**',
            '**/vendor/**',
            '**/.vercel/**',
            '**/.core-build/**',
            '**/.workspace-build/**',
        ],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
    },
    {
        files: ['**/*.{js,mjs,cjs,ts,tsx}'],
        extends: [js.configs.recommended, tseslint.configs.recommended],
        plugins: {
            '@stylistic': stylistic,
            sonarjs,
        },
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            '@stylistic/max-len': [
                'error',
                {
                    code: 100,
                    tabWidth: 4,
                    ignoreUrls: true,
                    ignoreStrings: true,
                    ignoreTemplateLiterals: true,
                    ignoreRegExpLiterals: true,
                },
            ],
            'max-depth': ['error', 6],
            'max-params': ['error', 8],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-nested-ternary': 'error',
            'sonarjs/cognitive-complexity': ['error', 25],
            'no-useless-escape': 'off',
            'prefer-const': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        files: [
            'src/backend/**/*.{ts,tsx}',
            'src/shared/**/*.{ts,tsx}',
            'scripts/**/*.{js,mjs,cjs,ts,tsx}',
        ],
        rules: {
            complexity: ['error', 50],
            'max-lines-per-function': [
                'error',
                { max: 300, skipBlankLines: true, skipComments: true },
            ],
        },
    },
    {
        files: ['src/frontend/**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            complexity: ['error', 180],
            'max-lines-per-function': [
                'error',
                { max: 400, skipBlankLines: true, skipComments: true },
            ],
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'error',
        },
    },
    {
        files: [
            'src/frontend/assistant/proposals/assistant-proposal.ts',
            'src/frontend/database/connections/selection.ts',
            'src/frontend/workspace/editor/tools.ts',
            'src/frontend/workspace/queries/history/evidence.ts',
            'src/frontend/workspace/queries/inspection/performance/explain-analyze.ts',
            'src/frontend/workspace/queries/inspection/plans/explain-indexes.ts',
            'src/frontend/workspace/results/maps/geo.ts',
            'src/frontend/workspace/editor/parser/ast.ts',
            'src/frontend/database/explorer/format.ts',
            'src/frontend/database/explorer/objects/model.ts',
            'src/frontend/common/requests/sources/playground-values.ts',
            'src/frontend/workspace/queries/inspection/diagrams/query-tree.ts',
            'src/frontend/workspace/queries/history/comparison.ts',
            'src/frontend/workspace/queries/execution/events.ts',
            'src/frontend/common/components/tree-model.ts',
            'src/frontend/workspace/queries/saved-queries/draft-save.ts',
        ],
        rules: {
            complexity: ['error', 50],
            'max-lines-per-function': [
                'error',
                { max: 300, skipBlankLines: true, skipComments: true },
            ],
        },
    },
    {
        files: ['src/backend/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/frontend/**'],
                            message: 'Backend code can import backend and shared modules.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/shared/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/frontend/**', '**/backend/**', 'node:*'],
                            message: 'Shared code must work in both the browser and the server.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/frontend/**/*.{ts,tsx}'],
        ignores: ['src/frontend/app/main.tsx'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/backend/**', 'node:*'],
                            message: 'Frontend code can import frontend and shared modules.',
                        },
                        {
                            group: ['**/*.css'],
                            message:
                                'Import application styles through src/frontend/common/styles/main.css to keep cascade order explicit.',
                        },
                    ],
                },
            ],
        },
    },
]);
