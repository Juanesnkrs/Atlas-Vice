// =============================================================================
// LEONIDAPP - Store de progreso al 100% (RF-01, RF-04, HU-02, HU-03, RNF-02)
// Caché local offline-first en IndexedDB (idb-keyval) + sincronización con la API
// Fastify (`/api/progress`) cuando hay sesión por cookie.
// Resolución de conflictos: last-write-wins por `updated_at`.
// =============================================================================
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { apiFetch, isApiConfigured, useAuthStore } from './useAuthStore';

// ---- Tipos ------------------------------------------------------------------
export type ProgressTarget = { entityId: string } | { markerId: string };
export type ProgressKey = `entity:${string}` | `marker:${string}`;

export interface LocalProgressItem {
  entity_id: string | null;
  marker_id: string | null;
  completado: boolean;
  updated_at: string;
  /** `false` = cambio local pendiente de subir a la API. */
  synced: boolean;
}

export type SyncStatus = 'idle' | 'syncing' | 'error';

/** Forma del contrato `/api/progress` (target_type + target_id). */
interface RemoteProgress {
  target_type: 'ENTITY' | 'MARKER';
  target_id: string;
  completado: boolean;
  updated_at: string;
}

interface ProgressState {
  items: Record<ProgressKey, LocalProgressItem>;
  /**
   * Pasos de guía completados por entityId (solo caché local en IndexedDB). La API de progreso solo
   * conoce ENTITY/MARKER: al completar todos los pasos la guía se marca como completada y ESA marca
   * sí se sincroniza con MongoDB.
   */
  guideSteps: Record<string, string[]>;
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  syncError: string | null;
  hydrated: boolean;

  isCompleted: (target: ProgressTarget) => boolean;
  setCompleted: (target: ProgressTarget, completado: boolean) => void;
  toggle: (target: ProgressTarget) => void;
  /** Marca/desmarca un paso de guía; `allStepIds` decide cuándo la guía queda completa. */
  toggleGuideStep: (entityId: string, stepId: string, allStepIds: readonly string[]) => void;
  completedCount: (filter?: { kind: 'entity' | 'marker'; ids?: readonly string[] }) => number;
  /** Fusiona progreso local con la nube (pull + merge + push). */
  syncWithCloud: () => Promise<void>;
  /** Limpia la caché local (p. ej. al cerrar sesión, si se desea). */
  resetLocal: () => void;
}

// ---- Utilidades -------------------------------------------------------------
export const progressKey = (target: ProgressTarget): ProgressKey =>
  'entityId' in target ? `entity:${target.entityId}` : `marker:${target.markerId}`;

const keyFromRemote = (r: RemoteProgress): ProgressKey =>
  r.target_type === 'ENTITY' ? `entity:${r.target_id}` : `marker:${r.target_id}`;

const isNewer = (a: string, b: string): boolean => Date.parse(a) > Date.parse(b);

