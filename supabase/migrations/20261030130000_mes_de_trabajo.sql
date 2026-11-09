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

-- La fila única, sin pisar la que ya exista. El valor inicial sale del periodo
-- más reciente que haya en la historia; si no hay historia, del mes en curso.
insert into proyeccion_config (id, periodo_trabajo)
select 1,
       coalesce(
         (select max(periodo) from gyp_historico_mensual),
         to_char(now() at time zone 'America/Caracas', 'YYYY-MM')
       )
 where not exists (select 1 from proyeccion_config where id = 1);

-- Comprobación:
--   select * from proyeccion_config;
