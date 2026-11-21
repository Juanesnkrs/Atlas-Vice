// Navegación interna del panel de gestión: sección, bloque y filtros activos viven en la query de `/_staff`
// (History API, sin librerías), de modo que sobreviven a una recarga y se pueden compartir. El router de la app
// sigue viendo `/_staff` como una ruta única. Solo lo importan los módulos Staff*.
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { navigate, useLocation } from '../../store/useRouteStore';
import { useStaffStore } from '../../store/useStaffStore';

const PANEL_PATH = '/_staff';

/** Sección y bloque activos según la URL (`?s=&b=`). */
export function useStaffLocation(): { section: string | null; block: string | null } {
  const { params } = useLocation();
  return { section: params.get('s'), block: params.get('b') };
}

/** Cambia de sección/bloque. Los filtros recordados del bloque destino se restauran en la URL. */
export function goTo(section: string, block?: string, extra: Record<string, string> = {}): void {
  const p = new URLSearchParams({ s: section });
  if (block) {
    p.set('b', block);
    const remembered = useStaffStore.getState().filters[block] ?? {};
    for (const [k, v] of Object.entries({ ...remembered, ...extra })) if (v !== '') p.set(k, v);
  } else {
    for (const [k, v] of Object.entries(extra)) if (v !== '') p.set(k, v);
  }
  navigate(`${PANEL_PATH}?${p.toString()}`, { replace: true, keepScroll: true });
}

type Filters = Record<string, string>;

/**
 * Filtros de un bloque (búsqueda `q`, módulo `m`, página `p`, estado `st`…), sincronizados con la URL y recordados en
 * memoria al cambiar de pestaña. Valores iniciales: la URL (enlace compartido o recarga), si no los recordados, si no
 * los `defaults`. `search` se enlaza al `<input type="search">` del bloque (con `data-staff-search` para el atajo `/`).
 */
export function useBlockFilters<D extends Filters>(block: string, defaults: D) {
  const defaultsRef = useRef(defaults);
  const [f, setF] = useState<D>(() => {
    const url = new URLSearchParams(window.location.search);
    const remembered = useStaffStore.getState().filters[block] ?? {};
    const fromUrl = url.get('b') === block;
    const out: Filters = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = fromUrl ? url.get(k) : (remembered[k] ?? null);
      if (v !== null) out[k] = v;
    }
    return out as D;
  });
  const [text, setText] = useState(f['q'] ?? '');

  // Persistencia: memoria (cambio de pestaña) + URL (recarga / enlace compartido).
  useEffect(() => {
    useStaffStore.getState().setFilters(block, f);
    const url = new URLSearchParams(window.location.search);
    url.set('b', block);
    for (const [k, def] of Object.entries(defaultsRef.current)) {
      if (f[k] === def || f[k] === '' || f[k] === undefined) url.delete(k);
      else url.set(k, f[k]!);
    }
    navigate(`${PANEL_PATH}?${url.toString()}`, { replace: true, keepScroll: true });
  }, [block, f]);

  const set = useCallback((patch: Partial<D>) => setF((prev) => ({ ...prev, ...patch })), []);

  // Búsqueda con retardo: reinicia la página al cambiar el texto.
  useEffect(() => {
    if (!('q' in defaultsRef.current)) return;
    const id = setTimeout(() => {
      const q = text.trim();
      setF((prev) => (prev['q'] === q ? prev : { ...prev, q, ...('p' in prev ? { p: '1' } : {}) }));
    }, 250);
    return () => clearTimeout(id);
  }, [text]);

  const search = {
    value: text,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    'data-staff-search': true as const,
  };
  const page = Math.max(1, Number(f['p']) || 1);
  return { f, set, search, page, setPage: (p: number) => set({ p: String(p) } as unknown as Partial<D>) };
}

/**
 * Atajos del panel: `/` enfoca el buscador del bloque activo (solo si el foco no está en un campo y no hay un
 * diálogo abierto) y `Esc` cierra el detalle desplegado (botón con `data-staff-detail` y `aria-expanded="true"`).
 * Los modales ya cierran con Esc por su cuenta.
 */
export function useStaffShortcuts(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const typing =
        t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === '/' && !typing) {
        const el = rootRef.current?.querySelector<HTMLInputElement>('[data-staff-search]');
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
      } else if (e.key === 'Escape' && !typing) {
        rootRef.current?.querySelector<HTMLElement>('[data-staff-detail][aria-expanded="true"]')?.click();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rootRef]);
}

/** Pestaña interna de una sección (`?b=`): valor válido de la URL o, si no, el primero. Cambiarla actualiza la URL. */
export function useBlockTab<T extends string>(section: string, tabs: ReadonlyArray<{ id: T }>): [T, (id: T) => void] {
  const { block } = useStaffLocation();
  const current = tabs.find((t) => t.id === block)?.id ?? tabs[0]!.id;
  return [current, (id: T) => goTo(section, id)];
}
