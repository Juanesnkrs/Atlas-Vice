// Bloque «Identidades y roles» de Control Total (chunk `staff-ctl-*`, solo SUPER_ADMIN): listado, cambio de rol y
// revocación de sesiones. El servidor protege al último SUPER_ADMIN (409) y responde 404 uniforme a otros roles.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { Modal } from './Modal';
import { Block, BTN, errMsg, GHOST, INPUT, Pager, QueryState, ROLE_ORDER, ROW, SELECT, SMALL_BTN, staffFetch, toast, useDebounced, type Role } from './StaffKit';

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  rol: Role;
  created_at?: string;
  sessions_revoked_at: string | null;
}
interface UserPage {
  users: AdminUser[];
  total: number;
  page: number;
  pages: number;
}

export default function StaffIdentity() {
  const qc = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id ?? null);
  const [text, setText] = useState('');
  const term = useDebounced(text.trim(), 250);
  const [rol, setRol] = useState('');
  const [page, setPage] = useState(1);
  const [roleChange, setRoleChange] = useState<{ user: AdminUser; to: Role } | null>(null);
  const [revoking, setRevoking] = useState<AdminUser | null>(null);

  const users = useQuery({
    queryKey: ['staff', 'users', term, rol, page],
    placeholderData: keepPreviousData,
    queryFn: () => staffFetch<UserPage>(`/api/admin/users?limit=25&page=${page}${term ? `&q=${encodeURIComponent(term)}` : ''}${rol ? `&rol=${rol}` : ''}`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['staff', 'users'] });

  const setRole = useMutation({
    mutationFn: (v: { id: string; rol: Role }) => staffFetch(`/api/admin/users/${v.id}/role`, { method: 'PATCH', json: { rol: v.rol } }),
    onSuccess: (_d, v) => {
      toast.ok(`Rol actualizado a ${v.rol}.`);
      setRoleChange(null);
      refresh();
    },
    onError: (e) => {
      toast.err(`No se pudo cambiar el rol: ${errMsg(e)}`);
      setRoleChange(null);
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => staffFetch(`/api/admin/users/${id}/revoke-sessions`, { method: 'POST', json: {} }),
    onSuccess: () => {
      toast.ok('Sesiones revocadas: el usuario deberá iniciar sesión de nuevo.');
      setRevoking(null);
      refresh();
    },
    onError: (e) => {
      toast.err(`No se pudieron revocar las sesiones: ${errMsg(e)}`);
      setRevoking(null);
    },
  });

  const rows = users.data?.users ?? [];
  return (
    <Block
      id="blk-users"
      title="Identidades y roles"
      controls="quién puede moderar, administrar o gestionar el sitio. Los usuarios públicos no ven su rol; el servidor decide cada permiso."
    >
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="Buscar usuario por nombre o correo"
          placeholder="Nombre o correo…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPage(1);
          }}
          className={`${INPUT} min-w-0 flex-1`}
        />
        <select
          aria-label="Filtrar por rol"
          value={rol}
          onChange={(e) => {
            setRol(e.target.value);
            setPage(1);
          }}
          className={`${SELECT} sm:w-48`}
        >
          <option value="">Todos los roles</option>
          {ROLE_ORDER.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <QueryState
        loading={users.isLoading}
        error={users.error}
        empty={!users.isLoading && !users.error && rows.length === 0}
        emptyText="Sin resultados."
        onRetry={() => void users.refetch()}
      />
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((u) => (
          <li key={u.id} className={ROW}>
            <span className="min-w-0">
              <span className="block truncate font-semibold">
                {u.username}
                {u.id === meId ? ' (tú)' : ''}
              </span>
              <span className="block truncate text-xs text-vice-text/70">
                {u.email ?? 'sin correo'}
                {u.sessions_revoked_at ? ` · sesiones revocadas ${new Date(u.sessions_revoked_at).toLocaleString('es')}` : ''}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Rol de ${u.username}`}
                value={u.rol}
                disabled={setRole.isPending}
                onChange={(e) => e.target.value !== u.rol && setRoleChange({ user: u, to: e.target.value })}
                className={`${SELECT} w-44`}
              >
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setRevoking(u)} className={SMALL_BTN} aria-label={`Revocar sesiones de ${u.username}`}>
                Revocar sesiones
              </button>
            </span>
          </li>
        ))}
      </ul>
      {users.data && users.data.total > 0 && <Pager page={users.data.page} pages={users.data.pages} total={users.data.total} onPage={setPage} />}

      <Modal
        open={roleChange !== null}
        onClose={() => setRoleChange(null)}
        title="Confirmar cambio de rol"
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setRoleChange(null)} className={`${GHOST} flex-1`}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={setRole.isPending}
              onClick={() => roleChange && setRole.mutate({ id: roleChange.user.id, rol: roleChange.to })}
              className={`${BTN} flex-1 bg-vice-accent font-bold text-vice-ink`}
            >
              {setRole.isPending ? 'Guardando…' : 'Cambiar rol'}
            </button>
          </div>
        }
      >
        <p className="text-sm">
          {roleChange?.user.username}: {roleChange?.user.rol} → {roleChange?.to}.
          {roleChange?.user.id === meId ? ' Es tu propia cuenta: si baja de rol perderás el acceso a este panel.' : ''}
        </p>
      </Modal>

      <Modal
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Revocar sesiones"
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setRevoking(null)} className={`${GHOST} flex-1`}>
              Cancelar
            </button>
            <button type="button" disabled={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id)} className={`${BTN} flex-1 bg-vice-rose font-bold text-vice-ink`}>
              {revoke.isPending ? 'Revocando…' : 'Revocar'}
            </button>
          </div>
        }
      >
        <p className="text-sm">
          Se cerrará la sesión de «{revoking?.username}» en todos sus dispositivos.
          {revoking?.id === meId ? ' Es tu propia cuenta: tendrás que volver a entrar.' : ''}
        </p>
      </Modal>
    </Block>
  );
}
