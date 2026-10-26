import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'esnext', outDir: 'dist', sourcemap: false },
  server: { port: 5173, host: '0.0.0.0', strictPort: true },
  preview: { port: 4173, host: '0.0.0.0', strictPort: true }
});
