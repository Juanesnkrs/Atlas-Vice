// P06 - Buzón de la comunidad: envío de sugerencias (marcador, ficha o corrección) y «Mis aportes».
// Vista 100 % pública (requiere cuenta para enviar). No incluye herramientas de gestión.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useWorldData } from '../data/seed';
import { apiFetch, isApiConfigured, useAuthStore } from '../store/useAuthStore';

type SubStatus = 'pending' | 'approved' | 'rejected';
interface SubmissionDTO {
  id: string;
  type: string;
  title: string;
  status: SubStatus;
  createdAt?: string;
}

const TIPOS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'marker', label: 'Marcador / ubicación' },
  { value: 'entity', label: 'Ficha (arma, vehículo, coleccionable, guía)' },
  { value: 'correction', label: 'Corrección de un dato' },
];
const STATUS_LABEL: Record<SubStatus, string> = { pending: 'Recibido', approved: 'Publicado', rejected: 'No publicado' };
const STATUS_TONE: Record<SubStatus, string> = {
  pending: 'bg-vice-gold text-vice-ink',
  approved: 'bg-vice-cyan text-vice-ink',
  rejected: 'bg-white/20 text-vice-text',
};
// Solo módulos que tienen página propia.
const MODULES_WITH_PAGE: ReadonlySet<string> = new Set(['armas', 'vehiculos', 'coleccionables', 'guias']);

const INPUT =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';
const SELECT = `${INPUT} bg-[#2e1a47]`;
const PRIMARY =
  'flex min-h-11 items-center justify-center rounded-xl bg-vice-accent px-4 font-bold text-vice-ink focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-50';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Error desconocido');

function StatusBadge({ status }: { status: SubStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
  );
}

