-- ============================================================================
-- Actualización programada (CP-56): job de pg_cron para corrida-programada
-- ----------------------------------------------------------------------------
-- pg_cron llama a la Edge Function `corrida-programada` CADA 5 MINUTOS. La
-- función lee `proyeccion_programacion` (activa, frecuencia, hora_local en
-- Caracas) y solo corre cuando toca: con los datos que Fabric dejó en
-- gyp_historico_mensual recalcula proyectado y causado, y publica en
-- proyeccion_resultado → v_proyeccion_final. Cambiar el
-- horario en la pantalla rige sin tocar este job.
--
-- ANTES DE CORRERLO: guardar en Vault la service_role key del proyecto
-- (Dashboard → Project Settings → API → service_role). Nunca en el repositorio:
--
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'gyp_cron_key');
--
-- Para cambiarla después:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'gyp_cron_key'), '<NUEVA_KEY>');
--
-- IDEMPOTENTE: reprograma el job si ya existe.
-- ============================================================================

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
      url     := 'https://laiiyfjxfvilupiccosf.supabase.co/functions/v1/corrida-programada',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || (select decrypted_secret
                                                    from vault.decrypted_secrets
                                                   where name = 'gyp_cron_key')
                 ),
      body    := '{}'::jsonb,
      -- Recálculo + publicación puede tardar; margen amplio.
      timeout_milliseconds := 300000
    );
  $job$
);

-- Comprobaciones:
--   select jobname, schedule, active from cron.job where jobname = 'corrida-programada-gyp';
--   select status, return_message, start_time
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'corrida-programada-gyp')
--    order by start_time desc limit 5;
--   select id, http_status, timed_out, error_msg, left(content, 400)
--     from net._http_response order by id desc limit 5;
--   select paso, estado, inicio, mensaje from proyeccion_corrida order by inicio desc limit 10;
