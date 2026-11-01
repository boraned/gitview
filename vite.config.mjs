import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer only. The main process (electron/*.cjs) runs straight from source.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome140',
    chunkSizeWarningLimit: 4000,
  },
});
