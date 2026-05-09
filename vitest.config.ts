import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'e2e', '.next', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/lib/**', 'src/shapes/**', 'src/weld-units/**', 'src/store/**'],
      exclude: [
        '**/*.{test,spec}.{ts,tsx}',
        '**/index.ts',
        'src/shapes/_base/types.ts',
        // Stuby / placeholdery — pokryjemy testami gdy domain layer dorobi
        // realną implementację. Przy obecnym stanie liczyłyby się jako
        // 0%-pokryte i tłumiłyby próg dla naprawdę testowanych modułów.
        'src/lib/snapEngine.ts',
        'src/shapes/registry.ts',
        'src/store/use-canvas-store.ts',
        'src/store/types.ts',
        // Cienkie wrappery wokół @supabase/ssr — eksportują pojedynczy
        // `createClient/createServerClient/updateSession`. Sensowne pokrycie
        // wymaga integracji (cookie roundtrip), które robią testy E2E.
        'src/lib/supabase/client.ts',
        'src/lib/supabase/server.ts',
        'src/lib/supabase/middleware.ts'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80
      }
    }
  }
});
