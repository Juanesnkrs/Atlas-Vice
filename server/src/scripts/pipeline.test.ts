// Pruebas del pipeline de datos (node:test, sin dependencias). `pnpm --dir server test`.
// Usan SIEMPRE una base separada (`..._test`): el guardian aborta si la URI no termina en `_test` y no es local.
// Excluidas del build de produccion (tsconfig.json) y compiladas aparte a node_modules/.cache (tsconfig.test.json).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

const TEST_URI = process.env['TEST_MONGODB_URI'] ?? 'mongodb://127.0.0.1:27017/leonidapp_test';
const dbName = new URL(TEST_URI).pathname.replace(/^\//, '');
if (!/_test$/.test(dbName) || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(TEST_URI).hostname)) {
  throw new Error(`Rechazado: las pruebas solo corren contra una base local cuyo nombre termine en _test (recibido: ${dbName}).`);
}
// Antes de importar la app: env.ts lee process.env al cargarse (dotenv no pisa variables ya definidas).
process.env['MONGODB_URI'] = TEST_URI;
process.env['NODE_ENV'] = 'test';
process.env['NEWS_WORKER_ENABLED'] = 'false';
delete process.env['PIPELINE_WEBHOOK_URL'];
delete process.env['PIPELINE_INGEST_TOKEN'];

const { default: mongoose } = await import('mongoose');
const { buildApp } = await import('../app.js');
const { connectDb, disconnectDb } = await import('../config/db.js');
const { env } = await import('../config/env.js');
const { Entity } = await import('../models/Entity.js');
const { Module } = await import('../models/Module.js');
const { PipelineRun } = await import('../models/PipelineRun.js');
const { Submission } = await import('../models/Submission.js');
const { User } = await import('../models/User.js');
const { SESSION_COOKIE, signSession } = await import('../services/session.js');
const { promote } = await import('../services/submissions.js');

type App = Awaited<ReturnType<typeof buildApp>>;
interface Ingest {
  ok: boolean;
  runId: string;
  dryRun: boolean;
  nuevas: number;
  actualizadas: number;
  sin_cambios: number;
  conflictos: number;
  rechazados: number;
  errores: number;
  details: Array<{ slug: string; resultado: string; motivo?: string }>;
}

