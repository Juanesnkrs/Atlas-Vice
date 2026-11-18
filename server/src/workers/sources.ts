/**
 * Fuentes OFICIALES de noticias (Rockstar Games / Take-Two Interactive).
 * Cualquier host fuera de ALLOWED_HOSTS se rechaza.
 *
 * Verificadas el 2026-11-18 con User-Agent generico:
 * - Take-Two IR: RSS oficial de notas de prensa, permitido por robots.txt.
 * - Rockstar Newswire (www.rockstargames.com/newswire): robots.txt lo permite, pero es un
 *   shell de microfrontends sin RSS ni API publica documentada; no se ingiere.
 * - YouTube (/feeds/videos.xml): robots.txt lo prohibe (Disallow: /feeds/videos.xml); descartado.
 */
export type NewsSourceId = 'rockstar-newswire' | 'rockstar-youtube' | 'take-two-ir';

export interface NewsSourceConfig {
  id: NewsSourceId;
  url: string;
  /** Si existe, solo se ingieren items cuyo titulo o resumen (sin acentos ni mayusculas) coincida. */
  relevance?: RegExp;
}

export const ALLOWED_HOSTS: readonly string[] = ['www.rockstargames.com', 'rockstargames.com', 'ir.take2games.com'];

export const NEWS_SOURCES: readonly NewsSourceConfig[] = [
  {
    id: 'take-two-ir',
    url: 'https://ir.take2games.com/rss/news-releases.xml',
    relevance: /rockstar|grand theft auto|\bgta\b|red dead|leonida/,
  },
];

export function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const fold = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function isRelevant(source: NewsSourceConfig, title: string, summary: string): boolean {
  return !source.relevance || source.relevance.test(fold(`${title} ${summary}`));
}
