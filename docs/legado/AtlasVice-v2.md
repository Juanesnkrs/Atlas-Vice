> **[LEGADO HISTÓRICO - NO USAR]** — Sustituido por `docs/LeonidApp-Arquitectura-Datos-MongoDB.md`, `docs/LeonidApp-Rutas-SEO-Monetizacion.md` y `docs/LeonidApp-UI-NUI-DesignSpec.md`. Se conserva solo como referencia histórica de requisitos (RF/HU).

# ATLAS VICE — Especificación Técnica y Arquitectura del Sistema

**Proyecto:** VICE HUB / VI Companion (Portal Interactivo & Companion App de GTA VI)  
**Versión:** 1.1 (Incluye Módulo de Foro Comunitario)

---

## 1. Ficha Técnica y Arquitectura del Sistema

| Atributo | Especificación Técnica |
| :--- | :--- |
| **Nombre del Proyecto** | VICE HUB / VI Companion (Portal Interactivo & Companion App de GTA VI) |
| **Naturaleza del Sistema** | Aplicación Web Progresiva (PWA) + Wrapper Nativo Multiplataforma (Capacitor / Ionic) para despliegue en Web, iOS y Android desde una única base de código. |
| **Stack Tecnológico Recomendado** | **Frontend:** React + TypeScript + Vite + Tailwind CSS.<br>**Estado y Caché Offline:** Zustand + TanStack Query + IndexedDB (permite consultar mapa, armas y progreso sin conexión).<br>**Backend & Base de Datos (BaaS):** Supabase (PostgreSQL + Auth con Discord/Email + Storage + Row Level Security). |
| **Arquitectura de Información** | Modelo Jerárquico Compuesto (Zona Pública de acceso inmediato + Zona Protegida de sincronización en la nube, progreso personal y aportes comunitarios). |
| **Enfoque de Diseño (UI/UX)** | Mobile-First adaptativo: HUD flotante estilo NUI en escritorio ($100vw \times 100vh$ sin scroll innecesario) y navegación inferior fija (Bottom Tab Bar) con gestos táctiles en iOS y Android. |
| **Estrategia de Escalabilidad** | Arquitectura Modular basada en Entidades (JSON Schema / PostgreSQL): El motor de catálogo y mapa lee esquemas dinámicos. Añadir futuras expansiones del juego (DLCs, Online, propiedades, misiones, radios, trucos) solo requiere insertar registros o activar un módulo sin reescribir la interfaz. |

---

## 2. Requisitos Funcionales y No Funcionales

### Requisitos Funcionales (RF)

* **RF-01 — Acceso Híbrido (Invitado + Cuenta Sincronizada):** El usuario puede explorar el portal libremente sin registrarse (guardando su progreso en `localStorage`), o iniciar sesión con Email / Discord (replicando la pantalla Split-Hero de tu referencia) para sincronizar su avance entre PC, iOS y Android.
* **RF-02 — Mapa Interactivo de Leonida / Vice City:** Mapa de alta resolución con zoom fluido, filtros por capas (coleccionables, tiendas, eventos aleatorios, vehículos ocultos), búsqueda instantánea y marcado de puntos completados.
* **RF-03 — Catálogo e Inspector Dinámico (Armas, Vehículos, Coleccionables):** Vista tipo Inspector NUI con rejilla de selección, barras de estadísticas comparativas, vista previa limpia y filtro por categorías.
* **RF-04 — Tracker de Progreso al 100% y Retención:** Panel de avance global y por categoría, sistema de "Tip del Día" rotativo, listas de verificación (checklists) y rutas sugeridas para incentivar el regreso diario.
* **RF-05 — Sistema de Guías y Aportes Comunitarios:** Módulo para consultar guías paso a paso y enviar nuevos hallazgos o marcadores con estado de moderación (`Pendiente` / `Aprobado`).
* **RF-06 — Motor de Escalabilidad Modular:** Capacidad de habilitar nuevas secciones (ej. GTA VI Online, Calculadora de Negocios, Estaciones de Radio, Logros/Trofeos) mediante configuración de módulos sin afectar el núcleo.
* **RF-07 — Foro Comunitario e Hilos Contextuales [NUEVO]:** Módulo de discusión dividido en categorías globales (Ayuda, Teorías, Trucos, Reclutamiento/Crews) y comentarios vinculados directamente a entidades del catálogo o marcadores del mapa, con sistema de votos (`upvotes`), etiquetas de Spoiler y enlace sincronizado con el servidor oficial de Discord.

