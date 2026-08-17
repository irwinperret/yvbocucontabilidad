# Publicar los cambios al sitio en vivo

## Diagnóstico

No es un error de código ni de datos:

- La página `Importar ajustes` existe en el proyecto y la ruta `/importar-ajustes` está registrada.
- El menú lateral ya tiene la nueva estructura (Importar Archivos / Registrar Movimiento / Gestión).
- El lote importado está en la base de datos: archivo `aj.xlsx`, tipo `ajustes`, 27 fechas registradas, Bs 15.868.236,74, estado activa.

Lo que estás mirando es el **sitio publicado** (yvbocucontabilidad.lovable.app), que todavía sirve la versión anterior. Los cambios viven en la vista previa hasta que se publica.

## Qué hacer

1. Publicar el proyecto para que la versión actual pase al sitio en vivo.
2. Recargar el sitio publicado con caché limpia (Ctrl/Cmd + Shift + R) y verificar:
   - El menú de Registro muestra "Importar Archivos" expandido con las 5 opciones, "Registrar Movimiento" y "Gestión".
   - `Importar ajustes` abre y permite cargar el Excel.
   - En "Historial de importaciones" aparece el lote `aj.xlsx` (27 fechas), con opción de revertir.

## Nota

Si prefieres cargar tú mismo el archivo desde la pestaña, puedo revertir ese lote primero para que no queden ajustes duplicados.
