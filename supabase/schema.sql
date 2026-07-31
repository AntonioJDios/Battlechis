-- ============================================================
--  BattleChis (JuegoGonzi) — esquema multijugador para Supabase
--  Ejecuta / RE-EJECUTA este script en:  Dashboard → SQL Editor → New query
--  (es idempotente: puedes lanzarlo las veces que quieras).
--
--  La BD se comparte con otro proyecto: TODO va prefijado "battlechis_"
--  y con RLS activado para quedar aislado.
--
--  REQUISITO PREVIO: activa el login anónimo en
--  Dashboard → Authentication → Providers → Anonymous  (Enable)
-- ============================================================

-- ── Tabla de partidas (hasta 5 jugadores humanos) ──
create table if not exists public.battlechis_games (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,               -- código de invitación (ej. "K7QM2")
  status      text not null default 'waiting',      -- waiting | playing | finished
  host_id     uuid not null default auth.uid(),     -- creador de la partida
  member_ids  uuid[] not null default '{}',         -- todos los humanos presentes
  state       jsonb not null default '{}'::jsonb,    -- estado completo del juego (incl. asientos/seats)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Si la tabla venía de la versión anterior (con guest_id), la migramos:
alter table public.battlechis_games
  add column if not exists member_ids uuid[] not null default '{}';

-- (guest_id ya no se usa; lo dejamos si existe, no molesta)

create index if not exists battlechis_games_code_idx
  on public.battlechis_games (code);

-- Necesario para que los webhooks reciban el estado ANTERIOR completo (old_record),
-- así la Edge Function puede detectar el cambio de turno.
alter table public.battlechis_games replica identity full;

-- ── updated_at automático en cada UPDATE ──
create or replace function public.battlechis_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists battlechis_games_touch on public.battlechis_games;
create trigger battlechis_games_touch
  before update on public.battlechis_games
  for each row execute function public.battlechis_touch_updated_at();

-- ── Row Level Security ──
alter table public.battlechis_games enable row level security;

-- Ver: los miembros ven su partida; y cualquiera autenticado puede ver una
-- partida "waiting" para poder encontrarla por código y unirse.
drop policy if exists battlechis_games_select on public.battlechis_games;
create policy battlechis_games_select
  on public.battlechis_games for select
  to authenticated
  using (
    auth.uid() = any(member_ids)
    or status = 'waiting'
  );

-- Crear: cualquiera autenticado, como host y primer miembro de su partida.
drop policy if exists battlechis_games_insert on public.battlechis_games;
create policy battlechis_games_insert
  on public.battlechis_games for insert
  to authenticated
  with check (
    host_id = auth.uid()
    and auth.uid() = any(member_ids)
  );

-- Actualizar: los miembros; o alguien uniéndose a una partida en espera.
-- Tras el UPDATE, el que actúa debe seguir siendo miembro (evita borrar a otros).
drop policy if exists battlechis_games_update on public.battlechis_games;
create policy battlechis_games_update
  on public.battlechis_games for update
  to authenticated
  using (
    auth.uid() = any(member_ids)
    or status = 'waiting'
  )
  with check (
    auth.uid() = any(member_ids)
  );

-- Borrar: cualquier miembro puede borrar la partida (para tu lista "mis partidas").
drop policy if exists battlechis_games_delete on public.battlechis_games;
create policy battlechis_games_delete
  on public.battlechis_games for delete
  to authenticated
  using (auth.uid() = any(member_ids));

-- ── Realtime: emite los cambios de esta tabla a los clientes suscritos ──
-- (idempotente: ignora el error si la tabla ya está en la publicación)
do $$
begin
  alter publication supabase_realtime add table public.battlechis_games;
exception
  when duplicate_object then null;
end $$;

-- ── Suscripciones de notificaciones push (Web Push), una por dispositivo/usuario ──
create table if not exists public.battlechis_push (
  user_id      uuid primary key,
  subscription jsonb not null,          -- PushSubscription.toJSON()
  updated_at   timestamptz not null default now()
);

alter table public.battlechis_push enable row level security;

-- Cada usuario gestiona (crea/actualiza/borra/lee) SOLO su propia suscripción.
drop policy if exists battlechis_push_all on public.battlechis_push;
create policy battlechis_push_all
  on public.battlechis_push for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- (La Edge Function lee todas las filas con la service_role, que ignora RLS.)

-- ── Limpieza de partidas viejas (para que la tabla no crezca sin fin) ──
-- Borra SOLO terminadas (>1 día) y lobbies en espera abandonados (>2 días).
-- NUNCA borra partidas 'playing' (en curso), por muy paradas que estén.
create or replace function public.battlechis_cleanup()
returns void language sql security definer as $$
  delete from public.battlechis_games
  where (status = 'finished' and updated_at < now() - interval '1 day')
     or (status = 'waiting'  and updated_at < now() - interval '2 days');
$$;

-- Limpieza AUTOMÁTICA diaria (requiere la extensión pg_cron):
--   1) Dashboard → Database → Extensions → habilita "pg_cron".
--   2) Ejecuta UNA vez:
--        select cron.schedule('battlechis-cleanup', '0 4 * * *',
--                             $$ select public.battlechis_cleanup(); $$);
-- (Si no habilitas pg_cron, la app ya borra tus partidas terminadas al abrir "Mis partidas".)

