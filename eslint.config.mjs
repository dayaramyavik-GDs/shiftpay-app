import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'platforms/', 'plugins/', 'www/lib/', 'dist/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['www/js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.mjs', '*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
  },
];
