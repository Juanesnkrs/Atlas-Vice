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
| Escritorio | HUD flotante `100vw × 100vh` **sin scroll vertical** en Mapa (P04) e Inspector (P05). Páginas editoriales (`/`, `/hub`, `/guias`, `/noticias`, `/foro`, fichas, `/aportar`) sí hacen scroll y terminan en el Footer. |
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
3. **Legales** (S6.3): Privacidad, Política de cookies, Términos de uso, Marcas y propiedad intelectual, Retirada de contenido y «No vender mi información» son **enlaces a pantallas reales** `/legal/privacidad`, `/legal/cookies`, `/legal/terminos`, `/legal/marcas`, `/legal/retirada` (nunca `#`). «Acerca de» y «Ajustes de cookies» siguen abriéndose como modal. Las pantallas (`src/pages/LegalPage.tsx`, texto en `src/data/legalDocs.ts`) son editoriales con scroll y footer: h1 único, bajada, secciones en tarjetas `glass`, «Última actualización: 2026-11-23», navegación entre legales y tap targets ≥ 44 px. `/legal/cookies` incluye el panel de decisión (`CookiePreferencesPanel`, misma cookie `leonidapp_consent`); `/legal/retirada` y `/legal/privacidad` abren el formulario de Contacto con asunto preseleccionado. Los textos son **borradores pendientes de revisión profesional**.
4. **Aviso de marca registrada**: "LeonidApp es un proyecto de fans no afiliado a Rockstar Games ni Take-Two Interactive. Grand Theft Auto y sus marcas pertenecen a sus respectivos titulares."
5. **Barra inferior**: © año, **selector de idioma** y botón **Cookie Settings**.

### 5.2 Contact y Subscribe conectados a MongoDB

| Acción | Endpoint | Persistencia | Validación |
| --- | --- | --- | --- |
| Contact | `POST /api/contact` `{ email, message, website }` | `Submission` con `type: 'contact'`, `moduleSlug: 'leonidapp'`, `userId` de la sesión o `null` | Zod: `email` válido (≤ 254), `message` 10–2000 chars tras `trim`; rate limit 5/hora/IP; honeypot `website` (campo oculto, debe llegar vacío: si trae texto se responde `201 { ok: true }` sin guardar nada) |
| Subscribe | `POST /api/subscribe` `{ email, locale, website }` | `Submission` con `type: 'newsletter'`, deduplicado por `payload.email` | Zod: `locale ∈ {'es','en'}` (idioma activo del selector del Footer); mismo honeypot; rate limit 5/hora/IP; respuesta idéntica `201 { ok: true }` exista o no (sin enumeración) |

**Asunto (S6.3):** el formulario de Contacto incluye un selector de asunto (`Consulta general`, `Retirada de contenido`, `Privacidad y datos`). El contrato de la API no cambia: el asunto viaja como prefijo estándar al inicio de `message` (`[Retirada de contenido] `, `[Privacidad y datos] `); el prefijo cuenta para el máximo de 2000 caracteres y el texto del usuario sigue necesitando ≥ 10.

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
│                      HeroCarousel.tsx (carrusel del Hero, §7.12) · StaffHero.tsx + StaffHeroImage.tsx (módulo «Portada (Hero)» del panel oculto: gestor y subida de imagen)
│                      StaffImages.tsx + StaffImagesBulk.tsx (subpestaña «Imágenes» del panel: cola, carga individual y carga masiva, §7.15)
├── data/              seed.ts (capa offline-first y fallback) · leonidaMap.ts (marco de coordenadas, `MARKER_SPOTS` y metadatos de las teselas)
├── pages/             HomePage.tsx · LandingAuthPage.tsx · DashboardPage.tsx · MapPage.tsx · CatalogPage.tsx
│                      ForumPage.tsx · AdminSubmitPage.tsx · GuidesPage.tsx · NewsPage.tsx · LegalPage.tsx (páginas legales, S6.3)
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
│               ForumVote.ts · AuditLog.ts · MediaAsset.ts
├── routes/     auth.ts · catalog.ts · config.ts · forum.ts · news.ts · progress.ts · seo.ts
│               submissions.ts · contact.ts · hero.ts (GET /api/hero, GET/PUT /api/admin/hero) · media.ts (POST /api/admin/media, GET /media/:id)
├── plugins/    auth.ts
├── services/   imageProbe.ts (firma y dimensiones WebP/JPEG sin librerías) · audit.ts · mailer.ts · oauth.ts · session.ts · users.ts · validate.ts · submissions.ts · ssrLite.ts
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
   - Desde el 2026-11-21 el Hero es un **carrusel editable** (§7.12): lo anterior es la diapositiva por defecto.
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
- **Pestaña Entrar:** los 4 botones de proveedor (Google, Discord, Apple y «Continuar con correo»; este último con su campo de email. En la interfaz nunca se escribe «Magic Link»; el identificador interno `magic-link` de la API y de la configuración no cambia). **Sin contraseña** ni "¿Olvidaste tu contraseña?" (decisión de seguridad: solo OAuth2 + PKCE y Magic Link).
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
- **Móvil con sesión (claridad para personas nuevas):** al abrir un hilo se oculta la cabecera del foro (título y categorías) para dar todo el alto al hilo; el botón de volver dice «Volver a los hilos»; el envío dice «Publicar respuesta» (a ancho completo) y el botón «Discord oficial» solo se muestra en escritorio. Las tarjetas muestran el voto con la etiqueta «votos» y un extracto de dos líneas del contenido (salvo spoilers); la fila de categorías se atenúa en el borde para indicar que desliza; el formulario de hilo lleva textos de ayuda y las respuestas vacías muestran un aviso explícito.

