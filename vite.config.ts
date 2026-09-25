import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // Rapier ships its WASM inlined (~2.5 MB); vendors are split so game updates stay small.
    chunkSizeWarningLimit: 3000,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('@dimforge/rapier3d')) return 'rapier';
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  server: { host: true, port: 5173 },
  preview: { port: 4173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
