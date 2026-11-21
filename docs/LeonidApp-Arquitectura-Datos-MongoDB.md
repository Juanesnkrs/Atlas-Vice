# LeonidApp — Arquitectura de Datos MongoDB, RBAC y Auth

**Estado:** Fuente de Verdad Única (persistencia, backend, RBAC y autenticación).
**Sustituye a:** `docs/legado/AtlasViceArquitecturaDatosSQL.md` (`[LEGADO HISTÓRICO - NO USAR]`).
**Motor:** MongoDB (único). ODM: Mongoose. Validación: Zod en cada ruta (entrada y salida).
**Código de referencia:** `server/src/models/*.ts`. Si el código y este documento difieren, se corrige el código; las filas marcadas **Δ** son cambios pendientes de implementar.

---

## 1. Convenciones generales

| Regla | Detalle |
| --- | --- |
| Identificadores | `_id: String` con UUID v4 (`idField` en `models/common.ts`). Se expone como `id` en los DTO. Se conservan los UUID de `src/data/seed.ts`. |
| Par Mongoose + Zod | Cada colección tiene: interfaz `XDoc`, `Schema` Mongoose, schema Zod de entrada (`xSchema` / `xCreateSchema`), schema de actualización (`.partial()`) cuando aplique y mapeador `toXDTO`. |
| Tipos compartidos | El cliente consume los tipos inferidos (`z.infer`) reflejados en `src/types/database.ts`. |
| Nombres de campo | Se mantienen los nombres existentes (snake_case heredado del DER; camelCase en `Submission` y `OfficialNews`). PROHIBIDO renombrar sin actualizar este documento. |
| Timestamps | `created_at` (solo creación) salvo donde se indica. |
| Campos nuevos | PROHIBIDO añadir campos o colecciones que no estén en este documento. |

---

## 2. Las 11 colecciones

Las colecciones aprobadas son 11 grupos lógicos (el grupo Foro se compone de 3 modelos):

1. `User`
2. `AppConfig`
3. `Module`
4. `Entity`
5. `MapMarker`
6. `UserProgress`
7. `OfficialNews`
8. `Submission`
9. Foro: `ForumThread` / `ForumPost` / `ForumVote`
10. `AuditLog`
11. **Δ** `MediaAsset` (imágenes subidas desde el panel, §2.11; aprobada por el propietario el 2026-11-21)

### 2.1 `User` — `models/User.ts`

Sustituye a `profiles` + `auth.users` del DER legado.

| Campo | Tipo Mongoose | Zod | Notas |
| --- | --- | --- | --- |
| `_id` | String (UUID) | `z.uuid()` | |
| `email` | String, lowercase, trim | `z.email().optional()` | Índice único parcial (solo si es string). Nunca en la vista pública. |
| `username` | String, required, unique | `z.string().min(2).max(40)` | |
| `avatar_url` | String \| null | `z.string().nullable().optional()` | |
| `discord_id` | String \| null | `z.string().nullable().optional()` | Índice único parcial. |
| `rol` | String enum `ROLES`, default `USER` | `roleSchema` | Ver §3. `GUEST` nunca se persiste. |
| `identities` | `[{ provider, subject }]` | `z.array(...)` | `provider ∈ AUTH_PROVIDERS`. Índice `{ 'identities.provider', 'identities.subject' }`. |
| `sessions_revoked_at` | Date \| null, default `null` | `z.coerce.date().nullable().optional()` | Revocación de sesiones (solo SUPER_ADMIN, desde Identidades): una cookie `lv_session` emitida antes de esta fecha deja de ser válida. Nunca en DTO público. |
| `created_at` | Date | `z.coerce.date().optional()` | |

DTO: `toPublicUserDTO` (sin email) y `toSelfUserDTO` (con email, solo `/api/auth/me`).

### 2.2 `AppConfig` — `models/AppConfig.ts`

Singleton con `key: 'global'` (unique). Lectura con `getGlobalConfig()` (upsert). Solo `SUPER_ADMIN` escribe con `PATCH /api/admin/config`; la única excepción es `hero_slides`, que escribe `ADMIN+` con `PUT /api/admin/hero` (contenido público, no configuración del sistema) y que `PATCH /api/admin/config` rechaza.

