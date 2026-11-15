# Instalación en VPS

## Qué incluye

OpenMediaCP 0.3 utiliza Astro con renderizado en servidor, Node 24, SQLite persistente, OvenMediaEngine v0.21.0, OvenPlayer 0.10.54, hls.js, FFmpeg y Caddy. No necesita Node, npm ni FFmpeg instalados en el host: se incluyen dentro del contenedor del panel. El instalador configura Docker desde su repositorio oficial cuando está ausente.

Objetivo soportado: VPS limpio Ubuntu 22.04/24.04, amd64, al menos 8 GB RAM y 25 GB disponibles para imágenes, análisis y biblioteca inicial. La capacidad de canales/espectadores depende del video, CPU y transferencia; no está dimensionada ni certificada. Se necesita acceso root para instalar paquetes y servicios.

## DNS y puertos

Crea tres nombres distintos apuntando al VPS:

| Nombre de ejemplo | Uso | Cloudflare |
|---|---|---|
| panel.example.com | Administración HTTPS, 443 | Proxied opcional |
| media.example.com | Reproducción LLHLS HTTPS, 443 | Proxied opcional, revisar límites/condiciones del plan para video |
| ingest.example.com | OBS / RTMP, 1935 | **DNS only**, nube gris |

Abre 80 y 443 TCP para el proxy y certificados. 443 UDP sirve HTTP/3 y es opcional. Restringe 1935 TCP a las IP de tus codificadores en el firewall del proveedor. No se abren al público 4321 (panel interno), 3333 (LLHLS interno), 8081 (API OME), base de datos ni webhook.

El proxy HTTP habitual de Cloudflare no transporta RTMP ni UDP WebRTC. Esta entrega utiliza LLHLS en HTTPS; WebRTC interactivo queda fuera del instalador. No hace falta abrir rangos UDP de OME.

## Ejecutar

Extrae el paquete en `/opt/openmediacp` y entra en esa carpeta. Revisa primero el plan:

```sh
sudo bash scripts/install.sh \
  --panel panel.example.com --media media.example.com \
  --ingest ingest.example.com --email admin@example.com --dry-run
```

Para instalar, repite el comando sin `--dry-run`. En modo `direct` (predeterminado), Caddy obtiene y renueva certificados públicos por ACME. Para la emisión inicial del certificado, los nombres deben resolver al VPS y los challenges deben poder llegar a Caddy; es más sencillo comenzar con DNS only y habilitar el proxy después de obtener HTTPS.

El instalador pide usuario y contraseña de superadministrador por consola, sin contraseña predeterminada. La contraseña se envía por stdin al proceso de creación, nunca como argumento ni en `.env`. Los secretos del motor y del proxy se generan aleatoriamente. `.env` y las claves quedan con permisos restrictivos.

Si prefieres un certificado Cloudflare Origin CA, genera uno que incluya **panel y media**, activa **Full (strict)** y ejecuta:

```sh
sudo bash scripts/install.sh \
  --panel panel.example.com --media media.example.com \
  --ingest ingest.example.com --email admin@example.com \
  --tls cloudflare --cert /root/origin.pem --key /root/origin.key
```

Ese modo valida fecha, nombres y correspondencia de clave/certificado. Un certificado Origin CA sirve entre Cloudflare y el VPS; los navegadores no lo consideran un certificado público confiable al acceder directamente. La renovación de ese certificado es operativa/manual; Caddy sí renueva automáticamente los certificados del modo direct. Configura reglas de caché que omitan `/live/*` en media y todas las rutas del panel; no caches playlists ni respuestas privadas.

No se modifica el firewall ni se eliminan instalaciones Docker existentes. El script se detiene ante un sistema no soportado, configuración existente o un fallo de seguridad; preserva volúmenes y secretos. Si se interrumpe después de generar `.env`, revisa el error antes de continuar con los comandos descritos abajo.

## Poner un canal al aire

