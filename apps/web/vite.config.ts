import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const BACKEND_PORT = process.env.VITE_BACKEND_PORT || '3002';
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/assets': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/renders': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
});
