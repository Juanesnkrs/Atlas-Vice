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

## 2. Las 12 colecciones

Las colecciones aprobadas son 12 grupos lógicos (el grupo Foro se compone de 3 modelos):

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
12. **Δ** `PipelineRun` (registro de cada ejecución del pipeline de datos y catálogo, §2.12)

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

**API de módulos y registro módulo↔ruta (`services/moduleRoutes.ts`, fuente única).** Un módulo solo puede estar `activo` si su `slug` figura en el registro: `mapa` (`/mapa`, sección), `armas`, `vehiculos`, `coleccionables` (`/catalogo/<slug>`, categoría), `foro` (`/foro`, sección) y `guias` (`/guias`, categoría). `radio` no está registrado (su pantalla pública es v1.1): se siembra `activo:false` y no puede activarse.

- `POST /api/modules` y `PATCH /api/modules/:id` responden `422` con `code: "MODULE_WITHOUT_PUBLIC_ROUTE"` si el resultado dejaría `activo: true` un slug sin registrar. Como `activo` es `true` por defecto, un módulo nuevo sin ruta solo se crea con `activo:false` explícito. Desactivar siempre se permite.
- `GET /api/modules` (público y `?all=1`) añade el campo **derivado** de solo lectura `fichas: number` (conteo de `Entity` del módulo, una consulta agregada). No existe en el esquema Mongoose ni en `moduleSchema`; el cliente lo usa para ocultar pestañas de categoría vacías. Mantiene el caché público (`sendPublicJson`).
- `GET /api/admin/modules/overview` (ADMIN+; 404 uniforme sin staff, RBAC antes de Zod) devuelve `{ modules: [{ id, slug, nombre, activo, orden, tipo: 'seccion'|'categoria'|'sin_pantalla', ruta_publica, staff_seccion, fichas, pines, visible_en_publico }] }`. `visible_en_publico = activo && ruta_publica !== null && (tipo === 'seccion' || fichas > 0)`; `pines` es el total de `MapMarker` para `mapa` y los enlazados por `entity_id` a fichas del módulo para el resto.
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
| **Δ** `contentHash` | String \| null | `z.string().regex(/^[a-f0-9]{64}$/).nullable().optional()` | SHA-256 (hex) del contenido canónico de la ficha (`titulo`, `subtitulo`, `categoria`, `imagen_url`, `stats_json`, `metadata_json` con claves ordenadas). Lo calcula el pipeline (§2.12) para la idempotencia: mismo hash → `sin_cambios`, sin escritura (si la ficha existente no lo tiene, se calcula al vuelo). `PATCH /api/entities/:id` lo recalcula y añade a `manualEdits` los campos de contenido que cambia; el cliente nunca los envía. No se expone en el DTO público. Con `marker` o `tarjeta` en la ficha del pipeline también entran en el hash (ver §2.12). |
| **Δ** `manualEdits` | String[] (por defecto `[]`) | `z.array(z.string().max(60)).default([])` | Campos de la ficha editados a mano en `/_staff`. El pipeline nunca los sobrescribe: si un lote cambia uno de ellos, el ítem se registra como `conflicto` y entra como `Submission` de origen `pipeline` (§2.8). |
| **Δ** `capturaPropiaPendiente` | Boolean (por defecto `false`) | `z.boolean().default(false)` | `true` mientras la ficha no tiene captura propia (`imagen_url: null` permitida). Permite listar en el panel las fichas sin imagen. Se expone como booleano en el DTO público (`toEntityDTO`) para que la UI marque la tarjeta como provisional; `contentHash` y `manualEdits` siguen sin exponerse. |
| `created_at` | Date | — | |

Los tres campos nuevos son opcionales: las 243 fichas existentes siguen siendo válidas sin migración. La política de `imagen_url` para lotes del pipeline es: solo `null` o una ruta interna permitida (cero hotlinking, §2.12).

