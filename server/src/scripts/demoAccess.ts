// Acceso DEMO temporal como SUPER_ADMIN, solo para desarrollo local.
//
//   pnpm --dir server demo:access                 (120 min por defecto)
//   pnpm --dir server demo:access -- --minutes 30
//   pnpm --dir server demo:access -- --revoke     (borra cualquier usuario demo que haya quedado)
//
// Que hace: crea el usuario `demo-temporal` (SUPER_ADMIN), genera una sesion que caduca sola y
// publica un enlace LOCAL de un solo uso (127.0.0.1) que fija la cookie y abre la app.
// Cuando el script termina (Ctrl+C, cerrar la ventana o vencer el tiempo) borra el usuario.
// Como la API valida cada sesion contra la base de datos, al borrarlo el acceso muere al instante.
//
// Guardas: se niega a correr con NODE_ENV=production o si MONGODB_URI no es una base local.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { connectDb, disconnectDb } from '../config/db.js';
import { env, isProd } from '../config/env.js';
import { User } from '../models/User.js';
import { SESSION_COOKIE, signSession } from '../services/session.js';

const DEMO_USERNAME = 'demo-temporal';
const CLAIM_WINDOW_MS = 10 * 60 * 1000;
const MAX_MINUTES = 480;

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function assertLocalOnly(): void {
  if (isProd) throw new Error('Rechazado: NODE_ENV=production. El acceso demo solo existe en desarrollo.');
  let host = '';
  try {
    host = new URL(env.MONGODB_URI).hostname;
  } catch {
    throw new Error('Rechazado: MONGODB_URI no es una URL valida.');
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error(`Rechazado: la base (${host}) no es local. No se crean super usuarios demo en bases remotas.`);
  }
}

async function main(): Promise<void> {
  assertLocalOnly();
  await connectDb();

  // Limpieza de restos de una ejecucion anterior (cierre brusco).
  const stale = await User.deleteMany({ username: DEMO_USERNAME });
  if (args.includes('--revoke')) {
    console.log(`Acceso demo revocado (${stale.deletedCount} usuario(s) borrado(s)).`);
    await disconnectDb();
    return;
  }

  const minutes = Math.min(MAX_MINUTES, Math.max(1, Number(flagValue('minutes') ?? 120) || 120));
  const userId = randomUUID();
  await User.create({ _id: userId, username: DEMO_USERNAME, rol: 'SUPER_ADMIN', identities: [] });
  const session = await signSession(userId, minutes * 60);

  const claimPath = `/${randomBytes(24).toString('hex')}`;
  const landing = `${env.CLIENT_ORIGIN.replace(/\/+$/, '')}${flagValue('ir') ?? '/_staff'}`;
  let claimed = false;
  let closing = false;
  const servers: Server[] = [];

  const cleanup = async (reason: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`\nCerrando acceso demo (${reason})...`);
    for (const s of servers) s.close();
    try {
      const r = await User.deleteMany({ _id: userId });
      console.log(`Usuario demo borrado (${r.deletedCount}). Las sesiones emitidas ya no son validas.`);
    } catch (err) {
      console.error('NO se pudo borrar el usuario demo. Ejecuta: pnpm --dir server demo:access -- --revoke', err);
    }
    await disconnectDb().catch(() => undefined);
    process.exit(0);
  };

  const handler = createServer((req, res) => {
    if (claimed || req.method !== 'GET' || req.url !== claimPath) {
      res.writeHead(404).end('No encontrado');
      return;
    }
    claimed = true; // un solo uso
    res.writeHead(302, {
      'Set-Cookie': `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${minutes * 60}`,
      Location: landing,
      'Cache-Control': 'no-store',
    });
    res.end();
    console.log('Enlace canjeado: sesion de super usuario activa en este navegador.');
  });
  servers.push(handler);
  await new Promise<void>((resolve, reject) => {
    handler.once('error', reject);
    handler.listen(0, '127.0.0.1', resolve);
  });
  const port = (handler.address() as { port: number }).port;

  // `localhost` puede resolver a ::1: se escucha tambien ahi (si el sistema lo permite).
  const v6 = createServer(handler.listeners('request')[0] as never);
  v6.once('error', () => undefined);
  v6.listen(port, '::1');
  servers.push(v6);

  console.log('='.repeat(64));
  console.log(' ACCESO DEMO SUPER_ADMIN (solo local)');
  console.log('='.repeat(64));
  console.log(` 1) Abre este enlace UNA vez en tu navegador:\n\n    http://localhost:${port}${claimPath}\n`);
  console.log(` 2) Dura ${minutes} min y el enlace caduca en ${CLAIM_WINDOW_MS / 60000} min si no se usa.`);
  console.log(' 3) Para terminar: Ctrl+C o cierra esta ventana. Se borra el usuario y el acceso se destruye.');
  console.log('='.repeat(64));

  setTimeout(() => void cleanup('tiempo agotado'), minutes * 60_000);
  setTimeout(() => {
    if (!claimed) void cleanup('el enlace no se uso a tiempo');
  }, CLAIM_WINDOW_MS);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(sig, () => void cleanup(sig));
  }
  process.on('uncaughtException', (err) => {
    console.error(err);
    void cleanup('error inesperado');
  });
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
