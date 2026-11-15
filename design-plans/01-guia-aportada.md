# OpenMediaCP: propuesta de rediseño y especificación para implementación

Fecha: 2 de noviembre de 2026. Alcance: sitio público, acceso, operación del canal y administración.

Esta propuesta se basa en las once capturas y en el PDF adjuntos. Es una revisión visual y funcional de lo que muestran; no se ha accedido al código de OpenMediaCP ni se ha probado su backend. Las imágenes de la propuesta son referencias de diseño, no capturas de una implementación. Cualquier estado, medición o metraje de ejemplo debe identificarse como demostrativo hasta conectarlo con datos reales.

## 1. Dirección del diseño

OpenMediaCP debe sentirse como una herramienta de trabajo para operadores de televisión por internet, medios locales y proveedores de streaming. El objetivo principal es responder con rapidez: qué sale al aire, de dónde viene, si hay respaldo y cuál es la siguiente acción.

Conservar el nombre y la identidad azul. Tomar de CoolAdmin la estructura administrativa, la navegación lateral, la jerarquía de tablas, los estados y la adaptación móvil. Crear una identidad propia de emisión, sin copiar módulos de ventas ni migrar el stack por razones visuales.

Usar superficies opacas, contraste alto, bordes definidos y radios cortos. Evitar glassmorphism, blur, degradados decorativos, luces de neón, ilustraciones abstractas, tarjetas gigantes con poco contenido y títulos publicitarios dentro de cada pantalla operativa.

### Colores

| Uso | Color | Aplicación |
| --- | --- | --- |
| Navegación | `#17243B` | Barra lateral y cabeceras de monitor |
| Acción principal | `#2459C4` | Botones, enlaces y selección |
| Hover principal | `#1D469C` | Interacción de botones azules |
| Fondo de trabajo | `#F2F4F7` | Área principal |
| Superficie | `#FFFFFF` | Tablas, formularios y paneles |
| Texto principal | `#202C3D` | Títulos, valores y etiquetas |
| Texto secundario | `#526176` | Descripciones y metadatos |
| Bordes | `#D5DCE5` | Separadores e inputs |
| Operación correcta | `#147547` | Confirmación de señal recibida o salida verificada |
| Advertencia | `#946200` | Respaldo incompleto, configuración pendiente |
| Error / directo | `#B93438` | Error en contexto; distintivo de directo en contexto |

El distintivo rojo «DIRECTO» indica el tipo de fuente, no un fallo. Un fallo usa icono y texto explícito. No comunicar estados únicamente con color. Validar contraste en cada combinación y tamaño antes de implementar.

### Tipografía y medidas

- Source Sans 3 para la interfaz; IBM Plex Mono para direcciones, claves y datos técnicos. Servir fuentes localmente y proporcionar fallback de sistema.
- Texto general 15-16 px; metadatos 13-14 px; título de pantalla 26-30 px, peso 600; titulares del sitio público 44-56 px en escritorio.
- Barra lateral de 232-248 px; cabecera de 64 px; márgenes de contenido de 24-32 px. Reducir a 16 px en móvil.
- Escala de espaciado: 4, 8, 12, 16, 24 y 32 px. Paneles con radio de 6 px; campos de 4 px. Sombra mínima cuando ayude a separar capas.
- Controles principales de 40-44 px de alto; áreas táctiles de al menos 44 px. Filas de tablas de unos 52 px en escritorio, con densidad adaptable.
- Iconos de una sola familia, con etiquetas en acciones relevantes. No usar emojis como iconos de producto.

## 2. Problemas observados y correcciones

