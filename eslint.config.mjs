import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'empty.js'
    ]
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },
  // Canvas-kit boundary (architecture §22.3). Wymusza, żeby silnik canvasu
  // (Konva / PixiJS) był importowany wyłącznie z dwóch dozwolonych miejsc.
  // Wymiana silnika = lokalna zmiana w `src/canvas-kit/impl-*`, nie ogólny
  // refactor. Pierwszy nieautoryzowany import crashuje CI.
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['konva', 'konva/*', 'react-konva'],
              message:
                'Importuj z @/canvas-kit. Konva legalna tylko w src/canvas-kit/impl-konva i src/components/canvas/.'
            },
            {
              group: ['pixi.js', '@pixi/*'],
              message: 'Importuj z @/canvas-kit. Pixi legalne tylko w src/canvas-kit/impl-pixi.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/canvas-kit/impl-konva/**', 'src/components/canvas/**'],
    rules: { 'no-restricted-imports': 'off' }
  },
  {
    files: ['src/canvas-kit/impl-pixi/**'],
    rules: { 'no-restricted-imports': 'off' }
  }
];

export default eslintConfig;
