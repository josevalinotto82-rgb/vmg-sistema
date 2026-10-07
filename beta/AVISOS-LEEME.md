# Avisos Villa Maria Golf

Esta copia agrega Configuración y herramientas → Avisos a jugadores.

- Título, mensaje y flyer con vista previa y confirmación de envío.
- El flyer se convierte a JPG de hasta 1200 píxeles y 1 MB.
- Solo un administrador activo puede enviar; el servidor verifica su sesión.
- Los avisos quedan en Supabase y los envíos se procesan cada minuto.
- Apertura de inscripción y oficialización generan un aviso por torneo y tipo. No se duplican al reabrir.
- Se envía a los dispositivos registrados con permiso de notificaciones, de usuarios activos.

La función club-notifications, las tablas y la tarea periódica ya se configuraron en el proyecto del club. El archivo SQL es una referencia de instalación, no debe ejecutarse nuevamente sobre este proyecto.

El secreto FIREBASE_SERVICE_ACCOUNT está exclusivamente en Supabase. Esta entrega no incluye credenciales privadas de Firebase ni las claves privadas de impresión QZ del ZIP original. Para actualizar el sistema en uso, conservar sus claves de impresión instaladas localmente.

Prueba pendiente: ejecutar la app Android actualizada para registrar el dispositivo en Supabase; iniciar sesión como administrador en esta copia; enviar un aviso con flyer y comprobar la recepción y el historial. Aún no se ha comprobado el flujo completo con un flyer real.

La oficialización ocurre antes de completar los resultados; el aviso dice Torneo oficializado y enlaza los resultados disponibles, de acuerdo con la elección del club.

iOS y sus notificaciones quedan pendientes de cuenta Apple, firma y configuración APNs.
