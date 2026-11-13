import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo y en `vite preview` se imita lo que hace Apache: /api va a la API local.
const proxy = { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } };
// IPv4 explícito: "localhost" puede resolver a ::1 (Windows, Node ≥ 17) y Playwright espera 127.0.0.1
const host = '127.0.0.1';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host, port: 5173, proxy },
  preview: { host, port: 4173, proxy },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
