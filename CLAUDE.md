# CLAUDE.md — Constitución Técnica de LeonidApp (antes ATLAS VICE)

## 0. Identidad

- Nombre de producto: **LeonidApp**.
- Application ID (Capacitor, iOS/Android): `com.leonidapp.companion`.
- Esquema de deep links: `leonidapp://`.
- El nombre "ATLAS VICE" sigue vigente solo como wordmark visual heredado (sección 3) y en nombres de documentos congelados en `/docs/`, hasta que se renombren.

## 1. Fuente de Verdad Única

Toda decisión de arquitectura, rutas y diseño está congelada en `/docs/`:

- `AtlasVice-v2.md` (Requisitos RF-01..07, Historias HU-01..07, Navegación P01..P07)
- `AtlasViceArquitecturaDatosSQL.md` (DER original; **legado**: sirve de referencia conceptual de entidades, NO de motor)
- `AtlasViceNavegacionWireframesNUI.md` (Wireframes NUI y estructura de carpetas)

Si un documento congelado contradice la sección 4 (arquitectura MongoDB) de este archivo, manda este archivo para persistencia y backend; los documentos mandan para rutas, wireframes y UX.

## 2. Reglas Prohibidas (Zero Bloat)

- PROHIBIDO instalar librerías de UI externas (Material UI, Chakra, Shadcn completo, Bootstrap). Todos los componentes se construyen en Tailwind sobre los tokens Vice NUI.
- PROHIBIDO crear carpetas o archivos fuera del árbol aprobado (wireframes NUI + estructura de la sección 4 + carpetas válidas listadas abajo).
- PROHIBIDO inventar campos o colecciones no aprobados: todo modelo Mongoose debe tener su schema Zod equivalente y reflejar las entidades del DER aprobado.
- PROHIBIDO añadir código nuevo a `supabase/`: está deprecado (ver sección 4).
- PROHIBIDO avanzar de fase sin ejecutar `pnpm typecheck` y `pnpm build` sin errores (en `server/` también su propio `typecheck` y `build`).
- PROHIBIDO guardar tokens de sesión en `localStorage`/`sessionStorage`: solo cookies HttpOnly.

## 3. Tokens Visuales Obligatorios (Vice Sunset NUI)

- Cielo/Atardecer Vice Sunset: degradado `#2E1A47` -> `#7B2C6F` -> `#E14B7B` -> `#F69259`, con siluetas de palmeras altas y esbeltas (6%-10% opacidad) y diagonales `rgba(225, 75, 123, 0.25)`.
- Superficies HUD (glassmorphism): `rgba(20, 14, 36, 0.78)` + `backdrop-filter: blur(14px)` + borde cálido `1px solid rgba(246, 146, 89, 0.25)`.
- Acento primario y PalmButton: degradado `#E1307E` -> `#F67E56` con siluetas SVG de palmeras altas y esbeltas estilo Miami/Vice City. Etiqueta en `#1A0A22` y peso 700 (el blanco no alcanza contraste sobre `#F67E56`).
- Logotipo: wordmark tipográfico "ATLAS VICE" con relleno sunset, palmeras internas y la silueta vectorial del skyline costero de Vice City en el horizonte. Reemplaza al icono circular "V".
- Artwork protagonista del hero (P01/P02): `public/assets/hero-gas-station.jpg`, recortado por debajo del título del póster para no cortar texto, con degradado de fusión superior. La referencia cálida es `public/assets/vice-sunset-ref.jpg`.
- Foro (P07): la categoría se muestra como `Guías / Ayuda` y se guarda como `'Guias/Ayuda'`. Scrollbars oscuros con pulgar sunset.
- Escritorio: HUD flotante `100vw x 100vh` sin scroll vertical en Mapa (`P04`) e Inspector (`P05`).
- Móvil (iOS/Android): Bottom Dock fijo de 5 iconos (`Hub`, `Mapa`, `Catálogo`, `Foro`, `Progreso`) + Bottom Sheets deslizables.

## 4. Arquitectura LeonidApp (MongoDB)

### Estructura de alto nivel