-- ── Perfiles de jugador (apodo + avatar + estadísticas), sin contraseña ──
-- La identidad es el uid anónimo del dispositivo (auth.uid()).
create table if not exists public.battlechis_profiles (
  user_id      uuid primary key,
  nickname     text not null default 'Comandante',
  avatar       text not null default '🎖️',
  games_played int  not null default 0,
  games_won    int  not null default 0,
  updated_at   timestamptz not null default now()
);

alter table public.battlechis_profiles enable row level security;

-- Cualquiera autenticado puede LEER todos los perfiles (para el ranking y ver
-- a los rivales); pero solo puedes crear/editar/borrar EL TUYO.
drop policy if exists battlechis_profiles_read on public.battlechis_profiles;
create policy battlechis_profiles_read
  on public.battlechis_profiles for select
  to authenticated
  using (true);

drop policy if exists battlechis_profiles_write on public.battlechis_profiles;
create policy battlechis_profiles_write
  on public.battlechis_profiles for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Código de amigo (interno / heredado): se rellena desde la app la primera vez.
alter table public.battlechis_profiles add column if not exists friend_code text;
create unique index if not exists battlechis_profiles_friend_code_idx
  on public.battlechis_profiles (friend_code);

-- ── Nombres de perfil ÚNICOS (así se buscan y se añaden entre ellos) ──
-- Quitamos el valor por defecto/obligatorio: cada uno elige su nombre único.
alter table public.battlechis_profiles alter column nickname drop default;
alter table public.battlechis_profiles alter column nickname drop not null;
-- El genérico "Comandante" se libera (esos perfiles re-eligen nombre).
update public.battlechis_profiles set nickname = null where nickname = 'Comandante';
-- Deshacemos posibles colisiones restantes para poder crear el índice único.
with d as (
  select user_id, row_number() over (partition by lower(nickname) order by updated_at, user_id) as rn
  from public.battlechis_profiles where nickname is not null
)
update public.battlechis_profiles p
   set nickname = p.nickname || '_' || substr(replace(p.user_id::text, '-', ''), 1, 4)
  from d where d.user_id = p.user_id and d.rn > 1;
-- Único, sin distinguir mayúsculas, ignorando los sin-nombre (null).
create unique index if not exists battlechis_profiles_nick_uidx
  on public.battlechis_profiles (lower(nickname)) where nickname is not null;

