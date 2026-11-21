// Selector de imagen de una diapositiva del Hero (panel). La imagen se recorta y comprime en el navegador, sin
// librerías: <input type="file"> -> <canvas> -> recorte «cover» 1600×900 -> toBlob WebP/JPEG con calidad descendente
// hasta ≤ 400 KB. El Blob queda en memoria; la subida a `POST /api/admin/media` la hace el formulario al guardar.
import { useEffect, useRef, useState } from 'react';
import { heroImageSrc } from './HeroCarousel';
import { Field, GHOST, INPUT, staffFetch } from './StaffKit';
import type { MediaUploadDTO } from '../../types/database';

export const HERO_W = 1600;
export const HERO_H = 900;
export const MAX_BYTES = 400 * 1024;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MIN_W = 800;
const MIN_H = 450;
const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5] as const;

export type ImageMode = 'upload' | 'link';

/** Sube el Blob procesado y devuelve la URL propia (`/media/<id>`). El cuerpo es binario, sin JSON. */
export async function uploadHeroImage(blob: Blob): Promise<string> {
  const media = await staffFetch<MediaUploadDTO>('/api/admin/media', { method: 'POST', body: blob, headers: { 'content-type': blob.type } });
  return media.url;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: File): Promise<Decoded> {
  try {
    const bmp = await createImageBitmap(file);
    return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      img.src = url;
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('No se pudo leer la imagen.');
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, q));

interface Processed {
  blob: Blob;
  cropped: boolean;
}

/** Valida, recorta a 1600×900 («cover», centrado) y comprime a ≤ 400 KB. Lanza `Error` con mensaje legible. */
async function processImage(file: File): Promise<Processed> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('La imagen pesa más de 15 MB. Elige una más ligera.');
  const img = await decode(file);
  try {
    if (img.width < MIN_W || img.height < MIN_H) throw new Error(`La imagen es demasiado pequeña: mínimo ${MIN_W} × ${MIN_H} px.`);
    const canvas = document.createElement('canvas');
    canvas.width = HERO_W;
    canvas.height = HERO_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Tu navegador no puede procesar imágenes.');
    const scale = Math.max(HERO_W / img.width, HERO_H / img.height);
    const sw = HERO_W / scale;
    const sh = HERO_H / scale;
    ctx.fillStyle = '#140E24';
    ctx.fillRect(0, 0, HERO_W, HERO_H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, HERO_W, HERO_H);

    let type = 'image/webp';
    for (const q of QUALITIES) {
      let blob = await toBlob(canvas, type, q);
      // Si el navegador no sabe codificar WebP devuelve PNG: se usa JPEG.
      if (blob !== null && blob.type !== type) {
        type = 'image/jpeg';
        blob = await toBlob(canvas, type, q);
      }
      if (blob !== null && blob.type === type && blob.size <= MAX_BYTES) {
        return { blob, cropped: Math.abs(img.width / img.height - HERO_W / HERO_H) > 0.01 };
      }
    }
    throw new Error('No se pudo reducir a 400 KB: usa otra imagen.');
  } finally {
    img.release();
  }
}

const kb = (n: number): string => `${Math.round(n / 1024)} KB`;

/** Vista previa 16:9 con guía de encuadre (tercios) para que se vea qué queda dentro del recorte. */
function Preview({ src, alt, guide }: { src: string; alt: string; guide: boolean }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-vice-night">
      <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
      {guide && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 border-2 border-dashed border-vice-gold/80"
          style={{
            backgroundImage:
              'linear-gradient(90deg, transparent 33%, rgba(255,255,255,.35) 33%, rgba(255,255,255,.35) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.35) 66%, rgba(255,255,255,.35) calc(66% + 1px), transparent calc(66% + 1px)), linear-gradient(0deg, transparent 33%, rgba(255,255,255,.35) 33%, rgba(255,255,255,.35) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.35) 66%, rgba(255,255,255,.35) calc(66% + 1px), transparent calc(66% + 1px))',
          }}
        />
      )}
    </div>
  );
}

const isHttps = (v: string): boolean => /^https:\/\/\S+$/i.test(v);

