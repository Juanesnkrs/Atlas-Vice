# LeonidApp — Rutas, SEO y Monetización

**Estado:** Fuente de Verdad Única (enrutado, SEO técnico, enlazado cruzado y publicidad).
**Sustituye a:** las secciones de navegación de `docs/legado/AtlasVice-v2.md` y `docs/legado/AtlasViceNavegacionWireframesNUI.md` (`[LEGADO HISTÓRICO - NO USAR]`).
**Datos:** ver `docs/LeonidApp-Arquitectura-Datos-MongoDB.md`. **UI:** ver `docs/LeonidApp-UI-NUI-DesignSpec.md`.

---

## 1. Enrutado con History API

- El cliente usa **rutas limpias con History API** (`history.pushState` + evento `popstate`). Queda **eliminado el enrutado hash** (`#/…`).
- Sin librería de router externa: el núcleo (`navigate`, `popstate`, interceptación de `<a href>` internos, `matchRoute`, `usePageMeta`) vive en `src/store/useRouteStore.ts`; la tabla `ruta → vista` y las guardas, en `src/App.tsx`.
- Fastify es el origen único en producción:
  - Sirve los archivos estáticos compilados de `dist/` (`/assets/*` y demás rutas con extensión) con `node:fs`, sin dependencias nuevas: tipo MIME por extensión, protección contra path traversal (la ruta resuelta debe quedar dentro de `dist/`), `Cache-Control: public, max-age=31536000, immutable` para `/assets/*` y `404` JSON si el archivo no existe.
  - Sirve `index.html` (con SSR-lite, §3) para toda ruta del cliente que no empiece por `/api/`, no tenga extensión y no sea `/sitemap.xml` ni `/robots.txt` (fallback SPA). `/_staff` y su carpeta de chunks siguen el comportamiento de §1.5. Rutas desconocidas → `404` real con `<meta name="robots" content="noindex">`.
- Compatibilidad: el cliente convierte `#/<ruta>` heredado a `/<ruta>` con `history.replaceState` una sola vez al arrancar.

### 1.1 Mapa oficial de rutas públicas (indexables)

| Ruta | Vista | Fuente de datos | Sitemap |
| --- | --- | --- | --- |
| `/` | Portada (`HomePage.tsx`, DesignSpec §7.2): hero compacto, tarjetas de secciones, noticias, guías y foro en vivo | `Module`, `Entity`, `OfficialNews`, `ForumThread` (preview) | Sí |
| `/mapa` | P04 Mapa de Leonida (HUD 100vh) | `MapMarker` | Sí |
| `/catalogo` | Entrada del catálogo: redirige `301` a la categoría por defecto (§1.4); solo sirve la shell con `?q=` / `?comparar=` | `Module` | No (canonical = categoría por defecto) |
| `/catalogo/:categoria` | P05 Catálogo/Inspector de una categoría (`CatalogPage.tsx`); `:categoria` = `Module.slug` de un módulo activo distinto de `guias` (`armas`, `vehiculos`, `coleccionables`, ...) | `Module`, `Entity` | Sí (solo categorías activas con al menos una ficha) |
| `/catalogo/:categoria/:itemSlug` | P05 ficha de entidad (`Module.slug` + `Entity.slug`) | `Module.slug` + `Entity.slug` | Sí (una URL por entidad) |
| `/guias` | Índice de guías (editorial) | `Entity` del módulo `guias` | Sí |
| `/guias/:slug` | Guía (editorial) | `Entity.slug` del módulo `guias` | Sí |
| `/noticias` | Listado de noticias oficiales | `OfficialNews` | Sí |
| `/noticias/:slug` | Noticia oficial (título, extracto, enlace al original) | `OfficialNews.slug` | Sí |
| `/foro` | P07 Foro (`ForumPage.tsx`) | `ForumThread` | Sí |
| `/legal/privacidad`, `/legal/cookies`, `/legal/terminos`, `/legal/marcas`, `/legal/retirada` | Páginas legales (`LegalPage.tsx`, S6.3), enlazadas desde el footer y entre sí; `index,follow`, canonical = su ruta | Estático (`src/data/legalDocs.ts`; meta SSR en `LEGAL_PAGES` de `ssrLite.ts`, §7) | Sí (prioridad `0.3`) |
| `/aportar` | P06 Aportar: buzón comunitario 100 % público (sugerencias de marcadores, fichas y correcciones; sin referencias a moderación ni administración) | `Submission` | No (`noindex`) |

### 1.2 Rutas de aplicación (no indexables, `noindex`, fuera del sitemap)

| Ruta | Vista | Motivo |
| --- | --- | --- |
| `/hub` | P03 Dashboard (icono `Hub` del BottomDock) | Contenido personal |
| `/progreso` | P03 sección de progreso (icono `Progreso`) | Contenido personal |
| `/entrar` | P01/P02 Acceso (`LandingAuthPage.tsx`, réplica de `Main.dc.html` / `MobileHero.dc.html` con los 4 proveedores, DesignSpec §7.3) | Formulario |

### 1.3 Parámetros de consulta permitidos

Solo estado de vista; la URL canónica nunca los incluye:

