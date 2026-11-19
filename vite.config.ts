import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `pnpm preview` (4173) reenvia la API y el SEO a Fastify (3000), igual que `pnpm dev`.
  preview: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/sitemap.xml': 'http://localhost:3000',
      '/robots.txt': 'http://localhost:3000',
    },
  },
});
