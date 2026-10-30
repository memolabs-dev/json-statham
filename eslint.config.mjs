import tseslint from 'typescript-eslint';
export default tseslint.config(...tseslint.configs.recommended, {
  files: ['test/**/*.mjs'],
  languageOptions: { globals: { process: 'readonly' } },
});
