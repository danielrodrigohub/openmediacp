# OpenBroadcast Panel · Sistema de interfaz

La referencia vigente es la guía `OpenMediaCP_Rediseno_UI_UX.md` y las tres vistas aportadas por el usuario el 2 de noviembre de 2026: sitio público, biblioteca y playlist de respaldo. Sustituyen la referencia visual anterior. Las imágenes son propuestas, no evidencia de funciones ni mediciones reales.

## Identidad y medidas

Source Sans 3 para interfaz e IBM Plex Mono para direcciones y datos técnicos, servidas localmente. Texto general de 15–16 px, metadatos de 13–14 px y títulos operativos de 26–30 px. Iconos SVG de la misma familia. Superficies opacas, radios de 6 px en paneles y 4 px en campos. Sin ilustraciones generadas, glassmorphism, degradados decorativos ni módulos ajenos a la operación de streaming.

| Uso | Color |
| --- | --- |
| Navegación | `#17243B` |
| Acción principal | `#2459C4` |
| Hover | `#1D469C` |
| Fondo | `#F2F4F7` |
| Superficie | `#FFFFFF` |
| Texto | `#202C3D` |
| Texto secundario | `#526176` |
| Bordes | `#D5DCE5` |
| Correcto | `#147547` |
| Advertencia | `#946200` |
| Error / directo en contexto | `#B93438` |

La barra lateral mide 244 px, o 232 px en pantallas intermedias; cabecera de 64 px. Hasta 1024 px la navegación pasa a un menú con cierre por Escape, control de foco y fondo de cierre. El contenido usa 16 px de margen en móvil. Las tablas se adaptan o desplazan dentro de su contenedor. El tema oscuro conserva las funciones y jerarquías, mediante variables de color.

## Propietarios del diseño

- `src/styles/theme.css`: fuente, reset, paleta, distribución y componentes vigentes. No depende de `panel.css`.
- `src/layouts/Panel.astro`: navegación, canal activo, encabezado y acciones de página.
- `src/components/AccountMenu.astro`: cuenta, rol real, tema y cierre de sesión.
- `src/components/MediaLibrary.astro` y `src/scripts/library.ts`: tabla, búsqueda limitada a la carpeta actual, selección y carpetas.
- `src/components/PlaylistEditor.astro` y `src/scripts/playlist-editor.ts`: biblioteca a la izquierda, lista ordenada a la derecha, opciones y barra de guardado.
- `src/components/UploadQueue.astro` y `src/scripts/upload-queue.ts`: diálogo de selección y bandeja visible solo cuando hay transferencias.
- `src/components/Watermark.astro` y `src/scripts/watermark.ts`: composición de muestra, controles aplicables y subida separada del guardado.
- `src/pages/index.astro` y `src/pages/login.astro`: presentación pública y acceso.

## Navegación y comportamiento

OPERACIÓN: Panel de emisión, Conectar OBS y Continuidad. CONTENIDO: Biblioteca, Playlist de respaldo y Marca de agua. Administración solo con el permiso correspondiente. Cuenta y ayuda conservan destinos reales.

La biblioteca muestra tamaños, fechas y duraciones registrados; usa iconos cuando no existen miniaturas. La selección permite preparar la playlist. Las transferencias admiten uno o dos archivos activos; pausar pendientes no cancela los activos. El editor conserva cambios ante fallos, permite descartar y protege contra guardar una revisión desactualizada. El backend admite hasta 100 videos distintos, sin duplicar un mismo ID.

La marca de agua se presenta sobre un fotograma explícitamente demostrativo. Logo pequeño y composición completa muestran controles diferentes. El perfil de fps está en Conectar OBS. Editar la marca no altera el fps seleccionado.

## Datos y límites

Fuente de salida, recepción del encoder, propiedades de la salida y hora de consulta son conceptos separados. El estado del proceso de composición o del schedule no demuestra qué fuente está al aire. Cuando OME no permite determinarlo de forma fiable, se muestra «Sin datos»; no se inventan estados.

Las claves se muestran una sola vez al crearlas o renovarlas. Los endpoints provienen del entorno y los locales se identifican. Las capturas de la portada y del acceso proceden de la aplicación funcionando con datos de prueba y están identificadas como tales.

Los archivos `public/images/capturas/*.jpg` son capturas directas del navegador de una instalación aislada de OpenMediaCP, sin retoques ni generación por IA. Su origen consta en `docs/capturas-reales.md`. El archivo `demo-fotograma.jpg` permanece únicamente en la vista previa de marca de agua como imagen de muestra aportada.

Este rediseño conserva los permisos y el perfil de streaming existente: objetivo nominal combinado de 0,87 Mb/s y máximo de 1,2 Mb/s. No modifica segmentos, buffers ni el motor de reproducción.

## Marca vigente

OpenBroadcast Panel by STREAMCHILENO.CL. El componente compartido `src/components/Brand.astro` presenta el nombre en Montserrat Black (900), servida localmente. La firma usa el texto exacto «by STREAMCHILENO.CL». Source Sans 3 se mantiene para los controles y textos operativos. Las capturas reales se vuelven a tomar tras el cambio de marca; no se retocan sus píxeles para sustituir el logotipo.
