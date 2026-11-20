// Sección «Control Total» (chunk `staff-ctl-*`, solo SUPER_ADMIN): configuración global, monetización, identidades,
// auditoría y salud, cada una como bloque de primer nivel (`?b=`). Solo se importa dinámicamente desde StaffPage tras
// confirmar el rol correspondiente; el servidor responde 404 uniforme a cualquier otro rol (RBAC antes que Zod).
import StaffAudit, { HealthPanel } from './StaffAudit';
import StaffConfig from './StaffConfig';
import StaffIdentity from './StaffIdentity';
import { SubTabs } from './StaffKit';
import StaffMonetization from './StaffMonetization';
import { useBlockTab } from './StaffNav';

type Sub = 'config' | 'monetizacion' | 'identidades' | 'auditoria' | 'salud';
const SUBS: ReadonlyArray<{ id: Sub; label: string }> = [
  { id: 'config', label: 'Configuración' },
  { id: 'monetizacion', label: 'Monetización' },
  { id: 'identidades', label: 'Identidades y roles' },
  { id: 'auditoria', label: 'Auditoría' },
  { id: 'salud', label: 'Salud' },
];

export default function StaffControl() {
  const [sub, setSub] = useBlockTab('control', SUBS);
  return (
    <div className="flex flex-col gap-4">
      <SubTabs label="Control Total" tabs={SUBS} value={sub} onChange={setSub} />
      {sub === 'config' && <StaffConfig />}
      {sub === 'monetizacion' && <StaffMonetization />}
      {sub === 'identidades' && <StaffIdentity />}
      {sub === 'auditoria' && <StaffAudit />}
      {sub === 'salud' && <HealthPanel />}
    </div>
  );
}