1. Accede a `https://panel.example.com/login`.
2. Crea un cliente en Administración → Clientes, o usa la propia cuenta del administrador como propietario.
3. Crea un servicio. Guarda su clave de emisión; solo aparece una vez. Puedes renovarla desde Conectar codificador.
4. Abre la estación. En Biblioteca, sube archivos MP4/M4V con video y audio. FFmpeg lo normaliza a 720p, 25 fps, H.264/AAC. La cola envía uno o dos archivos a la vez; conserva la página abierta. Las subcarpetas se mantienen en el explorador.
5. En Playlist de respaldo, selecciona y ordena los videos. Sin videos se usa la cartela generada durante la instalación.
6. En OBS, configura `rtmp://ingest.example.com:1935/live` y la clave `in_ID?key=SECRETO`. RTMP requiere red privada o restricción de IP para proteger el secreto en tránsito.
7. En el monitor, pulsa Cargar reproductor. OvenPlayer reproduce `https://media.example.com/live/ID/llhls.m3u8`.
8. Detén OBS y comprueba el paso al respaldo; reconecta y comprueba el retorno. Mide el buffer real antes de ofrecer continuidad a clientes.

El panel y el proceso `playout` comparten la base y los contenidos. El panel escribe archivos `.sch` atómicamente en el volumen compartido. El motor observa esos archivos y crea canales permanentes: fuente `stream://default/live/in_ID`, lista de archivos como fallback y cartela cuando la lista está vacía. No se usa el reproductor para fingir el cambio de fuente.

La programación por calendario no está implementada en 0.3; se admite playlist repetitiva y prioridad de directo. No se incluyen revendedores, facturación, grabación de video, ABR multicalidad ni alta disponibilidad. No se afirma equivalencia funcional completa con MediaCP.

## Grabación de radio por canal

En el panel, selecciona un canal y abre **Contenido → Radio a la carta**. Como administrador, pega la URL HTTP o HTTPS de una señal de audio de confianza y activa **Grabar continuamente**. Para permitir el acceso sin sesión, activa **Publicar la página de Radio a la carta** y comparte el enlace del canal. La URL de origen queda en el panel. La página y los audios se sirven con instrucciones de no indexación.

El servicio `radio` lee la fuente continua con FFmpeg y almacena Ogg/Opus a 82 kb/s en el mismo volumen persistente del panel. Corta al cambio de hora y publica cada tramo al cerrarlo. Si se interrumpe la fuente, reintenta y conserva los tramos recuperables. El archivo usa la hora de Chile continental y elimina automáticamente los registros anteriores a hoy y los cuatro días anteriores. Calcula alrededor de **4,5 GB por canal** con grabación continua durante cinco días.

Para una instalación existente, reemplaza el código con el paquete actualizado conservando `.env`, los certificados y el volumen de datos. Desde el directorio de instalación, ejecuta `docker compose build app` y luego `docker compose up -d app radio`. Para revisar el servicio, usa `docker compose logs --tail=100 radio`.

## Operación, actualización y recuperación

```sh
docker compose ps
docker compose logs --tail=100 app caddy
docker compose logs --tail=100 ome
```

La configuración XML de OME activa protección de privacidad y nivel warn; aun así, trata sus logs como información sensible. No publiques URLs que contengan claves.

Tras corregir un fallo de instalación, puedes continuar sin borrar `.env` ni volúmenes:

```sh
docker compose build app ome
bash scripts/security-scan.sh
docker compose run --rm --no-deps --user root --cap-add CHOWN app sh -c \
  'node scripts/init-data.mjs && chown -R node:node /data'
```

Si aún no creaste el administrador, lee la contraseña de forma oculta y envíala por stdin:

```sh
read -r -s -p 'Contraseña: ' OM_PASSWORD; echo
printf '%s' "$OM_PASSWORD" | docker compose run --rm -T --no-deps app \
  node scripts/admin.mjs create admin
unset OM_PASSWORD
```

Para renovar una contraseña de administrador, cambia `create` por `reset`. Se revocan sus sesiones existentes.

Valida y arranca después:

```sh
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d --wait --wait-timeout 180
```

Caddy obtiene certificados de forma asíncrona. Un contenedor iniciado no acredita que DNS, certificado o señal ya funcionen. Comprueba HTTPS en ambos nombres y la emisión de OBS antes de considerar operativa la instalación.

Antes de actualizar, detén escrituras y respalda de forma consistente el volumen `openmediacp_panel_data`, `.env`, `deploy/certs` y el volumen de certificados de Caddy. La base usa WAL: copiar solo `panel.sqlite` mientras está en uso no es un respaldo consistente. Un respaldo del volumen con la aplicación detenida incluye base, WAL, videos y schedules. Protege la copia, contiene información privada.

