# LeonidApp — Roadmap hacia la v1 desplegable

> **Estado:** vinculante para todos los agentes (`00`–`07`) y para el propietario.
> **Fecha de redacción:** 2026-11-23 · **Rama de trabajo:** `feature/data-pipeline` → `develop` → `main`.
> **Base de evidencia:** auditoría integral del 2026-11-23 (código, Mongo, Postgres del pipeline, recorrido visual móvil/escritorio, sesión SUPER_ADMIN demo).
> **Relación con los demás documentos:** si este roadmap contradice a `LeonidApp-Arquitectura-Datos-MongoDB.md`, `LeonidApp-Rutas-SEO-Monetizacion.md` o `LeonidApp-UI-NUI-DesignSpec.md`, mandan esos tres y este roadmap se corrige. Este documento no cambia arquitectura: **ordena el trabajo, fija las reglas y define cuándo algo está terminado.**

---

## 0. Para qué existe este documento

1. Dar **claridad total** de lo que se va a implementar, en qué orden y con qué criterio de «terminado».
2. Que los agentes sigan **reglas estrictas** de desarrollo, sin omitir pasos ni interpretar a su gusto.
3. Dejar escrito, sin maquillaje, **qué impide hoy que la v1 esté completa** (sección 3).
4. Definir cómo el `00-supervisor` **aprueba o rechaza** cada entrega (sección 5): si el funcionamiento o el acabado visual/interactivo no cumplen, se devuelve a corregir.

**Objetivo único:** un primer despliegue **funcional, operativo, intuitivo y simple** para el usuario y para el super admin, listo para que los buscadores empiecen a indexarlo. Lo que no sea necesario para eso queda en el backlog posterior (sección 9) y **no entra en la v1**.

**Principio rector:** robusto por dentro, sencillo por fuera. Cada pantalla de staff debe decir en lenguaje llano *qué controla* y *dónde se ve el resultado*; ninguna acción de staff puede producir algo que la parte pública no sepa mostrar.

---

## 1. Decisiones del propietario (registro de decisiones, ADR)

Estas decisiones ya fueron tomadas por el propietario. Los agentes **no las reabren**; sí deben dejar constancia de sus riesgos.

| ID | Decisión (2026-11-23) | Consecuencia | Riesgo aceptado / condición |
|---|---|---|---|
| D-01 | **Datos y guías salen de lo ya documentado en la web** (GTABase y similares); el producto los adapta a su identidad. | El pipeline sigue alimentándose de fuentes de terceros **solo para hechos objetivos** (nombre, clase, fabricante, ubicación, orden de pasos). | Los hechos no son protegibles, pero su selección y redacción sí: ver D-02. |
| D-02 | **Los textos deben ser propios y originales** (español neutro). | Se redactan solo a partir de hechos estructurados; nunca se copia ni se parafrasea prosa ajena. La redacción la hace el escritor editorial (Gemini) bajo el prompt de §6.3. | Cada texto pasa revisión de muestreo (§5.4). Prohibido «reescribir» textos de terceros. |
| D-03 | **FIRMADA 2026-11-23.** **Imágenes tomadas de la web como solución transitoria** hasta tener el juego y capturas propias. | `fetch:assets` sigue vivo con filtro de nitidez (≥ 600×300). Se construye el **módulo manual de imágenes** (E3) para ir reemplazándolas por imágenes propias/editadas en Photoshop. | **Riesgo legal R-01 (derechos de autor y política de AdSense).** Condiciones de mitigación en §3.1. El propietario firma esta decisión antes del despliegue público (§8, puerta G-LEGAL). |
| D-04 | La v1 se despliega para **empezar la indexación**; después se itera. | Alcance cerrado (§9). Lo que no esté en §4 no entra. | Cualquier ampliación de alcance exige decisión escrita del propietario. |
| D-05 | Despliegue **portable**: Docker + Node.js + MongoDB Atlas + Cloudflare. Servidor y dominio **aún no contratados**. | Ya existen `Dockerfile`, `docker-compose.yml`, `.env.production.example` (sin probar). | Proveedor y dominio son **bloqueantes externos** (B-01, B-02, §3.6). |
| D-06 | **Módulo `radio` desactivado en la v1** y bloqueo, en UI y API de `/_staff`, de la activación de cualquier módulo sin ruta pública. Su pantalla pública se difiere a **v1.1**. | S1.1 = opción A; S1.3 obligatoria. | Sin riesgo; las 19 emisoras del ledger quedan en Postgres. |
| D-07 | **Los 158 elementos sin módulo** (87 personajes, 48 animales, 20 propiedades, 3 bandas) quedan **diferidos a v1.1** en PostgreSQL. | S2.5 resuelta: el exportador los registra como «diferido por decisión», no como «sin módulo». | No bloquea el lanzamiento. |
| D-08 | *(reservada)* Almacenamiento de variantes de imagen (MongoDB vs R2): se firma en S3.4. | — | Ver W-29. |
| D-09 | **La v1 sale sin anuncios activos** hasta superar **40 imágenes propias** cargadas. | W-41 resuelta para la v1: `ads_enabled=false`. S6.5 verifica solo el comportamiento de consentimiento. | — |
| D-10 | **Prioridad de ejecución:** primero el bloque crítico de lanzamiento (Sprints 0, 1, 2, 3, 5, 6 y 7). Sprints 4 y 8 después, **con dos matices**: (a) los ítems de S4 necesarios para las puertas G-05/G-06 se adelantan (S4.1 paginación y S4.4 `og:image`); (b) **el acta Go/No-Go (S8.3) y las puertas G-01…G-10 siguen siendo obligatorias antes de publicar**. | Orden efectivo: S0 → S1 (+S4.1) → S2 → S3 → S5 → S6 → S7 → resto de S4 → S8. | Indexar cuanto antes no exime de la puerta de calidad. |

> **Firmada (S0.2):** el propietario aprobó la excepción de transición de §3.1 el 2026-11-23 y `CLAUDE.md §2` la recoge. Los agentes **no amplían** su alcance: se aplica solo a imágenes (nunca a textos), con las cuatro condiciones de §3.1.

---

## 2. Estado actual verificado (línea base)

### 2.1 Lo que funciona
- Base de Atlas Vice: ingesta HTTP del pipeline (`POST /api/pipeline/ingest`), normalización canónica, tarjeta WebP validada, bandeja de aportes con aprobación en lote, `Reemplazar imagen` por ficha, filtro «Imagen provisional», auditoría. **65/65 tests**, `typecheck` y `build` en 0.
- Catálogo editorial propio: 243 `Entity` (mapa 10, armas 13, vehículos 200, guías 20), sitemap, robots, JSON-LD (WebSite/SearchAction, Organization, HowTo, CreativeWork, Breadcrumb), 404 uniforme de `/_staff` sin sesión.
- Visual: 21 rutas públicas y 13 vistas de staff cargan **sin errores de consola, sin 4xx/5xx inesperados y sin desbordes horizontales** en 390/360 px y escritorio.
- Pipeline (FireCrawl): ledger Postgres con 342 vehículos (todos con descripción propia redactada), 62 armas, 19 emisoras, 122 misiones, 16 actividades, 87 personajes, 48 animales, 20 propiedades, 3 bandas; colector de `gameta` operativo y aislado de `gtabase`.
- Infra portable preparada (sin probar): imagen única Docker, compose, plantilla de variables, guía Cloudflare.