- `src/` — Cliente Vite + React + TypeScript (strict) + Tailwind + Zustand + TanStack Query + idb-keyval (offline-first).
- `server/` — API **Node.js + Fastify + TypeScript + Mongoose + Zod**. MongoDB es el único motor de persistencia. Validación de entrada/salida con Zod en cada ruta. Subcarpetas esperadas: `server/src/{config,models,routes,plugins,services,workers}`.
- `supabase/` — **LEGADO DEPRECADO**. Se conserva solo como referencia histórica del DER y de los UUID de `seed.ts`. No se extiende, no se ejecuta y no se importa desde `src/` ni `server/`.
- `android/` e `ios/` — proyectos nativos Capacitor con `appId` `com.leonidapp.companion`.

### Los 8 pilares aprobados

1. **Auth PKCE**: flujo OAuth con PKCE, **máximo 4 botones** de proveedor/acceso en la pantalla de autenticación (sin añadir más).
2. **Sesión con cookies HttpOnly**: tokens solo en cookies `HttpOnly` + `Secure` + `SameSite`; el cliente nunca lee el token. Deep link de retorno `leonidapp://`.
3. **Noticias 100% oficiales**: únicamente fuentes oficiales de Rockstar Games / Take-Two. Prohibido contenido de terceros, rumores o scraping de medios. Ingesta mediante el worker del agente 05.
4. **RBAC**: roles `USER`, `ADMIN`, `SUPER_ADMIN`. La autorización se aplica en el servidor (hook Fastify), nunca solo en la UI.
5. **Panel Control Total**: panel exclusivo de `SUPER_ADMIN` (gestión de roles, módulos, moderación y fuentes de noticias).
6. **Footer estilo Rockstar**: pie de página institucional oscuro, columnas de enlaces, legales y avisos de marca registrada, sobre los tokens Vice NUI.
7. **Landing SEO/Storytelling**: landing pública con narrativa, metadatos Open Graph, `sitemap.xml` y JSON-LD (ver agente 05).
8. **Fidelidad al artifact `/Design`**: la UI replica el artifact `/Design`. Se **conservan** `src/pages/ForumPage.tsx` y `src/pages/CatalogPage.tsx` tal como están; solo se retocan para integrarlos con la API.

## Carpetas válidas de herramientas (Graphify)

`graphify-out/` (ignorada en git) y `.claude/skills/graphify/` son carpetas válidas del proyecto, fuera del árbol aprobado. El agente `04-qa-mobile` NO debe borrarlas, moverlas ni marcarlas como violación de estructura.

## Carpetas y archivos válidos adicionales

También son válidos, fuera del árbol aprobado, y `04-qa-mobile` NO debe borrarlos ni marcarlos como violación:

- `server/` (backend LeonidApp, sección 4).
- `supabase/` (legado deprecado; no se borra, tampoco se amplía).
- `android/` e `ios/` (proyectos nativos generados por Capacitor).
- `src/data/seed.ts` (datos semilla de ejemplo y capa de acceso offline-first).
- `supabase/03_seed_data.sql` (datos de ejemplo generados desde `seed.ts`, mismos UUIDs; legado).

## Subagentes (`.claude/agents/`)

| Agente | Alcance |
| --- | --- |
| `01-arquitecto-db` | Base del monorepo, MongoDB/Mongoose, Zod, tipos compartidos, stores |
| `02-ui-vice-nui` | Sistema visual Vice NUI, componentes atómicos, Footer Rockstar |
| `03-vistas-logica` | Vistas P01..P07, Auth PKCE, panel Control Total, integración API |
| `04-qa-mobile` | Capacitor `com.leonidapp.companion`, auditoría de estructura, builds |
| `05-workers-seo` | Worker de noticias oficiales Rockstar/Take-Two, `sitemap.xml`, JSON-LD |

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## 5. Flujo de Trabajo Gitflow y Conventional Commits

- PROHIBIDO hacer commits directos en `main` o `develop`.
- Todo trabajo se hace en ramas `feature/*` creadas desde `develop` y se integra mediante Pull Request.
- Los mensajes de commit siguen Conventional Commits en español, con estos prefijos: `feat:`, `fix:`, `ui:`, `chore:`, `docs:` (se admite scope, p. ej. `docs(agents):`).
- Ejemplo: `ui: ajusta el espacio inferior de safe-area en ViceShell`.
