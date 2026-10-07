# Actualización: Sincro. AAG y Estadísticas

## Sincro. AAG

- Muestra únicamente información de los exports actuales agrupados por torneo.
- Detalla cada categoría/salida, ID remoto AAG, estado, tarjetas enviadas, aceptadas y con error.
- Permite buscar por nombre de torneo.
- Incluye `Actualizar campos y salidas AAG`.
- Incluye una verificación manual no destructiva de estados.
- El worker revisa automáticamente todos los estados los jueves a las 12:00 (Argentina).

## Estadísticas

- Permite seleccionar uno o varios torneos.
- Permite filtrar por índice mínimo y máximo, ambos inclusive.
- Utiliza únicamente tarjetas válidas/cargadas.
- Calcula por cada observación `golpes - par` usando el snapshot histórico de la tarjeta.
- Tolera cambios históricos del par de la cancha sin mezclar referencias incorrectas.
- Presenta ranking de dificultad y tabla completa de resultados por hoyo.

## Archivos principales

- `js/aag_exports_service.js`
- `js/statistics_service.js`
- `js/shell.js`
- `vmgc.css`
- `supabase/functions/swift-worker/index.ts`
- `supabase/sql/aag_status_refresh.sql`