-- ── Amistades (mutuas): fila dirigida A→B; se consideran amigos en ambos sentidos ──
create table if not exists public.battlechis_friends (
  user_id    uuid not null,        -- quien añadió
  friend_id  uuid not null,        -- a quién
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

-- Estado de la amistad: 'pending' (solicitud enviada) | 'accepted'.
-- Las filas antiguas se quedan como 'accepted' (ya erais amigos).
alter table public.battlechis_friends add column if not exists status text not null default 'accepted';

alter table public.battlechis_friends enable row level security;

-- Ves las amistades/solicitudes en las que participas.
drop policy if exists battlechis_friends_select on public.battlechis_friends;
create policy battlechis_friends_select
  on public.battlechis_friends for select
  to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

-- Solo creas solicitudes donde TÚ eres quien envía.
drop policy if exists battlechis_friends_insert on public.battlechis_friends;
create policy battlechis_friends_insert
  on public.battlechis_friends for insert
  to authenticated
  with check (user_id = auth.uid());

-- El destinatario puede actualizar (aceptar) la solicitud dirigida a él.
drop policy if exists battlechis_friends_update on public.battlechis_friends;
create policy battlechis_friends_update
  on public.battlechis_friends for update
  to authenticated
  using (friend_id = auth.uid())
  with check (friend_id = auth.uid());

-- Puedes borrar cualquier amistad/solicitud en la que participes.
drop policy if exists battlechis_friends_delete on public.battlechis_friends;
create policy battlechis_friends_delete
  on public.battlechis_friends for delete
  to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

-- ── Invitaciones a partida (dentro de la app, sin enlaces) ──
create table if not exists public.battlechis_game_invites (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null,
  code       text not null,          -- código de la partida (para unirse)
  from_user  uuid not null,          -- anfitrión que invita
  to_user    uuid not null,          -- perfil invitado
  created_at timestamptz not null default now(),
  unique (game_id, to_user)
);

alter table public.battlechis_game_invites enable row level security;

drop policy if exists battlechis_game_invites_select on public.battlechis_game_invites;
create policy battlechis_game_invites_select
  on public.battlechis_game_invites for select
  to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

drop policy if exists battlechis_game_invites_insert on public.battlechis_game_invites;
create policy battlechis_game_invites_insert
  on public.battlechis_game_invites for insert
  to authenticated
  with check (from_user = auth.uid());

drop policy if exists battlechis_game_invites_delete on public.battlechis_game_invites;
create policy battlechis_game_invites_delete
  on public.battlechis_game_invites for delete
  to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

-- Registrar el resultado de una partida para el usuario que llama (suma 1 a
-- jugadas, y 1 a ganadas si `won`). Atómico y respeta RLS (security invoker).
create or replace function public.battlechis_record_result(won boolean)
returns void language sql security invoker as $$
  insert into public.battlechis_profiles (user_id, games_played, games_won)
  values (auth.uid(), 1, case when won then 1 else 0 end)
  on conflict (user_id) do update
    set games_played = public.battlechis_profiles.games_played + 1,
        games_won    = public.battlechis_profiles.games_won + case when won then 1 else 0 end,
        updated_at   = now();
$$;

-- ── Contraseña opcional por perfil (para usarlo en otro dispositivo) ──
-- Sin correos ni recuperación: nombre + contraseña. Hash bcrypt (pgcrypto).
create extension if not exists pgcrypto;
alter table public.battlechis_profiles add column if not exists pass_hash    text;
alter table public.battlechis_profiles add column if not exists has_password boolean not null default false;

-- El hash NO debe poder leerse desde el cliente (los perfiles son legibles por
-- todos para búsqueda/ranking). Restringimos las columnas visibles.
revoke select on public.battlechis_profiles from anon, authenticated;
grant  select (user_id, nickname, avatar, games_played, games_won, updated_at, friend_code, has_password)
  on public.battlechis_profiles to anon, authenticated;

-- Poner/cambiar la contraseña de MI perfil.
create or replace function public.battlechis_set_password(p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'NO_AUTH'; end if;
  if length(coalesce(p_password, '')) < 3 then raise exception 'SHORT'; end if;
  update public.battlechis_profiles
     set pass_hash = crypt(p_password, gen_salt('bf')), has_password = true, updated_at = now()
   where user_id = auth.uid();
end;
$$;
grant execute on function public.battlechis_set_password(text) to authenticated;

-- Reclamar/usar un perfil en ESTE dispositivo con nombre + contraseña.
-- Traspasa el perfil (y sus amistades/invitaciones) a la identidad que llama.
create or replace function public.battlechis_claim_profile(p_name text, p_password text)
returns table(nickname text, avatar text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_caller uuid := auth.uid();
  v_src    uuid;
begin
  if v_caller is null then raise exception 'NO_AUTH'; end if;
  -- Alias the table: an unqualified `nickname` would clash with the RETURNS
  -- TABLE output column of the same name ("nickname is ambiguous").
  select pr.user_id into v_src from public.battlechis_profiles pr
    where lower(pr.nickname) = lower(p_name) and pr.pass_hash is not null and pr.pass_hash = crypt(p_password, pr.pass_hash);
  if v_src is null then raise exception 'INVALID'; end if;
  if v_src <> v_caller then
    -- Suelta el perfil (vacío) de la identidad actual para poder adoptar el otro.
    -- (La suscripción push de este dispositivo se conserva: sigue siendo válida.)
    delete from public.battlechis_friends      where user_id = v_caller or friend_id = v_caller;
    delete from public.battlechis_game_invites where from_user = v_caller or to_user = v_caller;
    delete from public.battlechis_profiles     where user_id = v_caller;
    -- Reasigna el perfil de origen (y sus relaciones) a la identidad actual.
    update public.battlechis_profiles     set user_id  = v_caller where user_id  = v_src;
    update public.battlechis_friends      set user_id  = v_caller where user_id  = v_src;
    update public.battlechis_friends      set friend_id = v_caller where friend_id = v_src;
    update public.battlechis_game_invites set from_user = v_caller where from_user = v_src;
    update public.battlechis_game_invites set to_user   = v_caller where to_user   = v_src;
    -- Reasigna también las PARTIDAS: las partidas pertenecen al USUARIO, no al
    -- móvil. Migramos el creador (host_id), la lista de miembros (member_ids) y
    -- el uid guardado en cada asiento (state.seats[].userId), para que puedas
    -- recuperar tus partidas al entrar con tu perfil desde otro dispositivo.
    update public.battlechis_games
       set host_id    = case when host_id = v_src then v_caller else host_id end,
           member_ids = (select array(select distinct e
                                        from unnest(array_replace(member_ids, v_src, v_caller)) as e))
     where v_src = any(member_ids) or host_id = v_src;
    update public.battlechis_games g
       set state = jsonb_set(
             g.state, '{seats}',
             (select jsonb_agg(
                       case when seat->>'userId' = v_src::text
                            then jsonb_set(seat, '{userId}', to_jsonb(v_caller::text))
                            else seat end)
                from jsonb_array_elements(g.state->'seats') as seat))
     where g.state ? 'seats'
       and exists (select 1 from jsonb_array_elements(g.state->'seats') s
                   where s->>'userId' = v_src::text);
  end if;
  return query select p.nickname, p.avatar from public.battlechis_profiles p where p.user_id = v_caller;
end;
$$;
grant execute on function public.battlechis_claim_profile(text, text) to authenticated;

-- ── Config global (p. ej. versión de la app) ──
-- Todos pueden LEERla; solo el admin la cambia desde el SQL Editor (sin policy de
-- escritura). Para avisar de una actualización: sube el número aquí y en src/version.js.
create table if not exists public.battlechis_config (
  key   text primary key,
  value text not null
);
alter table public.battlechis_config enable row level security;
drop policy if exists battlechis_config_read on public.battlechis_config;
create policy battlechis_config_read
  on public.battlechis_config for select
  to anon, authenticated
  using (true);
insert into public.battlechis_config (key, value) values ('app_version', '1')
  on conflict (key) do nothing;
-- Para forzar el aviso de "Actualizar" a todos:
--   update public.battlechis_config set value = '2' where key = 'app_version';


-- ════════════════════════════════════════════════════════════════════════════
--  IDENTIDAD POR CUENTA (multi-dispositivo)
--  Antes: la identidad era el uid anónimo del móvil, e "iniciar sesión" MOVÍA el
--  perfil de un uid a otro (un móvil a la vez). Ahora cada cuenta tiene un
--  account_id ESTABLE; un móvil se VINCULA a la cuenta al iniciar sesión (varios
--  móviles a la vez), y las partidas/asientos pertenecen a la CUENTA.
--  Todo es ADITIVO y compatible: se conservan user_id / host_id / member_ids /
--  seats.userId, así las partidas en curso siguen funcionando sin recargar.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) account_id estable en cada perfil (= la cuenta). Se genera una vez y no cambia.
alter table public.battlechis_profiles add column if not exists account_id uuid;
update public.battlechis_profiles set account_id = gen_random_uuid() where account_id is null;
alter table public.battlechis_profiles alter column account_id set default gen_random_uuid();
alter table public.battlechis_profiles alter column account_id set not null;
create unique index if not exists battlechis_profiles_account_uidx
  on public.battlechis_profiles (account_id);
grant select (account_id) on public.battlechis_profiles to anon, authenticated;

-- 2) Vínculos móvil→cuenta. Cada dispositivo (uid) apunta a UNA cuenta; una
--    cuenta puede tener VARIOS dispositivos vinculados a la vez.
create table if not exists public.battlechis_account_devices (
  device_uid uuid primary key,
  account_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.battlechis_account_devices enable row level security;
drop policy if exists battlechis_account_devices_self on public.battlechis_account_devices;
create policy battlechis_account_devices_self
  on public.battlechis_account_devices for select
  to authenticated using (device_uid = auth.uid());
-- (Las escrituras van por funciones security definer; no hace falta policy de insert.)

-- Sembrar vínculos para los perfiles ya existentes (cada uid → su cuenta).
insert into public.battlechis_account_devices (device_uid, account_id)
  select user_id, account_id from public.battlechis_profiles
  on conflict (device_uid) do nothing;

-- 3) Resolver: ¿qué cuenta es este dispositivo? Prioriza el vínculo; si no, el
--    perfil propio del uid; null si es anónimo sin cuenta.
create or replace function public.battlechis_my_account_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select d.account_id from public.battlechis_account_devices d where d.device_uid = auth.uid()),
    (select p.account_id from public.battlechis_profiles p where p.user_id = auth.uid())
  );