export function StaffHeroImage({
  mode,
  onMode,
  blob,
  onBlob,
  existingUrl,
  linkDefault,
  alt,
  error,
}: {
  mode: ImageMode;
  onMode: (m: ImageMode) => void;
  /** Imagen nueva ya procesada (en memoria) o `null`. */
  blob: Blob | null;
  onBlob: (b: Blob | null) => void;
  /** `imagen_url` guardada hasta ahora (`/media/<id>` o https), para la vista previa al editar. */
  existingUrl: string;
  /** Valor inicial del campo «enlace» (campo nombrado `imagen_url`, entra en el borrador del formulario). */
  linkDefault: string;
  alt: string;
  error: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cropNotice, setCropNotice] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [link, setLink] = useState(linkDefault);
  const linkRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // El objectURL de la vista previa se crea y se libera aquí (nunca queda colgando).
  useEffect(() => {
    if (blob === null) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  // El campo del enlace es no controlado (lo restaura el borrador): se resincroniza al aplicar un borrador.
  useEffect(() => {
    const input = linkRef.current;
    const form = input?.closest('form');
    if (!input || !form) return;
    const sync = (): void => setLink(input.value);
    sync();
    form.addEventListener('staff-draft-applied', sync);
    return () => form.removeEventListener('staff-draft-applied', sync);
  }, [mode]);

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setProblem(null);
    setBusy(true);
    try {
      const done = await processImage(file);
      onBlob(done.blob);
      setCropNotice(done.cropped);
    } catch (e) {
      onBlob(null);
      setCropNotice(false);
      setProblem(e instanceof Error ? e.message : 'No se pudo procesar la imagen.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const tab = (m: ImageMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => onMode(m)}
      className={`flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
        mode === m ? 'bg-vice-accent text-vice-ink' : 'bg-white/10 hover:bg-white/20'
      }`}
    >
      {label}
    </button>
  );

  const uploadSrc = previewUrl ?? (existingUrl.startsWith('/media/') ? heroImageSrc(existingUrl) : null);

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-white/15 p-3">
      <legend className="px-1 text-sm font-medium">Imagen</legend>
      <p className="text-xs text-vice-text/80">Tamaño estándar: 1600 × 900 px (16:9), WebP o JPG, máx. 400 KB. Se recorta y ajusta automáticamente.</p>
      <div className="flex gap-2">
        {tab('upload', 'Subir imagen')}
        {tab('link', 'Pegar enlace https://…')}
      </div>

      {mode === 'upload' ? (
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            id="hero-file"
            type="file"
            accept="image/*"
            onChange={(e) => void pick(e.target.files?.[0])}
            aria-label="Elegir imagen"
            className="sr-only"
          />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={GHOST}>
            {busy ? 'Procesando…' : blob || uploadSrc ? 'Cambiar imagen' : 'Elegir imagen'}
          </button>
          {blob && (
            <p role="status" className="text-xs text-vice-text/80">
              Lista para subir al guardar: {HERO_W} × {HERO_H} px · {kb(blob.size)} · {blob.type === 'image/webp' ? 'WebP' : 'JPG'}.
            </p>
          )}
          {cropNotice && (
            <p role="status" className="rounded-lg bg-vice-gold/15 px-3 py-2 text-xs">
              Se recortará al formato 16:9. El recuadro discontinuo muestra el encuadre final.
            </p>
          )}
          {uploadSrc && <Preview src={uploadSrc} alt={alt || 'Vista previa de la imagen de la diapositiva'} guide={blob !== null} />}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Field id="hero-link" label="Enlace de la imagen">
            <input
              ref={linkRef}
              id="hero-link"
              name="imagen_url"
              type="url"
              inputMode="url"
              maxLength={2000}
              placeholder="https://…"
              defaultValue={linkDefault}
              onInput={(e) => setLink(e.currentTarget.value.trim())}
              className={INPUT}
            />
          </Field>
          <p className="text-xs text-vice-text/80">
            Usa solo imágenes propias o con licencia: el equipo responde de los derechos. Recomendado 1600 × 900 px; no se valida el tamaño de los enlaces.
          </p>
          {isHttps(link) && <Preview src={link} alt={alt || 'Vista previa de la imagen de la diapositiva'} guide={false} />}
        </div>
      )}
      {(problem ?? error) && (
        <p role="alert" className="text-sm text-vice-gold">
          {problem ?? error}
        </p>
      )}
    </fieldset>
  );
}
