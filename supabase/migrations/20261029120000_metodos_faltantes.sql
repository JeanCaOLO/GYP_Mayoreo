-- ============================================================================
-- Métodos de fábrica que faltaban en proyeccion_metodo
-- ----------------------------------------------------------------------------
-- La base solo traía 6 métodos (m_venta, m_promedio, m_fijo, m_pct_venta,
-- m_derivada, m_pct_semineto). Faltaban los cuatro del §D que ofrece la
-- pestaña Reglas: m_mediana, m_ultimo, m_ppto y m_ratio_venta. Sin ellos, una
-- regla que los use falla al guardar por la clave foránea de
-- proyeccion_regla.metodo.
--
-- Además, el CHECK de `operacion` solo admitía las 8 operaciones v1: se amplía
-- a las 12 del motor (engine.ts → Operacion) antes de insertar.
--
-- IDEMPOTENTE: puede correrse varias veces; no toca métodos ya existentes.
-- ============================================================================

-- 1) Quitar cualquier CHECK sobre `operacion` y dejar el ampliado.
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'proyeccion_metodo'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%operacion%'
  loop
    execute format('alter table proyeccion_metodo drop constraint %I', c.conname);
  end loop;
end $$;

alter table proyeccion_metodo
  add constraint proyeccion_metodo_operacion_check check (operacion in
    ('porcentaje','multiplicar','sumar','restar',
     'valor_fijo','promedio','formula_venta','derivada',
     'mediana','ultimo','ratio_venta','presupuesto'));

-- 2) Los cuatro métodos de fábrica (mismos valores que seed.ts → METODOS_BASE).
insert into proyeccion_metodo (id, nombre, operacion, base, valor, invertir, turno, de_fabrica, activo)
values
  ('m_mediana',     'Mediana histórica',                'mediana',     'ninguna', null, false, 2, true, true),
  ('m_ultimo',      'Último mes cerrado',               'ultimo',      'ninguna', null, false, 2, true, true),
  ('m_ppto',        'Presupuesto del mes',              'presupuesto', 'ninguna', null, false, 2, true, true),
  ('m_ratio_venta', 'Proporción histórica de la venta', 'ratio_venta', 'venta',   null, false, 3, true, true)
on conflict (id) do nothing;

-- Comprobación: deben salir 10 filas.
select id, nombre, operacion, turno from proyeccion_metodo where activo order by turno, id;
