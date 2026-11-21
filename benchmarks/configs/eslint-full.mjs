// Cycles + feature boundaries: import-x/no-cycle and eslint-plugin-boundaries.
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import boundaries from 'eslint-plugin-boundaries';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'import-x': importX, boundaries },
    settings: {
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
      'import-x/extensions': ['.ts', '.tsx'],
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/elements': [
        { type: 'feature', pattern: 'src/features/*', mode: 'folder', capture: ['name'] },
      ],
    },
    rules: {
      'import-x/no-cycle': 'error',
      'boundaries/entry-point': [
        'error',
        { default: 'disallow', rules: [{ target: ['feature'], allow: 'index.ts' }] },
      ],
    },
  },
];
