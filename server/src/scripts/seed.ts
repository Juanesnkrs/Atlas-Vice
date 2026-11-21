// Seed idempotente (upserts por _id). Datos de ejemplo replicados desde src/data/seed.ts
// (seedData.json, mismos UUID). Uso: pnpm --dir server seed
// Con `--base` solo crea los 7 módulos, la config global y los índices (sin datos de ejemplo):
// pensado para entornos reales cuyo contenido llega por `import:catalog`.
import type { Model } from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { getGlobalConfig } from '../models/AppConfig.js';
import { Entity, type EntityDoc } from '../models/Entity.js';
import { ForumPost, type ForumPostDoc } from '../models/ForumPost.js';
import { ForumThread, type ForumThreadDoc } from '../models/ForumThread.js';
import { MapMarker, type MapMarkerDoc } from '../models/MapMarker.js';
import { Module, type ModuleDoc } from '../models/Module.js';
import { User, type UserDoc } from '../models/User.js';
import { OfficialNews } from '../models/OfficialNews.js';
import { Submission } from '../models/Submission.js';
import { slugify } from '../services/submissions.js';
import { createHash } from 'node:crypto';
import raw from './seedData.json' with { type: 'json' };

interface WithId {
  id: string;
  created_at: string;
}

async function upsertAll<D extends { _id: string }>(
  label: string,
  model: Model<D>,
  rows: Array<Record<string, unknown> & WithId>,
): Promise<void> {
  if (rows.length === 0) return;
  const ops = rows.map((r) => {
    const { id, created_at, ...rest } = r;
    return {
      updateOne: {
        filter: { _id: id },
        update: { $set: { ...rest, created_at: new Date(created_at) } },
        upsert: true,
      },
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await model.bulkWrite(ops as any, { timestamps: false });
  console.log(`${label}: ${res.upsertedCount} nuevos, ${res.modifiedCount} actualizados, ${rows.length} total`);
}

const GUIAS_MODULE_ID = 'a71a5000-0000-4000-8000-000000000005';
const SEED_DATE = '2026-06-01T12:00:00.000Z';

interface Step {
  id: string;
  title: string;
  body: string;
}

/** Pasos ordenados {id,title,body} a partir del array de textos heredado (`pasos`). */
const toSteps = (pasos: unknown): Step[] =>
  (Array.isArray(pasos) ? (pasos as string[]) : []).map((body, i) => ({
    id: `paso-${i + 1}`,
    title: `Paso ${i + 1}`,
    body: String(body),
  }));

/** Asigna slug unico por modulo y, en guias, el array ordenado `steps` en metadata_json. */
function prepareEntities(): Array<Record<string, unknown> & WithId> {
  const used = new Set<string>();
  const rows = (raw.entities as Array<Record<string, unknown> & WithId>).map((e) => {
    const moduleId = String(e['module_id']);
    const base = slugify(String(e['titulo'])) || 'entrada';
    let slug = base;
    for (let i = 2; used.has(`${moduleId}:${slug}`); i += 1) slug = `${base}-${i}`;
    used.add(`${moduleId}:${slug}`);
    const meta = { ...((e['metadata_json'] as Record<string, unknown>) ?? {}) };
    if (moduleId === GUIAS_MODULE_ID) meta['steps'] = toSteps(meta['pasos']);
    return { ...e, slug, metadata_json: meta };
  });

  const extra = (n: string, slug: string, titulo: string, subtitulo: string, steps: Step[]) => {
    used.add(`${GUIAS_MODULE_ID}:${slug}`);
    return {
      id: `a71a5000-0000-4000-8000-0000000000${n}`,
      module_id: GUIAS_MODULE_ID,
      slug,
      titulo,
      subtitulo,
      categoria: 'Basicos',
      imagen_url: null,
      stats_json: {},
      metadata_json: { spoiler: false, body_md: subtitulo, lore_refs: [], steps },
      created_at: SEED_DATE,
    };
  };
  rows.push(
    extra('050', 'como-ganar-dinero-rapido', 'Cómo ganar dinero rápido', 'Rutas seguras para tus primeras ganancias en Leonida.', [
      { id: 'paso-1', title: 'Explora los comercios', body: 'Recorre Ocean Beach y localiza los comercios con menos vigilancia.' },
      { id: 'paso-2', title: 'Planifica la salida', body: 'Define una ruta de escape hacia Grassrivers antes de actuar.' },
      { id: 'paso-3', title: 'Cobra y desaparece', body: 'Cambia de vehículo y espera a que baje el nivel de búsqueda.' },
    ]),
    extra('051', 'domina-los-vehiculos-de-leonida', 'Domina los vehículos de Leonida', 'Consejos de conducción para coches, motos y lanchas.', [
      { id: 'paso-1', title: 'Elige según el terreno', body: 'Los deportivos rinden en autopista; las motos, en el tráfico urbano.' },
      { id: 'paso-2', title: 'Aprende el derrape', body: 'Suelta el acelerador antes de la curva y corrige con el freno de mano.' },
    ]),
  );
  return rows;
}

const makeNewsSlug = (title: string, url: string): string =>
  `${slugify(title).slice(0, 80) || 'noticia'}-${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;

/** Backfill: noticias ya ingeridas sin slug reciben uno (mismo formato que el worker). */
async function backfillNewsSlugs(): Promise<void> {
  const rows = await OfficialNews.find({ $or: [{ slug: { $exists: false } }, { slug: '' }] }).lean();
  if (!rows.length) return;
  await OfficialNews.bulkWrite(
    rows.map((n) => ({
      updateOne: { filter: { _id: n._id }, update: { $set: { slug: makeNewsSlug(n.title, n.sourceUrl) } } },
    })),
  );
  console.log(`news: ${rows.length} slugs asignados`);
}

async function main(): Promise<void> {
  await connectDb();

  if (process.argv.includes('--base')) {
    await upsertAll<ModuleDoc>('modules', Module, raw.modules as never);
    await getGlobalConfig();
    await Promise.all([Module, Entity, MapMarker, OfficialNews].map((m) => m.syncIndexes()));
    console.log('Seed base completado (solo módulos).');
    await disconnectDb();
    return;
  }

  await upsertAll<UserDoc>('users', User, raw.profiles as never);
  await upsertAll<ModuleDoc>('modules', Module, raw.modules as never);
  await upsertAll<EntityDoc>('entities', Entity, prepareEntities() as never);

  const markers = (raw.markers as Array<Record<string, unknown> & WithId & { coord_x: number; coord_y: number }>).map(
    ({ coord_x, coord_y, ...rest }) => ({ ...rest, coord: { x: Number(coord_x), y: Number(coord_y) } }),
  );
  await upsertAll<MapMarkerDoc>('map_markers', MapMarker, markers);

  await upsertAll<ForumThreadDoc>('forum_threads', ForumThread, raw.threads as never);
  await upsertAll<ForumPostDoc>('forum_posts', ForumPost, raw.posts as never);

  await backfillNewsSlugs();
  await getGlobalConfig(); // asegura el singleton AppConfig 'global'
  await Promise.all([User, Module, Entity, MapMarker, ForumThread, ForumPost, OfficialNews, Submission].map((m) => m.syncIndexes()));
  console.log('Seed completado.');
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