### 2.2 Lo que no funciona o no está verificado
Ver sección 3 (catálogo completo de puntos débiles).

---

## 3. Puntos débiles que impiden la v1 completa (inventario exhaustivo)

Severidad: **P0** bloquea publicar · **P1** degrada de forma notable · **P2** mejora posterior. «Hist.» = historia que lo resuelve (§4).

### 3.1 Legal y cumplimiento
| ID | Punto débil | Sev. | Hist. |
|---|---|---|---|
| W-01 | **Imágenes de terceros re-alojadas** (GTABase/GaMeta) en tarjetas y, en el futuro, en `MediaAsset`. Choca con `CLAUDE.md §2`. Las fuentes de gameta para vehículos/armas miden 512×256. | P0 (decisión D-03) | S0.2, S3.x, S5.4 |
| W-02 | **Riesgo AdSense/contenido original:** catálogo con textos generados a partir de hechos de un único tercero (194/200 vehículos con «confianza baja»). | P0 | S5.1, S6.4 |
| W-03 | No hay **procedimiento de retirada** (DMCA/notificación) publicado ni verificado; el contacto del footer existe pero no está probado como canal. | P0 | S6.3 |
| W-04 | Páginas legales (privacidad, términos, cookies, aviso de marca) **no auditadas** en contenido ni en enlazado. | P0 | S6.3 |
| W-05 | `CSP img-src https:` permite imágenes de cualquier dominio (necesario hoy para enlaces del Hero). Tras migrar a imágenes propias debe restringirse. | P1 | S7.5 |

> **Redacción propuesta para la excepción de transición (para firma del propietario):** «Excepción de transición (vigente hasta la primera captura propia de cada ficha): se permite alojar como `tarjeta` una imagen tomada de la web con resolución ≥ 600×300, marcada con `capturaPropiaPendiente: true`, `metadata_json.fuente_imagen` y `metadata_json.fuente_url`. Cada imagen se reemplaza mediante el módulo Imágenes; las fichas más vistas tienen prioridad. Se atiende toda reclamación de retirada en ≤ 72 h.»

### 3.2 Coherencia del producto (staff ↔ público)
| ID | Punto débil | Sev. | Hist. |
|---|---|---|---|
| W-06 | **`radio` huérfano:** módulo activo en staff sin pantalla pública; `/catalogo/radio` dice «No encontramos esta categoría». 0 fichas aunque el ledger tiene 19 emisoras. | P0 | S1.1 |
| W-07 | **`coleccionables`:** pestaña pública fija con 0 fichas. | P0 | S1.2 |
| W-08 | Staff permite **activar módulos sin ruta pública** (no hay validación módulo↔ruta). | P0 | S1.3 |
| W-09 | `foro` y `mapa` figuran en «Módulos» como si fueran categorías de catálogo; confunde. | P1 | S1.4 |
| W-10 | El super admin **no tiene un mapa de la PWA** a mano: no sabe qué sección alimenta qué pantalla. | P1 | S1.5 |
| W-11 | «Editorial y automatización» mezcla noticias, ETL y guías en una sola pestaña. | P2 | S1.6 |

### 3.3 Pipeline y datos
| ID | Punto débil | Sev. | Hist. |
|---|---|---|---|
| W-12 | **158 elementos del ledger sin módulo destino** (87 personajes, 48 animales, 20 propiedades, 3 bandas): se pierden. | P0 (decisión) | S2.5 |
| W-13 | **539 fichas omitidas por no tener redacción** (armas 60, radio 19, guías 135, vehículos ya resueltos). Las 62 armas, 19 emisoras, 122 misiones y 16 actividades del ledger no llegan. | P0 | S5.2–S5.4 |
| W-14 | **342 vehículos redactados sin cargar**; al cargarlos habrá decenas de conflictos con las 243 fichas editoriales (en la prueba: 8 de 15 chocaron). Sin política de resolución. | P0 | S2.2, S2.3 |
| W-15 | **Manifiesto de export desfasado** (15 fichas vs 342 redactadas) y un job `write:editorial` «running» huérfano más 3 «failed» antiguos en `ingest_runs`. | P1 | S2.1 |
| W-16 | **El pipeline gasta cuota redactando fichas que luego chocan** con contenido editorial (cruce con `Entity` inexistente). | P1 | S2.2 |
| W-17 | **Sin campo de procedencia visible** (`fuente`, `fuente_url`, `fuente_imagen`) en la bandeja y el panel; cuesta distinguir qué viene de dónde. | P1 | S2.4 |
| W-18 | **Stats vacías:** GTABase no publica estadísticas y las de gameta son valoraciones 0–10 no medidas. El comparador NUI no tiene datos reales. | P1 | S2.6 (decisión) |
| W-19 | **Noticias:** 1 fuente (Take-Two IR) y 1 noticia; Rockstar Newswire sin configurar. Worker corre cada 15 min con 0 nuevas. | P1 | S5.5 |
| W-20 | **FireCrawl no está bajo control de versiones** y su `.env` contiene secretos locales; dos repos con contratos acoplados (`fichaSchema`). | P1 | S0.3 |
| W-21 | Slugs duplicados entre fuentes (37 de 40 misiones de gameta ya estaban en gtabase) → solo la primera fuente aporta; falta regla escrita de prioridad. | P2 | S2.2 |

### 3.4 Imágenes (calidad editorial móvil)
| ID | Punto débil | Sev. | Hist. |
|---|---|---|---|
| W-22 | **200 vehículos y 13 armas con la misma silueta SVG**: la cuadrícula parece un placeholder, no una revista. | P0 | E3 + S5.6 |
| W-23 | **No existe pantalla «Imágenes»**: solo «Reemplazar imagen» una a una desde la fila del catálogo. | P0 | S3.1 |
| W-24 | **Sin subida masiva** por nombre de archivo (= slug); inviable para 300+ fichas. | P0 | S3.2 |
| W-25 | `contain` **amplía** imágenes pequeñas (borroso) y las barras `#0b0f1f` aparecen con fuentes no 16:9. | P1 | S3.3 |
| W-26 | Una **única variante 1600×900**: tarjetas de listado cargan ~100–150 KB c/u; 200 tarjetas pesan. Sin AVIF, srcset ni foco (`object-position`). | P1 | S3.4 |
| W-27 | Tope 400 KB con calidad que baja hasta 42: posibles bandas en degradados/cromados. | P1 | S3.3 |
| W-28 | Sin `alt` propio por imagen, sin vista previa antes/después, sin conservar original. | P1 | S3.1, S3.5 |
| W-29 | Binarios en MongoDB: con 4 variantes × 300 fichas crece (≈165 MB); **Atlas M0 (512 MB) queda justo**. | P1 | S3.4, S7.2 |
| W-30 | **Guías, noticias, «Explora Leonida» y portada sin imágenes** (degradados). | P1 | S4.6 |
| W-31 | **Todas las fichas comparten `og:image`** (hero) y el JSON-LD `image`: al compartir por WhatsApp se ven iguales. | P1 | S4.4 |

