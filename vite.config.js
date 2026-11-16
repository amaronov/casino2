import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  // Относительные пути: сборка работает и на GitHub Pages (/casino2/), и из любой папки.
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173 },
});