| Campo | Tipo | Zod | Notas |
| --- | --- | --- | --- |
| `key` | `'global'`, unique | — | |
| `maintenance_mode` | Boolean, default `false` | `z.boolean()` | |
| `announcement` | String \| null | `z.string().max(500).nullable()` | |
| `feature_flags` | Mixed `{ [flag]: boolean }` | `z.record(z.string(), z.boolean())` | |
| `enabled_auth_providers` | `[String]` | `z.array(z.enum([...AUTH_PROVIDERS])).max(4)` | Máximo 4 (§4). |
| `social_links` | `[{ platform, url }]` | `.max(12)` | Consumido por el Footer. |
| **Δ** `monetization` | Subdocumento (abajo) | `monetizationSchema` | Reglas de colocación en `LeonidApp-Rutas-SEO-Monetizacion.md` §6. |
| **Δ** `hero_slides` | `[Mixed]`, default `[]` | `z.array(heroSlideSchema).max(6)` | Carrusel del Hero de `/` (abajo). Vacío o sin diapositivas activas = el Hero muestra la diapositiva por defecto del cliente. |
| `updatedAt` | Date | — | Solo `updatedAt`. |

Bloque **Δ** `monetization`:

```ts
const AD_ROUTES = ['/catalogo/:categoria/:itemSlug', '/guias', '/guias/:slug', '/noticias', '/noticias/:slug', '/foro'] as const;
const AD_POSITIONS = ['in-article', 'after-content', 'sidebar'] as const;

export const monetizationSchema = z.object({
  ads_enabled: z.boolean().default(false),          // interruptor global
  provider: z.enum(['none', 'adsense']).default('none'),
  publisher_id: z.string().max(60).nullable().default(null), // p. ej. 'ca-pub-…'; no es secreto
  require_consent: z.literal(true).default(true),   // sin consentimiento "Marketing" no se carga ningún script
  slots: z.array(z.object({
    id: z.string().min(1).max(40),
    route: z.enum(AD_ROUTES),
    position: z.enum(AD_POSITIONS),
    width: z.number().int().positive(),             // reserva fija → CLS = 0
    height: z.number().int().positive(),
    enabled: z.boolean().default(true),
  })).max(20).default([]),
});
```

Mongoose: `monetization: { type: Schema.Types.Mixed, default: { ads_enabled: false, provider: 'none', publisher_id: null, require_consent: true, slots: [] } }`.
`GET /api/config` expone `monetization` sin campos internos; `PATCH /api/admin/config` (SUPER_ADMIN) valida con `appConfigUpdateSchema` (que **omite** `hero_slides`).

Bloque **Δ** `hero_slides` (carrusel del Hero de la portada `/`, gestionado desde `/_staff` → Contenido público → Portada (Hero), ADMIN+):

```ts
const internalPath = z.string().regex(/^\/(?!\/)[^\s\]*$/);       // "/mapa", "/guias?x=1"; nunca "//", esquemas ni espacios
const httpsUrl = z.url({ protocol: /^https$/ });                    // solo https; rechaza javascript:, data:, http:
export const heroSlideSchema = z.object({
  id: z.uuid(),
  activa: z.boolean(),
  orden: z.number().int().min(0).max(99),                           // el servidor lo normaliza a la posición 0..n-1 al guardar
  kicker: z.string().trim().max(60).default(''),                    // opcional ('' = sin kicker)
  titulo: z.string().trim().min(1).max(90),
  descripcion: z.string().trim().min(1).max(220),
  boton_texto: z.string().trim().min(1).max(30),
  boton_enlace: z.union([internalPath, httpsUrl]),
  boton_secundario_texto: z.string().trim().min(1).max(30).nullable().default(null),    // opcional: ambos o ninguno
  boton_secundario_enlace: z.union([internalPath, httpsUrl]).nullable().default(null),  // solo se muestra a invitados («Crear cuenta gratis»)
  imagen_url: z.union([z.string().regex(/^\/media\/[0-9a-f-]{36}$/), httpsUrl]),        // imagen propia (§2.11) o enlace https
  imagen_alt: z.string().trim().min(1).max(140),                    // accesibilidad (obligatorio)
});
```

- Máximo 6 diapositivas e `id` únicos (validación estricta al guardar con `PUT /api/admin/hero`; la lectura pública es tolerante y descarta las que no validan).
- Con 0 diapositivas activas el cliente muestra la **diapositiva por defecto** (texto, botones «Abrir el mapa» y «Crear cuenta gratis» e imagen `public/assets/hero-gas-station.jpg` actuales); es contenido del cliente, no se persiste.
- Imagen estándar: **1600 × 900 px (16:9), WebP o JPG, ≤ 400 KB**. Si `imagen_url` es `/media/<id>` se subió con el panel y cumple esa medida (validada en el servidor); si es un enlace `https://` no se valida su tamaño (recomendación 1600×900; el equipo responde de su licencia).
- Al borrar una diapositiva o reemplazar su imagen, el servidor elimina el `MediaAsset` propio (`/media/<id>`) que quede sin referencias (best effort) y lo audita (`media.delete`).
- Auditoría: `hero.update` (`target_type: 'AppConfig'`, `target_id: 'global'`, `metadata: { before, after }` de `hero_slides`, truncado según §2.10).
- `GET /api/hero` (público) devuelve solo las diapositivas **activas** ordenadas, sin `activa` ni `orden`.

