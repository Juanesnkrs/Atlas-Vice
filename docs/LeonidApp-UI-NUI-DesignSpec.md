# LeonidApp — UI Vice Sunset NUI y Design Spec

**Estado:** Fuente de Verdad Única (sistema visual, componentes y árbol de carpetas).
**Sustituye a:** `docs/AtlasViceNavegacionWireframesNUI.md` (`[LEGADO HISTÓRICO - NO USAR]`).
**Rutas:** ver `docs/LeonidApp-Rutas-SEO-Monetizacion.md`. **Datos:** ver `docs/LeonidApp-Arquitectura-Datos-MongoDB.md`.

---

## 1. Jerarquía de fidelidad

1. **Artifact `/Design`** — manda ante cualquier duda visual. Archivos de referencia obligatorios:
   - `Mobile.dc.html` — shell móvil, BottomDock de 5 iconos, BottomSheets, tarjetas y tipografía móvil.
   - `MobileHero.dc.html` — hero de P01/P02 (póster, wordmark, artwork de la gasolinera, CTA).
2. Este documento (tokens y reglas).
3. Componentes existentes en `src/components/`.

Reglas: se replican espaciados, radios, jerarquía tipográfica, orden de elementos y estados de los `.dc.html`. No se introducen pantallas, secciones ni componentes que no aparezcan en el artifact o en este documento.

### 1.1 Páginas conservadas intactas

- `src/pages/ForumPage.tsx` y `src/pages/CatalogPage.tsx` **conservan su UI tal como está** (estructura JSX, clases Tailwind, layout y comportamiento visual).
- Solo se permite: sustituir la fuente de datos por la API (TanStack Query con fallback `seed.ts`), cambiar enlaces hash por rutas limpias y montar overlays aprobados (comparador NUI) sin alterar el layout.
- Cualquier cambio visual en estas dos páginas requiere actualizar antes este documento.

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
| Escritorio | HUD flotante `100vw × 100vh` **sin scroll vertical** en Mapa (P04) e Inspector (P05). Páginas editoriales (`/guias`, `/noticias`, fichas) sí hacen scroll y terminan en el Footer. |
| Móvil (iOS/Android/web < 768px) | `BottomDock` fijo de **5 iconos** en este orden: `Hub` (`/hub`), `Mapa` (`/mapa`), `Catálogo` (`/catalogo`), `Foro` (`/foro`), `Progreso` (`/progreso`). Paneles secundarios como `BottomSheet` deslizables. |
| Táctil | Área mínima `44 × 44px`; `env(safe-area-inset-*)` en Dock, Sheets y cabeceras. |

---

## 4. Componentes aprobados

| Componente | Archivo | Especificación |
| --- | --- | --- |
| `ViceShell` | `src/components/layout/ViceShell.tsx` | Fondo Vice Sunset + palmeras + HUD escritorio 100vh / wrapper móvil con safe areas |
| `BottomDock` | `src/components/layout/BottomDock.tsx` | 5 iconos Lucide, estado activo con `--accent`, `aria-current="page"` |
| `RockstarFooter` | `src/components/layout/Footer.tsx` (export `RockstarFooter`) | §5 |
| `PalmButton` | `src/components/ui/PalmButton.tsx` | `--accent` + palmeras SVG, etiqueta `--accent-ink` 700, variantes `button`/`a` |
| `TipCard` | `src/components/ui/TipCard.tsx` | Tarjeta HUD |
| `StatBar` | `src/components/ui/StatBar.tsx` | Barra de estadística (catálogo y comparador) |
| `BottomSheet` | `src/components/ui/BottomSheet.tsx` | Hoja deslizable con foco atrapado y cierre por gesto/Esc |
| `AdSlot` | `src/components/ui/AdSlot.tsx` | Reglas en `LeonidApp-Rutas-SEO-Monetizacion.md` §6 |

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
│   └── ui/            PalmButton.tsx · TipCard.tsx · StatBar.tsx · BottomSheet.tsx · AdSlot.tsx
├── data/              seed.ts (capa offline-first y fallback)
├── pages/             LandingAuthPage.tsx · DashboardPage.tsx · MapPage.tsx · CatalogPage.tsx
│                      ForumPage.tsx · AdminSubmitPage.tsx · GuidesPage.tsx · NewsPage.tsx
├── store/             useAuthStore.ts · useProgressStore.ts · useRouteStore.ts (router History API)
├── styles/            vice-nui.css
└── types/             database.ts
```

`GuidesPage.tsx` (`/guias`, `/guias/:slug`) y `NewsPage.tsx` (`/noticias`, `/noticias/:slug`) son las únicas páginas nuevas aprobadas; `useRouteStore.ts` es el único store nuevo aprobado. Ninguna otra subcarpeta en `src/`.

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

`server/` (raíz del backend), `supabase/` (legado, no se amplía), `android/`, `ios/`, `public/` (assets, `robots.txt`), `docs/`, `graphify-out/`, `.claude/skills/graphify/`.
