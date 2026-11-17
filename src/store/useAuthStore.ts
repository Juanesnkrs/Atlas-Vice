// =============================================================================
// ATLAS VICE - Store de sesión (Invitado / Email / Discord)
// Contiene también el cliente Supabase tipado: el árbol de carpetas aprobado no
// define un `src/lib/`, por lo que el cliente vive junto a la capa de sesión.
// =============================================================================
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Database, Profile } from '../types/database';

// ---- Cliente Supabase -------------------------------------------------------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** `null` cuando faltan las variables de entorno: la app opera solo en modo Invitado. */
export const supabase: SupabaseClient<Database> | null =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export const isSupabaseConfigured = supabase !== null;

// ---- Tipos ------------------------------------------------------------------
export type AuthStatus = 'idle' | 'loading' | 'guest' | 'authenticated';
export type AuthProviderKind = 'guest' | 'email' | 'discord';

interface AuthResult {
  ok: boolean;
  error: string | null;
}

interface AuthState {
  status: AuthStatus;
  provider: AuthProviderKind | null;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** Elección persistida de "Continuar como Invitado" (RF-01 / HU-01). */
  guestMode: boolean;
  error: string | null;

  init: () => Promise<void>;
  continueAsGuest: () => void;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signUpWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signInWithDiscord: () => Promise<AuthResult>;
  /** P02.2 - Envío de enlace de recuperación. */
  resetPassword: (email: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  isAdmin: () => boolean;
}

const NOT_CONFIGURED = 'Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).';

const resolveProvider = (user: User | null): AuthProviderKind | null => {
  if (!user) return null;
  return user.app_metadata?.provider === 'discord' ? 'discord' : 'email';
};

const redirectUrl = (): string | undefined =>
  typeof window !== 'undefined' ? window.location.origin : undefined;

let authListenerAttached = false;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const applySession = (session: Session | null): void => {
        const user = session?.user ?? null;
        if (user) {
          set({
            session,
            user,
            provider: resolveProvider(user),
            status: 'authenticated',
            guestMode: false,
            error: null,
          });
          void get().refreshProfile();
        } else {
          set({
            session: null,
            user: null,
            profile: null,
            provider: get().guestMode ? 'guest' : null,
            status: get().guestMode ? 'guest' : 'idle',
          });
        }
      };

      const run = async (
        fn: (client: SupabaseClient<Database>) => Promise<{ error: { message: string } | null }>,
      ): Promise<AuthResult> => {
        if (!supabase) {
          set({ error: NOT_CONFIGURED });
          return { ok: false, error: NOT_CONFIGURED };
        }
        set({ error: null });
        const { error } = await fn(supabase);
        if (error) {
          set({ error: error.message });
          return { ok: false, error: error.message };
        }
        return { ok: true, error: null };
      };

      return {
        status: 'idle',
        provider: null,
        session: null,
        user: null,
        profile: null,
        guestMode: false,
        error: null,

        init: async () => {
          if (!supabase) {
            applySession(null);
            return;
          }
          set({ status: 'loading' });
          try {
            const { data, error } = await supabase.auth.getSession();
            if (error) set({ error: error.message });
            applySession(data.session);
          } catch (err) {
            // Sin red: no bloquear la app; seguir como invitado/local.
            set({ error: err instanceof Error ? err.message : 'Sin conexión' });
            applySession(null);
          }

          if (!authListenerAttached) {
            authListenerAttached = true;
            supabase.auth.onAuthStateChange((_event, session) => applySession(session));
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

        signInWithEmail: (email, password) =>
          run((c) => c.auth.signInWithPassword({ email, password })),

        signUpWithEmail: (email, password) =>
          run((c) => c.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } })),

        signInWithDiscord: () =>
          run((c) =>
            c.auth.signInWithOAuth({
              provider: 'discord',
              options: { redirectTo: redirectUrl(), scopes: 'identify email' },
            }),
          ),

        resetPassword: (email) =>
          run((c) => c.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() })),

        signOut: async () => {
          if (supabase) await supabase.auth.signOut();
          set({ guestMode: false });
          applySession(null);
        },

        refreshProfile: async () => {
          const userId = get().user?.id;
          if (!supabase || !userId) {
            set({ profile: null });
            return;
          }
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();
          if (error) {
            set({ error: error.message });
            return;
          }
          set({ profile: data });
        },

        isAdmin: () => get().profile?.rol === 'ADMIN',
      };
    },
    {
      name: 'atlas-vice-auth',
      storage: createJSONStorage(() => localStorage),
      // La sesión la persiste el propio SDK de Supabase; aquí solo la preferencia de Invitado.
      partialize: (state) => ({ guestMode: state.guestMode }),
    },
  ),
);
