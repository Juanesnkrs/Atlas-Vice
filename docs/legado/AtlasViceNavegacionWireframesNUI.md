> **[LEGADO HISTÓRICO - NO USAR]** — Sustituido por `docs/LeonidApp-UI-NUI-DesignSpec.md` (UI y carpetas) y `docs/LeonidApp-Rutas-SEO-Monetizacion.md` (rutas). Se conserva solo como referencia histórica de wireframes.

# ATLAS VICE — Mapa de Navegación Visual, Wireframes NUI y Estructura

**Proyecto:** VICE HUB / VI Companion (Portal Interactivo & Companion App de GTA VI)

**Documento:** Artefacto de Arquitectura UI/UX (Escritorio & Móvil iOS/Android) — v1.0

## 1. Mapa de Navegación Visual (Árbol Jerárquico Compuesto P01–P07)

Siguiendo la estructura de niveles y la regla de los 3 clics definida en las especificaciones del sistema:

```
=============================================================================
                    ZONA PÚBLICA (NIVEL 0 - SIN FRICCIÓN)
=============================================================================
  [P01: LANDING / PORTAL HUB] <─────────────────────────────────────────┐
   │  (Tip of the Day + Acceso Invitado + Estado en Vivo)               │
   ├──────────────────────────┐                                         │
   ▼                          ▼                                         │
  [P02: AUTENTICACIÓN]     [ACCESO DIRECTO INVITADO]                    │
   ├── P02.1 Login / Registro (Switch Píldora + Discord)                │
   └── P02.2 Recuperar Contraseña                                       │
        │                                                               │
        ▼ (Sesión Iniciada / Sincronización Cloud)                      │
=============================================================================
             ZONA OPERATIVA Y EXPLORACIÓN (NIVEL 1 - CORE DEL PORTAL)
=============================================================================
                     [P03: DASHBOARD DE PROGRESO (HUB)]
                     (Avance 100% + Rutas + Novedades)
                                     │
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
   [RAMA 1: MAPA]           [RAMA 2: ENCICLOPEDIA]   [RAMA 4: COMUNIDAD]
   [P04: Mapa Leonida]      [P05: Inspector NUI]     [P07: Foro & Social]
    ├── P04.1 Visor Full-HUD ├── P05.1 Armas          ├── P07.1 Tablón Hilos
    ├── P04.2 Capas / Filtros├── P05.2 Vehículos      ├── P07.2 Vista Hilo
    └── P04.3 Pin + Check 100%├── P05.3 Coleccionables└── P07.3 Drawer Ítem
            │                └── P05.4 Guías / Misiones       │
            └────────────────────────┼────────────────────────┘
                                     ▼
=============================================================================
              ZONA COMUNITARIA Y ADMIN (NIVEL 2 - ROLES AUTENTICADOS)
=============================================================================
                       [P06: CENTRO DE APORTES Y ADMIN]
                        ├── P06.1 Formulario de Aportes (Rol USER)
                        └── P06.2 Moderación y Módulos (Solo ADMIN)
```

## 2. Wireframes Estructurales (Escritorio NUI vs. Móvil iOS/Android)

### A. P01 / P02 — Split-Hero (Acceso & Bienvenida)

Réplica exacta de la arquitectura visual de referencia:

**Escritorio ($100vw \times 100vh$, sin scroll):**

```
+-------------------------------------+------------------------------------------------+
| [COLUMNA IZQUIERDA 40%]             | [COLUMNA DERECHA 60%]                          |
|                                     |                                                |
|            [ LOGO VI ]              |   TIP OF THE DAY                               |
|                                     |   "Remember to catch those..."                 |
|      [ ENTRAR  |  EXPLORAR ]        |   [●] [ ] [ ]                                  |
|                                     |                                                |
|   +-----------------------------+   |               +----------------+               |
|   | EMAIL / USUARIO             |   |               |   [ ARTWORK ]  |               |
|   +-----------------------------+   |               | [ PERSONAJES ] |               |
|   +-----------------------------+   |               | [ RECORTADO ]  |               |
|   | CONTRASEÑA                  |   |               +----------------+               |
|   +-----------------------------+   |                                                |
|                                     |                                                |
|   [      BOTÓN PALMERAS       ] /   |                                                |
|   [       DISCORD OAUTH       ] /   |                                                |
|                                     |                                                |
|  v2.0.4 ONLINE /                    |                                                |
+-------------------------------------+------------------------------------------------+
```

**Móvil (iOS / Android):** Se apila en una sola columna vertical con fondo de palmeras oscurecido (`#160B14`), el logo arriba, el formulario compacto al centro y un botón directo de `"Continuar como Invitado"` debajo del botón de Discord para entrar al mapa en un toque.

---

### B. P04 — Mapa Interactivo de Leonida (HUD Flotante)

**Escritorio ($100vw \times 100vh$):**

```
+--------------------------------------------------------------------------------------+
| [LOGO]   [ BUSCADOR RÁPIDO                        ]          [PROGRESO: 42% | USER]  |
|                                                                                      |
| +--------------------+                                                               |
| | CAPAS DEL MAPA     |                   (•)                                         |
| | [x] Coleccionables |                                                               |
| | [x] Armas Ocultas  |           [ MAPA INTERACTIVO ]                                |
| | [ ] Tiendas        |               FULL-SCREEN               +-------------------+ |
| | [ ] Eventos        |                   (•)                   | FICHA DE MARCADOR | |
| +--------------------+                                         | (P04.3)           | |
|                                                                | Foto + Guía +     | |
|                                                                | [ ] 100%          | |
|                                                                | [ Hilos (4) ]     | |
|                                                                +-------------------+ |
|              [ DOCK NAVEGACIÓN: Mapa | Catálogo | Foro | Aportar ]                   |
+--------------------------------------------------------------------------------------+
```

