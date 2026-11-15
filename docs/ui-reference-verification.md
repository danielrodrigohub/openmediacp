# Verificación del rediseño aportado

Fecha: 2 de noviembre de 2026.

## Alcance

Interfaz basada en la guía OpenMediaCP_Rediseno_UI_UX.md y las imágenes aportadas de portada, biblioteca y playlist. Se conservan Astro, la autenticación y los permisos existentes. No se añadieron precios, clientes, testimonios, métricas ficticias ni imágenes generadas. Los recortes de demostración proceden de las imágenes originales y se identifican como muestras.

## Comprobaciones

- Revisión de tipos y compilación del servidor.
- Ocho pruebas automáticas: contraseñas, sesiones, límites de intentos, pertenencia de canales, rutas y separadores, revisión obsoleta de playlist, conservación de fps al editar la marca y controles HTTP/CSRF/IDOR/webhooks.
- Navegador con una instalación Docker aislada y datos de prueba: acceso, navegación de administración a canal, búsqueda de biblioteca, creación de carpeta, selección y preparación de playlist, orden, reproducción aleatoria, separadores, guardado y descarte.
- Subida real de un M4V de prueba, progreso, confirmación y actualización de biblioteca. Selección de dos transferencias simultáneas; no se simuló una carga masiva para medir rendimiento.
- Selección y subida de PNG, información de dimensiones y tamaño, guardado de configuración y controles diferentes entre logo y composición completa.
- Editor a 360, 390, 768, 1024, 1440 y 1920 px sin desbordamiento horizontal de página. Biblioteca revisada a 390 y 1440 px. Menú móvil y cambio entre Biblioteca/Mi playlist comprobados.
- Portada y acceso instalados comprobados a 360 px; portada sin desbordamiento y formulario de acceso primero en móvil. Captura final: `design-plans/portada-instalada.png`.
- Corrección verificada: los radios de composición ya no generan un campo absoluto del ancho del viewport ni desplazan la página al recibir foco.

Las pruebas no modificaron los videos ni la configuración del canal personal existente. La captura `design-plans/playlist-validada.png` muestra datos del entorno de prueba.

## Límites explícitos

La API consultada de OME no ofrece una identificación fiable de la fuente que está al aire: un schedule puede informar un programa sin que su entrada exista. Por eso la interfaz indica «Sin datos» para la fuente y presenta por separado la recepción y las propiedades consultadas de la salida. Guardar una playlist confirma persistencia y envío al motor, no una transición ya verificada.

No se probó en esta revisión una migración a VPS, certificados públicos, carga de espectadores ni todos los fallos posibles de red. La puerta de análisis de imágenes del instalador conserva su bloqueo ante CVE pendientes; una actualización de interfaz no equivale a certificar el despliegue completo.

## Inicio automático del monitor

Actualización del 2 de noviembre: se eliminó el paso «Abrir monitor». OvenPlayer se inicializa al montar el componente con inicio automático y audio silenciado. Se comprobó el módulo compilado con un HLS local de prueba: video sin pausar, muted=true, readyState=4 y tiempo de reproducción avanzando, sin clic previo. Se mantienen los parámetros de buffers y bitrate.
