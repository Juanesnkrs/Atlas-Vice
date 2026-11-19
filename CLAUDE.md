# CLAUDE.md — Constitución Técnica de LeonidApp (antes ATLAS VICE)

## 0. Identidad

- Nombre de producto: **LeonidApp**.
- Application ID (Capacitor, iOS/Android): `com.leonidapp.companion`.
- Esquema de deep links: `leonidapp://`.
- El nombre "ATLAS VICE" sigue vigente solo como wordmark visual heredado (sección 3) y en los nombres de los documentos legados `AtlasVice*.md`, archivados en `docs/legado/`.

## 1. Fuente de Verdad Única (`/docs/`)

Toda decisión de arquitectura, esquemas, rutas, SEO, monetización y diseño está definida exclusivamente en estos 3 documentos maestros de `/docs/`:

- `docs/LeonidApp-Arquitectura-Datos-MongoDB.md` — las 10 colecciones Mongoose + Zod, RBAC (`GUEST` < `USER` < `MODERATOR` < `ADMIN` < `SUPER_ADMIN`), OAuth2 + PKCE con cookies HttpOnly y aprobación automática de `Submission`.
- `docs/LeonidApp-Rutas-SEO-Monetizacion.md` — rutas limpias con History API, SSR-lite (meta + JSON-LD `HowTo`/`Article`/`SearchAction`) en Fastify, `sitemap.xml`, enlazado cruzado, comparador NUI y reglas de `<AdSlot/>` + consentimiento.
- `docs/LeonidApp-UI-NUI-DesignSpec.md` — tokens Vice Sunset NUI, fidelidad a `docs/referencias-ui/design/` (`Mobile.dc.html`, `MobileHero.dc.html`, `Inspector.dc.html`, `Forum.dc.html`), Rediseño v2 (§7), `<RockstarFooter/>` y árbol exacto de carpetas (§6).

Los documentos `AtlasVice-v2.md`, `AtlasViceArquitecturaDatosSQL.md`, `AtlasViceNavegacionWireframesNUI.md` (archivados en `docs/legado/`) y el resto de la carpeta `docs/legado/` son **[LEGADO HISTÓRICO - NO USAR]**: solo referencia histórica. Si este archivo y un documento `LeonidApp-*.md` difieren, manda el documento `LeonidApp-*.md` y este archivo debe corregirse.

## 2. Reglas Prohibidas (Zero Bloat y Cumplimiento Editorial)

- PROHIBIDO instalar librerías de UI externas (Material UI, Chakra, Shadcn completo, Bootstrap, `lucide-react`, `react-router`). Todos los componentes se construyen en Tailwind sobre los tokens Vice NUI e iconos SVG inline.
- PROHIBIDO crear carpetas o archivos fuera del árbol aprobado (`docs/LeonidApp-UI-NUI-DesignSpec.md` §6 + carpetas válidas listadas abajo).
- PROHIBIDO inventar campos o colecciones no aprobados: todo modelo Mongoose debe tener su schema Zod equivalente y reflejar exactamente las colecciones de `docs/LeonidApp-Arquitectura-Datos-MongoDB.md`.
- PROHIBIDO copiar, traducir literalmente o parafrasear textos de wikis o sitios de terceros (ej. GTABase), así como alojar imágenes con prefijos de terceros en `public/assets/` (`complexmusic_*`, `rockstargames_*`, `theofficialselfridges_*`). Todo contenido editorial debe ser 100 % original en español neutro para cumplimiento de copyright y AdSense. **Excepción autorizada por el propietario del proyecto (mapa):** la base cartográfica de `/mapa` es el mapa comunitario de Leonida (`public/ref Leonida map/The final version of Commnunity map.jpeg`), solo su área cartográfica (sin la columna de leyenda), con sus colores y textos originales a resolución nativa, publicado como pirámide de teselas en `public/map-tiles/` (obra derivada, con crédito de atribución visible en el mapa). Es la única imagen de terceros permitida; el original en `public/ref Leonida map/` sigue ignorado por git y excluido de `dist/`.
- PROHIBIDO añadir código nuevo a `supabase/`: está deprecado (ver sección 4).
- PROHIBIDO avanzar de sprint o fase sin ejecutar `pnpm typecheck` y `pnpm build` sin errores (en `server/` también su propio `typecheck` y `build`).
- PROHIBIDO guardar tokens de sesión en `localStorage`/`sessionStorage`: solo cookies `HttpOnly`.

## 3. Tokens Visuales Obligatorios (Vice Sunset NUI)

