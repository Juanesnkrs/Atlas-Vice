import type { ZodType } from 'zod';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function parse<S extends ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Datos invalidos', z.treeifyError(r.error));
  return r.data;
}

export const idParamsSchema = z.object({ id: z.uuid() });
