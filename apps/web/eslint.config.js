import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
  ...svelte.configs['flat/recommended'],
  {
    files: ['src/**/*.ts', 'e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { parser: tseslint.parser }
  },
  {
    files: ['src/**/*.svelte'],
    languageOptions: { parserOptions: { parser: tseslint.parser } }
  }
);