function Buzon() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { data: world } = useWorldData();
  const [tipo, setTipo] = useState('marker');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const online = isApiConfigured;

  const mine = useQuery({
    queryKey: ['submissions', 'mine', user?.id],
    enabled: online && user !== null,
    queryFn: () => apiFetch<SubmissionDTO[]>('/api/submissions/mine'),
  });

  const send = useMutation({
    mutationFn: (body: unknown) => apiFetch<SubmissionDTO>('/api/submissions', { method: 'POST', json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['submissions'] }),
  });

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const get = (k: string): string => String(fd.get(k) ?? '').trim();
    const title = get('title');
    const descripcion = get('descripcion');
    if (title.length < 3 || descripcion.length < 10) {
      setMsg({ ok: false, text: 'Indica un título (3+) y una descripción (10+ caracteres).' });
      return;
    }
    const media = get('media_url');
    if (media && !/^https?:\/\//i.test(media)) return setMsg({ ok: false, text: 'La imagen debe ser una URL http(s).' });
    // El payload debe cumplir los esquemas de promoción del servidor (marker, entity o correction).
    let payload: Record<string, unknown>;
    let coords: { x: number; y: number } | null = null;
    if (tipo === 'marker') {
      const x = Number(get('coord_x'));
      const y = Number(get('coord_y'));
      if (!get('region') || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 700) {
        return setMsg({ ok: false, text: 'Indica región y coordenadas válidas (X 0-1000, Y 0-700).' });
      }
      payload = { titulo: title, region: get('region'), descripcion, ...(media ? { media_url: media } : {}) };
      coords = { x, y };
    } else if (tipo === 'entity') {
      if (!get('categoria')) return setMsg({ ok: false, text: 'Indica una categoría.' });
      payload = {
        titulo: title,
        categoria: get('categoria'),
        metadata_json: { descripcion },
        ...(media ? { imagen_url: media } : {}),
      };
    } else {
      const [kind, id] = get('objetivo').split(':');
      if (!id) return setMsg({ ok: false, text: 'Elige el dato a corregir.' });
      if (kind === 'entity') {
        if (descripcion.length > 240) return setMsg({ ok: false, text: 'La corrección de una ficha admite hasta 240 caracteres.' });
        payload = { target: 'Entity', id, patch: { subtitulo: descripcion, ...(media ? { imagen_url: media } : {}) } };
      } else {
        payload = { target: 'MapMarker', id, patch: { descripcion, ...(media ? { media_url: media } : {}) } };
      }
    }
    try {
      await send.mutateAsync({ moduleSlug: get('moduleSlug') || 'mapa', type: tipo, title, payload, coords });
      form.reset();
      setMsg({ ok: true, text: 'Aporte enviado. Gracias por compartir tus hallazgos con la comunidad.' });
    } catch (err) {
      setMsg({ ok: false, text: `No se pudo enviar: ${errMsg(err)}` });
    }
  };

  const slugs = world.modules.filter((m) => m.activo && MODULES_WITH_PAGE.has(m.slug)).map((m) => ({ slug: m.slug, nombre: m.nombre }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-labelledby="form-title" className="glass rounded-2xl p-5">
        <h2 id="form-title" className="font-display text-xl font-bold">
          Nuevo aporte
        </h2>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-3 flex flex-col gap-3">
          <div>
            <label htmlFor="ap-tipo" className="mb-1 block text-sm font-medium">
              Tipo de aporte
            </label>
            <select id="ap-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={SELECT}>
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ap-mod" className="mb-1 block text-sm font-medium">
              Módulo
            </label>
            <select id="ap-mod" name="moduleSlug" className={SELECT} defaultValue="mapa">
              <option value="mapa">Mapa</option>
              {slugs.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ap-titulo" className="mb-1 block text-sm font-medium">
              Título
            </label>
            <input id="ap-titulo" name="title" required minLength={3} maxLength={160} className={INPUT} />
          </div>
          <div>
            <label htmlFor="ap-desc" className="mb-1 block text-sm font-medium">
              Descripción
            </label>
            <textarea id="ap-desc" name="descripcion" required rows={4} className={`${INPUT} py-2`} />
          </div>

          {tipo === 'marker' && (
            <>
              <div>
                <label htmlFor="ap-region" className="mb-1 block text-sm font-medium">
                  Región
                </label>
                <input id="ap-region" name="region" list="ap-regions" required className={INPUT} />
                <datalist id="ap-regions">
                  {Array.from(new Set(world.markers.map((m) => m.region))).map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ap-x" className="mb-1 block text-sm font-medium">
                    Coordenada X (0-1000)
                  </label>
                  <input id="ap-x" name="coord_x" type="number" step="0.0001" min="0" max="1000" required className={INPUT} />
                </div>
                <div>
                  <label htmlFor="ap-y" className="mb-1 block text-sm font-medium">
                    Coordenada Y (0-700)
                  </label>
                  <input id="ap-y" name="coord_y" type="number" step="0.0001" min="0" max="700" required className={INPUT} />
                </div>
              </div>
            </>
          )}
          {tipo === 'entity' && (
            <div>
              <label htmlFor="ap-cat" className="mb-1 block text-sm font-medium">
                Categoría
              </label>
              <input id="ap-cat" name="categoria" required placeholder="Ej.: Rifles, Deportivos…" className={INPUT} />
            </div>
          )}
          {tipo === 'correction' && (
            <div>
              <label htmlFor="ap-obj" className="mb-1 block text-sm font-medium">
                Dato a corregir
              </label>
              <select id="ap-obj" name="objetivo" className={SELECT}>
                {world.entities.map((e) => (
                  <option key={e.id} value={`entity:${e.id}`}>
                    {e.titulo}
                  </option>
                ))}
                {world.markers.map((m) => (
                  <option key={m.id} value={`marker:${m.id}`}>
                    Marcador: {m.titulo}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="ap-media" className="mb-1 block text-sm font-medium">
              Imagen (URL, opcional)
            </label>
            <input id="ap-media" name="media_url" type="url" placeholder="https://…" className={INPUT} />
          </div>
          <button type="submit" disabled={send.isPending || !online} className={PRIMARY}>
            {send.isPending ? 'Enviando…' : 'Enviar aporte'}
          </button>
          <div aria-live="polite" className="min-h-[1.25rem] text-sm">
            {msg && (
              <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-vice-cyan' : 'text-vice-gold'}>
                {msg.text}
              </p>
            )}
          </div>
        </form>
      </section>

      <section aria-labelledby="mine-title" className="glass rounded-2xl p-5">
        <h2 id="mine-title" className="font-display text-xl font-bold">
          Mis aportes
        </h2>
        {!online ? (
          <p className="mt-3 text-sm text-vice-text/70">Disponible al conectar con el servidor.</p>
        ) : mine.isLoading ? (
          <p role="status" className="mt-3 text-sm">
            Cargando…
          </p>
        ) : mine.error ? (
          <p role="alert" className="mt-3 text-sm text-vice-gold">
            No se pudieron cargar tus aportes.
          </p>
        ) : (mine.data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-vice-text/70">Aún no has enviado aportes.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {(mine.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.title}</p>
                  <p className="text-xs text-vice-text/70">
                    {TIPOS.find((t) => t.value === s.type)?.label ?? s.type}
                    {s.createdAt ? ` · ${new Date(s.createdAt).toLocaleDateString('es')}` : ''}
                  </p>
                </div>
                <StatusBadge status={s.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function AportarPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-2 md:px-8">
      <h1 className="font-display text-3xl font-bold">Buzón de la comunidad</h1>
      <p className="mt-1 mb-4 text-sm text-vice-text/80">Gracias por compartir tus hallazgos con la comunidad.</p>
      {!isApiConfigured && (
        <p role="status" className="glass mb-4 rounded-xl px-4 py-2 text-sm text-vice-gold">
          Sin conexión con el servidor: el envío no está disponible por ahora.
        </p>
      )}
      <Buzon />
    </div>
  );
}