### 7.6 Aportar (`/aportar`)

- **Introducción** de tres líneas: qué se puede compartir (lugares, fichas nuevas, correcciones), que el equipo revisa cada aporte y que, si procede, se publica, y dónde ver el estado («Mis aportes»). Sin mencionar moderación interna, roles ni administración.
- **Campos según el tipo elegido** («Un lugar del mapa», «Una ficha nueva», «Corregir un dato»). Un lugar pide nombre, zona o región, descripción e imagen opcional: **no** pide coordenadas; el aporte se guarda con `coords: null` y el equipo ubica el pin al aprobarlo (contrato en Arquitectura §2.8 y §5). La ficha nueva añade sección y categoría; la corrección, el dato a corregir.
- **Tras enviar** se sustituye el formulario por una confirmación («¡Aporte enviado!…») con el botón «Enviar otro aporte».
- **Margen inferior** `pb-[calc(7rem+env(safe-area-inset-bottom))]`: el dock no tapa el formulario ni el botón de envío.

### 7.7 Hub (`/hub`)

- Arriba, antes de las estadísticas, tres accesos para empezar: «Explorar el mapa» (`/mapa`), «Abrir guías» (`/guias`) y «Ver hilos recientes» (`/foro`), respetando los módulos activos.
- Estado de guardado: «Todo guardado · hace 2 min» (hora relativa). «Reintentar» aparece solo si hay un error real de guardado.
- Las barras de categorías sin elementos (total 0) no se muestran. El resumen distingue «X de Y lugares del mapa completados» y «X de Y fichas del catálogo (armas, vehículos…)», con datos reales de la API; las guías no suman al porcentaje y así se indica.

### 7.8 Noticias (`/noticias`)

- El resumen se muestra sin el encabezado de agencia (p. ej. `NEW YORK --(BUSINESS WIRE)--Jun. 24, 2026--`); es solo de presentación, los datos en MongoDB no cambian.
- Etiqueta discreta «Fuente en inglés» cuando el texto es claramente inglés (heurística de palabras frecuentes; ante la duda no se muestra).
- Con menos de 3 noticias aparece un aviso amable con enlace a las Guías. El contenedor mantiene su alto mínimo (CLS < 0.05).

### 7.9 Catálogo (`/catalogo`)

