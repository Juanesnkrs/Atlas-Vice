// Módulo privado de gestión (ruta oculta). App.tsx solo lo importa tras confirmar un rol de gestión leído de la
// sesión; los datos los protege el servidor. Vista principal de la v1: solo tres tareas diarias —Aportes (bandeja),
// Imágenes (estudio) y Catálogo (fichas)— más «Control Total», que agrupa el resto (Resumen, Mapa interactivo, Módulos,
// Portada, Foro, Noticias y pipeline, Configuración, Monetización, Identidades, Auditoría y Salud). `/_staff` es una
// ruta única: sección, bloque y filtros viajan en la query (`?s=&b=&q=&m=&p=`) y los enlaces internos existentes
// (`goTo('contenido', 'modulos')`, etc.) siguen funcionando: la pestaña principal se deduce de esa query.
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useRef } from 'react';
import StaffCommunity from '../components/ui/StaffCommunity';
import StaffContent from '../components/ui/StaffContent';
import StaffEditorial from '../components/ui/StaffEditorial';
import { BTN, PAGE_PAD, rankOf, staffFetch, SubTabs, ToastHost } from '../components/ui/StaffKit';
import { goTo, useStaffLocation, useStaffShortcuts } from '../components/ui/StaffNav';
import StaffOverview from '../components/ui/StaffOverview';
import StaffSession from '../components/ui/StaffSession';
import { useAuthStore } from '../store/useAuthStore';
import { usePageMeta } from '../store/useRouteStore';

const StaffControl = lazy(() => import('../components/ui/StaffControl'));

type PrimaryId = 'aportes' | 'imagenes' | 'catalogo' | 'control';
type ControlSub = 'config' | 'monetizacion' | 'identidades' | 'auditoria' | 'salud';

/** Áreas agrupadas en «Control Total». `section`/`block` son los de la URL de siempre. */
interface Area {
  id: string;
  label: string;
  section: string;
  block?: string;
  minRank: number;
}
const AREAS: ReadonlyArray<Area> = [
  { id: 'resumen', label: 'Resumen', section: 'resumen', minRank: 1 },
  { id: 'mapa', label: 'Mapa interactivo', section: 'contenido', block: 'mapa', minRank: 2 },
  { id: 'modulos', label: 'Módulos', section: 'contenido', block: 'modulos', minRank: 2 },
  { id: 'hero', label: 'Portada (Hero)', section: 'contenido', block: 'hero', minRank: 2 },
  { id: 'editorial', label: 'Noticias y pipeline', section: 'editorial', minRank: 2 },
  { id: 'foro', label: 'Foro', section: 'comunidad', block: 'foro', minRank: 1 },
  { id: 'config', label: 'Configuración', section: 'control', block: 'config', minRank: 3 },
  { id: 'monetizacion', label: 'Monetización', section: 'control', block: 'monetizacion', minRank: 3 },
  { id: 'identidades', label: 'Identidades y roles', section: 'control', block: 'identidades', minRank: 3 },
  { id: 'auditoria', label: 'Auditoría', section: 'control', block: 'auditoria', minRank: 3 },
  { id: 'salud', label: 'Salud', section: 'control', block: 'salud', minRank: 3 },
];

/** Pestaña principal que corresponde a la URL (`?s=&b=`). Sin sección: Aportes. */
function primaryOf(section: string | null, block: string | null): PrimaryId {
  if (section === null) return 'aportes';
  if (section === 'comunidad') return block === 'foro' ? 'control' : 'aportes';
  if (section === 'contenido') {
    if (block === 'imagenes') return 'imagenes';
    if (block === 'catalogo' || block === null) return 'catalogo';
    return 'control';
  }
  return 'control';
}

/** Área de «Control Total» que corresponde a la URL; por defecto, el Resumen. */
function areaOf(section: string | null, block: string | null, rank: number): Area {
  const visible = AREAS.filter((a) => a.minRank <= rank);
  const found = visible.find((a) => a.section === section && (a.block === undefined || a.block === block));
  if (found) return found;
  // `?s=control` sin bloque válido → Configuración; `?s=contenido&b=` raro → primera área de contenido.
  const bySection = visible.find((a) => a.section === section);
  return bySection ?? visible[0]!;
}

