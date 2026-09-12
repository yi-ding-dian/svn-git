/** ESLint 配置（flat config）。
 *
 *  重点：用 react-hooks 规则抓 hooks 依赖数组/调用规范问题——这类问题不会报错，
 *  只会让 effect 捕获到旧闭包，属于最难查的一类 bug。
 *
 *  背景：项目里原有 21 处 `eslint-disable-line react-hooks/exhaustive-deps` 注释，
 *  但当时并未安装 ESLint（等于在关一个不存在的检查器，注释空转）。本配置让这些抑制真正生效。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-appimage/**',
      '.build/**',
      'build/**',
      'node_modules/**',
      'svngit-test/**',
      'test2/**',
      'scripts/**',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // 未使用变量：允许 _ 前缀（占位参数）
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // any 目前仅 2 处（vcs/svn.ts 的 XML 回调、web/api.ts 的 JSON 中转），保持可见即可
      '@typescript-eslint/no-explicit-any': 'warn',
      // 空块多是「忽略错误」的既有写法，不强制
      'no-empty': ['error', { allowEmptyCatch: true }],
      // ---- 以下规则对既有代码误报多或属纯风格，关闭/降级，避免淹没真问题 ----
      // 「先给默认值（let x = ''），再由 if/else 分支覆盖」被误判为无用赋值（实测 12 处全为此模式）
      'no-useless-assignment': 'off',
      // 要求 throw 时附 cause，改动 30+ 处 throw、收益低
      'preserve-caught-error': 'off',
      'prefer-const': 'warn',
      'no-regex-spaces': 'warn',
      // 中文注释里用全角空格排版是常态，只对代码部分生效
      'no-irregular-whitespace': ['error', { skipComments: true }],
    },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // 浏览器端：声明全局对象，避免 no-undef 误报
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        Event: 'readonly',
        console: 'readonly',
      },
    },
  },
);
