-- ============================================================================
-- QA · Pasos 0 a 3 en UNA sola pegada
-- ----------------------------------------------------------------------------
-- Para el editor SQL de Supabase, PROYECTO DE QA (lhswzvjeuegmnonbemza).
--
-- Ninguno de estos pasos cambia una sola cifra del P&L: crean una tabla, dos
-- secretos, un job y una función. La parametrización de octubre -- que SÍ mueve
-- las cifras -- va aparte, en su propio archivo, y a propósito.
--
-- Antes de ejecutar: confirmá arriba del editor que el proyecto es el de QA.
-- Las tablas se llaman igual en los dos y un commit en el equivocado no se
-- deshace.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 0 · Los dos secretos del Vault
-- ─────────────────────────────────────────────────────────────────────────────
-- Reemplazá <SERVICE_ROLE_DE_QA> por la clave de Project Settings → API.
-- Es lo ÚNICO que hay que rellenar a mano en todo el archivo.

select vault.create_secret('<SERVICE_ROLE_DE_QA>', 'gyp_cron_key');
select vault.create_secret('https://lhswzvjeuegmnonbemza.supabase.co',
                           'gyp_functions_url');


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1 · proyeccion_config — el mes de trabajo (P1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Mientras no exista, elegir un mes vale solo para esa pantalla y se pierde al
-- recargar. La aplicación lo dice en vez de prometer que se guardó.

create table if not exists proyeccion_config (
  id               smallint primary key default 1,
  periodo_trabajo  text    not null,
  rev              integer not null default 0,
  actualizado      timestamptz not null default now(),
  actualizado_por  text
);

insert into proyeccion_config (id, periodo_trabajo)
select 1,
       coalesce(
         (select max(periodo) from gyp_historico_mensual),
         to_char(now() at time zone 'America/Caracas', 'YYYY-MM')
       )
 where not exists (select 1 from proyeccion_config where id = 1);


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2 · El cron de la corrida programada (CP-56)
-- ─────────────────────────────────────────────────────────────────────────────
-- La URL sale del Vault, NO escrita a mano: con un literal, el cron de QA
-- llamaría a la función de productivo, que trabaja contra SU propia base.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'corrida-programada-gyp') then
    perform cron.unschedule('corrida-programada-gyp');
  end if;
end $$;

select cron.schedule(
  'corrida-programada-gyp',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets
                   where name = 'gyp_functions_url')
                 || '/functions/v1/corrida-programada',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || (select decrypted_secret
                                                    from vault.decrypted_secrets
                                                   where name = 'gyp_cron_key')
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
  $job$
);


-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3 · Publicación atómica de los dos escenarios (D8)
-- ─────────────────────────────────────────────────────────────────────────────
-- Antes se publicaba un escenario por llamada, cada una en su transacción: si
-- fallaba la segunda, la tabla final quedaba con el proyectado de hoy y el
-- causado de ayer. En Power BI eso no se ve como error, se ve como cifras que
-- no cuadran entre sí.

create or replace function publicar_proyeccion_dos_escenarios(
  p_periodo text,
  p_filas_1 jsonb,
  p_filas_2 jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_1 integer;
  v_2 integer;
begin
  if p_filas_1 is null or jsonb_typeof(p_filas_1) <> 'array' then
    raise exception 'p_filas_1 debe ser un arreglo jsonb (recibido: %)', jsonb_typeof(p_filas_1);
  end if;
  if p_filas_2 is null or jsonb_typeof(p_filas_2) <> 'array' then
    raise exception 'p_filas_2 debe ser un arreglo jsonb (recibido: %)', jsonb_typeof(p_filas_2);
  end if;
  -- Publicar un escenario vacío dejaría media tabla sin filas y con buena cara.
  if jsonb_array_length(p_filas_1) = 0 or jsonb_array_length(p_filas_2) = 0 then
    raise exception 'los dos escenarios deben traer filas (1: %, 2: %)',
                    jsonb_array_length(p_filas_1), jsonb_array_length(p_filas_2);
  end if;

  v_1 := publicar_proyeccion(p_periodo, 1::smallint, p_filas_1);
  v_2 := publicar_proyeccion(p_periodo, 2::smallint, p_filas_2);
  return jsonb_build_object('1', v_1, '2', v_2);
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- COMPROBACIONES · todo esto debe devolver algo
-- ─────────────────────────────────────────────────────────────────────────────

-- Los dos secretos (deben salir las DOS filas):
select name from vault.secrets
 where name in ('gyp_cron_key', 'gyp_functions_url');

-- El mes de trabajo (una fila, id = 1):
select * from proyeccion_config;

-- El job (active = true):
select jobname, schedule, active from cron.job
 where jobname = 'corrida-programada-gyp';

-- La función de publicación atómica (una fila):
select routine_name from information_schema.routines
 where routine_name = 'publicar_proyeccion_dos_escenarios';


-- ─────────────────────────────────────────────────────────────────────────────
-- DENTRO DE ~10 MINUTOS · ¿el cron arrancó solo?
-- ─────────────────────────────────────────────────────────────────────────────
-- Esto es lo que nunca ha funcionado, ni en QA ni en productivo. Vale la pena
-- mirarlo con calma.

select status, return_message, start_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'corrida-programada-gyp')
 order by start_time desc limit 5;

select id, http_status, timed_out, error_msg, left(content, 300)
  from net._http_response order by id desc limit 5;

select paso, estado, origen, inicio, mensaje
  from proyeccion_corrida order by inicio desc limit 10;

-- CÓMO LEERLO:
--   Sin ninguna fila con origen='programada'  -> el cron no llegó a invocar la
--       función. Mirá http_status en net._http_response: 401 = la clave del
--       Vault no sirve; sin respuesta = el job no corrió.
--   Con filas en estado 'omitida'             -> sí invocó, y el mensaje dice
--       qué guarda la detuvo (fuera de horario, sin datos, datos viejos…).
--       Eso NO es un fallo: es la función decidiendo bien.
