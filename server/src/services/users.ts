import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { User, type AuthProvider, type UserDoc } from '../models/User.js';

const slugName = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '')
    .slice(0, 24) || 'jugador';

async function uniqueUsername(base: string): Promise<string> {
  const root = slugName(base);
  if (!(await User.exists({ username: root }))) return root;
  for (let i = 0; i < 5; i++) {
    const candidate = `${root}${randomBytes(2).toString('hex')}`;
    if (!(await User.exists({ username: candidate }))) return candidate;
  }
  return `${root}${randomBytes(6).toString('hex')}`;
}

export interface LoginIdentity {
  provider: AuthProvider;
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

/** Busca por identidad o por email verificado; si no existe crea un USER. */
export async function findOrCreateUser(id: LoginIdentity): Promise<UserDoc> {
  const email = id.emailVerified ? id.email?.toLowerCase() : undefined;
  let user = await User.findOne({
    identities: { $elemMatch: { provider: id.provider, subject: id.subject } },
  });
  if (!user && email) user = await User.findOne({ email });

  if (user) {
    if (!user.identities.some((i) => i.provider === id.provider && i.subject === id.subject)) {
      user.identities.push({ provider: id.provider, subject: id.subject });
    }
    if (!user.avatar_url && id.avatarUrl) user.avatar_url = id.avatarUrl;
    if (id.provider === 'discord' && !user.discord_id) user.discord_id = id.subject;
  } else {
    user = new User({
      ...(email ? { email } : {}),
      username: await uniqueUsername(id.name ?? email?.split('@')[0] ?? 'jugador'),
      avatar_url: id.avatarUrl ?? null,
      discord_id: id.provider === 'discord' ? id.subject : null,
      rol: 'USER',
      identities: [{ provider: id.provider, subject: id.subject }],
    });
  }

  // Bootstrap controlado del primer SUPER_ADMIN por email verificado.
  if (email && env.SUPER_ADMIN_EMAIL && email === env.SUPER_ADMIN_EMAIL.toLowerCase() && user.rol !== 'SUPER_ADMIN') {
    user.rol = 'SUPER_ADMIN';
  }
  await user.save();
  return user.toObject();
}