- Cielo/Atardecer Vice Sunset: degradado `#2E1A47` -> `#7B2C6F` -> `#E14B7B` -> `#F69259`, con siluetas de palmeras altas y esbeltas (6%-10% opacidad) y diagonales `rgba(225, 75, 123, 0.25)`.
- Superficies HUD (glassmorphism): `rgba(20, 14, 36, 0.78)` + `backdrop-filter: blur(14px)` + borde cálido `1px solid rgba(246, 146, 89, 0.25)`.
- Acento primario y PalmButton: degradado `#E1307E` -> `#F67E56` con siluetas SVG de palmeras altas y esbeltas estilo Miami/Vice City. Etiqueta en `#1A0A22` y peso 700 (el blanco no alcanza contraste sobre `#F67E56`).
- Logotipo: wordmark tipográfico "ATLAS VICE" con relleno sunset, palmeras internas y la silueta vectorial del skyline costero de Vice City en el horizonte. Reemplaza al icono circular "V".
- Artwork y recursos visuales (`public/assets/`): `public/assets/hero-gas-station.jpg` es el artwork protagonista de P01/P02 (recortado por debajo del título del póster con degradado de fusión superior). El resto de superficies visuales usan degradados Vice Sunset o ilustraciones SVG propias; no se conservan archivos huérfanos ni capturas de terceros.
- Foro (P07): la categoría se muestra como `Guías / Ayuda` y se guarda como `'Guias/Ayuda'`. Scrollbars oscuros con pulgar sunset.
- Escritorio: HUD flotante `100vw x 100vh` sin scroll vertical en Mapa (`P04`) e Inspector (`P05`).
- Escritorio y móvil (iOS/Android): el mismo Bottom Dock de 5 ítems (`Hub`, `Mapa`, `Catálogo`, `Foro`, `Aportar`); el Progreso se abre desde el botón de % de la cabecera. En móvil, Bottom Sheets deslizables.

## 4. Arquitectura LeonidApp (MongoDB) y Enfoque Operativo

### Estructura de alto nivel

- `src/` — Cliente Vite + React + TypeScript (strict) + Tailwind + Zustand + TanStack Query + idb-keyval (offline-first).
- `server/` — API **Node.js + Fastify + TypeScript + Mongoose + Zod**. MongoDB es el único motor de persistencia. Validación de entrada/salida con Zod en cada ruta. Subcarpetas esperadas: `server/src/{config,models,routes,plugins,services,workers,scripts}` y `server/data/` para lotes JSON de ingesta editorial.
- `supabase/` — **LEGADO DEPRECADO**. Se conserva solo como referencia histórica del DER y de los UUID de `seed.ts`. No se extiende, no se ejecuta y no se importa desde `src/` ni `server/`.
- `android/` e `ios/` — proyectos nativos Capacitor con `appId` `com.leonidapp.companion`.

### Los 9 pilares aprobados

1. **Auth PKCE**: flujo OAuth con PKCE + Magic Link, **máximo 4 botones** de proveedor/acceso en la pantalla de autenticación (sin añadir más), preservando el retorno seguro `?next=`.
2. **Sesión con cookies HttpOnly**: tokens solo en cookies `HttpOnly` + `Secure` + `SameSite`; el cliente nunca lee el token. Deep link de retorno `leonidapp://auth/callback`.
3. **Noticias 100% oficiales**: únicamente fuentes oficiales de Rockstar Games / Take-Two. Prohibido contenido de terceros, rumores o scraping de medios. Ingesta mediante el worker del agente `05-workers-seo`.
4. **RBAC**: jerarquía `GUEST` (sin sesión, no persistido) < `USER` < `MODERATOR` < `ADMIN` < `SUPER_ADMIN`. La autorización se aplica en el servidor (hook Fastify), nunca solo en la UI.
5. **Panel Control Total**: panel exclusivo de `SUPER_ADMIN` (gestión de roles, módulos, moderación, pines del mapa, logs de auditoría y fuentes de noticias).
6. **Footer estilo Rockstar** (`<RockstarFooter/>`): pie de página institucional negro `#000000`, Contact y Subscribe persistidos en MongoDB, selector de idioma, modal de cookies (`leonidapp_consent`), columnas de enlaces, legales y avisos de marca registrada, sobre los tokens Vice NUI.
7. **Landing SEO/Storytelling y Monetización Responsable**: landing pública con narrativa, metadatos Open Graph, `sitemap.xml`, JSON-LD (`HowTo`, `Article`, `SearchAction`) y `<AdSlot/>` condicionado al consentimiento de Marketing (`leonidapp_consent`), carga diferida (`IntersectionObserver`), CLS = 0 y máximo 2 bloques en `/guias/:slug`.
8. **Fidelidad al artifact `/Design`**: la UI replica el artifact `/Design` (copia en `docs/referencias-ui/design/`), con las decisiones del Rediseño v2 (`docs/LeonidApp-UI-NUI-DesignSpec.md` §7), que prevalecen. `CatalogPage.tsx` y `ForumPage.tsx` se ajustan a `Inspector.dc.html` y `Forum.dc.html`.
9. **Pipeline Editorial de Catálogo (Cero Plagio)**: el catálogo (`armas`, `vehiculos`, `coleccionables`, `guias`, `mapa`) se alimenta a partir de hechos objetivos contrastados, transformados por `07-senior-copywriter-gta` en fichas editoriales 100 % originales en español neutro dentro de `server/data/*.json` e importadas de forma idempotente con `pnpm --dir server import:catalog <archivo.json> --apply --source editorial` (incluyendo `metadata.steps` para `HowTo` y `marker` para poblar `MapMarker` en `/mapa`).

