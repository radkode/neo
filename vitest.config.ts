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
    },
  },
});
