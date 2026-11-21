// Feature boundaries only, via eslint-plugin-boundaries.
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/elements': [
        {
          type: 'feature',
          pattern: 'src/features/*',
          mode: 'folder',
          capture: ['name'],
        },
      ],
    },
    rules: {
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [{ target: ['feature'], allow: 'index.ts' }],
        },
      ],
    },
  },
];