const TOKEN = 'p'.repeat(40);
const MODULE = 'armas';
let app: App;
let moduleId: string;
let ipSeq = 0;
/** IP distinta por peticion: el rate-limit de la ingesta (20/min por IP) no debe interferir. */
const nextIp = (): string => `10.77.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

const ficha = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  titulo: `Ficha ${slug}`,
  categoria: 'Pistolas',
  confianza: 'alta',
  stats_juego: { dano: 6 },
  metadata: {},
  evidencia: [],
  ...extra,
});

async function ingest(fichas: unknown[], opts: { query?: string; dryRun?: boolean; source?: string; token?: string | null } = {}) {
  const token = opts.token === undefined ? TOKEN : opts.token;
  const res = await app.inject({
    method: 'POST',
    url: `/api/pipeline/ingest${opts.query ?? ''}`,
    remoteAddress: nextIp(),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: JSON.stringify({ source: opts.source ?? 'editorial', modulo: MODULE, ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}), fichas }),
  });
  return res;
}
const ok = async (...args: Parameters<typeof ingest>): Promise<Ingest> => {
  const res = await ingest(...args);
  assert.equal(res.statusCode, 200, res.body);
  return res.json<Ingest>();
};
const pendingPipeline = (slug?: string) => Submission.countDocuments({ origin: 'pipeline', status: 'pending', ...(slug ? { 'payload.slug': slug } : {}) });

before(async () => {
  assert.match(env.MONGODB_URI, /_test$/, 'la app debe usar la base de pruebas');
  await connectDb();
  assert.equal(mongoose.connection.name, dbName);
  await mongoose.connection.dropDatabase();
  moduleId = randomUUID();
  await Module.create({ _id: moduleId, slug: MODULE, nombre: 'Armas', icono: 'gun', activo: true, orden: 1 });
  app = await buildApp();
  await app.ready();
});

after(async () => {
  await app?.close();
  if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
  await disconnectDb();
});

beforeEach(async () => {
  env.PIPELINE_INGEST_TOKEN = TOKEN;
  delete (env as { PIPELINE_WEBHOOK_URL?: string }).PIPELINE_WEBHOOK_URL;
  await Promise.all([Submission.deleteMany({}), Entity.deleteMany({}), PipelineRun.deleteMany({})]);
});

describe('(a) 404 uniforme de /api/pipeline/ingest', () => {
  const reference = async () => {
    const r = await app.inject({ method: 'POST', url: '/api/pipeline/no-existe', remoteAddress: nextIp(), headers: { 'content-type': 'application/json' }, payload: '{}' });
    return { status: r.statusCode, body: r.body };
  };
  const cases: Array<[string, () => Promise<{ statusCode: number; body: string }>]> = [
    ['sin Authorization', () => ingest([ficha('a')], { token: null })],
    ['token invalido', () => ingest([ficha('a')], { token: 'x'.repeat(40) })],
    ['token de longitud distinta', () => ingest([ficha('a')], { token: 'corto' })],
    [
      'esquema Basic en lugar de Bearer',
      () => app.inject({ method: 'POST', url: '/api/pipeline/ingest', remoteAddress: nextIp(), headers: { authorization: `Basic ${TOKEN}`, 'content-type': 'application/json' }, payload: '{}' }),
    ],
    [
      'cuerpo malformado sin token',
      () => app.inject({ method: 'POST', url: '/api/pipeline/ingest', remoteAddress: nextIp(), headers: { 'content-type': 'application/json' }, payload: '{"fichas": [oops' }),
    ],
    [
      'cuerpo malformado con token invalido',
      () => app.inject({ method: 'POST', url: '/api/pipeline/ingest', remoteAddress: nextIp(), headers: { authorization: 'Bearer nope', 'content-type': 'application/json' }, payload: '{{{' }),
    ],
  ];
  for (const [name, call] of cases) {
    it(`${name} -> 404 identico a una ruta inexistente`, async () => {
      const ref = await reference();
      const res = await call();
      assert.equal(res.statusCode, 404);
      assert.equal(ref.status, 404);
      assert.equal(res.body, ref.body);
    });
  }
  it('PIPELINE_INGEST_TOKEN sin configurar: ni el token "correcto" entra', async () => {
    delete (env as { PIPELINE_INGEST_TOKEN?: string }).PIPELINE_INGEST_TOKEN;
    const ref = await reference();
    const res = await ingest([ficha('a')], { token: TOKEN });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body, ref.body);
    // Y tampoco con un Bearer vacio/espacios.
    const res2 = await app.inject({ method: 'POST', url: '/api/pipeline/ingest', remoteAddress: nextIp(), headers: { authorization: 'Bearer ', 'content-type': 'application/json' }, payload: '{}' });
    assert.equal(res2.statusCode, 404);
  });
  it('PIPELINE_INGEST_TOKEN corto (<32): ni el token coincidente entra', async () => {
    env.PIPELINE_INGEST_TOKEN = 'corto-pero-igual';
    const ref = await reference();
    const res = await ingest([ficha('a')], { token: 'corto-pero-igual' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body, ref.body);
  });
  it('con token valido y cuerpo malformado deja de ser 404 (400) y no escribe nada', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pipeline/ingest', remoteAddress: nextIp(), headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, payload: '{"fichas": [oops' });
    assert.equal(res.statusCode, 400);
    assert.equal(await Submission.countDocuments(), 0);
  });
  it('sin Authorization nunca escribe Submission ni PipelineRun', async () => {
    await ingest([ficha('a')], { token: null });
    assert.equal(await Submission.countDocuments(), 0);
    assert.equal(await PipelineRun.countDocuments(), 0);
  });
});

describe('(b) dryRun no escribe Submission', () => {
  it('dryRun en el cuerpo', async () => {
    const r = await ok([ficha('dry-a')], { dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(r.nuevas, 1);
    assert.equal(await Submission.countDocuments(), 0);
    assert.equal(await Entity.countDocuments(), 0);
    const run = await PipelineRun.findById(r.runId).lean();
    assert.equal(run?.dryRun, true);
  });
  it('?dry=1', async () => {
    const r = await ok([ficha('dry-b')], { query: '?dry=1' });
    assert.equal(r.dryRun, true);
    assert.equal(r.nuevas, 1);
    assert.equal(await Submission.countDocuments(), 0);
  });
  it('?dry=true', async () => {
    const r = await ok([ficha('dry-c')], { query: '?dry=true' });
    assert.equal(r.dryRun, true);
    assert.equal(await Submission.countDocuments(), 0);
  });
  it('sin dry escribe una Submission pendiente', async () => {
    const r = await ok([ficha('wet-a')]);
    assert.equal(r.dryRun, false);
    assert.equal(await pendingPipeline('wet-a'), 1);
  });
});

describe('(c) idempotencia por contentHash', () => {
  it('el mismo lote dos veces no duplica la Submission pendiente', async () => {
    const batch = [ficha('idem-a'), ficha('idem-b')];
    const r1 = await ok(batch);
    assert.equal(r1.nuevas, 2);
    const r2 = await ok(batch);
    assert.equal(r2.nuevas, 2, 'sin promover siguen siendo nuevas, pero no se vuelven a crear');
    assert.ok(r2.details.every((d) => /no se duplica/.test(d.motivo ?? '')));
    assert.equal(await pendingPipeline(), 2);
  });
  it('tras promover, re-ingerir el mismo contenido devuelve sin_cambios y no crea Submission', async () => {
    await ok([ficha('idem-c')]);
    const sub = await Submission.findOne({ origin: 'pipeline' }).lean();
    await promote(sub!._id, { id: 'system', role: 'SYSTEM' });
    await Submission.deleteMany({});
    const r = await ok([ficha('idem-c')]);
    assert.equal(r.sin_cambios, 1);
    assert.equal(r.nuevas + r.actualizadas + r.conflictos, 0);
    assert.equal(await Submission.countDocuments(), 0);
  });
  it('slug repetido dentro del lote se rechaza', async () => {
    const r = await ok([ficha('dup'), ficha('dup')]);
    assert.equal(r.nuevas, 1);
    assert.equal(r.rechazados, 1);
    assert.equal(await pendingPipeline('dup'), 1);
  });
});

describe('(d) imagen_url externa rechazada sin abortar el lote', () => {
  it('rechaza https://, // y prefijos de terceros; procesa el resto', async () => {
    const r = await ok([
      ficha('img-https', { imagen_url: 'https://cdn.example.com/a.jpg' }),
      ficha('img-proto', { imagen_url: '//cdn.example.com/a.jpg' }),
      ficha('img-third', { imagen_url: '/assets/complexmusic_cover.jpg' }),
      ficha('img-rock', { imagen_url: '/assets/rockstargames_x.jpg' }),
      ficha('img-trav', { imagen_url: '/assets/../secreto.jpg' }),
      ficha('img-ok', { imagen_url: '/assets/propia.jpg' }),
      ficha('img-null', { imagen_url: null }),
      ficha('img-none'),
    ]);
    assert.equal(r.rechazados, 5);
    assert.equal(r.nuevas, 3);
    assert.equal(r.errores, 0);
    const bySlug = Object.fromEntries(r.details.map((d) => [d.slug, d.resultado]));
    for (const s of ['img-https', 'img-proto', 'img-third', 'img-rock', 'img-trav']) assert.equal(bySlug[s], 'rechazada', s);
    for (const s of ['img-ok', 'img-null', 'img-none']) assert.equal(bySlug[s], 'nueva', s);
    assert.equal(await pendingPipeline(), 3);
    for (const s of ['img-https', 'img-proto', 'img-third']) assert.equal(await Submission.countDocuments({ 'payload.slug': s }), 0);
  });
  it('un elemento no objeto o sin campos obligatorios se rechaza sin abortar', async () => {
    const r = await ok([null, 42, { slug: 'solo-slug' }, ficha('bueno')]);
    assert.equal(r.rechazados, 3);
    assert.equal(r.nuevas, 1);
  });
});

describe('(e) nuevas/actualizadas/conflicto van a Submission, nunca a Entity', () => {
  it('clasifica y enruta sin escribir Entity', async () => {
    // Estado previo: 3 fichas existentes de la fuente editorial (via pipeline + promote).
    await ok([ficha('ex-upd'), ficha('ex-conf'), ficha('ex-src')]);
    for (const s of await Submission.find({ origin: 'pipeline' }).lean()) await promote(s._id, { id: 'system', role: 'SYSTEM' });
    await Submission.deleteMany({});
    assert.equal(await Entity.countDocuments(), 3);
    await Entity.updateOne({ slug: 'ex-conf' }, { $set: { manualEdits: ['titulo'] } });
    await Entity.updateOne({ slug: 'ex-src' }, { $set: { 'metadata_json.fuente': 'otra-fuente' } });
    const before = await Entity.find().sort({ slug: 1 }).lean();

    const r = await ok([
      ficha('nueva-1'),
      ficha('ex-upd', { categoria: 'Rifles' }),
      ficha('ex-conf', { titulo: 'Titulo cambiado' }),
      ficha('ex-src', { categoria: 'Escopetas' }),
    ]);
    assert.equal(r.nuevas, 1);
    assert.equal(r.actualizadas, 1);
    assert.equal(r.conflictos, 2);
    const by = Object.fromEntries(r.details.map((d) => [d.slug, d]));
    assert.equal(by['nueva-1']?.resultado, 'nueva');
    assert.equal(by['ex-upd']?.resultado, 'actualizada');
    assert.equal(by['ex-conf']?.resultado, 'conflicto');
    assert.match(by['ex-conf']?.motivo ?? '', /titulo/);
    assert.equal(by['ex-src']?.resultado, 'conflicto');
    assert.match(by['ex-src']?.motivo ?? '', /otra-fuente/);

    const subs = await Submission.find({}).lean();
    assert.equal(subs.length, 4);
    assert.ok(subs.every((s) => s.origin === 'pipeline' && s.status === 'pending' && s.userId === null && s.promotedTo === null));
    const reasons = Object.fromEntries(subs.map((s) => [(s.payload as { slug: string }).slug, (s.payload as { pipeline_reason: string }).pipeline_reason]));
    assert.deepEqual(reasons, { 'nueva-1': 'nueva', 'ex-upd': 'actualizada', 'ex-conf': 'conflicto', 'ex-src': 'conflicto' });

    // Entity intacta: ni fichas nuevas ni modificaciones.
    assert.equal(await Entity.countDocuments(), 3);
    assert.equal(await Entity.countDocuments({ slug: 'nueva-1' }), 0);
    assert.deepEqual(await Entity.find().sort({ slug: 1 }).lean(), before);
  });
  it('un modulo inexistente responde 422 y no crea ejecucion de ficha', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pipeline/ingest',
      remoteAddress: nextIp(),
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ source: 'editorial', modulo: 'no-existe', fichas: [ficha('x')] }),
    });
    assert.equal(res.statusCode, 422);
    assert.equal(await Submission.countDocuments(), 0);
  });
});

describe('(f) /api/admin/pipeline/* exige sesion de staff', () => {
  const sessions = new Map<string, string>();
  const cookieFor = async (rol: 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN'): Promise<string> => {
    const cached = sessions.get(rol);
    if (cached) return cached;
    const id = randomUUID();
    await User.create({ _id: id, username: `t-${rol.toLowerCase()}-${id.slice(0, 6)}`, rol, identities: [] });
    const c = `${SESSION_COOKIE}=${await signSession(id, 600)}`;
    sessions.set(rol, c);
    return c;
  };
  const missing = async (url: string) => {
    const r = await app.inject({ method: 'GET', url: '/api/admin/no-existe-xyz', remoteAddress: nextIp() });
    void url;
    return r.body;
  };

  it('sin sesion: GET runs y POST trigger devuelven 404 (cuerpo = ruta inexistente de /api/admin)', async () => {
    const ref = await missing('');
    const g = await app.inject({ method: 'GET', url: '/api/admin/pipeline/runs', remoteAddress: nextIp() });
    assert.equal(g.statusCode, 404);
    assert.equal(g.body, ref);
    const p = await app.inject({ method: 'POST', url: '/api/admin/pipeline/trigger', remoteAddress: nextIp(), headers: { 'content-type': 'application/json' }, payload: '{{malformado' });
    assert.equal(p.statusCode, 404);
    assert.equal(p.body, ref);
  });
  it('con cookie invalida o rol USER/MODERATOR tambien 404', async () => {
    for (const cookie of [`${SESSION_COOKIE}=basura`, await cookieFor('USER'), await cookieFor('MODERATOR')]) {
      const g = await app.inject({ method: 'GET', url: '/api/admin/pipeline/runs', remoteAddress: nextIp(), headers: { cookie } });
      assert.equal(g.statusCode, 404, cookie.slice(0, 20));
      const p = await app.inject({ method: 'POST', url: '/api/admin/pipeline/trigger', remoteAddress: nextIp(), headers: { cookie } });
      assert.equal(p.statusCode, 404);
    }
  });
  it('el Bearer de ingesta no abre las rutas de staff', async () => {
    const g = await app.inject({ method: 'GET', url: '/api/admin/pipeline/runs', remoteAddress: nextIp(), headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(g.statusCode, 404);
  });
  it('ADMIN: GET runs lista las ejecuciones y el estado', async () => {
    await ok([ficha('run-a')]);
    const g = await app.inject({ method: 'GET', url: '/api/admin/pipeline/runs', remoteAddress: nextIp(), headers: { cookie: await cookieFor('ADMIN') } });
    assert.equal(g.statusCode, 200, g.body);
    assert.match(String(g.headers['cache-control']), /no-store/);
    const body = g.json<{ runs: Array<{ status: string }>; estado: { activo: boolean; ingestaConfigurada: boolean; webhookConfigurado: boolean; enCurso: boolean } }>();
    assert.equal(body.runs.length, 1);
    assert.equal(body.runs[0]?.status, 'ok');
    assert.equal(body.estado.activo, true);
    assert.equal(body.estado.ingestaConfigurada, true);
    assert.equal(body.estado.webhookConfigurado, false);
    assert.equal(body.estado.enCurso, false);
  });
  it('ADMIN: trigger sin PIPELINE_WEBHOOK_URL -> 409 PIPELINE_WEBHOOK_UNSET y sin ejecucion en cola', async () => {
    const p = await app.inject({ method: 'POST', url: '/api/admin/pipeline/trigger', remoteAddress: nextIp(), headers: { cookie: await cookieFor('SUPER_ADMIN') } });
    assert.equal(p.statusCode, 409, p.body);
    assert.equal(p.json<{ code: string }>().code, 'PIPELINE_WEBHOOK_UNSET');
    assert.equal(await PipelineRun.countDocuments({ status: 'queued' }), 0);
  });
  it('ADMIN: una URL http (no https) cuenta como sin webhook', async () => {
    env.PIPELINE_WEBHOOK_URL = 'http://127.0.0.1:9/hook';
    const p = await app.inject({ method: 'POST', url: '/api/admin/pipeline/trigger', remoteAddress: nextIp(), headers: { cookie: await cookieFor('ADMIN') } });
    assert.equal(p.statusCode, 409);
    assert.equal(p.json<{ code: string }>().code, 'PIPELINE_WEBHOOK_UNSET');
  });
});

describe('(g) promote() de una Submission pipeline sobre ficha existente', () => {
  it('actualiza la ficha en vez de duplicarla y conserva manualEdits', async () => {
    await ok([ficha('prom-a', { categoria: 'Pistolas' })]);
    const first = await Submission.findOne({ origin: 'pipeline' }).lean();
    await promote(first!._id, { id: 'system', role: 'SYSTEM' });
    const created = await Entity.findOne({ slug: 'prom-a' }).lean();
    assert.ok(created);
    await Entity.updateOne({ _id: created._id }, { $set: { manualEdits: ['subtitulo'] } });
    await Submission.deleteMany({});

    const r = await ok([ficha('prom-a', { categoria: 'Rifles', titulo: 'Titulo nuevo' })]);
    assert.equal(r.actualizadas, 1);
    const sub = await Submission.findOne({ origin: 'pipeline', status: 'pending' }).lean();
    const done = await promote(sub!._id, { id: 'system', role: 'SYSTEM' });

    assert.equal(await Entity.countDocuments({ slug: 'prom-a' }), 1, 'no se duplica la ficha');
    const updated = await Entity.findOne({ slug: 'prom-a' }).lean();
    assert.equal(updated?._id, created._id);
    assert.equal(updated?.categoria, 'Rifles');
    assert.equal(updated?.titulo, 'Titulo nuevo');
    assert.deepEqual(updated?.manualEdits, ['subtitulo']);
    assert.equal(done.status, 'approved');
    assert.deepEqual({ ...done.promotedTo }, { collection: 'Entity', id: created._id });
    assert.notEqual(updated?.contentHash, created.contentHash);
  });
  it('promote es idempotente y re-ingerir tras promover da sin_cambios', async () => {
    await ok([ficha('prom-b')]);
    const sub = await Submission.findOne({ origin: 'pipeline' }).lean();
    await promote(sub!._id, { id: 'system', role: 'SYSTEM' });
    await promote(sub!._id, { id: 'system', role: 'SYSTEM' });
    assert.equal(await Entity.countDocuments({ slug: 'prom-b' }), 1);
    const r = await ok([ficha('prom-b')]);
    assert.equal(r.sin_cambios, 1);
  });
  it('promover una ficha nueva con marker crea Entity + MapMarker enlazado', async () => {
    await ok([ficha('prom-pin', { marker: { region: 'Leonida Keys', coord_x: 100, coord_y: 200 } })]);
    const sub = await Submission.findOne({ origin: 'pipeline' }).lean();
    await promote(sub!._id, { id: 'system', role: 'SYSTEM' });
    const ent = await Entity.findOne({ slug: 'prom-pin' }).lean();
    assert.ok(ent);
    assert.equal(await mongoose.connection.collection('mapmarkers').countDocuments({ entity_id: ent._id }), 1);
  });
});

describe('(h) aportes de usuario no fijan campos del servidor (I1/I2)', () => {
  const SYS = { id: 'system', role: 'SYSTEM' } as const;
  const FAKE_HASH = 'f'.repeat(64);
  const userSub = (type: 'entity' | 'correction', payload: Record<string, unknown>) =>
    Submission.create({ userId: randomUUID(), moduleSlug: MODULE, type, title: 'Aporte de prueba', payload, coords: null, status: 'pending', reviewedBy: null, promotedTo: null });

  it('promote de un aporte entity de usuario descarta contentHash, manualEdits y capturaPropiaPendiente', async () => {
    const sub = await userSub('entity', {
      ...ficha('usr-new'),
      slug: 'usr-new',
      stats_json: {},
      metadata_json: {},
      contentHash: FAKE_HASH,
      manualEdits: ['titulo', 'categoria'],
      capturaPropiaPendiente: true,
    });
    await promote(sub._id, SYS);
    const e = await Entity.findOne({ slug: 'usr-new' }).lean();
    assert.ok(e);
    assert.equal(e.contentHash ?? null, null);
    assert.deepEqual(e.manualEdits, []);
    assert.equal(e.capturaPropiaPendiente, false);
  });

  it('correction de usuario: ignora los campos del servidor y (I2) marca manualEdits y recalcula contentHash', async () => {
    await ok([ficha('usr-fix')]);
    await promote((await Submission.findOne({ origin: 'pipeline' }).lean())!._id, SYS);
    await Submission.deleteMany({});
    const before = await Entity.findOne({ slug: 'usr-fix' }).lean();
    assert.ok(before?.contentHash);
    assert.deepEqual(before.manualEdits, []);

    const sub = await userSub('correction', {
      target: 'Entity',
      id: before._id,
      patch: { titulo: 'Titulo corregido', contentHash: FAKE_HASH, manualEdits: ['categoria'], capturaPropiaPendiente: true },
    });
    await promote(sub._id, SYS);
    const after = await Entity.findOne({ slug: 'usr-fix' }).lean();
    assert.equal(after?.titulo, 'Titulo corregido');
    assert.deepEqual(after?.manualEdits, ['titulo'], 'solo el campo realmente corregido, no el que mando el usuario');
    assert.equal(after?.capturaPropiaPendiente, before.capturaPropiaPendiente, 'no cambia por lo que mande el usuario');
    assert.notEqual(after?.contentHash, FAKE_HASH);
    assert.notEqual(after?.contentHash, before.contentHash);
    assert.match(after?.contentHash ?? '', /^[a-f0-9]{64}$/);

    // Una segunda correccion acumula sin duplicar.
    const sub2 = await userSub('correction', { target: 'Entity', id: before._id, patch: { titulo: 'Otro titulo', categoria: 'Rifles' } });
    await promote(sub2._id, SYS);
    const again = await Entity.findOne({ slug: 'usr-fix' }).lean();
    assert.deepEqual([...(again?.manualEdits ?? [])].sort(), ['categoria', 'titulo']);
  });
});

describe('(i) imagen_url vacia no se guarda (M2)', () => {
  it('"" se normaliza a null: la ficha se crea sin imagen y el payload no lleva ""', async () => {
    const r = await ok([ficha('img-empty', { imagen_url: '' })]);
    assert.equal(r.nuevas, 1);
    assert.equal(r.rechazados, 0);
    const sub = await Submission.findOne({ 'payload.slug': 'img-empty' }).lean();
    assert.equal((sub?.payload as { imagen_url?: unknown }).imagen_url ?? null, null);
    await promote(sub!._id, { id: 'system', role: 'SYSTEM' });
    const e = await Entity.findOne({ slug: 'img-empty' }).lean();
    assert.equal(e?.imagen_url ?? null, null);
  });
});

// ======================================================================================================
// Normalizacion, tarjeta, marker, lote, noticias, DTO y SSR (ficha real de FireCrawl como referencia)
// ======================================================================================================

const { canonicalizeMetadata } = await import('../services/catalogIngest.js');
const { MediaAsset } = await import('../models/MediaAsset.js');
const { MapMarker } = await import('../models/MapMarker.js');
const { AuditLog } = await import('../models/AuditLog.js');
const { OfficialNews } = await import('../models/OfficialNews.js');
const { clearSsrCache, resolveRoute, renderHead, socialImageOf, baseUrl, DEFAULT_IMAGE_PATH } = await import('../services/ssrLite.js');
const { runOfficialNewsIngest } = await import('../workers/officialNewsWorker.js');
const SYS = { id: 'system', role: 'SYSTEM' } as const;

/** WebP VP8L minimo (cabecera valida; basta para la sonda de tipo y dimensiones). */
function webp(width = 1600, height = 900, size = 64): Buffer {
  const b = Buffer.alloc(Math.max(size, 30));
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8L', 12, 'ascii');
  b.writeUInt32LE(b.length - 20, 16);
  b[20] = 0x2f;
  b.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  return b;
}
const tarjetaOf = (b: Buffer = webp()) => ({ mime: 'image/webp', base64: b.toString('base64') });

const roleCookies = new Map<string, string>();
async function staffCookie(rol: 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN'): Promise<string> {
  const cached = roleCookies.get(rol);
  if (cached) return cached;
  const id = randomUUID();
  await User.create({ _id: id, username: `x-${rol.toLowerCase()}-${id.slice(0, 6)}`, rol, identities: [] });
  const c = `${SESSION_COOKIE}=${await signSession(id, 600)}`;
  roleCookies.set(rol, c);
  return c;
}
const asStaff = async (method: 'GET' | 'POST' | 'PATCH', url: string, rol: 'MODERATOR' | 'ADMIN' | 'USER' = 'MODERATOR', payload?: unknown) =>
  app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: { cookie: await staffCookie(rol), ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
  });
const subOf = (slug: string) => Submission.findOne({ origin: 'pipeline', 'payload.slug': slug }).sort({ createdAt: -1 }).lean();
const promoteSlug = async (slug: string) => promote((await subOf(slug))!._id, SYS);

describe('(j) canonicalizeMetadata: alias -> claves canonicas, sin nulos ni ruido', () => {
  it('lleva descripcion_es, atributos y pasos a su forma canonica', () => {
    const r = canonicalizeMetadata({
      metadata: {
        descripcion_es: '  Un coche rapido.  ',
        fabricante: 'Karin',
        asientos: 2,
        cargador: 30,
        lugar: 'Vice Beach',
        clase: 'Deportivo',
        peso_kg: 1400,
        precio: null,
        marchas: '',
        steps: [{ titulo: 'Uno', texto: 'Hazlo' }, 'Solo texto'],
        pasos: [{ titulo: 'Duplicado', texto: 'x' }],
        requiere_redaccion: true,
        estado_verificacion: 'ok',
        stats_verificadas: { dano: 1 },
        howto_pendiente: true,
        fuente_ruta: '/tmp/x',
        fuente_url: 'https://ejemplo.test/a',
        notas: 'Redactar descripcion original a partir de los hechos',
        captura_propia_pendiente: true,
      },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.metadata, {
      descripcion: 'Un coche rapido.',
      marca: 'Karin',
      plazas: 2,
      municion: 30,
      ubicacion: 'Vice Beach',
      clase: 'Deportivo',
      peso_kg: 1400,
      fuente_url: 'https://ejemplo.test/a',
      steps: [
        { title: 'Uno', body: 'Hazlo' },
        { title: 'Paso 2', body: 'Solo texto' },
      ],
    });
    assert.equal(r.capturaPropiaPendiente, true);
  });
  it('la clave canonica con valor gana sobre su alias; los alias de 1er nivel funcionan', () => {
    const r = canonicalizeMetadata({ metadata: { marca: 'Declan', fabricante: 'Otro' }, top: { description: 'Texto', steps: [{ title: 'A', body: 'B' }], capturaPropiaPendiente: true } });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.metadata['marca'], 'Declan');
    assert.equal('fabricante' in r.metadata, false);
    assert.equal(r.metadata['descripcion'], 'Texto');
    assert.deepEqual(r.metadata['steps'], [{ title: 'A', body: 'B' }]);
    assert.equal(r.capturaPropiaPendiente, true);
  });
  it('descripcion fuera de limite se rechaza con motivo', () => {
    const r = canonicalizeMetadata({ metadata: { descripcion_es: 'x'.repeat(4001) } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /4000/);
  });
});

describe('(k) ingesta normaliza la ficha y avisa de claves desconocidas', () => {
  it('guarda metadata canonica en el payload, sin ruido, y reporta avisos', async () => {
    const r = await ok([
      ficha('norm-a', {
        metadata: { descripcion_es: 'Descripcion original.', fabricante: 'Karin', asientos: 4, precio: null, requiere_redaccion: true, captura_propia_pendiente: true },
        campo_raro: 'x',
      }),
      ficha('norm-b', { metadata: { description: 'y'.repeat(4001) } }),
    ]);
    assert.equal(r.nuevas, 1);
    assert.equal(r.rechazados, 1);
    const d = r.details.find((x) => x.slug === 'norm-a') as { avisos?: string[] } | undefined;
    assert.ok(d?.avisos?.some((a) => /campo_raro/.test(a)));
    assert.match(r.details.find((x) => x.slug === 'norm-b')?.motivo ?? '', /4000/);
    const sub = await subOf('norm-a');
    const p = sub!.payload as { metadata_json: Record<string, unknown>; capturaPropiaPendiente?: boolean };
    assert.equal(p.metadata_json['descripcion'], 'Descripcion original.');
    assert.equal(p.metadata_json['marca'], 'Karin');
    assert.equal(p.metadata_json['plazas'], 4);
    for (const k of ['descripcion_es', 'fabricante', 'asientos', 'precio', 'requiere_redaccion', 'captura_propia_pendiente']) assert.equal(k in p.metadata_json, false, k);
    assert.equal(p.capturaPropiaPendiente, true);
  });
  it('una ficha con steps/pasos de 1er nivel acaba con metadata.steps', async () => {
    await ok([ficha('norm-steps', { pasos: [{ titulo: 'Primero', texto: 'Hazlo asi' }] })]);
    const p = (await subOf('norm-steps'))!.payload as { metadata_json: { steps?: unknown; pasos?: unknown } };
    assert.deepEqual(p.metadata_json.steps, [{ title: 'Primero', body: 'Hazlo asi' }]);
    assert.equal('pasos' in p.metadata_json, false);
  });
});

describe('(l) tarjeta provisional', () => {
  it('lote mixto: valida entra; invalida, enorme, de otras dimensiones y con imagen_url se rechazan sin abortar', async () => {
    const r = await ok([
      ficha('tj-ok', { tarjeta: tarjetaOf() }),
      ficha('tj-b64', { tarjeta: { mime: 'image/webp', base64: '***no-base64***' } }),
      ficha('tj-big', { tarjeta: tarjetaOf(webp(1600, 900, 450 * 1024)) }),
      ficha('tj-dim', { tarjeta: tarjetaOf(webp(800, 450)) }),
      ficha('tj-png', { tarjeta: { mime: 'image/png', base64: webp().toString('base64') } }),
      ficha('tj-both', { tarjeta: tarjetaOf(), imagen_url: '/assets/propia.jpg' }),
      ficha('tj-plain'),
    ]);
    assert.equal(r.nuevas, 2);
    assert.equal(r.rechazados, 5);
    const by = Object.fromEntries(r.details.map((d) => [d.slug, d]));
    assert.match(by['tj-b64']?.motivo ?? '', /base64/);
    assert.match(by['tj-big']?.motivo ?? '', /m[aá]ximo/);
    assert.match(by['tj-dim']?.motivo ?? '', /1600x900/);
    assert.equal(by['tj-ok']?.resultado, 'nueva');
    assert.equal(await Submission.countDocuments({ 'payload.slug': { $in: ['tj-b64', 'tj-big', 'tj-dim', 'tj-png', 'tj-both'] } }), 0);
    const p = (await subOf('tj-ok'))!.payload as { tarjeta: { base64: string; sha256: string; bytes: number }; capturaPropiaPendiente: boolean };
    assert.equal(p.tarjeta.bytes, 64);
    assert.match(p.tarjeta.sha256, /^[a-f0-9]{64}$/);
    assert.equal(p.capturaPropiaPendiente, true);
  });

  it('el listado admin devuelve metadatos (sin base64) y la miniatura se sirve solo a staff', async () => {
    await ok([ficha('tj-list', { tarjeta: tarjetaOf() })]);
    const sub = await subOf('tj-list');
    const list = await asStaff('GET', '/api/admin/submissions?origin=pipeline');
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(!list.body.includes('base64'), 'el base64 no viaja en el listado');
    const item = list.json<Array<{ id: string; payload: { tarjeta?: { bytes: number; sha256: string } }; pipeline_reason: string; pipeline_run_id: string; conflict_fields: string[] }>>().find((x) => x.id === sub!._id);
    assert.equal(item?.payload.tarjeta?.bytes, 64);
    assert.equal(item?.pipeline_reason, 'nueva');
    assert.match(item?.pipeline_run_id ?? '', /^[0-9a-f-]{36}$/);
    assert.deepEqual(item?.conflict_fields, []);

    const img = await asStaff('GET', `/api/admin/submissions/${sub!._id}/tarjeta.webp`);
    assert.equal(img.statusCode, 200);
    assert.equal(img.headers['content-type'], 'image/webp');
    assert.match(String(img.headers['cache-control']), /no-store/);
    assert.deepEqual(img.rawPayload, webp());
    const asUser = await asStaff('GET', `/api/admin/submissions/${sub!._id}/tarjeta.webp`, 'USER');
    const anon = await app.inject({ method: 'GET', url: `/api/admin/submissions/${sub!._id}/tarjeta.webp`, remoteAddress: nextIp() });
    const missing = await app.inject({ method: 'GET', url: '/api/admin/no-existe-xyz', remoteAddress: nextIp() });
    assert.equal(asUser.statusCode, 404);
    assert.equal(anon.statusCode, 404);
    assert.equal(anon.body, missing.body);
    const none = await asStaff('GET', `/api/admin/submissions/${randomUUID()}/tarjeta.webp`);
    assert.equal(none.statusCode, 404);
  });

  it('promote crea el MediaAsset, fija imagen_url=/media/<id>, deja capturaPropiaPendiente y no guarda el base64 en Entity ni en auditoria', async () => {
    await ok([ficha('tj-prom', { tarjeta: tarjetaOf() })]);
    const done = await promoteSlug('tj-prom');
    const e = await Entity.findOne({ slug: 'tj-prom' }).lean();
    assert.match(e?.imagen_url ?? '', /^\/media\/[0-9a-f-]{36}$/);
    assert.equal(e?.capturaPropiaPendiente, true);
    assert.ok(!JSON.stringify(e).includes(webp().toString('base64')));
    const id = e!.imagen_url!.replace('/media/', '');
    const asset = await MediaAsset.findById(id).lean();
    assert.equal(asset?.mime, 'image/webp');
    assert.equal(asset?.width, 1600);
    assert.equal(asset?.created_by, 'system');
    assert.equal(done.status, 'approved');
    const audits = JSON.stringify(await AuditLog.find({ target_id: { $in: [e!._id, done._id] } }).lean());
    assert.ok(!audits.includes(webp().toString('base64')));
    // E2E: GET publico de la ficha y de su imagen.
    const pub = await app.inject({ method: 'GET', url: '/api/modules/armas/entities/tj-prom', remoteAddress: nextIp() });
    assert.equal(pub.statusCode, 200, pub.body);
    assert.equal(pub.json<{ imagen_url: string; capturaPropiaPendiente: boolean }>().imagen_url, e!.imagen_url);
    const media = await app.inject({ method: 'GET', url: e!.imagen_url!, remoteAddress: nextIp() });
    assert.equal(media.statusCode, 200);
    assert.deepEqual(media.rawPayload, webp());
  });

  it('rechazar la Submission no crea MediaAsset ni Entity', async () => {
    await ok([ficha('tj-rej', { tarjeta: tarjetaOf() })]);
    const sub = await subOf('tj-rej');
    const before = await MediaAsset.countDocuments();
    const res = await asStaff('PATCH', `/api/admin/submissions/${sub!._id}`, 'MODERATOR', { status: 'rejected', reviewNote: 'no' });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await MediaAsset.countDocuments(), before);
    assert.equal(await Entity.countDocuments({ slug: 'tj-rej' }), 0);
  });

  it('actualizacion: con manualEdits.imagen_url no se pisa; sin conflicto reemplaza la imagen /media/ previa', async () => {
    await ok([ficha('tj-upd', { tarjeta: tarjetaOf(webp(1600, 900, 64)) })]);
    await promoteSlug('tj-upd');
    const first = await Entity.findOne({ slug: 'tj-upd' }).lean();
    await Submission.deleteMany({});
    // Misma ficha y misma tarjeta -> sin cambios.
    const same = await ok([ficha('tj-upd', { tarjeta: tarjetaOf(webp(1600, 900, 64)) })]);
    assert.equal(same.sin_cambios, 1);
    // Tarjeta distinta -> actualizada y reemplaza.
    const r = await ok([ficha('tj-upd', { tarjeta: tarjetaOf(webp(1600, 900, 80)) })]);
    assert.equal(r.actualizadas, 1);
    await promoteSlug('tj-upd');
    const second = await Entity.findOne({ slug: 'tj-upd' }).lean();
    assert.notEqual(second?.imagen_url, first?.imagen_url);
    assert.match(second?.imagen_url ?? '', /^\/media\//);
    // Edicion manual de imagen_url: la tarjeta no se aplica.
    await Entity.updateOne({ slug: 'tj-upd' }, { $set: { manualEdits: ['imagen_url'], imagen_url: '/assets/mia.jpg' } });
    await Submission.deleteMany({});
    await ok([ficha('tj-upd', { tarjeta: tarjetaOf(webp(1600, 900, 96)) })]);
    const assets = await MediaAsset.countDocuments();
    await promoteSlug('tj-upd');
    assert.equal(await MediaAsset.countDocuments(), assets, 'no se crea el asset en conflicto');
    assert.equal((await Entity.findOne({ slug: 'tj-upd' }).lean())?.imagen_url, '/assets/mia.jpg');
  });
});

describe('(m) marker en el hash y slug de pin unico', () => {
  it('anadir un marker a una ficha existente la hace "actualizada"; el mismo marker es sin_cambios', async () => {
    await ok([ficha('mk-a')]);
    await promoteSlug('mk-a');
    await Submission.deleteMany({});
    const withPin = ficha('mk-a', { marker: { region: 'Keys', coord_x: 10, coord_y: 20 } });
    const r1 = await ok([withPin]);
    assert.equal(r1.actualizadas, 1);
    await promoteSlug('mk-a');
    await Submission.deleteMany({});
    const r2 = await ok([withPin]);
    assert.equal(r2.sin_cambios, 1);
    const r3 = await ok([ficha('mk-a', { marker: { region: 'Keys', coord_x: 11, coord_y: 20 } })]);
    assert.equal(r3.actualizadas, 1);
  });
  it('un slug de pin ya tomado recibe sufijo -2 en vez de omitirse', async () => {
    await MapMarker.deleteMany({});
    await ok([
      ficha('pin-uno', { marker: { region: 'Keys', coord_x: 1, coord_y: 1, slug: 'pin-comun' } }),
      ficha('pin-dos', { marker: { region: 'Keys', coord_x: 2, coord_y: 2, slug: 'pin-comun' } }),
    ]);
    await promoteSlug('pin-uno');
    await promoteSlug('pin-dos');
    const slugs = (await MapMarker.find({}).lean()).map((m) => m.slug).sort();
    assert.deepEqual(slugs, ['pin-comun', 'pin-comun-2']);
  });
});

describe('(n) POST /api/admin/submissions/bulk', () => {
  const bulk = (payload: unknown, rol: 'MODERATOR' | 'USER' = 'MODERATOR') => asStaff('POST', '/api/admin/submissions/bulk', rol, payload);

  it('sin staff o con USER: 404 uniforme aunque el cuerpo sea invalido (RBAC antes que Zod)', async () => {
    const ref = await app.inject({ method: 'GET', url: '/api/admin/no-existe-xyz', remoteAddress: nextIp() });
    const anon = await app.inject({ method: 'POST', url: '/api/admin/submissions/bulk', remoteAddress: nextIp(), headers: { 'content-type': 'application/json' }, payload: '{{malformado' });
    assert.equal(anon.statusCode, 404);
    assert.equal(anon.body, ref.body);
    assert.equal((await bulk({ nada: true }, 'USER')).statusCode, 404);
    assert.equal((await bulk({ nada: true })).statusCode, 400);
    assert.equal((await bulk({ action: 'approve', ids: [randomUUID()], filter: { origin: 'pipeline', status: 'pending' } })).statusCode, 400);
  });

  it('por ids: resultados parciales sin abortar', async () => {
    await ok([ficha('bk-a'), ficha('bk-b')]);
    const a = (await subOf('bk-a'))!._id;
    const b = (await subOf('bk-b'))!._id;
    const ghost = randomUUID();
    const res = await bulk({ action: 'approve', ids: [a, ghost, b] });
    assert.equal(res.statusCode, 200, res.body);
    const out = res.json<{ requested: number; ok: number; failed: number; truncated: boolean; results: Array<{ id: string; ok: boolean; error?: string }> }>();
    assert.equal(out.requested, 3);
    assert.equal(out.ok, 2);
    assert.equal(out.failed, 1);
    assert.equal(out.truncated, false);
    assert.equal(out.results.find((r) => r.id === ghost)?.ok, false);
    assert.equal(await Entity.countDocuments({ slug: { $in: ['bk-a', 'bk-b'] } }), 2);
    assert.equal(await AuditLog.countDocuments({ action: 'submission.approved', target_id: { $in: [a, b] } }), 2);
  });

  it('por filtro runId: approve excluye conflictos salvo reason explicito; reject usa reviewNote', async () => {
    await ok([ficha('bf-c'), ficha('bf-d')]);
    await promoteSlug('bf-c');
    await promoteSlug('bf-d');
    await Submission.deleteMany({});
    await Entity.updateOne({ slug: 'bf-c' }, { $set: { manualEdits: ['titulo'] } });
    const run = await ok([ficha('bf-c', { titulo: 'Cambiado' }), ficha('bf-d', { categoria: 'Rifles' }), ficha('bf-n'), ficha('bf-n2')]);
    const filter = { origin: 'pipeline', status: 'pending', runId: run.runId };
    const res = await bulk({ action: 'approve', filter });
    const out = res.json<{ ok: number; requested: number }>();
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(out.requested, 3, 'nueva, nueva y actualizada; el conflicto queda fuera');
    assert.equal(out.ok, 3);
    assert.equal((await subOf('bf-c'))!.status, 'pending');
    assert.equal(await Entity.countDocuments({ slug: { $in: ['bf-n', 'bf-n2'] } }), 2);

    const rej = await bulk({ action: 'reject', filter: { ...filter, reason: 'conflicto' }, reviewNote: 'edicion manual vigente' });
    assert.equal(rej.statusCode, 200, rej.body);
    assert.equal(rej.json<{ ok: number }>().ok, 1);
    const c = await subOf('bf-c');
    assert.equal(c!.status, 'rejected');
    assert.equal(c!.reviewNote, 'edicion manual vigente');
    // El listado admite filtrar por origen, run y motivo.
    const list = await asStaff('GET', `/api/admin/submissions?origin=pipeline&runId=${run.runId}&reason=conflicto`);
    assert.equal(list.json<unknown[]>().length, 1);
  });

  it('GET submissions: reason sin coincidencias devuelve vacio y runId invalido 400', async () => {
    assert.equal((await asStaff('GET', '/api/admin/submissions?reason=nueva')).json<unknown[]>().length, 0);
    assert.equal((await asStaff('GET', '/api/admin/submissions?runId=no-uuid')).statusCode, 400);
  });
});

describe('(o) el worker de noticias registra cada ciclo como PipelineRun', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Rockstar Games anuncia novedades de prueba</title><description>Resumen oficial de prueba sobre Rockstar Games.</description><link>https://ir.take2games.com/news-releases/prueba-1</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const realFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = realFetch;
  });
  it('ciclo correcto: run ok, scheduled, modulo noticias, y no cuenta como lote de catalogo', async () => {
    await OfficialNews.deleteMany({});
    globalThis.fetch = (async (input: unknown) => (String(input).endsWith('robots.txt') ? new Response('', { status: 404 }) : new Response(rss, { status: 200 }))) as typeof fetch;
    assert.equal(await runOfficialNewsIngest('cron'), true);
    const run = await PipelineRun.findOne({ modulo: 'noticias' }).lean();
    assert.equal(run?.status, 'ok');
    assert.equal(run?.trigger, 'scheduled');
    assert.equal(run?.source, 'news');
    assert.equal(run?.counts.created, 1);
    assert.equal(run?.counts.rejected, 0);
    assert.ok(run?.finishedAt);
    assert.equal(await AuditLog.countDocuments({ action: 'news.batch', actor_label: 'system:news', target_id: run?._id }), 1);

    const res = await asStaff('GET', '/api/admin/pipeline/runs', 'ADMIN');
    const body = res.json<{ runs: unknown[]; estado: { activo: boolean; ultimoLoteAt: string | null; enCurso: boolean } }>();
    assert.equal(body.runs.length, 0, 'por defecto solo lotes de catalogo');
    assert.equal(body.estado.activo, false);
    assert.equal(body.estado.ultimoLoteAt, null);
    const news = await asStaff('GET', '/api/admin/pipeline/runs?kind=noticias', 'ADMIN');
    const nb = news.json<{ runs: Array<{ kind: string; trigger: string }> }>();
    assert.equal(nb.runs.length, 1);
    assert.equal(nb.runs[0]?.kind, 'noticias');
    assert.equal(nb.runs[0]?.trigger, 'scheduled');
  });
  it('fuente caida: run en error con la fuente en rejected', async () => {
    await PipelineRun.deleteMany({});
    globalThis.fetch = (async () => {
      throw new Error('sin red');
    }) as typeof fetch;
    assert.equal(await runOfficialNewsIngest('manual'), true);
    const run = await PipelineRun.findOne({ modulo: 'noticias' }).lean();
    assert.equal(run?.status, 'error');
    assert.equal(run?.trigger, 'manual');
    assert.equal(run?.counts.rejected, 1);
    assert.equal(run?.rejected[0]?.slug, 'take-two-ir');
  });
});

describe('(p) DTO publico y SSR-lite con la descripcion canonica', () => {
  it('toEntityDTO expone capturaPropiaPendiente y no contentHash ni manualEdits; el SSR usa descripcion', async () => {
    const long = 'Descripcion editorial original de la ficha. '.repeat(10).trim();
    await ok([ficha('ssr-a', { metadata: { descripcion_es: long, fabricante: 'Karin', asientos: 2 } })]);
    await promoteSlug('ssr-a');
    const pub = await app.inject({ method: 'GET', url: '/api/modules/armas/entities/ssr-a', remoteAddress: nextIp() });
    const dto = pub.json<Record<string, unknown>>();
    assert.equal(dto['capturaPropiaPendiente'], true);
    assert.equal('contentHash' in dto, false);
    assert.equal('manualEdits' in dto, false);
    const md = dto['metadata_json'] as Record<string, unknown>;
    assert.equal(md['descripcion'], long);
    assert.equal(md['marca'], 'Karin');
    assert.equal(md['plazas'], 2);

    clearSsrCache();
    const r = await resolveRoute('/catalogo/armas/ssr-a', new URLSearchParams());
    assert.equal(r.kind, 'page');
    if (r.kind !== 'page') return;
    assert.ok(r.meta.description.length <= 160, r.meta.description);
    assert.ok(r.meta.description.startsWith('Descripcion editorial original'), r.meta.description + ' / ' + r.meta.title);
    const ld = JSON.stringify(r.meta.jsonLd);
    assert.ok(ld.includes(long), 'el JSON-LD lleva la descripcion completa');
  });
});

describe('(s) og:image y JSON-LD image dinamicos por ficha (S4.4)', () => {
  const UUID_A = randomUUID();
  const UUID_B = randomUUID();
  let guiasId: string;
  const mk = (mod: string, slug: string, imagen_url: string | null) =>
    Entity.create({ _id: randomUUID(), module_id: mod, slug, titulo: `Titulo ${slug}`, categoria: 'Pistolas', imagen_url });
  const headOf = async (path: string) => {
    clearSsrCache();
    const r = await resolveRoute(path, new URLSearchParams());
    assert.equal(r.kind, 'page');
    if (r.kind !== 'page') throw new Error('redirect');
    return { meta: r.meta, html: renderHead(r.meta) };
  };
  const og = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
  const ldImages = (meta: { jsonLd: Array<Record<string, unknown>> }) => meta.jsonLd[0]!['image'] as string[];

  before(async () => {
    await Module.deleteMany({ slug: 'guias' });
    guiasId = randomUUID();
    await Module.create({ _id: guiasId, slug: 'guias', nombre: 'Guias', icono: 'book', activo: true, orden: 9 });
  });

  it('socialImageOf: reglas puras', () => {
    const b = baseUrl();
    assert.deepEqual(socialImageOf({ imagen_url: null }), { url: b + DEFAULT_IMAGE_PATH, own: false });
    assert.equal(socialImageOf({ imagen_url: `/media/${UUID_A}`, titulo: 'T' }).url, `${b}/media/${UUID_A}`);
    assert.equal(socialImageOf({ imagen_url: '/assets/x.webp' }).url, `${b}/assets/x.webp`);
    assert.equal(socialImageOf({ imagen_url: 'https://cdn.example.com/a.jpg' }).url, 'https://cdn.example.com/a.jpg');
    for (const bad of ['javascript:alert(1)', '//evil.com/a.jpg', 'http://x.com/a.jpg', '/api/admin/x', '/assets/../secret', '/media/no-uuid', 'https://u:p@x.com/a.jpg', 'data:image/png;base64,AA']) {
      assert.equal(socialImageOf({ imagen_url: bad }).url, b + DEFAULT_IMAGE_PATH, bad);
    }
  });

  it('(a) ficha sin imagen: respaldo hero en og, twitter y JSON-LD, sin width/height/alt', async () => {
    await mk(moduleId, 'soc-sin', null);
    const { meta, html } = await headOf('/catalogo/armas/soc-sin');
    const hero = baseUrl() + DEFAULT_IMAGE_PATH;
    assert.equal(og(html, 'og:image'), hero);
    assert.equal(og(html, 'twitter:image'), hero);
    assert.deepEqual(ldImages(meta), [hero]);
    assert.equal(og(html, 'og:image:width'), undefined);
    assert.equal(og(html, 'og:image:alt'), undefined);
  });

  it('(b) ficha con /media/<uuid>: og, twitter y JSON-LD coinciden, con width/height/alt', async () => {
    await mk(moduleId, 'soc-propia', `/media/${UUID_A}`);
    const { meta, html } = await headOf('/catalogo/armas/soc-propia');
    const url = `${baseUrl()}/media/${UUID_A}`;
    assert.equal(og(html, 'og:image'), url);
    assert.equal(og(html, 'twitter:image'), url);
    assert.deepEqual(ldImages(meta), [url]);
    assert.equal(og(html, 'og:image:width'), '1600');
    assert.equal(og(html, 'og:image:height'), '900');
    assert.equal(og(html, 'og:image:alt'), 'Titulo soc-propia');
  });

  it('(c) dos fichas con imagenes distintas devuelven og:image distintos', async () => {
    await mk(moduleId, 'soc-uno', `/media/${UUID_A}`);
    await mk(moduleId, 'soc-dos', `/media/${UUID_B}`);
    const a = og((await headOf('/catalogo/armas/soc-uno')).html, 'og:image');
    const b = og((await headOf('/catalogo/armas/soc-dos')).html, 'og:image');
    assert.notEqual(a, b);
  });

  it('(d) imagen_url manipulada no se inyecta y cae al respaldo', async () => {
    await mk(moduleId, 'soc-js', 'javascript:alert(1)');
    await mk(moduleId, 'soc-ruta', '/api/admin/users');
    for (const slug of ['soc-js', 'soc-ruta']) {
      const { meta, html } = await headOf(`/catalogo/armas/${slug}`);
      const hero = baseUrl() + DEFAULT_IMAGE_PATH;
      assert.equal(og(html, 'og:image'), hero);
      assert.deepEqual(ldImages(meta), [hero]);
      assert.ok(!html.includes('javascript:') && !html.includes('/api/admin'));
      assert.equal(og(html, 'og:image:width'), undefined);
    }
  });

  it('(e) guia con imagen aplica lo mismo (HowTo image, og, twitter, width/height/alt)', async () => {
    await Entity.create({
      _id: randomUUID(),
      module_id: guiasId,
      slug: 'soc-guia',
      titulo: 'Guia social',
      categoria: 'Guias',
      imagen_url: `/media/${UUID_B}`,
      metadata_json: { steps: [{ id: '1', title: 'Paso uno', body: 'Texto' }] },
    });
    const { meta, html } = await headOf('/guias/soc-guia');
    const url = `${baseUrl()}/media/${UUID_B}`;
    assert.equal(meta.jsonLd[0]!['@type'], 'HowTo');
    assert.deepEqual(ldImages(meta), [url]);
    assert.equal(og(html, 'og:image'), url);
    assert.equal(og(html, 'twitter:image'), url);
    assert.equal(og(html, 'og:image:width'), '1600');
    assert.equal(og(html, 'og:image:alt'), 'Guia social');
  });
});

// ======================================================================================================
// M1 (WebP coherente) y M6 (revision atomica)
// ======================================================================================================

const { probeImage } = await import('../services/imageProbe.js');
const { reviewSubmission } = await import('../services/submissions.js');
const { readdirSync, readFileSync, existsSync } = await import('node:fs');

/** JPEG minimo con SOF0 (cabecera valida; basta para la sonda). */
function jpeg(width = 1600, height = 900): Buffer {
  const b = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  return b;
}
const CARDS_DIR = 'C:/Users/JuaneSnkrs/Documents/FireCrawl/exports/cards';

describe('(q) probeImage valida el contenedor WebP completo (M1)', () => {
  it('cabecera valida con tamano RIFF incoherente (mayor o menor que el archivo) se rechaza', () => {
    assert.deepEqual(probeImage(webp()), { mime: 'image/webp', width: 1600, height: 900 });
    const largo = webp();
    largo.writeUInt32LE(largo.length + 100, 4); // declara mas de lo que hay (truncado)
    assert.equal(probeImage(largo), null);
    const corto = webp();
    corto.writeUInt32LE(corto.length - 20, 4); // declara menos (bytes sobrantes)
    assert.equal(probeImage(corto), null);
  });
  it('el primer chunk debe caber en el archivo', () => {
    const b = webp();
    b.writeUInt32LE(b.length, 16); // chunk mas grande que lo que queda
    assert.equal(probeImage(b), null);
    const c = webp();
    c.writeUInt32LE(0, 16);
    assert.equal(probeImage(c), null);
  });
  it('tarjetas WebP reales (si existen en local) siguen siendo validas', { skip: !existsSync(CARDS_DIR) }, () => {
    const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith('.webp'));
    for (const f of files) assert.deepEqual(probeImage(readFileSync(`${CARDS_DIR}/${f}`)), { mime: 'image/webp', width: 1600, height: 900 }, f);
  });
  it('subida admin del Hero: WebP (sintetico y real) y JPEG 1600x900 pasan; WebP con RIFF roto no', async () => {
    const cookie = await staffCookie('ADMIN');
    const up = (body: Buffer, type: string) =>
      app.inject({ method: 'POST', url: '/api/admin/media', remoteAddress: nextIp(), headers: { cookie, 'content-type': type }, payload: body });
    assert.equal((await up(webp(), 'image/webp')).statusCode, 201);
    assert.equal((await up(jpeg(), 'image/jpeg')).statusCode, 201);
    if (existsSync(CARDS_DIR)) {
      const real = readdirSync(CARDS_DIR).find((f) => f.endsWith('.webp'));
      if (real) assert.equal((await up(readFileSync(`${CARDS_DIR}/${real}`), 'image/webp')).statusCode, 201);
    }
    const roto = webp();
    roto.writeUInt32LE(roto.length + 100, 4);
    assert.equal((await up(roto, 'image/webp')).statusCode, 400);
  });
});

describe('(r) reviewSubmission: rechazo con guarda atomica (M6)', () => {
  const reviewer = { _id: 'system', rol: 'SUPER_ADMIN' as const };
  const userSub = (slug: string) =>
    Submission.create({
      userId: randomUUID(),
      moduleSlug: MODULE,
      type: 'entity',
      title: 'Aporte M6',
      payload: { ...ficha(slug), slug, stats_json: {}, metadata_json: {} },
      coords: null,
      status: 'pending',
      reviewedBy: null,
      promotedTo: null,
    });

  it('aprobar y luego rechazar el mismo aporte: 409 y queda approved con ficha promovida', async () => {
    const sub = await userSub('m6-a');
    await reviewSubmission(sub._id, 'approved', reviewer);
    await assert.rejects(() => reviewSubmission(sub._id, 'rejected', reviewer), { statusCode: 409 });
    const after = await Submission.findById(sub._id).lean();
    assert.equal(after?.status, 'approved');
    assert.ok(after?.promotedTo);
    assert.equal(await Entity.countDocuments({ slug: 'm6-a' }), 1);
  });

  it('rechazar dos veces: la segunda es 409 y no pisa al revisor', async () => {
    const sub = await userSub('m6-b');
    await reviewSubmission(sub._id, 'rejected', reviewer, null, 'no');
    await assert.rejects(() => reviewSubmission(sub._id, 'rejected', reviewer, null, 'otra'), { statusCode: 409 });
    assert.equal((await Submission.findById(sub._id).lean())?.status, 'rejected');
  });

  it('el rechazo no pisa un aporte que ya tiene ficha promovida aunque su lectura previa fuera pending', async () => {
    const sub = await userSub('m6-c');
    await promote(sub._id, SYS);
    // Simula la carrera: el documento ya esta promovido; la guarda del update debe impedir marcarlo rejected.
    await Submission.updateOne({ _id: sub._id }, { $set: { status: 'pending' } });
    await assert.rejects(() => reviewSubmission(sub._id, 'rejected', reviewer), { statusCode: 409 });
    const after = await Submission.findById(sub._id).lean();
    assert.notEqual(after?.status, 'rejected');
    assert.ok(after?.promotedTo);
  });
});

describe('POST /api/admin/entities/:id/image (reemplazo manual de imagen)', () => {
  const sharpMod = import('sharp').then((m) => m.default);
  const png = async (w = 1600, h = 900): Promise<Buffer> =>
    (await sharpMod)({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 120 } } }).png().toBuffer();
  const post = async (id: string, body: Buffer | string, type: string, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/admin/entities/${id}/image`,
      remoteAddress: nextIp(),
      headers: { ...(cookie ? { cookie } : {}), 'content-type': type },
      payload: body,
    });
  const mkEntity = async (slug: string, extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await Entity.create({ _id: id, module_id: moduleId, slug, titulo: `Ficha ${slug}`, categoria: 'Pistolas', ...extra });
    return id;
  };
  const mkMedia = async (): Promise<string> => {
    const { MediaAsset } = await import('../models/MediaAsset.js');
    const data = await (await sharpMod)({ create: { width: 1600, height: 900, channels: 3, background: '#112233' } }).webp().toBuffer();
    const id = randomUUID();
    await MediaAsset.create({ _id: id, mime: 'image/webp', width: 1600, height: 900, bytes: data.length, data, created_by: 'system' });
    return id;
  };

  it('sin sesion de staff responde el 404 uniforme', async () => {
    const id = await mkEntity('img-anon');
    const r = await post(id, await png(), 'image/png');
    assert.equal(r.statusCode, 404);
  });

  it('un MODERATOR no puede reemplazar imagenes (solo ADMIN+)', async () => {
    const id = await mkEntity('img-mod');
    const r = await post(id, await png(), 'image/png', await staffCookie('MODERATOR'));
    assert.equal(r.statusCode, 404);
  });

  it('procesa a WebP 1600x900 <= 600 KB con miniatura, borra el /media anterior, baja el flag y deja auditoria', async () => {
    const { MediaAsset } = await import('../models/MediaAsset.js');
    const { AuditLog } = await import('../models/AuditLog.js');
    const { probeImage } = await import('../services/imageProbe.js');
    const oldId = await mkMedia();
    const id = await mkEntity('img-ok', {
      imagen_url: `/media/${oldId}`,
      capturaPropiaPendiente: true,
      metadata_json: { capturaPropiaPendiente: true, descripcion: 'x' },
    });
    const r = await post(id, await png(), 'image/png', await staffCookie('ADMIN'));
    assert.equal(r.statusCode, 200, r.body);
    const out = r.json() as { url: string; bytes: number };
    const doc = await Entity.findById(id).lean();
    assert.equal(doc?.imagen_url, out.url);
    assert.match(out.url, /^\/media\/[0-9a-f-]{36}$/);
    assert.equal(doc?.capturaPropiaPendiente, false);
    assert.equal((doc?.metadata_json as Record<string, unknown>)['capturaPropiaPendiente'], undefined);
    assert.equal((doc?.metadata_json as Record<string, unknown>)['descripcion'], 'x');
    assert.ok(doc?.manualEdits?.includes('imagen_url'));
    assert.equal(await MediaAsset.exists({ _id: oldId }), null, 'el asset anterior no debe quedar huerfano');
    const asset = await MediaAsset.findById(out.url.slice('/media/'.length));
    assert.ok(asset && asset.bytes <= 614_400 && asset.thumb_data);
    const info = probeImage(Buffer.from(asset.data));
    assert.deepEqual([info?.mime, info?.width, info?.height], ['image/webp', 1600, 900]);
    assert.ok(await AuditLog.exists({ action: 'entity.image.replace', target_id: id }));
    assert.ok(await AuditLog.exists({ action: 'media.delete', target_id: oldId }));
  });

  it('no borra el /media anterior si otra ficha lo sigue usando', async () => {
    const { MediaAsset } = await import('../models/MediaAsset.js');
    const shared = await mkMedia();
    const a = await mkEntity('img-shared-a', { imagen_url: `/media/${shared}` });
    await mkEntity('img-shared-b', { imagen_url: `/media/${shared}` });
    const r = await post(a, await png(), 'image/png', await staffCookie('ADMIN'));
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(await MediaAsset.exists({ _id: shared }));
  });

  it('rechaza contenido que no coincide con el tipo declarado y fichas inexistentes', async () => {
    const id = await mkEntity('img-bad');
    const cookie = await staffCookie('ADMIN');
    assert.equal((await post(id, Buffer.from('no soy una imagen'), 'image/png', cookie)).statusCode, 400);
    assert.equal((await post(id, await png(), 'image/jpeg', cookie)).statusCode, 400);
    assert.equal((await post(randomUUID(), await png(), 'image/png', cookie)).statusCode, 404);
    assert.equal((await Entity.findById(id).lean())?.imagen_url ?? null, null);
  });

  it('GET /api/entities?provisional=1 lista solo fichas con imagen provisional', async () => {
    await mkEntity('prov-si', { capturaPropiaPendiente: true });
    await mkEntity('prov-no');
    const r = await app.inject({ method: 'GET', url: '/api/entities?provisional=1&limit=500', remoteAddress: nextIp() });
    const slugs = (r.json() as Array<{ slug: string; capturaPropiaPendiente: boolean }>).map((e) => e.slug);
    assert.ok(slugs.includes('prov-si'));
    assert.ok(!slugs.includes('prov-no'));
  });
});