$$;
grant execute on function public.battlechis_my_account_id() to authenticated;

-- Datos de MI cuenta (perfil + account_id) para el cliente en una sola llamada.
create or replace function public.battlechis_my_account()
returns table(account_id uuid, nickname text, avatar text, has_password boolean, friend_code text)
language sql stable security definer set search_path = public as $$
  select p.account_id, p.nickname, p.avatar, p.has_password, p.friend_code
  from public.battlechis_profiles p
  where p.account_id = public.battlechis_my_account_id();
$$;
grant execute on function public.battlechis_my_account() to authenticated;

-- Adjunta a la cuenta las partidas en las que YA está este dispositivo, para que
-- cualquier móvil vinculado las vea. Aditivo: conserva el uid en cada asiento.
create or replace function public.battlechis_attach_games(p_dev uuid, p_account uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.battlechis_games
     set member_accounts = (select array(select distinct e
                              from unnest(coalesce(member_accounts,'{}') || array[p_account]) e))
   where p_dev = any(member_ids);
  update public.battlechis_games
     set host_account = p_account
   where host_id = p_dev and host_account is null;
  update public.battlechis_games g
     set state = jsonb_set(g.state, '{seats}', (
       select jsonb_agg(case when seat->>'userId' = p_dev::text
                             then jsonb_set(seat, '{accountId}', to_jsonb(p_account::text))
                             else seat end)
       from jsonb_array_elements(g.state->'seats') seat))
   where g.state ? 'seats'
     and exists (select 1 from jsonb_array_elements(g.state->'seats') s where s->>'userId' = p_dev::text);
end;
$$;

-- 4) Crear/editar MI cuenta (nombre único + avatar). Si no tengo cuenta la crea y
--    vincula este dispositivo; si ya tengo, la actualiza.
create or replace function public.battlechis_save_account(p_name text, p_avatar text)
returns table(account_id uuid, nickname text, avatar text, friend_code text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_dev  uuid := auth.uid();
  v_acc  uuid := public.battlechis_my_account_id();
  v_name text := btrim(p_name);
  v_av   text := coalesce(nullif(btrim(p_avatar), ''), '🎖️');
begin
  if v_dev is null then raise exception 'NO_AUTH'; end if;
  if length(v_name) < 2 then raise exception 'SHORT_NAME'; end if;
  -- ¿nombre libre (o ya mío)?
  if exists (select 1 from public.battlechis_profiles p
             where lower(p.nickname) = lower(v_name)
               and (v_acc is null or p.account_id <> v_acc)) then
    raise exception 'TAKEN';
  end if;
  if v_acc is null then
    -- Cuenta nueva: genera friend_code único (reintenta ante choque raro).
    loop
      begin
        insert into public.battlechis_profiles (user_id, account_id, nickname, avatar, friend_code)
          values (v_dev, gen_random_uuid(), v_name, v_av,
                  upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)))
          returning battlechis_profiles.account_id into v_acc;   -- cualificado: evita chocar con la col de salida
        exit;
      exception when unique_violation then
        if exists (select 1 from public.battlechis_profiles p where lower(p.nickname) = lower(v_name)) then
          raise exception 'TAKEN';   -- carrera de nombre
        end if;
        -- si no, fue el friend_code: reintenta el bucle
      end;
    end loop;
    insert into public.battlechis_account_devices (device_uid, account_id)
      values (v_dev, v_acc)
      on conflict (device_uid) do update set account_id = excluded.account_id;
  else
    update public.battlechis_profiles
       set nickname = v_name, avatar = v_av, updated_at = now()
     where account_id = v_acc;
  end if;
  perform public.battlechis_attach_games(v_dev, v_acc);
  return query select p.account_id, p.nickname, p.avatar, p.friend_code
               from public.battlechis_profiles p where p.account_id = v_acc;