/** Adaptador StateStorage de Zustand sobre IndexedDB. */
const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? null,
  setItem: async (name, value) => {
    await idbSet(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};

let syncInFlight: Promise<void> | null = null;

// ---- Store ------------------------------------------------------------------
export const useProgressStore = create<ProgressState>()(
  persist(
    (set, get) => ({
      items: {},
      guideSteps: {},
      syncStatus: 'idle',
      lastSyncedAt: null,
      syncError: null,
      hydrated: false,

      isCompleted: (target) => get().items[progressKey(target)]?.completado === true,

      setCompleted: (target, completado) => {
        const key = progressKey(target);
        const item: LocalProgressItem = {
          entity_id: 'entityId' in target ? target.entityId : null,
          marker_id: 'markerId' in target ? target.markerId : null,
          completado,
          updated_at: new Date().toISOString(),
          synced: false,
        };
        set((s) => ({ items: { ...s.items, [key]: item } }));
        void get().syncWithCloud();
      },

      toggle: (target) => get().setCompleted(target, !get().isCompleted(target)),

      toggleGuideStep: (entityId, stepId, allStepIds) => {
        // Guía completada en otro dispositivo (solo llega la marca ENTITY): todos los pasos cuentan como hechos.
        const prev = get().guideSteps[entityId] ?? (get().isCompleted({ entityId }) ? [...allStepIds] : []);
        const next = prev.includes(stepId) ? prev.filter((x) => x !== stepId) : [...prev, stepId];
        set((s) => ({ guideSteps: { ...s.guideSteps, [entityId]: next } }));
        const complete = allStepIds.length > 0 && allStepIds.every((id) => next.includes(id));
        if (complete !== get().isCompleted({ entityId })) get().setCompleted({ entityId }, complete);
      },

      completedCount: (filter) => {
        const ids = filter?.ids ? new Set(filter.ids) : null;
        return Object.values(get().items).filter((it) => {
          if (!it.completado) return false;
          if (!filter) return true;
          const id = filter.kind === 'entity' ? it.entity_id : it.marker_id;
          return id !== null && (ids === null || ids.has(id));
        }).length;
      },

      syncWithCloud: () => {
        if (syncInFlight) return syncInFlight;
        if (!isApiConfigured || !useAuthStore.getState().user) return Promise.resolve();
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve();

        syncInFlight = (async () => {
          set({ syncStatus: 'syncing', syncError: null });
          try {
            // 1. Push de pendientes locales; la API fusiona (LWW) y devuelve el estado completo.
            const local = get().items;
            const pending = (Object.values(local) as LocalProgressItem[]).filter((it) => !it.synced);
            const body: RemoteProgress[] = pending.flatMap((it) => {
              const target_type = it.entity_id ? ('ENTITY' as const) : ('MARKER' as const);
              const target_id = it.entity_id ?? it.marker_id;
              return target_id ? [{ target_type, target_id, completado: it.completado, updated_at: it.updated_at }] : [];
            });
            const { items: remote } =
              body.length > 0
                ? await apiFetch<{ items: RemoteProgress[] }>('/api/progress', { method: 'PUT', json: { items: body } })
                : await apiFetch<{ items: RemoteProgress[] }>('/api/progress');

            // 2. Merge last-write-wins sobre el estado vivo (por si hubo cambios durante la petición).
            const current = get().items;
            const next: Record<ProgressKey, LocalProgressItem> = { ...current };
            for (const r of remote) {
              const key = keyFromRemote(r);
              const live = current[key];
              if (live && !live.synced && isNewer(live.updated_at, r.updated_at)) continue; // local más reciente
              next[key] = {
                entity_id: r.target_type === 'ENTITY' ? r.target_id : null,
                marker_id: r.target_type === 'MARKER' ? r.target_id : null,
                completado: r.completado,
                updated_at: r.updated_at,
                synced: true,
              };
            }
            set({ items: next, syncStatus: 'idle', lastSyncedAt: new Date().toISOString() });
          } catch (err) {
            set({ syncStatus: 'error', syncError: err instanceof Error ? err.message : String(err) });
          } finally {
            syncInFlight = null;
          }
        })();
        return syncInFlight;
      },

      resetLocal: () => set({ items: {}, guideSteps: {}, lastSyncedAt: null, syncError: null, syncStatus: 'idle' }),
    }),
    {
      name: 'atlas-vice-progress',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({ items: state.items, guideSteps: state.guideSteps, lastSyncedAt: state.lastSyncedAt }),
      onRehydrateStorage: () => (state) => {
        useProgressStore.setState({ hydrated: true });
        if (state) void state.syncWithCloud();
      },
    },
  ),
);

// ---- Disparadores de sincronización ----------------------------------------
// HU-02: al iniciar sesión se fusiona el progreso local (Invitado) con la nube.
useAuthStore.subscribe((state, prev) => {
  if (state.user?.id && state.user.id !== prev.user?.id) {
    void useProgressStore.getState().syncWithCloud();
  }
});

// RNF-02: reintento al recuperar conexión.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void useProgressStore.getState().syncWithCloud();
  });
}
