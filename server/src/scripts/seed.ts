// Seed idempotente (upserts por _id). Datos de ejemplo replicados desde src/data/seed.ts
// (seedData.json, mismos UUID). Uso: pnpm --dir server seed
import type { Model } from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { getGlobalConfig } from '../models/AppConfig.js';
import { Entity, type EntityDoc } from '../models/Entity.js';
import { ForumPost, type ForumPostDoc } from '../models/ForumPost.js';
import { ForumThread, type ForumThreadDoc } from '../models/ForumThread.js';
import { MapMarker, type MapMarkerDoc } from '../models/MapMarker.js';
import { Module, type ModuleDoc } from '../models/Module.js';
import { User, type UserDoc } from '../models/User.js';
import raw from './seedData.json' with { type: 'json' };

interface WithId {
  id: string;
  created_at: string;
}

async function upsertAll<D extends { _id: string }>(
  label: string,
  model: Model<D>,
  rows: Array<Record<string, unknown> & WithId>,
): Promise<void> {
  if (rows.length === 0) return;
  const ops = rows.map((r) => {
    const { id, created_at, ...rest } = r;
    return {
      updateOne: {
        filter: { _id: id },
        update: { $set: { ...rest, created_at: new Date(created_at) } },
        upsert: true,
      },
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await model.bulkWrite(ops as any, { timestamps: false });
  console.log(`${label}: ${res.upsertedCount} nuevos, ${res.modifiedCount} actualizados, ${rows.length} total`);
}

async function main(): Promise<void> {
  await connectDb();

  await upsertAll<UserDoc>('users', User, raw.profiles as never);
  await upsertAll<ModuleDoc>('modules', Module, raw.modules as never);
  await upsertAll<EntityDoc>('entities', Entity, raw.entities as never);

  const markers = (raw.markers as Array<Record<string, unknown> & WithId & { coord_x: number; coord_y: number }>).map(
    ({ coord_x, coord_y, ...rest }) => ({ ...rest, coord: { x: Number(coord_x), y: Number(coord_y) } }),
  );
  await upsertAll<MapMarkerDoc>('map_markers', MapMarker, markers);

  await upsertAll<ForumThreadDoc>('forum_threads', ForumThread, raw.threads as never);
  await upsertAll<ForumPostDoc>('forum_posts', ForumPost, raw.posts as never);

  await getGlobalConfig(); // asegura el singleton AppConfig 'global'
  await Promise.all([User, Module, Entity, MapMarker, ForumThread, ForumPost].map((m) => m.syncIndexes()));
  console.log('Seed completado.');
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