/** Insignia de aportes pendientes: consulta ligera cada 60 s (se pausa con la pestaña oculta). */
function usePendingCount(): number {
  const q = useQuery({
    queryKey: ['staff', 'pending-count'],
    queryFn: () => staffFetch<{ pending: number }>('/api/admin/submissions/pending-count'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  return q.data?.pending ?? 0;
}

export default function StaffPage() {
  usePageMeta({ title: 'Gestión', robots: 'noindex,nofollow' });
  const role = useAuthStore((s) => s.role);
  const rank = rankOf(role);
  const { section, block } = useStaffLocation();
  const root = useRef<HTMLDivElement>(null);
  useStaffShortcuts(root);
  const pending = usePendingCount();

  if (rank < 1) return null;

  const tabs: Array<{ id: PrimaryId; label: string }> = [{ id: 'aportes', label: 'Aportes' }];
  if (rank >= 2) tabs.push({ id: 'imagenes', label: 'Imágenes' }, { id: 'catalogo', label: 'Catálogo' });
  tabs.push({ id: 'control', label: 'Control Total' });

  const wanted = primaryOf(section, block);
  const current: PrimaryId = tabs.some((t) => t.id === wanted) ? wanted : 'aportes';
  const area = areaOf(section, block, rank);
  const areas = AREAS.filter((a) => a.minRank <= rank).map((a) => ({ id: a.id, label: a.label }));

  const openPrimary = (id: PrimaryId): void => {
    if (id === 'aportes') goTo('comunidad', 'aportes');
    else if (id === 'imagenes') goTo('contenido', 'imagenes');
    else if (id === 'catalogo') goTo('contenido', 'catalogo');
    else goTo('resumen');
  };
  const openArea = (id: string): void => {
    const a = AREAS.find((x) => x.id === id);
    if (a) goTo(a.section, a.block);
  };

  return (
    <div ref={root} className={`mx-auto w-full max-w-6xl px-4 pt-2 md:px-8 ${PAGE_PAD}`}>
      <h1 className="font-display text-3xl font-bold">Gestión</h1>
      <div role="tablist" aria-label="Secciones" className="mt-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={current === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => openPrimary(t.id)}
            className={`${BTN} gap-2 ${current === t.id ? 'bg-vice-accent text-vice-ink' : 'glass hover:bg-white/10'}`}
          >
            {t.label}
            {t.id === 'aportes' && pending > 0 && (
              <span aria-label={`${pending} aportes pendientes`} className="rounded-full bg-vice-gold px-2 py-0.5 text-xs font-bold text-vice-ink">
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`} className="mt-4">
        {current === 'aportes' && <StaffCommunity visible={['aportes']} />}
        {current === 'imagenes' && <StaffContent visible={['imagenes']} />}
        {current === 'catalogo' && <StaffContent visible={['catalogo']} />}
        {current === 'control' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-vice-text/80">
              Herramientas menos frecuentes: resumen, mapa, módulos, portada, noticias, foro y ajustes globales.
            </p>
            <SubTabs label="Control Total" tabs={areas} value={area.id} onChange={openArea} />
            {area.id === 'resumen' && <StaffOverview canAudit={rank >= 3} canContent={rank >= 2} />}
            {(area.id === 'mapa' || area.id === 'modulos' || area.id === 'hero') && <StaffContent visible={['mapa', 'modulos', 'hero']} />}
            {area.id === 'editorial' && <StaffEditorial />}
            {area.id === 'foro' && <StaffCommunity visible={['foro']} />}
            {rank >= 3 && ['config', 'monetizacion', 'identidades', 'auditoria', 'salud'].includes(area.id) && (
              <Suspense fallback={<div className="min-h-[40dvh]" role="status" aria-busy="true" />}>
                <StaffControl visible={[area.id as ControlSub]} />
              </Suspense>
            )}
          </div>
        )}
      </div>
      <ToastHost />
      <StaffSession />
    </div>
  );
}
