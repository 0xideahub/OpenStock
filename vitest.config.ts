import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      '@/lib': fileURLToPath(new URL('./lib', import.meta.url)),
    },
  },
  esbuild: {
    target: 'es2020',
  },
});
