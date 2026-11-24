// v1 «enciclopedia» (decisión del propietario, 2026-11-24): la navegación pública se limita a Inicio, Vehículos,
// Armas, Guías, Mapa y Noticias. Hub, Progreso, Foro y Aportar (y la interfaz de cuentas de visitantes) quedan
// OCULTOS, no borrados: su código sigue en el repositorio y se reactivan en la v1.1 poniendo el interruptor en `true`.
// Las rutas ocultas se comportan como inexistentes (vista 404) y el servidor las excluye del sitemap (server/src/services/v1.ts).
// El acceso del personal sigue en `/entrar` y `/_staff` (rutas sin enlaces públicos).

export type FeatureId = 'hub' | 'progress' | 'forum' | 'contribute' | 'accountsUi';

/** Interruptores de la v1. `false` = oculto al público. Una sola fuente de verdad en el cliente. */
export const FEATURES: Readonly<Record<FeatureId, boolean>> = {
  hub: false,
  progress: false,
  forum: false,
  contribute: false,
  accountsUi: false,
};
