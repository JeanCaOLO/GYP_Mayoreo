-- ============================================================================
-- Arrastrar las reglas de un periodo al siguiente
-- ----------------------------------------------------------------------------
-- Las reglas se guardan POR PERIODO. Un mes sin reglas no se puede proyectar:
-- el motor no tiene nada que calcular y la pantalla sale vacia. Hasta ahora la
-- unica forma de poblar un mes nuevo era crear las 95 reglas a mano.
--
-- Esto las copia de un periodo a otro. El criterio de negocio es que el mes
-- nuevo ARRANCA con lo mismo que el anterior y el usuario cambia solo lo que
-- quiera, no que empiece en blanco.
--
-- LO QUE NO HACE, A PROPOSITO:
--
--   * No pisa nada. `on conflict do nothing` sobre (periodo, empresa,
--     combinada): si el destino ya tiene una regla para esa cuenta, se queda la
--     del destino. Correrla dos veces no deshace ningun ajuste manual.
--
--   * No copia las eliminadas. Una regla que alguien borro en octubre no debe
--     reaparecer en noviembre.
--
--   * No copia `wid`. Es el identificador de sesion que usa Realtime para
--     ignorar el eco propio; copiarlo haria que el clon pareciera escrito por
--     quien edito la regla original.
--
--   * No avanza el mes de trabajo. Clonar prepara un mes; trabajarlo es otra
--     decision, y se toma en la aplicacion.
--
-- IDEMPOTENTE: `create or replace`, y la copia tampoco duplica.
-- ============================================================================

create or replace function clonar_reglas(
  p_origen  text,
  p_destino text,
  p_autor   text default 'clonar_reglas'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen_total   integer;
  v_destino_antes  integer;
  v_copiadas       integer;
begin
  if p_origen is null or p_destino is null then
    raise exception 'clonar_reglas: hacen falta el periodo origen y el destino';
  end if;
  if p_origen = p_destino then
    raise exception 'clonar_reglas: origen y destino son el mismo periodo (%)', p_origen;
  end if;

  select count(*) into v_origen_total
    from proyeccion_regla
   where periodo = p_origen and not coalesce(eliminada, false);

  -- Un origen vacio casi siempre es un periodo mal escrito. Mejor decirlo que
  -- devolver "0 copiadas" como si hubiera salido bien.
  if v_origen_total = 0 then
    raise exception 'clonar_reglas: el periodo origen % no tiene ninguna regla viva', p_origen;
  end if;

  select count(*) into v_destino_antes
    from proyeccion_regla where periodo = p_destino;

  insert into proyeccion_regla (
    periodo, empresa, concepto, grupo_pl, combinada, centro_costo,
    cuenta_contable, pais, metodo, valor, meses_promedio, activa,
    nombre, detalle, causado, escenarios, nivel, n, destino, formula_id,
    eliminada, rev, actualizado, actualizado_por
  )
  select
    p_destino, empresa, concepto, grupo_pl, combinada, centro_costo,
    cuenta_contable, pais, metodo, valor, meses_promedio, activa,
    nombre, detalle, causado, escenarios, nivel, n, destino, formula_id,
    false, 0, now(), p_autor
  from proyeccion_regla
  where periodo = p_origen and not coalesce(eliminada, false)
  on conflict (periodo, empresa, combinada) do nothing;

  get diagnostics v_copiadas = row_count;

  return jsonb_build_object(
    'origen',          p_origen,
    'destino',         p_destino,
    'origen_total',    v_origen_total,
    'destino_antes',   v_destino_antes,
    'copiadas',        v_copiadas,
    'ya_existian',     v_origen_total - v_copiadas
  );
end;
$$;

-- Comprobacion:
--   select clonar_reglas('2026-10', '2026-09');
--   select periodo, count(*) from proyeccion_regla group by periodo order by 1;
