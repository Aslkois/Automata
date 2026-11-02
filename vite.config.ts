/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` produces relative asset URLs so the build works from any
// sub-path (e.g. https://<user>.github.io/<repo>/) without per-repo config.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          blockly: ['blockly'],
          xyflow: ['@xyflow/react'],
          codemirror: ['codemirror', '@codemirror/lang-javascript', '@codemirror/autocomplete', '@codemirror/lint'],
        },
      },
    },
  },
  test: {
    include: ['tests/sim/**/*.test.ts', 'tests/program/**/*.test.ts', 'tests/ui/**/*.test.tsx'],
    environment: 'node',
  },
});