- **Móvil (< 768 px):** rejilla de **2 columnas** amplias (nombres de hasta 2 líneas legibles) y **scroll natural de la página** (sin doble scroll encerrado). `ViceShell` admite `lockScroll="md"`: página con scroll en móvil y HUD `100vw × 100vh` sin scroll vertical desde `md`. El Catálogo sigue **sin footer** (el contenido reserva el alto del dock).
- Sin imagen ni silueta propia, la ficha muestra un **icono SVG limpio de su categoría** (arma, vehículo, coleccionable o ficha genérica) en lugar del degradado de atardecer repetido.
- **Filtros:** en móvil los chips de subcategoría se pliegan tras un botón «Filtros» con indicador del filtro activo; en escritorio siguen visibles.
- El título del encabezado coincide con la pestaña activa («Armas», «Vehículos», «Coleccionables»…).
- **Pestañas derivadas (S1.2):** salen de `GET /api/modules` y solo aparecen los módulos activos de catálogo con `fichas > 0` (ni `mapa`, `foro` ni `guias`, que tienen pantalla propia). No hay pestañas vacías ni «Próximamente»: cuando `coleccionables` recibe su primera ficha, la pestaña aparece sola. `/catalogo` redirige a la primera pestaña visible. Una URL directa a una categoría oculta o inexistente (p. ej. `/catalogo/radio` o `/catalogo/coleccionables` con 0 fichas) muestra el estado amable «Esta categoría aún no está disponible» con un botón a la categoría por defecto (sin error técnico y con `noindex`); ningún enlace (dock, portada, Hub, pie de página, `sitemap.xml`) apunta a ella. El módulo `radio` queda desactivado y sin pantalla pública en la v1.
- **«Cargar más» (S4.1):** la rejilla muestra 24 fichas por tramo con el contador «Mostrando 24 de 200» y el botón «Cargar más» (≥ 44 px) en una fila de altura reservada (CLS = 0). La altura inicial de `/catalogo/vehiculos` en móvil no supera ≈ 3 000 px. El tramo cargado se recuerda en memoria por (categoría, subcategoría, búsqueda): al abrir una ficha y volver no se pierde; cambiar de filtro o de búsqueda reinicia el tramo; un enlace directo a una ficha lejana amplía el tramo hasta incluirla.

### 7.10 Mapa (`/mapa`) y Guías (`/guias`)

- **Mapa:** junto a «N/M lugares completados» hay un botón «?» con la ayuda: qué es completar un lugar (se marca desde su ficha y cuenta para «Mi avance») y la **leyenda de colores** de las capas con puntos (los colores reales de `MAP_LAYERS`).
- El botón «Modo editor» (solo staff autenticado) queda separado de los botones públicos de zoom (margen y anillo propio).
- **Guías:** introducción directa: «Sigue cada guía paso a paso y marca lo que ya hiciste. Tu avance se guarda solo.»

### 7.11 Transversal: cabecera, espaciado y vocabulario

- **Cabecera:** etiqueta «Mi avance» junto al porcentaje y botón de cuenta con **icono de perfil** y «Salir» (el nombre solo desde `md`); áreas táctiles ≥ 44 px. **Pantallas estrechas:** por debajo de 400 px la etiqueta «Mi avance» se oculta (queda solo el porcentaje) y las píldoras reducen su relleno, para que la cabecera quepa en teléfonos de 320-360 px sin ensanchar la página. **Tableta vertical (768 px):** el foro usa una lista de 280-360 px y el panel del hilo ocupa el resto (desde `lg` vuelve a 340-500 px); las pestañas de categoría de Foro y Catálogo se atenúan en el borde derecho en móvil para indicar que deslizan. El control de capas del mapa (móvil) pasa a varias filas si no cabe. **Pulidos de tableta:** el Catálogo usa lista de 2 columnas más detalle entre 768 y 1279 px (el visor con zoom aparece desde 1280 px, donde sí cabe) y 3 columnas de tarjetas desde 1024 px; el panel de detalle no pinta el cuadro de metadatos si la ficha no tiene valores. En el Mapa, «Capas y filtros» arranca colapsado por debajo de 1024 px (con el contador «lugares completados» y la ayuda en la misma fila). En Noticias el alto mínimo reservado es de 26 rem (antes 70 % del alto de pantalla): mantiene el CLS en ≈ 0 sin dejar una franja vacía. **Subcategorías del Catálogo en escritorio y tableta (≥ 768 px):** una sola fila que se recorre de forma evidente: flechas «‹ ›» a los lados (solo aparecen si hay más categorías en esa dirección y avanzan ~70 % de la fila), borde difuminado en el lado con más contenido, arrastre con el ratón (cursor de mano; un arrastre no selecciona ningún chip), la rueda del ratón recorre la fila y el chip activo se desplaza a la vista al elegirlo. Si todas caben (p. ej. Armas) no hay flechas ni difuminado. En móvil se mantiene el botón «Filtros» y el deslizamiento táctil nativo.
- **Espaciado inferior:** las vistas con scroll usan `pb-[calc(7rem+env(safe-area-inset-bottom))]` (o el espaciador del shell) para que el dock nunca tape botones ni enlaces.
- **Glosario público** (una palabra por concepto; no cambia rutas, claves de API ni campos):

