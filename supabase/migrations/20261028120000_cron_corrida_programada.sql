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
-- Y la URL DE ESTE MISMO proyecto, que es la que el job va a llamar:
--
--   select vault.create_secret('https://<ref-del-proyecto>.supabase.co',
--                              'gyp_functions_url');
--
--   -- QA:         https://lhswzvjeuegmnonbemza.supabase.co
--   -- Productivo: https://laiiyfjxfvilupiccosf.supabase.co
--
-- Las dos salen del Vault a propósito: así este archivo sirve igual en QA y en
-- productivo, y cada base llama a SU función. Con la URL escrita a mano, el
-- cron de QA publicaba sobre productivo.
--
-- Para cambiar cualquiera de las dos después:
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
      -- La URL NO va escrita a mano: sale del Vault del proyecto donde se
      -- aplique esta migración. Un literal haría que el cron de QA llamara a
      -- la función de PRODUCCIÓN, que trabaja contra SU propia base (lee
      -- SUPABASE_URL y SERVICE_ROLE_KEY de su entorno, no los del llamador).
      -- Si el secreto falta, la concatenación da NULL y net.http_post falla
      -- de forma ruidosa: preferible a publicar en el proyecto equivocado.
      url     := (select decrypted_secret
                    from vault.decrypted_secrets
                   where name = 'gyp_functions_url')
                 || '/functions/v1/corrida-programada',
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
