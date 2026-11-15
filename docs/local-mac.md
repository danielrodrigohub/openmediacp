# Pruebas locales en macOS

El entorno local usa Docker y Colima en Apple Silicon. Contiene el mismo panel y motor que el instalador del VPS, con volumen independiente y puertos vinculados exclusivamente a 127.0.0.1. No necesita dominio ni certificados públicos; HTTP se utiliza solo en loopback para estas pruebas.

## Iniciar y detener

En este Mac ya se instalaron Colima, Docker CLI, Compose y Buildx con Homebrew. Se creó el perfil `openmediacp` (2 CPU, 3 GB RAM, disco virtual disperso de 12 GB). Su contexto no sustituye el contexto predeterminado de Docker.

```sh
colima start openmediacp --activate=false
DOCKER_CONTEXT=colima-openmediacp bash scripts/local.sh up
```

Abre [el panel local](http://127.0.0.1:14321/login). Para detener únicamente los contenedores:

```sh
DOCKER_CONTEXT=colima-openmediacp bash scripts/local.sh stop
```

Para liberar también la memoria de la máquina virtual:

```sh
colima stop openmediacp
```

No ejecutes `down -v` si quieres conservar cuentas y videos. La configuración `.env.local-docker` y el volumen `openmediacp-local_local_data` están separados del VPS y de la base usada por `npm run dev`.

## Puertos de prueba

| Servicio | Dirección |
|---|---|
| Panel | http://127.0.0.1:14321/login |
| Servidor OBS | rtmp://127.0.0.1:11935/live |
| Reproducción | http://127.0.0.1:13333/live/ID/llhls.m3u8 |

La clave de emisión tiene la forma `in_ID?key=SECRETO`. Usa la indicada en el panel o la nota inicial local. No reutilices claves de esta instalación en el VPS.

Durante esta sesión se generó una cuenta `admin` y una nota `.local-access` con la contraseña inicial y clave del canal de pruebas. Esa nota tiene permisos 600, está excluida de Git, del contexto Docker y del paquete VPS. Es una comodidad de bootstrap local: cambia la contraseña y la clave desde el panel y elimina la nota después de leerla. En la base de datos se guardan solo hashes.

## Recrear desde el código

```sh
node scripts/local-prepare.mjs
DOCKER_CONTEXT=colima-openmediacp bash scripts/local.sh build
DOCKER_CONTEXT=colima-openmediacp bash scripts/local.sh init
DOCKER_CONTEXT=colima-openmediacp bash scripts/local.sh up
```

`init` no renueva una cuenta que ya exista. En una instalación nueva muestra por consola las credenciales aleatorias iniciales; guárdalas de forma privada. La creación manual del administrador también puede realizarse con `scripts/admin.mjs` por stdin, como en la guía del VPS.

## Prueba de continuidad

En OBS, conecta el servidor y la clave del canal; detén y vuelve a iniciar la emisión para comprobar el respaldo. El monitor carga al entrar al panel e inicia la reproducción silenciada. Activa el audio desde los controles del reproductor; los navegadores pueden impedir el inicio automático con sonido.

La prueba automática crea un canal y usuario temporales, decodifica un frame de la cartela, publica video rojo con tono y después comprueba el retorno a la cartela en la misma URL. Limpia sus propios recursos al terminar:

```sh
DOCKER_CONTEXT=colima-openmediacp docker compose --env-file .env.local-docker \
  -f compose.local.yaml exec -T -w /app/scripts app node --input-type=module \
  < scripts/media-smoke.mjs
```

Esta prueba utiliza FFmpeg dentro del contenedor. No abre OBS ni transmite a un servicio externo.

## Recursos y seguridad

El Mac dispone de 8 GB RAM y poco espacio libre. La compilación, escaneo y transcodificación pueden aumentar temporalmente el consumo. Evita realizar varias transcodificaciones simultáneas y detén Colima cuando no lo uses. No se configura arranque automático al iniciar macOS.

La imagen oficial de OME v0.21.0 fue analizada y se detectó `CVE-2026-84782` en su paquete libssl3. `deploy/Dockerfile.ome` crea una imagen derivada que actualiza OpenSSL desde los repositorios del sistema; los resultados del nuevo análisis deben revisarse en `reports/`. Una imagen fijada por digest también necesita revisiones periódicas.

El paquete VPS conserva HTTPS y su bloqueo por vulnerabilidades HIGH/CRITICAL. Ejecutar el entorno local no equivale a validar DNS, certificados o Cloudflare en producción.

## Funciones 0.3 verificadas

- MP4/M4V se inspeccionan por contenido y se preparan en H.264/AAC. Las carpetas se conservan como organización virtual; los archivos físicos usan identificadores seguros.
- La cola admite uno o dos archivos activos, progreso por archivo, pausa de pendientes y reintento de fallos. No conserva objetos File al cerrar/recargar la página.
- AutoDJ intercala separadores cada N videos y puede generar un orden nuevo por ciclo. Con rebarajado por ciclo activo, continúa reproduciendo en segundo plano durante el directo.
- La marca de agua se quema una vez en cada fuente: AutoDJ o directo. OME distribuye el resultado sin volver a comprimirlo. Cambiar el perfil reinicia la pista pública para renovar los datos del códec y puede interrumpir brevemente la reproducción.
- El entorno local limita el almacenamiento por cliente a 512 MB y cada video normalizado a 256 MB para reducir el riesgo observado de llenar el disco del Mac. El VPS conserva 5 GB por cuenta de forma predeterminada. El archivo de entrada admite hasta 128 MB.

`playout` es el proceso adicional que controla los ciclos y el compositor. Puede consumir CPU aunque no haya un espectador; detener Colima libera esos recursos.

La base y los videos se conservaron después de un fallo de espacio temporal; se guardó un respaldo privado en `data/local-docker-backup.tar.gz`. No se incluye en el paquete ni en Git.

## Perfil liviano

El perfil codificado usa 742 kbps de video y 128 kbps de audio: objetivo combinado 0,87 Mbps. El máximo de video es 1072 kbps, equivalente a 1,2 Mbps con audio. La ventana VBV es de dos segundos; cabeceras de contenedor y HTTP añaden tráfico. El reproductor muestra una estimación, que puede variar. Los archivos nuevos compatibles y bajo el límite se copian sin volver a comprimir; los demás se preparan dentro del presupuesto. Los archivos anteriores no se modifican. OBS sin marca de agua se distribuye tal como llega: configura allí el mismo presupuesto.

Se conservan los fps compatibles del archivo (hasta 30); convertir 25 a 30 no recupera detalle. Con marca de agua el canal normaliza el cuadro a 720p y permite elegir 25/30 fps. Una fuente ya convertida a 25 fps necesita importarse de nuevo desde su original para recuperar sus 30 fps originales.

## Margen de reproducción

LLHLS publica partes de 1 segundo y segmentos de 6 segundos. El monitor usa reproducción sin perseguir el borde de baja latencia, con un objetivo de 12 segundos detrás del directo, buffer máximo de 30 segundos y 15 segundos de historial. El retraso real puede aumentar por la composición del directo o por pausas de red. El objetivo es estabilidad; no cambia el presupuesto de bitrate. Referencia: [configuración LLHLS de OME](https://ovenmedia.com/docs/ome/streaming/low-latency-hls).