- `/mapa?pin=<slug>&region=<Region>&capas=<id,id>&ocultar=1` — estado de vista del mapa. `pin` centra y abre la ficha del marcador con ese `MapMarker.slug` (se mantienen `marker=<uuid>` y `entity=<uuid>` por compatibilidad); `region` filtra por `MapMarker.region`; `capas` lista las capas visibles (ids de `MAP_LAYERS`, separados por coma; ausente = todas); `ocultar=1` oculta los marcadores ya completados del usuario. Los filtros se combinan con AND y se sincronizan con la URL sin añadir entradas al historial. Con el Modo Editor activo (`editor=1`, solo staff autorizado), `entity=<slug>` preselecciona esa ficha para situar o mover su pin (acceso desde la tabla de fichas del panel oculto); sin `editor=1` el parámetro `entity` conserva su significado público de arriba.
- `/foro?categoria=<Categoria>&hilo=<uuid>&entity=<uuid>&marker=<uuid>` — filtra por categoría, abre hilo, o muestra los hilos de una entidad / un marcador (enlazado cruzado §5). `ForumPage.tsx` usa internamente `thread`; `App.tsx` traduce `hilo → thread`.
- `/catalogo/:categoria?comparar=<slugA>,<slugB>[,<slugC>]` y `/catalogo?comparar=...` — abre el comparador NUI (§5). Sin redirección; `noindex`.
- `/catalogo?q=<texto>` — búsqueda (destino de `SearchAction`). Sirve la shell sin redirigir; canonical = categoría por defecto.
- `/catalogo/:categoria/:itemSlug?vista=ficha` — **decisión ("Ver ficha")**: la URL canónica del ítem es el Inspector con el ítem preseleccionado (en móvil, `BottomSheet` abierto). La ficha completa (estadísticas, guías relacionadas, comparar con similares y `<AdSlot position="after-content"/>`) no se perdió: es la vista ampliada de la misma URL y el botón `Ver ficha` enlaza a `?vista=ficha`. El canonical sigue siendo `/catalogo/:categoria/:itemSlug` (sin query), por lo que no hay contenido duplicado ni URL nueva en el sitemap. En esta vista la página hace scroll y muestra el Footer.
- Estado de navegación del Inspector = URL: seleccionar tarjeta hace `pushState` a `/catalogo/:categoria/:itemSlug`; cambiar de categoría, `pushState` a `/catalogo/:categoria`; `/catalogo` y `?modulo=`/`?entity=` heredados usan `replaceState`. El sheet móvil y el comparador, si se abrieron desde la propia app, se cierran con `history.back()` (la entrada queda marcada en `history.state`); si fue un deep link, con `replaceState` a la URL sin ítem/`comparar`. Nunca se apilan entradas basura.
- Cliente: al cambiar de categoría/ítem `usePageMeta` actualiza `<title>`, description, canonical, `og:*` y sustituye el JSON-LD del servidor (categoría = `CollectionPage` + `BreadcrumbList`; ítem = `CreativeWork` + `BreadcrumbList`); categoría o ítem inexistente = estado vacío en cliente + `noindex`.
- `/catalogo?modulo=<Module.slug>` — forma antigua, ya no es una vista: redirige `301` a `/catalogo/:categoria` (§1.4).
- `/entrar?next=<ruta interna>` — retorno tras login (validado en servidor como ruta interna).

### 1.4 Redirecciones `301`

| Origen | Destino |
| --- | --- |
| `/aportes` | `/aportar` |
| `/catalogo` (sin query) | `/catalogo/armas` (o la primera categoría activa por `Module.orden` si `armas` no está activa) |
| `/catalogo?modulo=<slug>` | `/catalogo/<slug>` si el módulo está activo; si no existe, está inactivo o es `guias`, la categoría por defecto |
| `/catalogo?entity=<uuid>` | `/catalogo/:categoria/:itemSlug` resuelto (o `/guias/:slug` si es guía) |
| `/catalogo/guias` | `/guias` |
| `/noticias?item=<slug>` | `/noticias/:slug` |

No redirigen: `/catalogo?q=...` y `/catalogo?comparar=...` (la shell se sirve con `200`; el comparador lleva `noindex`).

`404` SSR-lite (HTTP `404`, `noindex,nofollow`, sin canonical, con la shell de la SPA para que el cliente muestre su estado vacío): categoría inexistente o inactiva (`/catalogo/nada`), ítem inexistente (`/catalogo/armas/nada`) e ítem existente bajo otra categoría.

---

## 2. Reglas de slug

- Formato: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, máx. 120 chars, sin acentos (normalización NFD + eliminación de diacríticos).
- `Module.slug` único global; `Entity.slug` único por módulo; `OfficialNews.slug` único global.
- Un slug publicado no se reutiliza; si cambia, se registra la redirección `301` desde el antiguo.

---

## 3. SSR-lite en Fastify (meta tags + JSON-LD)

Fastify **no** renderiza React. La lógica vive en `server/src/services/ssrLite.ts` (resolución de ruta, caché, render del `<head>`) y se conecta en `routes/seo.ts`. Inyecta en `index.html` (plantilla leída una vez al arrancar, `dist/index.html`) un bloque de `<head>` por ruta, entre los marcadores `<!--ssr-head-->` y `<!--/ssr-head-->`:

| Elemento | Regla |
| --- | --- |
| `<title>` | `<Título de la página> · LeonidApp` (≤ 60 chars) |
| `<meta name="description">` | 120–160 chars, derivado del contenido visible (`subtitulo`, `summary`, intro de guía) |
| `<link rel="canonical">` | `PUBLIC_SITE_URL` + ruta limpia, sin query ni hash |
| Open Graph | `og:title`, `og:description`, `og:url` (= canonical), `og:type` (`website` / `article`), `og:image` (imagen propia de la ficha vía `socialImageOf`: `/media/<uuid>` absoluta con `og:image:width/height/alt`; si no hay o no es válida, `hero-gas-station.jpg`; noticias: `imageUrl`), `og:locale` |
| Twitter | `twitter:card=summary_large_image` + título/descripción/imagen |
| `robots` | `index,follow` en §1.1 (excepto `/aportar`); `noindex,nofollow` en §1.2, `/aportar` y `404` |
| `hreflang` | `es` y `en` + `x-default` cuando la página tenga ambos idiomas |
| JSON-LD | `<script type="application/ld+json">` (tabla siguiente) |

| Ruta | Tipos JSON-LD |
| --- | --- |
| `/` | `WebSite` (con `SearchAction` hacia `/catalogo?q=`) + `Organization` (LeonidApp, sin afiliación con Rockstar) |
| `/catalogo/:categoria` | `CollectionPage` (`name` = `Module.nombre`, `numberOfItems` = nº de fichas) + `BreadcrumbList` (Inicio › Catálogo › Categoría) |
| `/catalogo/:categoria/:itemSlug` | `CreativeWork` (con `isPartOf` = `CollectionPage` de la categoría) + `BreadcrumbList` (Inicio › Catálogo › Categoría › Ítem, todas con URL real) |
| `/guias/:slug` | `HowTo` (con `HowToStep` por cada `metadata_json.steps[]`) si la guía tiene pasos; si no, `Article`. Siempre + `BreadcrumbList` |
| `/noticias/:slug` | `NewsArticle` (`headline`, `datePublished`, `image`, `isBasedOn` = `sourceUrl` oficial) + `BreadcrumbList` |
| `/mapa`, `/foro`, `/noticias`, `/guias` | `CollectionPage` + `BreadcrumbList` |

