# Verificación local

Entorno: Mac arm64 con Colima, VM de dos núcleos y 3 GB de RAM. No equivale a una prueba de carga en VPS.

Se verificaron tipos/build, seis pruebas de seguridad y acceso HTTP, reproducción con OvenPlayer, MP4/M4V, dos subidas simultáneas con subcarpetas, firma de ingreso RTMP y continuidad cartela/directo/respaldo. Las pruebas de marca comprueban píxeles decodificados. El perfil liviano usa un presupuesto combinado objetivo de 870 kbps y máximo de 1200 kbps (sin cabeceras de transporte). Cambiar el perfil puede reiniciar temporalmente la pista pública.

## Seguridad de imágenes

Los informes locales de Trivy son una instantánea y requieren repetirse antes de instalar. `reports/` contiene resultados privados del desarrollo y no se empaqueta.

| Imagen revisada | HIGH/CRITICAL | Resultado |
| --- | ---: | --- |
| App Alpine analizada sin npm en runtime | 0 | Informe app-vulnerabilities.json |
| OME derivada con paquetes corregidos | 0 | Informe ome-vulnerabilities.json |
| Caddy 2 revisado | 10 | Despliegue de producción bloqueado por el instalador |

Los informes anteriores de app/OME conservan hallazgos previos a los arreglos; no deben confundirse con los de las imágenes derivadas finales. No se afirma ausencia universal de vulnerabilidades.

El proxy necesita una versión/dependencias corregidas y un nuevo análisis antes de desplegar. Véase el [aviso oficial de go-jose](https://github.com/go-jose/go-jose/security/advisories/GHSA-mgcc-cww5-fp2q). No se suprimieron esos hallazgos. La configuración de Caddy pasó su validador, pero no se probaron DNS, ACME, Origin CA ni Cloudflare contra un dominio de producción.

## Regresión de reproducción

La prueba final con Docker completó subidas MP4/M4V en paralelo, conservación de subcarpetas, ciclos de AutoDJ, logo azul decodificado desde la salida pública y directo rojo interno con salida pública azul por la marca. Al finalizar el directo se verificó el cierre de su entrada y el retorno al respaldo. Durante la prueba también se observó el avance del AutoDJ con logo hasta el ciclo 12.

Se corrigió un bloqueo tras el rechazo temporal de una publicación RTMP: los canales extra de FFmpeg podían mantener pendiente el evento de cierre. El worker ahora detecta la salida del codificador, cierra esos canales y permite el reintento. La renovación de la pista pública espera la nueva señal y su resolución.

Configuración de entrega comprobada en el manifiesto: segmentos objetivo de 6 segundos, partes de 1 segundo y PART-HOLD-BACK de 8 segundos. El monitor usa un objetivo de 12 segundos detrás del directo y un buffer máximo de 30 segundos; debe cargarse de nuevo para recibir esta configuración. Se midieron 0,841 Mbps en una muestra de 12 segundos del canal y se decodificaron 200 cuadros en 8 segundos sin errores. Son muestras locales, no una garantía de rendimiento sostenido ni del tráfico HTTP total.
