import sharp, { type Metadata } from 'sharp';
import type { FastifyRequest } from 'fastify';
import { AppConfig } from '../models/AppConfig.js';
import { Entity } from '../models/Entity.js';
import { MEDIA_HEIGHT, MEDIA_MAX_BYTES_MANUAL, MEDIA_THUMB_HEIGHT, MEDIA_THUMB_WIDTH, MEDIA_WIDTH, MediaAsset } from '../models/MediaAsset.js';
import { writeAudit } from './audit.js';
import { HttpError } from './validate.js';

/** Estudio de imagenes: procesamiento de cargas manuales (Photoshop 1600x900) y limpieza de MediaAsset huerfanos. */
/** Objetivo (mejor esfuerzo, no es error superarlo) de la miniatura movil: 180 KB. */
export const THUMB_TARGET_BYTES = 184_320;
export const MANUAL_MAX_PIXELS = 60_000_000;
/** Escalera de calidad WebP del principal: de 82 a un minimo de 60. */
export const MAIN_QUALITIES = [82, 78, 74, 70, 66, 62, 60] as const;
const THUMB_QUALITIES = [78, 70, 62, 54, 46] as const;
export const OWN_MEDIA_RE = /^\/media\/([0-9a-f-]{36})$/;

export interface ManualImageResult {
  main: Buffer;
  thumb: Buffer;
  mainBytes: number;
  thumbBytes: number;
  mainQuality: number;
  thumbQuality: number;
  /** true si la proporcion de origen no era 16:9 y se recorto. */
  cropped: boolean;
  sourceWidth: number;
  sourceHeight: number;
}

const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;
const clamp = (n: number): number => Math.min(100, Math.max(0, n));

/**
 * Procesa una carga manual: valida el formato real, rota segun EXIF, exige >= 1600x900, recorta con `cover`
 * (sin barras ni fondos) y genera el principal 1600x900 (<= 600 KB) y la miniatura 800x450, ambos WebP desde el mismo recorte.
 * `focus` (0-100) desplaza el recorte; por defecto el centro. Nunca amplia.
 */
export async function processManualImage(
  input: Buffer,
  declaredMime: string,
  opts: { focus?: { x: number; y: number } } = {},
): Promise<ManualImageResult> {
  const kind = declaredMime === 'image/jpeg' ? 'jpeg' : declaredMime === 'image/png' ? 'png' : declaredMime === 'image/webp' ? 'webp' : null;
  if (!kind) throw new HttpError(400, 'El archivo debe ser JPG, PNG o WebP');
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MANUAL_MAX_PIXELS }).metadata();
  } catch {
    throw new HttpError(400, 'El archivo no es una imagen JPG, PNG o WebP valida (o supera 60 megapixeles)');
  }
  if (meta.format !== kind) throw new HttpError(400, 'El contenido del archivo no coincide con el tipo de imagen declarado');
  const swap = (meta.orientation ?? 1) >= 5;
  const w = (swap ? meta.height : meta.width) ?? 0;
  const h = (swap ? meta.width : meta.height) ?? 0;
  if (w < MEDIA_WIDTH || h < MEDIA_HEIGHT) {
    throw new HttpError(400, `La imagen debe medir al menos ${MEDIA_WIDTH}×${MEDIA_HEIGHT} px (recibida ${w}×${h})`);
  }
  const scale = Math.max(MEDIA_WIDTH / w, MEDIA_HEIGHT / h);
  const rw = Math.max(MEDIA_WIDTH, Math.round(w * scale));
  const rh = Math.max(MEDIA_HEIGHT, Math.round(h * scale));
  const fx = clamp(opts.focus?.x ?? 50) / 100;
  const fy = clamp(opts.focus?.y ?? 50) / 100;
  const left = Math.round((rw - MEDIA_WIDTH) * fx);
  const top = Math.round((rh - MEDIA_HEIGHT) * fy);

  let raw: Buffer;
  try {
    raw = await sharp(input, { limitInputPixels: MANUAL_MAX_PIXELS })
      .rotate()
      .flatten({ background: '#000000' })
      .resize({ width: rw, height: rh, fit: 'fill' })
      .extract({ left, top, width: MEDIA_WIDTH, height: MEDIA_HEIGHT })
      .removeAlpha()
      .raw()
      .toBuffer();
  } catch {
    throw new HttpError(400, 'No se pudo procesar la imagen');
  }
  const rawOpts = { raw: { width: MEDIA_WIDTH, height: MEDIA_HEIGHT, channels: 3 as const } };

  let main: Buffer | null = null;
  let mainQuality = 0;
  for (const quality of MAIN_QUALITIES) {
    const out = await sharp(raw, rawOpts).webp({ quality }).toBuffer();
    if (out.length <= MEDIA_MAX_BYTES_MANUAL) {
      main = out;
      mainQuality = quality;
      break;
    }
  }
  if (!main) {
    throw new HttpError(
      400,
      `La imagen no se puede comprimir por debajo de ${kb(MEDIA_MAX_BYTES_MANUAL)} con calidad ${MAIN_QUALITIES[MAIN_QUALITIES.length - 1]}; simplifica la imagen (menos ruido o grano) y vuelve a exportarla`,
    );
  }
  let thumb: Buffer = Buffer.alloc(0);
  let thumbQuality = 0;
  for (const quality of THUMB_QUALITIES) {
    thumb = await sharp(raw, rawOpts).resize({ width: MEDIA_THUMB_WIDTH, height: MEDIA_THUMB_HEIGHT, fit: 'fill' }).webp({ quality }).toBuffer();
    thumbQuality = quality;
    if (thumb.length <= THUMB_TARGET_BYTES) break;
  }
  const ratioOk = Math.abs(w / h - MEDIA_WIDTH / MEDIA_HEIGHT) <= 0.005;
  return {
    main,
    thumb,
    mainBytes: main.length,
    thumbBytes: thumb.length,
    mainQuality,
    thumbQuality,
    cropped: !ratioOk,
    sourceWidth: w,
    sourceHeight: h,
  };
}

/** ¿Otra ficha o una diapositiva del Hero siguen usando `/media/<id>`? Solo si no, se puede borrar sin dejar enlaces rotos. */
export async function mediaStillUsed(url: string, exceptEntityId: string): Promise<boolean> {
  if (await Entity.exists({ _id: { $ne: exceptEntityId }, imagen_url: url })) return true;
  const hero = await AppConfig.findOne({ key: 'global' }).select('hero_slides').lean<{ hero_slides?: unknown } | null>();
  return JSON.stringify(hero?.hero_slides ?? []).includes(url);
}

/**
 * Borra el MediaAsset `/media/<uuid>` si nadie mas lo usa. Mejor esfuerzo: nunca lanza (registra aviso).
 * Devuelve el id borrado o null.
 */
export async function removeOrphanMedia(
  req: FastifyRequest,
  url: string | null | undefined,
  exceptEntityId: string,
  reason: string,
): Promise<string | null> {
  const oldId = url ? OWN_MEDIA_RE.exec(url)?.[1] : undefined;
  if (!oldId || !url) return null;
  try {
    if (await mediaStillUsed(url, exceptEntityId)) return null;
    const gone = await MediaAsset.findOneAndDelete({ _id: oldId }, { projection: { data: 0, thumb_data: 0 } }).lean();
    if (!gone) return null;
    await writeAudit(req, 'media.delete', 'MediaAsset', oldId, { mime: gone.mime, bytes: gone.bytes, reason });
    return oldId;
  } catch (err) {
    req.log.warn({ err, id: oldId }, 'No se pudo eliminar el MediaAsset huerfano');
    return null;
  }
}