Reglas:

1. Todo valor se escapa (HTML y `</script>` en JSON-LD → `<`).
2. Los datos estructurados coinciden con el contenido visible; nada de contenido oculto solo para buscadores.
3. Fallo de BD → `<head>` genérico de la landing y `200` para la SPA; nunca `500` en rutas públicas.
4. Caché en memoria por ruta (TTL 5 min), invalidada al promover `Submission` o ingerir noticias.
5. El cliente actualiza `document.title` y `canonical` al navegar (sin re-inyectar JSON-LD).

---

## 1.5 Redirecciones, categorías vacías y ruta oculta

- `/catalogo/mapa` y `/catalogo/mapa/:slug` responden `301` a `/mapa` y `/mapa?pin=<slug>` (el mapa se explora solo en `/mapa`; no hay categoría de catálogo `mapa` ni entradas suyas en el sitemap).
- `/catalogo/ARMAS` (cualquier mayúscula) se normaliza con `301` a minúsculas.
- Categorías vacías (hoy `coleccionables`): `noindex`, estado vacío limpio y fuera del sitemap.
- **Ruta oculta `/_staff`** (cliente y SSR): panel de staff sin enlace público, fuera de robots y sitemap. Sus chunks viven en `/_staff/assets/` y el servidor solo los sirve a sesión de staff autorizada (MODERATOR+ moderación; ADMIN+ contenido público y editorial; SUPER_ADMIN Control Total, roles, identidades y auditoría); en otro caso responde el mismo 404 que una ruta inexistente. `/api/admin/*` y los POST/PATCH/DELETE administrativos devuelven ese 404 genérico sin sesión de staff autorizada (RBAC antes que Zod). Dentro de `/_staff` (y solo ahí) el panel sincroniza sección, subsección y filtros activos con la query (`?s=<sección>&b=<bloque>&q=&m=&p=&…`) mediante History API para sobrevivir a recargas y compartir enlaces internos; el router sigue tratando `/_staff` como ruta única. Limitación aceptada: requiere red y mismo origen (no offline ni Capacitor).
- `GET /api/entities` admite `?limit=` (1-500, defecto 500), `?page=` (defecto 1), `?module=<slug|id>`, `?module_id=`, `?categoria=` y `?envelope=1`. El cuerpo es un array (compatible); la paginación va en las cabeceras `X-Total-Count`, `X-Page`, `X-Per-Page`, `X-Total-Pages` y `Link` (con `?envelope=1` el cuerpo es `{ items, total, page, limit, pages }`). Los GET públicos de catálogo, módulos, markers, noticias y config pública llevan compresión br/gzip, `ETag` débil (304 con `If-None-Match`) y `Cache-Control: public, max-age=30-60, must-revalidate`, sin `Vary: Cookie`. Se emiten CSP y HSTS (HSTS solo en producción).
- **Carrusel del Hero y medios (2026-11-21):** `GET /api/hero` (público, `Cache-Control: public, max-age=30`, ETag débil, cubo `read` de rate-limit) alimenta el carrusel de `/` (el HTML SSR-lite de `/` no cambia: `og:image` y JSON-LD siguen igual). `GET /media/:id` (público, imágenes subidas desde `/_staff`: `Content-Type` real, `nosniff`, `Cache-Control: public, max-age=31536000, immutable`, ETag, 404 `text/plain`; sin listado, fuera de `sitemap.xml` y de `robots.txt`; es una ruta Fastify específica y no pasa por el fallback SPA). `GET/PUT /api/admin/hero` y `POST /api/admin/media` son ADMIN+ y dan el 404 uniforme sin staff.
- **CSP:** `img-src 'self' data: blob: https:`. Decisión del propietario (2026-11-21): las diapositivas del Hero admiten imágenes de cualquier dominio `https`, por lo que se abre `img-src` a `https:` (se retiran los hosts oficiales sueltos, que quedan incluidos). Riesgo aceptado: imágenes externas cargadas en las páginas (fuga de IP/Referer del visitante al host de la imagen; contenido externo mutable). No se relaja ninguna otra directiva (`script-src`, `connect-src`, `frame-src`… intactas).
- Rate-limit por IP en cubos separados: lecturas públicas de API 3000/min, SSR-lite/estáticos/sitemap 1500/min y el resto (auth, escrituras, foro, progreso, admin) 200/min con los topes por ruta intactos. Las rutas de moderación del foro (`DELETE /api/forum/threads|posts/:id`, `PATCH …/pin`) devuelven el 404 genérico sin rol MODERATOR+.
- Categorías vacías: `200` con `noindex,follow`, título/descripción de categoría vacía, sin `canonical` ni `og:url` ni JSON-LD. Mayúsculas en la ruta (`/catalogo/ARMAS`, `/MAPA`) responden `301` a minúsculas cuando el destino existe.

## 1.6 Pipeline de datos y catálogo: ingesta y control

Ruta de máquina a máquina, **fuera de `/api/admin/*`** y sin sesión de cookies ni CSRF. No es indexable ni aparece en `robots.txt` (cubierta por `Disallow: /api/`) ni en `sitemap.xml`. Colección de registro: `PipelineRun` (`docs/LeonidApp-Arquitectura-Datos-MongoDB.md` §2.12).

**`POST /api/pipeline/ingest`**

