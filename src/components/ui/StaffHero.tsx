// Gestor de la portada (Hero) del panel (ADMIN+): diapositivas del carrusel de `/`. El servidor guarda el array
// completo (`PUT /api/admin/hero`, máx. 6) y valida de nuevo; la validación de aquí es solo ayuda para la persona.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useStaffStore } from '../../store/useStaffStore';
import type { HeroSlideAdmin } from '../../types/database';
import { heroImageSrc, HeroCarousel } from './HeroCarousel';
import { FormModal, SafeDelete, type DeleteTarget } from './StaffForms';
import { StaffHeroImage, uploadHeroImage, type ImageMode } from './StaffHeroImage';
import { DANGER_BTN, errMsg, formGet, INPUT, PRIMARY, QueryState, ROW, SMALL_BTN, staffFetch, toast } from './StaffKit';

interface HeroAdminDTO {
  slides: HeroSlideAdmin[];
  max: number;
}

const DEFAULT_MAX = 6;
const LIMITS = { kicker: 60, titulo: 90, descripcion: 220, boton: 30, alt: 140 } as const;
const INTERNAL_PATH = /^\/(?!\/)[^\s\\]*$/;

/** Espejo de la validación del servidor: ruta interna `/…` (sin `//`) o URL `https://…` (nunca http:, javascript:, data:). */
export function isValidHeroLink(v: string): boolean {
  if (INTERNAL_PATH.test(v)) return true;
  if (!/^https:\/\/[^\s]+$/i.test(v)) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

type Errors = Partial<Record<'kicker' | 'titulo' | 'descripcion' | 'boton_texto' | 'boton_enlace' | 'boton_secundario_texto' | 'boton_secundario_enlace' | 'imagen' | 'imagen_alt', string>>;

interface FormValues {
  kicker: string;
  titulo: string;
  descripcion: string;
  boton_texto: string;
  boton_enlace: string;
  secTexto: string;
  secEnlace: string;
  link: string;
  alt: string;
}

function validate(v: FormValues, mode: ImageMode, blob: Blob | null, existing: string): Errors {
  const e: Errors = {};
  const len = (s: string, max: number): string | undefined => (s.length > max ? `Máximo ${max} caracteres.` : undefined);
  const req = (s: string, max: number): string | undefined => (s === '' ? 'Obligatorio.' : len(s, max));
  const kicker = len(v.kicker, LIMITS.kicker);
  if (kicker) e.kicker = kicker;
  const titulo = req(v.titulo, LIMITS.titulo);
  if (titulo) e.titulo = titulo;
  const descripcion = req(v.descripcion, LIMITS.descripcion);
  if (descripcion) e.descripcion = descripcion;
  const botonTexto = req(v.boton_texto, LIMITS.boton);
  if (botonTexto) e.boton_texto = botonTexto;
  if (v.boton_enlace === '') e.boton_enlace = 'Obligatorio.';
  else if (!isValidHeroLink(v.boton_enlace)) e.boton_enlace = 'Usa una ruta que empiece por «/» o una URL https://…';
  if (v.secTexto !== '' || v.secEnlace !== '') {
    const t = req(v.secTexto, LIMITS.boton);
    if (t) e.boton_secundario_texto = v.secTexto === '' ? 'Indica también el texto, o deja ambos vacíos.' : t;
    if (v.secEnlace === '') e.boton_secundario_enlace = 'Indica también el enlace, o deja ambos vacíos.';
    else if (!isValidHeroLink(v.secEnlace)) e.boton_secundario_enlace = 'Usa una ruta que empiece por «/» o una URL https://…';
  }
  const alt = req(v.alt, LIMITS.alt);
  if (alt) e.imagen_alt = alt;
  if (mode === 'upload') {
    if (blob === null && !existing.startsWith('/media/')) e.imagen = 'Elige una imagen o pega un enlace https://…';
  } else if (!/^https:\/\/[^\s]+$/i.test(v.link)) e.imagen = 'El enlace de la imagen debe empezar por https://';
  return e;
}

/** Campo de texto con contador de caracteres y error propio (no controlado: así entra en el borrador del formulario). */
function CountField({
  id,
  name,
  label,
  max,
  hint,
  error,
  multiline = false,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  label: string;
  max: number;
  hint?: string;
  error?: string;
  multiline?: boolean;
  defaultValue: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [count, setCount] = useState(defaultValue.length);
  useEffect(() => {
    const el = ref.current;
    const form = el?.closest('form');
    if (!el || !form) return;
    const sync = (): void => setCount(el.value.length);
    sync();
    form.addEventListener('staff-draft-applied', sync);
    return () => form.removeEventListener('staff-draft-applied', sync);
  }, []);
  const common = {
    id,
    name,
    defaultValue,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': `${id}-info`,
    onInput: () => setCount(ref.current?.value.length ?? 0),
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea ref={ref} rows={3} className={`${INPUT} py-2`} {...common} />
      ) : (
        <input ref={ref} type="text" className={INPUT} {...common} />
      )}
      <p id={`${id}-info`} className="mt-1 flex flex-wrap justify-between gap-2 text-xs">
        <span className={error ? 'font-semibold text-vice-gold' : 'text-vice-text/70'}>{error ?? hint ?? ''}</span>
        <span className={count > max ? 'font-semibold text-vice-gold' : 'text-vice-text/70'}>
          {count}/{max}
        </span>
      </p>
    </div>
  );
}

