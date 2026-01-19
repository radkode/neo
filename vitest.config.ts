import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@/core': resolve(__dirname, './src/core'),
      '@/application': resolve(__dirname, './src/application'),
      '@/infrastructure': resolve(__dirname, './src/infrastructure'),
      '@/presentation': resolve(__dirname, './src/presentation'),
      '@/commands': resolve(__dirname, './src/commands'),
      '@/utils': resolve(__dirname, './src/utils'),
      '@/types': resolve(__dirname, './src/types'),
      '@/storage': resolve(__dirname, './src/storage'),
      '@/services': resolve(__dirname, './src/services'),
      '@/config': resolve(__dirname, './src/config'),
      '@/test': resolve(__dirname, './test'),
      '@/cli': resolve(__dirname, './src/cli.js'),
      '@/index': resolve(__dirname, './src/index.js'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts', '**/*.config.*', '**/coverage/**'],
      // Coverage thresholds - these can be increased as more tests are added
      thresholds: {
        // Per-file thresholds for critical modules
        'src/storage/db.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/utils/logger.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/utils/config.ts': {
          statements: 90,
          branches: 90,
          functions: 100,
          lines: 90,
        },
        'src/utils/validation.ts': {
          statements: 95,
          branches: 85,
          functions: 100,
          lines: 95,
        },
        'src/types/schemas.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
