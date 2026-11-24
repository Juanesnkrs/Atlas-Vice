// Módulo privado de gestión (ruta oculta). App.tsx solo lo importa tras confirmar un rol de gestión leído de la
// sesión; los datos los protege el servidor. Entrada: «Resumen operativo»; después las secciones que reflejan la app
// pública (Contenido, Comunidad, Editorial) más Control Total, que se importa en un chunk aparte y solo se pide cuando
// el rol confirmado es el máximo. `/_staff` es una ruta única: sección, bloque y filtros viajan en la query
// (`?s=&b=&q=&m=&p=`), de modo que sobreviven a una recarga y se pueden compartir.
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useRef } from 'react';
import StaffCommunity from '../components/ui/StaffCommunity';
import StaffContent from '../components/ui/StaffContent';
import StaffEditorial from '../components/ui/StaffEditorial';
import { BTN, PAGE_PAD, rankOf, staffFetch, ToastHost } from '../components/ui/StaffKit';
import { goTo, useStaffLocation, useStaffShortcuts } from '../components/ui/StaffNav';
import StaffOverview from '../components/ui/StaffOverview';
import StaffSession from '../components/ui/StaffSession';
import { useAuthStore } from '../store/useAuthStore';
import { usePageMeta } from '../store/useRouteStore';

const StaffControl = lazy(() => import('../components/ui/StaffControl'));

type TabId = 'resumen' | 'contenido' | 'comunidad' | 'editorial' | 'control';

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
  const { section } = useStaffLocation();
  const root = useRef<HTMLDivElement>(null);
  useStaffShortcuts(root);
  const pending = usePendingCount();

  const tabs: Array<{ id: TabId; label: string }> = [{ id: 'resumen', label: 'Resumen' }];
  if (rank >= 2) tabs.push({ id: 'contenido', label: 'Contenido público' });
  if (rank >= 1) tabs.push({ id: 'comunidad', label: 'Comunidad y moderación' });
  if (rank >= 2) tabs.push({ id: 'editorial', label: 'Editorial y automatización' });
  if (rank >= 3) tabs.push({ id: 'control', label: 'Control Total' });
  const current = tabs.find((t) => t.id === section)?.id ?? 'resumen';
  if (rank < 1) return null;

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
            onClick={() => goTo(t.id)}
            className={`${BTN} gap-2 ${current === t.id ? 'bg-vice-accent text-vice-ink' : 'glass hover:bg-white/10'}`}
          >
            {t.label}
            {t.id === 'comunidad' && pending > 0 && (
              <span aria-label={`${pending} aportes pendientes`} className="rounded-full bg-vice-gold px-2 py-0.5 text-xs font-bold text-vice-ink">
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`} className="mt-4">
        {current === 'resumen' && <StaffOverview canAudit={rank >= 3} canContent={rank >= 2} />}
        {current === 'contenido' && <StaffContent />}
        {current === 'comunidad' && <StaffCommunity />}
        {current === 'editorial' && <StaffEditorial />}
        {current === 'control' && (
          <Suspense fallback={<div className="min-h-[40dvh]" role="status" aria-busy="true" />}>
            <StaffControl />
          </Suspense>
        )}
      </div>
      <ToastHost />
      <StaffSession />
    </div>
  );
}
