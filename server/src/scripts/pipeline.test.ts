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

describe('S2.3 politica de conflicto: compare y resolve', () => {
  type Cmp = {
    submission_id: string;
    estado: string;
    reason: string;
    entity: { id: string; slug: string; imagen_url: string | null; capturaPropiaPendiente: boolean } | null;
    actual: { titulo: string; descripcion: string | null; metadata: Record<string, unknown> } | null;
    propuesta: { titulo: string; descripcion: string | null; fuente: string | null; fuente_url: string | null };
    diferencias: Array<{ campo: string; actual: unknown; propuesta: unknown }>;
    imagen: { actual_url: string | null; propuesta: { bytes: number; sha256: string } | null; thumb_url_propuesta: string | null };
    puede_solo_imagen: boolean;
    puede_aceptar: boolean;
  };
  const compare = async (id: string, rol: 'MODERATOR' | 'ADMIN' | 'USER' = 'MODERATOR') => asStaff('GET', `/api/admin/submissions/${id}/compare`, rol);
  const resolve = async (id: string, body: unknown, rol: 'MODERATOR' | 'ADMIN' | 'USER' = 'MODERATOR') => asStaff('POST', `/api/admin/submissions/${id}/resolve`, rol, body);
  /** Ficha editorial publicada (sin imagen salvo `img`) y un aporte de otra fuente que choca (conflicto) con tarjeta opcional. */
  async function conflict(slug: string, opts: { card?: boolean; img?: string; manual?: string[] } = {}): Promise<string> {
    await ok([ficha(slug, { metadata: { descripcion: 'Texto editorial vigente' } })]);
    await promoteSlug(slug);
    await Submission.deleteMany({ 'payload.slug': slug });
    if (opts.img || opts.manual) await Entity.updateOne({ slug }, { $set: { ...(opts.img ? { imagen_url: opts.img } : {}), ...(opts.manual ? { manualEdits: opts.manual } : {}) } });
    const r = await ok(
      [ficha(slug, { categoria: 'Rifles', metadata: { descripcion: 'Texto del pipeline', fuente_imagen: 'www.ejemplo.test', fuente_url: 'https://www.ejemplo.test/x' }, ...(opts.card ? { tarjeta: tarjetaOf() } : {}) })],
      { source: 'otra-fuente' },
    );
    assert.equal(r.conflictos, 1, JSON.stringify(r.details));
    return (await subOf(slug))!._id;
  }
  const entityTextOf = async (slug: string) => {
    const e = (await Entity.findOne({ slug }).lean())!;
    const m = { ...(e.metadata_json as Record<string, unknown>) };
    delete m['fuente_imagen'];
    delete m['fuente_url'];
    return JSON.stringify({ t: e.titulo, s: e.subtitulo, c: e.categoria, m, st: e.stats_json, h: e.contentHash, me: e.manualEdits });
  };

  it('compare: conflicto con diferencias y sin base64; nueva sin ficha; actualizada', async () => {
    const id = await conflict('cf-cmp', { card: true });
    const res = await compare(id);
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(!res.body.includes(tarjetaOf().base64), 'sin base64');
    assert.ok(!res.body.includes('"base64"'));
    assert.match(String(res.headers['cache-control']), /no-store/);
    const c = res.json<Cmp>();
    assert.equal(c.reason, 'conflicto');
    assert.equal(c.estado, 'pending');
    assert.equal(c.entity?.slug, 'cf-cmp');
    assert.equal(c.actual?.descripcion, 'Texto editorial vigente');
    assert.equal(c.propuesta.descripcion, 'Texto del pipeline');
    assert.equal(c.propuesta.fuente, 'otra-fuente');
    assert.equal(c.propuesta.fuente_url, 'https://www.ejemplo.test/x');
    const campos = c.diferencias.map((d) => d.campo);
    assert.ok(campos.includes('categoria') && campos.includes('descripcion') && campos.includes('metadata.fuente'), campos.join(','));
    assert.deepEqual(c.diferencias.find((d) => d.campo === 'categoria'), { campo: 'categoria', actual: 'Pistolas', propuesta: 'Rifles' });
    assert.ok(!campos.includes('titulo'));
    assert.equal(c.imagen.actual_url, null);
    assert.equal(c.imagen.propuesta?.bytes, 64);
    assert.match(c.imagen.propuesta?.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(c.imagen.thumb_url_propuesta, `/api/admin/submissions/${id}/tarjeta.webp`);
    assert.equal(c.puede_solo_imagen, true);
    assert.equal(c.puede_aceptar, true);

    // nueva: sin ficha actual
    await ok([ficha('cf-nueva')]);
    const n = (await compare((await subOf('cf-nueva'))!._id)).json<Cmp>();
    assert.equal(n.reason, 'nueva');
    assert.equal(n.entity, null);
    assert.equal(n.actual, null);
    assert.deepEqual(n.diferencias, []);
    assert.equal(n.puede_solo_imagen, false);
    assert.equal(n.imagen.propuesta, null);
    assert.equal(n.imagen.thumb_url_propuesta, null);

    // actualizada
    await ok([ficha('cf-upd')]);
    await promoteSlug('cf-upd');
    await ok([ficha('cf-upd', { categoria: 'Rifles' })]);
    const u = (await compare((await subOf('cf-upd'))!._id)).json<Cmp>();
    assert.equal(u.reason, 'actualizada');
    assert.deepEqual(u.diferencias.map((d) => d.campo), ['categoria']);
  });

  it('compare: puede_solo_imagen false con imagen previa o imagen_url protegida; 404 inexistente; 422 si no es del pipeline', async () => {
    const withImg = await conflict('cf-img', { card: true, img: '/assets/propia.jpg' });
    const a = (await compare(withImg)).json<Cmp>();
    assert.equal(a.puede_solo_imagen, false);
    assert.equal(a.imagen.actual_url, '/assets/propia.jpg');
    const prot = await conflict('cf-prot', { card: true, manual: ['imagen_url'] });
    assert.equal((await compare(prot)).json<Cmp>().puede_solo_imagen, false);
    assert.equal((await compare(randomUUID())).statusCode, 404);
    const user = await Submission.create({ userId: randomUUID(), moduleSlug: MODULE, type: 'entity', title: 'Aporte usuario', payload: {}, status: 'pending' });
    assert.equal((await compare(user._id)).statusCode, 422);
  });

  it('mantener: rechaza con el motivo y no toca la ficha; doble resolucion -> 409', async () => {
    const id = await conflict('cf-keep', { card: true });
    const before = JSON.stringify(await Entity.findOne({ slug: 'cf-keep' }).lean());
    const assets = await MediaAsset.countDocuments();
    const res = await resolve(id, { accion: 'mantener', nota: 'decision del propietario' });
    assert.equal(res.statusCode, 200, res.body);
    const out = res.json<{ ok: boolean; accion: string; submission: { status: string; reviewNote: string } }>();
    assert.equal(out.submission.status, 'rejected');
    assert.match(out.submission.reviewNote, /^Se mantiene la ficha editorial\. decision del propietario/);
    assert.equal(JSON.stringify(await Entity.findOne({ slug: 'cf-keep' }).lean()), before);
    assert.equal(await MediaAsset.countDocuments(), assets);
    assert.equal((await resolve(id, { accion: 'mantener' })).statusCode, 409);
    assert.equal((await resolve(id, { accion: 'solo_imagen' })).statusCode, 409);
    assert.equal((await compare(id)).json<Cmp>().puede_aceptar, false);
  });

  it('aceptar: sin manualEdits aplica la version del pipeline; con manualEdits -> 422 y nada cambia', async () => {
    const ok1 = await conflict('cf-acc');
    const res = await resolve(ok1, { accion: 'aceptar' });
    assert.equal(res.statusCode, 200, res.body);
    const e = await Entity.findOne({ slug: 'cf-acc' }).lean();
    assert.equal(e?.categoria, 'Rifles');
    assert.equal((e?.metadata_json as Record<string, unknown>)['descripcion'], 'Texto del pipeline');
    assert.equal((await Submission.findById(ok1).lean())?.status, 'approved');
    assert.equal((await resolve(ok1, { accion: 'aceptar' })).statusCode, 409);

    const locked = await conflict('cf-lock', { manual: ['titulo'] });
    const before = await entityTextOf('cf-lock');
    const bad = await resolve(locked, { accion: 'aceptar' });
    assert.equal(bad.statusCode, 422, bad.body);
    assert.match(bad.body, /titulo/);
    assert.equal(await entityTextOf('cf-lock'), before);
    assert.equal((await Submission.findById(locked).lean())?.status, 'pending');
  });

  it('solo_imagen: sin imagen previa fija solo imagen_url, capturaPropiaPendiente y fuente_imagen/fuente_url', async () => {
    const id = await conflict('cf-solo', { card: true });
    const text = await entityTextOf('cf-solo');
    const before = (await Entity.findOne({ slug: 'cf-solo' }).lean())!;
    const res = await resolve(id, { accion: 'solo_imagen' });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(!res.body.includes(tarjetaOf().base64));
    const after = (await Entity.findOne({ slug: 'cf-solo' }).lean())!;
    assert.match(after.imagen_url ?? '', /^\/media\/[0-9a-f-]{36}$/);
    assert.equal(after.capturaPropiaPendiente, true);
    const m = after.metadata_json as Record<string, unknown>;
    assert.equal(m['fuente_imagen'], 'www.ejemplo.test');
    assert.equal(m['fuente_url'], 'https://www.ejemplo.test/x');
    assert.equal(await entityTextOf('cf-solo'), text, 'texto, stats, confianza, fuente y hash intactos');
    assert.equal(after.contentHash, before.contentHash);
    assert.equal(m['descripcion'], 'Texto editorial vigente');
    assert.ok(!(after.manualEdits ?? []).includes('imagen_url'));
    const asset = await MediaAsset.findById(after.imagen_url!.replace('/media/', '')).lean();
    assert.equal(asset?.mime, 'image/webp');
    assert.equal(asset?.width, 1600);
    assert.notEqual(asset?.created_by, 'system');
    const sub = await Submission.findById(id).lean();
    assert.equal(sub?.status, 'approved');
    assert.match(sub?.reviewNote ?? '', /^Solo imagen/);
    assert.equal((sub?.payload as { pipeline_resolution?: string }).pipeline_resolution, 'solo_imagen');
    assert.deepEqual(sub?.promotedTo, { collection: 'Entity', id: after._id });
    assert.equal((await resolve(id, { accion: 'solo_imagen' })).statusCode, 409);
  });

  it('solo_imagen: con imagen previa, protegida, sin tarjeta o sin ficha -> 422 y nada cambia', async () => {
    const withImg = await conflict('cf-s-img', { card: true, img: '/assets/propia.jpg' });
    const noCard = await conflict('cf-s-nocard');
    const prot = await conflict('cf-s-prot', { card: true, manual: ['imagen_url'] });
    await ok([ficha('cf-s-nueva', { tarjeta: tarjetaOf() })]);
    const nueva = (await subOf('cf-s-nueva'))!._id;
    const assets = await MediaAsset.countDocuments();
    for (const id of [withImg, noCard, prot, nueva]) {
      const r = await resolve(id, { accion: 'solo_imagen' });
      assert.equal(r.statusCode, 422, r.body);
      assert.equal((await Submission.findById(id).lean())?.status, 'pending');
    }
    assert.equal(await MediaAsset.countDocuments(), assets);
    assert.equal((await Entity.findOne({ slug: 'cf-s-img' }).lean())?.imagen_url, '/assets/propia.jpg');
    assert.equal((await Entity.findOne({ slug: 'cf-s-nocard' }).lean())?.imagen_url ?? null, null);
  });

  it('valida el cuerpo y RBAC: sin sesion y USER -> 404 uniforme (antes que Zod)', async () => {
    const id = await conflict('cf-rbac', { card: true });
    assert.equal((await resolve(id, { accion: 'borrar' })).statusCode, 400);
    assert.equal((await resolve(id, { accion: 'mantener', nota: 'x'.repeat(301) })).statusCode, 400);
    const ref = await app.inject({ method: 'GET', url: '/api/admin/no-existe-xyz', remoteAddress: nextIp() });
    assert.equal((await compare(id, 'USER')).statusCode, 404);
    assert.equal((await resolve(id, { accion: 'borrar' }, 'USER')).statusCode, 404, 'RBAC antes que Zod');
    const anonGet = await app.inject({ method: 'GET', url: `/api/admin/submissions/${id}/compare`, remoteAddress: nextIp() });
    const anonPost = await app.inject({ method: 'POST', url: `/api/admin/submissions/${id}/resolve`, remoteAddress: nextIp(), headers: { 'content-type': 'application/json' }, payload: '{"accion":"mantener"}' });
    assert.equal(anonGet.statusCode, 404);
    assert.equal(anonGet.body, ref.body);
    assert.equal(anonPost.statusCode, 404);
    assert.equal((await Submission.findById(id).lean())?.status, 'pending');
  });

  it('audita submission.resolve con accion y entity_id (sin base64)', async () => {
    const a = await conflict('cf-aud-a', { card: true });
    const b = await conflict('cf-aud-b');
    await resolve(a, { accion: 'solo_imagen' });
    await resolve(b, { accion: 'mantener' });
    const ea = (await Entity.findOne({ slug: 'cf-aud-a' }).lean())!;
    const eb = (await Entity.findOne({ slug: 'cf-aud-b' }).lean())!;
    const la = await AuditLog.findOne({ action: 'submission.resolve', target_id: a }).lean();
    const lb = await AuditLog.findOne({ action: 'submission.resolve', target_id: b }).lean();
    assert.equal((la?.metadata as Record<string, unknown>)['accion'], 'solo_imagen');
    assert.equal((la?.metadata as Record<string, unknown>)['entity_id'], ea._id);
    assert.equal((lb?.metadata as Record<string, unknown>)['accion'], 'mantener');
    assert.equal((lb?.metadata as Record<string, unknown>)['entity_id'], eb._id);
    assert.ok(!JSON.stringify([la, lb]).includes(tarjetaOf().base64));
  });
});

// ---------------------------------------------------------------------------------------------
// S6.4 / S5.5: validacion SEO tecnica (matriz ruta -> resultado) y parseo de la fuente de noticias.
// ---------------------------------------------------------------------------------------------
const { LEGAL_PAGES, LEGAL_LASTMOD } = await import('../services/ssrLite.js');
const { parseFeed, officialNewsSchema } = await import('../workers/officialNewsWorker.js');
const { NEWS_SOURCES: NEWS_SOURCE_LIST, isAllowedUrl, isRelevant } = await import('../workers/sources.js');
const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join, resolve: resolvePath } = await import('node:path');