### 2.3 `Module` — `models/Module.ts`

| Campo | Tipo | Zod |
| --- | --- | --- |
| `_id` | UUID | `z.uuid().optional()` |
| `slug` | String, required, unique | `z.string().min(1).max(60)` |
| `nombre` | String | `z.string().min(1).max(80)` |
| `icono` | String (nombre Lucide) | `z.string().min(1).max(60)` |
| `activo` | Boolean, default `true` | `z.boolean()` |
| `orden` | Number, default `0` | `z.number().int()` |
| `created_at` | Date | — |

`slug` es el segmento `:modulo` de `/catalogo/:categoria/:itemSlug`. El módulo con `slug: 'guias'` aloja las guías (`/guias/:slug`).

### 2.4 `Entity` — `models/Entity.ts`

| Campo | Tipo | Zod | Notas |
| --- | --- | --- | --- |
| `_id` | UUID | `z.uuid().optional()` | |
| `module_id` | String ref `Module`, required | `z.uuid()` | |
| **Δ** `slug` | String, required | `z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120)` | Índice único `{ module_id: 1, slug: 1 }`. Segmento `:slug` de la URL. |
| `titulo` | String | `z.string().min(1).max(160)` | |
| `subtitulo` | String \| null | `.max(240).nullable().optional()` | |
| `categoria` | String | `z.string().min(1).max(80)` | Índice `{ module_id, categoria }`. |
| `imagen_url` | String \| null | `.nullable().optional()` | |
| `stats_json` | Mixed | `jsonRecordSchema` | Fuente del comparador NUI (valores numéricos). |
| `metadata_json` | Mixed | `jsonRecordSchema` | En guías: `body_md`, `lore_refs[]` y `steps[]` = `{ id, title, body }` ordenados (fuente del progreso por pasos y del JSON-LD `HowTo`). |
| `created_at` | Date | — | |

### 2.5 `MapMarker` — `models/MapMarker.ts`

| Campo | Tipo | Zod | Notas |
| --- | --- | --- | --- |
| `_id` | UUID | `z.uuid().optional()` | |
| `entity_id` | String ref `Entity` \| null | `z.uuid().nullable().optional()` | Enlace Mapa ↔ Catálogo. |
| `slug` | String (opcional, sin valor por defecto) | `slugSchema.optional()` | **Δ** Identificador legible para el deep-link `/mapa?pin=<slug>`. Índice **único *sparse*** `{ slug: 1 }`: los marcadores sin `slug` no entran en el índice. Se rellena con el `slug` de su `Entity` o con el título normalizado. |
| `region` | String | `z.string().min(1).max(80)` | Índice `{ region: 1 }`. |
| `titulo` | String | `.min(1).max(160)` | |
| `descripcion` | String \| null | `.max(2000).nullable().optional()` | |
| `coord` | `{ x: Number, y: Number }` (sin `_id`) | entrada: `coord_x` (`z.number().min(0).max(1000)`), `coord_y` (`z.number().min(0).max(700)`) | **Índice `2d`**: `s.index({ coord: '2d' }, { min: 0, max: 1000 })`. Plano cartesiano propio del lienzo del mapa (**0–1000 × 0–700**, origen arriba a la izquierda, eje Y hacia abajo), renderizado con SVG propio, sin Leaflet. |
| `media_url` | String \| null | `.nullable().optional()` | |
| `created_at` | Date | — | |

**Δ Índice `{ entity_id: 1 }` (no es un campo nuevo):** acelera «¿qué pines cuelgan de esta ficha?» (conexión Ficha ↔ Pin del panel `/_staff`, resumen de pines huérfanos y comprobación de dependientes al borrar una `Entity`).

**Δ Marco de coordenadas de `coord`:** el lienzo 0–1000 × 0–700 coincide con la pirámide de teselas recoloreadas de `public/map-tiles/` (`manifest.json` → `world`; ver DesignSpec §6.4). Los 10 `MapMarker` base están calibrados sobre esas teselas y cualquier alta o movimiento (Modo Editor) usa ese mismo marco. No hay cambios de esquema.

