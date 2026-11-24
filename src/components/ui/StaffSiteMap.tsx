// «Mapa de la PWA» (Resumen del panel de gestión, ADMIN+): panel de SOLO LECTURA que responde «¿dónde se ve X y
// desde dónde se gestiona?». Parte 1: cuadro módulo ↔ ruta pública ↔ sección del panel ↔ fichas/pines ↔ visibilidad,
// con datos reales de GET /api/admin/modules/overview. Parte 2: rutas públicas de la app (constante única
// PUBLIC_ROUTES; fuente: src/App.tsx, el dock, la cabecera y el pie de página).
import { Block, PublicLink, QueryState, ROW, SMALL_BTN } from './StaffKit';
import { goTo } from './StaffNav';
import { TIPO_LABEL, useModulesOverview, type ModuleOverview } from './StaffModules';

/** Rutas públicas de la app: qué muestra, de dónde sale el dato y cómo se llega (3 clics como máximo). */
const PUBLIC_ROUTES: ReadonlyArray<{ nombre: string; ruta: string; muestra: string; fuente: string; acceso: string }> = [
  {
    nombre: 'Inicio',
    ruta: '/',
    muestra: 'Portada con carrusel, accesos a las categorías y últimas noticias oficiales.',
    fuente: 'Contenido público → Portada (Hero), módulos activos y noticias oficiales.',
    acceso: 'Logotipo de la cabecera.',
  },
  {
    nombre: 'Hub',
    ruta: '/hub',
    muestra: 'Tu avance, rutas sugeridas y novedades.',
    fuente: 'Progreso de la persona, módulos activos y noticias oficiales.',
    acceso: 'Dock inferior → Hub.',
  },
  {
    nombre: 'Progreso',
    ruta: '/progreso',
    muestra: 'Porcentaje de avance por categoría.',
    fuente: 'Fichas y pines publicados, y lo que la persona marcó como hecho.',
    acceso: 'Botón «Mi avance» de la cabecera.',
  },
  {
    nombre: 'Mapa',
    ruta: '/mapa',
    muestra: 'Mapa de Leonida con filtros, pines y comentarios.',
    fuente: 'Contenido público → Mapa interactivo (pines) y fichas del módulo mapa.',
    acceso: 'Dock inferior → Mapa.',
  },
  {
    nombre: 'Catálogo',
    ruta: '/catalogo',
    muestra: 'Fichas por categoría (pestañas que aparecen solas con fichas), buscador y comparador.',
    fuente: 'Contenido público → Catálogo y Módulos.',
    acceso: 'Dock inferior → Catálogo.',
  },
  {
    nombre: 'Guías',
    ruta: '/guias',
    muestra: 'Guías paso a paso.',
    fuente: 'Editorial y automatización → Guías publicadas.',
    acceso: 'Cabecera (escritorio), pie de página y portada.',
  },
  {
    nombre: 'Noticias',
    ruta: '/noticias',
    muestra: 'Noticias oficiales de Rockstar Games y Take-Two.',
    fuente: 'Editorial y automatización → Noticias (worker de fuentes oficiales).',
    acceso: 'Cabecera (escritorio), pie de página y portada.',
  },
  {
    nombre: 'Foro',
    ruta: '/foro',
    muestra: 'Hilos de la comunidad por categoría.',
    fuente: 'Comunidad y moderación → Foro.',
    acceso: 'Dock inferior → Foro.',
  },
  {
    nombre: 'Aportar',
    ruta: '/aportar',
    muestra: 'Buzón para proponer lugares, fichas y correcciones (requiere cuenta).',
    fuente: 'Comunidad y moderación → Aportes (bandeja de revisión).',
    acceso: 'Dock inferior → Aportar.',
  },
  {
    nombre: 'Entrar',
    ruta: '/entrar',
    muestra: 'Acceso con Google, Discord, Apple o enlace al correo.',
    fuente: 'Servicio de cuentas (no se edita desde el panel).',
    acceso: 'Botón «Entrar» de la cabecera.',
  },
];

const SECTIONS: Readonly<Record<string, string>> = {
  'Contenido público': 'contenido',
  'Comunidad y moderación': 'comunidad',
  'Editorial y automatización': 'editorial',
};
const BLOCKS: Readonly<Record<string, string>> = {
  Catálogo: 'catalogo',
  'Mapa interactivo': 'mapa',
  Módulos: 'modulos',
  'Portada (Hero)': 'hero',
  Aportes: 'aportes',
  Foro: 'foro',
  Noticias: 'noticias',
  Pipeline: 'pipeline',
  'Guías publicadas': 'guias',
};

