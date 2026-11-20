# LeonidApp — UI Vice Sunset NUI y Design Spec

**Estado:** Fuente de Verdad Única (sistema visual, componentes y árbol de carpetas).
**Sustituye a:** `docs/legado/AtlasViceNavegacionWireframesNUI.md` (`[LEGADO HISTÓRICO - NO USAR]`).
**Rutas:** ver `docs/LeonidApp-Rutas-SEO-Monetizacion.md`. **Datos:** ver `docs/LeonidApp-Arquitectura-Datos-MongoDB.md`.

---

## 1. Jerarquía de fidelidad

1. **Las decisiones del §7 (Rediseño v2)**, que prevalecen sobre el artifact donde lo contradicen.
2. **Artifact `/Design`** (https://claude.ai/artifact/Gg9djkjJyJ4uN1BnBP965w), copiado en `docs/referencias-ui/design/`. Manda ante cualquier duda visual:
   - `Main.dc.html` — P01/P02 Split-Hero de acceso (escritorio).
   - `MobileHero.dc.html` — acceso móvil.
   - `Map.dc.html` — P04 Mapa (HUD escritorio).
   - `Inspector.dc.html` — P05 Inspector/Catálogo.
   - `Forum.dc.html` — P07 Foro.
   - `Mobile.dc.html` — shell móvil, BottomDock, BottomSheets, tarjetas, tipografía y pestañas Mapa/Catálogo/Foro/Progreso en móvil.
   - `assets/a1..a7.jpg` y `assets/hero.jpg` — imágenes del diseño (`hero.jpg` es idéntica a `public/assets/hero-gas-station.jpg`).
3. Este documento (tokens y reglas).
4. Componentes existentes en `src/components/`.

Reglas: se replican espaciados, radios, jerarquía tipográfica, orden de elementos y estados de los `.dc.html`. Las pantallas que el artifact no dibuja (portada, Hub de escritorio, Guías, Noticias, ficha, Aportar) se construyen con su mismo lenguaje visual: superficies `glass`, `PalmButton`, Jost para títulos, Poppins para texto y tarjetas con radio 18–24px. El wordmark muestra **LEONIDAPP** aunque el artifact diga "ATLAS VICE".

### 1.1 Catálogo y Foro

`CatalogPage.tsx` y `ForumPage.tsx` dejan de estar congeladas: **se ajustan a `Inspector.dc.html` y `Forum.dc.html`** (escritorio) y a las pestañas equivalentes de `Mobile.dc.html` (móvil), corrigiendo los defectos listados en §7.4. Conservan su lógica de datos (TanStack Query + fallback `seed.ts`), el comparador NUI y el enlazado cruzado.

---

## 2. Tokens Vice Sunset NUI

Definidos como variables CSS en `src/styles/vice-nui.css` y expuestos en `tailwind.config.ts`.

| Token | Valor | Uso |
| --- | --- | --- |
| `--vice-sky` | `linear-gradient(180deg, #2E1A47 0%, #7B2C6F 38%, #E14B7B 72%, #F69259 100%)` | Cielo/atardecer de fondo |
| `--vice-palms-opacity` | `0.06`–`0.10` | Siluetas de palmeras altas y esbeltas |
| `--vice-diagonal` | `rgba(225, 75, 123, 0.25)` | Diagonales decorativas |
| `--hud-surface` | `rgba(20, 14, 36, 0.78)` | Superficies HUD |
| `--hud-blur` | `blur(14px)` | `backdrop-filter` del HUD |
| `--hud-border` | `1px solid rgba(246, 146, 89, 0.25)` | Borde cálido |
| `--accent` | `linear-gradient(90deg, #E1307E, #F67E56)` | PalmButton y acento primario |
| `--accent-ink` | `#1A0A22`, peso 700 | Texto sobre el acento (el blanco no da contraste sobre `#F67E56`) |
| `--footer-bg` | `#000000` | RockstarFooter |

- **Wordmark**: tipográfico con relleno sunset, palmeras internas y skyline costero vectorial en el horizonte (sustituye al icono circular "V"). Texto de producto: **LeonidApp**; "ATLAS VICE" solo como identidad heredada donde ya exista.
- **Hero P01/P02**: `public/assets/hero-gas-station.jpg`, recortado por debajo del título del póster (sin cortar texto), con degradado de fusión superior. Referencia cálida: `public/assets/vice-sunset-ref.jpg`.
- **Foro**: categoría visible `Guías / Ayuda`, almacenada `'Guias/Ayuda'`.
- **Scrollbars**: pista oscura (`--hud-surface`) y pulgar con `--accent`.
- **Contraste**: AA mínimo (4.5:1 texto normal, 3:1 texto grande e iconos).
- **Movimiento**: respetar `prefers-reduced-motion` (sin parallax ni transiciones largas).

---

## 3. Layout por plataforma

| Plataforma | Regla |
| --- | --- |
| Escritorio | HUD flotante `100vw × 100vh` **sin scroll vertical** en Mapa (P04) e Inspector (P05). Páginas editoriales (`/`, `/hub`, `/guias`, `/noticias`, fichas, `/aportar`) sí hacen scroll y terminan en el Footer. |
| Escritorio y móvil | `BottomDock` **idéntico en todas las plataformas**, 5 ítems en este orden: `Hub` (`/hub`), `Mapa` (`/mapa`), `Catálogo` (`/catalogo`), `Foro` (`/foro`), `Aportar` (`/aportar`). En escritorio es la píldora flotante centrada de `Map.dc.html`; en móvil, la barra de `Mobile.dc.html`. El Progreso se abre desde el botón de % de la cabecera (`/progreso`). Paneles secundarios en móvil como `BottomSheet` deslizables. |
| Táctil | Área mínima `44 × 44px`; `env(safe-area-inset-*)` en Dock, Sheets y cabeceras. |

---

## 4. Componentes aprobados

| Componente | Archivo | Especificación |
| --- | --- | --- |
| `ViceShell` | `src/components/layout/ViceShell.tsx` | Fondo Vice Sunset + palmeras + HUD escritorio 100vh / wrapper móvil con safe areas |
| `BottomDock` | `src/components/layout/BottomDock.tsx` | 5 ítems (§3) con iconos Lucide, estado activo con `--accent`, `aria-current="page"`; una sola lista para escritorio y móvil |
| `RockstarFooter` | `src/components/layout/Footer.tsx` (export `RockstarFooter`) | §5 |
| `PalmButton` | `src/components/ui/PalmButton.tsx` | `--accent` + palmeras SVG, etiqueta `--accent-ink` 700, variantes `button`/`a` |
| `TipCard` | `src/components/ui/TipCard.tsx` | Tarjeta HUD |
| `StatBar` | `src/components/ui/StatBar.tsx` | Barra de estadística (catálogo y comparador) |
| `BottomSheet` | `src/components/ui/BottomSheet.tsx` | Hoja deslizable con foco atrapado y cierre por gesto/Esc |
| `EntityDetailPanel` | `src/components/ui/EntityDetailPanel.tsx` | Detalle único de un ítem del catálogo (badge, nombre, descripción, marcar, ubicación en el mapa, Ver ficha / Comparar / Discutir); lo usan el panel derecho de tablet/escritorio y el `BottomSheet` móvil de `/catalogo/:categoria/:itemSlug` |
| `AdSlot` | `src/components/ui/AdSlot.tsx` | Reglas en `LeonidApp-Rutas-SEO-Monetizacion.md` §6 |
| `Modal` | `src/components/ui/Modal.tsx` | Diálogo único de la app: `createPortal` a `document.body`, capa `.z-dialog` (por encima del dock y de las hojas), `role="dialog"`, `aria-modal`, `aria-labelledby`, foco atrapado, Esc y clic en el fondo para cerrar, foco devuelto al disparador. En móvil (< 768px) se presenta como `BottomSheet`. Toda ventana modal (muro de registro, Magic Link, modales del Footer) usa este componente; prohibidos los `fixed inset-0` propios en páginas. |

PROHIBIDO instalar librerías de UI externas (Material UI, Chakra, Shadcn completo, Bootstrap). Iconos: solo Lucide React.

---

## 5. `<RockstarFooter/>`

Pie institucional estilo Rockstar sobre fondo **negro `#000000`**, presente en todas las páginas con scroll (no en el HUD 100vh del Mapa ni del Inspector, donde se accede desde el menú).

### 5.1 Estructura

1. **Fila de marca**: wordmark LeonidApp + `AppConfig.social_links` (iconos Lucide, `rel="noopener noreferrer"`).
2. **Columnas de enlaces** (rutas limpias): Explorar (`/mapa`, `/catalogo`, `/guias`), Comunidad (`/foro`, `/aportar`), Actualidad (`/noticias`), **Contact**, **Subscribe**.
3. **Legales**: Términos, Privacidad, Cookies, Aviso de marcas — abren modales internos.
4. **Aviso de marca registrada**: "LeonidApp es un proyecto de fans no afiliado a Rockstar Games ni Take-Two Interactive. Grand Theft Auto y sus marcas pertenecen a sus respectivos titulares."
5. **Barra inferior**: © año, **selector de idioma** y botón **Cookie Settings**.

### 5.2 Contact y Subscribe conectados a MongoDB

| Acción | Endpoint | Persistencia | Validación |
| --- | --- | --- | --- |
| Contact | `POST /api/contact` `{ email, message, website }` | `Submission` con `type: 'contact'`, `moduleSlug: 'leonidapp'`, `userId` de la sesión o `null` | Zod: `email` válido (≤ 254), `message` 10–2000 chars tras `trim`; rate limit 5/hora/IP; honeypot `website` (campo oculto, debe llegar vacío: si trae texto se responde `201 { ok: true }` sin guardar nada) |
| Subscribe | `POST /api/subscribe` `{ email, locale, website }` | `Submission` con `type: 'newsletter'`, deduplicado por `payload.email` | Zod: `locale ∈ {'es','en'}` (idioma activo del selector del Footer); mismo honeypot; rate limit 5/hora/IP; respuesta idéntica `201 { ok: true }` exista o no (sin enumeración) |

El título de la `Submission` de contacto es `Contacto de <email>` (no hay campo `name`).

- Se elimina el guardado en `localStorage` de estos formularios: el estado vive en memoria (React/Zustand) hasta el envío.
- Estados de UI: `idle` → `sending` → `sent` / `error` (con mensaje y reintento). Sin conexión: se informa y no se envía (no hay outbox local).
- Nunca se envían a servicios externos sin el consentimiento correspondiente.

### 5.3 Selector de idioma

- Idiomas: `es` (por defecto) y `en`.
- Preferencia guardada en cookie no sensible `leonidapp_lang` (categoría "Preferencias"; `SameSite=Lax`, 1 año). No es token de sesión.
- Actualiza `<html lang>` y los textos del Footer y modales sin recargar.

### 5.4 Modal de cookies (Cookie Settings)

- Categorías: **Necesarias** (siempre activas: sesión HttpOnly y seguridad), **Preferencias**, **Analítica** y **Marketing** (las tres últimas desactivadas por defecto).
- Botones de igual peso visual: `Aceptar todo`, `Rechazar todo`, `Guardar selección`.
- Elección guardada en cookie `leonidapp_consent` (JSON de categorías + versión + fecha), revocable en cualquier momento desde el Footer.
- Sin "Marketing" no se carga ningún `AdSlot` con script de terceros.
- Accesible: `role="dialog"`, `aria-modal`, foco atrapado, cierre con Esc.

---

## 6. Árbol exacto de carpetas permitidas

### 6.1 Cliente `src/`

```
src/
├── App.tsx
├── main.tsx
├── components/
│   ├── layout/        ViceShell.tsx · BottomDock.tsx · Footer.tsx (RockstarFooter)
│   └── ui/            PalmButton.tsx · TipCard.tsx · StatBar.tsx · BottomSheet.tsx · EntityDetailPanel.tsx · AdSlot.tsx · Modal.tsx
│                      MapCanvas.tsx (motor del mapa: pan/zoom/inercia/clustering sobre SVG + rAF) · mapPaint.ts (pintor <canvas> de la pirámide de teselas del referente)
├── data/              seed.ts (capa offline-first y fallback) · leonidaMap.ts (marco de coordenadas, `MARKER_SPOTS` y metadatos de las teselas)
├── pages/             HomePage.tsx · LandingAuthPage.tsx · DashboardPage.tsx · MapPage.tsx · CatalogPage.tsx
│                      ForumPage.tsx · AdminSubmitPage.tsx · GuidesPage.tsx · NewsPage.tsx
├── store/             useAuthStore.ts · useProgressStore.ts · useRouteStore.ts (router History API)
├── styles/            vice-nui.css
└── types/             database.ts
```

Los módulos de administración (panel oculto `/_staff`: moderación, Control Total, gestión de identidades, editor de pines y panel de catálogo) viven como **archivos** dentro de `src/pages/` y `src/components/ui/`, sin carpetas nuevas; su código se separa solo en el build (chunks en `/_staff/assets/`) y nunca se enlaza desde la UI pública, el dock, el footer ni el Hub.

`HomePage.tsx` (portada `/`), `GuidesPage.tsx` (`/guias`, `/guias/:slug`) y `NewsPage.tsx` (`/noticias`, `/noticias/:slug`) son las únicas páginas nuevas aprobadas; `useRouteStore.ts` es el único store nuevo aprobado. Ninguna otra subcarpeta en `src/`.

### 6.2 API `server/src/`

```
server/src/
├── app.ts
├── index.ts
├── config/     db.ts · env.ts
├── models/     common.ts · index.ts · User.ts · AppConfig.ts · Module.ts · Entity.ts · MapMarker.ts
│               UserProgress.ts · OfficialNews.ts · Submission.ts · ForumThread.ts · ForumPost.ts
│               ForumVote.ts · AuditLog.ts
├── routes/     auth.ts · catalog.ts · config.ts · forum.ts · news.ts · progress.ts · seo.ts
│               submissions.ts · contact.ts
├── plugins/    auth.ts
├── services/   audit.ts · mailer.ts · oauth.ts · session.ts · users.ts · validate.ts · submissions.ts · ssrLite.ts
├── workers/    officialNewsWorker.ts · sources.ts
└── scripts/    seed.ts · seedData.json
```

`routes/contact.ts` (Contact + Subscribe), `services/submissions.ts` (promoción automática) y `services/ssrLite.ts` (SSR-lite) son los únicos archivos nuevos aprobados en `server/src/`.

### 6.3 Fuera del árbol, válidos

`server/` (raíz del backend), `supabase/` (legado, no se amplía), `android/`, `ios/`, `public/` (assets y `map-tiles/`; el `robots.txt` es dinámico y lo emite Fastify con solo `Disallow: /api/`), `docs/`, `graphify-out/`, `.claude/skills/graphify/`.

---

## 7. Rediseño v2 (decisiones del propietario, 2026-11-18)

Objetivo: una app **al punto y al grano**, con la identidad Vice Sunset NUI. El referente de estructura para la portada es GTABase: casi sin texto explicativo, un punto de entrada dominante, **tarjetas con imagen y categoría** para cada sección y listas de "lo último" con "Ver todo". No se copia su marca, textos ni estilo visual.

### 7.1 Navegación y estructura común

- **Cabecera** (todas las pantallas salvo `/entrar`):
  - Izquierda: wordmark LEONIDAPP, que enlaza a `/`.
  - Derecha en escritorio: enlaces de texto `Guías` y `Noticias`.
  - Derecha en escritorio y móvil: botón de progreso (`NN%`, enlaza a `/progreso`) y `Entrar` (sin sesión) o el nombre del usuario (con sesión).
  - Se elimina la etiqueta "Local" y cualquier jerga técnica visible.
- **BottomDock:** idéntico en escritorio y móvil (§3), con Hub, Mapa, Catálogo, Foro y Aportar (5 ítems). No contiene accesos a administración. El footer enlaza «Aportar» (no «Aportes y moderación»). `/aportar` es un buzón comunitario público sin menciones a moderación, roles ni administración.
- **Hub:** la tarjeta «Rutas sugeridas» se oculta mientras no existan rutas reales. **`/entrar`:** máximo 4 botones; los proveedores con `configured:false` se ocultan o muestran «Próximamente».
- **Fallo de API:** estado de error honesto con botón de reintento; no se muestran datos de ejemplo inventados.
- **Footer:** un único `RockstarFooter`, solo al final de las páginas con scroll.
  - Se elimina la franja compacta "© LeonidApp ▲" de las pantallas HUD (Mapa, Inspector, Foro en escritorio).
  - El Footer nunca queda debajo del dock ni apilado con él: el contenido reserva al final el alto del dock más `env(safe-area-inset-bottom)`.
  - El skyline decorativo va detrás del contenido, nunca como franja entre el Footer y el dock.
  - El Footer añade enlaces a `Guías` y `Noticias`.
- **Aviso "Datos de ejemplo":** como máximo una vez por pantalla, discreto, al final del contenido. Nunca dentro de cada panel.
- **Visitante recurrente:** `/` ya no redirige a `/hub`. La portada es pública para todos.

### 7.2 Portada `/` (`HomePage.tsx`)

En este orden:

1. **Hero compacto** (máx. ~60vh en escritorio), con el artwork `hero-gas-station.jpg` y el degradado Vice Sunset:
   - Kicker corto y H1 de 8 palabras como máximo.
   - Una sola línea de descripción.
   - CTA primario `PalmButton` "Abrir el mapa" (`/mapa`) y secundario "Crear cuenta gratis" (`/entrar`).
2. **"Explora Leonida":** rejilla de tarjetas con imagen, título y contador real, y la tarjeta entera como enlace. 3–4 columnas en escritorio y 2 en móvil.
   - Tarjetas: Mapa interactivo, Armas, Vehículos, Coleccionables, Guías, Noticias oficiales.
   - Imágenes: las de `docs/referencias-ui/design/assets/` o `public/assets/`, siempre con `alt` descriptivo.
3. **"Noticias oficiales":** hasta 6 tarjetas con fecha y fuente, y "Ver todas" (`/noticias`). Sin datos, estado vacío claro (§7.4).
4. **"Guías":** hasta 6 tarjetas con categoría y avance, y "Ver todas" (`/guias`).
5. **"Foro en vivo":** los últimos hilos con las reglas de §7.5, indicador `● EN VIVO` y refresco cada 20 s.
6. **Franja de registro:** una frase y un CTA "Crear cuenta gratis" (`/entrar`). Solo sin sesión.
7. **Footer.**

Copy: frases cortas y concretas, sin "PKCE", "LAUNCH READY", "HUD" ni términos internos.

### 7.3 Acceso `/entrar` (`LandingAuthPage.tsx`)

- Replica `Main.dc.html` en escritorio:
  - Panel `glass` izquierdo de 576px con wordmark y conmutador `Entrar / Explorar`.
  - Tarjeta flotante "Tip del día" sobre el artwork.
  - Versión y estado al pie del panel.
- Replica `MobileHero.dc.html` en móvil.
- **Pestaña Entrar:** los 4 botones de proveedor (Google, Discord, Apple, Magic Link; este último con su campo de email). **Sin contraseña** ni "¿Olvidaste tu contraseña?" (decisión de seguridad: solo OAuth2 + PKCE y Magic Link).
- **Pestaña Explorar:** las 3 ventajas del diseño y "Continuar como invitado" (`/hub`).
- Respeta `?next=` tras el login.

### 7.4 Defectos a corregir

- **Catálogo (escritorio):**
  - El panel de detalle no puede cortarse: sus acciones caben en el alto disponible o el panel hace scroll interno.
  - Ningún botón parte su texto en dos líneas.
  - Los nombres de la rejilla se leen completos, en 2 líneas como máximo o con `title`.
  - Se quita la pestaña `Guías`; quedan Armas, Vehículos y Coleccionables.
- **Catálogo (móvil):** como la pestaña Catálogo de `Mobile.dc.html`, con la lista visible primero y el detalle en `BottomSheet`.
- **Mapa:**
  - Los pines no tapan los nombres de región; las etiquetas van por encima, legibles.
  - Se sustituye "Cartografía en actualización · LAUNCH READY" por un texto claro o se elimina.
  - En móvil, el mapa ocupa el alto disponible sin un hueco vacío.
- **Ficha:** "Sin ubicación en el mapa" es texto con icono, no algo que parezca un campo.
- **Foro:** ningún texto visible dice "ATLAS VICE" (incluidos los datos semilla de cliente y servidor).
- **Noticias:**
  - Sin noticias, se muestra un estado vacío explicativo con enlace a Rockstar Newswire.
  - El worker corrige sus fuentes oficiales (YouTube bloqueado por `robots.txt`; Take-Two IR devuelve 404), sin salir de la lista blanca oficial.

### 7.5 Foro: escaparate en vivo para invitados

- **Qué ve un invitado** (`GUEST`): solo la **lista en vivo** de hilos, con título, categoría, etiquetas (Fijado, Spoiler), votos, número de respuestas, autor y fecha relativa. Se refresca cada 20 s y lleva el indicador `● EN VIVO`.
- **Qué no puede hacer:** abrir un hilo, leer su contenido o respuestas, filtrar por categoría, buscar, ordenar, votar, responder ni crear hilos.
  - Esos controles **se ven** (la página debe resultar atractiva), pero al usarlos se abre un **muro de registro**: `BottomSheet` en móvil y modal en escritorio, con el texto "Crea tu cuenta gratis para leer la conversación" y el CTA `/entrar?next=/foro`.
  - Los enlaces desde Catálogo, Mapa o la portada hacia un hilo concreto llevan al invitado al mismo muro.
- **Con sesión:** el foro funciona completo, como hasta ahora.
- **Servidor** (la restricción la aplica el servidor, no solo la UI):
  - `GET /api/forum` sin sesión devuelve únicamente `threads` en formato *preview*: `id`, `titulo`, `categoria`, `is_pinned`, `is_spoiler`, `upvotes_count`, `replies_count`, autor público y `created_at`. Sin `contenido` ni `posts`, máximo 50 hilos, más recientes primero, e ignorando parámetros de filtro o búsqueda.
  - Con sesión devuelve la respuesta completa actual.
- **SSR-lite de `/foro`:** sin contenido de hilos en meta ni JSON-LD.

### 6.4 Mapa interactivo (P04) — teselas del referente + capa interactiva SVG

- **Base cartográfica:** el área cartográfica (sin la columna derecha de leyenda, créditos, frames ni interiores) del mapa comunitario de Leonida (`public/ref Leonida map/The final version of Commnunity map.jpeg`, recorte 6600 × 9300 px en `x=500, y=650`) con **sus colores y textos originales, sin recolorear ni retocar**, publicado como **pirámide de teselas WebP** en `public/map-tiles/{z}/{x}/{y}.webp` (512 px, `z=0..4`, `z=4` = resolución nativa 1:1, WebP calidad 86, ~7,6 MB en total y solo se descargan las visibles) con `manifest.json`. El relleno fuera del recorte y el fondo del lienzo usan el océano del referente (`WATER = #2C68A6`). La app **no** dibuja rótulos propios encima. La versión de la pirámide es `manifest.json` → `v`; las teselas se piden como `?v=<v>` y `sw.js` descarta las de otra versión. Es obra derivada de un mapa de terceros, autorizada por el propietario (ver `CLAUDE.md` §2) (por decisión del propietario la app no muestra texto de atribución sobre el mapa). El original sigue en `.gitignore` y fuera de `dist/`.
- **Proyección:** las teselas cubren el rectángulo del mundo `x ∈ [249.6, 760.6]`, `y ∈ [13.2, 733.2]` del lienzo 0–1000 × 0–700 (`manifest.json` → `world`), con la misma transformación lineal que los `MapMarker` de MongoDB: `x = (px − 500)·0,2·K + 249,59660`, `y = (py − 650)·0,2·K + 13,17385`, `K = 0,387112` (`px, py` en píxeles del referente).
- `src/components/ui/mapPaint.ts`: pinta en un `<canvas>` únicamente las teselas visibles del nivel `z` adecuado a la escala (caché en memoria; mientras carga una tesela se dibuja el recorte de su ancestro `z-1`… para evitar huecos). El bitmap se mueve con `translate3d` + `scale` en cada frame de rAF y solo se repinta al cargar teselas, cambiar de nivel `z` o alejarse del bitmap en caché.
- `src/components/ui/MapCanvas.tsx`: transformación `{ x, y, scale }` en una `ref` aplicada con `requestAnimationFrame`; zoom anclado al cursor, pinch, inercia, límites sobre el contorno de la isla (`ISLAND_BBOX`), clustering por rejilla y *culling*. En SVG quedan **solo** los elementos interactivos: pines, clusters, mira, trazador y calca del Modo Editor.
- `MapPage.tsx`: filtros AND (capas, región, ocultar completados), buscador con normalización NFD, deep-link `?pin=` y **Modo Editor** (solo en el panel oculto `/_staff` para staff autorizado; no existe en la UI pública): mira, copiar `(x, y)`, alta/movimiento de marcadores vía `POST`/`PATCH /api/markers`, calca de referencia y trazador SVG. `?editor=1&entity=<slug>` preselecciona una ficha para situar su pin.
- **Nitidez en táctil:** el bitmap de teselas usa DPR máx. 2 en escritorio y 2,5 en táctil (límite 6144 px por lado); con DPR 3 el nivel nativo `z=4` se alcanza desde ~4,3 px CSS/unidad en lugar de ~6,2. El contador de completados queda a la izquierda de la barra de zoom.
- `public/sw.js` (`leonidapp-static-v4`): `/map-tiles/*` con *stale-while-revalidate*.
