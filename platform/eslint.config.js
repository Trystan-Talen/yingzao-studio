import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

const serverImports = ['**/server', '**/server/**', '**/worker', '**/worker/**'];
const webImports = ['**/web', '**/web/**'];
const nodeImports = [...new Set(builtinModules.map((name) => name.replace(/^node:/, '')))];
const browserBoundary = {
  paths: [...nodeImports, 'better-sqlite3', 'dotenv', 'fastify', 'nodemailer', 'stripe'],
  patterns: [
    {
      group: ['node:*', ...serverImports],
      message: '浏览器与共享合同不能依赖服务端或执行器；跨层数据通过共享合同定义。',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'var/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
    },
  },
  {
    files: ['src/web/**/*.{ts,tsx}', 'src/contracts/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { 'no-restricted-imports': ['error', browserBoundary] },
  },
  {
    files: ['src/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...browserBoundary,
          patterns: [
            ...browserBoundary.patterns,
            { group: webImports, message: '共享合同不能反向依赖界面实现。' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts', 'src/worker/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: webImports, message: '服务端与执行器不能导入浏览器界面实现。' }] },
      ],
    },
  },
  {
    files: ['src/worker/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    files: ['tests/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[property.name="only"], MemberExpression[property.value="only"]',
          message: '提交的测试不能保留 only；请用命令行筛选测试，避免静默跳过其它回归。',
        },
      ],
    },
  },
);
