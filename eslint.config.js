import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Layer boundaries (docs/DECISIONS.md D1, D2). The model and the logic that works on it must
 * not depend on any renderer, UI framework or app state, so they stay testable in Node and
 * usable from a worker or server. Presentation lives in `scene`, `plan2d`, `ui`, `app` and
 * `state`; everything below is pure TypeScript.
 */
export const PURE_LAYERS = ['domain', 'catalog', 'engine', 'editor', 'ai', 'floorplan', 'persistence'];
const PRESENTATION_PACKAGES = {
  group: [
    'react',
    'react/*',
    'react-dom',
    'react-dom/*',
    'three',
    'three/*',
    '@react-three/*',
    'zustand',
    'zustand/*',
  ],
  message:
    'Pure layers must not depend on React, three.js, React Three Fiber or app state (docs/DECISIONS.md D2).',
};
const PRESENTATION_FOLDERS = {
  group: [
    '**/scene',
    '**/scene/**',
    '**/plan2d',
    '**/plan2d/**',
    '**/ui',
    '**/ui/**',
    '**/app',
    '**/app/**',
    '**/state',
    '**/state/**',
  ],
  message: 'Pure layers must not import presentation or app-state modules (docs/DECISIONS.md D2).',
};
const DYNAMIC_PRESENTATION_IMPORT = {
  selector: 'ImportExpression[source.value=/^(react|react-dom|three|@react-three\\/|zustand)(\\/|$)/]',
  message:
    'Pure layers must not load React, three.js, React Three Fiber or zustand, not even lazily (docs/DECISIONS.md D2).',
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', '.tmp', 'public/ocr'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Covers import, import type, export … from and `import x = require()` (static forms).
    files: PURE_LAYERS.map((layer) => `src/${layer}/**/*.{ts,tsx}`),
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [PRESENTATION_PACKAGES, PRESENTATION_FOLDERS] },
      ],
      'no-restricted-syntax': ['error', DYNAMIC_PRESENTATION_IMPORT],
    },
  },
  {
    // The domain model is the bottom layer: production code imports nothing else from the app.
    // (Its tests may build fixtures through the floor-plan pipeline and editor.)
    files: ['src/domain/**/*.{ts,tsx}'],
    ignores: ['src/domain/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            PRESENTATION_PACKAGES,
            PRESENTATION_FOLDERS,
            {
              group: ['../*', '../**'],
              message:
                'src/domain is the bottom layer and must not import other app layers (docs/DECISIONS.md D2).',
            },
          ],
        },
      ],
    },
  },
);
