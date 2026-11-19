import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField } from './common.js';

/** Se guarda 'Guias/Ayuda'; la UI lo muestra como 'Guías / Ayuda'. */
export const FORUM_CATEGORIES = ['General', 'Guias/Ayuda', 'Secretos', 'Crews'] as const;
export type ForumCategory = (typeof FORUM_CATEGORIES)[number];

export const forumThreadSchema = z.object({
  id: z.uuid().optional(),
  entity_id: z.uuid().nullable().optional(),
  marker_id: z.uuid().nullable().optional(),
  categoria: z.enum(FORUM_CATEGORIES),
  titulo: z.string().min(3).max(160),
  contenido: z.string().min(1).max(10000),
  is_spoiler: z.boolean().default(false),
});
export type ForumThreadDTO = z.infer<typeof forumThreadSchema>;

export interface ForumThreadDoc {
  _id: string;
  user_id: string;
  entity_id?: string | null;
  marker_id?: string | null;
  categoria: ForumCategory;
  titulo: string;
  contenido: string;
  is_spoiler: boolean;
  is_pinned: boolean;
  upvotes_count: number;
  created_at: Date;
}

const s = new Schema<ForumThreadDoc>(
  {
    _id: idField,
    user_id: { type: String, required: true, ref: 'User' },
    entity_id: { type: String, default: null },
    marker_id: { type: String, default: null },
    categoria: { type: String, enum: FORUM_CATEGORIES, required: true },
    titulo: { type: String, required: true },
    contenido: { type: String, required: true },
    is_spoiler: { type: Boolean, default: false },
    is_pinned: { type: Boolean, default: false },
    upvotes_count: { type: Number, default: 0 },
  },
  { timestamps: createdOnly, versionKey: false },
);
s.index({ categoria: 1, created_at: -1 });
s.index({ entity_id: 1 }, { partialFilterExpression: { entity_id: { $type: 'string' } } });

export const ForumThread: Model<ForumThreadDoc> = model<ForumThreadDoc>('ForumThread', s);
export default ForumThread;

export const toThreadDTO = (t: ForumThreadDoc) => ({
  id: t._id,
  user_id: t.user_id,
  entity_id: t.entity_id ?? null,
  marker_id: t.marker_id ?? null,
  categoria: t.categoria,
  titulo: t.titulo,
  contenido: t.contenido,
  is_spoiler: t.is_spoiler,
  is_pinned: t.is_pinned,
  upvotes_count: t.upvotes_count,
  created_at: t.created_at?.toISOString(),
});