**Claves canónicas de `metadata_json` (contrato de ingesta).** `metadata_json` sigue siendo un registro libre (`jsonRecordSchema`, sin campos nuevos en `Entity`), pero la ingesta (`services/catalogIngest.ts`, función pura `canonicalizeMetadata`, usada por `POST /api/pipeline/ingest` y por `import:catalog`) lo lleva a estas claves, que son las que lee el cliente:

| Clave canónica | Alias aceptados en la ingesta | Notas |
| --- | --- | --- |
| `descripcion` | 1er nivel de la ficha: `descripcion`, `descripcion_es`, `description`, `summary`; dentro de `metadata`: `descripcion`, `descripcion_es`, `description`, `summary` | Texto original en español, ≤ 4000 caracteres tras `trim`. Manda el primer valor no vacío (1er nivel antes que `metadata`); todos los alias se eliminan. Un valor no textual o por encima del límite **rechaza la ficha** con motivo. Es la fuente de la `description` de SSR-lite (§1.6 de Rutas) y del texto largo de la ficha. |
| `steps` | `steps` o `pasos`, en 1er nivel o en `metadata` | `[{ id?, title, body }]` (máx. 50 pasos; `title` ≤ 160, `body` ≤ 4000, si no se rechaza la ficha). Acepta ítems `{ title, body }`, `{ titulo, texto }`, `{ name, text }` o un texto suelto (`title: "Paso n"`). `pasos` nunca se duplica; un ítem vacío se descarta con aviso. Alimenta el `HowTo` de las guías. |
| `marca` | `fabricante` | Vehículos y armas. |
| `plazas` | `asientos` | Vehículos. |
| `municion` | `cargador` | Armas. |
| `ubicacion` | `lugar` | Guías y puntos de interés. |

Si llegan a la vez el alias y la clave canónica con valor, **manda la canónica** y el alias se elimina. Claves que se conservan tal cual: `clase`, `traccion`, `marchas`, `peso_kg`, `basado_en`, `apariciones`, `carroceria`, `precio`, `velocidad_punta`, `aceleracion`, `adquisicion`, `slot`, `dano`, `cadencia`, `alcance`, `genero`, `presentador`, `num_pistas`, `numero_mision`, `tipo_mision`, `capitulo`, `protagonistas`, `requisito_100`, `recompensa_dinero`, `recompensa_logro`, `region`. Las pone el servidor: `fuente`, `confianza`, `evidencia`, `stats_juego` y `notas` (solo notas editoriales; no las de plantilla). `fuente_url` puede permanecer.

Reglas de limpieza de `metadata`:

