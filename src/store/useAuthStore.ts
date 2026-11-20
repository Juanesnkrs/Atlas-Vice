// =============================================================================
// LEONIDAPP - Store de sesión (Invitado + sesión por cookie HttpOnly).
// El token de sesión vive SOLO en una cookie HttpOnly emitida por la API Fastify:
// el cliente nunca lo ve ni lo guarda (nada de tokens en localStorage). Aquí solo se
// persiste la preferencia "Continuar como Invitado" (un booleano) en IndexedDB.
// Contiene también el cliente HTTP de la API (`apiFetch`): el árbol de carpetas
// aprobado no define un `src/lib/`, por lo que vive junto a la capa de sesión.
// =============================================================================
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { Profile } from '../types/database';

// ---- Deep link nativo `leonidapp://auth/callback?code=...` ---------------------
let deepLinkBound = false;

/** Extrae el código efímero de `leonidapp://auth/callback?code=...`; `null` si no coincide. */
export function parseAuthCallback(url: string): string | null {
  if (!url.startsWith('leonidapp://auth/callback')) return null;
  const q = url.indexOf('?');
  const code = q === -1 ? null : new URLSearchParams(url.slice(q + 1)).get('code');
  return code !== null && code !== '' ? code : null;
}

/**
 * Escucha `appUrlOpen` (plugin nativo App de Capacitor) y canjea el código con `completeNativeLogin`.
 * Se registra una sola vez y solo en plataformas nativas; si el plugin nativo no está instalado, no hace nada.
 */
function bindNativeDeepLink(complete: (code: string) => Promise<unknown>): void {
  if (deepLinkBound || !Capacitor.isNativePlatform()) return;
  deepLinkBound = true;
  try {
    CapacitorApp
      .addListener('appUrlOpen', (e) => {
        const code = parseAuthCallback(e.url);
        if (code !== null) void complete(code);
      })
      .catch(() => undefined);
  } catch {
    // Plugin nativo no disponible: el login por deep link queda inactivo.
  }
}

// ---- Cliente HTTP de la API --------------------------------------------------
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');