const shortId = (id: string): string => id.slice(0, 8);

export function HeroManager() {
  const qc = useQueryClient();
  const hero = useQuery({ queryKey: ['staff', 'hero'], queryFn: () => staffFetch<HeroAdminDTO>('/api/admin/hero', { cache: 'no-cache' }) });
  const slides = (hero.data?.slides ?? []).slice().sort((a, b) => a.orden - b.orden);
  const max = hero.data?.max ?? DEFAULT_MAX;

  const [editing, setEditing] = useState<{ item: HeroSlideAdmin | null } | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [mode, setMode] = useState<ImageMode>('upload');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  // Evita subir dos veces la misma imagen si el guardado de la lista falla y se reintenta.
  const uploaded = useRef<{ blob: Blob; url: string } | null>(null);

  const item = editing?.item ?? null;
  const draftKey = `hero:${item?.id ?? 'new'}`;
  const hasActive = slides.some((s) => s.activa);

  const put = useMutation({
    mutationFn: (next: HeroSlideAdmin[]) =>
      staffFetch<{ slides: HeroSlideAdmin[] }>('/api/admin/hero', { method: 'PUT', json: { slides: next.map((s, i) => ({ ...s, orden: i })) } }),
    onSuccess: (res) => {
      qc.setQueryData<HeroAdminDTO>(['staff', 'hero'], { slides: res.slides, max });
      void qc.invalidateQueries({ queryKey: ['hero'] });
    },
  });

  const save = useMutation({
    mutationFn: async (v: { slide: Omit<HeroSlideAdmin, 'imagen_url'>; mode: ImageMode; link: string; blob: Blob | null; previous: HeroSlideAdmin | null }) => {
      let imagen_url = v.link;
      if (v.mode === 'upload') {
        if (v.blob === null) imagen_url = v.previous?.imagen_url ?? '';
        else if (uploaded.current?.blob === v.blob) imagen_url = uploaded.current.url;
        else {
          imagen_url = await uploadHeroImage(v.blob);
          uploaded.current = { blob: v.blob, url: imagen_url };
        }
      }
      const slide: HeroSlideAdmin = { ...v.slide, imagen_url };
      const next = v.previous ? slides.map((s) => (s.id === v.previous?.id ? slide : s)) : [...slides, slide];
      await put.mutateAsync(next);
      return slide;
    },
    onSuccess: (slide, v) => {
      toast.ok(v.previous ? 'Diapositiva guardada.' : 'Diapositiva añadida.');
      useStaffStore.getState().clearDraft(`hero:${v.previous?.id ?? 'new'}`);
      setSelectedId(slide.id);
      uploaded.current = null;
      close();
    },
    onError: (e) => setFormErr(errMsg(e)),
  });

  const quick = useMutation({
    mutationFn: (v: { next: HeroSlideAdmin[]; ok: string }) => put.mutateAsync(v.next),
    onSuccess: (_d, v) => toast.ok(v.ok),
    onError: (e) => toast.err(`No se pudo guardar la portada: ${errMsg(e)}`),
  });
  const busy = save.isPending || quick.isPending;

  const open = (target: HeroSlideAdmin | null): void => {
    setFormErr(null);
    setErrors({});
    setBlob(null);
    uploaded.current = null;
    setMode(target !== null && !target.imagen_url.startsWith('/media/') ? 'link' : 'upload');
    setEditing({ item: target });
  };
  const close = (): void => {
    setEditing(null);
    setBlob(null);
  };

  const toggle = (s: HeroSlideAdmin, activa: boolean): void =>
    quick.mutate({
      next: slides.map((x) => (x.id === s.id ? { ...x, activa } : x)),
      ok: activa ? `«${s.titulo}» activada.` : `«${s.titulo}» en pausa: no se muestra en la portada.`,
    });
  const move = (index: number, dir: -1 | 1): void => {
    const next = slides.slice();
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    quick.mutate({ next, ok: 'Orden actualizado.' });
  };
  const confirmDelete = (): void => {
    if (!deleting) return;
    quick.mutate(
      { next: slides.filter((s) => s.id !== deleting.id), ok: 'Diapositiva borrada.' },
      { onSettled: () => setDeleting(null) },
    );
  };

  const onSubmit = (fd: FormData): void => {
    setFormErr(null);
    const { s } = formGet(fd);
    const values: FormValues = {
      kicker: s('kicker'),
      titulo: s('titulo'),
      descripcion: s('descripcion'),
      boton_texto: s('boton_texto'),
      boton_enlace: s('boton_enlace'),
      secTexto: s('boton_secundario_texto'),
      secEnlace: s('boton_secundario_enlace'),
      link: s('imagen_url'),
      alt: s('imagen_alt'),
    };
    const found = validate(values, mode, blob, item?.imagen_url ?? '');
    setErrors(found);
    if (Object.keys(found).length > 0) return setFormErr('Revisa los campos marcados.');
    save.mutate({
      mode,
      link: values.link,
      blob,
      previous: item,
      slide: {
        id: item?.id ?? crypto.randomUUID(),
        activa: fd.get('activa') === 'on',
        orden: item?.orden ?? slides.length,
        kicker: values.kicker,
        titulo: values.titulo,
        descripcion: values.descripcion,
        boton_texto: values.boton_texto,
        boton_enlace: values.boton_enlace,
        boton_secundario_texto: values.secTexto === '' ? null : values.secTexto,
        boton_secundario_enlace: values.secEnlace === '' ? null : values.secEnlace,
        imagen_alt: values.alt,
      },
    });
  };

  const full = slides.length >= max;
  return (
    <div>
      <p className="text-sm text-vice-text/80">
        Cada diapositiva se muestra en la portada, de arriba abajo en este orden. Solo las activas se publican.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={full || hero.isLoading || hero.error !== null} onClick={() => open(null)} className={PRIMARY}>
          Añadir diapositiva
        </button>
        {full && <span className="text-sm text-vice-text/80">Máximo {max} diapositivas</span>}
      </div>

      <QueryState
        loading={hero.isLoading}
        error={hero.error}
        empty={!hero.isLoading && !hero.error && slides.length === 0}
        emptyText="Aún no hay diapositivas: el Hero muestra la diapositiva por defecto."
        onRetry={() => void hero.refetch()}
      />
      {hero.data && slides.length > 0 && !hasActive && (
        <p role="status" className="mt-3 rounded-lg bg-vice-gold/15 px-3 py-2 text-sm">
          Sin diapositivas activas: el Hero muestra la diapositiva por defecto.
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {slides.map((it, i) => (
          <li key={it.id} className={ROW}>
            <button
              type="button"
              onClick={() => setSelectedId(it.id)}
              aria-pressed={selectedId === it.id}
              aria-label={`Ver «${it.titulo}» en la vista previa`}
              className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-vice-gold ${selectedId === it.id ? 'ring-2 ring-vice-orange' : ''}`}
            >
              <img src={heroImageSrc(it.imagen_url)} alt={it.imagen_alt} loading="lazy" decoding="async" className="aspect-video h-12 shrink-0 rounded-md bg-vice-night object-cover" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{it.titulo}</span>
                <span className="text-xs text-vice-text/70">
                  Posición {i + 1} · {it.activa ? 'Activa' : 'Pausada'}
                </span>
              </span>
            </button>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" role="switch" checked={it.activa} disabled={busy} onChange={(ev) => toggle(it, ev.target.checked)} className="h-5 w-5 accent-[#E1307E]" />
              {it.activa ? 'Activa' : 'Pausada'}
            </label>
            <span className="flex flex-wrap gap-2">
              <button type="button" disabled={i === 0 || busy} onClick={() => move(i, -1)} className={`${SMALL_BTN} min-w-11`} aria-label={`Subir ${it.titulo}`}>
                Subir
              </button>
              <button type="button" disabled={i === slides.length - 1 || busy} onClick={() => move(i, 1)} className={`${SMALL_BTN} min-w-11`} aria-label={`Bajar ${it.titulo}`}>
                Bajar
              </button>
              <button type="button" disabled={busy} onClick={() => open(it)} className={SMALL_BTN} aria-label={`Editar ${it.titulo}`}>
                Editar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleting({ type: 'slide', id: it.id, label: it.titulo, confirmText: shortId(it.id), confirmKind: 'id' })}
                className={DANGER_BTN}
                aria-label={`Borrar ${it.titulo}`}
              >
                Borrar
              </button>
            </span>
          </li>
        ))}
      </ul>

      <section aria-labelledby="hero-preview" className="mt-5">
        <h3 id="hero-preview" className="font-display text-lg font-bold">
          Vista previa
        </h3>
        <p className="mb-2 text-sm text-vice-text/80">Así se verá la diapositiva seleccionada en la portada, para una persona sin sesión.</p>
        <HeroCarousel slides={slides} guest preview selectedId={selectedId} />
      </section>

      <FormModal
        open={editing !== null}
        title={`${item ? 'Editar' : 'Nueva'} diapositiva`}
        formId="hero-form"
        draftKey={draftKey}
        pending={save.isPending}
        error={formErr}
        onClose={close}
        onSubmit={onSubmit}
      >
        <div key={item?.id ?? 'new'} className="flex flex-col gap-3">
          <CountField id="h-kicker" name="kicker" label="Kicker (opcional)" max={LIMITS.kicker} error={errors.kicker} defaultValue={item?.kicker ?? ''} hint="Frase corta sobre el título." />
          <CountField id="h-titulo" name="titulo" label="Título" max={LIMITS.titulo} error={errors.titulo} defaultValue={item?.titulo ?? ''} />
          <CountField id="h-desc" name="descripcion" label="Descripción" max={LIMITS.descripcion} error={errors.descripcion} multiline defaultValue={item?.descripcion ?? ''} />
          <CountField id="h-btn" name="boton_texto" label="Texto del botón" max={LIMITS.boton} error={errors.boton_texto} defaultValue={item?.boton_texto ?? ''} />
          <CountField
            id="h-link"
            name="boton_enlace"
            label="Enlace del botón"
            max={300}
            error={errors.boton_enlace}
            defaultValue={item?.boton_enlace ?? ''}
            placeholder="/mapa o https://…"
            hint="Ruta de la app («/mapa») o URL https://…"
          />
          <CountField
            id="h-btn2"
            name="boton_secundario_texto"
            label="Texto del botón secundario (opcional)"
            max={LIMITS.boton}
            error={errors.boton_secundario_texto}
            defaultValue={item?.boton_secundario_texto ?? ''}
            hint="Solo lo ven las personas sin sesión. Indica texto y enlace, o ninguno."
          />
          <CountField
            id="h-link2"
            name="boton_secundario_enlace"
            label="Enlace del botón secundario (opcional)"
            max={300}
            error={errors.boton_secundario_enlace}
            defaultValue={item?.boton_secundario_enlace ?? ''}
            placeholder="/entrar o https://…"
          />
          <StaffHeroImage
            mode={mode}
            onMode={setMode}
            blob={blob}
            onBlob={setBlob}
            existingUrl={item?.imagen_url ?? ''}
            linkDefault={item && !item.imagen_url.startsWith('/media/') ? item.imagen_url : ''}
            alt={item?.imagen_alt ?? ''}
            error={errors.imagen ?? null}
          />
          <CountField id="h-alt" name="imagen_alt" label="Texto alternativo de la imagen" max={LIMITS.alt} error={errors.imagen_alt} defaultValue={item?.imagen_alt ?? ''} hint="Describe la imagen para lectores de pantalla." />
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="activa" defaultChecked={item?.activa ?? true} className="h-5 w-5 accent-[#E1307E]" />
            Activa (se muestra en la portada)
          </label>
        </div>
      </FormModal>

      <SafeDelete target={deleting} pending={quick.isPending} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  );
}
