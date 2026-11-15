# OpenBroadcast Panel by STREAMCHILENO.CL

Panel personal de video streaming en Astro con cuentas de superadministrador/cliente, OvenMediaEngine y OvenPlayer. Interfaz clara/oscura, tipografía Source Sans 3 local e iconos SVG sin dependencias de UI. Rediseñado a partir de las imágenes y la guía de interfaz aportadas para OpenMediaCP.

## Versión 0.3

- Acceso real: usuarios, contraseñas scrypt, sesiones persistentes, cierre de sesión, cambio de contraseña y controles de pertenencia.
- Administración: crear clientes y servicios de video; generar/renovar claves privadas de publicación.
- Estación: OvenPlayer con controles accesibles, biblioteca MP4/M4V, carpetas y cola de subidas de uno o dos archivos simultáneos.
- AutoDJ: separadores cada N videos, orden aleatorio y rebarajado al terminar ciclos reales de reproducción.
- Marca de agua: PNG completo o logo en esquina, tamaño/opacidad; compositor FFmpeg que aplica la imagen al directo y al respaldo.
- Motor: configuración OME y schedules de canal permanente con retorno entre directo y archivos.
- Instalación VPS: Docker Compose, HTTPS con Caddy, modo Cloudflare Origin CA, secretos aleatorios, versiones por digest y análisis CVE antes del arranque.

Esta entrega incluye implementación y paquete instalable. Se probó localmente en Docker/Apple Silicon el flujo directo/respaldo, la subida simultánea, los ciclos AutoDJ y el logo quemado en la señal. DNS, certificados públicos y operación en un VPS aún requieren validación real. No hay calendario de emisiones ni reproducción privada. El ingreso OBS utiliza RTMP; panel y reproducción usan HTTPS. Consulta los límites en la guía.

## Interfaz

Portada pública en `/`, acceso en `/login` y espacios separados de cliente y administración. La interfaz utiliza navegación lateral única, colores sólidos, modo oscuro y diseño adaptable a móviles. [Sistema de interfaz](DESIGN.md).

## Docker local en Mac

[Guía local](docs/local-mac.md) · Panel en `http://127.0.0.1:14321/login`. Se usa un perfil Colima dedicado y datos independientes del VPS.

## VPS

[Guía completa de instalación](docs/vps.md) · [Seguridad y CVE](SECURITY.md)

```sh
npm run package:vps
```

El archivo `release/openmediacp-vps.tar.gz` contiene código, configuración e instalador; excluye credenciales, datos, certificados, dependencias locales e informes.

## Desarrollo

Requiere Node 24.15+ o 26. Copia `.env.example` a `.env`, ajusta los nombres y genera secretos si usarás OME. Nunca reutilices secretos de otro entorno.

```sh
npm ci
# Lee la contraseña en tu terminal; no la pongas en el historial.
read -r -s -p 'Contraseña: ' OM_PASSWORD; echo
printf '%s' "$OM_PASSWORD" | node --env-file=.env scripts/admin.mjs create admin
unset OM_PASSWORD
npm run dev
```

Panel: `http://127.0.0.1:4321/login`. La biblioteca y el compositor requieren FFmpeg/ffprobe localmente; la imagen del VPS ya los incluye. El panel puede explorarse sin OME, pero mostrará el motor como desconectado.

```sh
npm run check
npm run build
npm test
npm run security:audit
```

Las pruebas usan una base y un servidor aislados. No alteran las cuentas locales. Astro 7 mantiene su servidor de desarrollo: `npx astro dev stop` lo detiene.

## Referencias y licencias

[Investigación inicial](docs/investigacion-mediacp.md). La arquitectura inicial con MediaMTX fue reemplazada por OME a petición del usuario. OME está bajo AGPL-3.0 y OvenPlayer bajo MIT: conserva avisos y revisa sus obligaciones al distribuir o modificar esos componentes. No se incluye código propietario ni marcas de MediaCP.
