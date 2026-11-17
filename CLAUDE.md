# CLAUDE.md — Constitución Técnica de ATLAS VICE

## 1. Fuente de Verdad Única

Toda decisión de arquitectura, base de datos, rutas y diseño está congelada en `/docs/`:

- `AtlasVice-v2.md` (Requisitos RF-01..07, Historias HU-01..07, Navegación P01..P07)
- `AtlasViceArquitecturaDatosSQL.md` (DER, 9 tablas PostgreSQL y políticas RLS)
- `AtlasViceNavegacionWireframesNUI.md` (Wireframes NUI y estructura de carpetas)

## 2. Reglas Prohibidas (Zero Bloat)

- PROHIBIDO instalar librerías de UI externas (Material UI, Chakra, Shadcn completo, Bootstrap). Todos los componentes se construyen en Tailwind sobre los tokens Vice NUI.
- PROHIBIDO crear carpetas o archivos fuera del árbol definido en `Atlas_Vice_Navegacion_Wireframes_NUI.pdf`.
- PROHIBIDO modificar el esquema SQL o inventar columnas no aprobadas.
- PROHIBIDO avanzar de fase sin ejecutar `pnpm typecheck` y `pnpm build` sin errores.

## 3. Tokens Visuales Obligatorios (Vice Sunset NUI)

- Cielo/Atardecer Vice Sunset: degradado `#2E1A47` -> `#7B2C6F` -> `#E14B7B` -> `#F69259`, con siluetas de palmeras altas y esbeltas (6%-10% opacidad) y diagonales `rgba(225, 75, 123, 0.25)`.
- Superficies HUD (glassmorphism): `rgba(20, 14, 36, 0.78)` + `backdrop-filter: blur(14px)` + borde cálido `1px solid rgba(246, 146, 89, 0.25)`.
- Acento primario y PalmButton: degradado `#E1307E` -> `#F67E56` con siluetas SVG de palmeras altas y esbeltas estilo Miami/Vice City. Etiqueta en `#1A0A22` y peso 700 (el blanco no alcanza contraste sobre `#F67E56`).
- Logotipo: wordmark tipográfico "ATLAS VICE" con relleno sunset, palmeras internas y la silueta vectorial del skyline costero de Vice City en el horizonte. Reemplaza al icono circular "V".
- Artwork protagonista del hero (P01/P02): `public/assets/hero-gas-station.jpg`, recortado por debajo del título del póster para no cortar texto, con degradado de fusión superior. La referencia cálida es `public/assets/vice-sunset-ref.jpg`.
- Foro (P07): la categoría se muestra como `Guías / Ayuda` y se guarda como `'Guias/Ayuda'`. Scrollbars oscuros con pulgar sunset.
- Escritorio: HUD flotante `100vw x 100vh` sin scroll vertical en Mapa (`P04`) e Inspector (`P05`).
- Móvil (iOS/Android): Bottom Dock fijo de 5 iconos (`Hub`, `Mapa`, `Catálogo`, `Foro`, `Progreso`) + Bottom Sheets deslizables.

## Carpetas válidas de herramientas (Graphify)

`graphify-out/` (ignorada en git) y `.claude/skills/graphify/` son carpetas válidas del proyecto, fuera del árbol de la sección 2. El agente `qa-mobile` NO debe borrarlas, moverlas ni marcarlas como violación de estructura.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