- **Autenticación:** solo `Authorization: Bearer <PIPELINE_INGEST_TOKEN>`, comparado con `crypto.timingSafeEqual` (longitudes igualadas antes de comparar). Si la cabecera falta, el token falla o la variable no está configurada, responde el **404 uniforme** (`{"error":"No encontrado"}`) **antes de parsear el cuerpo**. No lee ni emite cookies y queda exenta de la comprobación de `Origin`; rate-limit propio (20/min por IP) que aplica a las peticiones autenticadas (el 404 por token inválido ocurre antes y es uniforme) y `bodyLimit` de 16 MB solo en esta ruta (máx. 5000 fichas por lote).
- **Cuerpo:** `{ source: string, modulo: string, archivo?: string, dryRun?: boolean, fichas: unknown[] }`. La simulación también se pide con `?dry=1` (equivale a `dryRun: true`; si ambos llegan, basta uno).
- **Respuesta `200`:** `{ ok: true, runId, dryRun, nuevas, actualizadas, sin_cambios, conflictos, rechazados, errores, details }`. `runId` es el `_id` del `PipelineRun`; `errores` es el número de ítems con fallo inesperado de escritura; `details` lista, por ítem no neutro (todos salvo `sin_cambios`), `{ slug, resultado: 'nueva' | 'actualizada' | 'conflicto' | 'rechazada', motivo? }`; `motivo` acompaña a `conflicto` (campos editados a mano o fuente distinta) y `rechazada` (motivo de validación o `error de escritura`), y a un ítem cuyo aporte pendiente idéntico ya existe (no se duplica). Un ítem sin `slug` válido se identifica como `#<índice>`. El cliente de referencia (`import-atlas.ts` del repositorio hermano FireCrawl) envía `{ source, modulo, archivo, dryRun, fichas }` y consume `nuevas`, `actualizadas`, `conflictos` y `errores`; los campos adicionales son aditivos y no lo rompen.
- **Reglas de procesamiento:**
  1. Validación Zod **ítem por ítem** sin abortar el lote (un ítem inválido cuenta en `rechazados` con su motivo por `slug`).
  2. `imagen_url` solo `null` o una ruta interna permitida (cero hotlinking).
  3. `contentHash` idempotente: hash igual al de la ficha existente → `sin_cambios`, sin escribir.
  4. Todo ítem nuevo, actualizado o en conflicto (campo del ítem presente en `manualEdits`) entra como `Submission` con `origin: 'pipeline'`: moderación obligatoria, nunca publica directo en `Entity`.
  5. Cada ejecución queda en `PipelineRun` y genera el evento resumen `pipeline.batch` en `AuditLog` con `actor_label: 'system:pipeline'`.
  6. Con `dryRun` se valida y se cuenta, pero no se escribe ninguna `Submission` (el `PipelineRun` y el evento de auditoría sí se registran).
  7. `conflicto` también cubre una ficha existente cuya `metadata_json.fuente` es distinta de la `source` del lote (nunca se pisa contenido de otra fuente), **salvo** que la existente tenga `metadata_json.confianza === 'baja'` y `manualEdits` vacío: entonces es `actualizada` (excepción de transición D-03; las fichas editoriales `media`/`alta` o editadas a mano siguen en `conflicto`). Si no llega `imagen_url`, la comparación y el hash usan la imagen de la ficha existente.
  8. No se duplica una `Submission` pendiente con el mismo `slug` + `contentHash` (el ítem se cuenta igualmente según su clasificación).
  9. La primera ingesta tras «Sincronizar ahora» adopta la ejecución `queued` (pasa a `running` y toma `source`/`modulo`/`archivo` del lote); una ejecución sin cerrar tras 15 minutos se cierra como `error`. Los lotes con errores de escritura (`errores > 0`) cierran con `status: 'error'`; esos ítems constan en `rejected` con motivo `error de escritura: …` pero no suman a `counts.rejected`.
- **Contrato de la ficha (cada elemento de `fichas`):** `{ modulo?, slug, titulo, subtitulo?, categoria, imagen_url?, stats_juego?, metadata?, confianza: 'alta'|'media'|'baja', evidencia?, notas?, marker?, tarjeta?, capturaPropiaPendiente?, descripcion?, descripcion_es?, description?, summary?, steps?, pasos? }`. La descripción y los pasos se aceptan a 1er nivel o dentro de `metadata` y se normalizan a `metadata_json.descripcion` (≤ 4000) y `metadata_json.steps` (`[{ id?, title, body }]`); los atributos usan las **claves canónicas y alias** de `docs/LeonidApp-Arquitectura-Datos-MongoDB.md` §2.4 (`fabricante`→`marca`, `asientos`→`plazas`, `cargador`→`municion`, `lugar`→`ubicacion`); los nulos/vacíos y el ruido de pipeline (`requiere_redaccion`, `estado_verificacion`, `stats_verificadas`, `howto_pendiente`, `fuente_ruta`, `fuente_dato`, notas de plantilla) no se guardan, y `captura_propia_pendiente`/`capturaPropiaPendiente` pasa a ser el flag de servidor `capturaPropiaPendiente`. **Claves de 1er nivel desconocidas:** se ignoran y se informan en `details[].avisos` (cadenas; no cambian `resultado`).
- **`tarjeta` (opcional):** `{ mime: 'image/webp', base64: string }`, imagen provisional WebP **1600×900, ≤ 400 KB** validada con la misma lógica que `POST /api/admin/media` (firma real y cabecera, sin librerías). Inválida, de otro tamaño/tipo, base64 mal formado o combinada con `imagen_url` → **ficha rechazada con motivo** (el lote sigue). Se guarda en `Submission.payload.tarjeta = { mime, base64, sha256, bytes }`; su `sha256` entra en el `contentHash` solo cuando hay tarjeta; el `marker` entra en el hash solo cuando existe. Al aprobar, `promote()` crea el `MediaAsset` en la misma transacción y fija `Entity.imagen_url = '/media/<id>'` con `capturaPropiaPendiente = true` (no lo hace si `manualEdits` incluye `imagen_url`).
- **`details[]`** gana `avisos?: string[]` (solo si hay avisos). El resto de la respuesta no cambia.
- **Errores tras autenticar:** `400` cuerpo no válido (forma del sobre) · `422` `modulo` inexistente · `413` lote por encima de `bodyLimit`.

**Control desde el staff (ADMIN+, 404 uniforme sin sesión de staff; RBAC antes que Zod):**