**Móvil (iOS / Android):** Mapa a pantalla completa con barra de búsqueda flotante arriba; al tocar un pin, sube un *Bottom Sheet* deslizable con la foto, el botón de marcar como completado y la pestaña de comentarios contextuales (`P07.3`), manteniendo el *Bottom Dock* de 5 iconos fijo abajo.

---

### C. P05 — Enciclopedia e Inspector NUI (Armas / Vehículos / Coleccionables)

Inspirado en la pantalla de selección/creador de referencia:

**Escritorio ($100vw \times 100vh$):**

```
+--------------------------------------------------------------------------------------+
| ARMERÍA // RIFLES DE ASALTO                                                    [ X ] |
| [TABS CATEGORÍAS]                                                                    |
|                                                                                      |
| +-----+ +-----+ +-----+                                        +-------------------+ |
| |*SEL*| |     | |     |          [ RENDER 3D / PNG ]           | ESTADÍSTICAS      | |
| +-----+ +-----+ +-----+          [   ARMA / AUTO   ]           | Daño      [==== ] | |
| +-----+ +-----+ +-----+                                        | Cadencia  [===  ] | |
| |     | |     | |     |                                        | Precisión [=====] | |
| +-----+ +-----+ +-----+                                        | Ubicación: Ocean  | |
| +-----+ +-----+ +-----+                                        | [ VER EN MAPA ]   | |
| |     | |     | |     |             [ZOOM / ROTAR]             | [ DISCUTIR (12) ] | |
| +-----+ +-----+ +-----+                                        +-------------------+ |
+--------------------------------------------------------------------------------------+
```

**Móvil (iOS / Android):** Visor superior fijo con la imagen del arma/vehículo y sus barras de estadísticas, y debajo una cuadrícula de 3 columnas con scroll táctil fluido.

---

### D. P07 — Módulo de Foro y Comunidad

**Escritorio ($100vw \times 100vh$):**

```
+--------------------------------------------------------------------------------------+
| COMUNIDAD ATLAS VICE    [Todos] [Ayuda] [Secretos] [Crews]                 [+ HILO]  |
|                                                                                      |
| LISTA DE HILOS (P07.1)              | LECTURA DE HILO ACTIVO (P07.2)                 |
| ------------------------------------+----------------------------------------------- |
| > [Secretos] OVNI en...             | Título + Autor + Tag [SPOILER]                 |
|   ▲ 142 • 38 respuestas             | Contenido del post principal...                |
| ------------------------------------|                                                |
|   [Ayuda] Mejor ruta...             | Respuestas anidadas + Upvotes                  |
|   ▲ 89 • 14 respuestas              |                                                |
| ------------------------------------| [ Caja de respuesta rápida... ]                |
|                                     |                              [DISCORD OFICIAL] |
+--------------------------------------------------------------------------------------+
```

**Móvil (iOS / Android):** Pestañas horizontales deslizables arriba para filtrar categorías, tarjetas apiladas con indicador de votos y botón flotante (`+`) en la esquina inferior derecha para publicar.

## 3. Estructura de Carpetas Limpia para el Proyecto (React + TS + Vite + Tailwind)

Árbol definitivo de código para reemplazar el proyecto actual sin archivos innecesarios:

```
atlas-vice/
├── index.html
├── package.json
├── capacitor.config.ts     # Configuración nativa para iOS y Android
├── tailwind.config.ts      # Tokens Vice NUI (#160B14, #E1307E, blur, palmeras)
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── styles/
    │   └── vice-nui.css        # Textura de palmeras, diagonales y glassmorphism
    ├── types/
    │   └── database.ts         # Interfaces TypeScript mapeadas al schema.sql
    ├── store/
    │   ├── useAuthStore.ts     # Estado de sesión (Invitado / Email / Discord)
    │   └── useProgressStore.ts # Sincronización localStorage + Supabase
    ├── components/
    │   ├── layout/
    │   │   ├── ViceShell.tsx   # Contenedor HUD escritorio + Bottom Dock móvil
    │   │   └── BottomDock.tsx  # Barra inferior de 5 iconos (iOS/Android)
    │   └── ui/
    │       ├── PalmButton.tsx  # Botón firma con textura de palmeras
    │       ├── TipCard.tsx     # Tarjeta "Tip of the Day" con paginador
    │       ├── StatBar.tsx     # Barra de estadísticas estilo NUI
    │       └── BottomSheet.tsx # Panel deslizable móvil
    └── pages/
        ├── LandingAuthPage.tsx # P01 + P02 (Split-Hero)
        ├── DashboardPage.tsx   # P03 (Mi Avance 100%)
        ├── MapPage.tsx         # P04 (Mapa Interactivo Leonida)
        ├── CatalogPage.tsx     # P05 (Inspector NUI: Armas/Vehículos/Colecc.)
        ├── ForumPage.tsx       # P07 (Foro Comunitario e Hilos)
        └── AdminSubmitPage.tsx # P06 (Aportes y Moderación)
```