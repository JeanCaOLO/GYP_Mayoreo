-- ============================================================================
-- Corrida programada que se dispara sola, mes de trabajo guardado y sello real
-- de la extracción de Fabric.
-- ----------------------------------------------------------------------------
-- Reemplaza el job de 20261028120000_cron_corrida_programada.sql. Al 28 oct la
-- bitácora no tenía NINGUNA corrida con lanzada_por = 'pg_cron': el job no
-- existía o su llamada no llegaba a la función (secreto ausente en Vault o
-- rechazado por verify_jwt). Este script deja cada intento registrado en
-- `proyeccion_tick`, así que la próxima vez se ve el motivo sin adivinar.
--
-- ANTES DE CORRERLO, una sola vez, en el SQL Editor (nunca en el repositorio):
--
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'gyp_cron_key');
--
-- La clave es la service_role JWT («eyJ…», Dashboard → Project Settings → API
-- → Legacy API keys). Una clave nueva «sb_secret_…» NO es un JWT y verify_jwt
-- la rechaza con 401. Para cambiarla después:
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'gyp_cron_key'), '<NUEVA_KEY>');
--
-- IDEMPOTENTE: puede correrse varias veces.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. Bitácora de ticks: una fila por cada vez que el planificador (o el botón)
--    llama a corrida-programada, con lo que decidió y por qué.
-- ---------------------------------------------------------------------------
create table if not exists proyeccion_tick (
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  origen      text    not null default 'programada',   -- programada|manual
  estado      text    not null default 'enviado',      -- enviado|ejecutada|omitida|error
  periodo     text,
  motivo      text,
  filas       integer,
  duracion_ms integer,
  request_id  bigint,                                  -- net.http_post (pg_net)
  fin         timestamptz
);
create index if not exists ix_tick_ts on proyeccion_tick (ts desc);

-- ---------------------------------------------------------------------------
-- 2. Una sola corrida de cálculo/publicación en curso a la vez (no solaparse).
--    La función intenta insertar su fila `en_curso`; si ya hay otra, el índice
--    lo rechaza y la nueva se omite. Antes se cierran las colgadas.
-- ---------------------------------------------------------------------------
update proyeccion_corrida
   set estado = 'error', fin = now(),
       mensaje = coalesce(mensaje || ' ', '') || 'quedó en curso; se da por caída.'
 where estado = 'en_curso'
   and paso in ('calculo', 'publicacion');

create unique index if not exists ux_corrida_una_en_curso
  on proyeccion_corrida ((true))
  where estado = 'en_curso' and paso in ('calculo', 'publicacion');

-- ---------------------------------------------------------------------------
-- 3. Mes de trabajo: elección guardada y compartida (fila única id = 1). No
--    cambia con el calendario: el 1 de noviembre sigue en octubre hasta que
--    alguien elija noviembre en la pantalla.
-- ---------------------------------------------------------------------------
create table if not exists proyeccion_mes_trabajo (
  id              smallint primary key default 1 check (id = 1),
  periodo         text    not null check (periodo ~ '^\d{4}-\d{2}$'),
  actualizado_por text,
  actualizado_en  timestamptz not null default now()
);
insert into proyeccion_mes_trabajo (id, periodo)
values (1, to_char(now() at time zone 'America/Caracas', 'YYYY-MM'))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Sello de la extracción: cuándo escribió Fabric por última vez cada mes.
--    Lo pone un trigger sobre gyp_historico_mensual (solo Fabric escribe ahí),
--    así no depende de la versión del notebook ni de un campo que éste olvide.
-- ---------------------------------------------------------------------------
create table if not exists gyp_extraccion_sello (
  periodo    text primary key,
  escrito_en timestamptz not null default now()
);

create or replace function gyp_sellar_extraccion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into gyp_extraccion_sello (periodo, escrito_en)
  select distinct periodo, now() from nuevas
  on conflict (periodo) do update set escrito_en = excluded.escrito_en;
  return null;
end $$;

