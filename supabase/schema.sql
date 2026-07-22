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