### 3.5 Experiencia móvil y diseño editorial
| ID | Punto débil | Sev. | Hist. |
|---|---|---|---|
| W-32 | `/catalogo/vehiculos` mide ≈ 21 300 px en móvil (200 tarjetas sin paginar). | P1 | S4.1 |
| W-33 | En móvil **Guías y Noticias no están en la cabecera**; solo por home/hub/footer. Las guías son el contenido SEO principal. | P1 | S4.2 |
| W-34 | Pines del mapa sin icono ni etiqueta en móvil. | P1 | S4.5 |
| W-35 | «Ubicación en el mapa: sin pin todavía» aparece en 200 vehículos (ruido). | P2 | S4.3 |
| W-36 | Tap targets < 44 px: mapa 5, guías 4–5, noticias 1; staff móvil hasta 21 (herramienta de escritorio). | P1 / P2 | S4.7 |
| W-37 | Estilo «editorial» no formalizado: falta una **rúbrica medible** (jerarquía, ritmo, imagen, ritmo de lectura) que el supervisor pueda aplicar. | P1 | §5.3 (ya incluida) |

### 3.6 PWA, SEO técnico y monetización (no verificado)
| ID | Punto débil | Sev. | Hist. |
|---|---|---|---|
| W-38 | **No se auditó lo «PWA»:** `manifest.webmanifest`, service worker, iconos, instalabilidad, comportamiento offline, actualización de caché (`reloadOnceForStaleAssets`). | P0 | S6.1 |
| W-39 | **Lighthouse no ejecutado** (rendimiento juzgado solo por tamaño de DOM). Sin presupuestos de LCP/CLS/INP/peso. | P0 | S6.2 |
| W-40 | JSON-LD no validado con la herramienta de resultados enriquecidos; canonical/301/404 sin matriz de pruebas. | P1 | S6.4 |
| W-41 | **AdSlot no verificado con consentimiento aceptado**; `ads_enabled=false`, `slots=[]`. Decidir si la v1 sale con o sin anuncios. | P1 | S6.5 |
| W-42 | Sin alta en **Search Console / Bing Webmaster** ni envío de sitemap planificado. | P1 | S7.8 |
| W-43 | Solo existen tests de pipeline (65); **no hay pruebas de interfaz ni CI**: regresiones visuales dependen de la revisión manual. | P1 | S8.2 |

### 3.7 Despliegue y operación
| ID | Punto débil | Sev. | Hist. |
|---|---|---|---|
| W-44 | **Servidor y dominio no contratados** (bloqueante externo B-01/B-02). | P0 | S7.1 |
| W-45 | **Imagen Docker sin probar** (no hay Docker en el equipo de desarrollo); `Dockerfile` y compose nunca se han construido. | P0 | S7.2 |
| W-46 | MongoDB Atlas sin crear: usuario con mínimos permisos, lista de IP, copia de seguridad, plan (M0 insuficiente para variantes). | P0 | S7.2 |
| W-47 | Cloudflare sin configurar (SSL Full strict, reglas de caché `/assets` `/map-tiles` `/media`, bypass `/api` `/_staff` y HTML, WAF/rate-limit auth). | P0 | S7.3 |
| W-48 | **Proveedores de acceso sin configurar** (Google, Discord, Apple, Magic Link/SMTP) y `SUPER_ADMIN_EMAIL` de producción; cuentas OAuth y redirect_uri reales. | P0 | S7.4 |
| W-49 | Secretos de producción (`JWT_SECRET`, `COOKIE_SECRET`, `PIPELINE_INGEST_TOKEN`) sin generar ni gestionar. | P0 | S7.4 |
| W-50 | Sin **observabilidad** (logs centralizados, alerta de caída, `/api/health` monitorizado) ni **runbook** y plan de **rollback**. | P1 | S7.6, S7.7 |
| W-51 | Sin **copia de seguridad/restauración probada** de MongoDB. | P0 | S7.6 |
| W-52 | **Carga inicial de contenido en producción** (import por HTTP al dominio, orden y verificación) no ensayada. | P0 | S7.9 |

### 3.8 Higiene del repositorio y proceso
| ID | Punto débil | Sev. | Hist. |
|---|---|---|---|
| W-53 | **PR de `feature/data-pipeline` sin abrir** (`gh` no instalado); 16 commits sin revisión. | P0 | S0.3 |
| W-54 | Archivos de despliegue en la raíz **fuera del árbol aprobado** de `CLAUDE.md` y sin commitear. | P1 | S0.2 |
| W-55 | `graphify-out` debe regenerarse tras cada bloque (`graphify update .`). | P2 | DoD (§5.1) |
| W-56 | `FireCrawl/exports/cards` y lotes `gtabase-*.json`/`gameta-*.json` no deben versionarse (ya en `.gitignore`); verificar que no se cuelen. | P1 | DoD |

---

## 4. Plan de trabajo: épicas, historias y criterios de aceptación

**Convenciones:** cada historia tiene responsable (agente), esfuerzo estimado en días de agente, dependencias y criterios de aceptación (CA) verificables. Los CA son **la lista que el supervisor comprueba**; si uno falla, la historia se rechaza.

**Orden de sprints** (un sprint = un bloque con meta, no un periodo fijo; el supervisor cierra cada sprint con una *Review* con evidencias):

```
S0 Gobernanza ─► S1 Coherencia ─► S2 Pipeline fiel ─► S3 Módulo Imágenes ─► S4 Editorial móvil
      ─► S5 Contenido ─► S6 PWA/SEO/legal ─► S7 Despliegue ─► S8 QA final + Go/No-Go
```
Camino crítico: **S1 → S2 → S3 → S5**. S6 y la parte de infraestructura de S7 (Docker, Atlas, Cloudflare) pueden avanzar en paralelo en cuanto haya proveedor.

### Sprint 0 — Gobernanza y decisiones (≈ 2 d)
**Meta:** reglas claras, repositorio ordenado y decisiones firmadas.

| ID | Historia | Resp. | Días | CA |
|---|---|---|---|---|
| S0.1 | Publicar este roadmap y enlazarlo desde `CLAUDE.md` y `00-supervisor`. | 00 | 0,25 | Documento en `docs/`; `CLAUDE.md` lo lista como vinculante; el supervisor lo cita en su protocolo. |
| S0.2 | Firma de D-03 y actualización de `CLAUDE.md`: excepción de transición (§3.1) y archivos de despliegue válidos en la raíz. | Propietario + 00 | 0,25 | Texto aprobado por escrito por el propietario; `CLAUDE.md` coherente con la práctica; sin contradicciones entre documentos. |
| S0.3 | Abrir el PR de la base y poner FireCrawl bajo git (repo propio, `.gitignore` con `.env`, `exports/`, `data/`). | 04 + propietario | 0,5 | PR de `feature/data-pipeline` → `develop` abierto con descripción y evidencias; repo `FireCrawl` con commit inicial sin secretos (verificado con búsqueda de patrones). |
| S0.4 | Tablero: columnas, límites WIP y plantilla de historia (§5.2). | 00 | 0,25 | Plantillas listas; WIP ≤ 2 historias por agente. |
| S0.5 | Decisión de alcance de la v1 (§9) y de «con/sin anuncios» (W-41). | Propietario | 0,25 | Decisión escrita en §1 (ADR D-06, D-07). |

