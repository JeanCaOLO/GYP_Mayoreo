-- ============================================================================
-- P1 · El mes de trabajo es una ELECCIÓN GUARDADA Y COMPARTIDA
-- ----------------------------------------------------------------------------
-- Antes salía de `PERIODO_DEFAULT = '2026-10'`, una constante escrita a mano en
-- seed.ts, y `elegirMes` solo hacía `setData`: el aviso decía «fijado para
-- todos» y en realidad no se guardaba ni se compartía. Al recargar volvía atrás.
--
-- POR QUÉ UNA TABLA Y NO EL CALENDARIO: el mes de trabajo NO debe avanzar solo
-- cuando cambia el mes. Los primeros días de noviembre se sigue cerrando
-- octubre, y que la pantalla saltara sola a noviembre obligaría a volver atrás
-- a mano cada vez — o peor, a publicar el mes equivocado sin notarlo.
--
-- Fila única id = 1, con bloqueo optimista por `rev`, igual que
-- `proyeccion_programacion`.
--
-- IDEMPOTENTE: se puede correr varias veces.
-- ============================================================================

create table if not exists proyeccion_config (
  id               smallint primary key default 1,
  -- Periodo 'aaaa-mm' sobre el que trabaja TODO el mundo.
  periodo_trabajo  text    not null,
  rev              integer not null default 0,
  actualizado      timestamptz not null default now(),
  actualizado_por  text
);

-- La fila única, sin pisar la que ya exista. El valor inicial es, en orden:
--   1. el mes ya guardado en `proyeccion_mes_trabajo` (productivo lo tiene
--      desde 20261030120000_disparador_mes_trabajo_sello.sql);
--   2. el periodo más reciente de la historia;
--   3. el mes en curso.
-- `proyeccion_mes_trabajo` queda SIN USO desde aquí: la aplicación y la corrida
-- programada leen `proyeccion_config`. No se borra para poder volver atrás.
do $$
declare
  v_guardado text;
begin
  if to_regclass('public.proyeccion_mes_trabajo') is not null then
    execute 'select periodo from proyeccion_mes_trabajo where id = 1' into v_guardado;
  end if;

  insert into proyeccion_config (id, periodo_trabajo)
  select 1,
         coalesce(
           v_guardado,
           (select max(periodo) from gyp_historico_mensual),
           to_char(now() at time zone 'America/Caracas', 'YYYY-MM')
         )
   where not exists (select 1 from proyeccion_config where id = 1);
end $$;

-- Comprobación:
--   select * from proyeccion_config;