describe('(S6.4) validacion SEO: JSON-LD, canonical, 301/404, sitemap y robots', () => {
  const realIndex = process.env['CLIENT_DIST_INDEX'];
  let dir: string;
  let armasId: string;
  let guiasId: string;
  let radioId: string;
  const get = (url: string) => app.inject({ method: 'GET', url, remoteAddress: nextIp() });
  const ldBlocks = (html: string): Array<Record<string, unknown>> =>
    [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
  const typesOf = (html: string): string[] => ldBlocks(html).map((b) => String(b['@type']));
  const tag = (html: string, re: RegExp): string | undefined => re.exec(html)?.[1];
  const canonicals = (html: string): string[] => [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]!);
  const robotsOf = (html: string) => tag(html, /<meta name="robots" content="([^"]*)"/);
  const descOf = (html: string) => tag(html, /<meta name="description" content="([^"]*)"/);
  const titleOf = (html: string) => tag(html, /<title>([^<]*)<\/title>/);
  const html200: Array<{ path: string; html: string }> = [];
  const page = async (path: string) => {
    const r = await get(path);
    assert.equal(r.statusCode, 200, `${path}: ${r.statusCode}`);
    html200.push({ path, html: r.body });
    return r.body;
  };
  const sitemapLocs = async (): Promise<string[]> => {
    const r = await get('/sitemap.xml');
    assert.equal(r.statusCode, 200);
    return [...r.body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!);
  };
  const GUIDE_STEPS = [1, 2, 3, 4].map((n) => ({ id: `paso-${n}`, title: `Paso ${n} de la guia`, body: `Texto original del paso ${n} para la guia de prueba.` }));

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'leonidapp-seo-'));
    const idx = join(dir, 'index.html');
    writeFileSync(idx, '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>x</title></head><body><div id="root"></div></body></html>');
    process.env['CLIENT_DIST_INDEX'] = idx;
    await Promise.all([Module.deleteMany({}), Entity.deleteMany({}), OfficialNews.deleteMany({})]);
    armasId = randomUUID();
    guiasId = randomUUID();
    radioId = randomUUID();
    await Module.create([
      { _id: armasId, slug: 'armas', nombre: 'Armas', icono: 'gun', activo: true, orden: 1 },
      { _id: guiasId, slug: 'guias', nombre: 'Guias', icono: 'book', activo: true, orden: 2 },
      { _id: randomUUID(), slug: 'vehiculos', nombre: 'Vehiculos', icono: 'car', activo: true, orden: 3 }, // activo pero sin fichas
      { _id: radioId, slug: 'radio', nombre: 'Radio', icono: 'radio', activo: false, orden: 4 },
    ]);
    await OfficialNews.create({
      title: 'Rockstar Games anuncia novedades de prueba',
      summary: 'Resumen oficial de prueba.',
      sourceUrl: 'https://ir.take2games.com/news-releases/prueba-seo',
      source: 'take-two-ir',
      publishedAt: new Date('2026-11-03T10:00:00Z'),
      slug: 'rockstar-games-anuncia-novedades-de-prueba-abcd1234',
    });
    clearSsrCache();
  });

  // El beforeEach raiz vacia Entity en cada prueba: las fichas de esta suite se vuelven a sembrar.
  beforeEach(async () => {
    await Entity.create([
      { _id: randomUUID(), module_id: armasId, slug: 'pistola-uno', titulo: 'Pistola Uno', categoria: 'Pistolas', metadata_json: { descripcion: 'Descripcion editorial original de la pistola uno.' } },
      { _id: randomUUID(), module_id: armasId, slug: 'pistola-dos', titulo: 'Pistola Dos', categoria: 'Pistolas', metadata_json: { descripcion: 'Descripcion editorial original de la pistola dos.' } },
      { _id: randomUUID(), module_id: armasId, slug: 'fusil-tres', titulo: 'Fusil Tres', categoria: 'Fusiles', subtitulo: 'Subtitulo propio del fusil tres' },
      { _id: randomUUID(), module_id: guiasId, slug: 'guia-pasos', titulo: 'Guia con pasos', categoria: 'Misiones', metadata_json: { descripcion: 'Guia original con pasos.', steps: GUIDE_STEPS } },
      { _id: randomUUID(), module_id: radioId, slug: 'emisora-oculta', titulo: 'Emisora oculta', categoria: 'Radio' },
    ]);
    clearSsrCache();
  });

  after(() => {
    if (realIndex === undefined) delete process.env['CLIENT_DIST_INDEX'];
    else process.env['CLIENT_DIST_INDEX'] = realIndex;
    rmSync(dir, { recursive: true, force: true });
  });

  it('landing: WebSite con SearchAction y Organization, y canonical absoluto', async () => {
    const h = await page('/');
    const lds = ldBlocks(h);
    const site = lds.find((b) => b['@type'] === 'WebSite');
    assert.ok(site, 'WebSite');
    assert.equal((site['potentialAction'] as Record<string, unknown>)['@type'], 'SearchAction');
    assert.ok(lds.some((b) => b['@type'] === 'Organization'), 'Organization');
    assert.deepEqual(canonicals(h), [baseUrl() + '/']);
  });

  it('preload de la imagen LCP del hero solo en /, igual al srcset/sizes del <img>', async () => {
    const preloads = (html: string) => [...html.matchAll(/<link rel="preload"[^>]*>/g)].map((m) => m[0]);
    const h = await page('/');
    const p = preloads(h);
    assert.equal(p.length, 1);
    assert.ok(p[0]!.includes('as="image"') && p[0]!.includes('fetchpriority="high"') && p[0]!.includes('type="image/webp"'));
    assert.ok(p[0]!.includes('href="/assets/hero-gas-station-800.webp"'));
    assert.ok(p[0]!.includes('imagesrcset="/assets/hero-gas-station-800.webp 800w, /assets/hero-gas-station.jpg 1080w"'));
    assert.ok(p[0]!.includes('imagesizes="(min-width: 768px) 55vw, 100vw"'));
    assert.ok(h.indexOf('rel="preload"') < h.indexOf('</head>'));
    for (const path of ['/mapa', '/noticias', '/guias/guia-pasos', '/catalogo/armas/pistola-uno']) {
      assert.equal(preloads((await get(path)).body).length, 0, path);
    }
  });

  it('ficha: CreativeWork + BreadcrumbList; guia: HowTo con >= 3 HowToStep + BreadcrumbList', async () => {
    const f = await page('/catalogo/armas/pistola-uno');
    assert.deepEqual(typesOf(f), ['CreativeWork', 'BreadcrumbList']);
    const g = await page('/guias/guia-pasos');
    assert.deepEqual(typesOf(g), ['HowTo', 'BreadcrumbList']);
    const steps = ldBlocks(g)[0]!['step'] as Array<Record<string, unknown>>;
    assert.ok(steps.length >= 3);
    assert.ok(steps.every((s) => s['@type'] === 'HowToStep' && typeof s['name'] === 'string' && typeof s['text'] === 'string'));
  });

  it('noticias: /noticias CollectionPage y /noticias/:slug NewsArticle', async () => {
    assert.deepEqual(typesOf(await page('/noticias')), ['CollectionPage', 'BreadcrumbList']);
    const n = await page('/noticias/rockstar-games-anuncia-novedades-de-prueba-abcd1234');
    assert.deepEqual(typesOf(n), ['NewsArticle', 'BreadcrumbList']);
  });

  it('categoria con fichas: CollectionPage; categoria activa vacia: 200 noindex sin canonical ni JSON-LD', async () => {
    assert.deepEqual(typesOf(await page('/catalogo/armas')), ['CollectionPage', 'BreadcrumbList']);
    const v = await get('/catalogo/vehiculos');
    assert.equal(v.statusCode, 200);
    assert.equal(robotsOf(v.body), 'noindex,follow');
    assert.equal(canonicals(v.body).length, 0);
    assert.equal(typesOf(v.body).length, 0);
  });

  it('legales: 5 rutas con WebPage + BreadcrumbList, meta propia, canonical, og/twitter, h1 SSR y sin 404', async () => {
    for (const [path, lp] of Object.entries(LEGAL_PAGES)) {
      const h = await page(path);
      assert.deepEqual(typesOf(h), ['WebPage', 'BreadcrumbList'], path);
      assert.equal(robotsOf(h), 'index,follow', path);
      assert.deepEqual(canonicals(h), [baseUrl() + path], path);
      assert.ok(titleOf(h)!.startsWith(lp.title), String(titleOf(h)));
      assert.equal(descOf(h), lp.description);
      assert.ok(/<meta property="og:image" content="https?:\/\//.test(h), 'og:image');
      assert.ok(h.includes('name="twitter:card"') && h.includes('name="twitter:image"'));
      assert.ok(h.includes(`<noscript><main><h1>${lp.title}</h1><p>`), 'h1 SSR en noscript');
    }
    assert.equal((await get('/legal/xyz')).statusCode, 404);
    assert.equal((await get('/legal')).statusCode, 404);
    assert.equal((await get('/LEGAL/PRIVACIDAD')).statusCode, 301);
  });

  it('legales: titulo y descripcion coinciden con src/data/legalDocs.ts (el texto visible)', () => {
    const file = resolvePath(process.cwd(), '..', 'src', 'data', 'legalDocs.ts');
    if (!existsSync(file)) return; // ejecucion fuera del repo completo
    const src = readFileSync(file, 'utf8').replace(/\s+/g, ' ');
    for (const [path, lp] of Object.entries(LEGAL_PAGES)) {
      assert.ok(src.includes(`path: '${path}'`), path);
      assert.ok(src.includes(`title: '${lp.title}'`), `titulo ${path}`);
      assert.ok(src.includes(`description: '${lp.description}'`), `descripcion ${path}`);
    }
    assert.ok(src.includes(`LEGAL_UPDATED = '${LEGAL_LASTMOD}'`), 'fecha de revision');
  });

  it('canonical unico y absoluto en toda pagina indexable; titulos y descripciones unicos por ficha', async () => {
    for (const p of ['/mapa', '/guias', '/foro', '/catalogo/armas/pistola-dos', '/catalogo/armas/fusil-tres']) await page(p);
    const seen = new Set<string>();
    for (const { path, html } of html200) {
      if (robotsOf(html)?.startsWith('noindex')) continue;
      const c = canonicals(html);
      assert.equal(c.length, 1, `${path}: ${c.length} canonical`);
      assert.ok(/^https?:\/\//.test(c[0]!), String(c[0]));
      assert.ok(!c[0]!.includes('#') && !c[0]!.includes('?'), String(c[0]));
      assert.ok(!seen.has(c[0]!) || html200.filter((h) => h.path === path).length > 1, `canonical repetido: ${c[0]}`);
      seen.add(c[0]!);
    }
    const fichas = html200.filter((h) => h.path.startsWith('/catalogo/armas/'));
    assert.equal(fichas.length, 3);
    assert.equal(new Set(fichas.map((f) => titleOf(f.html))).size, fichas.length, 'titulos unicos');
    assert.equal(new Set(fichas.map((f) => descOf(f.html))).size, fichas.length, 'descripciones unicas');
  });

  it('/catalogo redirige 301 a la primera categoria visible; /catalogo/mapa a /mapa', async () => {
    const r = await get('/catalogo');
    assert.equal(r.statusCode, 301);
    assert.equal(r.headers['location'], '/catalogo/armas');
    assert.equal((await get('/catalogo/mapa')).headers['location'], '/mapa');
  });

  it('404 real con noindex y sin canonical ni JSON-LD: inexistentes y categorias ocultas', async () => {
    for (const p of ['/ruta-que-no-existe', '/legal/xyz', '/catalogo/radio', '/catalogo/radio/emisora-oculta', '/catalogo/armas/no-existe', '/noticias/no-existe', '/guias/no-existe', '/catalogo/no-existe']) {
      const r = await get(p);
      assert.equal(r.statusCode, 404, p);
      assert.equal(robotsOf(r.body), 'noindex,nofollow', p);
      assert.equal(canonicals(r.body).length, 0, p);
      assert.equal(typesOf(r.body).length, 0, p);
    }
  });

  it('/_staff y /api/admin/*: 404 uniforme para anonimo (igual que una ruta inexistente)', async () => {
    const miss = await get('/ruta-que-no-existe');
    for (const p of ['/_staff', '/_staff/', '/_staff/anything', '/%5Fstaff', '/_STAFF']) {
      const r = await get(p);
      assert.equal(r.statusCode, 404, p);
      assert.equal(r.body, miss.body, p);
    }
    const apiMiss = await get('/api/admin/no-existe-xyz');
    assert.equal(apiMiss.statusCode, 404);
    for (const p of ['/api/admin/overview', '/api/admin/pipeline/runs', '/api/admin/submissions']) {
      const r = await get(p);
      assert.equal(r.statusCode, 404, p);
      assert.equal(r.body, apiMiss.body, p);
    }
  });

  it('ningun HTML SSR incluye texto de depuracion', async () => {
    const all = [...html200.map((h) => h.html), (await get('/ruta-que-no-existe')).body, (await get('/catalogo/vehiculos')).body];
    for (const h of all) {
      assert.ok(!/undefined|\[object Object\]|\bNaN\b|\bnull\b|Traceback|Error:|stack|console\.|TODO|FIXME|lorem ipsum/i.test(h), 'texto de depuracion en el HTML');
    }
  });

  it('robots.txt: Allow /, Disallow /api/, Sitemap absoluto y sin /_staff', async () => {
    const r = await get('/robots.txt');
    assert.equal(r.statusCode, 200);
    assert.ok(r.body.includes('User-agent: *\nAllow: /\nDisallow: /api/'));
    assert.ok(r.body.includes(`Sitemap: ${baseUrl()}/sitemap.xml`));
    assert.ok(!/staff/i.test(r.body));
  });

  it('sitemap.xml: sin hash/staff/duplicados, sin modulos inactivos ni categorias vacias, legales con prioridad 0.3, lastmod valido', async () => {
    const r = await get('/sitemap.xml');
    assert.match(String(r.headers['content-type']), /xml/);
    const locs = await sitemapLocs();
    assert.equal(new Set(locs).size, locs.length, 'duplicados');
    assert.ok(locs.length <= 50_000);
    assert.ok(locs.every((l) => l.startsWith(baseUrl()) && !l.includes('#') && !l.includes('?') && !/staff|\/api\//i.test(l)));
    const must = ['/', '/mapa', '/guias', '/noticias', '/foro', '/catalogo/armas', '/catalogo/armas/pistola-uno', '/guias/guia-pasos', '/noticias/rockstar-games-anuncia-novedades-de-prueba-abcd1234', ...Object.keys(LEGAL_PAGES)];
    for (const m of must) assert.ok(locs.includes(baseUrl() + m), `falta ${m}`);
    for (const m of ['/catalogo/radio', '/catalogo/radio/emisora-oculta', '/catalogo/vehiculos', '/catalogo']) assert.ok(!locs.includes(baseUrl() + m), `sobra ${m}`);
    const legalBlocks = [...r.body.matchAll(/<url><loc>[^<]*\/legal\/[^<]*<\/loc>([^]*?)<\/url>/g)];
    assert.equal(legalBlocks.length, 5);
    for (const b of legalBlocks) assert.ok(b[1]!.includes('<priority>0.3</priority>') && b[1]!.includes(`<lastmod>${LEGAL_LASTMOD}`), String(b[1]));
    for (const m of r.body.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) assert.ok(!Number.isNaN(Date.parse(m[1]!)), String(m[1]));
    assert.equal([...r.body.matchAll(/<priority>/g)].length, 5, 'solo las legales declaran priority');
  });

  it('sitemap y SSR se actualizan al instante: promote anade la URL; DELETE de la ficha la retira', async () => {
    const slug = 'sitemap-nueva';
    await ok([ficha(slug, { titulo: 'Ficha de sitemap' })]);
    const antes = await sitemapLocs();
    assert.ok(!antes.includes(`${baseUrl()}/catalogo/armas/${slug}`), 'pendiente: aun no esta');
    await promoteSlug(slug);
    const t0 = Date.now();
    const trasPromote = await sitemapLocs();
    assert.ok(trasPromote.includes(`${baseUrl()}/catalogo/armas/${slug}`), 'promote -> sitemap');
    assert.equal(trasPromote.length, antes.length + 1);
    assert.equal((await get(`/catalogo/armas/${slug}`)).statusCode, 200);
    const e = (await Entity.findOne({ slug }).lean())!;
    const del = await app.inject({ method: 'DELETE', url: `/api/entities/${e._id}`, remoteAddress: nextIp(), headers: { cookie: await staffCookie('ADMIN') } });
    assert.equal(del.statusCode, 204, del.body);
    const trasDelete = await sitemapLocs();
    assert.ok(!trasDelete.includes(`${baseUrl()}/catalogo/armas/${slug}`), 'DELETE -> sitemap');
    assert.equal(trasDelete.length, antes.length);
    assert.equal((await get(`/catalogo/armas/${slug}`)).statusCode, 404, 'DELETE invalida la cache SSR');
    assert.ok(Date.now() - t0 < 2000, 'actualizacion inmediata (sin cache de sitemap en servidor)');
  });

  it('GET /api/news valida con Zod: limite fuera de rango 400, fuente desconocida 400, lista publica', async () => {
    assert.equal((await get('/api/news?limit=0')).statusCode, 400);
    assert.equal((await get('/api/news?limit=51')).statusCode, 400);
    assert.equal((await get('/api/news?source=medio-tercero')).statusCode, 400);
    const ok200 = await get('/api/news?limit=5');
    assert.equal(ok200.statusCode, 200);
    const rows = ok200.json<Array<{ slug: string; sourceUrl: string; source: string }>>();
    assert.ok(rows.length >= 1 && rows.every((n) => isAllowedUrl(n.sourceUrl)));
  });
});

describe('(S5.5) noticias oficiales: parseo con respuesta real de ir.take2games.com y lista blanca', () => {
  // Respuesta real de https://ir.take2games.com/rss/news-releases.xml (2026-11-23), recortada a 4 items.
  const FIXTURE: string = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<rss xmlns:dc=\"http://purl.org/dc/elements/1.1/\" version=\"2.0\" xml:base=\"https://ir.take2games.com/\">\n  <channel>\n    <title>Take-Two Interactive Software, Inc. News Releases</title>\n    <link>https://ir.take2games.com/</link>\n    <description>Take-Two Interactive Software, Inc. News Releases</description>\n    <language>en</language>\n<item>\n  <title>Take-Two Interactive Software, Inc. to Report Second Quarter Fiscal Year 2027 Results on Monday, November 9, 2026</title>\n  <link>https://ir.take2games.com/news-releases/news-release-details/take-two-interactive-software-inc-report-second-quarter-fiscal-8</link>\n  <description>NEW YORK --(BUSINESS WIRE)--Oct. 13, 2026-- Take-Two Interactive Software, Inc. (NASDAQ: TTWO) today announced that it plans to report financial results for its second quarter of fiscal year 2027, ended September 30, 2026, after the market close on Monday, November 9, 2026.</description>\n  <pubDate>Tue, 13 Oct 2026 08:00:00 -0400</pubDate>\n    <dc:creator>Take-Two Interactive Software, Inc. News Releases</dc:creator>\n    <guid isPermaLink=\"false\">32631</guid>\n    </item>\n<item>\n  <title>Ball Over Everything in NBA® 2K27 Now Available Worldwide</title>\n  <link>https://ir.take2games.com/news-releases/news-release-details/ball-over-everything-nbar-2k27-now-available-worldwide</link>\n  <description>Experience balanced two-way gameplay, run the first Co-Ed City featuring new environments, rewrite history in the all-new MyCAREER Eras mode, and more E xecutive Summary: Now Available Worldwide: NBA 2K27 is now available on PS5, XBOX Series X|S, PC via Steam, and Nintendo Switch™ 2 in three</description>\n  <pubDate>Fri, 04 Sep 2026 10:00:00 -0400</pubDate>\n    <dc:creator>Take-Two Interactive Software, Inc. News Releases</dc:creator>\n    <guid isPermaLink=\"false\">32491</guid>\n    </item>\n<item>\n  <title>Rockstar Games Announces Pre-Orders for Grand Theft Auto VI</title>\n  <link>https://ir.take2games.com/news-releases/news-release-details/rockstar-games-announces-pre-orders-grand-theft-auto-vi</link>\n  <description>Starting at Midnight Local Time on June 25, 2026 NEW YORK --(BUSINESS WIRE)--Jun. 24, 2026-- Rockstar Games ®, a publishing label of Take-Two Interactive Software, Inc. (NASDAQ: TTWO), is excited to announce that pre-orders for Grand Theft Auto VI will begin on June 25, 2026, at midnight local</description>\n  <pubDate>Wed, 24 Jun 2026 06:15:00 -0400</pubDate>\n    <dc:creator>Take-Two Interactive Software, Inc. News Releases</dc:creator>\n    <guid isPermaLink=\"false\">32311</guid>\n    </item>\n<item>\n  <title>Take-Two Interactive Software, Inc. Reports Results for Fourth Quarter and Fiscal Year 2026</title>\n  <link>https://ir.take2games.com/news-releases/news-release-details/take-two-interactive-software-inc-reports-results-fourth-2</link>\n  <description>$1.58 billion fiscal fourth quarter Net Bookings, above Company's guidance range $6.72 billion fiscal year 2026 Net Bookings Initial outlook for fiscal 2027 includes Net Bookings of $8.0 to $8.2 billion NEW YORK --(BUSINESS WIRE)--May 21, 2026-- Take-Two Interactive Software, Inc.</description>\n  <pubDate>Thu, 21 May 2026 16:05:00 -0400</pubDate>\n    <dc:creator>Take-Two Interactive Software, Inc. News Releases</dc:creator>\n    <guid isPermaLink=\"false\">32161</guid>\n    </item>\n</channel></rss>";
  const src = NEWS_SOURCE_LIST[0]!;

  it('parsea 4 items, valida con Zod y el filtro de relevancia deja solo la nota de Rockstar/GTA', () => {
    const raw = parseFeed(FIXTURE, src);
    assert.equal(raw.length, 4);
    const items = raw.map((r) => officialNewsSchema.safeParse(r)).flatMap((p) => (p.success ? [p.data] : []));
    assert.equal(items.length, 4);
    const rel = items.filter((i) => isRelevant(src, i.title, i.summary));
    assert.equal(rel.length, 1);
    assert.match(rel[0]!.title, /Grand Theft Auto VI/);
    assert.equal(rel[0]!.source, 'take-two-ir');
    assert.ok(rel[0]!.sourceUrl.startsWith('https://ir.take2games.com/news-releases/'));
    assert.ok(rel[0]!.summary.length <= 283, 'extracto breve, no el articulo completo');
    assert.ok(rel[0]!.publishedAt instanceof Date && !Number.isNaN(rel[0]!.publishedAt.getTime()));
  });

  it('lista blanca: rechaza hosts de terceros, http y suplantaciones de dominio', () => {
    assert.equal(isAllowedUrl('https://ir.take2games.com/x'), true);
    assert.equal(isAllowedUrl('https://www.rockstargames.com/newswire'), true);
    for (const bad of ['https://www.ign.com/x', 'http://ir.take2games.com/x', 'https://ir.take2games.com.evil.com/x', 'https://evil.com/?u=ir.take2games.com', 'javascript:alert(1)']) {
      assert.equal(isAllowedUrl(bad), false, bad);
    }
    assert.equal(officialNewsSchema.safeParse({ title: 'Tres', summary: 'x', sourceUrl: 'https://www.ign.com/a', source: 'take-two-ir', publishedAt: new Date() }).success, false);
  });
});