| Hallazgo en los adjuntos | Efecto | Corrección propuesta |
| --- | --- | --- |
| Grandes márgenes, paneles muy altos y encabezados repetidos | Mucho desplazamiento para tareas breves | Un encabezado por pantalla y barras de acciones compactas |
| Texto secundario y bordes muy claros | Cuesta distinguir ayudas, controles y datos | Oscurecer metadatos; revisar foco y contraste |
| «Señal disponible» sin identificar la fuente | No permite saber qué está saliendo | Mostrar fuente de salida, recepción del encoder y hora de comprobación por separado |
| Botón «Emitir en vivo» repetido en configuración y contenido | Sugiere que pulsarlo inicia la emisión | Usar «Conectar OBS» para abrir instrucciones; reservar acciones de emisión para funciones reales |
| Direcciones `127.0.0.1` en conexión y reproducción | En un despliegue remoto apuntarían al equipo del visitante | Derivar endpoints del entorno; indicar explícitamente cuando sea entorno local |
| No se ve el campo de clave de emisión en la captura | El flujo de conexión queda incompleto visualmente | Revisar el flujo existente e incluir creación inicial o renovación según política de secretos |
| Biblioteca con enorme espacio entre acciones, búsqueda y tabla | Gestión fragmentada | Unir ruta, búsqueda, filtros, nueva carpeta y subida en una barra de herramientas |
| Duración de videos mostrada con guion | Dificulta programar una lista | Mostrar «Analizando», «No disponible» o duración cuando el backend la informe |
| Cola de subida vacía ocupa un bloque permanente | Agrega ruido antes de usarla | Abrir bandeja de transferencias al añadir archivos; mantener resumen compacto |
| Nombres repetidos y rutas mezcladas en la playlist | Puede confundirse qué archivo se eligió | Identificar archivos por ID y ruta; avisar de coincidencias sin borrar ni fusionar automáticamente |
| Selección y ordenamiento de lista aparecen juntos sin jerarquía | Cuesta distinguir biblioteca disponible y lista programada | Biblioteca a la izquierda, playlist a la derecha, con cantidad y duración |
| Posición, tamaño, formato y fps reunidos en marca de agua | Mezcla identidad visual y perfil de salida | Mover fps a perfil de emisión; separar logo pequeño y composición completa |
| Vista de PNG transparente sin composición sobre el video | No permite evaluar legibilidad final | Previsualizar sobre una imagen de muestra o fotograma real, con zona segura |
| «Administrador» y «Superadministrador» en distintas áreas | El alcance de permisos queda poco claro | Reflejar el rol real y el contexto activo de forma consistente |
| Footer enlaza a configuración de cuenta en todas las pantallas | Compite con acciones útiles | Footer mínimo; cuenta dentro del menú de usuario |

Los puntos sobre endpoints, estados, duración, secretos y permisos requieren verificar código y configuración. La captura por sí sola no demuestra un fallo de backend.

## 3. Arquitectura de navegación

### Sitio público

Navegación: Plataforma · Cómo funciona · Acceder. Añadir «Solicitar acceso» solo si existe un canal o formulario real para atender solicitudes. No inventar precios, clientes, testimonios ni garantías de disponibilidad.

### Espacio del canal

Selector de canal persistente en la parte superior de la barra lateral. Grupo OPERACIÓN: Panel de emisión · Conectar OBS · Continuidad. Grupo CONTENIDO: Biblioteca · Playlist de respaldo · Marca de agua. En el pie: Ayuda y Cuenta. Acceso a Administración solo para roles autorizados.

### Administración

Identificación explícita «Administración». Navegación: Resumen · Canales de video · Clientes. Mostrar el cambio a «Operar un canal» con selector de destino, evitando entrar silenciosamente al canal equivocado. Mantener contexto y permisos en rutas y backend.

## 4. Diseño por pantalla

### 4.1 Inicio público

Hero con la marca, propuesta concreta y una vista realista del producto. Titular: «Tu canal en vivo. Tu programación bajo control.» Bajada: «Conecta tu codificador, organiza tus videos y prepara el respaldo de tu señal desde una sola plataforma.» Acción principal: «Acceder al panel». Secundaria: «Ver cómo funciona».

Sustituir la ilustración genérica de barras azules por un encuadre del panel y un monitor con contenido audiovisual pertinente. Una imagen real del canal requiere permiso o material proporcionado; los mockups pueden usar una escena demostrativa identificada. No convertir barras de prueba decorativas en una supuesta emisión real.

Continuar con tres secciones diferenciadas: operación en vivo con detalle del monitor; biblioteca y playlist con una captura útil; continuidad explicada con prioridades y comportamiento ante una pérdida de entrada. Alternar fondos blancos y grises con una franja azul oscura para el cierre. Evitar una página compuesta exclusivamente por tarjetas iguales.

Incluir preguntas concretas: «¿Puedo emitir desde OBS?», «¿Qué ocurre cuando se desconecta el directo?» y «¿Cómo organizo el contenido de respaldo?». Responder según capacidades comprobadas. Cerrar con acceso al panel y footer institucional breve.

### 4.2 Acceso

