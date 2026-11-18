import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** Los ids son UUID string (mismos UUID que el seed del cliente). */
export const idField = { type: String, default: (): string => randomUUID() } as const;

export const uuidSchema = z.uuid();
export const jsonRecordSchema = z.record(z.string(), z.unknown());

export const createdOnly = { createdAt: 'created_at', updatedAt: false } as const;