/** «Contenido público → Catálogo» → destino de `goTo`; null si el texto no corresponde a una pestaña conocida. */
function staffTarget(text: string | null, slug: string): (() => void) | null {
  if (!text) return null;
  const [sec, blk] = text.split(' → ');
  const section = sec ? SECTIONS[sec] : undefined;
  const block = blk ? BLOCKS[blk] : undefined;
  if (!section || !block) return null;
  return () => goTo(section, block, block === 'catalogo' ? { m: slug } : {});
}

/** Motivos por los que un módulo no se ve en la app pública. */
function hiddenReasons(m: ModuleOverview): string[] {
  const out: string[] = [];
  if (!m.activo) out.push('Inactivo');
  if (m.tipo === 'sin_pantalla') out.push('Sin pantalla pública');
  if (m.tipo === 'categoria' && m.fichas === 0) out.push('Sin fichas');
  return out.length > 0 ? out : ['Sin fichas'];
}

function Badge({ visible, reasons }: { visible: boolean; reasons: string[] }) {
  return visible ? (
    <span className="rounded-full bg-vice-cyan px-3 py-1 text-xs font-bold text-vice-ink">Visible</span>
  ) : (
    <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">Oculto: {reasons.join(' · ')}</span>
  );
}

export default function StaffSiteMap() {
  const q = useModulesOverview();
  const rows = (q.data ?? []).slice().sort((a, b) => a.orden - b.orden);
  return (
    <div className="flex flex-col gap-4">
      <Block
        id="blk-resumen-mapa-pwa"
        title="Mapa de la PWA"
        controls="nada: es una vista de solo lectura que muestra qué módulo alimenta qué pantalla y desde dónde se gestiona. Se actualiza con los datos reales."
      >
        <QueryState
          loading={q.isLoading}
          error={q.error}
          empty={!q.isLoading && !q.error && rows.length === 0}
          emptyText="No hay módulos."
          onRetry={() => void q.refetch()}
        />
        <ul className="flex flex-col gap-2">
          {rows.map((m) => {
            const go = staffTarget(m.staff_seccion, m.slug);
            return (
              <li key={m.id} className={`${ROW} items-start md:items-center`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {m.nombre} <span className="text-xs font-normal text-vice-text/70">· {TIPO_LABEL[m.tipo]}</span>
                  </p>
                  <dl className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0 text-xs text-vice-text/80">
                    <div className="flex items-center gap-1">
                      <dt className="text-vice-text/60">Dónde se ve:</dt>
                      <dd>
                        {m.ruta_publica ? (
                          <a
                            href={m.ruta_publica}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex min-h-11 items-center font-semibold text-vice-gold underline-offset-2 hover:underline"
                          >
                            {m.ruta_publica}
                          </a>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1">
                      <dt className="text-vice-text/60">Se gestiona en:</dt>
                      <dd>
                        {go ? (
                          <button
                            type="button"
                            onClick={go}
                            className="inline-flex min-h-11 items-center text-left font-semibold text-vice-gold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold"
                          >
                            {m.staff_seccion}
                          </button>
                        ) : (
                          (m.staff_seccion ?? '—')
                        )}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-vice-text/60">Contenido:</dt>
                      <dd className="font-semibold">
                        {m.fichas} ficha{m.fichas === 1 ? '' : 's'} · {m.pines} pin{m.pines === 1 ? '' : 'es'}
                      </dd>
                    </div>
                  </dl>
                </div>
                <Badge visible={m.visible_en_publico} reasons={hiddenReasons(m)} />
              </li>
            );
          })}
        </ul>
        <div className="mt-3">
          <button type="button" onClick={() => goTo('contenido', 'modulos')} className={SMALL_BTN}>
            Activar o desactivar módulos
          </button>
        </div>
      </Block>

      <Block
        id="blk-resumen-rutas"
        title="Rutas públicas de la app"
        controls="nada: es una guía de consulta con lo que muestra cada pantalla, de dónde salen sus datos y cómo se llega."
      >
        <ul className="flex flex-col gap-2">
          {PUBLIC_ROUTES.map((r) => (
            <li key={r.ruta} className="rounded-xl bg-white/5 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <strong className="font-semibold">{r.nombre}</strong>
                <PublicLink href={r.ruta}>{r.ruta}</PublicLink>
              </div>
              <dl className="mt-1 grid gap-x-4 gap-y-1 text-xs text-vice-text/80 md:grid-cols-3">
                <div>
                  <dt className="text-vice-text/60">Qué muestra</dt>
                  <dd>{r.muestra}</dd>
                </div>
                <div>
                  <dt className="text-vice-text/60">De dónde sale el dato</dt>
                  <dd>{r.fuente}</dd>
                </div>
                <div>
                  <dt className="text-vice-text/60">Cómo se llega</dt>
                  <dd>{r.acceso}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}