Cabecera con marca y regreso al sitio. Formulario de 400-440 px con «Accede a tu centro de emisión», usuario, contraseña, mostrar u ocultar y botón «Iniciar sesión». Etiquetas visibles, atributos de autocompletado y navegación por teclado. Error general breve sin revelar si un usuario existe; conservar el nombre de usuario y limpiar solo lo necesario.

Columna visual con una fotografía o vista del producto relacionada con emisión, sin repetir la misma ilustración del inicio. En móvil mostrar primero el formulario. Incluir recuperación de acceso solo si existe ese mecanismo; de lo contrario, una ayuda con destino real. No inventar SSO ni registro abierto.

### 4.3 Panel de emisión

Encabezado: nombre del canal, identificación del contexto y botón «Conectar OBS». Una línea compacta de estado separa «Salida: respaldo», «Entrada en vivo: sin conexión» y hora de comprobación. Un estado desconocido se muestra como «Sin datos», nunca como correcto.

Contenido principal: monitor 16:9 a la izquierda; a la derecha, fuente activa, contenido actual y acceso a continuidad. No abrir reproducción con sonido automáticamente. «Abrir monitor» carga el player; la telemetría del servidor y el resultado del player permanecen diferenciados.

Franja de datos útiles: videos disponibles, playlist preparada y almacenamiento. Usar cifras existentes; resolución, bitrate, espectadores o salud requieren instrumentación real. No añadir gráficos ficticios de audiencia.

Debajo: URL pública con copiar y abrir, actividad reciente acotada y acceso al historial. La lista completa de eventos no debe desplazar el monitor fuera de la primera pantalla.

### 4.4 Conectar OBS / encoder

Dos zonas: configuración a la izquierda y comprobación de entrada a la derecha. Pasos: 1. Selecciona servicio personalizado en OBS. 2. Copia servidor y clave. 3. Inicia la transmisión en OBS y comprueba la recepción.

Cada dato tiene etiqueta, contenido monoespaciado y botón copiar. Copiar servidor nunca copia la clave por accidente. Distinguir dirección de publicación privada y enlace público de reproducción. Si la clave se muestra solo una vez, ofrecer el resultado al crearla y luego el estado «Clave configurada», con renovación; no simular que se puede recuperar el secreto guardado.

Al renovar, explicar el efecto real de la API, comprobar las condiciones necesarias y pedir confirmación porque invalida una credencial existente. El perfil recomendado usa los límites del canal o de configuración; no inventar RTMPS ni anunciar perfiles que el servidor no soporte. La ayuda de red avanzada debe ser desplegable y pertinente al rol.

### 4.5 Continuidad

Mostrar primero el estado de salida y la fuente activa. Debajo, un selector visual de prioridades: Directo · Playlist de respaldo · Cartela de emergencia. Resaltar únicamente la fuente informada por el sistema.

Resumen de playlist: archivos seleccionados, duración conocida o pendiente, orden y separadores. Acción principal «Editar playlist». Explicar retorno al directo sin prometer una transición imperceptible. Si no hay videos o falta un archivo, mostrar la causa y el enlace concreto para corregirla. Ocultar detalles de infraestructura a roles que no los necesiten.

### 4.6 Biblioteca

Cabecera: «Biblioteca» y botón «Subir videos». Barra de herramientas: ruta de carpetas, búsqueda, filtros si existen metadatos, vista y nueva carpeta. Una banda pequeña muestra uso y cuota en unidades coherentes. En el caso de ejemplo, 307,3 MB de 5 GB; reemplazar con datos reales.

Tabla con selección, nombre, ruta o carpeta, tamaño, duración, estado y menú de acciones. Usar miniaturas si existen o un icono de video, sin repetir imágenes de relleno. Conservar títulos completos accesibles aunque el renglón se trunque. Seleccionar una fila no debe abrirla accidentalmente.

Subida en bandeja o diálogo con selección de archivos/carpeta y arrastrar. Progreso por archivo, activos, pendientes, errores y reintento solo donde esté soportado. La opción actual «Pausar cola» se conserva como «Pausar pendientes» si las transferencias activas continúan. No aparentar pausa de bytes cuando no existe.

Advertir antes de abandonar una subida si requiere la página abierta. Mostrar límites reales del entorno, incluidos tamaño y formatos, antes de seleccionar. Ofrecer seleccionar archivo como alternativa al arrastre. Borrar o mover requiere comprobar uso en playlist, permisos y comportamiento real; nunca agregar borrado automático.

### 4.7 Playlist de respaldo

