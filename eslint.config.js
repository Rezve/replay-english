const tsPlugin = require('@typescript-eslint/eslint-plugin');
const importPlugin = require('eslint-plugin-import');
const globals = require('globals');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: ['.vite/**', 'out/**', 'dist/**', 'node_modules/**', 'eslint.config.js'],
  },
  // Disable conflicting ESLint core rules for TypeScript files
  tsPlugin.configs['flat/eslint-recommended'],
  // TypeScript recommended rules (includes parser + plugin setup)
  ...tsPlugin.configs['flat/recommended'],
  // Import plugin + globals (TypeScript files only)
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2017,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      // Use electron-aware import rules; disable no-unresolved since TypeScript handles resolution
      ...importPlugin.flatConfigs.electron.rules,
      'import/no-unresolved': 'off',
      'import/namespace': 'off',
      'import/default': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      // Restore v5 severity: was 'warn' in @typescript-eslint/recommended@5
      '@typescript-eslint/no-explicit-any': 'warn',
      // no-var-requires was renamed to no-require-imports in v8
      '@typescript-eslint/no-var-requires': 'off',
      // Allow _-prefixed variables to be unused (common convention for ignored params)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