- `GET /api/admin/pipeline/runs?limit=` — últimas ejecuciones de `PipelineRun` (por defecto 20, máx. 100), más recientes primero, `Cache-Control: private, no-store`. Respuesta `{ runs: PipelineRun[], estado: { activo, ventanaHoras: 24, ultimoLoteAt, enCurso, webhookConfigurado, ingestaConfigurada } }`; cada run es `{ id, startedAt, finishedAt, status, trigger, source, modulo, archivo, dryRun, counts: { created, updated, unchanged, conflicts, rejected }, rejected: [{ slug, reason }] }` (fechas ISO). `activo` es `true` si hubo alguna ejecución no encolada en las últimas 24 h; `ultimoLoteAt` es la fecha de la última ejecución no encolada (o `null`).
- `POST /api/admin/pipeline/trigger` — pide al pipeline externo una sincronización: llama por `POST` a `PIPELINE_WEBHOOK_URL` y registra un `PipelineRun` con `trigger: 'manual'` y `status: 'queued'`. Responde `202` con el `PipelineRun` en `queued` (`source: 'manual'`, `modulo: '*'`). Si la variable no está configurada responde `409` con `code: "PIPELINE_WEBHOOK_UNSET"` (ya autenticado como staff); una ejecución en curso responde `409` con `code: "PIPELINE_BUSY"`; si el webhook no responde 2xx en 8 s, `502` con `code: "PIPELINE_WEBHOOK_FAILED"` y el run queda en `error`. El cuerpo enviado al webhook es `{ event: 'pipeline.sync', runId, requestedAt, nonce }`. Auditoría `pipeline.trigger` (sin la URL).
- `GET /api/admin/submissions` (MODERATOR+) admite además los filtros `origin=user|pipeline`, `runId=<uuid del PipelineRun>` y `reason=nueva|actualizada|conflicto` (sobre `payload.pipeline_run_id` / `payload.pipeline_reason`), y cada aporte de origen `pipeline` expone en el nivel superior `pipeline_reason`, `pipeline_run_id` y `conflict_fields: string[]`. `payload.tarjeta` se devuelve siempre como `{ bytes, sha256 }` (nunca el base64). Ejemplo de ítem: `{ id, origin: 'pipeline', moduleSlug, type: 'entity', title, payload: { …, tarjeta: { bytes, sha256 } }, pipeline_reason, pipeline_run_id, conflict_fields, status, createdAt, … }`.
- `GET /api/admin/submissions/:id/tarjeta.webp` — MODERATOR+; sirve la miniatura (`Content-Type: image/webp`, `Cache-Control: private, no-store`, `nosniff`). 404 uniforme sin staff y 404 si el aporte no existe, no es del pipeline o no tiene tarjeta.
- `POST /api/admin/submissions/bulk` — MODERATOR+ (404 uniforme sin staff; RBAC en `onRequest`, antes que Zod), rate-limit 10/min, `Cache-Control: private, no-store`. Cuerpo: `{ action: 'approve' | 'reject', ids?: uuid[] (1–200), filter?: { origin: 'pipeline', status: 'pending', runId?: uuid, reason?: 'nueva'|'actualizada'|'conflicto' }, reviewNote?: string (≤ 500, solo con reject) }`; hay que enviar **exactamente uno** de `ids` o `filter`. Con `filter`, `approve` **excluye por defecto los `conflicto`** salvo que se pida `reason: 'conflicto'`; `reject` no excluye ninguno. Procesa en secuencia reutilizando `reviewSubmission()`/`promote()` (mismas reglas, transacción y `AuditLog` por ítem que el `PATCH` individual) y **no aborta** ante un fallo. Tope duro de **500** aportes por llamada con `filter` (si hay más, `truncated: true`: repetir). Respuesta `200`: `{ action, requested, ok, failed, truncated, results: [{ id, ok, error? }] }`. Además deja un `AuditLog` `submission.bulk` (`{ action, requested, ok, failed }`). Los aportes `contact`/`newsletter` fallan por ítem para MODERATOR (solo ADMIN+).
- `GET /api/admin/submissions/:id/compare` — MODERATOR+ (404 uniforme sin staff), `Cache-Control: private, no-store`. Solo aportes `origin: 'pipeline'` de tipo `entity` (404 si no existe, 422 si no aplica). Responde `{ submission_id, estado, reason: 'nueva'|'actualizada'|'conflicto', entity: { id, slug, titulo, categoria, subtitulo, imagen_url, capturaPropiaPendiente, confianza, fuente } | null, actual: { titulo, subtitulo, categoria, descripcion, metadata } | null, propuesta: { titulo, subtitulo, categoria, descripcion, metadata, confianza, fuente, fuente_url }, diferencias: [{ campo, actual, propuesta }], imagen: { actual_url, propuesta: { bytes, sha256 } | null, thumb_url_propuesta: '/api/admin/submissions/:id/tarjeta.webp' | null }, puede_solo_imagen, puede_aceptar }`. `diferencias` lista `titulo`, `subtitulo`, `categoria`, `descripcion` (= `metadata_json.descripcion`), `metadata.<clave>` y `stats.<clave>` que difieren (vacía si no hay ficha o ya coincide). Nunca devuelve el base64. `puede_solo_imagen` = estado `pending` + hay tarjeta válida + la ficha existe + sin `imagen_url` + `imagen_url` no está en `manualEdits`; `puede_aceptar` = estado `pending`.
- `POST /api/admin/submissions/:id/resolve` — **política de conflicto** (MODERATOR+, RBAC en `onRequest` antes que Zod, rate-limit 60/min). Cuerpo `{ accion: 'mantener'|'aceptar'|'solo_imagen', nota?: string (≤ 300) }`; solo aportes `pending` del pipeline (`409` si ya procesado, `422` si la acción no procede). `mantener`: el aporte queda `rejected` con `reviewNote` «Se mantiene la ficha editorial» (+ nota) y la ficha no cambia. `aceptar`: aplica la versión del pipeline vía `reviewSubmission()`/`promote()`; `422` si la ficha tiene `manualEdits` (nunca se pisan). `solo_imagen`: crea el `MediaAsset` desde la tarjeta (misma validación `parseTarjeta`, `created_by` = moderador) y fija **solo** `imagen_url`, `capturaPropiaPendiente = true` y `metadata_json.fuente_imagen`/`fuente_url` de la propuesta (ni texto, ni confianza, ni stats, ni `contentHash`); no añade `imagen_url` a `manualEdits` (la imagen es provisional y se puede reemplazar). `422` si no hay ficha, no hay tarjeta, la ficha ya tiene imagen o `imagen_url` está protegida. El aporte queda `approved` con `reviewNote` «Solo imagen: …», `payload.pipeline_resolution = 'solo_imagen'` y `promotedTo = { Entity, id }` (sin campos nuevos de colección). Respuesta `200`: `{ ok: true, accion, entity_id, submission }` (DTO del aporte). Atómico (transacción Mongo; degrada sin sesión en standalone) y audita `submission.resolve` `{ accion, entity_id, slug, nota? }`; limpia la caché SSR cuando cambia la ficha.
- `GET /api/admin/pipeline/runs` admite `kind=catalogo|noticias|todos` (por defecto `catalogo`): los ciclos del worker de noticias (`modulo: 'noticias'`, `trigger: 'scheduled'|'manual'`, `source: 'news'`) tienen `kind: 'noticias'` en cada run y **no** cuentan en `estado` (`activo`, `ultimoLoteAt`, `enCurso`) ni bloquean `POST /trigger`.