| Concepto | Palabra en la interfaz | Evitar |
| --- | --- | --- |
| Punto del mapa | lugar | marcador, pin, entidad |
| Entrada del catálogo | ficha | elemento, ítem |
| Lo que envía la comunidad | aporte (sección «Aportar») | buzón, tablón, sugerencia |
| Avance del jugador | avance («Mi avance») | progreso |
| Guardar en la cuenta | «Todo guardado» / guardar | sincronizar, sincronización |
| Categoría del catálogo | categoría | módulo (en textos visibles) |
| Cada pantalla del carrusel del Hero | diapositiva | slide, banner |
| Pantalla de inicio pública | portada (Hero) | home, landing |
| Acceso sin contraseña con enlace al correo | «correo» («Continuar con correo», «Entrar con tu correo») | Magic Link, enlace mágico |

### 7.12 Carrusel del Hero de la portada y su módulo en el panel (2026-11-21)

**Público (`HeroCarousel.tsx`, en `HomePage.tsx`).** Misma estructura del Hero actual: texto informativo y descriptivo a la izquierda (kicker, H1, descripción, botón primario y el secundario (el «Crear cuenta gratis» de la diapositiva por defecto es solo para invitados; el botón secundario que el equipo configura en una diapositiva propia lo ve todo el mundo)), imagen a la derecha y, en móvil, texto arriba e imagen abajo como hoy.
- Datos: `GET /api/hero` (diapositivas activas ordenadas). Sin diapositivas activas, o mientras llegan los datos, se muestra la **diapositiva por defecto** (contenido actual y `public/assets/hero-gas-station.jpg`) sin parpadeo ni salto de layout.
- Con una sola diapositiva no hay controles. Con varias: avance automático cada ~4 s que se **pausa** con hover, foco o toque y se desactiva con `prefers-reduced-motion`; botones anterior/siguiente (≥ 44 px), indicadores (puntos) con etiqueta, deslizamiento táctil y flechas de teclado; transición de opacidad suave. **Móvil (< 768 px), diseño «imagen primero»:** la imagen va arriba (16:9 para las diapositivas del equipo; la imagen por defecto, vertical, se encuadra a 16:10 con las caras a la vista y sin su rótulo) con un fundido vertical hacia el texto; debajo, kicker, título (28 px), descripción (máx. 4 líneas) y los botones en una sola fila (dos columnas si caben, apilados si no; etiquetas centradas en una línea). Los puntos indicadores quedan arriba a la derecha sobre la imagen, sin las flechas (en táctil se desliza y los puntos bastan; las flechas siguen en ≥ 768 px). Tableta y escritorio mantienen texto a la izquierda e imagen a la derecha.
- Accesibilidad: `role="region"`, `aria-roledescription="carrusel"`, nombre accesible, `aria-live="polite"` solo cuando la persona navega (no en el avance automático).
- **CLS = 0:** imagen en contenedor 16:9 fijo y alto de texto reservado; la primera imagen con `fetchpriority="high"` y sin lazy, las demás `loading="lazy"`; `decoding="async"`; si una imagen falla (`onError`) se vuelve a la diapositiva por defecto.

**Panel (`/_staff` → Contenido público → «Portada (Hero)», ADMIN+, chunk `staff-panel`).** Sigue el patrón de los demás gestores (lista, formulario modal con borrador, confirmación de borrado escribiendo un identificador corto, avisos, `pb-28`/safe-area, bloque «Qué controla en la app pública» y enlace a `/`).
- Lista con miniatura, título, estado (Activa/Pausada), subir/bajar, editar y borrar; «Añadir diapositiva» (máx. 6; mínimo 1 activa, o el Hero vuelve a la diapositiva por defecto) y vista previa del Hero tal como se verá.
- Formulario: kicker (≤ 60), título (≤ 90), descripción (≤ 220), texto y enlace del botón (≤ 30; ruta interna `/…` o `https://…`), botón secundario opcional, imagen y texto alternativo (≤ 140, obligatorio).
- **Imagen:** tamaño estándar visible y exigido **1600 × 900 px (16:9), WebP o JPG, ≤ 400 KB**. Subida hecha en el navegador sin librerías: `<input type="file" accept="image/*">` → `<canvas>` → recorte centrado «cover» a 1600×900 → `toBlob('image/webp')` con calidad descendente hasta ≤ 400 KB (JPEG si no hay WebP) → vista previa con guía de encuadre → envío binario a `POST /api/admin/media` al guardar. Se rechaza lo que no es imagen, pesa > 15 MB de origen o mide menos de 800×450 («La imagen es demasiado pequeña»); si no es 16:9 se avisa de que se recortará. Alternativa: pegar un enlace `https://…` (con vista previa y aviso de usar solo imágenes propias o con licencia; no se re-procesa ni se valida su tamaño).

