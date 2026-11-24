// Detalle resumido de un ítem del catálogo. Único componente compartido por el panel derecho
// (tablet/escritorio) y por el BottomSheet móvil de /catalogo/:categoria/:itemSlug.
import { PalmButton } from './PalmButton';
import { StatBar, type StatAccent } from './StatBar';
import {
  descriptionOf,
  entitySlug,
  forumCategoryLabel,
  specGroupsOf,
  statsOf,
  subtitleOf,
  type SpecGroup,
  type SpecRow,
} from '../../data/seed';
import type { Entity, ForumThread, MapMarker } from '../../types/database';

export const STAT_ACCENTS: StatAccent[] = ['magenta', 'gold', 'cyan', 'lilac'];

/** Descripción editorial (`metadata_json.descripcion`): siempre texto plano, un `<p>` por salto de línea. */
export function DescriptionBlock({ paragraphs, className = '' }: { paragraphs: string[]; className?: string }) {
  if (paragraphs.length === 0) return null;
  return (
    <div className={`flex flex-col gap-2 text-sm leading-relaxed text-vice-text/90 ${className}`}>
      {paragraphs.map((p, i) => (
        <p key={i} className="break-words">
          {p}
        </p>
      ))}
    </div>
  );
}

/** Chip discreto para imágenes provisionales del pipeline (`capturaPropiaPendiente`). */
export function ProvisionalChip({ className = '' }: { className?: string }) {
  return (
    <span
      title="Esta imagen es provisional; se reemplazará por una captura propia."
      className={`inline-flex w-fit items-center rounded-full border border-vice-gold/50 bg-black/70 px-2.5 py-0.5 text-[11px] font-semibold text-vice-text ${className}`}
    >
      Imagen provisional
    </span>
  );
}

