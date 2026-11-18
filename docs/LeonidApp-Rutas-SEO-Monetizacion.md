# LeonidApp — Rutas, SEO y Monetización

**Estado:** Fuente de Verdad Única (enrutado, SEO técnico, enlazado cruzado y publicidad).
**Sustituye a:** las secciones de navegación de `docs/AtlasVice-v2.md` y `docs/AtlasViceNavegacionWireframesNUI.md` (`[LEGADO HISTÓRICO - NO USAR]`).
**Datos:** ver `docs/LeonidApp-Arquitectura-Datos-MongoDB.md`. **UI:** ver `docs/LeonidApp-UI-NUI-DesignSpec.md`.

---

## 1. Enrutado con History API

- El cliente usa **rutas limpias con History API** (`history.pushState` + evento `popstate`). Queda **eliminado el enrutado hash** (`#/…`).
- Sin librería de router externa: el núcleo (`navigate`, `popstate`, interceptación de `<a href>` internos, `matchRoute`, `usePageMeta`) vive en `src/store/useRouteStore.ts`; la tabla `ruta → vista` y las guardas, en `src/App.tsx`.
- Fastify es el origen único en producción:
  - Sirve los archivos estáticos compilados de `dist/` (`/assets/*` y demás rutas con extensión) con `node:fs`, sin dependencias nuevas: tipo MIME por extensión, protección contra path traversal (la ruta resuelta debe quedar dentro de `dist/`), `Cache-Control: public, max-age=31536000, immutable` para `/assets/*` y `404` JSON si el archivo no existe.
  - Sirve `index.html` (con SSR-lite, §3) para toda ruta del cliente que no empiece por `/api/`, no tenga extensión y no sea `/sitemap.xml` ni `/robots.txt` (fallback SPA). Rutas desconocidas → `404` real con `<meta name="robots" content="noindex">`.
- Compatibilidad: el cliente convierte `#/<ruta>` heredado a `/<ruta>` con `history.replaceState` una sola vez al arrancar.

### 1.1 Mapa oficial de rutas públicas (indexables)

| Ruta | Vista | Fuente de datos | Sitemap |
| --- | --- | --- | --- |
| `/` | Portada (`HomePage.tsx`, DesignSpec §7.2): hero compacto, tarjetas de secciones, noticias, guías y foro en vivo | `Module`, `Entity`, `OfficialNews`, `ForumThread` (preview) | Sí |
| `/mapa` | P04 Mapa de Leonida (HUD 100vh) | `MapMarker` | Sí |
| `/catalogo` | P05 Catálogo/Inspector (`CatalogPage.tsx`) | `Module`, `Entity` | Sí |
| `/catalogo/:modulo/:slug` | P05 ficha de entidad | `Module.slug` + `Entity.slug` | Sí (una URL por entidad) |
| `/guias` | Índice de guías (editorial) | `Entity` del módulo `guias` | Sí |
| `/guias/:slug` | Guía (editorial) | `Entity.slug` del módulo `guias` | Sí |
| `/noticias` | Listado de noticias oficiales | `OfficialNews` | Sí |
| `/noticias/:slug` | Noticia oficial (título, extracto, enlace al original) | `OfficialNews.slug` | Sí |
| `/foro` | P07 Foro (`ForumPage.tsx`) | `ForumThread` | Sí |
| `/aportar` | P06 Aportes (USER), moderación (MODERATOR+), Control Total (SUPER_ADMIN) | `Submission` | No (`noindex`) |

### 1.2 Rutas de aplicación (no indexables, `noindex`, fuera del sitemap)

| Ruta | Vista | Motivo |
| --- | --- | --- |
| `/hub` | P03 Dashboard (icono `Hub` del BottomDock) | Contenido personal |
| `/progreso` | P03 sección de progreso (icono `Progreso`) | Contenido personal |
| `/entrar` | P01/P02 Acceso (`LandingAuthPage.tsx`, réplica de `Main.dc.html` / `MobileHero.dc.html` con los 4 proveedores, DesignSpec §7.3) | Formulario |

### 1.3 Parámetros de consulta permitidos

Solo estado de vista; la URL canónica nunca los incluye:

- `/mapa?region=<Region>&marker=<uuid>` — centra/resalta.
- `/foro?categoria=<Categoria>&hilo=<uuid>&entity=<uuid>&marker=<uuid>` — filtra por categoría, abre hilo, o muestra los hilos de una entidad / un marcador (enlazado cruzado §5). `ForumPage.tsx` usa internamente `thread`; `App.tsx` traduce `hilo → thread`.
- `/catalogo?comparar=<slugA>,<slugB>[,<slugC>]` — abre el comparador NUI (§5).
- `/catalogo?modulo=<Module.slug>` — abre el Inspector en la pestaña de ese módulo (accesos de la portada). Canonical `/catalogo`. Un slug inexistente o inactivo abre la primera pestaña disponible.
- `/entrar?next=<ruta interna>` — retorno tras login (validado en servidor como ruta interna).

