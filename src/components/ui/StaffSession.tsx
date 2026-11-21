// Aviso «Sesión caducada» del panel de gestión: aparece sobre el panel (sin desmontarlo ni cerrar el formulario
// abierto) cuando la API devuelve 401 o el 404 uniforme con trabajo abierto. Permite reautenticar en otra pestaña y
// reintentar sin perder el estado; solo expulsa tras una confirmación explícita.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch, useAuthStore } from '../../store/useAuthStore';
import { useStaffStore } from '../../store/useStaffStore';
import { Modal } from './Modal';
import { BTN, GHOST, PRIMARY, toast } from './StaffKit';

export default function StaffSession() {
  const expired = useStaffStore((s) => s.sessionExpired);
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const retry = async () => {
    setChecking(true);
    setNote(null);
    try {
      const { user } = await apiFetch<{ user: { rol: string } | null }>('/api/auth/me', { cache: 'no-store' });
      if (user && user.rol !== 'USER') {
        useStaffStore.getState().setSessionExpired(false);
        void useAuthStore.getState().refreshProfile();
        void qc.invalidateQueries();
        toast.ok('Sesión recuperada. Vuelve a pulsar Guardar para reintentar.');
      } else if (user) {
        setNote('La sesión abierta no tiene permisos de gestión.');
      } else {
        setNote('Todavía no hay una sesión abierta. Inicia sesión en otra pestaña y vuelve a intentarlo.');
      }
    } catch {
      setNote('No se pudo comprobar la sesión: revisa la conexión y reintenta.');
    } finally {
      setChecking(false);
    }
  };

  const leave = () => {
    useStaffStore.getState().setSessionExpired(false);
    useAuthStore.getState().dropElevatedRole();
  };

  if (!expired) return null;
  return (
    <Modal open onClose={() => undefined} title="Sesión caducada" dismissOnBackdrop={false} closeLabel="Mantener abierto">
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Tu sesión ya no es válida, pero el formulario que tenías abierto <strong>sigue intacto</strong>. Inicia sesión de nuevo en otra
          pestaña y pulsa «Reintentar»: podrás guardar sin perder lo escrito.
        </p>
        {note && (
          <p role="alert" className="text-vice-gold">
            {note}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <button type="button" disabled={checking} onClick={() => void retry()} className={PRIMARY}>
            {checking ? 'Comprobando…' : 'Reintentar'}
          </button>
          {confirmLeave ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmLeave(false)} className={`${GHOST} flex-1`}>
                Volver
              </button>
              <button type="button" onClick={leave} className={`${BTN} flex-1 bg-vice-rose font-bold text-vice-ink`}>
                Salir y perder el trabajo
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmLeave(true)} className={GHOST}>
              Salir del panel…
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
