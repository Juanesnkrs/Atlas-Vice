// =============================================================================
// ATLAS VICE - Store de progreso al 100% (RF-01, RF-04, HU-02, HU-03, RNF-02)
// Caché local offline-first en IndexedDB (idb-keyval) + sincronización con
// `public.user_progress` en Supabase cuando hay sesión.
// Resolución de conflictos: last-write-wins por `updated_at`.
// =============================================================================
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { TablesInsert, UserProgress } from '../types/database';
import { supabase, useAuthStore } from './useAuthStore';

// ---- Tipos ------------------------------------------------------------------
export type ProgressTarget = { entityId: string } | { markerId: string };
export type ProgressKey = `entity:${string}` | `marker:${string}`;

export interface LocalProgressItem {
  entity_id: string | null;
  marker_id: string | null;
  completado: boolean;
  updated_at: string;
  /** `false` = cambio local pendiente de subir a Supabase. */
  synced: boolean;
}

export type SyncStatus = 'idle' | 'syncing' | 'error';

interface ProgressState {
  items: Record<ProgressKey, LocalProgressItem>;
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  syncError: string | null;
  hydrated: boolean;

  isCompleted: (target: ProgressTarget) => boolean;
  setCompleted: (target: ProgressTarget, completado: boolean) => void;
  toggle: (target: ProgressTarget) => void;
  completedCount: (filter?: { kind: 'entity' | 'marker'; ids?: readonly string[] }) => number;
  /** Fusiona progreso local con la nube (pull + merge + push). */
  syncWithCloud: () => Promise<void>;
  /** Limpia la caché local (p. ej. al cerrar sesión, si se desea). */
  resetLocal: () => void;
}

// ---- Utilidades -------------------------------------------------------------
export const progressKey = (target: ProgressTarget): ProgressKey =>
  'entityId' in target ? `entity:${target.entityId}` : `marker:${target.markerId}`;

const keyFromRow = (row: Pick<UserProgress, 'entity_id' | 'marker_id'>): ProgressKey | null => {
  if (row.entity_id) return `entity:${row.entity_id}`;
  if (row.marker_id) return `marker:${row.marker_id}`;
  return null;
};

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
        const userId = useAuthStore.getState().user?.id;
        if (!supabase || !userId) return Promise.resolve();
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve();
        const client = supabase;

        syncInFlight = (async () => {
          set({ syncStatus: 'syncing', syncError: null });
          try {
            // 1. Pull remoto.
            const { data: remote, error: pullError } = await client
              .from('user_progress')
              .select('*')
              .eq('user_id', userId);
            if (pullError) throw pullError;

            // 2. Merge last-write-wins.
            const merged: Record<ProgressKey, LocalProgressItem> = { ...get().items };
            for (const row of remote ?? []) {
              const key = keyFromRow(row);
              if (!key) continue;
              const local = merged[key];
              if (!local || !isNewer(local.updated_at, row.updated_at)) {
                merged[key] = {
                  entity_id: row.entity_id,
                  marker_id: row.marker_id,
                  completado: row.completado,
                  updated_at: row.updated_at,
                  synced: true,
                };
              }
            }

            // 3. Push de pendientes locales. Dos lotes: cada UNIQUE del esquema
            //    (uq_user_entity / uq_user_marker) requiere su propio onConflict.
            const pending = (Object.entries(merged) as [ProgressKey, LocalProgressItem][]).filter(
              ([, it]) => !it.synced,
            );
            const toRow = (it: LocalProgressItem): TablesInsert<'user_progress'> => ({
              user_id: userId,
              entity_id: it.entity_id,
              marker_id: it.marker_id,
              completado: it.completado,
              updated_at: it.updated_at,
            });
            const entityRows = pending.filter(([, it]) => it.entity_id).map(([, it]) => toRow(it));
            const markerRows = pending
              .filter(([, it]) => !it.entity_id && it.marker_id)
              .map(([, it]) => toRow(it));

            if (entityRows.length > 0) {
              const { error } = await client
                .from('user_progress')
                .upsert(entityRows, { onConflict: 'user_id,entity_id' });
              if (error) throw error;
            }
            if (markerRows.length > 0) {
              const { error } = await client
                .from('user_progress')
                .upsert(markerRows, { onConflict: 'user_id,marker_id' });
              if (error) throw error;
            }

            // 4. Marcar como sincronizado solo lo subido sin cambios posteriores.
            const current = get().items;
            const next: Record<ProgressKey, LocalProgressItem> = { ...current };
            for (const [key, it] of Object.entries(merged) as [ProgressKey, LocalProgressItem][]) {
              const live = current[key];
              if (!live || live.updated_at === it.updated_at || isNewer(it.updated_at, live.updated_at)) {
                next[key] = { ...it, synced: true };
              }
            }
            set({ items: next, syncStatus: 'idle', lastSyncedAt: new Date().toISOString() });
          } catch (err) {
            const message = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err);
            set({ syncStatus: 'error', syncError: message });
          } finally {
            syncInFlight = null;
          }
        })();
        return syncInFlight;
      },

      resetLocal: () => set({ items: {}, lastSyncedAt: null, syncError: null, syncStatus: 'idle' }),
    }),
    {
      name: 'atlas-vice-progress',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({ items: state.items, lastSyncedAt: state.lastSyncedAt }),
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
