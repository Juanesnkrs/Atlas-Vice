// =============================================================================
// LeonidApp - Tipos del cliente: forma de las filas que sirve la API Fastify (MongoDB).
// Fuente de verdad: docs/LeonidApp-Arquitectura-Datos-MongoDB.md y server/src/models/*.
// NO añadir campos que la API no devuelva.
// =============================================================================

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---- Dominios CHECK del esquema ---------------------------------------------
type ProfileRol = 'USER' | 'ADMIN';
type SubmissionTipo = 'MARKER' | 'ENTITY' | 'CORRECTION';
type SubmissionEstado = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
export type ForumCategoria = 'General' | 'Guias/Ayuda' | 'Secretos' | 'Crews';
type VoteTargetType = 'THREAD' | 'POST';

type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          avatar_url: string | null;
          discord_id: string | null;
          rol: ProfileRol;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          avatar_url?: string | null;
          discord_id?: string | null;
          rol?: ProfileRol;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          avatar_url?: string | null;
          discord_id?: string | null;
          rol?: ProfileRol;
          created_at?: string;
        };
        Relationships: [];
      };
      modules: {
        Row: {
          id: string;
          slug: string;
          nombre: string;
          icono: string;
          activo: boolean;
          orden: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          nombre: string;
          icono: string;
          activo?: boolean;
          orden?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          nombre?: string;
          icono?: string;
          activo?: boolean;
          orden?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      entities: {
        Row: {
          id: string;
          module_id: string;
          titulo: string;
          subtitulo: string | null;
          categoria: string;
          imagen_url: string | null;
          stats_json: Json;
          metadata_json: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          module_id: string;
          titulo: string;
          subtitulo?: string | null;
          categoria: string;
          imagen_url?: string | null;
          stats_json?: Json;
          metadata_json?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          module_id?: string;
          titulo?: string;
          subtitulo?: string | null;
          categoria?: string;
          imagen_url?: string | null;
          stats_json?: Json;
          metadata_json?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'entities_module_id_fkey';
            columns: ['module_id'];
            isOneToOne: false;
            referencedRelation: 'modules';
            referencedColumns: ['id'];
          },
        ];
      };
      map_markers: {
        Row: {
          id: string;
          entity_id: string | null;
          /** Identificador legible para /mapa?pin=<slug> (único; puede faltar). */
          slug?: string | null;
          region: string;
          titulo: string;
          descripcion: string | null;
          /** NUMERIC(8,4): PostgREST lo serializa como number. */
          coord_x: number;
          /** NUMERIC(8,4): PostgREST lo serializa como number. */
          coord_y: number;
          media_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          entity_id?: string | null;
          slug?: string | null;
          region: string;
          titulo: string;
          descripcion?: string | null;
          coord_x: number;
          coord_y: number;
          media_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          entity_id?: string | null;
          slug?: string | null;
          region?: string;
          titulo?: string;
          descripcion?: string | null;
          coord_x?: number;
          coord_y?: number;
          media_url?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'map_markers_entity_id_fkey';
            columns: ['entity_id'];
            isOneToOne: false;
            referencedRelation: 'entities';
            referencedColumns: ['id'];
          },
        ];
      };
      user_progress: {
        Row: {
          id: string;
          user_id: string;
          entity_id: string | null;
          marker_id: string | null;
          completado: boolean;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          entity_id?: string | null;
          marker_id?: string | null;
          completado?: boolean;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          entity_id?: string | null;
          marker_id?: string | null;
          completado?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_progress_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_progress_entity_id_fkey';
            columns: ['entity_id'];
            isOneToOne: false;
            referencedRelation: 'entities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_progress_marker_id_fkey';
            columns: ['marker_id'];
            isOneToOne: false;
            referencedRelation: 'map_markers';
            referencedColumns: ['id'];
          },
        ];
      };
      submissions: {
        Row: {
          id: string;
          user_id: string;
          tipo: SubmissionTipo;
          payload_json: Json;
          estado: SubmissionEstado;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          tipo: SubmissionTipo;
          payload_json: Json;
          estado?: SubmissionEstado;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          tipo?: SubmissionTipo;
          payload_json?: Json;
          estado?: SubmissionEstado;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'submissions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      forum_threads: {
        Row: {
          id: string;
          user_id: string;
          /** NULL = hilo general del foro. */
          entity_id: string | null;
          marker_id: string | null;
          categoria: ForumCategoria;
          titulo: string;
          contenido: string;
          is_spoiler: boolean;
          is_pinned: boolean;
          upvotes_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          entity_id?: string | null;
          marker_id?: string | null;
          categoria: ForumCategoria;
          titulo: string;
          contenido: string;
          is_spoiler?: boolean;
          is_pinned?: boolean;
          upvotes_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          entity_id?: string | null;
          marker_id?: string | null;
          categoria?: ForumCategoria;
          titulo?: string;
          contenido?: string;
          is_spoiler?: boolean;
          is_pinned?: boolean;
          upvotes_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'forum_threads_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'forum_threads_entity_id_fkey';
            columns: ['entity_id'];
            isOneToOne: false;
            referencedRelation: 'entities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'forum_threads_marker_id_fkey';
            columns: ['marker_id'];
            isOneToOne: false;
            referencedRelation: 'map_markers';
            referencedColumns: ['id'];
          },
        ];
      };
      forum_posts: {
        Row: {
          id: string;
          thread_id: string;
          user_id: string;
          parent_post_id: string | null;
          contenido: string;
          upvotes_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          thread_id: string;
          user_id: string;
          parent_post_id?: string | null;
          contenido: string;
          upvotes_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          thread_id?: string;
          user_id?: string;
          parent_post_id?: string | null;
          contenido?: string;
          upvotes_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'forum_posts_thread_id_fkey';
            columns: ['thread_id'];
            isOneToOne: false;
            referencedRelation: 'forum_threads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'forum_posts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'forum_posts_parent_post_id_fkey';
            columns: ['parent_post_id'];
            isOneToOne: false;
            referencedRelation: 'forum_posts';
            referencedColumns: ['id'];
          },
        ];
      };
      forum_votes: {
        Row: {
          user_id: string;
          target_type: VoteTargetType;
          /** UUID polimórfico (forum_threads.id o forum_posts.id); sin FK en el esquema. */
          target_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          target_type: VoteTargetType;
          target_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          target_type?: VoteTargetType;
          target_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'forum_votes_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      /** true si el usuario autenticado tiene rol ADMIN (en la API lo decide el hook de RBAC). */
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// ---- Helpers de conveniencia ------------------------------------------------
type PublicTables = Database['public']['Tables'];
type TableName = keyof PublicTables;
type Tables<T extends TableName> = PublicTables[T]['Row'];

export type Profile = Tables<'profiles'>;
export type Module = Tables<'modules'>;
export type Entity = Tables<'entities'>;
export type MapMarker = Tables<'map_markers'>;
/** `replies_count` lo calcula la API (agregacion sobre ForumPost); no se persiste. */
export type ForumThread = Tables<'forum_threads'> & { replies_count?: number };
/** Hilo en formato preview (invitado): sin `contenido`. Respuesta de GET /api/forum sin sesion. */
type ForumThreadPreview = Omit<Tables<'forum_threads'>, 'contenido'> & { replies_count: number };
/** Autor publico reducido que devuelve la API en modo preview. */
export type ForumProfilePreview = Pick<Tables<'profiles'>, 'id' | 'username' | 'avatar_url'>;
/** Contrato de GET /api/forum: `preview: true` (sin sesion) o respuesta completa. */
export type ForumApiResponse =
  | { preview: true; threads: ForumThreadPreview[]; posts: []; profiles: ForumProfilePreview[] }
  | { preview: false; threads: ForumThread[]; posts: ForumPost[]; profiles: ForumProfilePreview[] };
export type ForumPost = Tables<'forum_posts'>;

// =============================================================================
// LeonidApp (MongoDB) - contratos de API reflejados desde server/src/models/*
// Fuente: docs/LeonidApp-Arquitectura-Datos-MongoDB.md. No añadir campos nuevos.
// =============================================================================
const SUBMISSION_TYPES = ['marker', 'entity', 'correction', 'contact', 'newsletter'] as const;
type SubmissionType = (typeof SUBMISSION_TYPES)[number];
type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface SubmissionDTO {
  id: string;
  userId: string | null; // null solo en contact/newsletter
  moduleSlug: string;
  type: SubmissionType;
  title: string;
  payload: Record<string, unknown>;
  coords: { x: number; y: number } | null;
  status: SubmissionStatus;
  reviewedBy: string | null; // 'system' en aprobación automática
  promotedTo: { collection: 'MapMarker' | 'Entity'; id: string } | null;
  createdAt: string;
}

export type AdRoute = '/catalogo/:categoria/:itemSlug' | '/guias' | '/guias/:slug' | '/noticias' | '/noticias/:slug' | '/foro';
export type AdPosition = 'in-article' | 'after-content' | 'sidebar';
export interface MonetizationConfig {
  ads_enabled: boolean;
  provider: 'none' | 'adsense';
  publisher_id: string | null;
  require_consent: true;
  slots: Array<{ id: string; route: AdRoute; position: AdPosition; width: number; height: number; enabled: boolean }>;
}

export interface PublicConfigDTO {
  maintenance_mode: boolean;
  announcement: string | null;
  feature_flags: Record<string, boolean>;
  enabled_auth_providers: Array<'google' | 'discord' | 'apple' | 'magic-link'>;
  social_links: Array<{ platform: string; url: string }>;
  monetization: MonetizationConfig;
  modules: Array<{ id: string; slug: string; nombre: string; icono: string; orden: number; isActive: boolean }>;
}
