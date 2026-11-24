// Carrusel del Hero de la portada `/` (DesignSpec §7.12). Misma estructura que el Hero original: texto a la
// izquierda, imagen a la derecha con máscara y, en móvil, texto arriba e imagen abajo. Todas las diapositivas se
// apilan en la misma celda de una rejilla: el alto lo marca el texto más largo y no cambia al avanzar (CLS = 0).
// Sin diapositivas activas, mientras cargan los datos o si una imagen falla, se muestra la diapositiva por defecto.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { DEFAULT_HERO_SLIDE, imageAttrs } from '../../data/seed';
import { API_URL } from '../../store/useAuthStore';
import type { HeroSlide } from '../../types/database';
import { PalmButton } from './PalmButton';

const AUTO_MS = 4000;
const SWIPE_PX = 40;
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold';
const CTRL =
  'inline-flex h-11 w-11 items-center justify-center rounded-full text-vice-text hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-vice-gold';

/** Las imágenes propias (`/media/<id>`) las sirve la API; el resto son enlaces https o recursos estáticos. */
export const heroImageSrc = (url: string): string => (url.startsWith('/media/') ? `${API_URL}${url}` : url);
const isExternal = (href: string): boolean => /^https:\/\//i.test(href);

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = (): void => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

interface SlideProps {
  slide: HeroSlide;
  active: boolean;
  first: boolean;
  guest: boolean;
  inert: boolean;
  total: number;
  position: number;
  imageFailed: boolean;
  headingLevel: 'h1' | 'h3';
  onImageError: () => void;
}

