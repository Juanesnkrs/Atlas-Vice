// Importa fichas del catálogo revisadas (JSON normalizado) a la colección Entity (y MapMarker).
// Uso: pnpm --dir server import:catalog <archivo.json> [--apply] [--source <nombre>] [--replace-source <nombre>]
// Sin --apply solo simula. Upsert por (module_id, slug). Marca cada ficha con metadata_json.fuente = --source
// (por defecto 'editorial'). Nunca pisa entidades de otra fuente: solo las de --source y, si se indica,
// las de --replace-source (p. ej. 'grabacion') cuyo (módulo, slug) coincida con una ficha del lote.
// Caso especial: --replace-source seed incluye también las entidades del seed sin metadata_json.fuente.
// Bloque opcional `marker` por ficha: upsert en MapMarker (entity_id, region, titulo, descripcion, coord).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { connectDb, disconnectDb } from '../config/db.js';
import { Entity, entitySchema } from '../models/Entity.js';
import { MapMarker, mapMarkerSchema } from '../models/MapMarker.js';
import { Module } from '../models/Module.js';

const DEFAULT_SOURCE = 'editorial';
const sourceSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/i, 'nombre de fuente inválido (a-z, 0-9, _ y -, máx. 40)');

/** Lee el valor de una opción `--nombre <valor>`; undefined si no está. */
function optionValue(flags: string[], name: string): string | undefined {
  const i = flags.indexOf(name);
  if (i === -1) return undefined;
  const v = flags[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`${name} requiere un valor`);
  return v;
}

const markerBlockSchema = z.object({
  region: z.string().min(1),
  coord_x: z.number().finite(),
  coord_y: z.number().finite(),
  descripcion: z.string().optional(),
});

const fichaSchema = z.object({
  modulo: z.string().min(1),
  slug: z.string(),
  titulo: z.string(),
  subtitulo: z.string().nullable().optional(),
  categoria: z.string(),
  stats_juego: z.record(z.string(), z.number().min(0).max(10)).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  confianza: z.enum(['alta', 'media', 'baja']),
  evidencia: z.array(z.string()).max(5).default([]),
  notas: z.union([z.string(), z.array(z.string())]).optional(),
  marker: markerBlockSchema.optional(),
});
type Ficha = z.infer<typeof fichaSchema>;

async function main(): Promise<void> {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) throw new Error('Falta la ruta del JSON. Uso: import:catalog <archivo.json> [--apply]');
  const apply = flags.includes('--apply');
  const source = sourceSchema.parse(optionValue(flags, '--source') ?? DEFAULT_SOURCE);
  const replaceRaw = optionValue(flags, '--replace-source');
  const replaceSource = replaceRaw === undefined ? undefined : sourceSchema.parse(replaceRaw);
  const overwritable = new Set<string>([source, ...(replaceSource ? [replaceSource] : [])]);

  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const fichas = z.array(fichaSchema).parse(raw);

  await connectDb();
  const modules = await Module.find({}, { _id: 1, slug: 1 }).lean();
  const moduleId = new Map(modules.map((m) => [m.slug, m._id]));

  const resumen = { nuevas: 0, actualizadas: 0, reemplazadas: 0, conflictos: 0, errores: 0, marcadores: 0 };
  for (const f of fichas as Ficha[]) {
    const module_id = moduleId.get(f.modulo);
    if (!module_id) {
      resumen.errores++;
      console.error(`✗ ${f.modulo}/${f.slug}: el módulo "${f.modulo}" no existe`);
      continue;
    }
    // Barras de la UI en 0-100; el valor exacto del juego (0-10) queda en metadata_json.stats_juego.
    const stats_json = Object.fromEntries(Object.entries(f.stats_juego).map(([k, v]) => [k, Math.round(v * 10)]));
    const parsed = entitySchema.safeParse({
      module_id,
      slug: f.slug,
      titulo: f.titulo,
      subtitulo: f.subtitulo ?? null,
      categoria: f.categoria,
      stats_json,
      metadata_json: {
        ...f.metadata,
        stats_juego: f.stats_juego,
        ...(f.notas !== undefined ? { notas: f.notas } : {}),
        fuente: source,
        confianza: f.confianza,
        evidencia: f.evidencia,
      },
    });
    if (!parsed.success) {
      resumen.errores++;
      console.error(`✗ ${f.modulo}/${f.slug}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      continue;
    }
    const { id: _id, ...doc } = parsed.data;
    // Valida el marcador antes de tocar nada (campos aprobados de MapMarker).
    const markerParsed = f.marker
      ? mapMarkerSchema.safeParse({
          region: f.marker.region,
          titulo: f.titulo,
          descripcion: f.marker.descripcion ?? null,
          coord_x: f.marker.coord_x,
          coord_y: f.marker.coord_y,
        })
      : null;
    if (markerParsed && !markerParsed.success) {
      resumen.errores++;
      console.error(`✗ ${f.modulo}/${f.slug}: marker ${markerParsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      continue;
    }
    const existing = await Entity.findOne({ module_id, slug: f.slug }, { metadata_json: 1 }).lean();
    const prevSource = (existing?.metadata_json as Record<string, unknown> | undefined)?.fuente;
    // Con --replace-source seed también se reemplazan las entidades legadas del seed que no llevan fuente
    // etiquetada (null o inexistente). Las que tienen fuente (editorial, grabacion, gtabase...) solo se pisan si
    // esa fuente está en `overwritable`.
    const isUntaggedSeed = replaceSource === 'seed' && (prevSource === undefined || prevSource === null);
    if (existing && !isUntaggedSeed && (typeof prevSource !== 'string' || !overwritable.has(prevSource))) {
      resumen.conflictos++;
      console.warn(`! ${f.modulo}/${f.slug}: ya existe una entidad no importada con ese slug; se omite`);
      continue;
    }
    if (!existing) resumen.nuevas++;
    else if (prevSource === source) resumen.actualizadas++;
    else resumen.reemplazadas++;
    // _id explícito: el upsert no aplica el default UUID de Mongoose y Mongo pondría un ObjectId.
    if (apply) {
      await Entity.updateOne(
        { module_id, slug: f.slug },
        { $set: doc, $setOnInsert: { _id: _id ?? randomUUID() } },
        { upsert: true },
      );
    }
    if (markerParsed?.success) {
      resumen.marcadores++;
      if (apply) {
        const ent = await Entity.findOne({ module_id, slug: f.slug }, { _id: 1 }).lean();
        if (ent) {
          const m = markerParsed.data;
          await MapMarker.updateOne(
            { entity_id: ent._id },
            {
              $set: {
                entity_id: ent._id,
                region: m.region,
                titulo: m.titulo,
                descripcion: m.descripcion ?? null,
                coord: { x: m.coord_x, y: m.coord_y },
              },
              $setOnInsert: { _id: randomUUID() },
            },
            { upsert: true },
          );
        }
      }
    }
  }

  console.log(`${apply ? 'APLICADO' : 'SIMULACIÓN (usa --apply para escribir)'} [fuente=${source}${replaceSource ? `, reemplaza=${replaceSource}` : ''}]:`, resumen);
  await disconnectDb();
  if (resumen.errores > 0) process.exitCode = 1;
}

main().catch(async (err: unknown) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
