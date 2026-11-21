// Bloque «Configuración global» de Control Total (chunk `staff-ctl-*`, solo SUPER_ADMIN) y el patrón compartido de los
// formularios en línea de configuración (`useConfigForm` + `SaveBar`), que reutiliza también Monetización.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { NEWS_SOURCES, type PublicConfig } from '../../data/seed';
import { useStaffStore } from '../../store/useStaffStore';
import type { MonetizationConfig } from '../../types/database';
import { Block, BTN, errMsg, GHOST, INPUT, PRIMARY, QueryState, staffFetch, toast } from './StaffKit';

export type ConfigDTO = PublicConfig & { monetization: MonetizationConfig };

const ALL_PROVIDERS = ['google', 'discord', 'apple', 'magic-link'] as const;
const FLAG_RE = /^[a-zA-Z0-9_.-]{1,40}$/;
const SAVE_NOTE = 'Aviso: los visitantes ven el cambio en cuanto su navegador revalida (hasta 30 s).';

/**
 * Formulario en línea sobre `/api/config`: borrador local (se descarta al cambiar de pestaña), comparación con lo
 * guardado para detectar cambios sin guardar y mutación PATCH. Mientras haya cambios se marca trabajo abierto, de modo
 * que una sesión caducada muestre el aviso de reautenticación sin desmontar el formulario. Nada se persiste en el cliente.
 */
export function useConfigForm<T>({
  draftKey,
  read,
  toBody,
  okText,
}: {
  draftKey: string;
  read: (c: ConfigDTO) => T;
  toBody: (v: T) => Record<string, unknown>;
  okText: string;
}) {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ['staff', 'config'],
    // Config vigente leída sin caché pública (el panel siempre ve lo último guardado).
    queryFn: () => staffFetch<ConfigDTO>('/api/config', { cache: 'no-cache' }),
  });
  const [draft, setDraft] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const server = cfg.data ? read(cfg.data) : null;
  const value = draft ?? server;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(server);

  useEffect(() => {
    if (dirty) useStaffStore.getState().markForm(draftKey, true);
    return () => useStaffStore.getState().unmarkForm(draftKey);
  }, [dirty, draftKey]);

  const save = useMutation({
    mutationFn: (v: T) => staffFetch('/api/admin/config', { method: 'PATCH', json: toBody(v) }),
    onSuccess: () => {
      toast.ok(`${okText} ${SAVE_NOTE}`);
      setDraft(null);
      for (const key of ['staff', 'config']) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => {
      setErr(errMsg(e));
      toast.err(`No se pudo guardar: ${errMsg(e)}`);
    },
  });

  return {
    cfg,
    value,
    dirty,
    err,
    edit: setDraft,
    discard: () => {
      setDraft(null);
      setErr(null);
    },
    /** Muestra un error de validación local (en pantalla y como aviso). */
    fail: (text: string) => {
      setErr(text);
      toast.err(text);
    },
    submit: (v: T) => {
      setErr(null);
      save.mutate(v);
    },
    saving: save.isPending,
    loading: <QueryState loading={cfg.isLoading} error={cfg.error} empty={false} emptyText="" onRetry={() => void cfg.refetch()} />,
  };
}

/** Botones Guardar/Descartar con el aviso «cambios sin guardar» (o el error) justo debajo. */
export function SaveBar({
  label,
  saving,
  dirty,
  err,
  onDiscard,
}: {
  label: string;
  saving: boolean;
  dirty: boolean;
  err: string | null;
  onDiscard: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving || !dirty} className={`${PRIMARY} flex-1`}>
          {saving ? 'Guardando…' : label}
        </button>
        <button type="button" disabled={!dirty || saving} onClick={onDiscard} className={GHOST}>
          Descartar cambios
        </button>
      </div>
      <div aria-live="polite" className="min-h-[1.25rem] text-sm">
        {err && (
          <p role="alert" className="text-vice-gold">
            {err}
          </p>
        )}
        {dirty && <p className="font-semibold text-vice-gold">Hay cambios sin guardar.</p>}
      </div>
    </>
  );
}

type ConfigDraft = Pick<PublicConfig, 'maintenance_mode' | 'announcement' | 'feature_flags' | 'enabled_auth_providers' | 'social_links'>;
const pick = (c: ConfigDTO): ConfigDraft => ({
  maintenance_mode: c.maintenance_mode,
  announcement: c.announcement,
  feature_flags: c.feature_flags,
  enabled_auth_providers: c.enabled_auth_providers,
  social_links: c.social_links,
});

