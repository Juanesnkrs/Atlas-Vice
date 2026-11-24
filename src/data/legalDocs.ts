// Contenido de las páginas legales de LeonidApp (S6.3). Texto original en español neutro.
// Rutas: /legal/privacidad, /legal/cookies, /legal/terminos, /legal/marcas, /legal/retirada.
// BORRADORES pendientes de revisión por un profesional del derecho antes de la publicación definitiva.

export const LEGAL_UPDATED = '2026-11-24';

export type LegalId = 'privacidad' | 'cookies' | 'terminos' | 'marcas' | 'retirada';

export interface LegalSection {
  id: string;
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalDoc {
  id: LegalId;
  path: string;
  /** Etiqueta corta para la navegación entre legales y el footer. */
  label: string;
  title: string;
  description: string;
  lead: string;
  sections: LegalSection[];
}

export const LEGAL_DOCS: readonly LegalDoc[] = [
  {
    id: 'privacidad',
    path: '/legal/privacidad',
    label: 'Privacidad',
    title: 'Política de privacidad',
    description:
      'Qué datos trata LeonidApp, para qué los usa, dónde se almacenan y cómo puedes ejercer tus derechos de acceso, rectificación y supresión.',
    lead: 'Explicamos en lenguaje claro qué información recoge LeonidApp, por qué la necesita y qué puedes hacer con ella.',
    sections: [
      {
        id: 'quienes-somos',
        heading: 'Quiénes somos',
        paragraphs: [
          'LeonidApp es un proyecto independiente de aficionados: un atlas con mapa, catálogo, guías, noticias oficiales y foro sobre Leonida. El canal para cualquier asunto de privacidad es el formulario de Contacto del pie de página.',
        ],
      },
      {
        id: 'datos',
        heading: 'Datos que tratamos',
        items: [
          'Cuenta: si inicias sesión con Google, Discord, Apple o enlace por correo, guardamos un identificador de cuenta, tu nombre de usuario y el correo que facilita el proveedor de acceso.',
          'Sesión: usamos cookies HttpOnly para mantener tu sesión. El código de la web no puede leerlas.',
          'Progreso: lo que marcas como completado en el mapa, el catálogo y las guías. Como invitado se guarda solo en tu dispositivo; con cuenta se sincroniza con nuestro servidor.',
          'Aportes: las propuestas que envías (textos, ubicaciones, enlaces o imágenes) y su estado de revisión.',
          'Foro: tus hilos y respuestas, que son públicos para quien visite el foro.',
          'Formulario de Contacto: tu correo y el mensaje que escribes.',
          'Suscripción: tu correo y el idioma elegido para recibir novedades.',
          'Almacenamiento local: IndexedDB, la caché del service worker y cookies de preferencias (idioma y decisión de cookies) en tu dispositivo, para que la app funcione sin conexión y recuerde tus ajustes. Más abajo explicamos qué guardan y cómo borrarlos.',
          'Datos técnicos de conexión (como la dirección IP) que tratan nuestros proveedores para entregar el sitio, limitar abusos y mantener la seguridad.',
        ],
      },
      {
        id: 'finalidad',
        heading: 'Para qué los usamos',
        paragraphs: [
          'Para prestar las funciones de la app, sincronizar tu avance, moderar la comunidad, responder a tus mensajes, enviarte las novedades que hayas pedido y proteger el servicio frente a abusos.',
          'No vendemos tus datos. En esta versión no mostramos anuncios ni usamos tus datos para publicidad personalizada.',
        ],
      },
      {
        id: 'donde',
        heading: 'Dónde se almacenan y quién interviene',
        items: [
          'MongoDB Atlas: base de datos donde se guardan cuentas, progreso, aportes, foro, mensajes de contacto y suscripciones.',
          'Cloudflare: red de entrega y protección del tráfico. Procesa datos técnicos de conexión.',
          'Proveedores de acceso (Google, Discord, Apple): si los usas, su tratamiento se rige por sus propias políticas.',
        ],
        paragraphs: [
          'Algunos de estos proveedores pueden tratar datos fuera de tu país. Al usarlos nos apoyamos en las garantías que cada proveedor ofrece.',
        ],
      },
      {
        id: 'sin-terceros',
        heading: 'Sin peticiones a terceros al cargar el sitio',
        paragraphs: [
          'Las tipografías (Poppins y Jost, con licencia SIL Open Font License) se sirven desde nuestro propio dominio, igual que el resto de la app. Al cargar el sitio tu navegador no hace peticiones a servicios de fuentes ni a otros terceros: las únicas conexiones son con LeonidApp y con la infraestructura que la entrega (Cloudflare) y le da datos (MongoDB Atlas), descritas arriba.',
          'Las peticiones a terceros solo ocurren si tú las inicias (por ejemplo, al abrir un enlace externo o al iniciar sesión con un proveedor de acceso).',
        ],
      },
      {
        id: 'almacenamiento-local',
        heading: 'Service worker y cachés locales',
        paragraphs: [
          'Para que LeonidApp se pueda instalar y abrir sin conexión, el navegador registra un service worker que guarda en tu dispositivo, en cachés propias del origen, la portada de la app, sus archivos estáticos (código, estilos, tipografías e iconos), las teselas del mapa y las imágenes propias ya vistas. Las respuestas de la API no se guardan en esa caché. Esos datos no se envían a nadie: se quedan en tu dispositivo.',
          'Puedes borrarlos cuando quieras desde los ajustes de tu navegador: en la configuración del sitio, elige «Borrar datos» o «Borrar datos de navegación» e incluye «Archivos e imágenes en caché» y «Datos de sitios». También puedes anular el registro del service worker desde las herramientas del navegador o desinstalar la app. La próxima vez que abras LeonidApp con conexión se volverá a crear lo necesario.',
        ],
      },
      {
        id: 'conservacion',
        heading: 'Cuánto tiempo los conservamos',
        paragraphs: [
          'Conservamos los datos de tu cuenta mientras la mantengas activa. Los mensajes de contacto se guardan el tiempo necesario para atenderlos y dejar constancia de la gestión. Puedes pedir la supresión de tus datos en cualquier momento.',
        ],
      },
      {
        id: 'derechos',
        heading: 'Tus derechos y cómo ejercerlos',
        paragraphs: [
          'Puedes solicitar acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad de tus datos, y retirar tu consentimiento cuando el tratamiento se base en él.',
          'Para ejercerlos usa el formulario de Contacto del pie de página, elige el asunto «Privacidad y datos» e indica desde qué cuenta o correo escribes, para poder verificar tu identidad. Si consideras que no hemos atendido tu solicitud, puedes acudir a la autoridad de protección de datos de tu país.',
        ],
      },
      {
        id: 'no-vender',
        heading: 'No vender ni compartir mi información',
        paragraphs: [
          'LeonidApp no vende ni comparte tu información personal con terceros para publicidad basada en tu comportamiento. Mantén desactivada la categoría «Marketing» en los ajustes de cookies si quieres asegurarte de que así siga.',
        ],
      },
      {
        id: 'menores',
        heading: 'Menores y cambios',
        paragraphs: [
          'LeonidApp no está dirigida a menores de 14 años. Si crees que un menor nos ha facilitado datos, escríbenos para eliminarlos.',
          'Si cambiamos esta política de forma relevante, actualizaremos la fecha de esta página y, cuando proceda, te avisaremos en la propia app.',
        ],
      },
    ],
  },
  {
    id: 'cookies',
    path: '/legal/cookies',
    label: 'Cookies',
    title: 'Política de cookies',
    description:
      'Qué cookies y almacenamiento local usa LeonidApp, la diferencia entre necesarias y de marketing, y cómo cambiar tu decisión en cualquier momento.',
    lead: 'Usamos solo lo imprescindible para que la app funcione. El resto es opcional y lo decides tú.',
    sections: [
      {
        id: 'que-son',
        heading: 'Qué usamos',
        paragraphs: [
          'Las cookies son pequeños archivos que el navegador guarda en tu dispositivo. También usamos almacenamiento local (IndexedDB y la caché del service worker) para que el atlas funcione sin conexión. Al cargar el sitio no se hacen peticiones a terceros: las tipografías se sirven desde nuestro propio dominio.',
        ],
      },
      {
        id: 'necesarias',
        heading: 'Necesarias (siempre activas)',
        items: [
          'Cookies de sesión HttpOnly y de seguridad: mantienen tu sesión iniciada y protegen el acceso. Sin ellas no podrías iniciar sesión.',
          'leonidapp_consent: guarda tu decisión sobre las categorías de cookies (qué aceptas, la versión y la fecha). Dura un año.',
          'IndexedDB: copia local del catálogo y de tu avance como invitado para el uso sin conexión.',
          'Service worker y cachés del navegador: guardan en tu dispositivo los archivos estáticos de la app (incluidas las tipografías, que se sirven desde nuestro propio dominio), las teselas del mapa y las imágenes propias ya vistas. No son cookies ni se envían a ningún servidor; puedes borrarlas desde los ajustes del navegador («Borrar datos de navegación», con «Archivos e imágenes en caché» y «Datos de sitios»).',
        ],
      },
      {
        id: 'preferencias',
        heading: 'Preferencias',
        items: ['leonidapp_lang: recuerda el idioma elegido en el pie de página. Dura un año.'],
      },
      {
        id: 'analitica',
        heading: 'Analítica',
        paragraphs: ['Esta versión de LeonidApp no usa cookies de analítica. La categoría existe en los ajustes y permanece desactivada por defecto.'],
      },
      {
        id: 'marketing',
        heading: 'Marketing',
        paragraphs: [
          'Esta versión de LeonidApp no muestra anuncios y, por tanto, no carga scripts ni cookies publicitarias de terceros, aceptes o no esta categoría. Si en el futuro activáramos publicidad, solo se cargaría con tu consentimiento expreso en «Marketing» y actualizaríamos esta política.',
        ],
      },
      {
        id: 'cambiar',
        heading: 'Cómo cambiar tu decisión',
        paragraphs: [
          'Puedes revisar tu elección en cualquier momento con el panel de abajo o desde el enlace «Ajustes de cookies» del pie de página. También puedes borrar las cookies desde la configuración de tu navegador; si lo haces, se perderá tu decisión y la sesión.',
        ],
      },
    ],
  },
  {
    id: 'terminos',
    path: '/legal/terminos',
    label: 'Términos de uso',
    title: 'Términos de uso',
    description:
      'Condiciones de uso de LeonidApp: cuenta, contenido de la comunidad y aportes, conducta, moderación, ausencia de garantías y limitación de responsabilidad.',
    lead: 'Reglas sencillas para que LeonidApp siga siendo un espacio útil y respetuoso para toda la comunidad.',
    sections: [
      {
        id: 'aceptacion',
        heading: 'Aceptación',
        paragraphs: [
          'Al usar LeonidApp aceptas estos términos. Si no estás de acuerdo, no uses el servicio. Debes tener al menos 14 años o la edad que exija tu país para usar servicios en línea.',
        ],
      },
      {
        id: 'cuenta',
        heading: 'Tu cuenta',
        items: [
          'Eres responsable de la actividad que ocurra en tu cuenta y de proteger tu acceso.',
          'La información de tu perfil debe ser veraz y no suplantar a nadie.',
          'Puedes dejar de usar el servicio y pedir la eliminación de tu cuenta cuando quieras desde el formulario de Contacto.',
        ],
      },
      {
        id: 'contenido',
        heading: 'Contenido de usuarios y aportes',
        paragraphs: [
          'Conservas los derechos sobre lo que publicas o envías (mensajes del foro, aportes, ubicaciones, textos e imágenes). Al hacerlo nos concedes una licencia gratuita, no exclusiva y mundial para alojarlo, mostrarlo, adaptarlo al formato de la app y usarlo dentro de LeonidApp mientras el contenido permanezca publicado.',
          'Declaras que tienes derecho a compartir ese contenido y que no infringe derechos de terceros. No publiques material ajeno que no tengas permiso para compartir.',
        ],
      },
      {
        id: 'conducta',
        heading: 'Conducta',
        items: [
          'Sin acoso, discriminación, amenazas ni contenido ilegal.',
          'Sin spam, publicidad no autorizada ni intentos de manipular el servicio.',
          'Sin spoilers marcados como oficiales ni información presentada como confirmada si no lo está.',
          'Sin acceso automatizado abusivo, ni intentos de vulnerar la seguridad o los permisos de otras cuentas.',
        ],
      },
      {
        id: 'moderacion',
        heading: 'Moderación',
        paragraphs: [
          'Podemos revisar, editar, ocultar o retirar contenido, y suspender cuentas, cuando incumplan estos términos o lo exija la ley. Las propuestas de la comunidad pueden pasar por revisión antes de publicarse.',
        ],
      },
      {
        id: 'garantias',
        heading: 'Sin garantías',
        paragraphs: [
          'LeonidApp se ofrece «tal cual» y «según disponibilidad». Es una obra de aficionados: puede contener errores, datos incompletos o desactualizados, y el servicio puede interrumpirse o cambiar sin aviso.',
        ],
      },
      {
        id: 'limitacion',
        heading: 'Limitación de responsabilidad',
        paragraphs: [
          'En la medida permitida por la ley, no respondemos de daños indirectos ni de pérdidas derivadas del uso o la imposibilidad de uso de la app, ni del contenido publicado por terceros. Esto no limita los derechos que la ley te reconozca como consumidor.',
        ],
      },
      {
        id: 'cambios',
        heading: 'Cambios y contacto',
        paragraphs: [
          'Podemos actualizar estos términos; la fecha de esta página indica la última versión. Para cualquier consulta usa el formulario de Contacto del pie de página.',
        ],
      },
    ],
  },
  {
    id: 'marcas',
    path: '/legal/marcas',
    label: 'Marcas y propiedad intelectual',
    title: 'Aviso de marca y propiedad intelectual',
    description:
      'LeonidApp es un proyecto de aficionados no afiliado a Rockstar Games ni Take-Two Interactive. Información sobre marcas, imágenes de terceros y su procedencia.',
    lead: 'LeonidApp es un proyecto de aficionados. No tiene relación con las empresas titulares de la saga.',
    sections: [
      {
        id: 'no-afiliacion',
        heading: 'Sin afiliación',
        paragraphs: [
          'LeonidApp es un proyecto independiente de aficionados. No está afiliado, respaldado, patrocinado ni aprobado por Rockstar Games, Inc. ni por Take-Two Interactive Software, Inc.',
        ],
      },
      {
        id: 'marcas',
        heading: 'Marcas registradas',
        paragraphs: [
          '«Grand Theft Auto», «GTA», «Vice City», «Leonida» y las marcas, logotipos, nombres y demás elementos relacionados pertenecen a sus respectivos titulares. Se mencionan únicamente con fines informativos e identificativos.',
        ],
      },
      {
        id: 'contenido-propio',
        heading: 'Contenido propio',
        paragraphs: [
          'Los textos editoriales de LeonidApp son originales y se redactan a partir de hechos objetivos. El diseño, la marca LeonidApp y el código de la aplicación son obra del proyecto.',
        ],
      },
      {
        id: 'imagenes',
        heading: 'Imágenes de terceros y su procedencia',
        paragraphs: [
          'Algunas imágenes mostradas en esta versión son de terceros y se usan de forma transitoria, mientras reunimos imágenes propias. Cuando una imagen es de terceros, su procedencia se indica de forma visible junto a ella. Estamos sustituyéndolas progresivamente por imágenes propias.',
          'La base cartográfica del mapa procede de un mapa comunitario de Leonida, adaptado como obra derivada para su visualización interactiva.',
          'Las noticias oficiales se muestran con un resumen y un enlace a la fuente original de Rockstar Games o Take-Two.',
        ],
      },
      {
        id: 'titulares',
        heading: 'Si eres titular de derechos',
        paragraphs: [
          'Si crees que algún contenido de LeonidApp infringe tus derechos, puedes pedir su retirada siguiendo el procedimiento de la página de retirada de contenido.',
        ],
      },
    ],
  },
  {
    id: 'retirada',
    path: '/legal/retirada',
    label: 'Retirada de contenido',
    title: 'Retirada de contenido y derechos de autor',
    description:
      'Canal para titulares de derechos: cómo notificar a LeonidApp una infracción, qué datos incluir, plazo de respuesta y retirada en 72 horas y contra-notificación.',
    lead: 'Respetamos los derechos de autor. Si eres titular y algo de LeonidApp te afecta, aquí tienes cómo avisarnos y qué haremos.',
    sections: [
      {
        id: 'como-notificar',
        heading: 'Cómo notificar',
        paragraphs: [
          'El canal es el formulario de Contacto del pie de página. Selecciona el asunto «Retirada de contenido» (también puedes usar el botón de esta página, que lo deja preseleccionado) y describe tu solicitud. Tu mensaje se guarda de forma segura y llega al equipo de moderación.',
        ],
      },
      {
        id: 'datos',
        heading: 'Qué datos incluir',
        items: [
          'La URL exacta de la ficha, imagen o publicación afectada en LeonidApp.',
          'La identificación de la obra protegida que consideras infringida (título, autor y, si es posible, dónde se publicó originalmente).',
          'La acreditación de tu titularidad o de que actúas en nombre del titular, indicando tu nombre o razón social.',
          'Una declaración de buena fe de que el uso denunciado no está autorizado por el titular, su representante ni la ley.',
          'Una declaración de que la información de tu aviso es exacta.',
          'Un correo de contacto en el campo de correo del formulario, para poder responderte.',
        ],
      },
      {
        id: 'plazos',
        heading: 'Nuestro compromiso',
        paragraphs: [
          'Acusaremos recibo de tu aviso y, si está completo y es verosímil, retiraremos o desactivaremos el contenido señalado en un máximo de 72 horas desde su recepción. Si falta información, te la pediremos antes de actuar.',
          'Las notificaciones manifiestamente abusivas o infundadas pueden desestimarse, y hacer una declaración falsa puede acarrear responsabilidad.',
        ],
      },
      {
        id: 'contra-notificacion',
        heading: 'Contra-notificación',
        paragraphs: [
          'Si publicaste el contenido retirado y crees que se retiró por error o que tienes derecho a usarlo, puedes enviarnos una contra-notificación por el mismo formulario, con el asunto «Retirada de contenido» y la referencia «Contra-notificación». Debe incluir la URL del contenido retirado, los motivos por los que consideras legítimo su uso y una declaración de buena fe.',
          'Trasladaremos tu contra-notificación a quien presentó el aviso. Si no recibimos una respuesta o una acción legal del reclamante en un plazo razonable, podremos restaurar el contenido.',
        ],
      },
      {
        id: 'reincidencia',
        heading: 'Cuentas reincidentes',
        paragraphs: ['Podemos suspender las cuentas que publiquen de forma reiterada contenido infractor.'],
      },
    ],
  },
];

export function getLegalDoc(id: LegalId): LegalDoc {
  return LEGAL_DOCS.find((d) => d.id === id) ?? LEGAL_DOCS[0]!;
}