### 1.4 Redirecciones `301`

| Origen | Destino |
| --- | --- |
| `/aportes` | `/aportar` |
| `/catalogo?entity=<uuid>` | `/catalogo/:modulo/:slug` resuelto |
| `/noticias?item=<slug>` | `/noticias/:slug` |

---

## 2. Reglas de slug

- Formato: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, máx. 120 chars, sin acentos (normalización NFD + eliminación de diacríticos).
- `Module.slug` único global; `Entity.slug` único por módulo; `OfficialNews.slug` único global.
- Un slug publicado no se reutiliza; si cambia, se registra la redirección `301` desde el antiguo.

---

## 3. SSR-lite en Fastify (meta tags + JSON-LD)

Fastify **no** renderiza React. La lógica vive en `server/src/services/ssrLite.ts` (resolución de ruta, caché, render del `<head>`) y se conecta en `routes/seo.ts`. Inyecta en `index.html` (plantilla leída una vez al arrancar, `dist/index.html`) un bloque de `<head>` por ruta, entre los marcadores `<!--ssr-head-->` y `<!--/ssr-head-->`:

| Elemento | Regla |
| --- | --- |
| `<title>` | `<Título de la página> · LeonidApp` (≤ 60 chars) |
| `<meta name="description">` | 120–160 chars, derivado del contenido visible (`subtitulo`, `summary`, intro de guía) |
| `<link rel="canonical">` | `PUBLIC_SITE_URL` + ruta limpia, sin query ni hash |
| Open Graph | `og:title`, `og:description`, `og:url` (= canonical), `og:type` (`website` / `article`), `og:image` (`imagen_url` / `imageUrl` / `hero-gas-station.jpg`), `og:locale` |
| Twitter | `twitter:card=summary_large_image` + título/descripción/imagen |
| `robots` | `index,follow` en §1.1 (excepto `/aportar`); `noindex,nofollow` en §1.2, `/aportar` y `404` |
| `hreflang` | `es` y `en` + `x-default` cuando la página tenga ambos idiomas |
| JSON-LD | `<script type="application/ld+json">` (tabla siguiente) |

| Ruta | Tipos JSON-LD |
| --- | --- |
| `/` | `WebSite` (con `SearchAction` hacia `/catalogo?q=`) + `Organization` (LeonidApp, sin afiliación con Rockstar) |
| `/catalogo/:modulo/:slug` | `Thing` / `CreativeWork` (con `isPartOf` = módulo) + `BreadcrumbList` (Inicio › Catálogo › Entidad; no hay página de módulo, así que el módulo no es un nivel de la miga) |
| `/guias/:slug` | `HowTo` (con `HowToStep` por cada `metadata_json.steps[]`) si la guía tiene pasos; si no, `Article`. Siempre + `BreadcrumbList` |
| `/noticias/:slug` | `NewsArticle` (`headline`, `datePublished`, `image`, `isBasedOn` = `sourceUrl` oficial) + `BreadcrumbList` |
| `/mapa`, `/foro`, `/noticias`, `/guias`, `/catalogo` | `CollectionPage` + `BreadcrumbList` |

Reglas:

1. Todo valor se escapa (HTML y `</script>` en JSON-LD → `<`).
2. Los datos estructurados coinciden con el contenido visible; nada de contenido oculto solo para buscadores.
3. Fallo de BD → `<head>` genérico de la landing y `200` para la SPA; nunca `500` en rutas públicas.
4. Caché en memoria por ruta (TTL 5 min), invalidada al promover `Submission` o ingerir noticias.
5. El cliente actualiza `document.title` y `canonical` al navegar (sin re-inyectar JSON-LD).

---

## 4. `GET /sitemap.xml` y `robots.txt`

- `GET /sitemap.xml` (Fastify, `server/src/routes/seo.ts`) genera **URLs limpias sin `#`** y sin parámetros de consulta.
- Incluye: rutas estáticas de §1.1 (excepto `/aportar`), una URL por `Entity` (`/catalogo/:modulo/:slug`, de módulos `activo`), una por guía (`/guias/:slug`) y una por `OfficialNews` (`/noticias/:slug`).
- `lastmod` real: `Entity.created_at`, `OfficialNews.updatedAt` / `publishedAt`; las estáticas usan la fecha máxima de su colección.
- Límite 50 000 URLs por archivo; si se supera, `GET /sitemap.xml` devuelve un `sitemapindex` con `/sitemap-<n>.xml`.
- `Content-Type: application/xml; charset=utf-8`, `Cache-Control: public, max-age=3600`.
- `robots.txt` (en `public/`): `Allow: /`, `Disallow: /api/`, `Disallow: /aportar`, `Disallow: /hub`, `Disallow: /progreso`, `Disallow: /entrar`, `Sitemap: <PUBLIC_SITE_URL>/sitemap.xml`.

---

