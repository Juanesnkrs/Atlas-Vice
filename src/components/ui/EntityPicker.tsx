// Selector único de ficha (Entity) con búsqueda remota en el servidor (`GET /api/entities?q=`): sin cargar el catálogo
// entero. Lo usan el formulario de marcadores del panel de gestión y el Modo Editor del mapa. Con `name` publica la
// ficha elegida en un <input type="hidden">, de modo que funciona dentro de formularios no controlados.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../store/useAuthStore';

export interface PickedEntity {
  id: string;
  slug: string;
  titulo: string;
  categoria: string;
}

const FIELD =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';
const MIN_CHARS = 2;

function useDebouncedText(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function EntityPicker({
  id,
  name,
  defaultValue = null,
  label = 'Ficha vinculada',
  onChange,
}: {
  id: string;
  /** Nombre del campo oculto (solo dentro de formularios). */
  name?: string;
  defaultValue?: string | null;
  label?: string;
  onChange?: (entity: PickedEntity | null) => void;
}) {
  const [value, setValue] = useState<string | null>(defaultValue);
  const [text, setText] = useState('');
  const q = useDebouncedText(text.trim(), 250);
  const hidden = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  const current = useQuery({
    queryKey: ['entity-pick', value],
    enabled: value !== null,
    staleTime: 60_000,
    queryFn: async () => (await apiFetch<PickedEntity[]>(`/api/entities?id=${encodeURIComponent(value!)}&limit=1`))[0] ?? null,
  });
  const results = useQuery({
    queryKey: ['entity-search', q],
    enabled: value === null && q.length >= MIN_CHARS,
    staleTime: 30_000,
    queryFn: () => apiFetch<PickedEntity[]>(`/api/entities?q=${encodeURIComponent(q)}&limit=8`),
  });

  // Un borrador recuperado escribe en el campo oculto: se relee para resincronizar el estado.
  useEffect(() => {
    const form = hidden.current?.form;
    if (!form) return;
    const sync = () => setValue(hidden.current?.value || null);
    form.addEventListener('staff-draft-applied', sync);
    return () => form.removeEventListener('staff-draft-applied', sync);
  }, []);

  // Avisa al formulario (seguimiento de cambios sin guardar) cuando la elección cambia.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    hidden.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [value]);

  const choose = (e: PickedEntity | null) => {
    setValue(e?.id ?? null);
    setText('');
    onChange?.(e);
  };

  return (
    <div>
      {name && <input ref={hidden} type="hidden" name={name} value={value ?? ''} readOnly />}
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {value !== null ? (
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2">
          <span className="min-w-0 text-sm">
            <strong className="font-semibold">{current.data?.titulo ?? (current.isLoading ? 'Cargando…' : 'Ficha no encontrada')}</strong>
            {current.data && <span className="ml-2 text-xs text-vice-text/70">/{current.data.slug}</span>}
          </span>
          <button
            type="button"
            id={id}
            onClick={() => choose(null)}
            className="min-h-11 rounded-lg px-3 text-sm font-semibold text-vice-gold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            Quitar
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            type="search"
            role="combobox"
            aria-expanded={q.length >= MIN_CHARS}
            aria-controls={`${id}-list`}
            autoComplete="off"
            placeholder="Busca por nombre o slug…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={FIELD}
          />
          {q.length >= MIN_CHARS && (
            <ul id={`${id}-list`} role="listbox" aria-label="Resultados" className="mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto rounded-xl bg-white/5 p-1">
              {results.isLoading && <li className="px-3 py-2 text-sm">Buscando…</li>}
              {results.error && <li className="px-3 py-2 text-sm text-vice-gold">No se pudo buscar. Reintenta.</li>}
              {results.data?.length === 0 && <li className="px-3 py-2 text-sm text-vice-text/70">Sin resultados.</li>}
              {results.data?.map((e) => (
                <li key={e.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => choose(e)}
                    className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-1 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                  >
                    <span className="text-sm font-semibold">{e.titulo}</span>
                    <span className="text-xs text-vice-text/70">
                      {e.categoria} · /{e.slug}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.length < MIN_CHARS && <p className="mt-1 text-xs text-vice-text/70">Escribe al menos {MIN_CHARS} letras para buscar.</p>}
        </>
      )}
    </div>
  );
}