Editor con dos columnas: biblioteca filtrable a la izquierda y lista ordenada a la derecha. Añadir por botón; arrastrar como mejora, con botones subir/bajar accesibles como alternativa. Cada elemento muestra orden, título, carpeta y duración si está disponible. El mismo archivo puede aparecer varias veces si la lógica lo admite; no deduplicar por nombre.

Un panel de opciones reúne modo de reproducción, nuevo orden por ciclo e inserción de separadores. El modo aleatorio debe aclarar que la lista muestra la selección, no un orden garantizado. Desactivar «volver a barajar» cuando no aplique. Cantidad y duración de lista excluyen separadores variables o explican cómo se calculan.

Barra inferior fija: «Cambios sin guardar», «Descartar cambios» y «Guardar playlist». Al guardar, distinguir configuración persistida y aplicación a la salida si esa diferencia existe. Conservar cambios ante errores de red y proteger contra sobrescritura concurrente mediante el mecanismo disponible.

### 4.8 Marca de agua

Previsualización de salida 16:9 a la izquierda y controles a la derecha. Selector explícito «Logo» / «Composición completa». El logo usa posición, ancho y opacidad; la composición completa respeta transparencia y área del cuadro, ocultando controles que no apliquen.

Botón de archivo en español con nombre seleccionado, dimensiones, peso y validación. Tras cargar, mostrar el PNG aplicado sobre una imagen de muestra con etiqueta «Vista previa». El damero puede ser una opción para inspeccionar transparencia; no sustituye la composición final.

Permitir activar/desactivar con etiqueta, restaurar valores y guardar. Los cambios no deben reiniciar silenciosamente la señal. Describir el impacto real antes de aplicarlos. Los fps se configuran en el perfil de emisión, conservando las reglas técnicas existentes.

### 4.9 Administración: resumen

Tres indicadores: canales, clientes y videos alojados. Estados de canales solo si existe telemetría. Una tabla prioritaria con canal, propietario, estado de salida o «Sin datos», respaldo y acceso «Operar canal».

Si se ofrecen filtros de incidencias, deben derivarse de datos reales. No confundir ausencia de entrada en vivo con error cuando el canal opera correctamente en respaldo.

### 4.10 Canales de video y clientes

Abrir primero la lista, con búsqueda y botón «Crear canal». Mover el formulario de creación a un diálogo o panel lateral. Campos y cuotas según backend. No dejar una tarjeta de creación gigante encima de todos los registros.

Cliente y canal son entidades distintas. En Clientes: nombre o usuario real, rol, canales asignados y acciones autorizadas. La captura de Clientes no fue proporcionada: validar campos y operaciones existentes antes de diseñar la versión final. No añadir facturación, suspensiones o datos personales sin necesidad.

La creación debe mostrar progreso, éxito o fallo parcial del aprovisionamiento; no anunciar un canal listo si el motor falló. Cuando la clave se genera una sola vez, el resultado requiere un paso claro para copiarla. Acciones destructivas separadas de la navegación cotidiana.

### 4.11 Mi cuenta

Ficha breve con usuario y rol. Formulario acotado para contraseña actual y nueva; confirmación si aporta prevención de errores y es compatible con el flujo. Mantener la política de 15 a 128 caracteres mostrada por el sistema hasta verificar su implementación. Permitir pegar y usar gestores de contraseñas. Mostrar requisitos antes del envío.

Explicar cierre de sesiones si corresponde al comportamiento actual. Botón «Cambiar contraseña». Tras éxito, aplicar el flujo real de autenticación. No inventar gestión de sesiones, MFA ni cambio de correo si esas funciones no existen.

## 5. Responsive, estados y accesibilidad

- Escritorio: monitor y edición en dos columnas cuando el contenido lo permita. No encoger etiquetas para mantener columnas a cualquier costo.
- Tablet: barra lateral plegable, prioridad al monitor y controles debajo. Móvil: cabecera compacta y menú con foco controlado; el selector de canal continúa accesible.
- Biblioteca móvil: conservar nombre, estado y acción; detalles en fila expandible o ficha. Las tablas administrativas pueden desplazarse dentro de su contenedor con indicación visual.
- Playlist móvil: pestañas «Biblioteca» y «Mi playlist», contador visible y acciones accesibles sin arrastrar.
- Estado inicial, carga, vacío, datos parciales, error recuperable, sin permisos, éxito y cambios pendientes deben tener tratamiento explícito.
- Al guardar, bloquear envíos duplicados; mostrar progreso y resultado cerca de la acción. No borrar datos escritos por un fallo.
- `:focus-visible` claro, orden de tabulación lógico, etiquetas vinculadas a inputs, errores asociados al campo y anuncios accesibles para subidas o confirmaciones. Respetar reducción de movimiento.
- Validar escritorio 1440 y 1920 px, tablet 1024 y 768 px, y móvil 390 y 360 px sin desbordamiento de la página.