### Requisitos No Funcionales (RNF)

* **RNF-01 — Regla de los 3 Clics:** Cualquier entidad (arma, pin del mapa, guía o progreso) debe ser accesible en máximo 2 o 3 interacciones desde el Hub principal.
* **RNF-02 — Rendimiento y Soporte Offline:** Carga inicial inferior a 2 segundos; los datos críticos del catálogo y el estado del usuario funcionan sin internet y se sincronizan al recuperar conexión.
* **RNF-03 — Fidelidad Visual (Vice NUI):** Uso estricto de la paleta nocturna (`#160B14` a `#241021`), superficies glassmorphism (`blur(12px)`), acentos magenta neón (`#E1307E`) y botones con textura de palmeras.
* **RNF-04 — Experiencia Nativa Móvil:** Áreas táctiles mínimas de $44 \times 44\text{px}$, soporte para Safe Areas (notch / Dynamic Island en iOS) y respuesta háptica/visual inmediata en cada toque.

---

## 3. Historias de Usuario (Backlog Priorizado)

| ID | Rol | Historia de Usuario | Criterio de Aceptación |
| :--- | :--- | :--- | :--- |
| **HU-01** | Jugador (Invitado) | Como jugador que entra por primera vez, quiero explorar el mapa, armas y guías sin obligación de crear cuenta, para obtener valor inmediato desde el primer segundo. | Al entrar en P01, puedo navegar a cualquier catálogo o mapa sin bloqueos de login, guardando mis marcas localmente. |
| **HU-02** | Jugador Registrado | Como usuario con cuenta (Email o Discord), quiero iniciar sesión desde la vista Split-Hero y sincronizar mis coleccionables, para continuar mi progreso en mi celular mientras juego en consola/PC. | El inicio de sesión fusiona el progreso local con la nube y muestra el estado en vivo en la barra inferior. |
| **HU-03** | Explorador | Como jugador buscando completar el 100%, quiero filtrar pines en el mapa interactivo y marcar los que ya recogí, para no perder tiempo revisando zonas ya exploradas. | Al tocar un pin, se abre una tarjeta flotante con imagen, descripción y botón "Marcar como completado" que actualiza el porcentaje global. |
| **HU-04** | Estratega | Como jugador comparando equipamiento, quiero inspeccionar armas y vehículos en una rejilla con barras de estadísticas, para elegir la mejor opción según la misión. | Al seleccionar un ítem en la rejilla izquierda, el visor central actualiza su imagen, métricas (daño, cadencia, velocidad) y ubicación. |
| **HU-05** | Colaborador | Como miembro de la comunidad, quiero enviar un reporte de un nuevo secreto o coleccionable con imagen y coordenadas, para ayudar a que el portal crezca conforme avanza el juego. | El formulario valida los datos y envía el aporte a una cola de revisión administrativa (P06). |
| **HU-06** | Administrador | Como administrador del portal, quiero activar nuevos módulos de juego y aprobar aportes de usuarios desde un panel protegido, para mantener el portal actualizado tras cada parche de Rockstar. | Solo usuarios con rol `ADMIN` acceden a P06 para publicar nuevas entidades o aprobar hallazgos. |
| **HU-07 [NUEVO]** | Jugador Registrado | Como jugador con cuenta activa, quiero crear hilos en el foro y comentar dentro de la ficha de un arma o marcador del mapa, para compartir estrategias y resolver dudas sin salir del portal. | El usuario autenticado puede publicar hilos con etiqueta de categoría/spoiler, responder comentarios, dar upvote y reportar mensajes indebidos. |

---

## 4. Mapa de Procesos (Flujo Operativo y de Retención)

```text
                    [INGRESO AL PORTAL (Web / iOS / Android)]
                                        │
                  ┌─────────────────────┴─────────────────────┐
                  ▼                                           ▼
          [Modo Invitado]                     [Autenticación (Email / Discord)]
   Consulta Catálogos / Mapa                    Sincronización Cloud (PostgreSQL)
  Guarda progreso en Caché Local                              │
                  └─────────────────────┬─────────────────────┘
                                        ▼
                         [HUB PRINCIPAL / DASHBOARD]
               (Muestra Tip del Día + % Progreso + Novedades)
        ┌─────────────────┬─────────────┼─────────────┬─────────────────────┐
        ▼                 ▼             ▼             ▼                     ▼
 [Mapa Leonida]    [Catálogos NUI]   [Guías]  [Aportes Comunidad] [Foro & Comunidad (P07)]
  - Filtrar         - Armas           - Historia - Enviar hallazgo   - Hilos por Categoría
  - Ubicar          - Vehículos       - Secundarias - Validación Admin - Comentar en Fichas
  - Check 100%      - Coleccionables  - Trucos/Tips - Publicación      - Votar / Marcar Spoiler
                                                                       - Salto a Discord Oficial
        └─────────────────┴─────────────┴─────────────┴─────────────────────┘
                                        │
                                        ▼
                      [ACTUALIZACIÓN DE PROGRESO Y LOGROS]
                         Incentivo de retorno diario
```