export default function StaffConfig() {
  // Solo los campos de este formulario: monetización tiene su propio bloque.
  const form = useConfigForm<ConfigDraft>({ draftKey: 'config:global', read: pick, toBody: (v) => ({ ...v }), okText: 'Configuración guardada.' });
  const [newFlag, setNewFlag] = useState('');

  const d = form.value;
  if (!d) return form.loading;
  const edit = (patch: Partial<ConfigDraft>) => form.edit({ ...d, ...patch });

  const toggleProvider = (p: (typeof ALL_PROVIDERS)[number]) => {
    const has = d.enabled_auth_providers.includes(p);
    edit({ enabled_auth_providers: has ? d.enabled_auth_providers.filter((x) => x !== p) : [...d.enabled_auth_providers, p] });
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    const links = d.social_links.filter((l) => l.platform.trim() || l.url.trim());
    if (d.enabled_auth_providers.length === 0) return form.fail('Debe quedar al menos un proveedor de acceso.');
    if (links.some((l) => !l.platform.trim() || !/^https?:\/\//i.test(l.url.trim()))) {
      return form.fail('Cada red social necesita plataforma y una URL http(s).');
    }
    const badFlag = Object.keys(d.feature_flags).find((k) => !FLAG_RE.test(k));
    if (badFlag) return form.fail(`Nombre de flag inválido: «${badFlag}».`);
    form.submit({
      ...d,
      announcement: d.announcement?.trim() ? d.announcement.trim() : null,
      social_links: links.map((l) => ({ platform: l.platform.trim(), url: l.url.trim() })),
    });
  };

  return (
    <Block
      id="blk-config"
      title="Configuración global"
      controls="el anuncio del Hub, el aviso de mantenimiento, los métodos de acceso de /entrar, los interruptores del sitio y las redes sociales del pie de página."
      href="/hub"
      linkLabel="Abrir el Hub"
    >
      <form onSubmit={onSave} className="flex flex-col gap-4">
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={d.maintenance_mode} onChange={(e) => edit({ maintenance_mode: e.target.checked })} className="h-5 w-5 accent-[#E1307E]" />
          <span>Modo mantenimiento (muestra un aviso en la pantalla de acceso)</span>
        </label>

        <div>
          <label htmlFor="cfg-ann" className="mb-1 block text-sm font-medium">
            Anuncio global en el Hub ({(d.announcement ?? '').length}/500)
          </label>
          <textarea id="cfg-ann" rows={2} maxLength={500} value={d.announcement ?? ''} onChange={(e) => edit({ announcement: e.target.value })} className={`${INPUT} py-2`} />
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Métodos de acceso visibles (mínimo 1, máximo 4)</legend>
          <div className="flex flex-wrap gap-3">
            {ALL_PROVIDERS.map((p) => (
              <label key={p} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={d.enabled_auth_providers.includes(p)} onChange={() => toggleProvider(p)} className="h-5 w-5 accent-[#E1307E]" />
                {p}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Interruptores del sitio (feature flags)</legend>
          {Object.keys(d.feature_flags).length === 0 && <p className="text-sm text-vice-text/70">Sin flags definidas.</p>}
          <ul className="flex flex-col gap-1">
            {Object.entries(d.feature_flags).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3">
                <label className="flex min-h-11 flex-1 items-center gap-3">
                  <input type="checkbox" checked={v} onChange={(e) => edit({ feature_flags: { ...d.feature_flags, [k]: e.target.checked } })} className="h-5 w-5 accent-[#E1307E]" />
                  {k}
                </label>
                <button
                  type="button"
                  aria-label={`Quitar flag ${k}`}
                  onClick={() => {
                    const { [k]: _omit, ...rest } = d.feature_flags;
                    edit({ feature_flags: rest });
                  }}
                  className={`${BTN} px-3 text-vice-gold`}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input aria-label="Nueva feature flag" value={newFlag} onChange={(e) => setNewFlag(e.target.value)} placeholder="nombre_de_flag" maxLength={40} className={INPUT} />
            <button
              type="button"
              onClick={() => {
                const k = newFlag.trim();
                if (!k) return;
                if (!FLAG_RE.test(k)) return toast.err('Nombre de flag inválido: letras, números, guion, guion bajo o punto (máx. 40).');
                if (k in d.feature_flags) return toast.err('Esa flag ya existe.');
                edit({ feature_flags: { ...d.feature_flags, [k]: false } });
                setNewFlag('');
              }}
              className={GHOST}
            >
              Añadir
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Redes sociales del pie de página (máx. 12)</legend>
          <ul className="flex flex-col gap-2">
            {d.social_links.map((l, i) => (
              <li key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                <input
                  aria-label={`Plataforma ${i + 1}`}
                  value={l.platform}
                  maxLength={30}
                  onChange={(e) => edit({ social_links: d.social_links.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)) })}
                  placeholder="discord"
                  className={INPUT}
                />
                <input
                  aria-label={`URL ${i + 1}`}
                  value={l.url}
                  onChange={(e) => edit({ social_links: d.social_links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
                  placeholder="https://…"
                  className={INPUT}
                />
                <button type="button" aria-label={`Quitar red ${i + 1}`} onClick={() => edit({ social_links: d.social_links.filter((_, j) => j !== i) })} className={`${BTN} px-3 text-vice-gold`}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
          {d.social_links.length < 12 && (
            <button type="button" onClick={() => edit({ social_links: [...d.social_links, { platform: '', url: '' }] })} className={`${GHOST} mt-2`}>
              Añadir red social
            </button>
          )}
        </fieldset>

        <SaveBar label="Guardar configuración" saving={form.saving} dirty={form.dirty} err={form.err} onDiscard={form.discard} />
        <p className="text-xs text-vice-text/60">
          Fuentes de noticias oficiales vigentes (fijas en el servidor): {NEWS_SOURCES.filter((s) => s.value !== 'all').map((s) => s.label).join(', ')}. El nombre del sitio es fijo
          (LeonidApp): no existe un campo aprobado para cambiarlo.
        </p>
      </form>
    </Block>
  );
}
