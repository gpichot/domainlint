import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
export default [{ files: ['src/**/*.ts'], languageOptions: { parser: tseslint.parser },
  plugins: { 'import-x': importX },
  settings: {
    'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
    'import-x/extensions': ['.ts', '.tsx'],
    'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
  },
  rules: { 'import-x/no-cycle': 'error' } }];
