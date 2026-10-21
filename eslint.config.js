import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dist-test', 'build', 'node_modules', 'coverage', 'test-results', 'playwright-report', 'src/sw-template.js'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