El DTO aplana `coord` a `coord_x` / `coord_y` y expone `slug` (`null` si no existe). `GET /api/markers` admite `?region=` y `?bbox=x1,y1,x2,y2` (consulta `$geoWithin: { $box }` sobre `coord`) y responde con `ETag` y `Cache-Control: public, max-age=60, must-revalidate`.

### 2.6 `UserProgress` — `models/UserProgress.ts`

| Campo | Tipo | Zod |
| --- | --- | --- |
| `_id` | UUID | — |
| `user_id` | String ref `User` | — (sale de la sesión) |
| `target_type` | `'ENTITY' \| 'MARKER'` | `z.enum(PROGRESS_TARGETS)` |
| `target_id` | String | `z.uuid()` |
| `completado` | Boolean, default `true` | `z.boolean()` |
| `updated_at` | Date | `z.coerce.date().optional()` |

Índice único `{ user_id, target_type, target_id }`. Sincronización por lotes: `progressBatchSchema` (máx. 2000 ítems), resolución last-write-wins por `updated_at` contra la caché IndexedDB del cliente.

### 2.7 `OfficialNews` — `models/OfficialNews.ts`

| Campo | Tipo | Zod | Notas |
| --- | --- | --- | --- |
| `title` | String | `z.string().min(1)` | |
| `summary` | String | `z.string()` | Extracto; nunca el artículo completo. |
| `sourceUrl` | String, unique | `z.string().url()` | Dedupe por URL canónica. Dominio en lista blanca. |
| `source` | enum `NEWS_SOURCES` | `'rockstar-newswire' \| 'rockstar-youtube' \| 'take-two-ir'` | Solo fuentes oficiales. |
| `imageUrl` | String? | `z.string().url().optional()` | |
| `publishedAt` | Date, índice `-1` | `z.coerce.date()` | `lastmod` del sitemap. |
| `slug` | String | `z.string().min(1)` | **Δ** índice único `{ slug: 1 }` (segmento de `/noticias/:slug`). |
| `createdAt` / `updatedAt` | Date | — | `timestamps: true`. |

Escritura exclusiva del worker `server/src/workers/officialNewsWorker.ts`.

### 2.8 `Submission` — `models/Submission.ts`

| Campo | Tipo | Zod | Notas |
| --- | --- | --- | --- |
| `_id` | UUID | `z.uuid().optional()` | |
| `userId` | String | `z.uuid()` | **Δ** `null` permitido solo si `type ∈ {'contact','newsletter'}` (Footer, invitados). |
| `moduleSlug` | String | `.min(1).max(60)` | Debe existir en `Module` salvo tipos de Footer (`'leonidapp'`). |
| `type` | String | **Δ** `z.enum(SUBMISSION_TYPES)` | `SUBMISSION_TYPES = ['marker', 'entity', 'correction', 'contact', 'newsletter']`. |
| `title` | String | `.min(3).max(160)` | |
| `payload` | Mixed | `jsonRecordSchema` | Campos destino (ver §5). En `newsletter`: `{ email, locale }`. En `contact`: `{ email, message }`. |
| `coords` | `{ x, y } \| null` | `z.object({x,y}).nullable()` | Un aporte público `marker` se guarda con `coords: null` (el visitante no conoce el sistema 0-1000 × 0-700); quien lo aprueba debe aportarlas (ver §5). |
| `status` | `'pending' \| 'approved' \| 'rejected'` | `submissionStatusSchema` | Índice `{ status, createdAt: -1 }`. |
| `reviewedBy` | String \| null | `z.uuid().nullable()` | `'system'` en aprobación automática. |
| **Δ** `reviewNote` | String (opcional, sin valor por defecto) | `z.string().trim().max(500).optional()` | Motivo del rechazo, visible solo en moderación (`/_staff`). Se guarda solo al rechazar (`PATCH /api/admin/submissions/:id` con `{ status: 'rejected', reviewNote? }`) y se expone en el DTO como `reviewNote`. |
| **Δ** `promotedTo` | `{ collection: 'MapMarker' \| 'Entity', id: string } \| null` | `z.object(...).nullable()` | Resultado de la promoción (§5). |
| `createdAt` | Date | — | |

### 2.9 Foro — `ForumThread`, `ForumPost`, `ForumVote`

**`ForumThread`**

