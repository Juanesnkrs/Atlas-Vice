import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField } from './common.js';

export const ROLES = ['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_RANK: Record<Role, number> = { USER: 0, MODERATOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };
export const AUTH_PROVIDERS = ['google', 'discord', 'apple', 'magic-link'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const roleSchema = z.enum(ROLES);

/** Equivale a `profiles` + identidad de auth (reemplaza auth.users de Supabase). */
export const userSchema = z.object({
  id: z.uuid(),
  email: z.email().optional(),
  username: z.string().min(2).max(40),
  avatar_url: z.string().nullable().optional(),
  discord_id: z.string().nullable().optional(),
  rol: roleSchema.default('USER'),
  identities: z
    .array(z.object({ provider: z.enum(AUTH_PROVIDERS), subject: z.string() }))
    .default([]),
  sessions_revoked_at: z.coerce.date().nullable().optional(),
  created_at: z.coerce.date().optional(),
});
export type UserDTO = z.infer<typeof userSchema>;

export interface UserDoc {
  _id: string;
  email?: string;
  username: string;
  avatar_url?: string | null;
  discord_id?: string | null;
  rol: Role;
  identities: Array<{ provider: AuthProvider; subject: string }>;
  sessions_revoked_at?: Date | null;
  created_at: Date;
}

const userMongoSchema = new Schema<UserDoc>(
  {
    _id: idField,
    email: { type: String, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true },
    avatar_url: { type: String, default: null },
    discord_id: { type: String, default: null },
    rol: { type: String, enum: ROLES, default: 'USER', required: true },
    identities: {
      type: [new Schema({ provider: { type: String, enum: AUTH_PROVIDERS }, subject: String }, { _id: false })],
      default: [],
    },
    sessions_revoked_at: { type: Date, default: null },
  },
  { timestamps: createdOnly, versionKey: false },
);
userMongoSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userMongoSchema.index({ discord_id: 1 }, { unique: true, partialFilterExpression: { discord_id: { $type: 'string' } } });
userMongoSchema.index({ 'identities.provider': 1, 'identities.subject': 1 });

export const User: Model<UserDoc> = model<UserDoc>('User', userMongoSchema);
export default User;

/** Vista publica minima (autores del foro): solo id, username y avatar. Sin rol ni fecha de alta. */
export const toPublicUserDTO = (u: UserDoc) => ({
  id: u._id,
  username: u.username,
  avatar_url: u.avatar_url ?? null,
});

/** Vista propia/administrativa (incluye email y rol): solo /api/auth/me y /api/admin/users. */
export const toSelfUserDTO = (u: UserDoc) => ({
  ...toPublicUserDTO(u),
  discord_id: null,
  rol: u.rol,
  created_at: u.created_at?.toISOString(),
  email: u.email ?? null,
});
