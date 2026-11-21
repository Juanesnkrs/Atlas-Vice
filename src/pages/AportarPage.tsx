// P06 - Aportar: envío de aportes (lugar, ficha o corrección) y «Mis aportes».
// Vista 100 % pública (requiere cuenta para enviar). No incluye herramientas de gestión.
// El aporte de un lugar no pide coordenadas: el equipo ubica el pin al revisarlo.
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

const TIPOS: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: 'marker', label: 'Un lugar del mapa', hint: 'Cuéntanos qué hay y en qué zona está. El equipo coloca el punto en el mapa al revisarlo.' },
  { value: 'entity', label: 'Una ficha nueva (arma, vehículo, coleccionable o guía)', hint: 'Propón una ficha que falte en el catálogo.' },
  { value: 'correction', label: 'Corregir un dato', hint: 'Elige la ficha o el lugar y escribe el dato correcto.' },
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
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
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

  const slugs = world.modules.filter((m) => m.activo && MODULES_WITH_PAGE.has(m.slug)).map((m) => ({ slug: m.slug, nombre: m.nombre }));

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const get = (k: string): string => String(fd.get(k) ?? '').trim();
    const title = get('title');
    const descripcion = get('descripcion');
    if (title.length < 3 || descripcion.length < 10) {
      return setMsg('Escribe un título (mínimo 3 letras) y una descripción (mínimo 10).');
    }
    const media = get('media_url');
    if (media && !/^https?:\/\//i.test(media)) return setMsg('La imagen debe ser un enlace que empiece por http o https.');
    // El payload debe cumplir los esquemas de promoción del servidor (marker, entity o correction).
    let payload: Record<string, unknown>;
    let moduleSlug = 'mapa';
    if (tipo === 'marker') {
      if (!get('region')) return setMsg('Indica la zona o región del lugar.');
      payload = { titulo: title, region: get('region'), descripcion, ...(media ? { media_url: media } : {}) };
    } else if (tipo === 'entity') {
      if (!get('categoria')) return setMsg('Indica una categoría.');
      moduleSlug = get('moduleSlug') || slugs[0]?.slug || 'armas';
      payload = {
        titulo: title,
        categoria: get('categoria'),
        metadata_json: { descripcion },
        ...(media ? { imagen_url: media } : {}),
      };
    } else {
      const [kind, id] = get('objetivo').split(':');
      if (!id) return setMsg('Elige el dato a corregir.');
      if (kind === 'entity') {
        if (descripcion.length > 240) return setMsg('La corrección de una ficha admite hasta 240 caracteres.');
        payload = { target: 'Entity', id, patch: { subtitulo: descripcion, ...(media ? { imagen_url: media } : {}) } };
      } else {
        payload = { target: 'MapMarker', id, patch: { descripcion, ...(media ? { media_url: media } : {}) } };
      }
    }
    try {
      await send.mutateAsync({ moduleSlug, type: tipo, title, payload, coords: null });
      setSent(true);
    } catch (err) {
      setMsg(`No se pudo enviar: ${errMsg(err)}`);
    }
  };

  const hint = TIPOS.find((t) => t.value === tipo)?.hint;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-labelledby="form-title" className="glass rounded-2xl p-5">
        <h2 id="form-title" className="font-display text-xl font-bold">
          Nuevo aporte
        </h2>
        {sent ? (
          <div role="status" className="mt-3 flex flex-col gap-3">
            <p className="font-semibold text-vice-cyan">¡Aporte enviado! Gracias por compartirlo.</p>
            <p className="text-sm text-vice-text/85">
              Lo recibimos y lo revisará el equipo. Verás su estado en «Mis aportes».
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setMsg(null);
              }}
              className={PRIMARY}
            >
              Enviar otro aporte
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="mt-3 flex flex-col gap-3">
            <div>
              <label htmlFor="ap-tipo" className="mb-1 block text-sm font-medium">
                ¿Qué quieres compartir?
              </label>
              <select id="ap-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={SELECT}>
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {hint && <p className="mt-1 text-xs text-vice-text/75">{hint}</p>}
            </div>
            {tipo === 'entity' && (
              <div>
                <label htmlFor="ap-mod" className="mb-1 block text-sm font-medium">
                  Sección
                </label>
                <select id="ap-mod" name="moduleSlug" className={SELECT}>
                  {slugs.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tipo === 'correction' && (
              <div>
                <label htmlFor="ap-obj" className="mb-1 block text-sm font-medium">
                  Dato a corregir
                </label>
                <select id="ap-obj" name="objetivo" className={SELECT}>
                  {world.entities.map((en) => (
                    <option key={en.id} value={`entity:${en.id}`}>
                      {en.titulo}
                    </option>
                  ))}
                  {world.markers.map((m) => (
                    <option key={m.id} value={`marker:${m.id}`}>
                      Lugar: {m.titulo}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="ap-titulo" className="mb-1 block text-sm font-medium">
                {tipo === 'marker' ? 'Nombre del lugar' : 'Título'}
              </label>
              <input id="ap-titulo" name="title" required minLength={3} maxLength={160} className={INPUT} />
            </div>
            {tipo === 'marker' && (
              <div>
                <label htmlFor="ap-region" className="mb-1 block text-sm font-medium">
                  Zona o región
                </label>
                <input id="ap-region" name="region" list="ap-regions" required className={INPUT} />
                <datalist id="ap-regions">
                  {Array.from(new Set(world.markers.map((m) => m.region))).map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>
            )}
            {tipo === 'entity' && (
              <div>
                <label htmlFor="ap-cat" className="mb-1 block text-sm font-medium">
                  Categoría
                </label>
                <input id="ap-cat" name="categoria" required placeholder="Ej.: Rifles, Deportivos…" className={INPUT} />
              </div>
            )}
            <div>
              <label htmlFor="ap-desc" className="mb-1 block text-sm font-medium">
                {tipo === 'correction' ? 'Dato correcto' : 'Descripción'}
              </label>
              <textarea id="ap-desc" name="descripcion" required rows={4} className={`${INPUT} py-2`} />
            </div>
            <div>
              <label htmlFor="ap-media" className="mb-1 block text-sm font-medium">
                Imagen (enlace, opcional)
              </label>
              <input id="ap-media" name="media_url" type="url" placeholder="https://…" className={INPUT} />
            </div>
            <button type="submit" disabled={send.isPending || !online} className={PRIMARY}>
              {send.isPending ? 'Enviando…' : 'Enviar aporte'}
            </button>
            <div aria-live="polite" className="min-h-[1.25rem] text-sm">
              {msg && (
                <p role="alert" className="text-vice-gold">
                  {msg}
                </p>
              )}
            </div>
          </form>
        )}
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
    <div className="mx-auto w-full max-w-6xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-2 md:px-8">
      <h1 className="font-display text-3xl font-bold">Aportar</h1>
      <p className="mt-1 mb-4 max-w-2xl text-sm leading-relaxed text-vice-text/85">
        Comparte lugares del mapa, fichas nuevas o correcciones de datos que veas mal.
        <br />
        Cada aporte lo revisa el equipo y, si procede, se publica en la app.
        <br />
        Puedes seguir su estado más abajo, en «Mis aportes».
      </p>
      {!isApiConfigured && (
        <p role="status" className="glass mb-4 rounded-xl px-4 py-2 text-sm text-vice-gold">
          Sin conexión con el servidor: el envío no está disponible por ahora.
        </p>
      )}
      <Buzon />
    </div>
  );
}