- **SSR-lite de fichas:** la `description` (meta/Open Graph, recortada a ~160 caracteres) de `/catalogo/:modulo/:slug` y `/guias/:slug` es `metadata_json.descripcion` si existe, luego `subtitulo` y, por último, el texto por defecto; el JSON-LD (`CreativeWork`, `HowTo`, `Article`) lleva la descripción completa y `image` con la `imagen_url` de la ficha (o la imagen por defecto).
- **Imagen social por ficha (S4.4, `socialImageOf(entity)` en `server/src/services/ssrLite.ts`):** único punto de decisión de `og:image`, `twitter:image` y `image` del JSON-LD (`CreativeWork`, `HowTo`, `Article` de guías). `Entity.imagen_url` `/media/<uuid>` → URL absoluta `PUBLIC_SITE_URL + /media/<uuid>` y se emiten además `og:image:width=1600`, `og:image:height=900` y `og:image:alt` (título de la ficha); `/assets/...` interno permitido → absoluta; `https://` válida sin credenciales → tal cual; `null` u otro valor (`javascript:`, `//host`, `http:`, rutas no permitidas, `..`) → respaldo `/assets/hero-gas-station.jpg` (sin width/height/alt). Los tres campos coinciden siempre. Con las variantes del Sprint 3 (1600×900 y 800×450 con `?w=800`, ya servidas por `GET /media/:id`) solo cambia la URL elegida en esa función; `og:image` sigue usando el principal 1600×900. `/api/admin/images/queue` y `/api/admin/images/match` son ADMIN+ (404 uniforme) y quedan fuera de `sitemap.xml` y `robots.txt`.

**Variables de entorno (`server/.env`):** `PIPELINE_INGEST_TOKEN` (secreto ≥ 32 caracteres; se recomienda `openssl rand -hex 32`; sin él, la ingesta queda desactivada y responde 404) y `PIPELINE_WEBHOOK_URL` (opcional; URL `https` a la que el servidor avisa al pulsar «Sincronizar ahora»). Ninguna se expone al cliente ni se registra en logs o en `AuditLog`.

## 4. `GET /sitemap.xml` y `robots.txt`

- `GET /sitemap.xml` (Fastify, `server/src/routes/seo.ts`) genera **URLs limpias sin `#`** y sin parámetros de consulta.
- Incluye: rutas estáticas de §1.1 (excepto `/aportar`), una URL por categoría (`/catalogo/:categoria`, solo módulos `activo` distintos de `guias` con al menos una ficha; **no** se lista `/catalogo` a secas), una URL por `Entity` (`/catalogo/:categoria/:itemSlug`, de módulos `activo`), una por guía (`/guias/:slug`) y una por `OfficialNews` (`/noticias/:slug`).
- `lastmod` real: `Entity.created_at`, `OfficialNews.updatedAt` / `publishedAt`; las estáticas y las categorías usan la fecha máxima de sus fichas. Sin duplicados ni URLs antiguas (`?modulo=`, `?entity=`).
- Límite 50 000 URLs por archivo; si se supera, `GET /sitemap.xml` devuelve un `sitemapindex` con `/sitemap-<n>.xml`.
- Páginas legales (§1.1): 5 URLs con `<lastmod>` = fecha de revisión (`LEGAL_LASTMOD`) y `<priority>0.3</priority>` (única prioridad declarada en el archivo). Sin módulos inactivos (p. ej. `radio`), sin categorías sin fichas, sin `mapa` (excluido) y sin `/_staff`.
- **Caché y actualización (S6.4):** el servidor **no** cachea el sitemap: se genera en cada petición a partir de MongoDB, así que `promote` de una `Submission`, `resolve`, `DELETE /api/entities/:id`, el reemplazo de imagen y el worker de noticias se reflejan en la siguiente petición (latencia medida en la prueba: < 50 ms; tope de la prueba 2 s). Lo único con TTL es la caché HTTP del cliente/CDN (`max-age=300`, 5 min) y la caché SSR por ruta (TTL 5 min, máx. 500 entradas), que `clearSsrCache()` vacía en promote, resolve, altas/cambios/borrados de fichas y módulos, reemplazo de imagen, restauración, foro, configuración, hero y worker de noticias. No existe `clearSitemapCache`: no hace falta.
- **Límites:** 50 000 URLs por archivo (hoy 393); superado, `/sitemap.xml` pasa a `sitemapindex` con `/sitemap-<n>.xml` (ya implementado). Si el catálogo supera ≈ 10 000 URLs conviene cachear el sitemap en memoria con invalidación por `clearSsrCache`; hoy no hay riesgo.
- `Content-Type: application/xml; charset=utf-8`, `Cache-Control: public, max-age=300`.
- `robots.txt` (dinámico en `server/src/routes/seo.ts`): `Allow: /`, **únicamente `Disallow: /api/`**, `Sitemap: <PUBLIC_SITE_URL>/sitemap.xml`. Las rutas privadas (`/aportar`, `/hub`, `/progreso`, `/entrar`) se excluyen con `noindex` por meta, no listándolas en robots. La ruta oculta `/_staff` no aparece ni en robots ni en sitemap.

---

## 5. Enlazado cruzado `Lore ↔ Mapa ↔ Catálogo ↔ Foro`

