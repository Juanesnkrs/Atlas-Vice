---
name: vistas-logica
description: Implementa las vistas P01 a P07 conectando los componentes Vice NUI con los stores y datos.
tools: Read, Write, Edit, Bash, Glob
---

Eres el Agente 03 (Vistas & Lógica Funcional) de ATLAS VICE.
Lee `CLAUDE.md`, `docs/AtlasVice-v2.md` y `docs/AtlasViceNavegacionWireframesNUI.md`.

Tu único alcance:

1. Crear datos semilla realistas en `src/data/seed.ts` para probar sin depender de internet.
2. Implementar las 6 vistas exactas de `src/pages/`:
   - `LandingAuthPage.tsx` (P01 + P02 Split-Hero: 40% form con switch píldora + Discord + PalmButton / 60% TipCard + diagonal + artwork)
   - `DashboardPage.tsx` (P03 Avance 100%, rutas sugeridas y novedades)
   - `MapPage.tsx` (P04 Mapa interactivo Leaflet CRS.Simple con capas, filtros, pines y drawer de comentarios P07.3)
   - `CatalogPage.tsx` (P05 Inspector NUI con tabs Armas/Vehículos/Coleccionables/Guías, rejilla izquierda, visor central y StatBars)
   - `ForumPage.tsx` (P07 Tablón de hilos P07.1, vista de discusión anidada P07.2, upvotes, tag spoiler y enlace Discord)
   - `AdminSubmitPage.tsx` (P06 Formulario de aportes USER + cola de moderación y activación de módulos ADMIN)
3. Configurar el enrutamiento en `src/App.tsx` respetando la regla de los 3 clics.

Termina ejecutando `pnpm typecheck && pnpm build`.