### Sprint 1 — Coherencia del producto: nada en staff sin reflejo público (≈ 4 d)
**Meta:** que lo que existe en staff exista en la app, y viceversa.

| ID | Historia | Resp. | Días | CA |
|---|---|---|---|---|
| S1.1 | **Radio:** decisión A (desactivar y retirar del seed hasta que haya contenido) o B (crear categoría pública `radio`). *Recomendado A en v1*, B en el backlog si se redactan las 19 emisoras. | 03 + 01 | 0,25 (A) / 3 (B) | A: `/catalogo/radio` ya no es alcanzable ni enlazado; el módulo no aparece en staff como activable. B: ruta, pestaña, estados vacíos, sitemap y JSON-LD, 19 fichas cargadas. |
| S1.2 | **Coleccionables:** ocultar la pestaña pública mientras haya 0 fichas (o cargarlos). | 03 | 0,5 | Con 0 fichas no hay pestaña ni enlace; con ≥ 1 aparece sola. Prueba en móvil y escritorio. |
| S1.3 | **Validación módulo↔ruta** en servidor y UI: solo se puede activar un módulo con pantalla pública registrada. | 01 + 03 | 1 | PATCH de activación a un módulo sin ruta devuelve 422 con mensaje claro; la UI muestra el motivo; test en `pipeline.test.ts`. |
| S1.4 | Rotular `foro` y `mapa` como «Secciones» (interruptores) separadas de «Categorías de catálogo» en Contenido → Módulos. | 03 | 0,5 | La tabla de Módulos muestra tipo (Sección/Categoría), «Dónde se ve» (ruta) y nº de fichas. |
| S1.5 | **«Mapa de la PWA» dentro de staff** (Resumen): panel de solo lectura módulo ↔ ruta ↔ sección staff ↔ conteo, con enlaces. | 03 | 1 | El super admin responde «¿dónde se ve X?» en ≤ 2 clics; datos reales, no estáticos. |
| S1.6 | Separar «Editorial y automatización» en tres sub-pestañas (Noticias, Pipeline, Guías). | 03 | 0,5 | Misma funcionalidad, navegación sin regresión; contenido de cada bloque intacto. |

### Sprint 2 — Pipeline fiel, trazable y sin fugas (≈ 6 d)
**Meta:** que lo que llega sea lo que debe, con origen visible, sin pérdidas ocultas.

| ID | Historia | Resp. | Días | CA |
|---|---|---|---|---|
| S2.1 | Manifiesto fiel al ledger y limpieza de `ingest_runs` huérfanos; `export:atlas` informa redactadas/omitidas/colisiones por módulo. | 06 | 0,5 | Manifiesto = recuento SQL real; ningún job «running» sin proceso; 3 «failed» marcados. |
| S2.2 | **Cruce previo con `Entity`:** `write:editorial` y `export:atlas` omiten (y registran) fichas cuyo slug/nombre normalizado ya existe como `editorial`, antes de gastar cuota. | 06 | 1 | Informe «ya cubiertas por editorial: N»; 0 llamadas a Gemini para ellas; prueba con los 8 casos conocidos. |
| S2.3 | **Política de conflicto** documentada y operada: por defecto *editorial gana*; la bandeja permite «Aceptar versión del pipeline» y «Mantener editorial» con comparación lado a lado. | 03 + 01 | 2 | En la bandeja se ven ambos textos y la procedencia; cada decisión queda auditada; test de promoción con conflicto. |
| S2.4 | **Procedencia visible:** `fuente`, `fuente_url`, `fuente_imagen`, `confianza` en la bandeja, ficha de staff y exportación (dentro de `metadata_json`, sin campos raíz nuevos). | 01 + 03 | 1 | Filtro por fuente en Aportes y Catálogo; documentación §2.4 actualizada. |
| S2.5 | **Destino de los 158 elementos sin módulo** (personajes, animales, propiedades, bandas): decidir por tipo: (a) módulo nuevo con pantalla, (b) fusionar en guías/catálogo, (c) descartar explícitamente. Recomendación v1: **descartar o diferir con registro**, salvo lo que enriquezca guías. | Propietario + 00 + 07 | 0,5 (decisión) | Decisión por tipo en ADR; el exportador registra «diferido por decisión» en lugar de «sin módulo». |
| S2.6 | **Política de stats:** v1 sin comparador numérico real. Los datos 0–10 de gameta se conservan en el ledger, no se publican como «medidos». | Propietario + 00 | 0,25 | ADR escrito; el comparador muestra estado «sin datos verificados» coherente, sin cifras inventadas. |
| S2.7 | Pruebas del exportador (fixtures) para `gtabase` y `gameta` y de aislamiento de fuentes. | 06 | 1 | Test automatizado: ninguna escritura de gameta modifica filas de gtabase; el export de cada fuente es independiente. |

### Sprint 3 — Estudio de Imágenes «Photoshop → PWA» (≈ 8–11 d)
**Meta:** que el propietario pueda subir, uno a uno o en lote, imágenes editadas en Photoshop y que la PWA las sirva en calidad editorial móvil.

**Especificación de entrada para Photoshop (decisión del propietario, 2026-11-23):** exportar en **1600×900 px, relación 16:9 limpia**, sRGB, margen seguro del 8 % en los bordes, JPG/PNG/WebP, hasta 12 MB (se aceptan 2400×1350 y se reducen).

**Especificación de procesamiento (vinculante para S3.1–S3.4):** toda carga manual se procesa con `sharp` usando **`fit: "cover"`** (recorte centrado o con foco, **sin barras laterales oscuras `#0b0f1f`** y sin `contain`) y genera exactamente dos salidas WebP:
- **`1600×900` WebP, ≤ 600 KB** (ficha, Hero, `og:image`).
- **`800×450` WebP** (listados y tarjetas móviles; objetivo ≤ 180 KB).

Reglas: no se amplía una fuente menor que la salida (se avisa y se rechaza o se marca `capturaPropiaPendiente` según el caso); fuente con proporción distinta de 16:9 → vista previa del recorte antes de guardar y foco (`object-position`) ajustable; calidad que baja desde 82 hasta un mínimo de 60 y aviso si no cabe en el tope. El `contain` con fondo `#0b0f1f` queda reservado solo al flujo transitorio de tarjetas del pipeline (imágenes de terceros) hasta que se sustituyan.