### 6.4 Mapa interactivo (P04) — teselas del referente + capa interactiva SVG

- **Base cartográfica:** el área cartográfica (sin la columna derecha de leyenda, créditos, frames ni interiores) del mapa comunitario de Leonida (`public/ref Leonida map/The final version of Commnunity map.jpeg`, recorte 6600 × 9300 px en `x=500, y=650`) con **sus colores y textos originales, sin recolorear ni retocar**, publicado como **pirámide de teselas WebP** en `public/map-tiles/{z}/{x}/{y}.webp` (512 px, `z=0..4`, `z=4` = resolución nativa 1:1, WebP calidad 86, ~7,6 MB en total y solo se descargan las visibles) con `manifest.json`. El relleno fuera del recorte y el fondo del lienzo usan el océano del referente (`WATER = #2C68A6`). La app **no** dibuja rótulos propios encima. La versión de la pirámide es `manifest.json` → `v`; las teselas se piden como `?v=<v>` y `sw.js` descarta las de otra versión. Es obra derivada de un mapa de terceros, autorizada por el propietario (ver `CLAUDE.md` §2) (por decisión del propietario la app no muestra texto de atribución sobre el mapa). El original sigue en `.gitignore` y fuera de `dist/`.
- **Proyección:** las teselas cubren el rectángulo del mundo `x ∈ [249.6, 760.6]`, `y ∈ [13.2, 733.2]` del lienzo 0–1000 × 0–700 (`manifest.json` → `world`), con la misma transformación lineal que los `MapMarker` de MongoDB: `x = (px − 500)·0,2·K + 249,59660`, `y = (py − 650)·0,2·K + 13,17385`, `K = 0,387112` (`px, py` en píxeles del referente).
- `src/components/ui/mapPaint.ts`: pinta en un `<canvas>` únicamente las teselas visibles del nivel `z` adecuado a la escala (caché en memoria; mientras carga una tesela se dibuja el recorte de su ancestro `z-1`… para evitar huecos). El bitmap se mueve con `translate3d` + `scale` en cada frame de rAF y solo se repinta al cargar teselas, cambiar de nivel `z` o alejarse del bitmap en caché.
- `src/components/ui/MapCanvas.tsx`: transformación `{ x, y, scale }` en una `ref` aplicada con `requestAnimationFrame`; zoom anclado al cursor, pinch, inercia, límites sobre el contorno de la isla (`ISLAND_BBOX`), clustering por rejilla y *culling*. En SVG quedan **solo** los elementos interactivos: pines, clusters, mira, trazador y calca del Modo Editor.
- `MapPage.tsx`: filtros AND (capas, región, ocultar completados), buscador con normalización NFD, deep-link `?pin=` y **Modo Editor** (solo en el panel oculto `/_staff` para staff autorizado; no existe en la UI pública): mira, copiar `(x, y)`, alta/movimiento de marcadores vía `POST`/`PATCH /api/markers`, calca de referencia y trazador SVG. `?editor=1&entity=<slug>` preselecciona una ficha para situar su pin.
- **Nitidez en táctil:** el bitmap de teselas usa DPR máx. 2 en escritorio y 2,5 en táctil (límite 6144 px por lado); con DPR 3 el nivel nativo `z=4` se alcanza desde ~4,3 px CSS/unidad en lugar de ~6,2. El contador de completados queda a la izquierda de la barra de zoom.
- `public/sw.js`: `/map-tiles/*?v=N` con *stale-while-revalidate* (ver §7.14 para la estrategia completa de PWA).

### 7.13 Modo editor del mapa: guía de 3 pasos (2026-11-21)

Solo para el equipo (`isStaff()`; el RBAC real sigue en la API). Objetivo: que una persona nueva del equipo coloque un pin sin instrucciones.

