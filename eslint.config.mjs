import { fixupPluginRules } from '@eslint/compat';
import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

const importOrder = [
  'error',
  {
    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
    pathGroups: [{ pattern: '@/**', group: 'internal', position: 'after' }],
    pathGroupsExcludedImportTypes: ['builtin'],
    'newlines-between': 'ignore',
    alphabetize: { order: 'asc', caseInsensitive: true },
  },
];

export default tseslint.config(
  {
    files: ['tools/data-01/**/*.mjs'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      globals: { Buffer: 'readonly', console: 'readonly', process: 'readonly' },
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      'src/**/*.ts',
      'tests/**/*.ts',
      '*.config.mjs',
      'tools/boot-01/**/*.mjs',
      'tools/store-01/**/*.mjs',
      'tools/data-03/**/*.mjs',
      'tools/rag-01/**/*.mjs',
      'tools/ref-01/**/*.mjs',
      'tools/uc-01/**/*.mjs',
      'tools/uc-02/**/*.mjs',
    ],
    // Plugin 2.32 uses SourceCode APIs removed in ESLint 10.
    plugins: { import: fixupPluginRules(importPlugin) },
    rules: {
      curly: ['error', 'all'],
      'import/order': importOrder,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?:\\.{1,2}(?:/|$)|#)',
              message: 'Use @/*, @tests/*, or @contracts/* for project imports.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/^[.#]/]',
          message: 'Use an @ path alias for dynamic project imports.',
        },
        {
          selector:
            'ImportExpression > TemplateLiteral > TemplateElement:first-child[value.raw=/^[.#]/]',
          message: 'Use an @ path alias for dynamic project imports.',
        },
        {
          selector: 'TSImportType[source.value=/^[.#]/]',
          message: 'Use an @ path alias for project type imports.',
        },
      ],
    },
  },
);
