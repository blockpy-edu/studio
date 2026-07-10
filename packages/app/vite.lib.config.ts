import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Embeddable single-file build for third-party pages (spec §4): everything
// bundled (including React), exposed as window.BlockPyStudio.
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-lib',
    lib: {
      entry: 'src/index.ts',
      name: 'BlockPyStudio',
      formats: ['iife'],
      fileName: () => 'blockpy-studio.iife.js',
    },
  },
});