function Slide({ slide, active, first, guest, inert, total, position, imageFailed, headingLevel, onImageError }: SlideProps) {
  const Title = active ? headingLevel : 'div';
  const tab = active && !inert ? undefined : -1;
  const external = isExternal(slide.boton_enlace);
  // La imagen por defecto es vertical (1080×1350) y trae un rótulo arriba: en móvil se encuadra más abajo (caras a la
  // vista, sin rótulo). Las imágenes del equipo son 16:9 y se muestran completas.
  const isDefault = slide.id === DEFAULT_HERO_SLIDE.id;
  // El «Crear cuenta gratis» de la diapositiva por defecto es solo para invitados; el botón secundario que el equipo
  // configura en una diapositiva propia se muestra a todo el mundo.
  const secondary = (guest || slide.id !== DEFAULT_HERO_SLIDE.id) && slide.boton_secundario_texto && slide.boton_secundario_enlace ? { text: slide.boton_secundario_texto, href: slide.boton_secundario_enlace } : null;
  return (
    <div
      role={total > 1 ? 'group' : undefined}
      aria-roledescription={total > 1 ? 'diapositiva' : undefined}
      aria-label={total > 1 ? `${position} de ${total}` : undefined}
      aria-hidden={active ? undefined : true}
      inert={inert}
      className={`relative col-start-1 row-start-1 flex flex-col transition-[opacity,visibility] duration-500 motion-reduce:transition-none max-md:flex-col-reverse md:min-h-[52vh] md:flex-row md:items-center ${
        active ? 'visible opacity-100' : 'invisible opacity-0'
      }`}
    >
      <div className="relative z-10 flex max-w-xl flex-col items-start gap-3 px-5 pb-5 pt-0 max-md:-mt-6 md:w-[55%] md:px-10 md:py-10">
        {slide.kicker !== '' && <p className="text-xs font-semibold uppercase tracking-[0.3em] text-vice-orange">{slide.kicker}</p>}
        <Title className="font-display text-[1.75rem] font-bold leading-[1.15] md:text-5xl">{slide.titulo}</Title>
        <p className="text-[15px] leading-relaxed text-vice-text/90 max-md:line-clamp-4 md:text-lg">{slide.descripcion}</p>
        <div className="mt-1 flex w-full flex-wrap items-center gap-2 md:mt-2 md:w-auto md:gap-3">
          <PalmButton as="a" href={slide.boton_enlace} tabIndex={tab} className="max-md:min-w-0 max-md:flex-1 max-md:basis-[9.5rem] max-md:truncate max-md:px-3 max-md:text-[15px]" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {slide.boton_texto}
          </PalmButton>
          {secondary && (
            <a
              href={secondary.href}
              tabIndex={tab}
              {...(isExternal(secondary.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className={`glass inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold hover:bg-white/10 max-md:min-w-0 max-md:flex-1 max-md:basis-[9.5rem] max-md:truncate max-md:px-3 max-md:text-[15px] ${FOCUS}`}
            >
              {secondary.text}
            </a>
          )}
        </div>
      </div>
      <div
        aria-hidden={imageFailed || undefined}
        className={`relative w-full ${isDefault ? 'aspect-[16/10]' : 'aspect-video'} max-md:[-webkit-mask-image:linear-gradient(180deg,#000_62%,transparent_100%)] max-md:[mask-image:linear-gradient(180deg,#000_62%,transparent_100%)] md:absolute md:inset-y-0 md:right-0 md:aspect-auto md:h-full md:w-[55%] md:[-webkit-mask-image:linear-gradient(90deg,transparent_0,#000_28%)] md:[mask-image:linear-gradient(90deg,transparent_0,#000_28%)]`}
      >
        {!imageFailed && (
          <img
            {...imageAttrs(slide.imagen_url, 'full', '(min-width: 768px) 55vw, 100vw')}
            {...(isDefault ? HERO_DEFAULT_SRCSET : {})}
            alt={active ? slide.imagen_alt : ''}
            decoding="async"
            {...(first ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
            className={`absolute bottom-0 right-0 h-full w-full max-w-none object-cover md:object-[50%_100%] ${isDefault ? 'max-md:object-[50%_82%]' : 'max-md:object-center'}`}
            onError={onImageError}
          />
        )}
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-[rgba(20,14,36,0.55)] to-transparent md:hidden" />
      </div>
    </div>
  );
}

/** Variante WebP 800 px (67 KB) del artwork por defecto: el navegador la elige en móvil y deja el JPG 1080 px (153 KB) para pantallas grandes. */
const HERO_DEFAULT_SRCSET = {
  srcSet: '/assets/hero-gas-station-800.webp 800w, /assets/hero-gas-station.jpg 1080w',
  sizes: '(min-width: 768px) 55vw, 100vw',
} as const;

export function HeroCarousel({
  slides,
  guest,
  preview = false,
  selectedId,
}: {
  /** Diapositivas a mostrar; vacío = diapositiva por defecto. */
  slides: HeroSlide[];
  /** Solo los invitados ven el botón secundario de la diapositiva por defecto («Crear cuenta gratis»). */
  guest: boolean;
  /** Vista previa estática (panel): sin avance, sin controles ni enlaces activos. */
  preview?: boolean;
  /** En vista previa, id de la diapositiva a mostrar. */
  selectedId?: string;
}) {
  // Una imagen caída sustituye su diapositiva por la de por defecto (clave `id|url`).
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const failKey = (s: HeroSlide): string => `${s.id}|${s.imagen_url}`;
  const source = slides.length > 0 ? slides : [DEFAULT_HERO_SLIDE];
  const items = source.map((s) => (failed.has(failKey(s)) && s.id !== DEFAULT_HERO_SLIDE.id ? DEFAULT_HERO_SLIDE : s));
  const total = items.length;

  const [index, setIndex] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const reduced = useReducedMotion();
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const selected = preview && selectedId !== undefined ? items.findIndex((_, i) => source[i]?.id === selectedId) : -1;
  const current = selected >= 0 ? selected : Math.min(index, total - 1);
  const auto = total > 1 && !preview && !hover && !focused && !touched && !reduced;

  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => setIndex((current + 1) % total), AUTO_MS);
    return () => window.clearTimeout(id);
  }, [auto, current, total]);

  const goTo = (next: number): void => {
    const n = (next + total) % total;
    setIndex(n);
    setAnnounce(`Diapositiva ${n + 1} de ${total}`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (total < 2 || preview) return;
    if (e.key === 'ArrowLeft') goTo(current - 1);
    else if (e.key === 'ArrowRight') goTo(current + 1);
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>): void => {
    if (e.pointerType === 'mouse') return;
    setTouched(true);
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>): void => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || total < 2) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - start.y)) goTo(dx < 0 ? current + 1 : current - 1);
  };

  return (
    <section
      role="region"
      aria-roledescription="carrusel"
      aria-label="Portada de LeonidApp"
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipeStart.current = null)}
      className="glass relative isolate grid touch-pan-y overflow-hidden rounded-3xl md:max-h-[60vh]"
    >
      {items.map((s, i) => (
        <Slide
          key={`${source[i]?.id ?? s.id}-${i}`}
          slide={s}
          active={i === current}
          first={i === 0}
          guest={guest}
          inert={preview || i !== current}
          total={total}
          position={i + 1}
          imageFailed={failed.has(failKey(s))}
          headingLevel={preview ? 'h3' : 'h1'}
          onImageError={() => setFailed((p) => new Set(p).add(failKey(s)))}
        />
      ))}
      {total > 1 && !preview && (
        <div className="absolute bottom-2 right-3 z-20 flex items-center gap-1 rounded-full bg-[rgba(20,14,36,0.78)] px-1 backdrop-blur-sm max-md:bottom-auto max-md:top-3">
          <button type="button" onClick={() => goTo(current - 1)} aria-label="Diapositiva anterior" className={`${CTRL} max-md:hidden`}>
            <Chevron dir="left" />
          </button>
          <div role="group" aria-label="Elegir diapositiva" className="flex items-center">
            {items.map((s, i) => (
              <button
                key={`${s.id}-${i}`}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Ir a la diapositiva ${i + 1} de ${total}`}
                aria-current={i === current ? 'true' : undefined}
                className={`inline-flex h-11 w-6 items-center justify-center rounded-full ${FOCUS}`}
              >
                <span aria-hidden="true" className={`block h-2 rounded-full transition-all motion-reduce:transition-none ${i === current ? 'w-4 bg-vice-orange' : 'w-2 bg-white/50'}`} />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => goTo(current + 1)} aria-label="Diapositiva siguiente" className={`${CTRL} max-md:hidden`}>
            <Chevron dir="right" />
          </button>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </section>
  );
}