| ID | Historia | Resp. | Días | CA |
|---|---|---|---|---|
| S3.1 | **Pantalla «Imágenes»** en `/_staff` → Contenido público: cola de fichas «sin imagen / provisional», arrastrar y soltar, **vista previa antes/después**, peso, dimensiones, avisos (fuente < 1600 px, proporción ≠ 16:9), **texto alternativo editable** (`metadata_json.imagen_alt`). | 03 + 02 | 3 | Flujo completo en ≤ 3 clics por imagen; ProvisionalChip desaparece al guardar; funciona en 1440 px y en 390 px; accesible por teclado. |
| S3.2 | **Subida masiva por nombre de archivo = slug** (`buccaneer.png`): emparejado por módulo + slug normalizado, **simulación previa** (coincide / ambiguo / no encontrado / error) y «Aplicar»; cola de 3 en paralelo. | 03 + 01 | 3 | Informe descargable; 0 escrituras en simulación; 50 archivos mezclados se procesan sin bloquear la UI; errores por archivo, no por lote. |
| S3.3 | **Calidad de conversión:** `fit: "cover"` **obligatorio** en la carga manual (sin barras `#0b0f1f`), `withoutEnlargement`, foco opcional (`object-position`), tope de la variante grande **600 KB**, calidad mínima 60 y aviso si no se alcanza, **conservar el original** (almacén de originales). Esto sustituye al `contain`/400 KB actual de «Reemplazar imagen». | 01 | 2 | Ninguna salida con barras laterales oscuras; una fuente de 800×450 no se amplía a 1600×900; fotos de prueba (degradado, cromo, escena compleja) sin bandas visibles a 100 % en revisión del supervisor. |
| S3.4 | **Variantes responsivas:** dos salidas WebP, **1600×900 (≤ 600 KB)** y **800×450**, con `srcset/sizes` en tarjetas, ficha y Hero; URL estable normalizada para caché (p. ej. `/media/<id>?w=800|1600`), aspect-ratio fijo 16:9 (CLS = 0). AVIF y variantes intermedias quedan para v1.1. | 01 + 03 + 05 | 3 | Listado móvil descarga la variante 800×450 (≤ 180 KB por tarjeta); ficha, Hero y `og:image` usan 1600×900; documentación §2.11 y Zod actualizados; Cloudflare cachea sin variar por query no normalizada. |
| S3.5 | Auditoría y trazabilidad: `AuditLog` por subida, reemplazo y borrado; informe de «huérfanos» (media sin ficha). | 01 | 0,5 | Cada acción deja rastro; script/listado de huérfanos sin falsos positivos. |

**Decisión de almacenamiento (ADR D-08, a firmar en S3.4):** v1 guarda variantes en `MediaAsset` (MongoDB) → exige **Atlas M10 o superior** (no M0), o bien almacén de objetos (R2) con `storage_provider`. Recomendación: MongoDB en v1 si el tamaño total estimado < 300 MB; migrar a R2 en la versión siguiente.

### Sprint 4 — Experiencia editorial móvil (≈ 5 d)
**Meta:** que la app *se lea y se sienta* como una publicación, no como un listado.

| ID | Historia | Resp. | Días | CA |
|---|---|---|---|---|
| S4.1 | **Paginación/«Cargar más»** (24 por tramo) en catálogo; altura inicial ≤ 3 pantallas. | 03 + 02 | 1 | `/catalogo/vehiculos` móvil ≤ 3 000 px al cargar; el scroll mantiene posición al volver; sin saltos (CLS = 0). |
| S4.2 | **Guías y Noticias accesibles en móvil** (hoja de navegación o Hub); sin romper el dock de 5 ítems. | 02 | 0,5 | Desde cualquier pantalla se llega a Guías/Noticias en ≤ 2 toques. |
| S4.3 | Ocultar «Ubicación en el mapa: sin pin todavía» cuando la categoría no admite pin. | 03 | 0,25 | Solo aparece en fichas de módulos con pin. |
| S4.4 | **`og:image` y JSON-LD `image` por ficha** (variante 1200) con respaldo al hero. | 05 | 0,5 | `curl` a 5 fichas distintas devuelve 5 imágenes distintas; vista previa de compartir verificada. |
| S4.5 | **Pines con icono y etiqueta corta** en móvil. | 02 | 1 | Pin legible a 390 px; tap target ≥ 44 px; sin solapes en la vista inicial. |
| S4.6 | **Portadas editoriales** para Guías, Noticias y «Explora Leonida» (imágenes propias de la v1; degradado solo como último recurso). | 02 + propietario | 1 | Ninguna tarjeta principal sin imagen; peso por variante dentro de presupuesto. |
| S4.7 | **Tap targets ≥ 44 px** en mapa, guías y noticias (público). Staff móvil: solo críticos. | 02 | 0,75 | 0 elementos interactivos públicos < 44 px a 390 y 360 px. |

### Sprint 5 — Contenido real (≈ 8–10 d, mayor parte tiempo de redacción/cuota)
**Meta:** catálogo poblado y consistente.

| ID | Historia | Resp. | Días | CA |
|---|---|---|---|---|
| S5.1 | **Revisión editorial de muestra** (§5.4) sobre la redacción de vehículos antes de cargar masivamente. | 07 + 00 | 1 | 30 fichas muestreadas: 0 textos copiados, 0 modelos reales inventados, 0 cierres de relleno; criterios en §6.3. |
| S5.2 | **Carga de los 342 vehículos** tras S2.2/S2.3: nuevas, actualizadas y conflictos resueltos. | 06 + operador | 1 | Recuento final documentado (nuevas / actualizadas / conflictos / omitidas por editorial); bandeja sin pendientes. |
| S5.3 | **Armas** (62): redacción, export, carga. | 06 + 07 | 1–2 | ≥ 95 % con texto original; sin colisión con las 13 editoriales sin resolver. |
| S5.4 | **Guías:** misiones (122) y actividades (16) con ≥ 3 pasos verificables (`metadata.steps` → HowTo); radio (19) solo si S1.1 = B. | 07 + 06 | 3–4 | Cada guía con HowTo válido; pasos accionables, no relleno. |
| S5.5 | **Noticias:** añadir Rockstar Newswire (si hay feed) y verificar el worker; 0 fuentes no oficiales. | 05 | 1 | ≥ 2 fuentes oficiales activas; ingesta con inserciones reales en prueba. |
| S5.6 | **Imágenes propias para las fichas de mayor visibilidad** (vehículos y armas destacadas, guías principales) con el módulo de S3. | Propietario | continuo | ≥ 40 fichas con imagen editada por el propietario antes del despliegue; el resto con imagen transitoria o silueta limpia (nunca borrosa). |

### Sprint 6 — PWA, SEO técnico, legal y monetización (≈ 5 d)
**Meta:** que el producto sea instalable, rápido, indexable y legalmente presentable.

