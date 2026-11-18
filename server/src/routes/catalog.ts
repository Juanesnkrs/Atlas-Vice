import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import { Entity, entitySchema, entityUpdateSchema, toEntityDTO, type EntityDoc } from '../models/Entity.js';
import { MapMarker, mapMarkerSchema, mapMarkerUpdateSchema, toMarkerDTO, type MapMarkerDoc } from '../models/MapMarker.js';
import { Module, moduleSchema, moduleUpdateSchema, toModuleDTO, type ModuleDoc } from '../models/Module.js';
import { writeAudit } from '../services/audit.js';
import { HttpError, idParamsSchema, parse } from '../services/validate.js';

const admin = { preHandler: requireRole('ADMIN') };

const markerToDoc = (m: Partial<z.infer<typeof mapMarkerSchema>>): Record<string, unknown> => {
  const { coord_x, coord_y, id, ...rest } = m;
  return {
    ...rest,
    ...(id ? { _id: id } : {}),
    ...(coord_x !== undefined && coord_y !== undefined ? { coord: { x: coord_x, y: coord_y } } : {}),
  };
};

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  // ---- Modules ----------------------------------------------------------------
  app.get('/api/modules', async (req) => {
    const all = z.object({ all: z.enum(['1']).optional() }).parse(req.query).all === '1';
    const canSeeAll = all && req.authUser && ['ADMIN', 'SUPER_ADMIN'].includes(req.authUser.rol);
    const rows = await Module.find(canSeeAll ? {} : { activo: true }).sort({ orden: 1 }).lean<ModuleDoc[]>();
    return rows.map(toModuleDTO);
  });

  app.post('/api/modules', admin, async (req, reply) => {
    const body = parse(moduleSchema, req.body);
    const { id, ...rest } = body;
    const doc = await Module.create({ ...rest, ...(id ? { _id: id } : {}) });
    await writeAudit(req, 'module.create', 'Module', doc._id, { slug: doc.slug });
    return reply.code(201).send(toModuleDTO(doc.toObject()));
  });

  app.patch('/api/modules/:id', admin, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { id: _ignored, ...patch } = parse(moduleUpdateSchema, req.body);
    const doc = await Module.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after' }).lean<ModuleDoc>();
    if (!doc) throw new HttpError(404, 'Modulo no encontrado');
    await writeAudit(req, 'module.update', 'Module', id, { patch });
    return toModuleDTO(doc);
  });

  app.delete('/api/modules/:id', admin, async (req, reply) => {
    const { id } = parse(idParamsSchema, req.params);
    const doc = await Module.findByIdAndDelete(id).lean<ModuleDoc>();
    if (!doc) throw new HttpError(404, 'Modulo no encontrado');
    await writeAudit(req, 'module.delete', 'Module', id, { slug: doc.slug });
    return reply.code(204).send();
  });

  // ---- Entities ---------------------------------------------------------------
  app.get('/api/entities', async (req) => {
    const q = parse(z.object({ module_id: z.uuid().optional(), categoria: z.string().optional() }), req.query);
    const rows = await Entity.find(q).sort({ created_at: 1 }).lean<EntityDoc[]>();
    return rows.map(toEntityDTO);
  });

  app.post('/api/entities', admin, async (req, reply) => {
    const { id, ...rest } = parse(entitySchema, req.body);
    if (!(await Module.exists({ _id: rest.module_id }))) throw new HttpError(422, 'module_id inexistente');
    const doc = await Entity.create({ ...rest, ...(id ? { _id: id } : {}) });
    await writeAudit(req, 'entity.create', 'Entity', doc._id, { titulo: doc.titulo });
    return reply.code(201).send(toEntityDTO(doc.toObject()));
  });

  app.patch('/api/entities/:id', admin, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { id: _ignored, ...patch } = parse(entityUpdateSchema, req.body);
    const doc = await Entity.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after' }).lean<EntityDoc>();
    if (!doc) throw new HttpError(404, 'Entidad no encontrada');
    await writeAudit(req, 'entity.update', 'Entity', id, { patch });
    return toEntityDTO(doc);
  });

  app.delete('/api/entities/:id', admin, async (req, reply) => {
    const { id } = parse(idParamsSchema, req.params);
    const doc = await Entity.findByIdAndDelete(id).lean<EntityDoc>();
    if (!doc) throw new HttpError(404, 'Entidad no encontrada');
    await writeAudit(req, 'entity.delete', 'Entity', id, { titulo: doc.titulo });
    return reply.code(204).send();
  });

  // ---- Markers ----------------------------------------------------------------
  app.get('/api/markers', async (req) => {
    const q = parse(z.object({ region: z.string().optional() }), req.query);
    const rows = await MapMarker.find(q).sort({ created_at: 1 }).lean<MapMarkerDoc[]>();
    return rows.map(toMarkerDTO);
  });

  app.post('/api/markers', admin, async (req, reply) => {
    const body = parse(mapMarkerSchema, req.body);
    const doc = await MapMarker.create(markerToDoc(body));
    await writeAudit(req, 'marker.create', 'MapMarker', doc._id, { titulo: doc.titulo });
    return reply.code(201).send(toMarkerDTO(doc.toObject()));
  });

  app.patch('/api/markers/:id', admin, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const body = parse(mapMarkerUpdateSchema, req.body);
    if ((body.coord_x === undefined) !== (body.coord_y === undefined)) {
      throw new HttpError(400, 'coord_x y coord_y deben enviarse juntas');
    }
    const doc = await MapMarker.findByIdAndUpdate(id, { $set: markerToDoc({ ...body, id: undefined }) }, { returnDocument: 'after' }).lean<MapMarkerDoc>();
    if (!doc) throw new HttpError(404, 'Marcador no encontrado');
    await writeAudit(req, 'marker.update', 'MapMarker', id, { patch: body });
    return toMarkerDTO(doc);
  });

  app.delete('/api/markers/:id', admin, async (req, reply) => {
    const { id } = parse(idParamsSchema, req.params);
    const doc = await MapMarker.findByIdAndDelete(id).lean<MapMarkerDoc>();
    if (!doc) throw new HttpError(404, 'Marcador no encontrado');
    await writeAudit(req, 'marker.delete', 'MapMarker', id, { titulo: doc.titulo });
    return reply.code(204).send();
  });
}
