# 🔔 Notificaciones push (Web Push) — pasos de configuración

El código ya está listo. Falta configurar las claves y la función en Supabase/Vercel.
Todo es **gratis**. Hazlo una sola vez.

> **iPhone:** el push solo funciona con la **PWA instalada** (Safari → Añadir a pantalla de inicio) y iOS 16.4+. En Android/escritorio funciona sin más.

---

## 1) Generar las claves VAPID
En una terminal (en la carpeta del proyecto):

```bash
npx web-push generate-vapid-keys
```

Te da dos claves: **Public Key** y **Private Key**. Guárdalas.

## 2) Clave pública → frontend (Vercel)
- Vercel → proyecto **battlechis** → **Settings → Environment Variables** → añade:
  - `VITE_VAPID_PUBLIC_KEY` = *(la Public Key)*
- **Redeploy** (Deployments → ⋯ → Redeploy) para que se incluya en el bundle.
- (Local, opcional) pon lo mismo en `.env.local`.

## 3) Crear la tabla de suscripciones
- Supabase → **SQL Editor** → re-ejecuta **`supabase/schema.sql`** (añade `battlechis_push` + `replica identity full`).

## 4) Desplegar la Edge Function `notify`  (⚠️ SIN webhook — el juego la llama solo)

**Opción A (Dashboard, sin CLI, recomendada):**
- Supabase → **Edge Functions** → **Deploy a new function** → nómbrala **`notify`**.
- Pega el contenido de `supabase/functions/notify/index.ts` → **Deploy**.
- En **Edge Functions → Secrets** (o Project Settings → Edge Functions) añade:
  - `VAPID_PUBLIC_KEY` = *(Public Key)*
  - `VAPID_PRIVATE_KEY` = *(Private Key)* ← privada, SOLO aquí
  - `VAPID_SUBJECT` = `mailto:tucorreo@ejemplo.com`
  - `APP_URL` = `https://battlechis.vercel.app`

**Opción B (CLI):**
```bash
npx supabase login
npx supabase link --project-ref ouvnsnfldwnyqqcebpbp
npx supabase secrets set VAPID_PUBLIC_KEY="<pub>" VAPID_PRIVATE_KEY="<priv>" VAPID_SUBJECT="mailto:tucorreo" APP_URL="https://battlechis.vercel.app"
npx supabase functions deploy notify
```

## 5) (Ya NO hace falta webhook)
El propio juego llama a la función `notify` justo después de cada jugada (cuando
cambia el turno o hay un ataque). No tienes que crear ningún Database Webhook.

---

## Probar
1. Abre la web (en móvil, la **PWA instalada** en iPhone) → portada → **🔔 ACTIVAR AVISOS** → acepta el permiso.
2. Empieza una partida online con otro dispositivo.
3. Cierra/minimiza la app en un dispositivo y haz que le toque el turno desde el otro.
4. Debería llegarte la notificación **🎯 ¡Es tu turno!** aunque tengas la app cerrada.

Si no llega: revisa que el permiso esté concedido, que `VITE_VAPID_PUBLIC_KEY`
esté en Vercel (y redeployado), que los secretos de la función coincidan, y los
logs de la función en Supabase (**Edge Functions → notify → Logs**).
