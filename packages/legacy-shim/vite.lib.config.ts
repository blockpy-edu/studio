import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single-file drop-in for UNMODIFIED server templates (spec §15.1):
// publishes window.blockpy.BlockPy at load. Everything bundled, like the
// app's blockpy-studio.iife.js.
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  // The engine worker is a module worker; iife outer format can't
  // code-split, so the worker bundles as a single es file.
  worker: { format: 'es', rollupOptions: { output: { inlineDynamicImports: true } } },
  build: {
    outDir: 'dist-lib',
    lib: {
      entry: 'src/global.ts',
      name: 'BlockPyLegacyShim',
      formats: ['iife'],
      fileName: () => 'blockpy-studio-legacy.iife.js',
    },
  },
});
