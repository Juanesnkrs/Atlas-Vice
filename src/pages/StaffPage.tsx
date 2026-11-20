// Módulo privado de gestión (ruta oculta). App.tsx solo lo importa tras confirmar un rol de gestión leído de la
// sesión; los datos los protege el servidor. Las secciones reflejan la app pública (Contenido, Comunidad, Editorial)
// más Control Total; «control» se importa en un chunk aparte y solo se pide cuando el rol confirmado es el máximo.
// Sin rutas propias: las secciones son pestañas internas.
import { lazy, Suspense, useState } from 'react';
import StaffCommunity from '../components/ui/StaffCommunity';
import StaffContent from '../components/ui/StaffContent';
import StaffEditorial from '../components/ui/StaffEditorial';
import { BTN, PAGE_PAD, rankOf, ToastHost } from '../components/ui/StaffKit';
import { useAuthStore } from '../store/useAuthStore';
import { usePageMeta } from '../store/useRouteStore';

const StaffControl = lazy(() => import('../components/ui/StaffControl'));

type TabId = 'contenido' | 'comunidad' | 'editorial' | 'control';

export default function StaffPage() {
  usePageMeta({ title: 'Gestión', robots: 'noindex,nofollow' });
  const role = useAuthStore((s) => s.role);
  const rank = rankOf(role);
  const [tab, setTab] = useState<TabId>(rank >= 2 ? 'contenido' : 'comunidad');

  const tabs: Array<{ id: TabId; label: string }> = [];
  if (rank >= 2) tabs.push({ id: 'contenido', label: 'Contenido público' });
  if (rank >= 1) tabs.push({ id: 'comunidad', label: 'Comunidad y moderación' });
  if (rank >= 2) tabs.push({ id: 'editorial', label: 'Editorial y automatización' });
  if (rank >= 3) tabs.push({ id: 'control', label: 'Control Total' });
  const current = tabs.find((t) => t.id === tab)?.id ?? tabs[0]?.id;
  if (!current) return null;

  return (
    <div className={`mx-auto w-full max-w-6xl px-4 pt-2 md:px-8 ${PAGE_PAD}`}>
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
            onClick={() => setTab(t.id)}
            className={`${BTN} ${current === t.id ? 'bg-vice-accent text-vice-ink' : 'glass hover:bg-white/10'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`} className="mt-4">
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
    </div>
  );
}