| ID | Historia | Resp. | Días | CA |
|---|---|---|---|---|
| S6.1 | **Auditoría PWA:** manifest, iconos (maskable), service worker, instalabilidad, offline mínimo, actualización de caché. | 04 | 1 | Lighthouse PWA/instalable en verde; instalación probada en Android/Chrome; estrategia de actualización documentada. |
| S6.2 | **Lighthouse móvil** (4G simulada) con presupuestos: LCP ≤ 2,5 s, CLS = 0, INP ≤ 200 ms, peso inicial ≤ 1,5 MB; rutas: `/`, `/catalogo/vehiculos`, una ficha, una guía, `/mapa`. | 04 + 02 | 1,5 | Informe por ruta; si falla un presupuesto, se corrige o se justifica por escrito. |
| S6.3 | **Páginas legales y canal de retiro** completas, enlazadas en el footer, con correo de contacto y plazo ≤ 72 h; contenido revisado por el propietario (idealmente por un abogado). | 02 + propietario | 1 | Privacidad, términos, cookies, aviso de marca y retirada accesibles; prueba real del formulario de Contacto (persistido en Mongo). |
| S6.4 | **SEO técnico:** validar JSON-LD (Rich Results), canonical, 301/404, `sitemap.xml` y `robots.txt`; sin duplicados; metadatos únicos por ficha. | 05 | 1 | Matriz de rutas con resultado esperado/real; 0 errores de datos estructurados. |
| S6.5 | **Consentimiento y AdSlot:** probar con consentimiento aceptado y rechazado; decisión «con/sin anuncios» en v1; CLS = 0 con anuncio. | 02 + 03 | 0,5 | Sin consentimiento no se carga nada de terceros; con él, máx. 2 bloques en `/guias/:slug`. |

### Sprint 7 — Despliegue (≈ 6 d, dependiente de proveedor y dominio)
**Meta:** servicio vivo, seguro, observable y recuperable.

| ID | Historia | Resp. | Días | CA |
|---|---|---|---|---|
| S7.1 | **Contratar servidor y dominio** (B-01, B-02). Requisito mínimo: Docker, 1 vCPU / 1–2 GB RAM, IPv4, acceso SSH. | Propietario | — | Servidor accesible; dominio apuntando a Cloudflare. |
| S7.2 | **Construir y probar la imagen Docker; crear Atlas** (usuario mínimo, IP permitidas, plan M10 si S3.4 usa MongoDB). | 04 + 06 | 1 | `docker compose build` sin errores; contenedor *healthy*; `/api/health` = 200; conexión a Atlas verificada. |
| S7.3 | **Cloudflare:** SSL Full (strict), Always HTTPS, reglas de caché (`/assets`, `/map-tiles`, `/media`), bypass de `/api`, `/_staff` y HTML, sin Rocket Loader/minify/ofuscación, rate-limit en `/api/auth`. | 04 | 0,5 | Cabeceras verificadas con `curl -I`; HTML no cacheado; estáticos con `HIT`. |
| S7.4 | **Secretos y acceso:** generar `JWT_SECRET`, `COOKIE_SECRET`, `PIPELINE_INGEST_TOKEN`; `SUPER_ADMIN_EMAIL`; configurar Google/Discord/Apple (máx. 4 accesos) y SMTP para Magic Link con `redirect_uri` reales. | Propietario + 04 | 1 | Login real con cada proveedor activado; Magic Link recibido; primer SUPER_ADMIN correcto; ningún secreto en el repositorio. |
| S7.5 | **Endurecimiento:** reducir `img-src` de la CSP al dominio propio + CDN una vez migradas las imágenes; revisar HSTS, cookies `Secure`, rate-limits. | 01 | 0,5 | Escaneo de cabeceras sin hallazgos altos; imágenes siguen cargando. |
| S7.6 | **Backups y observabilidad:** copia automática de Atlas, **restauración ensayada**, alerta de caída (monitor externo sobre `/api/health`), registro de errores. | 04 | 1 | Restauración documentada y probada en base de pruebas; alerta recibida en una caída simulada. |
| S7.7 | **Runbook y rollback:** despliegue, reversión a la imagen anterior, rotación de secretos, qué hacer ante caída. | 04 + 00 | 0,5 | Documento en `docs/`; ensayo de rollback ejecutado. |
| S7.8 | **Search Console y Bing Webmaster:** verificación de dominio y envío de `sitemap.xml`. | Propietario + 05 | 0,25 | Sitemap aceptado sin errores. |
| S7.9 | **Carga inicial en producción:** importar lotes al dominio público por HTTP (`ATLAS_API_URL`), aprobar en lote, verificar conteos. | 06 + operador | 1 | Conteos de producción = conteos de ensayo; sin conflictos pendientes; `sitemap.xml` actualizado. |

### Sprint 8 — QA final y Go/No-Go (≈ 3 d)
| ID | Historia | Resp. | Días | CA |
|---|---|---|---|---|
| S8.1 | **Recorrido completo** del supervisor sobre producción (o espejo) en móvil y escritorio, con sesión SUPER_ADMIN y de usuario; evidencias archivadas. | 00 | 1 | Lista UAT (§8.2) completa con captura por ítem; 0 defectos críticos/altos abiertos. |
| S8.2 | **Smoke tests automatizados** repetibles (CDP/Chrome headless) y comandos de verificación; CI mínimo (typecheck + build + tests) si el propietario aprueba el archivo de workflow. | 04 | 1,5 | Script que ejecuta las rutas clave y falla si hay error de consola/4xx/5xx/desborde. |
| S8.3 | **Go/No-Go** (§8) firmado por el propietario. | Propietario + 00 | 0,5 | Acta con puertas G-01…G-10 en verde. |

**Esfuerzo total estimado:** ≈ 48–58 días de agente, de los cuales ≈ 10–15 son trabajo manual/externo del propietario (decisiones, imágenes, cuentas, proveedor). Es una **estimación**, no un compromiso: el supervisor la recalcula al cerrar cada sprint.

---

## 5. Cómo se orquesta: metodología y puertas de calidad

### 5.1 Metodología (ágil + ingeniería robusta)
- **Marco:** Scrum adaptado a agentes con tablero Kanban. *Planning* (el supervisor arma el sprint desde §4), *Daily* (parte de estado breve del agente), *Review* (demostración con evidencias), *Retro* (lecciones al final de cada sprint, anotadas aquí).
- **Tablero:** `Backlog → Listo (DoR) → En desarrollo → Verificación técnica → Revisión del Supervisor → Aprobado → Integrado (PR a develop) → Desplegado`. **WIP máximo 2 historias por agente.**
- **Flujo de ramas (Gitflow):** `feature/*` desde `develop`, **commits atómicos** en Conventional Commits en español (`feat`, `fix`, `ui`, `chore`, `docs`), PR hacia `develop`; **nunca** commit directo en `main` ni `develop`.
- **Shift-left de calidad:** pruebas y documentación en la **misma** historia que el código, no después.

**Definición de «Listo» (DoR) para empezar una historia:** objetivo y CA claros; dependencias resueltas; datos de prueba identificados; decisiones del propietario (§1) cubiertas; responsable asignado.

