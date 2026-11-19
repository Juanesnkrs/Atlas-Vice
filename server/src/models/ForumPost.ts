import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField } from './common.js';

export const forumPostSchema = z.object({
  id: z.uuid().optional(),
  thread_id: z.uuid(),
  parent_post_id: z.uuid().nullable().optional(),
  contenido: z.string().min(1).max(10000),
});
export type ForumPostDTO = z.infer<typeof forumPostSchema>;

export interface ForumPostDoc {
  _id: string;
  thread_id: string;
  user_id: string;
  parent_post_id?: string | null;
  contenido: string;
  upvotes_count: number;
  created_at: Date;
}

const s = new Schema<ForumPostDoc>(
  {
    _id: idField,
    thread_id: { type: String, required: true, ref: 'ForumThread', index: true },
    user_id: { type: String, required: true, ref: 'User' },
    parent_post_id: { type: String, default: null },
    contenido: { type: String, required: true },
    upvotes_count: { type: Number, default: 0 },
  },
  { timestamps: createdOnly, versionKey: false },
);

export const ForumPost: Model<ForumPostDoc> = model<ForumPostDoc>('ForumPost', s);
export default ForumPost;

export const toPostDTO = (p: ForumPostDoc) => ({
  id: p._id,
  thread_id: p.thread_id,
  user_id: p.user_id,
  parent_post_id: p.parent_post_id ?? null,
  contenido: p.contenido,
  upvotes_count: p.upvotes_count,
  created_at: p.created_at?.toISOString(),
});
