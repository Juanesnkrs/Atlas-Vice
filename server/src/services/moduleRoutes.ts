import { Entity } from '../models/Entity.js';
import { MapMarker } from '../models/MapMarker.js';
import { HttpError } from './validate.js';

/**
 * Registro modulo <-> ruta publica (fuente unica). Un modulo solo puede estar `activo` si su slug
 * figura aqui: sin pantalla publica no hay nada que activar (p. ej. `radio`, v1.1).
 */
export type ModuleKind = 'seccion' | 'categoria';
export interface ModuleRouteInfo {
  ruta_publica: string;
  tipo: ModuleKind;
  /** Donde se gestiona en el panel /_staff (texto corto en espanol). */
  staff_seccion: string;
}

export const MODULE_ROUTES: Readonly<Record<string, ModuleRouteInfo>> = {
  mapa: { ruta_publica: '/mapa', tipo: 'seccion', staff_seccion: 'Contenido público → Mapa interactivo' },
  armas: { ruta_publica: '/catalogo/armas', tipo: 'categoria', staff_seccion: 'Contenido público → Catálogo' },
  vehiculos: { ruta_publica: '/catalogo/vehiculos', tipo: 'categoria', staff_seccion: 'Contenido público → Catálogo' },
  coleccionables: { ruta_publica: '/catalogo/coleccionables', tipo: 'categoria', staff_seccion: 'Contenido público → Catálogo' },
  foro: { ruta_publica: '/foro', tipo: 'seccion', staff_seccion: 'Comunidad y moderación → Foro' },
  guias: { ruta_publica: '/guias', tipo: 'categoria', staff_seccion: 'Editorial y automatización → Guías publicadas' },
};

export const routeInfoOf = (slug: string): ModuleRouteInfo | null => Object.hasOwn(MODULE_ROUTES, slug) ? (MODULE_ROUTES[slug] ?? null) : null;

/** 422 si el resultado dejaria `activo: true` un modulo sin ruta publica. Desactivar siempre se permite. */
export function assertActivatable(slug: string, activo: boolean): void {
  if (activo && !routeInfoOf(slug)) {
    throw new HttpError(
      422,
      `El módulo «${slug}» no tiene pantalla pública y no puede activarse todavía; créalo o déjalo con activo:false`,
      { slug },
      'MODULE_WITHOUT_PUBLIC_ROUTE',
    );
  }
}

/** Fichas por module_id: una sola consulta agregada. */
export async function countEntitiesByModule(): Promise<Map<string, number>> {
  const rows = await Entity.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$module_id', n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

/** Pines por module_id de la ficha enlazada (clave `null` = pines sin ficha) y total: una sola consulta agregada. */
export async function countMarkersByModule(): Promise<{ byModule: Map<string, number>; total: number }> {
  const rows = await MapMarker.aggregate<{ _id: string | null; n: number }>([
    { $lookup: { from: Entity.collection.name, localField: 'entity_id', foreignField: '_id', as: 'e' } },
    { $group: { _id: { $arrayElemAt: ['$e.module_id', 0] }, n: { $sum: 1 } } },
  ]);
  const byModule = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    total += r.n;
    if (r._id) byModule.set(r._id, r.n);
  }
  return { byModule, total };
}
