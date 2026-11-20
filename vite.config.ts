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

/**
 * Los modulos privados de gestion salen en `dist/_staff/assets/` con prefijo `staff-` (moderacion y catalogo)
 * o `staff-ctl-` (nivel maximo). Se cargan con import() dinamico solo tras confirmar el rol; el servidor
 * protege la ruta `/_staff/assets/*`. Los modulos compartidos con el resto de la app NO se agrupan aqui.
 */
const staffChunk = (id: string): string | undefined => {
  const p = id.replace(/\\/g, '/');
  if (/\/components\/ui\/(StaffControl|StaffIdentity|StaffAudit)\.tsx$/.test(p)) return 'staff-ctl-panel';
  if (
    /\/(components\/ui\/(StaffKit|StaffModeration|StaffCommunity|StaffContent|StaffEditorial)|pages\/StaffPage)\.tsx$/.test(p)
  ) {
    return 'staff-panel';
  }
  // Las dependencias compartidas van a un chunk publico propio: sin esto el bundler las aloja en un chunk staff-*.
  if (p.includes('/node_modules/')) return 'vendor';
  if (/\/src\/(data|store|types|components\/layout)\//.test(p)) return 'core';
  return undefined;
};

export default defineConfig({
  plugins: [react(), tailwindcss(), stripLocalRefs()],
  build: {
    rollupOptions: {
      output: {
        advancedChunks: { includeDependenciesRecursively: false, groups: [{ name: (id: string) => staffChunk(id) ?? null }] },
        chunkFileNames: (chunk) => (chunk.name.startsWith('staff-') ? '_staff/assets/[name]-[hash].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
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
