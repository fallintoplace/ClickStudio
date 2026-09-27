import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/vendor/**",
      "**/.vercel/**",
      "**/.core-build/**",
      "**/.workspace-build/**",
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "max-depth": ["error", 6],
      "max-params": ["error", 8],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      "prefer-const": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["core/**/*.{ts,tsx}", "server/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}", "scripts/**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {
      "complexity": ["error", 50],
      "max-lines-per-function": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "complexity": ["error", 180],
      "max-lines-per-function": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["web/Workspace.tsx"],
    rules: {
      "complexity": ["error", 300],
      "max-lines-per-function": ["error", { max: 850, skipBlankLines: true, skipComments: true }],
    },
  },
]);
