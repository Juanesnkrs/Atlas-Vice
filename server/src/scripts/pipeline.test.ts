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