- **Flujo guiado, 3 pasos numerados que se marcan con ✓:** (1) «Elige la ficha (opcional)» — buscador de fichas, vacío = lugar nuevo; (2) «Toca el mapa donde irá el pin» — confirma «Punto fijado ✓ (x · y)» con «Copiar» pequeño; se puede volver a tocar para corregir; (3) «Completa los datos y guarda» — «Nombre del pin» (se rellena con el de la ficha) y «Zona o región» (sugerida por el pin más cercano). El enlace corto (`?pin=`) queda en «Más opciones» y se genera del nombre. El botón «Guardar pin» está desactivado hasta que todo esté listo y una línea dice exactamente qué falta («Para guardar falta: tocar el mapa, el nombre…»).
- **Pin existente:** si hay uno seleccionado aparece «Mover un pin que ya existe» (arrastrarlo, o fijar un punto y «Mover «X» al punto fijado»).
- **Herramientas avanzadas** (calca de referencia y trazador de dibujo, que antes ocupaban lo primero del panel) quedan plegadas al final.
- **Vocabulario:** «punto», «nombre del pin», «zona o región», «ficha del catálogo», «enlace corto»; sin «mira», «lienzo 0–1000 × 0–700» ni «slug» en la interfaz. Una sola salida: «Salir».
- **Escritorio y tableta (≥ 768 px):** el panel ocupa la columna izquierda en lugar del control de capas (que se oculta mientras se edita) y cabe sin scroll; no se muestra la ficha del pin seleccionado a la vez.
- **Móvil:** panel acoplado sobre el dock (portal fuera del lienzo táctil, con scroll propio, máx. 46 % del alto) que **arranca plegado** como una barra («Toca el mapa para fijar el punto») para dejar el mapa libre; al fijar el punto se abre y el lienzo reserva ese espacio, acerca el mapa y centra el punto en la zona visible. Se puede ocultar/abrir y salir desde la barra. El zoom sube de posición para no quedar tapado.
- **Mira:** trazo dorado con contorno oscuro para que se lea sobre el terreno claro.

### 7.15 Estudio de imágenes en el panel y calidad en la app pública (S3, 2026-11-23)

**Subpestaña «Imágenes»** (`/_staff` → Contenido público → `?b=imagenes`, ADMIN+; chunk `staff-panel`). Sin librerías: Tailwind sobre los tokens Vice NUI y SVG inline.
- **Cabecera:** bloque «Qué hace» (imágenes ya editadas en Photoshop a 1600×900 en 16:9; la app recorta si hace falta y genera la versión grande y la de listados) y medidor «Imágenes propias: N de 40» (barra con `role="progressbar"`; «a partir de 40 se pueden activar anuncios») con contadores Sin imagen, Provisionales y Propias.
- **Una a una:** cola paginada (50) de fichas pendientes (alternable a «Todas»), filtros por módulo con conteo y buscador con retardo. Cada fila: miniatura (`?w=800`) o silueta del sistema, título, slug, chip Sin imagen / Provisional / Propia y zona de soltar con botón «Elegir imagen» (accesible por teclado). Al soltar o elegir se abre un diálogo (hoja inferior en móvil) con ANTES y DESPUÉS en marco 16:9; si la proporción no es 16:9 el DESPUÉS es un recorte `cover` con foco ajustable (clic o toque en el marco, o dos deslizadores de 0–100 %). Avisos: menor de 1600×900, tipo no admitido o > 12 MB bloquean «Guardar imagen»; proporción distinta, «Se recortará; ajusta el foco». Texto alternativo opcional (≤ 200). Tras guardar se muestran los pesos reales (grande y de listado) y «recortada»/«sin recorte»; la fila sale de «Pendientes» si ya no lo es.
- **Carga masiva por slug:** zona grande «Soltar varios archivos» / «Elegir archivos»; archivos `<slug>.png|jpg|jpeg|webp`. Validación local, emparejado de solo lectura con el servidor (lotes ≤ 200), tabla de simulación (Lista, No encontrada, Ambigua con selector de módulo, No válida, Repetida: se usa el último), «Aplicar N imágenes» (cola de 3, barra de progreso, errores por archivo) y reporte final copiable con «Cargar más». Cero escrituras durante la simulación.
- **Estados:** esqueleto de carga, vacío («No hay fichas pendientes: ¡todo tiene imagen propia!»), error con «Reintentar» y aviso de red caída. Tap targets ≥ 44 px, foco visible y resultados en regiones `aria-live`.
- «Reemplazar imagen» (Catálogo) se mantiene y muestra «Usa 1600×900 px (16:9)» con enlace a «Imágenes»; el «Mapa de la PWA» añade el acceso directo «Imágenes de las fichas».