| Campo | Tipo | Zod |
| --- | --- | --- |
| `_id` | UUID | — |
| `user_id` | ref `User` | — (sesión) |
| `entity_id` | String \| null | `z.uuid().nullable().optional()` — enlace Foro ↔ Catálogo |
| `marker_id` | String \| null | `z.uuid().nullable().optional()` — enlace Foro ↔ Mapa |
| `categoria` | enum `FORUM_CATEGORIES` | `['General', 'Guias/Ayuda', 'Secretos', 'Crews']` (UI: `Guías / Ayuda`) |
| `titulo` | String | `.min(3).max(160)` |
| `contenido` | String | `.min(1).max(10000)` |
| `is_spoiler` | Boolean | `default(false)` |
| `is_pinned` | Boolean | solo MODERATOR+ |
| `is_locked` | Boolean, default `false` | solo MODERATOR+; un hilo cerrado rechaza respuestas nuevas (409) y sigue siendo legible |
| `upvotes_count` | Number | contador desnormalizado |
| `created_at` | Date | índice `{ categoria, created_at: -1 }` |

**`ForumPost`**: `_id`, `thread_id` (ref, índice), `user_id`, `parent_post_id` (nullable), `contenido` (`.min(1).max(10000)`), `upvotes_count`, `created_at`.

**`ForumVote`**: `user_id`, `target_type ∈ {'THREAD','POST'}`, `target_id` (UUID), `created_at`. Índice único `{ user_id, target_type, target_id }` (un voto por usuario y objetivo). Al votar se hace `$inc` atómico de `upvotes_count` en el objetivo.

### 2.10 `AuditLog` — `models/AuditLog.ts`

| Campo | Tipo | Notas |
| --- | --- | --- |
| `_id` | UUID | |
| `actor_id` | String | `'system'` para acciones automáticas. |
| `actor_role` | String | Rol en el momento de la acción. |
| `action` | String | `dominio.verbo`, p. ej. `submission.approved`, `user.role_changed`, `config.updated`. |
| `target_type` / `target_id` | String / String \| null | |
| `metadata` | Mixed | Diff `{ from, to }`. Nunca tokens ni secretos. |
| `ip` | String \| null | |
| `created_at` | Date | Índices `{ created_at: -1 }`, `{ actor_id, created_at: -1 }`. |

Inmutable: solo `insert` mediante `services/audit.ts#writeAudit`. Se escribe en toda acción ADMIN+ y en toda promoción de `Submission`. `models/AuditLog.ts` exporta además `auditLogSchema` (Zod) con la misma forma.

**Δ Convención de `metadata` (sin campos nuevos; `metadata` sigue siendo `Mixed`):**

- **Actualizaciones** (`entity.update`, `module.update`, `marker.update`, `config.update`, `forum.thread.update`): `metadata = { before, after }` con **solo los campos que cambian** (mismas claves en ambos). Los textos de más de 500 caracteres se truncan (`…[+N]`) y los objetos/arrays cuyo JSON supera 4000 caracteres se sustituyen por `"[valor extenso: N caracteres]"`. Se excluyen siempre secretos, tokens, hashes y correos de terceros: ninguno de esos campos existe en los diffs de catálogo, mapa, módulos, configuración ni foro, y `User` nunca se difunde en `before`/`after`.
- **Borrados** (`entity.delete`, `module.delete`, `marker.delete`, `forum.thread.delete`): `metadata = { snapshot, … }`, con el documento completo tal como estaba (para `forum.thread.delete`: `{ thread, posts[], votes[] }`, es decir, también los hijos del borrado en cascada). Si el snapshot serializado supera 8 MB solo se guarda `{ thread }` y la entrada lleva `snapshot_truncated: true` (no restaurable).
- **Restauración** (`entity.restore`, `module.restore`, `marker.restore`, `forum.thread.restore`): solo `SUPER_ADMIN`, `POST /api/admin/audit-logs/:id/restore`. Reinserta el `snapshot` **con el mismo `_id`** en una transacción (en MongoDB sin réplica degrada a escritura sin atomicidad, como `promote()`); responde `409` si el `_id` o el `slug` único ya existen, si esa entrada ya se restauró o si la dependencia (módulo de la ficha) no existe. Escribe su propia entrada con `metadata = { restored_from: <id de la entrada de borrado> }`.
- Las entradas anteriores a esta convención (`metadata.patch`) siguen siendo legibles y el panel las muestra tal cual.

### 2.11 `MediaAsset` — `models/MediaAsset.ts`

Imágenes subidas desde el panel (solo las diapositivas del Hero, §2.2). Se guardan en MongoDB como binario: sin disco, sin servicio externo y sin librerías.