- **No se guardan nulos ni vacíos:** valores `null`, `undefined` o texto en blanco se eliminan.
- **Ruido de pipeline que no llega a `metadata_json` público:** `requiere_redaccion`, `estado_verificacion`, `stats_verificadas`, `howto_pendiente`, `fuente_ruta`, `fuente_dato` y las `notas` de plantilla (las que empiezan por «Redactar…»).
- **`captura_propia_pendiente`** (en `metadata`) y **`capturaPropiaPendiente`** (1er nivel) se convierten en el flag de servidor `capturaPropiaPendiente` del payload del `Submission` y se quitan de `metadata`.
- **Nada se descarta en silencio:** una clave de 1er nivel desconocida se ignora pero se informa en `details[].avisos` de la respuesta de ingesta (no cambia `resultado`); no se rechaza por ello.
- La `Entity` no tiene un campo propio de descripción: el texto largo vive en `metadata_json.descripcion`.

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
| **Δ** `origin` | `'user' \| 'pipeline'` (por defecto `'user'`) | `z.enum(['user','pipeline']).default('user')` | Origen del aporte. `'pipeline'` marca los ítems que llegan por `POST /api/pipeline/ingest` (§2.12): `userId: null`, `type: 'entity'`, `payload` = ficha validada y el motivo (`nueva`, `actualizada` o `conflicto`) en `payload.pipeline_reason`. Nunca se aprueban automáticamente (§5): requieren moderación. La regla «`userId` solo puede ser `null` en `contact`/`newsletter`» se amplía a «… o `origin = 'pipeline'`». |
| **Δ** `payload` de origen `pipeline` | Mixed | `jsonRecordSchema` | Ficha validada y normalizada (claves canónicas de §2.4) más: `contentHash`, `pipeline_reason` (`nueva`/`actualizada`/`conflicto`), `pipeline_run_id`, `conflict_fields?`, `capturaPropiaPendiente?` (flag de servidor), `marker?` y **`tarjeta?: { mime: 'image/webp', base64, sha256, bytes }`**. La tarjeta es una imagen provisional WebP 1600×900 ≤ 400 KB validada con la misma lógica que `POST /api/admin/media` (firma real y cabecera); una tarjeta inválida **rechaza solo esa ficha** y no entra en la `Submission`. `tarjeta` e `imagen_url` son excluyentes. El `base64` **nunca** se devuelve en JSON (listados y `PATCH`): `toSubmissionDTO` lo sustituye por `{ bytes, sha256 }` y la miniatura se lee con `GET /api/admin/submissions/:id/tarjeta.webp` (MODERATOR+, §1.6 de Rutas). No se copia a `Entity`, `AuditLog` ni logs. |
| **Δ** Resolución de conflicto (`pipeline_reason = 'conflicto'`) | — | — | Política vigente (S2.3): se **conserva el texto editorial** y se rechazan los cambios de texto del pipeline; la imagen provisional solo se aprovecha si la ficha no tiene `imagen_url`. `GET /api/admin/submissions/:id/compare` y `POST /api/admin/submissions/:id/resolve` (`mantener`/`aceptar`/`solo_imagen`, ver §1.6 de Rutas) la implementan sin campos nuevos: `mantener` → `status: 'rejected'` + `reviewNote`; `solo_imagen` → `status: 'approved'`, `promotedTo: { Entity, id }`, `reviewNote` «Solo imagen…» y `payload.pipeline_resolution = 'solo_imagen'` (`payload` es Mixed); solo toca `Entity.imagen_url`, `capturaPropiaPendiente` y `metadata_json.fuente_imagen`/`fuente_url`, sin añadir `imagen_url` a `manualEdits` ni cambiar `contentHash`. `aceptar` nunca pisa una ficha con `manualEdits` (422). Auditoría `submission.resolve`. |
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
| **Δ** `actor_label` | String \| null (opcional) | Etiqueta legible para actores que no son usuarios, p. ej. `"system:pipeline"`; se usa junto a `actor_id: 'system'` para saber qué proceso actuó. El panel permite filtrar por ella. `z.string().max(60).nullable().optional()`. |
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

Imágenes subidas desde el panel (diapositivas del Hero, §2.2) y tarjetas provisionales de fichas del pipeline (§2.12). Se guardan en MongoDB como binario: sin disco, sin servicio externo y sin librerías.

