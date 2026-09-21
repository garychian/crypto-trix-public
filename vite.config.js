import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        fund: resolve(__dirname, 'fund.html'),
        portfolio: resolve(__dirname, 'portfolio.html'),
        'cn-fund': resolve(__dirname, 'cn-fund.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
