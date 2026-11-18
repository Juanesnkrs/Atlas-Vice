// Importa fichas del catálogo revisadas (JSON normalizado) a la colección Entity.
// Uso: pnpm --dir server import:catalog <archivo.json> [--apply]
// Sin --apply solo simula. Upsert por (module_id, slug). Nunca pisa entidades que no
// hayan sido creadas por este importador (metadata_json.fuente !== 'grabacion').
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { connectDb, disconnectDb } from '../config/db.js';
import { Entity, entitySchema } from '../models/Entity.js';
import { Module } from '../models/Module.js';

const FUENTE = 'grabacion';

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
});
type Ficha = z.infer<typeof fichaSchema>;

async function main(): Promise<void> {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) throw new Error('Falta la ruta del JSON. Uso: import:catalog <archivo.json> [--apply]');
  const apply = flags.includes('--apply');

  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const fichas = z.array(fichaSchema).parse(raw);

  await connectDb();
  const modules = await Module.find({}, { _id: 1, slug: 1 }).lean();
  const moduleId = new Map(modules.map((m) => [m.slug, m._id]));

  const resumen = { nuevas: 0, actualizadas: 0, conflictos: 0, errores: 0 };
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
        fuente: FUENTE,
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
    const existing = await Entity.findOne({ module_id, slug: f.slug }, { metadata_json: 1 }).lean();
    if (existing && (existing.metadata_json as Record<string, unknown>)?.fuente !== FUENTE) {
      resumen.conflictos++;
      console.warn(`! ${f.modulo}/${f.slug}: ya existe una entidad no importada con ese slug; se omite`);
      continue;
    }
    if (existing) resumen.actualizadas++;
    else resumen.nuevas++;
    // _id explícito: el upsert no aplica el default UUID de Mongoose y Mongo pondría un ObjectId.
    if (apply) {
      await Entity.updateOne(
        { module_id, slug: f.slug },
        { $set: doc, $setOnInsert: { _id: _id ?? randomUUID() } },
        { upsert: true },
      );
    }
  }

  console.log(`${apply ? 'APLICADO' : 'SIMULACIÓN (usa --apply para escribir)'}:`, resumen);
  await disconnectDb();
  if (resumen.errores > 0) process.exitCode = 1;
}

main().catch(async (err: unknown) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
