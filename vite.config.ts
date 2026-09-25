import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: true,
  },
  server: { host: true, port: 5173 },
  preview: { port: 4173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
