import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env.MEMENTO_API_PORT ?? '4500';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: process.env.MEMENTO_HOST ?? '127.0.0.1',
    port: Number(process.env.MEMENTO_WEB_DEV_PORT ?? 4501),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
  build: { outDir: 'dist', sourcemap: false },
});
