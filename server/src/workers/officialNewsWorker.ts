import cron from 'node-cron';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { OfficialNews } from '../models/OfficialNews.js';
import { clearSsrCache } from '../services/ssrLite.js';
import { NEWS_SOURCES, isAllowedUrl, isRelevant, type NewsSourceConfig } from './sources.js';

const USER_AGENT = 'LeonidAppNewsBot/1.0';
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const MAX_ITEMS_PER_SOURCE = 30;

export const officialNewsSchema = z.object({
  title: z.string().trim().min(3).max(300),
  summary: z.string().trim().min(1, 'resumen oficial obligatorio').max(500),
  sourceUrl: z
    .string()
    .url()
    .refine(isAllowedUrl, 'host fuera de la lista blanca')
    .transform((u) => {
      const c = new URL(u);
      c.hash = '';
      c.search = '';
      return c.toString();
    }),
  source: z.enum(['rockstar-newswire', 'rockstar-youtube', 'take-two-ir']),
  imageUrl: z.string().url().optional(),
  publishedAt: z.date(),
});
export type OfficialNewsInput = z.infer<typeof officialNewsSchema>;

type Logger = { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
let log: Logger = console;
let running = false;
const robotsCache = new Map<string, { rules: string[]; at: number }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  if (!isAllowedUrl(url)) throw new Error(`URL no permitida: ${url}`);
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xml,application/rss+xml,application/atom+xml',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!isAllowedUrl(res.url || url)) throw new Error('redireccion fuera de lista blanca');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Comprobacion minima de robots.txt (User-agent: * y Disallow por prefijo). */
async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url);
  const cached = robotsCache.get(u.hostname);
  let rules: string[];
  if (cached && Date.now() - cached.at < 6 * 3600_000) {
    rules = cached.rules;
  } else {
    rules = [];
    try {
      const res = await fetch(`${u.protocol}//${u.hostname}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        let applies = false;
        for (const raw of (await res.text()).split(/\r?\n/)) {
          const line = (raw.split('#')[0] ?? '').trim();
          const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
          if (!m) continue;
          const key = (m[1] ?? '').toLowerCase();
          const val = m[2] ?? '';
          if (key === 'user-agent') applies = val === '*' || /leonidappnewsbot/i.test(val);
          else if (key === 'disallow' && applies && val) rules.push(val);
        }
      }
    } catch (err) {
      log.warn({ err, host: u.hostname }, 'robots.txt no disponible; se asume permitido');
    }
    robotsCache.set(u.hostname, { rules, at: Date.now() });
  }
  const path = u.pathname + u.search;
  return !rules.some((r) => r === '/' || path.startsWith(r.replace(/\*$/, '')));
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object') return txt((v as Record<string, unknown>)['#text']);
  return String(v);
};
const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const excerpt = (s: string) => {
  const c = stripHtml(s);
  return c.length > 280 ? `${c.slice(0, 277)}...` : c;
};
const toDate = (v: unknown): Date | null => {
  const d = new Date(txt(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

function parseFeed(body: string, source: NewsSourceConfig): unknown[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = xml.parse(body) as Record<string, any>;
  const out: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of arr<any>(doc.feed?.entry)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const link = arr<any>(e.link).find((l) => l['@_rel'] === 'alternate' || !l['@_rel']);
    out.push({
      title: txt(e.title),
      summary: excerpt(txt(e['media:group']?.['media:description'] ?? e.summary ?? e.content)),
      sourceUrl: link?.['@_href'],
      imageUrl: e['media:group']?.['media:thumbnail']?.['@_url'],
      publishedAt: toDate(e.published ?? e.updated),
      source: source.id,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const i of arr<any>(doc.rss?.channel?.item)) {
    out.push({
      title: txt(i.title),
      summary: excerpt(txt(i.description)),
      sourceUrl: txt(i.link),
      imageUrl: i.enclosure?.['@_url'],
      publishedAt: toDate(i.pubDate),
      source: source.id,
    });
  }
  return out;
}

const makeSlug = (title: string, url: string): string => {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'noticia'}-${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
};

async function ingestSource(source: NewsSourceConfig): Promise<number> {
  if (!(await robotsAllows(source.url))) {
    log.warn({ source: source.id }, 'robots.txt prohibe la ruta; fuente omitida');
    return 0;
  }
  const body = await fetchText(source.url);
  const raw = parseFeed(body, source);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = [];
  for (const r of raw.slice(0, MAX_ITEMS_PER_SOURCE)) {
    const parsed = officialNewsSchema.safeParse(r);
    if (!parsed.success) continue;
    const it = parsed.data;
    if (!isRelevant(source, it.title, it.summary)) {
      log.debug({ source: source.id, title: it.title }, 'item descartado por relevancia');
      continue;
    }
    ops.push({
      updateOne: {
        filter: { sourceUrl: it.sourceUrl },
        update: { $setOnInsert: { ...it, slug: makeSlug(it.title, it.sourceUrl) } },
        upsert: true,
      },
    });
  }
  if (!ops.length) return 0;
  const res = await OfficialNews.bulkWrite(ops, { ordered: false });
  if (res.upsertedCount) clearSsrCache();
  return res.upsertedCount ?? 0;
}

export interface NewsRunResult {
  source: string;
  inserted: number;
  error: string | null;
}
const CRON_EXPR = '*/15 * * * *';
const state: { enabled: boolean; startedAt: Date | null; finishedAt: Date | null; trigger: 'cron' | 'manual' | null; results: NewsRunResult[] } = {
  enabled: false,
  startedAt: null,
  finishedAt: null,
  trigger: null,
  results: [],
};

/** Estado en memoria del worker (por proceso): para el panel de staff. */
export function getNewsWorkerStatus() {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(Math.floor(now.getMinutes() / 15) * 15 + 15);
  return {
    enabled: state.enabled,
    schedule: CRON_EXPR,
    running,
    trigger: state.trigger,
    lastStartedAt: state.startedAt?.toISOString() ?? null,
    lastFinishedAt: state.finishedAt?.toISOString() ?? null,
    lastResults: state.results,
    nextRunAt: state.enabled ? next.toISOString() : null,
    sources: NEWS_SOURCES.map((s) => ({ id: s.id, url: s.url })),
  };
}

/** Devuelve false si ya habia una ejecucion en curso. */
export async function runOfficialNewsIngest(trigger: 'cron' | 'manual' = 'cron'): Promise<boolean> {
  if (running) return false;
  running = true;
  state.startedAt = new Date();
  state.trigger = trigger;
  const results: NewsRunResult[] = [];
  try {
    for (const source of NEWS_SOURCES) {
      try {
        const n = await ingestSource(source);
        results.push({ source: source.id, inserted: n, error: null });
        log.info({ source: source.id, inserted: n }, 'ingesta de noticias oficiales');
      } catch (err) {
        results.push({ source: source.id, inserted: 0, error: err instanceof Error ? err.message.slice(0, 200) : 'error' });
        log.error({ err, source: source.id }, 'fallo en fuente; se continua con las demas');
      }
    }
  } finally {
    state.results = results;
    state.finishedAt = new Date();
    running = false;
  }
  return true;
}

export function startOfficialNewsWorker(app?: FastifyInstance): void {
  if (process.env.NEWS_WORKER_ENABLED === 'false') return;
  state.enabled = true;
  if (app?.log) log = app.log as unknown as Logger;
  const safeRun = () => {
    void runOfficialNewsIngest().catch((err) => log.error({ err }, 'ingesta fallida'));
  };
  cron.schedule(CRON_EXPR, safeRun);
  safeRun();
}
