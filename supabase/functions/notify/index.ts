// BattleChis — Edge Function "notify"
// Triggered by a Database Webhook on public.battlechis_games (UPDATE).
// Sends a Web Push to the human who: (a) just got the turn, or (b) is being
// attacked (super-defense / road-crossing prompt aimed at them).
//
// Deploy:  supabase functions deploy notify --no-verify-jwt
// Secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:tu@correo)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@battlechis.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const APP_URL = Deno.env.get('APP_URL') ?? 'https://battlechis.vercel.app';

function seatUserId(seats: any[], faction: number): string | null {
  const s = (seats || []).find((x) => x.faction === faction && x.type === 'human' && x.userId);
  return s ? s.userId : null;
}

async function sendTo(userId: string, payload: Record<string, unknown>) {
  const { data } = await admin.from('battlechis_push').select('subscription').eq('user_id', userId).single();
  if (!data?.subscription) return;
  try {
    await webpush.sendNotification(data.subscription, JSON.stringify(payload));
  } catch (e) {
    // 404/410 → subscription gone; clean it up.
    if (e?.statusCode === 404 || e?.statusCode === 410) {
      await admin.from('battlechis_push').delete().eq('user_id', userId);
    }
  }
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const nw = body.record?.state ?? {};
    const old = body.old_record?.state ?? {};
    const seats = nw.seats ?? [];
    const code = body.record?.code ?? '';
    const url = code ? `${APP_URL}/?join=${code}` : APP_URL;

    const targets: { userId: string; title: string; body: string }[] = [];

    // (a) Turn changed → notify the new current human player.
    if (nw.currentTurn !== old.currentTurn && Array.isArray(nw.players)) {
      const cur = nw.players[nw.currentTurn];
      if (cur && !cur.isBot) {
        const uid = seatUserId(seats, cur.faction);
        if (uid) targets.push({ userId: uid, title: '🎯 ¡Es tu turno!', body: `Te toca mover en BattleChis (${cur.name}).` });
      }
    }

    // (b) Reactive prompts aimed at a human (attack / road-crossing).
    if (nw.defenseState && !old.defenseState) {
      const uid = seatUserId(seats, nw.defenseState.defenderFaction);
      if (uid) targets.push({ userId: uid, title: '🛡️ ¡Te atacan!', body: 'Decide si usas tu Super Defensa.' });
    }
    if (nw.negotiationState && !old.negotiationState) {
      const uid = seatUserId(seats, nw.negotiationState.defenderFaction);
      if (uid) targets.push({ userId: uid, title: '🚧 Cruce en tu territorio', body: '¿Dejas pasar o bloqueas?' });
    }

    await Promise.all(targets.map((t) => sendTo(t.userId, { title: t.title, body: t.body, url, tag: 'battlechis' })));

    return new Response(JSON.stringify({ sent: targets.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
});
