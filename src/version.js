// ── ÚNICO número de versión de la app ──
// SUBE este número en CADA despliegue que deba avisar de "Actualizar".
// El build genera automáticamente /version.json con este valor (ver vite.config.js);
// la app lo consulta por red (sin caché) y, si es mayor que el build que tienes,
// muestra el botón "🔄 Actualizar" en la portada. NO hay que tocar la base de datos.
export const APP_VERSION = 4;
