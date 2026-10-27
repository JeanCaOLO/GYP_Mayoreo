-- ============================================================================
-- Causado en append sobre v_proyeccion_final
-- ----------------------------------------------------------------------------
-- La tabla de salida del causado (escenario 2) se escribe en
-- proyeccion_resultado JUNTO al proyectado (escenario 1); v_proyeccion_final
-- devuelve el append de los dos (Proyeccion = 1 | 2).
--
-- Una base que arrastre una llave única sin `escenario` —p. ej. sobre
-- (periodo, combinada)— rechaza el insert del causado porque cada Combinada ya
-- existe con Proyeccion = 1. Este bloque elimina esas llaves y deja solo
-- ux_proy_resultado (periodo, escenario, combinada).
--
-- IDEMPOTENTE: puede correrse varias veces sin tocar los datos.
-- ============================================================================

alter table proyeccion_resultado
  add column if not exists escenario smallint not null default 1;

-- 1) Restricciones UNIQUE de la tabla que no incluyen `escenario`.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.proyeccion_resultado'::regclass
       and c.contype = 'u'
       and not exists (
         select 1
           from unnest(c.conkey) k
           join pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = k
          where a.attname = 'escenario')
  loop
    execute format('alter table proyeccion_resultado drop constraint %I', r.conname);
    raise notice 'Eliminada restricción única sin escenario: %', r.conname;
  end loop;
end $$;

-- 2) Índices únicos sueltos (no PK) que no incluyen `escenario`.
do $$
declare
  r record;
begin
  for r in
    select ic.relname as indice
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
     where i.indrelid = 'public.proyeccion_resultado'::regclass
       and i.indisunique
       and not i.indisprimary
       and not exists (
         select 1
           from unnest(i.indkey) k
           join pg_attribute a
             on a.attrelid = i.indrelid and a.attnum = k
          where a.attname = 'escenario')
  loop
    execute format('drop index if exists %I', r.indice);
    raise notice 'Eliminado índice único sin escenario: %', r.indice;
  end loop;
end $$;

-- 3) La llave correcta: una fila por (periodo, escenario, combinada).
create unique index if not exists ux_proy_resultado
  on proyeccion_resultado (periodo, escenario, combinada);

-- 4) Vista de entrega con el append de los dos escenarios (igual a §4.9).
drop view if exists v_proyeccion_final cascade;

create view v_proyeccion_final as
select distinct on (periodo, escenario, combinada)
       fecha            as "FECHA",
       ajuste           as "Ajuste",
       vista            as "Vista",
       combinada        as "Combinada",
       pais             as "Pais",
       empresa          as "Empresa",
       tasa_mensual     as "Tasa_Mensual",
       ajuste_usd       as "Ajuste_USD",
       monto_local      as "Monto_Local",
       monto_usd        as "Monto_USD",
       centro_costo     as "CENTRO_COSTO",
       cuenta_contable  as "CUENTA_CONTABLE",
       escenario::integer as "Proyeccion",       -- 1 = Proyectado, 2 = Causado
       periodo,
       calculado_en
from proyeccion_resultado
order by periodo, escenario, combinada, calculado_en desc, id desc;

-- Comprobación: debe devolver una fila por escenario publicado del periodo.
-- select "Proyeccion", count(*) from v_proyeccion_final
--  where periodo = '2026-10' group by 1 order by 1;
