import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: './',
  build: {
    target: 'esnext', outDir: 'dist', sourcemap: false,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        poseTest: fileURLToPath(new URL('./pose-test.html', import.meta.url)),
      },
    },
  },
  server: { port: 5173, host: '0.0.0.0', strictPort: true },
  preview: { port: 4173, host: '0.0.0.0', strictPort: true }
});
