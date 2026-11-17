// =============================================================================
// ATLAS VICE - Tipos TypeScript mapeados 1:1 a supabase/schema.sql
// Formato compatible con `supabase gen types typescript` (supabase-js v2).
// NO añadir columnas que no existan en schema.sql.
// =============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---- Dominios CHECK del esquema ---------------------------------------------
export type ProfileRol = 'USER' | 'ADMIN';
export type SubmissionTipo = 'MARKER' | 'ENTITY' | 'CORRECTION';
export type SubmissionEstado = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
export type ForumCategoria = 'General' | 'Guias/Ayuda' | 'Secretos' | 'Crews';
export type VoteTargetType = 'THREAD' | 'POST';

export type Database = {
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
      /** supabase/02_rls_and_triggers.sql - true si auth.uid() tiene rol ADMIN. */
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
export type TableName = keyof PublicTables;
export type Tables<T extends TableName> = PublicTables[T]['Row'];
export type TablesInsert<T extends TableName> = PublicTables[T]['Insert'];
export type TablesUpdate<T extends TableName> = PublicTables[T]['Update'];

export type Profile = Tables<'profiles'>;
export type Module = Tables<'modules'>;
export type Entity = Tables<'entities'>;
export type MapMarker = Tables<'map_markers'>;
export type UserProgress = Tables<'user_progress'>;
export type Submission = Tables<'submissions'>;
export type ForumThread = Tables<'forum_threads'>;
export type ForumPost = Tables<'forum_posts'>;
export type ForumVote = Tables<'forum_votes'>;
