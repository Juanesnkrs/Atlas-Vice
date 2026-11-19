import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * `public/ref Leonida map/` contiene materiales de referencia locales (calca del Modo Editor): Vite los
 * copia al build con el resto de `public/`, asi que se eliminan de `dist/` al terminar para que el
 * despliegue sea ligero y no incluya activos de terceros.
 */
const stripLocalRefs = (): Plugin => ({
  name: 'strip-local-refs',
  apply: 'build',
  closeBundle() {
    rmSync(resolve(__dirname, 'dist', 'ref Leonida map'), { recursive: true, force: true });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), stripLocalRefs()],
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
