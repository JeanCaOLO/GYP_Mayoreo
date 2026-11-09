-- ============================================================================
-- D8 · Publicar los DOS escenarios en una sola transacción
-- ----------------------------------------------------------------------------
-- `publicar-proyeccion` llamaba a `publicar_proyeccion` una vez por escenario,
-- en un bucle. Cada llamada es su propia transacción, así que si la segunda
-- falla la tabla final queda con un escenario NUEVO y otro VIEJO: el proyectado
-- de hoy junto al causado de ayer. Nadie ve un error en Power BI — ve cifras
-- que no cuadran entre sí, que es el modo de fallo caro de este proyecto.
--
-- Esta función recibe los dos y los escribe junta. Si algo falla a mitad, la
-- transacción entera se deshace y la tabla queda COMO ESTABA: publicada la
-- versión anterior, completa y coherente. Es preferible un mes viejo entero a
-- un mes nuevo a medias.
--
-- Reemplaza al bucle, no a `publicar_proyeccion`: esa se conserva para publicar
-- un solo escenario (el botón «anexar solo el causado»).
--
-- IDEMPOTENTE: `create or replace`.
-- ============================================================================

create or replace function publicar_proyeccion_dos_escenarios(
  p_periodo text,
  p_filas_1 jsonb,   -- escenario 1 · Proyectado al cierre
  p_filas_2 jsonb    -- escenario 2 · Causado al corte
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
    raise exception 'publicar_proyeccion_dos_escenarios: p_filas_1 debe ser un arreglo jsonb (recibido: %)',
                    jsonb_typeof(p_filas_1);
  end if;
  if p_filas_2 is null or jsonb_typeof(p_filas_2) <> 'array' then
    raise exception 'publicar_proyeccion_dos_escenarios: p_filas_2 debe ser un arreglo jsonb (recibido: %)',
                    jsonb_typeof(p_filas_2);
  end if;

  -- Publicar un escenario vacío dejaría la mitad de la tabla sin filas y con
  -- buena cara. Si el motor no produjo nada, es un error, no una publicación.
  if jsonb_array_length(p_filas_1) = 0 or jsonb_array_length(p_filas_2) = 0 then
    raise exception 'publicar_proyeccion_dos_escenarios: los dos escenarios deben traer filas (1: %, 2: %)',
                    jsonb_array_length(p_filas_1), jsonb_array_length(p_filas_2);
  end if;

  -- Las dos llamadas comparten esta transacción: o entran los dos escenarios,
  -- o no entra ninguno.
  v_1 := publicar_proyeccion(p_periodo, 1::smallint, p_filas_1);
  v_2 := publicar_proyeccion(p_periodo, 2::smallint, p_filas_2);

  return jsonb_build_object('1', v_1, '2', v_2);
end;
$$;

-- Comprobación:
--   select routine_name from information_schema.routines
--    where routine_name = 'publicar_proyeccion_dos_escenarios';