---

## 5. Arquitectura de Navegación (Modelo Jerárquico Compuesto)

Siguiendo exactamente la estructura del documento de referencia (`GA5-220501095-AA1-EV05`), el portal se divide en **Zona Pública / Acceso Rápido** y **Zona Operativa / Protegida**:

### Árbol Jerárquico de Páginas

* **ZONA PÚBLICA (NIVEL 0 - Acceso Inmediato sin Fricción)**
  * **P01 - Landing / Portal Hub:** Vista principal con acceso directo a módulos, tarjeta *Tip of the Day* rotativa, contador de estado y acceso rápido al modo invitado.
  * **P02 - Módulo de Autenticación (Split-Hero View):**
    * **P02.1:** Inicio de Sesión / Registro (Switch píldora + Discord OAuth + Botón textura palmeras).
    * **P02.2:** Recuperación de Credenciales (Envío de enlace de confirmación).

* **ZONA OPERATIVA Y DE EXPLORACIÓN (NIVEL 1 - Disponible en Invitado y Sincronizado con Cuenta)**
  * **P03 - Dashboard de Progreso (Mi Avance):** Resumen visual del 100% del juego, últimos ítems desbloqueados, rutas recomendadas y logros del portal.
  * **P04 - Mapa Interactivo de Leonida (Rama 1):**
    * **P04.1:** Visor de Mapa Full-Screen con HUD flotante y buscador.
    * **P04.2:** Panel de Capas y Filtros (Coleccionables, Actividades, Tiendas, Zonas).
    * **P04.3:** Ficha de Detalle de Marcador (Guía rápida + Check de completado).
  * **P05 - Enciclopedia e Inspector NUI (Rama 2):**
    * **P05.1:** Catálogo de Armas (Rejilla + Visor central + Sliders de estadísticas).
    * **P05.2:** Catálogo de Vehículos (Clases, rendimiento, ubicación y precio).
    * **P05.3:** Coleccionables y Secretos (Listas agrupadas por región con barra de avance).
    * **P05.4:** Módulo de Guías y Misiones (Artículos estructurados con filtros de spoilers).
  * **P07 - Módulo de Foro y Comunidad (Rama 4 - Lectura pública / Escritura autenticada) [NUEVO]:**
    * **P07.1:** Tablón General de Hilos (Filtros por categoría: General, Guías/Ayuda, Secretos, Crews, búsqueda y orden por tendencia/recientes).
    * **P07.2:** Vista de Hilo y Discusión (Post principal, respuestas anidadas, sistema de upvotes y acceso rápido al canal de Discord).
    * **P07.3:** Drawer de Comentarios Contextuales (Panel integrado dentro de cada pin del mapa `P04.3` y ficha de catálogo `P05` para debatir sobre ese ítem específico).

* **ZONA COMUNITARIA Y ADMINISTRATIVA (NIVEL 2 - Roles Autenticados)**
  * **P06 - Centro de Comunidad y Administración (Rama 3):**
    * **P06.1:** Formulario de Aportes (Envío de ubicaciones, trucos o correcciones).
    * **P06.2:** Panel de Moderación y Gestión de Módulos (Solo `ADMIN`: Aprobación de aportes y activación de futuras expansiones).

---

## 6. Diagramas de Casos de Uso y Modelo de Datos Escalable

### Casos de Uso Principales