| Campo | Tipo Mongoose | Zod | Notas |
| --- | --- | --- | --- |
| `_id` | String (UUID) | `z.uuid()` | Identificador público: `GET /media/:id`. |
| `mime` | String enum | `z.enum(['image/webp', 'image/jpeg'])` | Solo estos dos tipos. |
| `width` / `height` | Number | `z.literal(1600)` / `z.literal(900)` | Leídos de la cabecera real del archivo. |
| `bytes` | Number | `z.number().int().positive().max(409600)` | ≤ 400 KB. |
| `data` | Buffer | `z.instanceof(Buffer)` | Contenido binario; nunca viaja en JSON. |
| `created_by` | String (UUID de `User`) | `z.uuid()` | Quién la subió. |
| `created_at` | Date | `z.coerce.date().optional()` | Solo creación. |

- Subida: `POST /api/admin/media` (ADMIN+, 404 uniforme sin staff) con cuerpo **binario** (`Content-Type: image/webp` o `image/jpeg`, sin multipart; parser de cuerpo crudo propio solo en esa ruta, `bodyLimit` 600 KB). El servidor valida tipo, **firma mágica real** (WebP `RIFF…WEBP`; JPEG `FFD8FF`), tamaño ≤ 400 KB y dimensiones exactas 1600×900 leídas de la cabecera (JPEG: marcador SOF; WebP: VP8 / VP8L / VP8X), con código propio. Rate-limit 20/min por IP. Auditoría `media.upload`. Responde `201 { id, url: '/media/<id>', mime, width, height, bytes }`.
- Lectura pública: `GET /media/:id` (solo imágenes; `Content-Type` correcto, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable`, `ETag`; 404 `text/plain` si no existe). **Sin listados ni enumeración** y fuera de `sitemap.xml`.
- Orfandad: el `MediaAsset` se borra al eliminar la diapositiva o reemplazar su imagen (best effort, solo si nadie más lo referencia). Una subida cuyo guardado posterior falla puede quedar huérfana; limitación aceptada.

---

## 3. RBAC — jerarquía de roles

`GUEST < USER < MODERATOR < ADMIN < SUPER_ADMIN`

| Rol | Persistido | Rango | Capacidades |
| --- | --- | --- | --- |
| `GUEST` | No (ausencia de sesión; `req.authUser === null`) | — | Lectura pública de mapa, catálogo, guías y noticias. Del **foro**, solo la lista en vivo en formato *preview* (sin contenido, respuestas, filtros, búsqueda ni votos: `LeonidApp-UI-NUI-DesignSpec.md` §7.5). Progreso solo local (IndexedDB). Puede enviar `contact` y `newsletter`. |
| `USER` | Sí (default) | 0 | Progreso sincronizado, crear hilos/posts, votar, crear `Submission` (`marker`, `entity`, `correction`). |
| `MODERATOR` | Sí | 1 | Lo anterior + fijar/ocultar hilos, revisar `Submission`. Sus propios aportes se aprueban automáticamente (§5). |
| `ADMIN` | Sí | 2 | Lo anterior + CRUD de `Module`, `Entity`, `MapMarker`; bandeja `contact`; carrusel del Hero (`AppConfig.hero_slides`) y subida de `MediaAsset`. |
| `SUPER_ADMIN` | Sí | 3 | Lo anterior + panel **Control Total**: cambio de roles, `AppConfig` (incluido `monetization` y proveedores de auth), fuentes de noticias, lectura de `AuditLog`. |

Reglas:

- `ROLES` en código: `['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN']`; `GUEST` es un estado del cliente (`useAuthStore.status = 'guest'`), nunca un valor de `User.rol`.
- Autorización **solo en servidor**: `plugins/auth.ts` resuelve `req.authUser` en `onRequest` leyendo el rol desde la BD en cada petición; las rutas usan `requireAuth` o `requireRole(minRole)` (rango ≥ mínimo). Sin sesión → `401`; rango insuficiente → `403`.
- Un `SUPER_ADMIN` no puede degradarse a sí mismo si es el único `SUPER_ADMIN`.
- La UI oculta acciones por rol solo de forma cosmética.

---

## 4. Autenticación OAuth2 + PKCE con cookies HttpOnly

**Máximo 4 botones** en la pantalla de acceso, en este orden: **Google**, **Discord**, **Apple**, **Magic Link**. El acceso "Entrar como Invitado" no es un proveedor de identidad y no cuenta como botón de proveedor. `AppConfig.enabled_auth_providers` puede ocultar proveedores, nunca añadir.

### 4.1 Flujo OAuth2 + PKCE (Google, Discord, Apple)

1. Cliente → `GET /api/auth/:provider/start?next=<ruta>` (web) o con `?platform=native` (Capacitor).
2. Servidor genera `state` y `code_verifier` (43–128 chars), calcula `code_challenge = BASE64URL(SHA256(verifier))`, y los guarda en una cookie efímera firmada `HttpOnly; Secure; SameSite=Lax; Max-Age=600` (nunca en el cliente JS).
3. Redirección `302` al proveedor con `response_type=code`, `code_challenge`, `code_challenge_method=S256`, `state`.
4. Proveedor → `GET /api/auth/:provider/callback?code&state`. El servidor valida `state`, canjea `code` + `code_verifier`, obtiene `subject`/email y hace upsert de `User` por `identities.{provider,subject}`.
5. El servidor emite la cookie de sesión y borra la cookie PKCE. Redirige a `next` (validado como ruta interna) o, en nativo, a `leonidapp://auth/callback`.
6. Apple usa `response_mode=form_post`: el callback acepta `POST`.

### 4.2 Magic Link

`POST /api/auth/magic-link { email }` (rate limit) → token aleatorio de un solo uso (hash almacenado en servidor, TTL 15 min) enviado por `services/mailer.ts` → `GET /api/auth/magic-link/verify?token` → misma emisión de sesión que §4.1 paso 5.

### 4.3 Cookie de sesión

| Atributo | Valor |
| --- | --- |
| Nombre | `SESSION_COOKIE` (`services/session.ts`) |
| Contenido | ID de sesión firmado; el cliente nunca lo lee |
| Flags | `HttpOnly; Secure; SameSite=Lax; Path=/` (en nativo Capacitor: `SameSite=None; Secure`) |
| Duración | 30 días, rotación al renovar |
| Cierre | `POST /api/auth/logout` invalida en servidor y borra la cookie |

PROHIBIDO tokens en `localStorage`, `sessionStorage`, IndexedDB o en la URL. El cliente solo conoce el estado de sesión vía `GET /api/auth/me`. Las peticiones mutantes requieren cabecera `Origin` válida (CSRF).

---

## 5. Regla de aprobación automática `Submission` → `MapMarker` / `Entity`

**Disparadores** (cualquiera de los dos):

- **A. Revisión manual:** `PATCH /api/admin/submissions/:id { status: 'approved', coords? }` por `MODERATOR+` (`coords` solo al aprobar; se escribe en la Submission `marker` antes de promover).
- **B. Autor de confianza:** al crear (`POST /api/submissions`), si el autor tiene rango `≥ MODERATOR`, el servidor la marca `approved` con `reviewedBy: 'system'` y ejecuta la promoción en la misma petición.

**Promoción** (servicio `services/submissions.ts#promote`, en una transacción Mongo):

| `type` | Validación previa | Resultado |
| --- | --- | --- |
| `marker` | `coords` no nulo (al aprobar, `PATCH /api/admin/submissions/:id` admite `coords: {x,y}` en el cuerpo para ubicar el pin; sin ellas responde 422 «Falta ubicar el pin…» y el aporte sigue `pending`); `payload` valida con `mapMarkerSchema` (`region`, `titulo`, `descripcion?`, `entity_id?`, `media_url?`) | `MapMarker.create({ ...payload, coord: coords })` |
| `entity` | `moduleSlug` existe y `activo`; `payload` valida con `entitySchema` (sin `module_id`, que se resuelve desde `moduleSlug`) | `Entity.create({ ...payload, module_id })` |
| `correction` | `payload = { target: 'Entity' \| 'MapMarker', id, patch }`; `patch` valida con el schema `.partial()` | `updateOne` del documento destino |
| `contact`, `newsletter` | — | **Nunca se promueven.** Solo bandeja ADMIN; `approved` = atendido. |

Reglas:

1. Si la validación Zod del `payload` falla, la `Submission` queda `pending` y la API responde `422` con los errores; nada se escribe.
2. Éxito → `status: 'approved'`, `reviewedBy`, `promotedTo: { collection, id }` y `AuditLog` `submission.approved` + `marker.created` / `entity.created` / `<target>.updated`.
3. Idempotencia: si `promotedTo` ya existe, no se promueve de nuevo.
4. `rejected` nunca crea ni modifica documentos destino.
5. El cliente invalida las consultas TanStack de mapa/catálogo tras la promoción.

---

## 6. Índices obligatorios (resumen)

| Colección | Índice |
| --- | --- |
| `User` | `email` único parcial · `discord_id` único parcial · `identities.provider + identities.subject` |
| `AppConfig` | `key` único |
| `Module` | `slug` único |
| `Entity` | `{ module_id, categoria }` · **Δ** `{ module_id, slug }` único |
| `MapMarker` | `{ coord: '2d' }` (min 0, max 1000) · `{ region }` · **Δ** `{ slug }` único *sparse* · **Δ** `{ entity_id }` |
| `UserProgress` | `{ user_id, target_type, target_id }` único |
| `OfficialNews` | `sourceUrl` único · `publishedAt: -1` · **Δ** `slug` único |
| `Submission` | `userId` · `{ status, createdAt: -1 }` |
| `ForumThread` | `{ categoria, created_at: -1 }` · `entity_id` parcial |
| `ForumPost` | `thread_id` |
| `ForumVote` | `{ user_id, target_type, target_id }` único |
| `MediaAsset` | solo `_id` |
| `AuditLog` | `{ created_at: -1 }` · `{ actor_id, created_at: -1 }` · **Δ** `{ target_type, target_id, created_at: -1 }` (historial de un objeto) |

## Anexo. Exposición pública y respuestas uniformes

- **Hero y medios:** `GET /api/hero` (público, `Cache-Control: public, max-age=30`, ETag débil) solo expone las diapositivas activas sin `activa` ni `orden`; `GET /api/admin/hero` y `PUT /api/admin/hero` (ADMIN+) y `POST /api/admin/media` (ADMIN+) devuelven el 404 uniforme sin sesión de staff (RBAC antes que Zod y antes del parser binario). `GET /media/:id` es público, sin listados, con `nosniff` y caché inmutable; un id inexistente responde 404 `text/plain`.
- **Foro público:** la proyección pública de autores expone solo `id`, `username` y `avatar_url` (nunca `rol` ni `email`).
- **Superficie administrativa:** `/api/admin/*` y los POST/PATCH/DELETE administrativos de catálogo, mapa, roles, configuración y auditoría devuelven un **404 genérico** (idéntico al de una ruta inexistente) a quien no tenga sesión de staff autorizada; el RBAC se evalúa antes que la validación Zod. Lectura de `AuditLog`, cambio de roles, revocación de sesiones, configuración, salud del sistema y caché: `SUPER_ADMIN`. Moderación de aportes y foro: `MODERATOR+`. Catálogo, mapa, módulos y estado/ejecución del worker de noticias: `ADMIN+`.
- **Panel `/_staff` (resumen, historial, restauración, dependientes):** `GET /api/admin/overview` (Resumen Operativo, `MODERATOR+`, `Cache-Control: private, no-store`; contenido filtrado por rol: MODERATOR ve los aportes de moderación —sin contact/newsletter— y sus propias acciones; ADMIN+ añade worker de noticias, cobertura del catálogo y pines huérfanos; SUPER_ADMIN ve las últimas 10 acciones de todos), `GET /api/admin/submissions/pending-count` (`MODERATOR+`, insignia de pendientes), `GET /api/admin/dependents/:type/:id` (`type ∈ thread|entity|marker|module`; `thread` MODERATOR+, el resto ADMIN+; recuentos y títulos para la confirmación de borrado), `GET /api/admin/history?target_type&target_id` (`MODERATOR+`; SUPER_ADMIN ve todo el historial del objeto, el resto solo sus propias entradas y sin `snapshot`) y `POST /api/admin/audit-logs/:id/restore` (`SUPER_ADMIN`). Todos devuelven el 404 uniforme a quien no corresponda.
- **404 de negocio vs 404 uniforme:** el 404 uniforme (ruta inexistente o sin autorización de staff) lleva el cuerpo exacto `{"error":"No encontrado"}` y es indistinguible de una ruta inexistente. Un 404 de recurso que solo ve un staff ya autorizado lleva además `code: "RESOURCE_NOT_FOUND"` (p. ej. `{"error":"Entidad no encontrada","code":"RESOURCE_NOT_FOUND"}`); el cliente del panel solo se considera «sin acceso» ante el 404 **sin** `code`. Un borrado con dependientes responde `409` con `code: "HAS_DEPENDENTS"` y `details` (recuento y títulos). Nunca se emite un código distinto de 404 a quien no es staff.
- **`GET /api/entities`:** admite `?limit=&page=`, `?module=`, `?id=` (una ficha concreta) y `?q=` (búsqueda por título o slug; es la búsqueda remota del selector único de fichas `EntityPicker`, sin cargar el catálogo entero); respuesta comprimida con `Cache-Control`/`ETag`.
- Cifras vigentes del catálogo: 243 `Entity` (armas 13, vehículos 200, guías 20, mapa 10), 10 `MapMarker`, 1 `OfficialNews`.