## Mapa de carpetas permitidas (código fuente)

`src/` (cliente) — solo estas subcarpetas, más `App.tsx` y `main.tsx` en la raíz:

- `components/layout`
- `components/ui`
- `data`
- `pages`
- `store`
- `styles`
- `types`

`server/src/` (API) — solo estas subcarpetas, más `app.ts` e `index.ts` en la raíz:

- `config`
- `models`
- `routes`
- `plugins`
- `services`
- `workers`
- `scripts`

Cualquier archivo o carpeta fuera de este mapa lo elimina o reubica el `00-supervisor` en la auditoría.

## Carpetas válidas de herramientas (Graphify)

`graphify-out/` (ignorada en git) y `.claude/skills/graphify/` son carpetas válidas del proyecto, fuera del árbol aprobado. El agente `04-qa-mobile` NO debe borrarlas, moverlas ni marcarlas como violación de estructura.

## Carpetas y archivos válidos adicionales

También son válidos, fuera del árbol aprobado, y `04-qa-mobile` NO debe borrarlos ni marcarlos como violación:

- `server/` y `server/data/` (backend LeonidApp y archivos JSON de ingesta editorial para `importCatalog.ts`).
- `docs/` y `docs/legado/` (documentación maestra `LeonidApp-*.md`, referencias UI y archivo histórico legado).
- `supabase/` (legado deprecado; no se borra, tampoco se amplía).
- `android/` e `ios/` (proyectos nativos generados por Capacitor).
- `src/data/seed.ts` (datos semilla de ejemplo y capa de acceso offline-first).
- `public/map-tiles/` (pirámide de teselas WebP del área cartográfica del referente, colores originales + `manifest.json`, cargada bajo demanda por `/mapa`; fuera del bundle JS).
- `public/ref Leonida map/` (referencias locales del mapa: ignoradas por git y eliminadas de `dist/` en el build; solo sirven de calca en el Modo Editor y de fuente para generar las teselas).
- `supabase/03_seed_data.sql` (datos de ejemplo generados desde `seed.ts`, mismos UUIDs; legado).

## Subagentes (`.claude/agents/`)

| Agente                     | Alcance                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-supervisor`            | **Orquestador principal**: Tech Lead & QA Gatekeeper. Asigna tareas, audita estructura, builds y verificación en vivo; ningún bloque se commitea sin su aprobación        |
| `01-arquitecto-db`         | Base del monorepo, MongoDB/Mongoose, Zod, tipos compartidos, stores                                                                                                       |
| `02-ui-vice-nui`           | Sistema visual Vice NUI, componentes atómicos, Footer Rockstar                                                                                                            |
| `03-vistas-logica`         | Vistas P01..P07, Auth PKCE, panel Control Total, integración API                                                                                                          |
| `04-qa-mobile`             | Capacitor `com.leonidapp.companion`, auditoría de estructura, builds                                                                                                      |
| `05-workers-seo`           | Worker de noticias oficiales Rockstar/Take-Two, `sitemap.xml`, JSON-LD                                                                                                    |
| `06-senior-dev-operativo`  | Cierre técnico P0/P1 en 4 sprints: Auth/búsqueda/API, AdSlot + consentimiento + cabeceras HTTP, pipeline `importCatalog.ts` + `MapMarker`, limpieza de assets y Capacitor |
| `07-senior-copywriter-gta` | Redacción editorial 100 % original en español neutro a partir de hechos objetivos y generación de lotes JSON validados en `server/data/` para `importCatalog.ts`          |

## graphify

This project has a knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file relationships.

Rules:

- When `graphify-out/graph.json` exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the `.md` need not be opened. These return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed `graphify-out/graph.json` is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## 5. Flujo de Trabajo Gitflow y Conventional Commits

- PROHIBIDO hacer commits directos en `main` o `develop`.
- Todo trabajo se hace en ramas `feature/*` creadas desde `develop` y se integra mediante Pull Request.
- Los mensajes de commit siguen Conventional Commits en español, con estos prefijos: `feat:`, `fix:`, `ui:`, `chore:`, `docs:` (se admite scope, p. ej. `docs(agents):`, `feat(catalog):`).
- Ejemplo: `feat(catalog): habilita ingesta editorial y pines de mapa en importCatalog`.
