import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  /** Painel hospedado em https://atualhub.com.br/painel/ — assets devem ser /painel/assets/... */
  base: '/painel/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true }
    }
  }
});
