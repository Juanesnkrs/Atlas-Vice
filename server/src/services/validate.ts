import type { ZodType } from 'zod';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
    /** Codigo de negocio solo para staff ya autorizado (RESOURCE_NOT_FOUND, HAS_DEPENDENTS). */
    public code?: string,
  ) {
    super(message);
  }
}

/** 404 de recurso (solo lo ve un staff ya autorizado): distinguible del 404 uniforme de ruta/autorizacion, que no lleva codigo. */
export const resourceNotFound = (message: string): HttpError => new HttpError(404, message, undefined, 'RESOURCE_NOT_FOUND');

export function parse<S extends ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Datos invalidos', z.treeifyError(r.error));
  return r.data;
}

export const idParamsSchema = z.object({ id: z.uuid() });