**Definición de «Terminado» (DoD):** todo lo siguiente, sin excepción:
1. Cumple **todos** los CA de la historia.
2. `pnpm typecheck`, `pnpm build`, `pnpm --dir server typecheck`, `pnpm --dir server build` y `pnpm --dir server test` con salida **0**.
3. Tests nuevos para cada cambio de servidor (ruta, servicio, modelo) y para cada regla de negocio.
4. Documentación maestra `docs/LeonidApp-*.md` actualizada en el mismo bloque (y el cuarto documento si cambia algo de producto).
5. Sin librerías de UI externas, sin archivos fuera del árbol aprobado, modelos Mongoose con su Zod equivalente, sin campos ni colecciones no aprobados.
6. `graphify update .` ejecutado.
7. **Aprobación explícita del 00-supervisor** (§5.3). Sin ella no se integra.

### 5.2 Plantilla de historia (obligatoria)
```
ID / Título:
Como <rol: visitante | super admin | moderador | operador> quiero <acción> para <valor>.
Contexto y evidencia (punto débil W-xx):
Alcance incluido / excluido:
Criterios de aceptación (Dado / Cuando / Entonces):
Archivos previstos y docs a actualizar:
Pruebas (automáticas y manuales, con viewport):
Riesgos y plan de reversión:
Estado del tablero + enlace a evidencias:
```

### 5.3 Protocolo de aprobación del 00-supervisor (puerta de cada historia)
El supervisor **no aprueba por lectura de código**: lo ejecuta y lo ve.

1. **Verificación técnica:** repite los cinco comandos del DoD; revisa el diff (estructura, nombres, seguridad, RBAC antes de Zod, sin `.env`, sin secretos, sin destructivos).
2. **Verificación funcional con sesión real:** levanta el servidor, abre una **sesión SUPER_ADMIN demo** (`pnpm --dir server demo:access`, solo local, se revoca al terminar) y una sesión de usuario/invitado, y recorre el flujo de la historia de principio a fin, incluidos casos de error (archivo inválido, sin permiso, red caída, vacío).
3. **Verificación visual e interactiva** en Chrome (CDP) a **390×844 y 360×800 (DPR 3)** y **1440×900**, con captura por pantalla. **Rúbrica de estilo editorial** (cada ítem puntúa 0–2; se exige ≥ 90 % y ningún 0 en los marcados ★):
   - ★ Jerarquía tipográfica clara (título, bajada, cuerpo, metadatos) con la tipografía del sistema.
   - ★ Imagen principal nítida a DPR 3, sin barras ni ampliación borrosa, con proporción estable (CLS = 0).
   - ★ Cero placeholders visibles al usuario (siluetas idénticas repetidas, textos de prueba, «lorem», estados vacíos sin guía).
   - Ritmo de lectura: espaciados consistentes, líneas de 45–75 caracteres, contraste AA.
   - Estados completos: cargando, vacío, error con «Reintentar», sin sesión.
   - Interacción: tap targets ≥ 44 px, foco visible, gestos del bottom sheet, teclado en escritorio.
   - ★ Sin errores de consola, sin 4xx/5xx inesperados, sin desbordes horizontales.
   - Rendimiento percibido: sin saltos, imágenes con `loading` y `decoding` correctos.
   - Texto en español neutro, sin faltas y sin jerga técnica en la interfaz de usuario.
