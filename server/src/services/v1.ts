/**
 * v1 «enciclopedia» (decisión del propietario, 2026-11-24): Hub, Progreso, Foro y Aportar están OCULTOS al público,
 * no borrados. Espejo de src/data/v1.ts (cliente). Para reactivarlos en la v1.1 basta poner COMMUNITY_ENABLED en
 * `true` aquí y los interruptores del cliente. Mientras estén ocultos: sus rutas responden 404 (SSR-lite), no entran en el
 * sitemap y el módulo `foro` no puede activarse (no tiene pantalla pública).
 */
export const COMMUNITY_ENABLED = false;

/** Rutas públicas ocultas en la v1 (comparación en minúsculas, sin barra final). */
export const V1_HIDDEN_PATHS: ReadonlySet<string> = COMMUNITY_ENABLED
  ? new Set<string>()
  : new Set<string>(['/foro', '/hub', '/progreso', '/aportar', '/aportes']);
