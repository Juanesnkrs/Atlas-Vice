// Estado en memoria del panel de gestión (ruta oculta). Nada se persiste: ni localStorage ni sessionStorage ni
// IndexedDB; un borrador vive solo mientras la pestaña esté abierta. Lo importan únicamente los módulos Staff*.
import { create } from 'zustand';

/** Valores de un formulario tal como los devuelve FormData (checkbox marcado = 'on'; desmarcado = ausente). */
export type FormValues = Record<string, string>;

interface StaffState {
  /** Borradores por formulario; clave = `${tipo}:${id|new}`. */
  drafts: Record<string, FormValues>;
  /** Formularios abiertos ahora mismo (clave -> ¿tiene cambios sin guardar?). */
  openForms: Record<string, boolean>;
  /** Filtros de cada bloque, para recuperarlos al volver a una pestaña. */
  filters: Record<string, Record<string, string>>;
  /** La sesión se perdió con trabajo abierto: el panel sigue montado y se ofrece reautenticar. */
  sessionExpired: boolean;
  setDraft: (key: string, values: FormValues) => void;
  clearDraft: (key: string) => void;
  markForm: (key: string, dirty: boolean) => void;
  unmarkForm: (key: string) => void;
  setFilters: (block: string, values: Record<string, string>) => void;
  setSessionExpired: (v: boolean) => void;
}

export const useStaffStore = create<StaffState>((set) => ({
  drafts: {},
  openForms: {},
  filters: {},
  sessionExpired: false,
  setDraft: (key, values) => set((s) => ({ drafts: { ...s.drafts, [key]: values } })),
  clearDraft: (key) =>
    set((s) => {
      const { [key]: _gone, ...rest } = s.drafts;
      return { drafts: rest };
    }),
  markForm: (key, dirty) => set((s) => (s.openForms[key] === dirty ? s : { openForms: { ...s.openForms, [key]: dirty } })),
  unmarkForm: (key) =>
    set((s) => {
      const { [key]: _gone, ...rest } = s.openForms;
      return { openForms: rest };
    }),
  setFilters: (block, values) => set((s) => ({ filters: { ...s.filters, [block]: values } })),
  setSessionExpired: (v) => set({ sessionExpired: v }),
}));

/** ¿Hay algún formulario abierto? (trabajo que no conviene perder ante una sesión caducada). */
export const hasOpenWork = (): boolean => Object.keys(useStaffStore.getState().openForms).length > 0;