```text
+--------------------+         +---------------------------------------------------+
|                    |         |              VICE HUB / VI COMPANION              |
|      Jugador       |-------->|  (CU-01) Explorar Mapa y Catálogos                |
|    (Invitado)      |-------->|  (CU-02) Filtrar e Inspeccionar Entidades         |
|                    |-------->|  (CU-03) Marcar Progreso Local                    |
+--------------------+-------->|  (CU-09) Consultar Hilos y Comentarios del Foro   |
          ▲                    |                                                   |
          │ (extiende)         |                                                   |
+--------------------+         |                                                   |
|                    |-------->|  (CU-04) Autenticarse (Email / Discord)           |
|      Jugador       |-------->|  (CU-05) Sincronizar Progreso Multi-Disp.         |
|     Registrado     |-------->|  (CU-06) Enviar Aporte Comunitario                |
|                    |-------->|  (CU-10) Publicar Hilo, Responder y Votar         |
+--------------------+         |                                                   |
          ▲                    |                                                   |
          │ (extiende)         |                                                   |
+--------------------+         |                                                   |
|                    |-------->|  (CU-07) Moderar Aportes                          |
|   Administrador    |-------->|  (CU-08) Gestionar Módulos / Expansiones          |
|                    |-------->|  (CU-11) Moderar Hilos y Gestionar Reportes       |
+--------------------+         +---------------------------------------------------+
```

### Modelo Entidad-Relación (Preparado para Crecer con el Juego)

Para que el portal no sea rígido y soporte cualquier actualización futura del juego sin cambiar la base de datos:

* **`MODULES`** (`id`, `slug`, `nombre`, `icono`, `activo`, `orden`): Controla dinámicamente qué secciones aparecen en el menú (hoy: Mapa, Armas, Vehículos, Coleccionables, Guías, Foro; mañana: Online, Negocios, Radios).
* **`ENTITIES`** (`id`, `module_id`, `titulo`, `subtitulo`, `categoria`, `imagen_url`, `stats_json`, `metadata_json`): Tabla polimórfica donde `stats_json` guarda atributos flexibles (daño/cadencia para armas; velocidad/tracción para autos; recompensa para coleccionables).
* **`MAP_MARKERS`** (`id`, `entity_id`, `region`, `coord_x`, `coord_y`, `descripcion`, `media_url`): Coordenadas exactas vinculadas opcionalmente a cualquier entidad del catálogo.
* **`USER_PROGRESS`** (`user_id`, `entity_id`, `marker_id`, `completado`, `updated_at`): Registra el avance sincronizado entre Web, iOS y Android.
* **`SUBMISSIONS`** (`id`, `user_id`, `tipo`, `payload_json`, `estado`): Cola de aportes comunitarios (`PENDIENTE`, `APROBADO`, `RECHAZADO`).
* **`FORUM_THREADS`** (`id`, `user_id`, `entity_id`, `marker_id`, `categoria`, `titulo`, `contenido`, `is_spoiler`, `is_pinned`, `upvotes_count`, `created_at`) **[NUEVO]**: Soporta tanto hilos generales del foro (`entity_id = null`) como hilos vinculados automáticamente a un arma, vehículo o pin del mapa.
* **`FORUM_POSTS`** (`id`, `thread_id`, `user_id`, `parent_post_id`, `contenido`, `upvotes_count`, `created_at`) **[NUEVO]**: Respuestas y sub-respuestas anidadas dentro de cada hilo.
* **`FORUM_VOTES`** (`user_id`, `target_type`, `target_id`) **[NUEVO]**: Controla que cada usuario pueda votar una sola vez por hilo o respuesta y alimenta el ranking de mejores aportes.

---

## 7. Adaptabilidad Web vs. Móvil (iOS y Android)

Para garantizar una experiencia intuitiva que retenga al usuario en cualquier pantalla:

* **Escritorio (HUD Estilo NUI):** Distribución espacial sin scroll vertical en vistas de catálogo y mapa; rejillas a la izquierda, visor central limpio y controles flotantes en las esquinas (idéntico a los videos de referencia). En el módulo de Foro, vista dividida con lista de hilos a la izquierda y lectura/respuestas a la derecha sin perder la atmósfera nocturna del portal.
* **Móvil iOS y Android (App Nativa vía Capacitor):**
  * **Navegación inferior fija (Bottom Dock):** 5 accesos directos con iconos neón (Hub, Mapa, Catálogo, Foro, Progreso) siempre al alcance del pulgar.
  * **Paneles deslizables (Bottom Sheets):** Al tocar un marcador en el mapa o un arma en la rejilla móvil, la ficha técnica sube suavemente desde abajo sin tapar toda la pantalla.
  * **Modo Companion (Segunda Pantalla):** Diseñado para que el jugador tenga el celular al lado mientras juega en consola/PC, marcando coleccionables con un solo toque y creando hilos rápidos con botón flotante (`+`) y etiquetado automático de spoilers.