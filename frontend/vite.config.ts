/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  build: {
    outDir: '../chessmenthol/server/static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8765', ws: true },
      '/healthz': { target: 'http://127.0.0.1:8765' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
  },
});
