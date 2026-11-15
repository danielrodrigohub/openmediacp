# Auditoría de interfaz de OpenMediaCP

Estado: hallazgos 1 y 2 implementados por solicitud expresa del usuario. La evidencia de la tabla describe la situación previa a la corrección. La revisión visual general permanece fuera de esta auditoría.

## Design language

- Audited surface: gestión del canal en `/cliente/`, `/cliente/archivos/`, `/cliente/playlists/`, `/cliente/fallback/`, `/cliente/marca/` y `/cliente/conexion/`. Se trazaron también sus propietarios compartidos y sus consumidores en acceso, cuenta y administración. No constituye una revisión visual completa de todas las pantallas.
- Design sources: [Panel.astro](/Users/danielrodrigovega/Documents/Proyectos/openmediacp/src/layouts/Panel.astro:2) carga Inter, `panel.css` y después `theme.css`. [README.md](/Users/danielrodrigovega/Documents/Proyectos/openmediacp/README.md:3) describe la identidad actual: interfaz clara/oscura, Inter local, SVG e inspiración en la estructura clásica de MediaCP con identidad propia. No se encontró `DESIGN.md` ni una guía local que prescriba una nueva paleta.
- Documented decisions: conservar la identidad propia, tipografía Inter y sistema de iconos SVG. El tema implementado define superficies claras y oscuras, acento petróleo `#18798c` en claro y `#66bed0` en oscuro. Son valores existentes, no una propuesta nueva. La revisión de colores, composición y jerarquía visual requiere inspección visual solicitada expresamente; no se ha realizado en esta auditoría.
- Governing owners and consumers: `src/layouts/Panel.astro` compone navegación, encabezado, pestañas y contenido para cliente, administración y cuenta. `src/styles/panel.css` gobierna estructura y puntos de cambio a 1200/760 px; `src/styles/theme.css` redefine apariencia y temas. `src/pages/login.astro` importa las mismas hojas y fuente, con composición propia. `src/pages/cliente/[section].astro` compone biblioteca, playlist/continuidad, marca de agua y conexión. Los controles específicos pertenecen a `UploadQueue.astro`, `Watermark.astro` y `Player.astro`.
- Explicit exceptions: None documented.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | La opción «Mantener los originales» promete conservar los fps, aunque AutoDJ utiliza un único valor para toda la lista. | **Contrato:** el selector de [Watermark.astro:10](/Users/danielrodrigovega/Documents/Proyectos/openmediacp/src/components/Watermark.astro:10) promete conservar los originales. **Ruta:** el formulario envía `frameRate` al endpoint del canal; este llama a `saveWatermark`, que persiste el valor; el servicio `playout` lee la misma configuración. [playout.mjs:43](/Users/danielrodrigovega/Documents/Proyectos/openmediacp/scripts/playout.mjs:43) selecciona el mayor fps entre principales y separadores, limitado a 25–30. Su codificador y decodificador usan ese mismo valor. **Consecuencia:** una lista de 25 y 30 fps sale unificada a 30 fps; la opción no mantiene ambos originales. En directo, la opción automática omite `-r`. | Corregir únicamente el texto de la opción y su ayuda: «Automático para el canal (recomendado)». Explicar que AutoDJ unifica principales y separadores entre 25 y 30 fps, mientras que el directo mantiene los fps de entrada. | Formulario de marca de agua del canal, tanto para cliente como para administrador al abrir la estación. No cambiar el codificador ni sus valores. | Alta |
| 2 | La actividad muestra el identificador técnico `watermark_updated` donde los otros cambios tienen descripciones en español. | **Contrato:** el mismo flujo denomina la acción «Guardar marca de agua», confirma «Marca de agua guardada» y muestra el registro bajo «Actividad del canal». **Ruta:** [watermark.ts:16](/Users/danielrodrigovega/Documents/Proyectos/openmediacp/src/server/watermark.ts:16) registra `watermark_updated` con el identificador del canal. [cliente/index.astro:10](/Users/danielrodrigovega/Documents/Proyectos/openmediacp/src/pages/cliente/index.astro:10) consulta esos eventos; el mapa de la línea 11 carece de esa entrada y la línea 17 imprime el identificador como alternativa. **Consecuencia:** al guardar el logo y volver a la vista general aparece la clave técnica en la tabla en español. | Añadir `watermark_updated: 'Marca de agua actualizada'` al mapa `labels` existente de la vista general. | Actividad de `/cliente/`, para ambos roles al consultar el canal. No modificar los eventos almacenados ni crear un sistema de traducción paralelo. | Alta |

## Improve first

Corregir el hallazgo 1. El texto actual contradice el ajuste real de la emisión y afecta directamente a la decisión del usuario entre conservar fps o elegir 25/30. La corrección pertenece al contenido del formulario y no requiere cambiar el funcionamiento multimedia.

## Alcance revisado y límites

Se leyeron etiquetas, clases de selección, variantes de formularios, composiciones y reglas adaptativas de las rutas trazadas. Login y las páginas administrativas se revisaron como consumidores de los propietarios compartidos; no se presentan como una familia visual auditada por separado.

Se descartó el candidato sobre elementos ocultos: `src/styles/panel.css:3` ya contiene `[hidden]{display:none!important}`, que prevalece frente a `.button` y `.logo-preview`. No hay fundamento para reportarlo como defecto.

No se reportan como fallos demostrados una paleta anticuada, exceso de densidad, mala jerarquía, controles demasiado pequeños ni composición móvil deficiente: requieren evidencia visual actual. Tampoco se propone sustituir colores por una plantilla genérica ni introducir componentes nuevos sin necesidad demostrada.

Tras la auditoría, el usuario solicitó aplicar los hallazgos. Se corrigieron la opción automática y su ayuda en `Watermark.astro`, y la descripción de `watermark_updated` en el mapa `labels` de la vista general. Se conservan el valor `source`, el funcionamiento multimedia y los eventos almacenados.

## Validación de la implementación

`npm run check`: 0 errores y 0 advertencias. `npm run build`: completado. Se reconstruyó la imagen y se actualizó únicamente el servicio web del Docker local; el panel superó su comprobación de salud. No se reiniciaron OvenMediaEngine ni el proceso de AutoDJ para aplicar estos textos.