describe('Estudio de Imagenes (Sprint 3): procesamiento, variantes, cola, emparejado y limpieza', () => {
  const sharpMod = import('sharp').then((m) => m.default);
  const VIVID = { r: 230, g: 40, b: 120 };
  const solid = async (w: number, h: number, fmt: 'png' | 'jpeg' = 'png'): Promise<Buffer> => {
    const s = (await sharpMod)({ create: { width: w, height: h, channels: 3, background: VIVID } });
    return fmt === 'png' ? s.png().toBuffer() : s.jpeg().toBuffer();
  };
  /** Degradado vertical (verde arriba -> magenta abajo) para distinguir recortes por foco. */
  const vgrad = async (w: number, h: number): Promise<Buffer> => {
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        raw[i] = Math.round(255 * t);
        raw[i + 1] = Math.round(255 * (1 - t));
        raw[i + 2] = 80;
      }
    }
    return (await sharpMod)(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  };
  const pixel = async (img: Buffer, x: number, y: number): Promise<[number, number, number]> => {
    const { data, info } = await (await sharpMod)(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
  };
  const close = (a: [number, number, number], b: [number, number, number], tol = 12): boolean => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= tol);
  const FRAME: [number, number, number] = [0x0b, 0x0f, 0x1f];

  const post = async (id: string, body: Buffer, type: string, query = '', cookie?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/admin/entities/${id}/image${query}`,
      remoteAddress: nextIp(),
      headers: { cookie: cookie ?? (await staffCookie('ADMIN')), 'content-type': type },
      payload: body,
    });
  const mkEntity = async (slug: string, extra: Record<string, unknown> = {}, modId: string = moduleId) => {
    const id = randomUUID();
    await Entity.create({ _id: id, module_id: modId, slug, titulo: `Ficha ${slug}`, categoria: 'Pistolas', ...extra });
    return id;
  };
  const mkMedia = async (thumb = false): Promise<string> => {
    const { MediaAsset } = await import('../models/MediaAsset.js');
    const sh = await sharpMod;
    const data = await sh({ create: { width: 1600, height: 900, channels: 3, background: '#112233' } }).webp().toBuffer();
    const extra = thumb
      ? { thumb_data: await sh({ create: { width: 800, height: 450, channels: 3, background: '#445566' } }).webp().toBuffer(), thumb_width: 800, thumb_height: 450 }
      : {};
    const id = randomUUID();
    await MediaAsset.create({ _id: id, mime: 'image/webp', width: 1600, height: 900, bytes: data.length, data, created_by: 'system', ...extra });
    return id;
  };
  const dims = async (buf: Buffer): Promise<[number | undefined, number | undefined, string | undefined]> => {
    const m = await (await sharpMod)(buf).metadata();
    return [m.width, m.height, m.format];
  };
  type UploadOut = { id: string; url: string; bytes: number; thumb_bytes: number; width: number; height: number; cropped: boolean; capturaPropiaPendiente: boolean };
  const getMedia = async (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, remoteAddress: nextIp(), headers });

  it('(a) PNG 1600x900: principal 1600x900 WebP <= 600 KB, miniatura 800x450 y SIN barras #0b0f1f', async () => {
    const { MediaAsset } = await import('../models/MediaAsset.js');
    const id = await mkEntity('st-a');
    const r = await post(id, await solid(1600, 900), 'image/png');
    assert.equal(r.statusCode, 200, r.body);
    const out = r.json<UploadOut>();
    assert.deepEqual([out.width, out.height, out.cropped, out.capturaPropiaPendiente], [1600, 900, false, false]);
    assert.ok(out.bytes <= 614_400 && out.thumb_bytes > 0);
    const asset = await MediaAsset.findById(out.url.slice('/media/'.length));
    assert.ok(asset?.thumb_data);
    const main = Buffer.from(asset.data);
    const thumb = Buffer.from(asset.thumb_data);
    assert.deepEqual(await dims(main), [1600, 900, 'webp']);
    assert.deepEqual(await dims(thumb), [800, 450, 'webp']);
    assert.equal(asset.thumb_bytes, thumb.length);
    for (const [x, y] of [[0, 0], [1599, 0], [0, 899], [1599, 899], [0, 450], [1599, 450], [800, 450]] as const) {
      const p = await pixel(main, x, y);
      assert.ok(!close(p, FRAME, 30), `barra detectada en ${x},${y}`);
      assert.ok(close(p, [VIVID.r, VIVID.g, VIVID.b], 25), `color inesperado en ${x},${y}: ${p.join(',')}`);
    }
  });

  it('(b) JPG 2400x1350 reduce a 1600x900 (16:9, sin recorte) y no amplia', async () => {
    const id = await mkEntity('st-b');
    const r = await post(id, await solid(2400, 1350, 'jpeg'), 'image/jpeg');
    assert.equal(r.statusCode, 200, r.body);
    const out = r.json<UploadOut>();
    assert.deepEqual([out.width, out.height, out.cropped], [1600, 900, false]);
    const media = await getMedia(out.url);
    assert.deepEqual(await dims(media.rawPayload), [1600, 900, 'webp']);
  });

  it('(c) fuente 4:3 de 2000x1500: recorte cover 1600x900, cropped:true y el foco desplaza el recorte', async () => {
    const src = await vgrad(2000, 1500);
    const top = await post(await mkEntity('st-c1'), src, 'image/png', '?focus=50,0');
    const bottom = await post(await mkEntity('st-c2'), src, 'image/png', '?focus=50,100');
    const center = await post(await mkEntity('st-c3'), src, 'image/png');
    for (const r of [top, bottom, center]) {
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual([r.json<UploadOut>().width, r.json<UploadOut>().height, r.json<UploadOut>().cropped], [1600, 900, true]);
    }
    const px = async (r: { json: () => unknown }) => pixel((await getMedia((r.json() as UploadOut).url)).rawPayload, 800, 450);
    const [pt, pb, pc] = [await px(top), await px(bottom), await px(center)];
    assert.ok(!close(pt, pb, 20), `foco arriba/abajo deberian diferir: ${pt} vs ${pb}`);
    assert.ok(pt[0] < pc[0] && pc[0] < pb[0], 'el centro queda entre los dos focos');
  });

  it('(c2) focus invalido -> 400; alt se guarda y, si no llega, no se toca el existente', async () => {
    const id = await mkEntity('st-c4', { metadata_json: { imagen_alt: 'alt previo' } });
    assert.equal((await post(id, await solid(1600, 900), 'image/png', '?focus=abc')).statusCode, 400);
    assert.equal((await post(id, await solid(1600, 900), 'image/png', '?focus=150,10')).statusCode, 400);
    assert.equal((await post(id, await solid(1600, 900), 'image/png', `?alt=${'x'.repeat(201)}`)).statusCode, 400);
    assert.equal((await post(id, await solid(1600, 900), 'image/png')).statusCode, 200);
    assert.equal(((await Entity.findById(id).lean())?.metadata_json as Record<string, unknown>)['imagen_alt'], 'alt previo');
    assert.equal((await post(id, await solid(1600, 900), 'image/png', `?alt=${encodeURIComponent('Pistola sobre mesa')}`)).statusCode, 200);
    assert.equal(((await Entity.findById(id).lean())?.metadata_json as Record<string, unknown>)['imagen_alt'], 'Pistola sobre mesa');
  });

  it('(d) fuente menor de 1600x900 -> 400 con el mensaje y sin escribir nada', async () => {
    const { MediaAsset } = await import('../models/MediaAsset.js');
    const before = await MediaAsset.countDocuments();
    const id = await mkEntity('st-d');
    const r = await post(id, await solid(1200, 800), 'image/png');
    assert.equal(r.statusCode, 400);
    assert.match(r.body, /al menos 1600×900 px \(recibida 1200×800\)/);
    assert.equal((await post(id, await solid(1600, 899), 'image/png')).statusCode, 400);
    assert.equal(await MediaAsset.countDocuments(), before);
    assert.equal((await Entity.findById(id).lean())?.imagen_url ?? null, null);
  });

  it('(e) ruido incompresible que no cabe en 600 KB -> 400 claro y sin escribir nada', async () => {
    const { randomBytes } = await import('node:crypto');
    const { MediaAsset } = await import('../models/MediaAsset.js');
    const before = await MediaAsset.countDocuments();
    const noise = await (await sharpMod)(randomBytes(1600 * 900 * 3), { raw: { width: 1600, height: 900, channels: 3 } }).png().toBuffer();
    const id = await mkEntity('st-e');
    const r = await post(id, noise, 'image/png');
    assert.equal(r.statusCode, 400);
    assert.match(r.body, /no se puede comprimir por debajo de 600 KB/);
    assert.equal(await MediaAsset.countDocuments(), before);
  });

  it('(f) /media/:id?w=800 sirve la miniatura; sin w el principal; ETag y 304 por variante; legacy sin variante sirve el principal', async () => {
    const id = await mkEntity('st-f');
    const out = (await post(id, await solid(1600, 900), 'image/png')).json<UploadOut>();
    const mid = out.url.slice('/media/'.length);
    const main = await getMedia(out.url);
    const thumb = await getMedia(`${out.url}?w=800`);
    assert.equal(main.statusCode, 200);
    assert.equal(thumb.statusCode, 200);
    assert.deepEqual(await dims(main.rawPayload), [1600, 900, 'webp']);
    assert.deepEqual(await dims(thumb.rawPayload), [800, 450, 'webp']);
    assert.equal(main.headers['etag'], `"${mid}"`);
    assert.equal(thumb.headers['etag'], `"${mid}-800"`);
    for (const r of [main, thumb]) {
      assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['content-length'], String(r.rawPayload.length));
    }
    assert.equal(thumb.rawPayload.length, out.thumb_bytes);
    assert.equal((await getMedia(`${out.url}?w=800`, { 'if-none-match': `"${mid}-800"` })).statusCode, 304);
    assert.equal((await getMedia(out.url, { 'if-none-match': `"${mid}"` })).statusCode, 304);
    const other = await getMedia(`${out.url}?w=400`);
    assert.deepEqual(await dims(other.rawPayload), [1600, 900, 'webp']);
    assert.equal(other.headers['etag'], `"${mid}"`);
    const legacy = await mkMedia(false);
    const lg = await getMedia(`/media/${legacy}?w=800`);
    assert.equal(lg.statusCode, 200);
    assert.deepEqual(await dims(lg.rawPayload), [1600, 900, 'webp']);
    assert.equal(lg.headers['etag'], `"${legacy}"`);
    const gone = await getMedia(`/media/${randomUUID()}?w=800`);
    assert.equal(gone.statusCode, 404);
    assert.match(String(gone.headers['content-type']), /text\/plain/);
  });

  it('(g) cola: filtros por modulo, q y estado, stats y 404 uniforme sin staff/MODERATOR', async () => {
    const vehId = randomUUID();
    await Module.create({ _id: vehId, slug: 'vehiculos', nombre: 'Vehiculos', icono: 'car', activo: true, orden: 2 });
    const own = `/media/${randomUUID()}`;
    await mkEntity('q-a');
    await mkEntity('q-b', { imagen_url: '/assets/hero-gas-station.jpg', capturaPropiaPendiente: true });
    await mkEntity('q-c', { imagen_url: own }, vehId);
    await mkEntity('q-d', { imagen_url: '/assets/otra.jpg' }, vehId);
    const cookie = await staffCookie('ADMIN');
    const get = async (qs: string, c: string | null = cookie) =>
      app.inject({ method: 'GET', url: `/api/admin/images/queue${qs}`, remoteAddress: nextIp(), headers: c ? { cookie: c } : {} });
    type Stats = { total: number; sin_imagen: number; provisionales: number; propias: number };
    type Q = {
      items: Array<{ id: string; slug: string; module_slug: string; imagen_url: string | null; capturaPropiaPendiente: boolean; imagen_alt: string | null }>;
      total: number;
      page: number;
      pages: number;
      stats: Stats;
      stats_por_modulo: Record<string, Stats>;
    };
    const def = await get('');
    assert.equal(def.statusCode, 200, def.body);
    assert.equal(def.headers['cache-control'], 'private, no-store');
    const d = def.json<Q>();
    assert.deepEqual(d.items.map((i) => i.slug).sort(), ['q-a', 'q-b']);
    assert.equal(d.total, 2);
    assert.deepEqual(d.stats, { total: 4, sin_imagen: 1, provisionales: 1, propias: 1 });
    assert.deepEqual(d.stats_por_modulo['vehiculos'], { total: 2, sin_imagen: 0, provisionales: 0, propias: 1 });
    assert.deepEqual(d.stats_por_modulo['armas'], { total: 2, sin_imagen: 1, provisionales: 1, propias: 0 });
    const all = (await get('?estado=todas')).json<Q>();
    assert.equal(all.total, 4);
    assert.equal(all.items.find((i) => i.slug === 'q-c')?.module_slug, 'vehiculos');
    assert.equal(all.items.find((i) => i.slug === 'q-b')?.capturaPropiaPendiente, true);
    const veh = (await get('?module=vehiculos&estado=todas')).json<Q>();
    assert.deepEqual(veh.items.map((i) => i.slug).sort(), ['q-c', 'q-d']);
    assert.equal(veh.stats.total, 4, 'stats global, no filtrado');
    assert.equal((await get('?module=vehiculos')).json<Q>().total, 0);
    assert.equal((await get('?module=no-existe&estado=todas')).json<Q>().total, 0);
    assert.deepEqual((await get('?q=Q-B&estado=todas')).json<Q>().items.map((i) => i.slug), ['q-b']);
    assert.equal((await get('?q=.*&estado=todas')).json<Q>().total, 0, 'q se escapa como literal');
    const pg = (await get('?estado=todas&limit=3&page=2')).json<Q>();
    assert.deepEqual([pg.items.length, pg.page, pg.pages, pg.total], [1, 2, 2, 4]);
    assert.equal((await get('?limit=101')).statusCode, 400);
    assert.equal((await get('', null)).statusCode, 404);
    assert.equal((await get('', await staffCookie('MODERATOR'))).statusCode, 404);
    assert.equal((await get('?limit=999', await staffCookie('MODERATOR'))).statusCode, 404, 'RBAC antes que Zod');
  });

  it('(h) match: encontrada, ambigua, no_encontrada, filtro por modulo y RBAC', async () => {
    let vehId = (await Module.findOne({ slug: 'vehiculos' }).lean())?._id;
    if (!vehId) {
      vehId = randomUUID();
      await Module.create({ _id: vehId, slug: 'vehiculos', nombre: 'Vehiculos', icono: 'car', activo: true, orden: 2 });
    }
    await mkEntity('m-unica');
    await mkEntity('m-dup');
    await mkEntity('m-dup', {}, vehId);
    const get = async (qs: string, c?: string) =>
      app.inject({ method: 'GET', url: `/api/admin/images/match${qs}`, remoteAddress: nextIp(), headers: c ? { cookie: c } : {} });
    type M = { matches: Record<string, { estado: string; candidatos: Array<{ module_slug: string; slug: string }> }> };
    const r = await get('?slugs=M-Unica,m-dup,m-nada', await staffCookie('ADMIN'));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['cache-control'], 'private, no-store');
    const m = r.json<M>().matches;
    assert.equal(m['m-unica']?.estado, 'encontrada');
    assert.equal(m['m-unica']?.candidatos[0]?.module_slug, 'armas');
    assert.equal(m['m-dup']?.estado, 'ambigua');
    assert.deepEqual(m['m-dup']?.candidatos.map((c) => c.module_slug).sort(), ['armas', 'vehiculos']);
    assert.deepEqual(m['m-nada'], { estado: 'no_encontrada', candidatos: [] });
    const f = (await get('?slugs=m-dup&module=vehiculos', await staffCookie('ADMIN'))).json<M>().matches;
    assert.equal(f['m-dup']?.estado, 'encontrada');
    assert.equal(f['m-dup']?.candidatos[0]?.module_slug, 'vehiculos');
    const many = Array.from({ length: 201 }, (_, i) => `s-${i}`).join(',');
    assert.equal((await get(`?slugs=${many}`, await staffCookie('ADMIN'))).statusCode, 400);
    assert.equal((await get('?slugs=m-unica')).statusCode, 404);
    assert.equal((await get('?slugs=m-unica', await staffCookie('MODERATOR'))).statusCode, 404);
    assert.equal((await get('', await staffCookie('MODERATOR'))).statusCode, 404, 'RBAC antes que Zod');
  });

  it('(i) DELETE de ficha borra su media y NO un media compartido (ni falla si no hay media)', async () => {
    const { MediaAsset } = await import('../models/MediaAsset.js');
    const { AuditLog } = await import('../models/AuditLog.js');
    const cookie = await staffCookie('ADMIN');
    const del = async (id: string) =>
      app.inject({ method: 'DELETE', url: `/api/entities/${id}`, remoteAddress: nextIp(), headers: { cookie } });
    const solo = await mkMedia(true);
    const a = await mkEntity('d-solo', { imagen_url: `/media/${solo}` });
    assert.equal((await del(a)).statusCode, 204);
    assert.equal(await MediaAsset.exists({ _id: solo }), null);
    assert.ok(await AuditLog.exists({ action: 'media.delete', target_id: solo }));
    const shared = await mkMedia();
    const b = await mkEntity('d-sh-a', { imagen_url: `/media/${shared}` });
    await mkEntity('d-sh-b', { imagen_url: `/media/${shared}` });
    assert.equal((await del(b)).statusCode, 204);
    assert.ok(await MediaAsset.exists({ _id: shared }), 'el media compartido se conserva');
    const c = await mkEntity('d-sin', { imagen_url: '/assets/hero-gas-station.jpg' });
    assert.equal((await del(c)).statusCode, 204);
  });

  it('(j) reemplazo: borra el media anterior, audita bytes de ambas variantes y recorte', async () => {
    const { AuditLog } = await import('../models/AuditLog.js');
    const { MediaAsset } = await import('../models/MediaAsset.js');
    const oldId = await mkMedia(true);
    const id = await mkEntity('st-j', { imagen_url: `/media/${oldId}`, capturaPropiaPendiente: true });
    const r = await post(id, await solid(2000, 1500), 'image/png');
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(await MediaAsset.exists({ _id: oldId }), null);
    const log = await AuditLog.findOne({ action: 'entity.image.replace', target_id: id }).lean();
    const d = log?.metadata as Record<string, unknown>;
    assert.equal(d['cropped'], true);
    assert.equal(typeof d['thumb_bytes'], 'number');
    assert.equal(typeof d['bytes'], 'number');
  });
});

describe('(k) modulos: registro modulo<->ruta, 422 y overview de staff', () => {
  type Ov = { modules: Array<Record<string, unknown> & { slug: string }> };
  const mkEntity = (slug: string) => Entity.create({ _id: randomUUID(), module_id: moduleId, slug, titulo: `Ficha ${slug}`, categoria: 'Pistolas' });
  let radioId: string;
  let foroId: string;
  before(async () => {
    await Module.deleteMany({ slug: { $in: ['radio', 'foro', 'extra-sin-ruta'] } });
    radioId = randomUUID();
    foroId = randomUUID();
    await Module.create({ _id: radioId, slug: 'radio', nombre: 'Radio', icono: 'radio', activo: false, orden: 7 });
    await Module.create({ _id: foroId, slug: 'foro', nombre: 'Foro', icono: 'chat', activo: false, orden: 5 });
  });

  it('(a) activar un modulo sin ruta publica -> 422 MODULE_WITHOUT_PUBLIC_ROUTE y no cambia nada', async () => {
    const r = await asStaff('PATCH', `/api/modules/${radioId}`, 'ADMIN', { activo: true });
    assert.equal(r.statusCode, 422, r.body);
    assert.equal(r.json<{ code?: string }>().code, 'MODULE_WITHOUT_PUBLIC_ROUTE');
    assert.equal((await Module.findById(radioId).lean())?.activo, false);
    // Crear uno nuevo sin ruta con activo por defecto (true) tambien se rechaza; con activo:false se crea.
    const c = await asStaff('POST', '/api/modules', 'ADMIN', { slug: 'extra-sin-ruta', nombre: 'Extra', icono: 'x' });
    assert.equal(c.statusCode, 422, c.body);
    assert.equal(c.json<{ code?: string }>().code, 'MODULE_WITHOUT_PUBLIC_ROUTE');
    const c2 = await asStaff('POST', '/api/modules', 'ADMIN', { slug: 'extra-sin-ruta', nombre: 'Extra', icono: 'x', activo: false });
    assert.equal(c2.statusCode, 201, c2.body);
  });

  it('(b)(c) desactivar siempre se permite; activar uno con ruta publica funciona', async () => {
    const on = await asStaff('PATCH', `/api/modules/${foroId}`, 'ADMIN', { activo: true });
    assert.equal(on.statusCode, 200, on.body);
    assert.equal(on.json<{ activo: boolean }>().activo, true);
    const off = await asStaff('PATCH', `/api/modules/${foroId}`, 'ADMIN', { activo: false });
    assert.equal(off.statusCode, 200, off.body);
    // Un modulo sin ruta que ya estuviera activo (dato heredado) siempre puede desactivarse.
    await Module.updateOne({ _id: radioId }, { $set: { activo: true } });
    const offRadio = await asStaff('PATCH', `/api/modules/${radioId}`, 'ADMIN', { activo: false });
    assert.equal(offRadio.statusCode, 200, offRadio.body);
  });

  it('(d) overview: sin sesion y MODERATOR -> 404 uniforme; ADMIN -> 200 con la forma del contrato', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/admin/no-existe-xyz', remoteAddress: nextIp() });
    const anon = await app.inject({ method: 'GET', url: '/api/admin/modules/overview', remoteAddress: nextIp() });
    assert.equal(anon.statusCode, 404);
    assert.equal(anon.body, missing.body);
    const mod = await asStaff('GET', '/api/admin/modules/overview', 'MODERATOR');
    assert.equal(mod.statusCode, 404);
    assert.equal(mod.body, missing.body);

    await Entity.deleteMany({});
    await mkEntity('ov-1');
    await mkEntity('ov-2');
    const ok = await asStaff('GET', '/api/admin/modules/overview', 'ADMIN');
    assert.equal(ok.statusCode, 200, ok.body);
    const { modules } = ok.json<Ov>();
    const bySlug = new Map(modules.map((m) => [m.slug, m]));
    const radio = bySlug.get('radio')!;
    assert.deepEqual(
      { tipo: radio['tipo'], ruta: radio['ruta_publica'], staff: radio['staff_seccion'], vis: radio['visible_en_publico'], activo: radio['activo'] },
      { tipo: 'sin_pantalla', ruta: null, staff: null, vis: false, activo: false },
    );
    const armas = bySlug.get(MODULE)!;
    assert.deepEqual(
      Object.keys(armas).sort(),
      ['activo', 'fichas', 'id', 'nombre', 'orden', 'pines', 'ruta_publica', 'slug', 'staff_seccion', 'tipo', 'visible_en_publico'],
    );
    assert.equal(armas['tipo'], 'categoria');
    assert.equal(armas['ruta_publica'], '/catalogo/armas');
    assert.equal(armas['fichas'], 2);
    assert.equal(armas['visible_en_publico'], true);
    // Categoria activa sin fichas no es visible; seccion activa (foro) si.
    await Module.updateOne({ _id: foroId }, { $set: { activo: true } });
    await Entity.deleteMany({});
    const again = (await asStaff('GET', '/api/admin/modules/overview', 'ADMIN')).json<Ov>().modules;
    assert.equal(again.find((m) => m.slug === MODULE)!['visible_en_publico'], false);
    assert.equal(again.find((m) => m.slug === 'foro')!['visible_en_publico'], true);
    await Module.updateOne({ _id: foroId }, { $set: { activo: false } });
  });

  it('(e) GET /api/modules incluye `fichas` numerico derivado (publico y ?all=1)', async () => {
    await Entity.deleteMany({});
    await mkEntity('cnt-1');
    await mkEntity('cnt-2');
    await mkEntity('cnt-3');
    const pub = await app.inject({ method: 'GET', url: '/api/modules', remoteAddress: nextIp() });
    assert.equal(pub.statusCode, 200, pub.body);
    const arm = pub.json<Array<{ slug: string; fichas: number }>>().find((m) => m.slug === MODULE)!;
    assert.equal(typeof arm.fichas, 'number');
    assert.equal(arm.fichas, 3);
    const all = await app.inject({ method: 'GET', url: '/api/modules?all=1', remoteAddress: nextIp(), headers: { cookie: await staffCookie('ADMIN') } });
    const radio = all.json<Array<{ slug: string; fichas: number }>>().find((m) => m.slug === 'radio')!;
    assert.equal(radio.fichas, 0);
  });
});

describe('(t) excepcion de transicion: extracto de confianza baja se actualiza, la editorial gana', () => {
  const SYS_ACTOR = { id: 'system', role: 'SYSTEM' } as const;
  /** Siembra una ficha existente de la fuente "editorial" con la confianza dada y la promueve a Entity. */
  async function seed(slug: string, confianza: string, manualEdits: string[] = []): Promise<void> {
    await ok([ficha(slug, { confianza })]);
    await promote((await subOf(slug))!._id, SYS_ACTOR);
    if (manualEdits.length) await Entity.updateOne({ slug }, { $set: { manualEdits } });
    await Submission.deleteMany({});
  }

  it('(a) confianza baja sin manualEdits + lote de otra fuente -> actualizada, con la nueva confianza y fuente', async () => {
    await seed('tr-a', 'baja');
    const before = await Entity.findOne({ slug: 'tr-a' }).lean();
    const r = await ok([ficha('tr-a', { titulo: 'Titulo redactado', confianza: 'media' })], { source: 'gtabase' });
    assert.equal(r.actualizadas, 1);
    assert.equal(r.conflictos, 0);
    assert.equal(r.details[0]?.resultado, 'actualizada');
    await promoteSlug('tr-a');
    const after = await Entity.findOne({ slug: 'tr-a' }).lean();
    assert.equal(after?._id, before?._id);
    assert.equal(after?.titulo, 'Titulo redactado');
    const meta = after?.metadata_json as Record<string, unknown>;
    assert.equal(meta['confianza'], 'media');
    assert.equal(meta['fuente'], 'gtabase');
  });

  it('(b) confianza media -> conflicto', async () => {
    await seed('tr-b', 'media');
    const r = await ok([ficha('tr-b', { titulo: 'Otro' })], { source: 'gtabase' });
    assert.equal(r.conflictos, 1);
    assert.equal(r.actualizadas, 0);
  });

  it('(b2) confianza alta -> conflicto', async () => {
    await seed('tr-b2', 'alta');
    const r = await ok([ficha('tr-b2', { titulo: 'Otro' })], { source: 'gtabase' });
    assert.equal(r.conflictos, 1);
  });

  it('(c) confianza baja con manualEdits -> conflicto', async () => {
    await seed('tr-c', 'baja', ['subtitulo']);
    const r = await ok([ficha('tr-c', { titulo: 'Otro' })], { source: 'gtabase' });
    assert.equal(r.conflictos, 1);
    assert.equal(r.actualizadas, 0);
  });

  it('(d) slug inexistente -> nueva', async () => {
    const r = await ok([ficha('tr-d')], { source: 'gtabase' });
    assert.equal(r.nuevas, 1);
  });

  it('(e) hash identico -> sin_cambios', async () => {
    await ok([ficha('tr-e', { confianza: 'baja' })], { source: 'gtabase' });
    await promoteSlug('tr-e');
    await Submission.deleteMany({});
    const r = await ok([ficha('tr-e', { confianza: 'baja' })], { source: 'gtabase' });
    assert.equal(r.sin_cambios, 1);
    assert.equal(await pendingPipeline('tr-e'), 0);
  });

  it('(f) la tarjeta se promueve a /media/... y deja capturaPropiaPendiente tras aprobar la actualizada', async () => {
    await seed('tr-f', 'baja');
    const r = await ok([ficha('tr-f', { titulo: 'Con tarjeta', confianza: 'media', tarjeta: tarjetaOf(), metadata: { fuente_imagen: 'www.gtabase.com' } })], { source: 'gtabase' });
    assert.equal(r.actualizadas, 1);
    await promoteSlug('tr-f');
    const e = await Entity.findOne({ slug: 'tr-f' }).lean();
    assert.match(e?.imagen_url ?? '', /^\/media\/[0-9a-f-]{36}$/);
    assert.equal(e?.capturaPropiaPendiente, true);
    assert.equal((e?.metadata_json as Record<string, unknown>)['fuente_imagen'], 'www.gtabase.com');
  });
});
