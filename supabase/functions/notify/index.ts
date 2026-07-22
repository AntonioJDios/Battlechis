// BattleChis — Edge Function "notify"
// Sends a Web Push to the human who: (a) just got the turn, or (b) is being
// attacked (super-defense / road-crossing prompt aimed at them).
//
// The game client calls it directly (no webhook needed):
//   supabase.functions.invoke('notify', { body: { notify: { userId, title, body, url } } })
//
// Deploy:  supabase functions deploy notify
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:tu@correo), APP_URL
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@battlechis.app';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://battlechis.vercel.app';

// CORS — the browser sends a preflight OPTIONS before the POST; without these
// headers it blocks the request ("No 'Access-Control-Allow-Origin' header").
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

let vapidReady = false;
let vapidError = '';
try {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    vapidError = 'Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets';
  } else {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    vapidReady = true;
    console.log(`[notify] VAPID ready. subject=${VAPID_SUBJECT} pub=${VAPID_PUBLIC.slice(0, 8)}… app=${APP_URL}`);
  }
} catch (e) {
  vapidError = 'setVapidDetails failed: ' + String(e);
  console.error('[notify] ' + vapidError);
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

function seatUserId(seats: any[], faction: number): string | null {
  const s = (seats || []).find((x) => x.faction === faction && x.type === 'human' && x.userId);
  return s ? s.userId : null;
}

// Returns a diagnostic record so we can see, in the logs, exactly what happened.
async function sendTo(userId: string, payload: Record<string, unknown>) {
  const { data, error } = await admin
    .from('battlechis_push').select('subscription').eq('user_id', userId).maybeSingle();
  if (error) {
    console.error(`[notify] DB lookup error for ${userId}: ${error.message}`);
    return { userId, found: false, sent: false, error: 'db:' + error.message };
  }
  if (!data?.subscription) {
    console.log(`[notify] NO subscription stored for user ${userId} → nothing to send.`);
    return { userId, found: false, sent: false };
  }
  try {
    await webpush.sendNotification(data.subscription, JSON.stringify(payload));
    console.log(`[notify] SENT ok to ${userId}.`);
    return { userId, found: true, sent: true };
  } catch (e: any) {
    const status = e?.statusCode;
    console.error(`[notify] send FAILED to ${userId}: status=${status} body=${e?.body ?? ''} msg=${String(e)}`);
    // 404/410 → subscription gone; clean it up.
    if (status === 404 || status === 410) {
      await admin.from('battlechis_push').delete().eq('user_id', userId);
    }
    return { userId, found: true, sent: false, status, error: String(e?.body ?? e) };
  }
}

Deno.serve(async (req) => {
  // CORS preflight — must return the headers or the browser blocks the POST.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    if (!vapidReady) {
      console.error('[notify] not ready: ' + vapidError);
      return json({ error: vapidError });
    }
    const body = await req.json();

    // Direct invoke from the game client (no webhook needed):
    //   { notify: { userId, title, body, url } }
    if (body?.notify?.userId) {
      const n = body.notify;
      console.log(`[notify] direct invoke → user=${n.userId} title="${n.title}"`);
      const result = await sendTo(n.userId, { title: n.title || 'BattleChis', body: n.body || '', url: n.url || APP_URL, tag: 'battlechis' });
      return json(result);
    }

    // Otherwise: Database Webhook payload (record / old_record).
    const nw = body.record?.state ?? {};
    const old = body.old_record?.state ?? {};
    const seats = nw.seats ?? [];
    const code = body.record?.code ?? '';
    const url = code ? `${APP_URL}/?join=${code}` : APP_URL;

    const targets: { userId: string; title: string; body: string }[] = [];

    if (nw.currentTurn !== old.currentTurn && Array.isArray(nw.players)) {
      const cur = nw.players[nw.currentTurn];
      if (cur && !cur.isBot) {
        const uid = seatUserId(seats, cur.faction);
        if (uid) targets.push({ userId: uid, title: '🎯 ¡Es tu turno!', body: `Te toca mover en BattleChis (${cur.name}).` });
      }
    }
    if (nw.defenseState && !old.defenseState) {
      const uid = seatUserId(seats, nw.defenseState.defenderFaction);
      if (uid) targets.push({ userId: uid, title: '🛡️ ¡Te atacan!', body: 'Decide si usas tu Super Defensa.' });
    }
    if (nw.negotiationState && !old.negotiationState) {
      const uid = seatUserId(seats, nw.negotiationState.defenderFaction);
      if (uid) targets.push({ userId: uid, title: '🚧 Cruce en tu territorio', body: '¿Dejas pasar o bloqueas?' });
    }

    const results = await Promise.all(targets.map((t) => sendTo(t.userId, { title: t.title, body: t.body, url, tag: 'battlechis' })));
    return json({ results });
  } catch (e) {
    console.error('[notify] handler error: ' + String(e));
    return json({ error: String(e) });
  }
});