## 6. Prompt listo para Codex

Actúa como diseñador de producto y desarrollador frontend senior. Mejora OpenMediaCP sobre su repositorio existente, conservando autenticación, APIs, permisos, reglas de continuidad, configuración del motor y manejo de archivos. Usa este documento y los mockups como dirección visual. Primero lee AGENTS.md, identifica el stack y localiza las vistas y componentes compartidos. No reconstruyas el backend ni migres framework solo para cambiar el diseño.

Inspecciona https://github.com/puikinsh/CoolAdmin como referencia estructural. Adopta navegación lateral compacta, herramientas de tabla, jerarquía de formularios y adaptación móvil. No copies módulos comerciales ajenos ni importes todas sus dependencias. Si reutilizas código o assets, respeta LICENSE.md y licencias de terceros.

Implementa primero tokens, tipografía, shell y componentes compartidos; después panel de emisión y conexión; luego biblioteca, playlist, continuidad y marca de agua; finalmente sitio público, acceso, administración y cuenta. Sigue la paleta, escala y arquitectura de este documento. Mantén azul visible, barra lateral marina, superficies blancas, grises neutros y estados semánticos. No uses glassmorphism, degradados decorativos, paneles transparentes, ilustraciones genéricas ni una cuadrícula repetitiva de tarjetas para todas las pantallas.

Verifica antes de cambiar lógica los hallazgos sobre localhost, ausencia visual de clave de emisión, duraciones, nombres repetidos y roles. Son indicios de capturas, no errores de backend demostrados. Deriva estados y cuotas de datos reales; usa «Sin datos» cuando no existan. Cualquier mock o dato de muestra debe estar limitado al entorno de demostración. No prometas cero cortes, disponibilidad absoluta ni soporte de protocolos no verificados.

Implementa los flujos detallados de las once secciones. Prioriza mostrar qué sale al aire y permitir tareas en pocos pasos. Asegura coherencia entre etiqueta y comportamiento: «Conectar OBS» abre conexión; «Pausar pendientes» no promete detener subidas activas; «Guardar» informa si solo persiste o también aplica. Conserva políticas de secretos de una sola visualización y permisos del servidor.

Verifica los cambios con las comprobaciones del repositorio y con navegación visual en los tamaños indicados. Prueba selección de canal, formularios, errores, copia de servidor y clave por separado, monitor, subida, cambio de carpeta, búsqueda, orden de playlist, marca de agua y cambio de contraseña usando un entorno de prueba. No alteres emisiones ni archivos productivos para probar el rediseño. Entrega resumen de cambios, pantallas revisadas y limitaciones de integración que sigan pendientes.

## 7. Criterios de aceptación

1. En el panel se identifica el canal, el contexto, la fuente de salida y si los datos están actualizados.
2. No hay claves visibles por defecto ni endpoints de desarrollo presentados como públicos en producción.
3. Biblioteca, playlist y configuración se alcanzan desde navegación estable sin búsquedas ambiguas.
4. No se elimina ninguna función existente ni se implementan funciones ficticias para llenar el diseño.
5. Los estados no dependen solo del color, los formularios se usan por teclado y no hay textos o acciones recortados en móvil.
6. Las imágenes del sitio muestran el producto o el nicho audiovisual; no se repite la misma ilustración en todas las secciones.
7. Guardar, subir, renovar clave y cambiar contraseña comunican su resultado y efecto real.
8. La separación entre administración y operación es explícita y está respaldada por los permisos existentes.

## Referencias consultadas

- Material de OpenMediaCP adjunto a esta solicitud: once capturas y PDF del inicio público.
- CoolAdmin, README y estructura actual: https://github.com/puikinsh/CoolAdmin
- Tokens de referencia de CoolAdmin: https://github.com/puikinsh/CoolAdmin/blob/master/src/scss/app/_variables.scss

La propuesta usa la estructura de CoolAdmin como inspiración. Las decisiones de marca, flujos y jerarquía anteriores están adaptadas a OpenMediaCP.