**App pública.** Las imágenes propias `/media/<id>` llevan `srcset` 800w/1600w con `sizes`, `loading="lazy"`, `decoding="async"`, marco de tamaño fijo (CLS = 0) y `object-fit: cover`: listados y teselas usan `?w=800`; ficha, visor del Inspector y Hero, la principal. Helper único en `src/data/seed.ts` (`thumbUrl`, `imageSrcSet`, `imageAttrs`); assets estáticos y https no usan `srcset`. El diseño del catálogo no cambia; las fichas sin imagen conservan sus siluetas. **Visor 16:9 (S2.3):** con imagen, el visor del Inspector y la imagen de la ficha pública usan un marco `aspect-video` a todo el ancho de su columna (`object-cover`; `object-contain` en provisionales de terceros), de modo que una exportación 1600×900 se ve completa sin recorte lateral; las teselas de listado siguen cuadradas y las fichas sin imagen conservan el marco cuadrado/alto fijo. **Altura reservada del pie del detalle:** el bloque «Ubicación en el mapa» mide siempre 48 px (con o sin pin) para que el botón de completado no se desplace al cargar los pines (CLS = 0).

**Panel de comparación (S2.3, `StaffCompare.tsx`).** En staff → Comunidad y moderación → Aportes, cada aporte del pipeline lleva el botón «Comparar» (resaltado en `conflicto`). Abre el `Modal` (diálogo ancho `max-w-5xl` en escritorio, hoja inferior en móvil, foco atrapado) con dos columnas apiladas en móvil, «Ficha actual» y «Propuesta del pipeline» (título, subtítulo, categoría, descripción completa, confianza, fuente); los campos distintos llevan borde dorado y la etiqueta «Cambia» (no solo color). Bloque de imagen «Imagen actual / Sin imagen» frente a «Imagen provisional propuesta» (miniatura, peso en KB, «de terceros, transitoria»); metadatos legibles en el acordeón «Más datos» sin claves técnicas. Acciones con texto claro: «Mantener mi ficha» (principal), «Usar solo la imagen» (deshabilitada con el motivo visible) y «Aceptar la versión del pipeline» (peligrosa, con confirmación que avisa de que reemplaza el texto). Estados: esqueleto, error con «Reintentar», 409 con aviso amable; tras resolver, toast, cierre y refresco de bandeja y contadores. En `nueva`/`actualizada` es una vista previa de solo lectura con «Cerrar».

### 7.14 Tarjeta «Pipeline de datos y catálogo (ETL)» en el panel

Solo para el equipo ADMIN+ (`isStaff()`; el RBAC real sigue en la API). Vive en `/_staff` → **Editorial y automatización** → subpestaña **Pipeline** (S1.6: «Editorial y automatización» se divide en tres subpestañas, **Noticias**, **Pipeline** y **Guías publicadas**, con el mismo patrón de subpestañas de «Contenido público»: la subpestaña activa y los filtros viajan en `?b=` y se recuerdan al cambiar de pestaña), con el mismo patrón de tarjeta HUD (glassmorphism Vice NUI, título con icono SVG inline, `pb-28`/safe-area en móvil). Sin librerías nuevas ni archivos fuera del árbol aprobado (se integra en `src/components/ui/StaffEditorial.tsx`).

- **Estado (insignia):** «Activo» (verde) si el último lote llegó hace menos de 24 h; «En espera» (ámbar) tras 24 h sin lotes o si nunca hubo uno. Junto a la insignia, fecha y hora del último lote y su origen (`source` · `modulo`).
- **Métricas del último lote:** cinco contadores en rejilla (2 columnas en móvil, 5 en escritorio): **Creados**, **Actualizados**, **Sin cambios**, **Conflictos** y **Rechazados**. Si el lote fue una simulación se muestra la etiqueta «Simulación». Sin ejecuciones: estado vacío claro («Aún no ha llegado ningún lote»).
- **Rechazados:** al pulsar el contador se despliega la lista de motivos por `slug` (`slug` en mono + motivo), con scroll propio (máx. 240 px) y sin saltos de diseño (CLS = 0).
- **Auditoría:** enlace «Ver en Auditoría» que abre `/_staff` → Auditoría ya filtrada por la etiqueta `system:pipeline` (visible solo a SUPER_ADMIN; para ADMIN se oculta el enlace).
- **Sincronizar ahora:** botón primario (PalmButton, ≥ 44 px) que llama a `POST /api/admin/pipeline/trigger`. Queda **desactivado** con el aviso «Configura PIPELINE_WEBHOOK_URL para sincronizar desde aquí» cuando la API informa de que la variable no está configurada, y también mientras hay una ejecución en curso («Sincronizando…»). Tras pulsar se refresca la tarjeta con `GET /api/admin/pipeline/runs`.

