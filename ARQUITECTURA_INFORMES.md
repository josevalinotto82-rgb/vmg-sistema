# Informes y exportaciones

Cada salida tiene un único generador. Las pantallas operativas cargan el generador solamente cuando el usuario lo necesita.

| Salida | Generador único | Origen de datos | Invocación |
|---|---|---|---|
| Informe de pagos | `js/payment_report.js` | `loadOfficialization()` | Visor directo e informe de Adm. Torneo |
| Informe del torneo | `js/results_report.js` | `loadResultsWorkspace()` | Visor directo e impresión de Resultados |
| Hoja de premiados | `js/winners_report.js` | Datos ya cargados por Resultados | Botón Imprimir premiados |
| Grilla para compartir | `js/registration_grid_export.js` | Torneo, bloques, líneas y casilleros | Botón Compartir grilla |
| Actualización de Index | `js/report_view_page.js` | `getAagSyncReport()` | Visor directo de Informes |

`report_view.html` es el visor directo común. Acepta estas rutas:

- `?tipo=pagos&torneo=UUID`
- `?tipo=resultados&torneo=UUID`
- `?tipo=index&id=UUID`

Los generadores de grilla y premiación se importan de forma diferida: no aumentan la carga inicial de Inscripciones o Resultados. Cuando una implementación es reemplazada, se elimina de la pantalla original; no se conserva una copia desactivada.