drop trigger if exists tr_sello_extraccion_ins on gyp_historico_mensual;
create trigger tr_sello_extraccion_ins
  after insert on gyp_historico_mensual
  referencing new table as nuevas
  for each statement execute function gyp_sellar_extraccion();

drop trigger if exists tr_sello_extraccion_upd on gyp_historico_mensual;
create trigger tr_sello_extraccion_upd
  after update on gyp_historico_mensual
  referencing new table as nuevas
  for each statement execute function gyp_sellar_extraccion();

-- Con el sello ya fiable, el guardia de datos frescos queda activo por defecto
-- para configuraciones nuevas. La fila existente NO se toca: marcar la casilla
-- antes de que Fabric escriba al menos una vez con este trigger omitiría todas
-- las corridas (ver el paso final al pie).
alter table proyeccion_programacion alter column exige_datos_frescos set default true;

-- ---------------------------------------------------------------------------
-- 5. Disparador: registra el tick y llama a la Edge Function con la clave de
--    Vault. Si la llamada anterior volvió con error HTTP (401, 500, timeout),
--    lo deja escrito en su tick.
-- ---------------------------------------------------------------------------
create or replace function proyeccion_disparar_corrida()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tick bigint;
  v_key  text;
  v_req  bigint;
begin
  -- Llamadas previas que no llegaron a la función o reventaron dentro.
  update proyeccion_tick t
     set estado = 'error',
         fin    = coalesce(t.fin, r.created),
         motivo = 'La llamada HTTP falló: '
                  || case when r.timed_out then 'timeout'
                          else coalesce('HTTP ' || r.status_code, 'sin respuesta') end
                  || coalesce(' · ' || r.error_msg, '')
                  || coalesce(' · ' || left(r.content, 300), '')
    from net._http_response r
   where r.id = t.request_id
     and t.estado = 'enviado'
     and (r.timed_out or r.status_code is null or r.status_code >= 300);

  delete from proyeccion_tick where ts < now() - interval '30 days';

  insert into proyeccion_tick (origen, estado) values ('programada', 'enviado')
  returning id into v_tick;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'gyp_cron_key';
  if coalesce(v_key, '') = '' then
    update proyeccion_tick
       set estado = 'error', fin = now(),
           motivo = 'Falta el secreto gyp_cron_key en Vault: la función no se llamó.'
     where id = v_tick;
    return v_tick;
  end if;

  select net.http_post(
           url     := 'https://laiiyfjxfvilupiccosf.supabase.co/functions/v1/corrida-programada',
           headers := jsonb_build_object(
                        'Content-Type',  'application/json',
                        'Authorization', 'Bearer ' || v_key,
                        'apikey',        v_key),
           body    := jsonb_build_object('tick_id', v_tick),
           timeout_milliseconds := 120000)
    into v_req;

  update proyeccion_tick set request_id = v_req where id = v_tick;
  return v_tick;
end $$;

revoke all on function proyeccion_disparar_corrida() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Job de pg_cron: cada 5 minutos (UTC). La función decide si ya toca en hora
--    de Caracas, así que cambiar la hora en la pantalla no exige tocar el job.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'corrida-programada-gyp') then
    perform cron.unschedule('corrida-programada-gyp');
  end if;
end $$;

select cron.schedule(
  'corrida-programada-gyp',
  '*/5 * * * *',
  $job$ select public.proyeccion_disparar_corrida(); $job$
);

-- ============================================================================
-- Comprobaciones (a los 5-10 minutos de correrlo):
--
--   select jobname, schedule, active from cron.job where jobname = 'corrida-programada-gyp';
--   select ts, origen, estado, periodo, motivo from proyeccion_tick order by ts desc limit 10;
--
-- Lo esperado antes de la hora: estado 'omitida', motivo «aún no son las 06:50…».
-- 'error' con «HTTP 401» = la clave de Vault no es la service_role JWT.
--
-- PASO FINAL, cuando gyp_extraccion_sello muestre la escritura de hoy de Fabric
-- (select * from gyp_extraccion_sello order by escrito_en desc;):
--
--   update proyeccion_programacion set exige_datos_frescos = true, rev = rev + 1 where id = 1;
-- ============================================================================