### 7.14 PWA: manifest, service worker, offline y actualización (S6.1, 2026-11-23)

- **Manifest** (`public/manifest.webmanifest`): `id` y `scope` `/`, `start_url` `/`, `display: standalone`, `orientation: portrait`, `lang: es`, `theme_color` y `background_color` `#2E1A47` (inicio del degradado Vice Sunset), iconos `icon-192.png`, `icon-512.png` (`any`), `icon-maskable-512.png` (`maskable`, contenido dentro de la zona segura del 80 %) e `icon.svg`. `index.html` enlaza el manifest, `theme-color`, `apple-touch-icon.png` (180 px) y las metas iOS (`apple-mobile-web-app-*`). Los PNG son estáticos generados desde `icon.svg`; no hay capturas (`screenshots`) porque son opcionales.
- **Registro:** `src/main.tsx` registra `/sw.js` solo en producción, tras `load`, con alcance `/`. El servidor sirve `sw.js` con `Cache-Control: no-cache` para que el navegador compare el archivo en cada visita.
- **Estrategia de caché** (`public/sw.js`, versión `leonidapp-static-v10`): navegación *network-first* con copia de la shell `/` solo para modo sin conexión; `/assets/*` e iconos *cache-first* (nombres con hash); `/map-tiles/*?v=N` *stale-while-revalidate* (el `v` del manifiesto de teselas invalida las antiguas); `/media/*` *cache-first* en una caché aparte (`leonidapp-media-v1`) con tope de 80 entradas. **Nunca** se intercepta ni se cachea: `/api/*` (incluida `/api/auth/*`; sin red responde 503 JSON), `/_staff` y `/_staff/assets/*` (el panel oculto no entra en el precaché ni en la copia de la shell), `sitemap.xml`, `robots.txt`, el manifiesto de teselas y el propio `sw.js`.
- **Sin conexión:** una ruta ya visitada (y cualquier otra, porque la SPA se resuelve en el cliente) se abre desde la shell cacheada con los datos de IndexedDB. Si ni siquiera existe la shell, el SW devuelve una página propia «Sin conexión» (Vice NUI, botón de 44 px) en lugar de la pantalla del navegador. `/_staff` exige red por diseño.
- **Actualización:** `skipWaiting()` + `clients.claim()`; al activarse una versión nueva se borran las cachés antiguas (salvo la de `/media`). Si una pestaña abierta pide un chunk con un hash que ya no existe, `reloadOnceForStaleAssets` (`src/main.tsx`) recarga **una sola vez** (marca de sesión que se retira a los 10 s: solo un indicador, nunca datos de sesión). Al cambiar `sw.js` hay que subir `CACHE` (p. ej. v11).
- **Fuentes y CLS:** Poppins y Jost se cargan de Google Fonts con `media=print`/`onload`; `vice-nui.css` declara fallbacks locales con métricas ajustadas (`Poppins Fallback`, `Jost Fallback`) para que el cambio de fuente no reflujee el texto. La cabecera reserva ancho (`min-w`) en «Mi avance» y «Entrar» y las tarjetas de «Explora Leonida» reservan la línea del conteo.
- **Hero:** la imagen por defecto de la portada usa `srcset` con `hero-gas-station-800.webp` (67 KB) y el JPG de 1080 px (153 KB).
- **Lighthouse móvil (S6.2):** Lighthouse 13 ya no incluye la categoría PWA; la instalabilidad se verifica por CDP (`Page.getInstallabilityErrors` sin errores). Presupuestos: LCP ≤ 2,5 s, CLS = 0, TBT ≤ 200 ms, peso inicial ≤ 1,5 MB. Las medidas en `localhost` usan red y CPU simuladas y no reflejan CDN ni HTTP/2 de producción; la LCP simulada de la portada (~5,1 s) depende de la ejecución de JS con CPU 4x (LCP real sin throttling ~0,9 s) y de que el HTML no incluya la imagen. Mejora pendiente de servidor: `<link rel=preload>` y prerender de la portada en SSR-lite, y miniatura de 400 px para las tarjetas del catálogo.