Cada relación es un enlace real `<a href>` con ruta limpia (rastreable), derivado de campos del modelo de datos:

| Desde | Hacia | Campo | Enlace |
| --- | --- | --- | --- |
| Ficha `Entity` (Catálogo) | Mapa | `MapMarker.entity_id = Entity._id` | `Ver en el mapa` → `/mapa?marker=<id>` |
| Pin `MapMarker` (Mapa) | Catálogo | `MapMarker.entity_id` | `Ver ficha` → `/catalogo/:categoria/:itemSlug` |
| Ficha `Entity` / Pin | Foro | `ForumThread.entity_id` / `marker_id` | `Hilos relacionados` → `/foro?hilo=<id>` (máx. 5) y `Abrir hilo` precargado |
| Hilo del Foro | Catálogo / Mapa | `entity_id` / `marker_id` | chips bajo el título |
| Guía (Lore) | Catálogo / Mapa | `metadata_json.lore_refs[]` (UUID de `Entity` o `MapMarker`) | enlaces en el cuerpo y bloque "En esta guía" |
| Ficha `Entity` | Guías | `lore_refs` inverso | `Guías que la mencionan` |
| Noticia oficial | Catálogo | — | Sin enlaces automáticos (contenido oficial; evita insinuar afiliación) |

Reglas: sin enlaces rotos (solo se renderiza si el destino existe), anclas descriptivas (no "clic aquí"), máximo 3 clics desde `/` a cualquier contenido.

### 5.1 Comparador NUI

- Compara **2 o 3** `Entity` del **mismo módulo** sobre las claves numéricas comunes de `stats_json`.
- Se abre en `/catalogo?comparar=a,b[,c]` como `BottomSheet` (móvil) o panel HUD (escritorio) **superpuesto**: no altera el layout de `CatalogPage.tsx`.
- Cada métrica se muestra con `StatBar`; la mejor por fila se resalta con el acento sunset (`#E1307E` → `#F67E56`); valores no comparables se muestran como `—`.
- Canonical → `/catalogo/:categoria` (por defecto `armas`); `noindex` cuando hay `?comparar`.
- Sin datos remotos adicionales: usa la caché TanStack/IndexedDB de las entidades (offline-first).

---

## 6. Monetización: reglas estrictas de `<AdSlot/>`

Configuración en `AppConfig.monetization` (ver documento de datos §2.2). Componente único: `src/components/ui/AdSlot.tsx`.

**Decisión D-09 (v1 sin anuncios):** la v1 sale con `ads_enabled=false`. En ese estado `<AdSlot/>` devuelve `null`: no reserva espacio, no inyecta el script de AdSense ni hace peticiones a terceros, aunque el usuario haya aceptado «Marketing». Con `ads_enabled=true` sigue exigiendo consentimiento Marketing (`leonidapp_consent`); sin él tampoco se carga nada. Máximo 2 bloques por página (registro por ruta) y el hueco se reserva antes del primer pintado (`useLayoutEffect` + `aspect-ratio`).

### 6.1 Dónde SÍ (solo páginas editoriales con scroll)

| Ruta | Posiciones permitidas |
| --- | --- |
| `/guias` | `after-content` |
| `/guias/:slug` | `in-article` (tras el 2.º bloque, máx. 1), `after-content`, `sidebar` (solo escritorio ≥ 1280px) |
| `/noticias`, `/noticias/:slug` | `after-content` |
| `/catalogo/:categoria/:itemSlug` | `after-content` (bajo la ficha, nunca dentro del Inspector HUD) |
| `/foro` | `after-content` (tras la lista de hilos, nunca entre posts) |

Máximo **2 `AdSlot` por página**.

### 6.2 Dónde NUNCA

- `/mapa` (HUD `100vw × 100vh` sin scroll) — ni superpuesto ni en drawers/BottomSheets del mapa.
- Inspector HUD de `/catalogo` en escritorio (`100vh`), y el comparador NUI.
- Sobre, dentro o tapando el `BottomDock`, ni en la zona `env(safe-area-inset-bottom)`.
- `/`, `/entrar`, `/hub`, `/progreso`, `/aportar`, modales, pantalla de Auth y Footer.
- Como intersticial, pop-up, sticky/anchor o vídeo con autoplay.

### 6.3 Reglas técnicas (CLS = 0)

1. **Espacio reservado fijo**: el contenedor tiene `width`/`height` del slot (`aspect-ratio` + `min-height`) desde el primer render; el anuncio nunca empuja contenido. Si no llena, el hueco se colapsa solo si está fuera del viewport, o queda como superficie HUD vacía.
2. **Consentimiento**: sin la categoría "Marketing" aceptada en el modal de cookies no se carga ningún script de terceros; se renderiza el hueco reservado neutro.
3. **Carga diferida**: el script del proveedor se inyecta una única vez, tras interacción o `IntersectionObserver` (margen 200px). Nunca bloquea LCP.
4. `ads_enabled: false` o `provider: 'none'` → `AdSlot` devuelve `null` sin reservar espacio (decisión en el primer render, a partir de `GET /api/config` cacheado).
5. Etiqueta visible `Publicidad` / `Advertisement` sobre la superficie HUD (`rgba(20,14,36,0.78)` + borde cálido).
6. En Capacitor nativo (iOS/Android) los `AdSlot` web están desactivados.
7. Ningún anuncio se presenta como contenido oficial de Rockstar Games / Take-Two.

---

## 7. Páginas legales SSR-lite y validación SEO técnica (S6.4)

### 7.1 Páginas legales

`resolveRoute()` resuelve `/legal/privacidad`, `/legal/cookies`, `/legal/terminos`, `/legal/marcas` y `/legal/retirada` (tabla `LEGAL_PAGES` en `server/src/services/ssrLite.ts`, con el mismo título y descripción que `src/data/legalDocs.ts`; una prueba automática detecta desajustes). Cada una responde `200` con `<title>` «`<título> · LeonidApp`», `description`, `canonical` = su ruta, Open Graph/Twitter con la imagen de respaldo (`/assets/hero-gas-station.jpg`), `robots: index,follow`, JSON-LD `WebPage` + `BreadcrumbList` (Inicio › página) y un fallback para rastreadores sin JS dentro de `<noscript>` en `#root` (`<h1>` + descripción; con JS no se ve, así que no hay parpadeo ni CLS). Cualquier otra ruta `/legal/*` (p. ej. `/legal/xyz`, `/legal`) es `404` real.