Actualiza dependencias e imágenes de forma controlada; conserva los digests anteriores para volver atrás. Ejecuta pruebas, build y escáner antes de `docker compose up -d --build`. No uses `docker compose down -v` salvo que quieras eliminar definitivamente datos y certificados.

## Seguridad y verificación

Ver [SECURITY.md](../SECURITY.md) para controles, límites y referencias OWASP. El instalador bloquea el despliegue ante hallazgos HIGH/CRITICAL de Trivy. Los informes no se deben confundir con una garantía de ausencia de vulnerabilidades. El host necesita actualizaciones regulares del sistema y Docker.

Verificado en desarrollo: tipos/build, autenticación, expiración y revocación de sesiones, CSRF, permisos, acceso cruzado entre clientes, generación de schedules y firma de webhook. Verificado adicionalmente con Docker/Colima en el Mac: arranque del panel y OME, reproducción OvenPlayer, normalización y dos subidas simultáneas con subcarpetas, paso cartela→directo→cartela, ciclos de AutoDJ y marca de agua quemada en señal pública tanto con respaldo como con directo. Se confirmó decodificando los píxeles del video, no solo por mensajes de estado. Caddy aceptó su configuración con `caddy validate`. Pendiente en un VPS real: instalación de paquetes del host Ubuntu/amd64, DNS, emisión/renovación ACME, Origin CA/Cloudflare y pruebas de carga. El análisis del proxy HTTPS se debe resolver antes de desplegar; véase el informe de verificación.

Referencias oficiales: [OME Scheduled Channel](https://ovenmedia.com/docs/ome/live-source/scheduled-channel), [OME AdmissionWebhooks](https://ovenmedia.com/docs/ome/access-control/admission-webhooks), [OvenPlayer](https://ovenmedia.com/docs/ovenplayer), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [puertos de Cloudflare](https://developers.cloudflare.com/fundamentals/reference/network-ports/), [Docker en Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

## AutoDJ, carpetas y marca de agua

En **Biblioteca** puedes subir varios archivos o una carpeta completa. El explorador organiza carpetas virtuales sin utilizar nombres del cliente como rutas físicas del servidor. La cola permite uno o dos archivos simultáneos y limita tamaño/almacenamiento. `STORAGE_QUOTA_BYTES` configura la cuota global por cuenta y `MAX_OUTPUT_BYTES` limita el video preparado; por defecto son 5 GB y 1 GB en el VPS.

En **Playlist de respaldo**, selecciona videos principales y separadores. Un intervalo 0 desactiva separadores. Con orden aleatorio se genera un orden al guardar; con rebarajado por ciclo el worker controla el índice real de archivos y genera un orden nuevo cada vez que termina la lista. Ese AutoDJ sigue en marcha en segundo plano durante el directo.

En **Marca de agua**, sube un PNG (máximo 5 MB / 4096 px), selecciona automático, imagen completa o logo pequeño, posición, ancho y opacidad. Una imagen completa se adapta al cuadro 1280×720 conservando su transparencia; ancho/opacidad/posición corresponden al logo pequeño.

La edición comunitaria de OME no incluye el compositor de imagen Enterprise. Se implementó un proceso FFmpeg propio: AutoDJ con PNG → `auto_ID`, y directo con PNG → `marked_ID`; el canal público `ID` selecciona la fuente. OME distribuye esas fuentes sin volver a comprimirlas. Esas rutas internas no pasan por la regla pública de Caddy. El secret `OME_WORKER_SECRET` autoriza únicamente publicaciones internas firmadas; se genera durante la instalación y no se entrega al cliente. Los cambios de marca o reinicios pueden producir un buffer; el compositor añade latencia y CPU. Al cambiar el perfil se recrea la pista pública para actualizar su configuración de códec. El perfil liviano tiene un objetivo combinado de 0,87 Mbps (742 kbps video + 128 kbps audio) y un máximo combinado de 1,2 Mbps durante la ventana del codificador, más cabeceras de transporte. No se promete latencia subsegundo con esta cadena.

Las bibliotecas del reproductor y sus fuentes se sirven desde el panel. La política CSP permite las fuentes de iconos embebidas que utiliza OvenPlayer; no exige desactivar globalmente esa protección.