| Campo | Tipo Mongoose | Zod | Notas |
| --- | --- | --- | --- |
| `_id` | String (UUID) | `z.uuid()` | Identificador público: `GET /media/:id`. |
| `mime` | String enum | `z.enum(['image/webp', 'image/jpeg'])` | Solo estos dos tipos. |
| `width` / `height` | Number | `z.literal(1600)` / `z.literal(900)` | Leídos de la cabecera real del archivo. |
| `bytes` | Number | `z.number().int().positive().max(614400)` (`MEDIA_MAX_BYTES_MANUAL`) | Tope del principal ≤ 600 KB. El Hero (canvas) y la tarjeta del pipeline siguen limitados a 400 KB (`MEDIA_MAX_BYTES = 409600`) por sus propias validaciones de ruta/ingesta. |
| `data` | Buffer | `z.instanceof(Buffer)` | Contenido binario; nunca viaja en JSON. |
| **Δ** `thumb_data` | Buffer (opcional) | `z.instanceof(Buffer).optional()` | Variante móvil WebP 800×450 (solo cargas manuales del Estudio). Los assets antiguos no la tienen y siguen siendo válidos. Nunca viaja en JSON; toda proyección que excluye `data` excluye también `thumb_data`. |
| **Δ** `thumb_bytes` | Number (opcional) | `z.number().int().positive().optional()` | Tamaño de la miniatura (objetivo ≤ 180 KB, mejor esfuerzo: superarlo no es error). |
| **Δ** `thumb_width` / `thumb_height` | Number (opcional) | `z.literal(800).optional()` / `z.literal(450).optional()` | Dimensiones de la miniatura. |
| `created_by` | String (UUID de `User` o `'system'`) | `z.union([z.uuid(), z.literal('system')])` | Quién la subió; `'system'` si la crea `promote()` desde la tarjeta de una ficha del pipeline sin revisor humano. |
| `created_at` | Date | `z.coerce.date().optional()` | Solo creación. |