### 7.2 Matriz ruta → resultado esperado (cubierta por la suite `(S6.4)` de `server/src/scripts/pipeline.test.ts`)

| Ruta | Estado | `robots` | Canonical | JSON-LD (`@type`) |
| --- | --- | --- | --- | --- |
| `/` | 200 | `index,follow` | `/` | `WebSite` (con `SearchAction`), `Organization` |
| `/mapa`, `/guias`, `/foro` | 200 | `index,follow` | su ruta | `CollectionPage`, `BreadcrumbList` |
| `/noticias` | 200 | `index,follow` | `/noticias` | `CollectionPage`, `BreadcrumbList` |
| `/noticias/:slug` | 200 / 404 si no existe | `index,follow` / `noindex,nofollow` | su ruta / ninguno | `NewsArticle`, `BreadcrumbList` |
| `/catalogo` | **301** a la categoría por defecto (`armas` si está activa; si no, la primera activa por `orden`); `/catalogo/mapa` → 301 `/mapa` | — | — | — |
| `/catalogo/:categoria` con fichas | 200 | `index,follow` | su ruta | `CollectionPage`, `BreadcrumbList` |
| `/catalogo/:categoria` activa sin fichas | 200 (estado vacío de la SPA) | `noindex,follow` | ninguno | ninguno |
| `/catalogo/:categoria` inactiva u oculta (p. ej. `/catalogo/radio`) o inexistente | **404** | `noindex,nofollow` | ninguno | ninguno |
| `/catalogo/:categoria/:slug` | 200 / 404 | `index,follow` / `noindex,nofollow` | su ruta (única) | `CreativeWork`, `BreadcrumbList` |
| `/guias/:slug` con ≥ 3 pasos | 200 | `index,follow` | su ruta | `HowTo` (≥ 3 `HowToStep`), `BreadcrumbList` |
| `/legal/{privacidad,cookies,terminos,marcas,retirada}` | 200 | `index,follow` | su ruta | `WebPage`, `BreadcrumbList` |
| `/legal/xyz`, `/legal`, rutas inexistentes | **404** | `noindex,nofollow` | ninguno | ninguno |
| `/LEGAL/PRIVACIDAD` (mayúsculas) | 301 a la ruta en minúsculas | — | — | — |
| `/_staff`, `/_staff/*` (sin sesión de staff) | 404 idéntico al de una ruta inexistente | `noindex,nofollow` | ninguno | ninguno |
| `/api/admin/*` (sin sesión de staff) | 404 JSON idéntico al de `/api/admin/no-existe` | — | — | — |
| `/robots.txt` | 200 `text/plain`: `Allow: /`, `Disallow: /api/`, `Sitemap: <PUBLIC_SITE_URL>/sitemap.xml`, sin `/_staff` | — | — | — |
| `/sitemap.xml` | 200 `application/xml`, sin `#`/query/`/_staff`/duplicados, sin módulos inactivos ni categorías vacías | — | — | — |

Reglas verificadas: canonical único, absoluto y sin `#`/query en cada página indexable; título y descripción únicos por ficha; ningún HTML SSR contiene texto de depuración (`undefined`, `null`, `[object Object]`, trazas); el HTML del 404 de `/_staff` es byte a byte el de una ruta inexistente. La validación con la herramienta de resultados enriquecidos de Google no se puede ejecutar sin dominio público: la prueba comprueba que el JSON-LD es parseable y trae los `@type` y campos requeridos; la comprobación externa queda para el despliegue (S7).

### 7.3 Noticias oficiales: fuentes evaluadas (S5.5, 2026-11-23, `User-Agent: LeonidAppNewsBot/1.0`)

| URL probada | Resultado | Decisión |
| --- | --- | --- |
| `rockstargames.com/robots.txt` | 200; solo bloquea bots de IA/archivo (`ClaudeBot`, `GPTBot`, `CCBot`…); no bloquea `*` | — |
| `rockstargames.com/newswire` | 200, HTML de 4 KB (shell de microfrontends sin contenido); sin `<link rel="alternate" type="application/rss+xml">` | Sin feed: no se ingiere |
| `/newswire/rss`, `/newswire/feed`, `/newswire/rss.xml`, `/newswire.rss`, `/newswire/atom`, `/newswire/get-posts.json`, `/rss`, `/feed`, `/atom.xml`, `/sitemap.xml`, `/sitemap_index.xml` (todas bajo `www.rockstargames.com`) | todas **404** | No existe feed ni sitemap público documentado |
| `ir.take2games.com/rss/news-releases.xml` | 200 RSS, 10 notas de prensa; robots permite `/rss/`; **fuente vigente** | Activa (`take-two-ir`) |
| `ir.take2games.com/rss/events.xml`, `/rss/sec-filings.xml` | 200 RSS oficial (llamadas de resultados, presentaciones SEC); ninguno trata de GTA VI/Leonida | No se añaden: el filtro de relevancia los descartaría todos |
| `ir.take2games.com/rss/pressrelease.aspx`, `/rss/press-releases.xml`, `take2games.com/{feed,rss,news}` | 404 | — |

**Decisión:** hay **una** fuente oficial utilizable (Take-Two IR, que incluye las notas de Rockstar Games como la de las reservas de GTA VI). Rockstar Newswire no ofrece RSS/Atom/API pública: extraer su contenido exigiría scraping del front o de endpoints internos no documentados, lo que está prohibido. No se añaden fuentes de terceros. Para una segunda fuente haría falta que Rockstar publique un feed o API oficial documentada (bastaría añadir una entrada a `NEWS_SOURCES` en `server/src/workers/sources.ts`, el host a `ALLOWED_HOSTS` y, si procede, el id al enum del modelo `OfficialNews`) o un acuerdo explícito con el titular de derechos. El parseo se valida con una respuesta real guardada (fixture de la suite `(S5.5)`) y la ingesta con inserción real se comprobó contra la base `_test` (1 inserción: «Rockstar Games Announces Pre-Orders for Grand Theft Auto VI»).