## 5. Enlazado cruzado `Lore ↔ Mapa ↔ Catálogo ↔ Foro`

Cada relación es un enlace real `<a href>` con ruta limpia (rastreable), derivado de campos del modelo de datos:

| Desde | Hacia | Campo | Enlace |
| --- | --- | --- | --- |
| Ficha `Entity` (Catálogo) | Mapa | `MapMarker.entity_id = Entity._id` | `Ver en el mapa` → `/mapa?marker=<id>` |
| Pin `MapMarker` (Mapa) | Catálogo | `MapMarker.entity_id` | `Ver ficha` → `/catalogo/:modulo/:slug` |
| Ficha `Entity` / Pin | Foro | `ForumThread.entity_id` / `marker_id` | `Hilos relacionados` → `/foro?hilo=<id>` (máx. 5) y `Abrir hilo` precargado |
| Hilo del Foro | Catálogo / Mapa | `entity_id` / `marker_id` | chips bajo el título |
| Guía (Lore) | Catálogo / Mapa | `metadata_json.lore_refs[]` (UUID de `Entity` o `MapMarker`) | enlaces en el cuerpo y bloque "En esta guía" |
| Ficha `Entity` | Guías | `lore_refs` inverso | `Guías que la mencionan` |
| Noticia oficial | Catálogo | — | Sin enlaces automáticos (contenido oficial; evita insinuar afiliación) |

Reglas: sin enlaces rotos (solo se renderiza si el destino existe), anclas descriptivas (no "clic aquí"), máximo 3 clics desde `/` a cualquier contenido.

### 5.1 Comparador NUI

- Compara **2 o 3** `Entity` del **mismo módulo** sobre las claves numéricas comunes de `stats_json`.
- Se abre en `/catalogo?comparar=a,b[,c]` como `BottomSheet` (móvil) o panel HUD (escritorio) **superpuesto**: no altera el layout de `CatalogPage.tsx`.
- Cada métrica se muestra con `StatBar`; la mejor por fila se resalta con el acento sunset (`#E1307E` → `#F67E56`); valores no comparables se muestran como `—`.
- Canonical → `/catalogo`; `noindex` cuando hay `?comparar`.
- Sin datos remotos adicionales: usa la caché TanStack/IndexedDB de las entidades (offline-first).

---

## 6. Monetización: reglas estrictas de `<AdSlot/>`

Configuración en `AppConfig.monetization` (ver documento de datos §2.2). Componente único: `src/components/ui/AdSlot.tsx`.

### 6.1 Dónde SÍ (solo páginas editoriales con scroll)

| Ruta | Posiciones permitidas |
| --- | --- |
| `/guias` | `after-content` |
| `/guias/:slug` | `in-article` (tras el 2.º bloque, máx. 1), `after-content`, `sidebar` (solo escritorio ≥ 1280px) |
| `/noticias`, `/noticias/:slug` | `after-content` |
| `/catalogo/:modulo/:slug` | `after-content` (bajo la ficha, nunca dentro del Inspector HUD) |
| `/foro` | `after-content` (tras la lista de hilos, nunca entre posts) |

Máximo **2 `AdSlot` por página**.

### 6.2 Dónde NUNCA

- `/mapa` (HUD `100vw × 100vh` sin scroll) — ni superpuesto ni en drawers/BottomSheets del mapa.
- Inspector HUD de `/catalogo` en escritorio (`100vh`), y el comparador NUI.
- Sobre, dentro o tapando el `BottomDock`, ni en la zona `env(safe-area-inset-bottom)`.
- `/`, `/entrar`, `/hub`, `/progreso`, `/aportar`, modales, pantalla de Auth y Footer.
- Como intersticial, pop-up, sticky/anchor o vídeo con autoplay.

### 6.3 Reglas técnicas (CLS = 0)

1. **Espacio reservado fijo**: el contenedor tiene `width`/`height` del slot (`aspect-ratio` + `min-height`) desde el primer render; el anuncio nunca empuja contenido. Si no llena, el hueco se colapsa solo si está fuera del viewport, o queda como superficie HUD vacía.
2. **Consentimiento**: sin la categoría "Marketing" aceptada en el modal de cookies no se carga ningún script de terceros; se renderiza el hueco reservado neutro.
3. **Carga diferida**: el script del proveedor se inyecta una única vez, tras interacción o `IntersectionObserver` (margen 200px). Nunca bloquea LCP.
4. `ads_enabled: false` o `provider: 'none'` → `AdSlot` devuelve `null` sin reservar espacio (decisión en el primer render, a partir de `GET /api/config` cacheado).
5. Etiqueta visible `Publicidad` / `Advertisement` sobre la superficie HUD (`rgba(20,14,36,0.78)` + borde cálido).
6. En Capacitor nativo (iOS/Android) los `AdSlot` web están desactivados.
7. Ningún anuncio se presenta como contenido oficial de Rockstar Games / Take-Two.
