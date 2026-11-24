// Sección «Comunidad y moderación» del panel de gestión (MODERATOR+): bandeja de aportes y moderación del foro.
// El servidor aplica RBAC (404 uniforme sin rol) y valida con Zod; esta UI es cosmética.
import StaffForum from './StaffForum';
import { SubTabs } from './StaffKit';
import { useBlockTab } from './StaffNav';
import StaffModeration from './StaffModeration';

type Sub = 'aportes' | 'foro';
const SUBS: ReadonlyArray<{ id: Sub; label: string }> = [
  { id: 'aportes', label: 'Aportes' },
  { id: 'foro', label: 'Foro' },
];

export default function StaffCommunity({ visible }: { visible?: ReadonlyArray<Sub> } = {}) {
  const tabs = visible ? SUBS.filter((t) => visible.includes(t.id)) : SUBS;
  const [sub, setSub] = useBlockTab('comunidad', tabs);
  return (
    <div className="flex flex-col gap-4">
      {!visible && <SubTabs label="Comunidad y moderación" tabs={SUBS} value={sub} onChange={setSub} />}
      {sub === 'aportes' ? <StaffModeration /> : <StaffForum />}
    </div>
  );
}
