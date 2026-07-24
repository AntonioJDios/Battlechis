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
-- Borra partidas terminadas (>1 día) y partidas abandonadas sin actividad (>7 días).
create or replace function public.battlechis_cleanup()
returns void language sql security definer as $$
  delete from public.battlechis_games
  where (status = 'finished' and updated_at < now() - interval '1 day')
     or (updated_at < now() - interval '7 days');
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
returns void language plpgsql security definer set search_path = public as $$
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
language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_src    uuid;
begin
  if v_caller is null then raise exception 'NO_AUTH'; end if;
  select user_id into v_src from public.battlechis_profiles
    where lower(nickname) = lower(p_name) and pass_hash is not null and pass_hash = crypt(p_password, pass_hash);
  if v_src is null then raise exception 'INVALID'; end if;
  if v_src <> v_caller then
    -- Suelta el perfil (vacío) de la identidad actual para poder adoptar el otro.
    delete from public.battlechis_friends      where user_id = v_caller or friend_id = v_caller;
    delete from public.battlechis_game_invites where from_user = v_caller or to_user = v_caller;
    delete from public.battlechis_push         where user_id = v_caller;
    delete from public.battlechis_profiles     where user_id = v_caller;
    -- Reasigna el perfil de origen (y sus relaciones) a la identidad actual.
    update public.battlechis_profiles     set user_id  = v_caller where user_id  = v_src;
    update public.battlechis_friends      set user_id  = v_caller where user_id  = v_src;
    update public.battlechis_friends      set friend_id = v_caller where friend_id = v_src;
    update public.battlechis_game_invites set from_user = v_caller where from_user = v_src;
    update public.battlechis_game_invites set to_user   = v_caller where to_user   = v_src;
  end if;
  return query select p.nickname, p.avatar from public.battlechis_profiles p where p.user_id = v_caller;
end;
$$;
grant execute on function public.battlechis_claim_profile(text, text) to authenticated;
