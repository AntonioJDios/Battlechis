-- ════════════════════════════════════════════════════════════════════════════
--  RECUPERAR PARTIDAS "HUÉRFANAS"  (BattleChis)
-- ────────────────────────────────────────────────────────────────────────────
--  Contexto: antes del arreglo, las partidas se anclaban al uid del MÓVIL. La
--  función battlechis_claim_profile ya migra las partidas al hacer login con
--  nick+contraseña — así que la MAYORÍA se recuperan solas:
--
--     1) Re-ejecuta supabase/schema.sql (actualiza claim_profile).
--     2) En el otro móvil: Ajustes → iniciar sesión con tu nick + contraseña.
--        Tus partidas viajan contigo y aparecen en "Mis partidas".
--
--  Solo hace falta este fichero para las partidas REALMENTE huérfanas: aquellas
--  cuyo perfil ya se había movido a otro uid ANTES del arreglo (con la función
--  vieja), dejando la partida anclada a un uid antiguo que ya no tiene perfil.
-- ════════════════════════════════════════════════════════════════════════════


-- ── PASO 1 · DIAGNÓSTICO (solo lectura) ─────────────────────────────────────
-- Lista cada asiento humano de cada partida: el nombre que escribió el jugador,
-- su uid guardado, y si ese uid TODAVÍA tiene un perfil (y cuál).
--   · profile_nick con valor  → ese asiento está bien enlazado a un perfil.
--   · profile_nick = NULL      → asiento HUÉRFANO (uid sin perfil): candidato a remap.
select
  g.code,
  g.status,
  g.updated_at,
  s->>'name'   as seat_name,   -- nombre que escribió el jugador al unirse
  s->>'userId' as seat_uid,    -- uid guardado en el asiento
  p.nickname   as profile_nick -- perfil actual de ese uid (NULL = huérfano)
from public.battlechis_games g
     cross join lateral jsonb_array_elements(g.state->'seats') s
     left join public.battlechis_profiles p
            on p.user_id = nullif(s->>'userId','')::uuid
where coalesce(s->>'type','human') = 'human'
  and nullif(s->>'userId','') is not null
order by g.updated_at desc, g.code;


-- ── PASO 2 · REMAP DIRIGIDO (escritura) ─────────────────────────────────────
-- Para CADA partida huérfana que quieras rescatar:
--   1) Copia su seat_uid del diagnóstico  → pégalo en :old_uid (2 sitios).
--   2) Pon el nick del perfil que debe recibirla → :new_nick.
-- Reasigna host_id, member_ids[] y el asiento dentro de state.seats.
-- (Repite el bloque cambiando old_uid/new_nick para cada partida.)

with tgt as (
  select user_id as new_uid
  from public.battlechis_profiles
  where lower(nickname) = lower('NICK_DEL_PERFIL')   -- ← :new_nick
)
update public.battlechis_games g
   set host_id = case when g.host_id = 'OLD_UID_AQUI'::uuid   -- ← :old_uid
                      then (select new_uid from tgt) else g.host_id end,
       member_ids = (select array(select distinct e
                                   from unnest(array_replace(
                                     g.member_ids,
                                     'OLD_UID_AQUI'::uuid,               -- ← :old_uid
                                     (select new_uid from tgt))) e)),
       state = jsonb_set(g.state, '{seats}',
                 (select jsonb_agg(
                           case when s->>'userId' = 'OLD_UID_AQUI'       -- ← :old_uid
                                then jsonb_set(s, '{userId}',
                                       to_jsonb((select new_uid from tgt)::text))
                                else s end)
                    from jsonb_array_elements(g.state->'seats') s))
 where 'OLD_UID_AQUI'::uuid = any(g.member_ids)                          -- ← :old_uid
    or g.host_id = 'OLD_UID_AQUI'::uuid                                  -- ← :old_uid
    or exists (select 1 from jsonb_array_elements(g.state->'seats') s
               where s->>'userId' = 'OLD_UID_AQUI');                     -- ← :old_uid
