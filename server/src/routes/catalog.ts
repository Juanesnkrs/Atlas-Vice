import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireStaffRole } from '../plugins/auth.js';
import { Entity, entitySchema, entityUpdateSchema, toEntityDTO, type EntityDoc } from '../models/Entity.js';
import { MapMarker, mapMarkerSchema, mapMarkerUpdateSchema, toMarkerDTO, type MapMarkerDoc } from '../models/MapMarker.js';
import { Module, moduleSchema, moduleUpdateSchema, toModuleDTO, type ModuleDoc } from '../models/Module.js';
import { clearSsrCache } from '../services/ssrLite.js';
import { diffFields, toSnapshot, writeAudit } from '../services/audit.js';
import { withManualEdits } from '../services/catalogIngest.js';
import { sendPublicJson } from '../services/httpCache.js';
import { assertActivatable, countEntitiesByModule } from '../services/moduleRoutes.js';
import { HttpError, idParamsSchema, parse, resourceNotFound } from '../services/validate.js';

/** Paginacion de GET /api/entities: el catalogo actual (~250 fichas) cabe en una pagina por defecto. */
const ENTITIES_DEFAULT_LIMIT = 500;
const ENTITIES_MAX_LIMIT = 500;

const admin = { onRequest: requireStaffRole('ADMIN') };