- Subida: `POST /api/admin/media` (ADMIN+, 404 uniforme sin staff) con cuerpo **binario** (`Content-Type: image/webp` o `image/jpeg`, sin multipart; parser de cuerpo crudo propio solo en esa ruta, `bodyLimit` 600 KB). El servidor valida tipo, **firma mágica real** (WebP `RIFF…WEBP`; JPEG `FFD8FF`), tamaño ≤ 400 KB y dimensiones exactas 1600×900 leídas de la cabecera (JPEG: marcador SOF; WebP: VP8 / VP8L / VP8X), con código propio. Rate-limit 20/min por IP. Auditoría `media.upload`. Responde `201 { id, url: '/media/<id>', mime, width, height, bytes }`.
- **Reemplazo manual de imagen de una ficha (Estudio de Imágenes, Sprint 3):** `POST /api/admin/entities/:id/image[?focus=x,y][&alt=<texto ≤ 200>]` (ADMIN+, 404 uniforme sin staff; cuerpo binario `image/jpeg`, `image/png` o `image/webp` hasta 12 MB, rate-limit 20/min). Procesa `processManualImage` (`server/src/services/imageStudio.ts`, pura): valida el formato real con `sharp` (límite 60 MP), rota según EXIF, **exige ≥ 1600×900** (si no, 400 «La imagen debe medir al menos 1600×900 px (recibida W×H)»; nunca amplía), recorta con `fit: cover` (sin barras ni recuadros) a **1600×900** con foco opcional (`focus` 0–100 desplaza el recorte; por defecto centro) y genera **dos WebP desde el mismo recorte**: principal 1600×900 con tope **600 KB** (calidad 82 bajando por 78/74/70/66/62 hasta mínimo 60; si no cabe → 400 con mensaje claro) y miniatura 800×450 (calidad 78 bajando hasta 46 buscando ≤ 180 KB; mejor esfuerzo). Guarda ambas en un `MediaAsset` nuevo, fija `Entity.imagen_url = '/media/<id>'` (entra en `manualEdits`), `capturaPropiaPendiente = false` (campo ya existente), elimina las claves homónimas de `metadata_json` y, si llega `alt`, lo guarda en `metadata_json.imagen_alt` (si no llega no toca el existente). Borra el `MediaAsset` anterior solo si era `/media/<id>` y nadie más lo usa. Audita `entity.image.replace` (bytes de ambas variantes y `cropped`) y `media.delete`. Responde `200 { id, url, bytes, thumb_bytes, width: 1600, height: 900, cropped, capturaPropiaPendiente: false }` (`cropped` = la proporción de origen no era 16:9). `GET /api/entities?provisional=1` lista las fichas con imagen provisional.
- **Cola de trabajo:** `GET /api/admin/images/queue?module=&q=&estado=pendientes|todas&page=&limit=` (ADMIN+, 404 uniforme, `Cache-Control: private, no-store`; `limit` ≤ 100). `pendientes` (por defecto) = `capturaPropiaPendiente` o sin `imagen_url`. Una sola consulta agregada (`$facet`). Responde `{ items: [{ id, slug, titulo, module_slug, imagen_url, capturaPropiaPendiente, imagen_alt }], total, page, pages, stats: { total, sin_imagen, provisionales, propias }, stats_por_modulo: { <slug>: stats } }`; `propias` = `imagen_url` `/media/…` con `capturaPropiaPendiente = false` (cuenta para la puerta de las 40 imágenes propias); `stats` es global (no depende de `q`, `module` ni `estado`).
- **Emparejado por slug:** `GET /api/admin/images/match?slugs=a,b,c[&module=<slug>]` (ADMIN+, 404 uniforme, máx. 200 slugs, normalizados a minúsculas) → `{ matches: { <slug>: { estado: 'encontrada' | 'ambigua' | 'no_encontrada', candidatos: [{ id, module_slug, slug, titulo, imagen_url, capturaPropiaPendiente }] } } }`; `ambigua` si el slug existe en más de un módulo y no se filtró por `module`.
- Lectura pública: `GET /media/:id[?w=800]` (solo imágenes; `Content-Type` correcto, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable`, `Content-Length`; 404 `text/plain` si no existe). `?w=800` (único valor admitido; otros se ignoran) sirve la miniatura 800×450 si el asset la tiene y, si no, el principal. `ETag` por variante: `"<id>"` (principal) y `"<id>-800"` (miniatura); `If-None-Match` → 304 por variante. **Sin listados ni enumeración** y fuera de `sitemap.xml`.
- **Limpieza al borrar una ficha (S3.5):** `DELETE /api/entities/:id` elimina también su `MediaAsset` `/media/<id>` si ninguna otra ficha ni diapositiva del Hero lo usa (best effort: un fallo de limpieza se registra como aviso y no hace fallar el borrado), y audita `media.delete`. Lógica en `removeOrphanMedia` (`imageStudio.ts`). No existe script de huérfanos históricos: los assets huérfanos previos a este cambio solo se detectan cruzando `MediaAsset._id` con `Entity.imagen_url` y `hero_slides`.
- Orfandad: el `MediaAsset` se borra al eliminar la diapositiva o reemplazar su imagen (best effort, solo si nadie más lo referencia). Una subida cuyo guardado posterior falla puede quedar huérfana; limitación aceptada.
- **Δ Tarjetas del pipeline:** `promote()` de un aporte `origin: 'pipeline'` con `payload.tarjeta` crea un `MediaAsset` (`created_by` = UUID del revisor, o `'system'` si lo promueve el sistema; el Zod admite `uuid` o el literal `'system'`) **dentro de la misma transacción** que la `Entity` y fija `imagen_url = '/media/<id>'` con `capturaPropiaPendiente = true` (imagen provisional). No se crea nada si el aporte se rechaza o no se aprueba. En una ficha existente la tarjeta solo reemplaza una `imagen_url` vacía o ya `/media/…`; si `manualEdits` incluye `imagen_url` (o la imagen es un asset editorial `/assets/…`) no se aplica ni se crea el `MediaAsset`. El asset reemplazado queda huérfano (limitación aceptada, como en §2.11).

### 2.12 `PipelineRun` — `models/PipelineRun.ts`

Registro de cada ejecución del pipeline de datos y catálogo (ETL externo que envía lotes por `POST /api/pipeline/ingest`; contrato en `docs/LeonidApp-Rutas-SEO-Monetizacion.md` §1.6). Colección #12.

| Campo | Tipo Mongoose | Zod | Notas |
| --- | --- | --- | --- |
| `_id` | String (UUID) | `z.uuid().optional()` | Es el `runId` de la respuesta. |
| `startedAt` | Date | `z.coerce.date()` | Inicio de la ejecución. |
| `finishedAt` | Date \| null | `z.coerce.date().nullable()` | `null` mientras `status` es `queued` o `running`. |
| `status` | String enum | `z.enum(['queued','running','ok','error'])` | |
| `trigger` | String enum | `z.enum(['push','manual','scheduled'])` | `push`: el pipeline envía el lote; `manual`: lo pide el staff con «Sincronizar ahora» (o, en noticias, un disparo manual del worker); `scheduled`: ciclo del cron del worker de noticias. |
| `source` | String | `z.string().min(1).max(40)` | Origen declarado del lote (p. ej. `gtabase`). |
| `modulo` | String | `z.string().min(1).max(60)` | Slug de `Module` destino. |
| `archivo` | String \| null | `z.string().max(160).nullable()` | Nombre del archivo del lote, si lo hay. |
| `dryRun` | Boolean | `z.boolean()` | En simulación no se escribe ninguna `Submission`, pero sí el `PipelineRun`. |
| `counts` | `{ created, updated, unchanged, conflicts, rejected }` | `z.object({ …: z.number().int().min(0) })` | Equivalen a `nuevas`, `actualizadas`, `sin_cambios`, `conflictos` y `rechazados` de la respuesta. |
| `rejected` | `{ slug, reason }[]` | `z.array(z.object({ slug: z.string(), reason: z.string().max(300) }))` | Ítems descartados por validación Zod, con su motivo (máx. 200 por ejecución). |

Índice `{ startedAt: -1 }`. Solo se actualizan `status`, `finishedAt`, `counts` y `rejected` al cerrar la ejecución.

**Reglas de datos del pipeline:**

- Validación Zod **ítem por ítem** sin abortar el lote: un ítem inválido va a `rejected` y el resto continúa.
- `imagen_url` solo puede ser `null` o una ruta interna permitida (cero hotlinking); una URL externa rechaza el ítem.
- Idempotencia por `contentHash`: si el hash de la ficha entrante coincide con el de la `Entity` existente (`module_id` + `slug`), cuenta como `sin_cambios` y no se escribe nada.
- Todo ítem **nuevo, actualizado o en conflicto** se guarda como `Submission` con `origin: 'pipeline'`; el pipeline **no publica directo** en `Entity`. La promoción sigue la revisión manual de §5 (`MODERATOR+`) y, al promover, se actualiza `contentHash`.
- **Δ Regla de conflicto por fuente y excepción de transición (D-03):** si la `Entity` existente lleva `metadata_json.fuente` distinta de la del lote, la ficha pertenece a esa fuente y el ítem es `conflicto`. **Excepción:** si la existente tiene `metadata_json.confianza === 'baja'` (extracto externo antiguo) **y** `manualEdits` vacío o ausente, el ítem es `actualizada`; al promoverse conserva `_id`/`slug` y pasa a llevar la `confianza` y `fuente` del lote. Las fichas editoriales (`confianza` `media`/`alta`) o con cualquier campo en `manualEdits` siguen siendo `conflicto` (la editorial gana). Las claves `fuente_url` y `fuente_imagen` (hostname del origen de la imagen de la tarjeta, solo si hay tarjeta) viajan en `metadata_json` como procedencia; la tarjeta deja `capturaPropiaPendiente = true`.
- Cada ejecución crea su `PipelineRun` y un evento resumen `pipeline.batch` en `AuditLog` (`actor_id: 'system'`, `actor_role: 'system'`, `actor_label: 'system:pipeline'`, `target_type: 'pipeline_run'`, `target_id: <runId>`, `metadata = { source, modulo, archivo, dryRun, counts }`).
- **Δ Ciclos del worker de noticias (`kind: 'noticias'`):** cada ciclo de `workers/officialNewsWorker.ts` se registra como un `PipelineRun` con `source: 'news'`, `modulo: 'noticias'`, `trigger: 'scheduled'` (cron de 15 min) o `'manual'` (disparo desde el panel), `counts.created` = noticias insertadas, `counts.rejected` = fuentes con error (cada una en `rejected` como `{ slug: <id de fuente>, reason }`), `status: 'ok'` si ninguna falló y `'error'` si alguna falló, y un `AuditLog` `news.batch` (`actor_id: 'system'`, `actor_role: 'system'`, `actor_label: 'system:news'`, `target_type: 'pipeline_run'`). El DTO añade `kind: 'catalogo' | 'noticias'` (derivado de `modulo`); `GET /api/admin/pipeline/runs` excluye los de noticias de `runs` y de `estado` salvo `?kind=noticias|todos` (los de noticias nunca cuentan para «activo»/«en curso» del ETL de catálogo ni bloquean «Sincronizar ahora»).
- **Δ Marker y tarjeta en el hash:** el `contentHash` de ingesta incluye el `marker` de la ficha (`region`, `coord_x`, `coord_y`, `descripcion`, `slug?`) **solo cuando existe**, y el `sha256` de la tarjeta (con `imagen_url` fijado a `null` en el hash) **solo cuando hay tarjeta**; así los hashes de fichas sin marker ni tarjeta no cambian. Añadir, quitar o mover el marker o cambiar la tarjeta hace la ficha `actualizada`.
- **Δ Módulos fuera de los cinco base:** el catálogo editorial cubre `armas`, `vehiculos`, `coleccionables`, `guias` y `mapa`. Cualquier otro `modulo` (p. ej. `radio`) exige un `Module` activo y una vista en el cliente: es una **decisión pendiente**; hoy no se crean módulos nuevos y un lote hacia un módulo inexistente responde `422`.

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
| `entity` | `moduleSlug` existe y `activo`; `payload` valida con `entitySchema` (sin `module_id`, que se resuelve desde `moduleSlug`) | `Entity.create({ ...payload, module_id })`. Con `origin: 'pipeline'` y una ficha ya existente (`module_id` + `payload.slug`) **actualiza esa ficha** (sin tocar `slug`, `manualEdits` ni `capturaPropiaPendiente`; fija `contentHash`) en lugar de crear otra; `payload.marker` hace `upsert` del pin por `entity_id` |
| `correction` | `payload = { target: 'Entity' \| 'MapMarker', id, patch }`; `patch` valida con el schema `.partial()` | `updateOne` del documento destino |
| `contact`, `newsletter` | — | **Nunca se promueven.** Solo bandeja ADMIN; `approved` = atendido. |

- **Δ Pipeline en `promote()`:** además de lo anterior, una ficha con `payload.tarjeta` crea su `MediaAsset` y fija `imagen_url` (§2.11); el slug del pin del `marker` es único: si `payload.marker.slug` (o el slug de la ficha) ya existe se usa `-2`, `-3`… en lugar de omitirlo; y `capturaPropiaPendiente = true` en el payload se aplica a la ficha existente al actualizarla.

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
| `Submission` | `userId` · `{ status, createdAt: -1 }` · **Δ** `{ origin, status, createdAt: -1 }` · **Δ** `{ origin, 'payload.pipeline_run_id', status }` (filtro por lote) |
| `ForumThread` | `{ categoria, created_at: -1 }` · `entity_id` parcial |
| `ForumPost` | `thread_id` |
| `ForumVote` | `{ user_id, target_type, target_id }` único |
| `MediaAsset` | solo `_id` |
| `PipelineRun` | **Δ** `{ startedAt: -1 }` |
| `AuditLog` | `{ created_at: -1 }` · `{ actor_id, created_at: -1 }` · **Δ** `{ target_type, target_id, created_at: -1 }` (historial de un objeto) |

## Anexo. Exposición pública y respuestas uniformes

- **Hero y medios:** `GET /api/hero` (público, `Cache-Control: public, max-age=30`, ETag débil) solo expone las diapositivas activas sin `activa` ni `orden`; `GET /api/admin/hero` y `PUT /api/admin/hero` (ADMIN+) y `POST /api/admin/media` (ADMIN+) devuelven el 404 uniforme sin sesión de staff (RBAC antes que Zod y antes del parser binario). `GET /media/:id` es público, sin listados, con `nosniff` y caché inmutable; un id inexistente responde 404 `text/plain`.
- **Pipeline de datos:** `POST /api/pipeline/ingest` queda fuera de `/api/admin/*` y de la sesión por cookies (solo `Authorization: Bearer <PIPELINE_INGEST_TOKEN>`, verificado con `timingSafeEqual`); sin token válido devuelve el 404 uniforme antes de parsear el cuerpo. `GET /api/admin/pipeline/runs` y `POST /api/admin/pipeline/trigger` son `ADMIN+` y dan el 404 uniforme sin staff. Contrato en `docs/LeonidApp-Rutas-SEO-Monetizacion.md` §1.6.
- **Foro público:** la proyección pública de autores expone solo `id`, `username` y `avatar_url` (nunca `rol` ni `email`).
- **Superficie administrativa:** `/api/admin/*` y los POST/PATCH/DELETE administrativos de catálogo, mapa, roles, configuración y auditoría devuelven un **404 genérico** (idéntico al de una ruta inexistente) a quien no tenga sesión de staff autorizada; el RBAC se evalúa antes que la validación Zod. Lectura de `AuditLog`, cambio de roles, revocación de sesiones, configuración, salud del sistema y caché: `SUPER_ADMIN`. Moderación de aportes y foro: `MODERATOR+`. Catálogo, mapa, módulos y estado/ejecución del worker de noticias: `ADMIN+`.
- **Panel `/_staff` (resumen, historial, restauración, dependientes):** `GET /api/admin/overview` (Resumen Operativo, `MODERATOR+`, `Cache-Control: private, no-store`; contenido filtrado por rol: MODERATOR ve los aportes de moderación —sin contact/newsletter— y sus propias acciones; ADMIN+ añade worker de noticias, cobertura del catálogo y pines huérfanos; SUPER_ADMIN ve las últimas 10 acciones de todos), `GET /api/admin/submissions/pending-count` (`MODERATOR+`, insignia de pendientes), `GET /api/admin/dependents/:type/:id` (`type ∈ thread|entity|marker|module`; `thread` MODERATOR+, el resto ADMIN+; recuentos y títulos para la confirmación de borrado), `GET /api/admin/history?target_type&target_id` (`MODERATOR+`; SUPER_ADMIN ve todo el historial del objeto, el resto solo sus propias entradas y sin `snapshot`) y `POST /api/admin/audit-logs/:id/restore` (`SUPER_ADMIN`). Todos devuelven el 404 uniforme a quien no corresponda.
- **404 de negocio vs 404 uniforme:** el 404 uniforme (ruta inexistente o sin autorización de staff) lleva el cuerpo exacto `{"error":"No encontrado"}` y es indistinguible de una ruta inexistente. Un 404 de recurso que solo ve un staff ya autorizado lleva además `code: "RESOURCE_NOT_FOUND"` (p. ej. `{"error":"Entidad no encontrada","code":"RESOURCE_NOT_FOUND"}`); el cliente del panel solo se considera «sin acceso» ante el 404 **sin** `code`. Un borrado con dependientes responde `409` con `code: "HAS_DEPENDENTS"` y `details` (recuento y títulos). Nunca se emite un código distinto de 404 a quien no es staff.
- **`GET /api/entities`:** admite `?limit=&page=`, `?module=`, `?id=` (una ficha concreta) y `?q=` (búsqueda por título o slug; es la búsqueda remota del selector único de fichas `EntityPicker`, sin cargar el catálogo entero); respuesta comprimida con `Cache-Control`/`ETag`.
- Cifras vigentes del catálogo: 243 `Entity` (armas 13, vehículos 200, guías 20, mapa 10), 10 `MapMarker`, 1 `OfficialNews`.