4. **Veredicto escrito:** `APROBADO` o `RECHAZADO`, con **lista numerada de defectos** (severidad, evidencia, cómo reproducir, criterio incumplido). Un rechazo vuelve a «En desarrollo» con el mismo agente.
5. **Ciclo de corrección:** máximo **3 vueltas** por historia; a la tercera, el supervisor escala al propietario con un resumen y una propuesta.
6. **Evidencias:** capturas e informes fuera del repositorio (carpeta hermana `..\evidencias-v1\<sprint>\<historia>\`), citadas en el PR. Nunca se imprimen cookies ni tokens.
7. **Regla de oro:** *si al supervisor no le gusta cómo se ve o cómo se siente interactuar, no se aprueba*, aunque los CA técnicos pasen.

### 5.4 Revisión editorial de texto (muestreo)
Antes de cualquier carga masiva: el supervisor y el `07-senior-copywriter-gta` revisan **30 fichas** aleatorias por módulo. Reprueba la tanda si: hay prosa copiada o parafraseada de un tercero; aparecen modelos/marcas/personas reales que no figuran en los hechos de entrada; hay cierres genéricos («ideal para entusiastas…»); hay datos de rendimiento sin fuente verificada; o la longitud sale de 60–90 palabras.

### 5.5 Reglas estrictas para todos los agentes (no negociables)
1. Leer `CLAUDE.md`, los tres documentos maestros y **este roadmap** antes de tocar nada. Consultar primero `graphify query "<pregunta>"`; leer archivos solo para lo ya localizado.
2. **Prohibido** leer o imprimir archivos `.env`; prohibido incluir secretos en código, logs, informes o commits.
3. **Prohibido** `rm -rf`, `git reset --hard`, `push --force` y operaciones destructivas sin autorización escrita; borrar solo con rutas explícitas y verificadas.
4. **Prohibido** librerías de UI externas; todo en Tailwind sobre los tokens Vice NUI con SVG inline.
5. **Prohibido** crear archivos o carpetas fuera del árbol aprobado; cualquier excepción se registra en `CLAUDE.md` con permiso del propietario.
6. **Prohibido** inventar campos o colecciones: Mongoose + Zod equivalentes y reflejados en la documentación.
7. RBAC siempre en el servidor, antes de Zod; `/_staff` y `/api/admin/*` devuelven el mismo 404 sin staff; nunca tokens en `localStorage`.
8. **Prohibido** copiar o parafrasear textos de terceros; los textos se redactan solo desde hechos estructurados.
9. Una historia a la vez por agente (WIP ≤ 2); si una tarea cambia de alcance, **parar y consultar al supervisor**.
10. Nada se declara «hecho» sin evidencia ejecutada (salida de comandos, capturas, conteos reales). Si algo no se pudo verificar, se dice.
11. Commits atómicos, un propósito por commit; mensajes en español con Conventional Commits; PR a `develop`.
12. Ante duda de producto o de riesgo legal, **preguntar al propietario**; no decidir en silencio.

### 5.6 Matriz de responsabilidades (RACI resumida)
| Área | R (hace) | A (aprueba) | C (consulta) |
|---|---|---|---|
| Modelos, Zod, API, sharp, variantes | 01 / 06 | 00 | 05 |
| UI Vice NUI, componentes, navegación, estilo editorial | 02 | 00 | 03, propietario |
| Vistas, `/_staff`, bandeja, módulo Imágenes | 03 | 00 | 01, 02 |
| Capacitor, estructura, builds, PWA, Docker, Cloudflare | 04 | 00 | 06 |
| Noticias oficiales, sitemap, JSON-LD, SEO | 05 | 00 | 03 |
| Cierre técnico P0/P1, pipeline FireCrawl | 06 | 00 | 01, 07 |
| Redacción editorial original | 07 | 00 | propietario |
| Decisiones, imágenes propias, proveedor, cuentas, legal | Propietario | Propietario | 00 |

---

## 6. Referencias técnicas para los agentes

### 6.1 Flujo de datos de extremo a extremo
`Fuente web → Pipeline (FireCrawl) → ledger Postgres → redacción propia → export (lotes JSON por fuente) → POST /api/pipeline/ingest → Submission (pendiente) → moderación → Entity / MapMarker → pantalla pública + sitemap/SEO.`

### 6.2 Mapa módulo ↔ ruta ↔ staff ↔ colección (línea base)
| Módulo | Ruta pública | Sección de staff | Colección | Fichas |
|---|---|---|---|---|
| mapa | `/mapa` | Contenido → Mapa interactivo / Catálogo | `Entity` + `MapMarker` | 10 (+10 pines) |
| armas | `/catalogo/armas` | Contenido → Catálogo | `Entity` | 13 |
| vehiculos | `/catalogo/vehiculos` | Contenido → Catálogo | `Entity` | 200 |
| coleccionables | `/catalogo/coleccionables` (pestaña fija) | Contenido → Catálogo | `Entity` | 0 |
| foro | `/foro` | Comunidad → Foro | `ForumThread/Post/Vote` | — (interruptor) |
| guias | `/guias`, `/guias/:slug` | Editorial → Guías | `Entity` | 20 |
| radio | **ninguna** | Contenido → Módulos | `Entity` | 0 |

### 6.3 Prompt editorial (reglas fijas del escritor)
Español neutro; 60–90 palabras; solo hechos del bloque DATOS; sin fuentes, URLs ni rumores; **no mencionar modelos, marcas o personas reales de inspiración salvo que figuren en los hechos**; **prohibidos los cierres genéricos de relleno**; terminar con un dato concreto. Reintentos con *backoff* ante 429/503/504 y parada limpia si se agota la cuota diaria.

### 6.4 Comandos de verificación (DoD)
```
pnpm typecheck && pnpm build
pnpm --dir server typecheck && pnpm --dir server build && pnpm --dir server test
graphify update .
```

---

## 7. Gestión de riesgos

| ID | Riesgo | Prob. | Impacto | Mitigación | Dueño |
|---|---|---|---|---|---|
| R-01 | Reclamación de derechos por imágenes/contenido de terceros; rechazo de AdSense | Alta | Alto | Excepción acotada (§3.1), procedencia visible, retirada ≤ 72 h, sustitución priorizada por tráfico, **v1 sin anuncios hasta tener ≥ 40 imágenes propias** (recomendación) | Propietario |
| R-02 | Cuota/saturación de Gemini retrasa la redacción | Media | Medio | Reintentos con backoff, tandas diarias, cruce previo con editorial, posibilidad de cuota de pago | 06 |
| R-03 | Conflictos masivos con el contenido editorial | Alta | Medio | «Editorial gana» por defecto + comparación en bandeja (S2.3) | 03 |
| R-04 | MongoDB Atlas M0 insuficiente con variantes | Media | Alto | Plan M10 o R2 (ADR D-08) | 04 |
| R-05 | Proveedor/dominio tardan | Media | Alto | Ensayo completo en local con Docker (si disponible) y en un VPS temporal | Propietario |
| R-06 | Regresiones visuales sin pruebas automáticas | Media | Medio | Smoke tests CDP (S8.2) + rúbrica del supervisor | 04 / 00 |
| R-07 | Pérdida de FireCrawl (sin git ni copia) | Media | Alto | S0.3 + respaldo del ledger Postgres | 04 |
| R-08 | Acumulación de alcance («una cosa más») | Alta | Alto | §9 cerrado; todo cambio requiere ADR | 00 |

---

## 8. Puertas de liberación (Go / No-Go)

### 8.1 Puertas (todas deben estar en verde)
| Puerta | Condición |
|---|---|
| G-01 Compilación | Los 5 comandos del DoD en 0; PR integrado en `develop` y `main` por flujo Gitflow. |
| G-02 Coherencia | 0 módulos activos sin ruta pública; 0 pestañas públicas vacías. |
| G-03 Contenido | Recuentos de §4 S5 cumplidos; 0 textos con defectos de §5.4 en la muestra. |
| G-04 Imágenes | ≥ 40 fichas con imagen editada propia; ninguna imagen borrosa o ampliada; variantes responsivas activas. |
| G-05 Móvil | Rúbrica del supervisor ≥ 90 % en las rutas clave a 390 y 360 px; 0 defectos críticos/altos. |
| G-06 PWA y rendimiento | Instalable; LCP ≤ 2,5 s, CLS = 0, INP ≤ 200 ms en las 5 rutas de prueba. |
| G-07 SEO | JSON-LD válido, sitemap correcto, `og:image` único por ficha, `/_staff` ausente de robots y sitemap. |
| G-08 Seguridad y operación | Secretos propios, HTTPS Full strict, backups restaurados con éxito, alertas activas, rollback ensayado. |
| G-09 Accesos | Login con cada proveedor activado, Magic Link y primer SUPER_ADMIN verificados. |
| G-10 Legal | Legales y canal de retirada publicados; **G-LEGAL: decisión D-03 firmada** por el propietario con conocimiento del riesgo R-01. |

### 8.2 Lista de aceptación de usuario (UAT) del supervisor
Visitante invitado: inicio → catálogo → ficha → guía → mapa → foro (lectura) → noticias → cookies → compartir una ficha. Usuario registrado: entrar (4 métodos), progreso, aportar, ver su aporte. Moderador: bandeja, comparar conflicto, aprobar en lote. Super admin: mapa de la PWA, módulos, imágenes (una y en lote), pipeline, auditoría, salud, configuración, monetización. Todo en móvil y escritorio, con evidencia.

---

## 9. Alcance cerrado de la v1 y backlog posterior

**Dentro de la v1:** lo de §4. **Fuera (post-v1, sin excepciones sin ADR):** apps nativas en tiendas (Capacitor), funciones en línea/multijugador, comparador con estadísticas medidas, módulos de personajes/animales/propiedades/bandas (según S2.5), emisoras con pantalla propia (si S1.1 = A), migración de imágenes a R2/CDN propio, AVIF generalizado, internacionalización más allá del español, panel de métricas propio, CI completo con pruebas visuales automáticas.

---

## 10. Cómo se arranca (primeros 10 pasos)

1. El propietario revisa y firma §1 y §3.1 (D-03, D-06/D-07).
2. 00 publica el tablero y ejecuta S0.1–S0.4.
3. Abrir el PR base (S0.3) y subir FireCrawl a su propio repositorio.
4. Sprint 1 completo (S1.1 recomendado en opción A).
5. Sprint 2 con prioridad en S2.2 y S2.3 antes de cargar los 342 vehículos.
6. En paralelo, el propietario contrata servidor y dominio y crea las cuentas (S7.1, S7.4).
7. Sprint 3 (módulo Imágenes) y primera tanda de imágenes propias.
8. Sprints 4 y 5; el propietario sigue subiendo imágenes con el módulo.
9. Sprints 6 y 7 con ensayo completo en un entorno espejo.
10. Sprint 8, UAT y acta Go/No-Go.

> **Registro de lecciones (Retro):** _se completa al cerrar cada sprint._
