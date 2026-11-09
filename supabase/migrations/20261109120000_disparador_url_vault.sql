-- ============================================================================
-- El disparador del cron saca la URL de la función del Vault
-- ----------------------------------------------------------------------------
-- Reemplaza solo `proyeccion_disparar_corrida()` de
-- 20261030120000_disparador_mes_trabajo_sello.sql. El job de pg_cron, la
-- bitácora `proyeccion_tick` y todo lo demás quedan como están.
--
-- Antes la URL de productivo iba escrita a mano: aplicada en QA, el cron de QA
-- llamaba a la función de PRODUCTIVO (que trabaja contra SU base). Ahora cada
-- proyecto llama a SU función, la que diga su Vault. Si el secreto falta, la
-- función no se llama y el tick queda en 'error' con el motivo.
--
-- ANTES DE CORRERLO, una sola vez, en el SQL Editor del proyecto:
--
--   select vault.create_secret('https://laiiyfjxfvilupiccosf.supabase.co',
--                              'gyp_functions_url');      -- productivo
--   -- QA: 'https://lhswzvjeuegmnonbemza.supabase.co'
--
-- (`gyp_cron_key` ya existe en productivo; no hay que tocarlo.)
--
-- NO CORRER 20261028120000_cron_corrida_programada.sql en productivo: ese
-- archivo reprograma el job SIN bitácora y quedó superado por éste.
--
-- IDEMPOTENTE: `create or replace`.
-- ============================================================================

create or replace function proyeccion_disparar_corrida()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tick bigint;
  v_key  text;
  v_url  text;
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
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'gyp_functions_url';

  if coalesce(v_key, '') = '' or coalesce(v_url, '') = '' then
    update proyeccion_tick
       set estado = 'error', fin = now(),
           motivo = 'Falta el secreto '
                    || case when coalesce(v_key, '') = '' then 'gyp_cron_key' else 'gyp_functions_url' end
                    || ' en Vault: la función no se llamó.'
     where id = v_tick;
    return v_tick;
  end if;

  select net.http_post(
           url     := rtrim(v_url, '/') || '/functions/v1/corrida-programada',
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

-- Comprobación (a los 5-10 minutos):
--   select ts, estado, motivo from proyeccion_tick order by ts desc limit 5;
-- 'omitida · fuera_de_horario' = todo bien. 'error · Falta el secreto…' = falta
-- crear gyp_functions_url.