/** `false` cuando falta VITE_API_URL: la app opera solo en modo Invitado / datos semilla. */
export const isApiConfigured = API_URL !== '';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  if (!isApiConfigured) throw new ApiError(0, 'API no configurada (VITE_API_URL).');
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      credentials: 'include',
      headers: { accept: 'application/json', ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor');
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Error ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

// ---- Tipos ------------------------------------------------------------------
export type AuthStatus = 'idle' | 'loading' | 'guest' | 'authenticated';
export type AuthProviderKind = 'guest' | 'google' | 'discord' | 'apple' | 'magic-link';
export type OAuthProvider = 'google' | 'discord' | 'apple';
/** Rol tal como lo emite el servidor. El cliente público no enumera roles internos: solo distingue 'USER' del resto. */
export type Role = string;

export interface SessionUser {
  id: string;
  email: string | null;
}

interface ApiUser {
  id: string;
  username: string;
  avatar_url: string | null;
  discord_id: string | null;
  rol: Role;
  email: string | null;
  created_at?: string;
}

interface AuthResult {
  ok: boolean;
  error: string | null;
}

interface AuthState {
  status: AuthStatus;
  provider: AuthProviderKind | null;
  user: SessionUser | null;
  /** Perfil con la forma del DER (el cliente público no expone el rol en `profile`). */
  profile: Profile | null;
  /** Rol emitido por el servidor. Solo informativo: el servidor decide. */
  role: Role | null;
  /** `true` cuando la comprobación de sesión terminó (distingue «sin comprobar» de «sin sesión»). */
  ready: boolean;
  /** Elección persistida de "Continuar como Invitado" (RF-01 / HU-01). */
  guestMode: boolean;
  error: string | null;

  init: () => Promise<void>;
  continueAsGuest: () => void;
  /** Redirige al flujo OAuth2 + PKCE del servidor (Google / Discord / Apple). */
  signInWithProvider: (provider: OAuthProvider, next?: string) => Promise<AuthResult>;
  requestMagicLink: (email: string, next?: string) => Promise<AuthResult>;
  /** Canjea el código efímero recibido en `leonidapp://auth/callback?code=...`. */
  completeNativeLogin: (code: string) => Promise<AuthResult>;
  /** @deprecated Sin contraseñas: envía un Magic Link. Se conserva por compatibilidad con la UI. */
  signInWithEmail: (email: string, _password?: string) => Promise<AuthResult>;
  /** @deprecated Sin contraseñas: envía un Magic Link. */
  signUpWithEmail: (email: string, _password?: string) => Promise<AuthResult>;
  /** @deprecated Usar signInWithProvider('discord'). */
  signInWithDiscord: () => Promise<AuthResult>;
  /** @deprecated Sin contraseñas: envía un Magic Link. */
  resetPassword: (email: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Cuenta con un rol por encima de USER (cosmético: el servidor decide). Sin literales de roles internos. */
  isStaff: () => boolean;
  /** El servidor negó un recurso reservado: se descarta el rol elevado local. */
  dropElevatedRole: () => void;
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? null,
  setItem: async (name, value) => {
    await idbSet(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};

const toProfile = (u: ApiUser): Profile => ({
  id: u.id,
  username: u.username,
  avatar_url: u.avatar_url,
  discord_id: u.discord_id,
  rol: 'USER',
  created_at: u.created_at ?? new Date(0).toISOString(),
});

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : 'Error desconocido');

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const applyUser = (u: ApiUser | null): void => {
        if (u) {
          set({
            user: { id: u.id, email: u.email },
            profile: toProfile(u),
            role: u.rol,
            provider: null,
            status: 'authenticated',
            guestMode: false,
            error: null,
            ready: true,
          });
        } else {
          const guest = get().guestMode;
          set({
            user: null,
            profile: null,
            role: null,
            provider: guest ? 'guest' : null,
            status: guest ? 'guest' : 'idle',
            ready: true,
          });
        }
      };

      const sendMagic = async (email: string, next?: string): Promise<AuthResult> => {
        set({ error: null });
        try {
          await apiFetch('/api/auth/magic/request', {
            method: 'POST',
            json: { email, native: Capacitor.isNativePlatform(), ...(next ? { next } : {}) },
          });
          return { ok: true, error: null };
        } catch (err) {
          const error = messageOf(err);
          set({ error });
          return { ok: false, error };
        }
      };

      return {
        status: 'idle',
        provider: null,
        user: null,
        profile: null,
        role: null,
        ready: false,
        guestMode: false,
        error: null,

        init: async () => {
          await useAuthStore.persist.rehydrate();
          bindNativeDeepLink((code) => get().completeNativeLogin(code));
          if (!isApiConfigured) {
            applyUser(null);
            return;
          }
          set({ status: 'loading' });
          try {
            const { user } = await apiFetch<{ user: ApiUser | null }>('/api/auth/me');
            applyUser(user);
          } catch (err) {
            // Sin red: no bloquear la app; seguir como invitado/local.
            set({ error: messageOf(err) });
            applyUser(null);
          }
        },

        continueAsGuest: () => {
          set({
            guestMode: true,
            provider: 'guest',
            status: get().user ? 'authenticated' : 'guest',
            error: null,
          });
        },

        signInWithProvider: async (provider, next) => {
          if (!isApiConfigured) {
            const error = 'API no configurada (VITE_API_URL).';
            set({ error });
            return { ok: false, error };
          }
          const qs = new URLSearchParams();
          if (Capacitor.isNativePlatform()) qs.set('native', '1');
          if (next) qs.set('next', next);
          const query = qs.toString();
          window.location.assign(`${API_URL}/api/auth/${provider}/start${query ? `?${query}` : ''}`);
          return { ok: true, error: null };
        },

        requestMagicLink: sendMagic,

        completeNativeLogin: async (code) => {
          try {
            const { user } = await apiFetch<{ user: ApiUser }>('/api/auth/exchange', { method: 'POST', json: { code } });
            applyUser(user);
            return { ok: true, error: null };
          } catch (err) {
            const error = messageOf(err);
            set({ error });
            return { ok: false, error };
          }
        },

        signInWithEmail: (email) => sendMagic(email),
        signUpWithEmail: (email) => sendMagic(email),
        signInWithDiscord: () => get().signInWithProvider('discord'),
        resetPassword: (email) => sendMagic(email),

        signOut: async () => {
          if (isApiConfigured && get().user) {
            await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
          }
          set({ guestMode: false });
          applyUser(null);
        },

        refreshProfile: async () => {
          if (!isApiConfigured || !get().user) {
            set({ profile: null });
            return;
          }
          try {
            const { user } = await apiFetch<{ user: ApiUser | null }>('/api/auth/me');
            applyUser(user);
          } catch (err) {
            set({ error: messageOf(err) });
          }
        },

        isStaff: () => {
          const r = get().role;
          return r !== null && r !== 'USER';
        },
        dropElevatedRole: () => {
          if (get().role !== null) set({ role: 'USER' });
        },
      };
    },
    {
      name: 'atlas-vice-auth',
      storage: createJSONStorage(() => idbStorage),
      skipHydration: true,
      // Solo la preferencia de Invitado: la sesión real es una cookie HttpOnly.
      partialize: (state) => ({ guestMode: state.guestMode }),
    },
  ),
);
