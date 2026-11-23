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
import { Entity } from '../models/Entity.js';
import { MapMarker } from '../models/MapMarker.js';
import { Module } from '../models/Module.js';
import {
  DEFAULT_SOURCE,
  ficheHashOf,
  fichaSchema,
  normalizeFicha,
  sourceSchema,
  type Ficha,
} from '../services/catalogIngest.js';

/** Lee el valor de una opción `--nombre <valor>`; undefined si no está. */
function optionValue(flags: string[], name: string): string | undefined {
  const i = flags.indexOf(name);
  if (i === -1) return undefined;
  const v = flags[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`${name} requiere un valor`);
  return v;
}

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
    const n = normalizeFicha(f, source, module_id);
    if (!n.ok) {
      resumen.errores++;
      console.error(`✗ ${f.modulo}/${f.slug}: ${n.message}`);
      continue;
    }
    const markerParsed = n.marker;
    for (const a of n.avisos) console.warn(`~ ${f.modulo}/${f.slug}: ${a}`);
    if (n.tarjeta) console.warn(`~ ${f.modulo}/${f.slug}: la tarjeta solo se procesa en la ingesta del pipeline (POST /api/pipeline/ingest); se ignora aquí`);
    const existing = await Entity.findOne({ module_id, slug: f.slug }, { metadata_json: 1, imagen_url: 1 }).lean();
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
    const doc = {
      ...n.doc,
      contentHash: ficheHashOf({ ...n, tarjeta: null }, existing?.imagen_url),
      ...(n.capturaPropiaPendiente ? { capturaPropiaPendiente: true } : {}),
    };
    // _id explícito: el upsert no aplica el default UUID de Mongoose y Mongo pondría un ObjectId.
    if (apply) {
      await Entity.updateOne(
        { module_id, slug: f.slug },
        { $set: doc, $setOnInsert: { _id: randomUUID() } },
        { upsert: true },
      );
    }
    if (markerParsed) {
      resumen.marcadores++;
      if (apply) {
        const ent = await Entity.findOne({ module_id, slug: f.slug }, { _id: 1 }).lean();
        if (ent) {
          const m = markerParsed;
          await MapMarker.updateOne(
            { entity_id: ent._id },
            {
              $set: {
                entity_id: ent._id,
                region: m.region,
                titulo: m.titulo,
                descripcion: m.descripcion ?? null,
                coord: { x: m.coord_x, y: m.coord_y },
                // slug del marcador (deep-link /mapa?pin=): el explícito o el de la ficha.
                slug: m.slug ?? f.slug,
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