const markerToDoc = (m: Partial<z.infer<typeof mapMarkerSchema>>): Record<string, unknown> => {
  const { coord_x, coord_y, id, slug, ...rest } = m;
  return {
    ...rest,
    ...(slug ? { slug } : {}),
    ...(id ? { _id: id } : {}),
    ...(coord_x !== undefined && coord_y !== undefined ? { coord: { x: coord_x, y: coord_y } } : {}),
  };
};

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  // ---- Modules ----------------------------------------------------------------
  app.get('/api/modules', async (req, reply) => {
    const all = z.object({ all: z.enum(['1']).optional() }).parse(req.query).all === '1';
    const canSeeAll = all && req.authUser && ['ADMIN', 'SUPER_ADMIN'].includes(req.authUser.rol);
    const rows = await Module.find(canSeeAll ? {} : { activo: true }).sort({ orden: 1 }).lean<ModuleDoc[]>();
    // `fichas` es un campo DERIVADO de solo lectura (conteo de Entity del modulo): no existe en el esquema.
    const counts = await countEntitiesByModule();
    const dtos = rows.map((m) => ({ ...toModuleDTO(m), fichas: counts.get(m._id) ?? 0 }));
    // Con ?all=1 el contenido depende de la sesion: nunca se cachea publicamente.
    if (all) {
      void reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie');
      return dtos;
    }
    return sendPublicJson(req, reply, dtos);
  });

  // Consulta por slug (URLs limpias /catalogo/:modulo/:slug y /guias/:slug). Solo modulos activos.
  const moduleSlugParams = z.object({ moduleSlug: z.string().min(1).max(60) });

  app.get('/api/modules/:moduleSlug/entities', async (req, reply) => {
    const { moduleSlug } = parse(moduleSlugParams, req.params);
    const mod = await Module.findOne({ slug: moduleSlug, activo: true }).lean<ModuleDoc>();
    if (!mod) throw new HttpError(404, 'Modulo no encontrado');
    const rows = await Entity.find({ module_id: mod._id }).sort({ created_at: 1 }).lean<EntityDoc[]>();
    return sendPublicJson(req, reply, rows.map(toEntityDTO));
  });

  app.get('/api/modules/:moduleSlug/entities/:slug', async (req, reply) => {
    const { moduleSlug, slug } = parse(moduleSlugParams.extend({ slug: z.string().min(1).max(120) }), req.params);
    const mod = await Module.findOne({ slug: moduleSlug, activo: true }).lean<ModuleDoc>();
    if (!mod) throw new HttpError(404, 'Modulo no encontrado');
    const doc = await Entity.findOne({ module_id: mod._id, slug }).lean<EntityDoc>();
    if (!doc) throw new HttpError(404, 'Entidad no encontrada');
    return sendPublicJson(req, reply, { ...toEntityDTO(doc), module_slug: mod.slug });
  });

  app.post('/api/modules', admin, async (req, reply) => {
    const body = parse(moduleSchema, req.body);
    const { id, ...rest } = body;
    // `activo` por defecto es true: un slug sin ruta publica solo se crea con activo:false explicito (si no, 422).
    assertActivatable(rest.slug, rest.activo);
    const doc = await Module.create({ ...rest, ...(id ? { _id: id } : {}) });
    await writeAudit(req, 'module.create', 'Module', doc._id, { slug: doc.slug });
    clearSsrCache();
    return reply.code(201).send(toModuleDTO(doc.toObject()));
  });

  app.patch('/api/modules/:id', admin, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { id: _ignored, ...patch } = parse(moduleUpdateSchema, req.body);
    const prev = await Module.findById(id).lean<ModuleDoc>();
    if (!prev) throw resourceNotFound('Modulo no encontrado');
    assertActivatable(patch.slug ?? prev.slug, patch.activo ?? prev.activo);
    const doc = await Module.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after' }).lean<ModuleDoc>();
    if (!doc) throw resourceNotFound('Modulo no encontrado');
    await writeAudit(req, 'module.update', 'Module', id, diffFields(prev as unknown as Record<string, unknown>, patch));
    clearSsrCache();
    return toModuleDTO(doc);
  });

  app.delete('/api/modules/:id', admin, async (req, reply) => {
    const { id } = parse(idParamsSchema, req.params);
    const entities = await Entity.countDocuments({ module_id: id });
    if (entities > 0) {
      throw new HttpError(409, 'El modulo tiene fichas: muevelas o borralas antes', { entities }, 'HAS_DEPENDENTS');
    }
    const doc = await Module.findByIdAndDelete(id).lean<ModuleDoc>();
    if (!doc) throw resourceNotFound('Modulo no encontrado');
    await writeAudit(req, 'module.delete', 'Module', id, { slug: doc.slug, snapshot: toSnapshot(doc) });
    clearSsrCache();
    return reply.code(204).send();
  });

  // ---- Entities ---------------------------------------------------------------
  /**
   * Lista paginada de fichas. Cuerpo = array (compatible con clientes previos); metadatos en cabeceras
   * (X-Total-Count, X-Page, X-Per-Page, X-Total-Pages, Link rel=next/prev). Con ?envelope=1 el cuerpo es
   * { items, total, page, limit, pages }.
   */
  app.get('/api/entities', async (req, reply) => {
    const q = parse(
      z.object({
        module: z.string().min(1).max(60).optional(), // slug o id de modulo
        module_id: z.uuid().optional(),
        id: z.uuid().optional(), // una ficha concreta (selector de fichas del panel)
        categoria: z.string().max(80).optional(),
        q: z.string().trim().min(1).max(80).optional(), // busqueda por titulo o slug (sin distinguir mayusculas)
        limit: z.coerce.number().int().min(1).max(ENTITIES_MAX_LIMIT).default(ENTITIES_DEFAULT_LIMIT),
        page: z.coerce.number().int().min(1).max(100_000).default(1),
        envelope: z.enum(['1']).optional(),
        provisional: z.enum(['1']).optional(), // solo fichas con imagen provisional (capturaPropiaPendiente)
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.provisional) filter.capturaPropiaPendiente = true;
    if (q.module_id) filter.module_id = q.module_id;
    if (q.id) filter._id = q.id;
    if (q.categoria) filter.categoria = q.categoria;
    if (q.q) {
      const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ titulo: rx }, { slug: rx }];
    }
    if (q.module) {
      const mod = await Module.findOne({ $or: [{ _id: q.module }, { slug: q.module }] })
        .select('_id')
        .lean<{ _id: string }>();
      // Modulo inexistente (o contradictorio con module_id): lista vacia, no 404 (es un filtro, no un recurso).
      filter.module_id = !mod || (q.module_id && q.module_id !== mod._id) ? '__none__' : mod._id;
    }
    const [total, rows] = await Promise.all([
      Entity.countDocuments(filter),
      Entity.find(filter)
        .sort({ created_at: 1, _id: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean<EntityDoc[]>(),
    ]);
    const pages = Math.max(1, Math.ceil(total / q.limit));
    const items = rows.map(toEntityDTO);
    const link = (p: number, rel: string) => {
      const u = new URLSearchParams(req.query as Record<string, string>);
      u.set('page', String(p));
      u.set('limit', String(q.limit));
      return '</api/entities?' + u.toString() + '>; rel="' + rel + '"';
    };
    const links = [...(q.page < pages ? [link(q.page + 1, 'next')] : []), ...(q.page > 1 ? [link(q.page - 1, 'prev')] : [])];
    void reply
      .header('X-Total-Count', String(total))
      .header('X-Page', String(q.page))
      .header('X-Per-Page', String(q.limit))
      .header('X-Total-Pages', String(pages));
    if (links.length) void reply.header('Link', links.join(', '));
    return sendPublicJson(req, reply, q.envelope ? { items, total, page: q.page, limit: q.limit, pages } : items);
  });

  app.post('/api/entities', admin, async (req, reply) => {
    // contentHash y manualEdits son del servidor/pipeline: el cliente no los fija.
    const { id, ...rest } = parse(entitySchema.omit({ contentHash: true, manualEdits: true }), req.body);
    if (!(await Module.exists({ _id: rest.module_id }))) throw new HttpError(422, 'module_id inexistente');
    const doc = await Entity.create({ ...rest, ...(id ? { _id: id } : {}) });
    await writeAudit(req, 'entity.create', 'Entity', doc._id, { titulo: doc.titulo });
    clearSsrCache();
    return reply.code(201).send(toEntityDTO(doc.toObject()));
  });

  app.patch('/api/entities/:id', admin, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { id: _ignored, ...patch } = parse(entityUpdateSchema.omit({ contentHash: true, manualEdits: true }), req.body);
    const prev = await Entity.findById(id).lean<EntityDoc>();
    if (!prev) throw resourceNotFound('Entidad no encontrada');
    // Campos de contenido editados a mano: el pipeline no los sobrescribe y el hash se recalcula.
    const set = withManualEdits(prev, patch);
    const doc = await Entity.findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after' }).lean<EntityDoc>();
    if (!doc) throw resourceNotFound('Entidad no encontrada');
    await writeAudit(req, 'entity.update', 'Entity', id, diffFields(prev as unknown as Record<string, unknown>, patch));
    clearSsrCache();
    return toEntityDTO(doc);
  });

  app.delete('/api/entities/:id', admin, async (req, reply) => {
    const { id } = parse(idParamsSchema, req.params);
    const pins = await MapMarker.find({ entity_id: id }).select('titulo').lean<Array<{ _id: string; titulo: string }>>();
    if (pins.length > 0) {
      throw new HttpError(
        409,
        'La ficha tiene pines en el mapa: borralos o desvinculalos antes',
        { count: pins.length, markers: pins.map((p) => ({ id: p._id, titulo: p.titulo })) },
        'HAS_DEPENDENTS',
      );
    }
    const doc = await Entity.findByIdAndDelete(id).lean<EntityDoc>();
    if (!doc) throw resourceNotFound('Entidad no encontrada');
    await writeAudit(req, 'entity.delete', 'Entity', id, { titulo: doc.titulo, slug: doc.slug, snapshot: toSnapshot(doc) });
    clearSsrCache();
    return reply.code(204).send();
  });

  // ---- Markers ----------------------------------------------------------------
  app.get('/api/markers', async (req, reply) => {
    const q = parse(
      z.object({
        region: z.string().optional(),
        // x1,y1,x2,y2 en coordenadas del lienzo (cualquier orden de esquinas).
        bbox: z
          .string()
          .transform((v) => v.split(',').map(Number))
          .pipe(z.array(z.number().finite()).length(4))
          .optional(),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.region) filter.region = q.region;
    if (q.bbox) {
      const [x1, y1, x2, y2] = q.bbox as [number, number, number, number];
      filter.coord = { $geoWithin: { $box: [[Math.min(x1, x2), Math.min(y1, y2)], [Math.max(x1, x2), Math.max(y1, y2)]] } };
    }
    const rows = await MapMarker.find(filter).sort({ created_at: 1, _id: 1 }).lean<MapMarkerDoc[]>();
    return sendPublicJson(req, reply, rows.map(toMarkerDTO));
  });

  app.post('/api/markers', admin, async (req, reply) => {
    const body = parse(mapMarkerSchema, req.body);
    const doc = await MapMarker.create(markerToDoc(body));
    await writeAudit(req, 'marker.create', 'MapMarker', doc._id, { titulo: doc.titulo });
    clearSsrCache();
    return reply.code(201).send(toMarkerDTO(doc.toObject()));
  });

  app.patch('/api/markers/:id', admin, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const body = parse(mapMarkerUpdateSchema, req.body);
    if ((body.coord_x === undefined) !== (body.coord_y === undefined)) {
      throw new HttpError(400, 'coord_x y coord_y deben enviarse juntas');
    }
    const prev = await MapMarker.findById(id).lean<MapMarkerDoc>();
    if (!prev) throw resourceNotFound('Marcador no encontrado');
    const doc = await MapMarker.findByIdAndUpdate(id, { $set: markerToDoc({ ...body, id: undefined }) }, { returnDocument: 'after' }).lean<MapMarkerDoc>();
    if (!doc) throw resourceNotFound('Marcador no encontrado');
    await writeAudit(req, 'marker.update', 'MapMarker', id, diffFields(toMarkerDTO(prev), body as Record<string, unknown>));
    clearSsrCache();
    return toMarkerDTO(doc);
  });

  app.delete('/api/markers/:id', admin, async (req, reply) => {
    const { id } = parse(idParamsSchema, req.params);
    const doc = await MapMarker.findByIdAndDelete(id).lean<MapMarkerDoc>();
    if (!doc) throw resourceNotFound('Marcador no encontrado');
    await writeAudit(req, 'marker.delete', 'MapMarker', id, { titulo: doc.titulo, snapshot: toSnapshot(doc) });
    clearSsrCache();
    return reply.code(204).send();
  });
}