/** Ficha técnica compartida (Inspector y ficha completa). No renderiza nada si no hay atributos ni filas extra. */
export function SpecSheet({ entity, extra = [] }: { entity: Entity; extra?: SpecRow[] }) {
  const groups: SpecGroup[] = specGroupsOf(entity);
  if (extra.length > 0) groups.push({ id: 'extra', title: 'Mapa', rows: extra });
  if (groups.length === 0) return null;
  const titled = groups.length > 1;
  return (
    <section aria-label="Ficha técnica" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-vice-text/90">Ficha técnica</h3>
      <div className="flex flex-col gap-3 rounded-xl bg-white/5 p-3 text-sm">
        {groups.map((g) => (
          <div key={g.id}>
            {titled && <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-vice-orange">{g.title}</h4>}
            <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-3 gap-y-1">
              {g.rows.map((r) => (
                <div key={r.key} className="contents">
                  <dt className="text-vice-text/75">{r.label}</dt>
                  <dd className="break-words font-semibold">
                    {Array.isArray(r.value) ? (
                      <ul className="flex flex-wrap gap-1">
                        {r.value.map((v, i) => (
                          <li key={`${v}-${i}`} className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold">
                            {v}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      r.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Los Invitados no pueden abrir hilos concretos: se les lleva al listado del foro. */
export const forumHref = (guest: boolean, path: string): string => (guest ? '/foro' : path);

export function MapPinIcon({ off = false }: { off?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

const ACTION =
  'flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-xl border border-white/20 px-2 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold';

export interface EntityDetailPanelProps {
  entity: Entity;
  /** Etiqueta de progreso del módulo ('Obtenida', 'Obtenido', 'Completado'). */
  doneLabel: string;
  done: boolean;
  onToggle: () => void;
  markers: MapMarker[];
  doneMarkers: number;
  threads: ForumThread[];
  compareTarget: Entity | undefined;
  /** URL del comparador sobre la URL vigente (`?comparar=a,b`). */
  compareHref: string;
  /** Abre el comparador apilando una entrada de historial marcada (cierre con history.back). */
  onCompare: () => void;
  /** Ficha completa (misma URL canónica con `?vista=ficha`). */
  fichaHref: string;
  guest: boolean;
  /** Muestra el título (se omite en el BottomSheet, que ya lo lleva en su cabecera). */
  heading: boolean;
  /** Escritorio: el cuerpo hace scroll interno y las acciones quedan siempre visibles. */
  pinned: boolean;
}

export function EntityDetailPanel({
  entity,
  doneLabel,
  done,
  onToggle,
  markers,
  doneMarkers,
  threads,
  compareTarget,
  compareHref,
  onCompare,
  fichaHref,
  guest,
  heading,
  pinned,
}: EntityDetailPanelProps) {
  const stats = statsOf(entity);
  const pin = markers[0];
  const description = descriptionOf(entity);
  const subtitle = subtitleOf(entity);
  const extra: SpecRow[] = markers.length > 0 ? [{ key: 'pines', label: 'Puntos en el mapa', value: `${doneMarkers}/${markers.length}` }] : [];
  return (
    <div className={`flex flex-col gap-3 ${pinned ? 'h-full min-h-0' : ''}`}>
      <div className={`flex flex-col gap-3 ${pinned ? 'min-h-0 flex-1 overflow-y-auto pr-1' : ''}`}>
        <div>
          <span className="inline-block rounded-xl border border-vice-orange/50 bg-vice-orange/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-vice-gold">
            {entity.categoria}
          </span>
          {heading && <h2 className="mt-2 font-display text-2xl font-bold leading-tight">{entity.titulo}</h2>}
          {subtitle && <p className={`${heading ? '' : 'mt-2 '}text-sm text-vice-text/80`}>{subtitle}</p>}
          {entity.imagen_url && entity.capturaPropiaPendiente === true && <ProvisionalChip className="mt-2" />}
        </div>

        <DescriptionBlock paragraphs={description} />

        {stats.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-vice-text/90">Estadísticas</h3>
            {stats.map((s, i) => (
              <StatBar key={s.key} label={s.label} value={s.value} valueLabel={s.display} accent={STAT_ACCENTS[i % STAT_ACCENTS.length]} />
            ))}
          </div>
        )}

        <SpecSheet entity={entity} extra={extra} />

        {threads.length > 0 && (
          <ul aria-label="Hilos relacionados" className="flex flex-col text-sm">
            {threads.slice(0, 2).map((t) => (
              <li key={t.id}>
                <a
                  href={forumHref(guest, `/foro?hilo=${t.id}`)}
                  className="block min-h-11 rounded-lg px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  <span className="text-xs text-vice-orange">
                    {forumCategoryLabel(t.categoria)} · ▲ {t.upvotes_count}
                  </span>
                  <span className="block font-semibold">{t.titulo}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-3">
        <button
          type="button"
          aria-pressed={done}
          onClick={onToggle}
          className={`min-h-11 whitespace-nowrap rounded-xl px-4 font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
            done ? 'bg-vice-gold text-vice-ink' : 'bg-white/10 hover:bg-white/20'
          }`}
        >
          {done ? `${doneLabel} al 100% (quitar)` : `Marcar como ${doneLabel.toLowerCase()}`}
        </button>

        {pin ? (
          <PalmButton as="a" href={`/mapa?marker=${pin.id}`} fullWidth className="h-12! min-h-12! whitespace-nowrap text-base!">
            Ubicación en el mapa
          </PalmButton>
        ) : (
          <p className="flex h-12 items-center gap-2 text-sm text-vice-text/70">
            <MapPinIcon off />
            Ubicación en el mapa: sin pin todavía
          </p>
        )}

        <div className={`grid gap-2 ${compareTarget ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <a href={fichaHref} aria-label={`Ver ficha completa de ${entity.titulo}`} className={ACTION}>
            Ver ficha
          </a>
          {compareTarget && (
            <a
              href={compareHref}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onCompare();
              }}
              aria-label={`Comparar ${entity.titulo} con ${compareTarget.titulo}`}
              title={`Comparar con ${compareTarget.titulo}`}
              className={ACTION}
            >
              Comparar
            </a>
          )}
          <a
            href={forumHref(guest, `/foro?entity=${entity.id}`)}
            aria-label={`Discutir ${entity.titulo} en el foro (${threads.length} hilos)`}
            className={ACTION}
          >
            Discutir ({threads.length})
          </a>
        </div>
      </div>
    </div>
  );
}

/** Slug de la ficha para enlazar comparaciones. */
export const compareSlugs = (a: Entity, b: Entity): string => `${entitySlug(a)},${entitySlug(b)}`;
