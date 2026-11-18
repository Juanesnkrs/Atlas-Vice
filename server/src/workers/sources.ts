/**
 * Fuentes OFICIALES de noticias (Rockstar Games / Take-Two Interactive).
 * Cualquier host fuera de ALLOWED_HOSTS se rechaza.
 *
 * ROCKSTAR_YT_CHANNEL_ID: id del canal oficial de Rockstar Games en YouTube.
 * El valor por defecto NO esta verificado contra el canal en vivo; confirmalo
 * y fijalo por entorno antes de produccion.
 */
export type NewsSourceId = 'rockstar-newswire' | 'rockstar-youtube' | 'take-two-ir';

export interface NewsSourceConfig {
  id: NewsSourceId;
  url: string;
  kind: 'newswire-html' | 'rss-atom';
}

export const ALLOWED_HOSTS: readonly string[] = [
  'www.rockstargames.com',
  'rockstargames.com',
  'www.youtube.com',
  'ir.take2games.com',
];

const ytChannel = process.env.ROCKSTAR_YT_CHANNEL_ID ?? 'UCGOGQLRD60Yf5yJvS9eGZIg';

export const NEWS_SOURCES: readonly NewsSourceConfig[] = [
  { id: 'rockstar-newswire', url: 'https://www.rockstargames.com/newswire', kind: 'newswire-html' },
  {
    id: 'rockstar-youtube',
    url: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(ytChannel)}`,
    kind: 'rss-atom',
  },
  { id: 'take-two-ir', url: 'https://ir.take2games.com/rss/pressrelease.aspx', kind: 'rss-atom' },
];

export function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}