end;
$$;
grant execute on function public.battlechis_save_account(text, text) to authenticated;

-- Iniciar sesión = VINCULAR este dispositivo a una cuenta existente (no la mueve).
create or replace function public.battlechis_link_account(p_name text, p_password text)
returns table(account_id uuid, nickname text, avatar text, friend_code text, has_password boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_dev uuid := auth.uid();
  v_acc uuid;
begin
  if v_dev is null then raise exception 'NO_AUTH'; end if;
  select p.account_id into v_acc from public.battlechis_profiles p
    where lower(p.nickname) = lower(btrim(p_name))
      and p.pass_hash is not null and p.pass_hash = crypt(p_password, p.pass_hash);
  if v_acc is null then raise exception 'INVALID'; end if;
  insert into public.battlechis_account_devices (device_uid, account_id)
    values (v_dev, v_acc)
    on conflict (device_uid) do update set account_id = excluded.account_id;
  perform public.battlechis_attach_games(v_dev, v_acc);
  return query select p.account_id, p.nickname, p.avatar, p.friend_code, p.has_password
               from public.battlechis_profiles p where p.account_id = v_acc;
end;
$$;
grant execute on function public.battlechis_link_account(text, text) to authenticated;

-- La contraseña se pone/cambia en la CUENTA (afecta a todos sus dispositivos).
create or replace function public.battlechis_set_password(p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_acc uuid := public.battlechis_my_account_id();
begin
  if auth.uid() is null then raise exception 'NO_AUTH'; end if;
  if v_acc is null then raise exception 'NO_ACCOUNT'; end if;
  if length(coalesce(p_password, '')) < 3 then raise exception 'SHORT'; end if;
  update public.battlechis_profiles
     set pass_hash = crypt(p_password, gen_salt('bf')), has_password = true, updated_at = now()
   where account_id = v_acc;
end;
$$;

-- El resultado de la partida se suma a la CUENTA (por account_id).
create or replace function public.battlechis_record_result(won boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_acc uuid := public.battlechis_my_account_id();
begin
  if v_acc is null then return; end if;   -- anónimo sin cuenta: no se registra
  update public.battlechis_profiles
     set games_played = games_played + 1,
         games_won    = games_won + case when won then 1 else 0 end,
         updated_at   = now()
   where account_id = v_acc;
end;
$$;

-- 5) Partidas por CUENTA (aditivo; se conservan host_id / member_ids / seats.userId).
alter table public.battlechis_games add column if not exists member_accounts uuid[] not null default '{}';
alter table public.battlechis_games add column if not exists host_account uuid;

-- Backfill: mapear los uids ya presentes a sus cuentas.
update public.battlechis_games g
   set host_account = (select p.account_id from public.battlechis_profiles p where p.user_id = g.host_id)
 where g.host_account is null;
update public.battlechis_games g
   set member_accounts = coalesce((
        select array_agg(distinct p.account_id)
        from unnest(g.member_ids) mid
        join public.battlechis_profiles p on p.user_id = mid), '{}'::uuid[])
 where cardinality(g.member_accounts) = 0;
update public.battlechis_games g
   set state = jsonb_set(g.state, '{seats}', (
        select jsonb_agg(
          case when nullif(seat->>'userId', '') is not null
                    and (select p.account_id from public.battlechis_profiles p
                         where p.user_id = (seat->>'userId')::uuid) is not null
               then jsonb_set(seat, '{accountId}',
                      to_jsonb((select p.account_id from public.battlechis_profiles p
                                where p.user_id = (seat->>'userId')::uuid)::text))
               else seat end)
        from jsonb_array_elements(g.state->'seats') seat))
 where g.state ? 'seats'
   and jsonb_typeof(g.state->'seats') = 'array'
   and jsonb_array_length(g.state->'seats') > 0;

-- RLS re-declarada: acceso por uid (compatibilidad) O por cuenta (nuevo).
drop policy if exists battlechis_games_select on public.battlechis_games;
create policy battlechis_games_select on public.battlechis_games for select to authenticated
  using (auth.uid() = any(member_ids) or status = 'waiting'
         or public.battlechis_my_account_id() = any(member_accounts));
drop policy if exists battlechis_games_update on public.battlechis_games;
create policy battlechis_games_update on public.battlechis_games for update to authenticated
  using (auth.uid() = any(member_ids) or status = 'waiting'
         or public.battlechis_my_account_id() = any(member_accounts))
  with check (auth.uid() = any(member_ids)
              or public.battlechis_my_account_id() = any(member_accounts));
drop policy if exists battlechis_games_delete on public.battlechis_games;
create policy battlechis_games_delete on public.battlechis_games for delete to authenticated
  using (auth.uid() = any(member_ids)
         or public.battlechis_my_account_id() = any(member_accounts));
