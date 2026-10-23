-- ============================================================================
-- MIGRACIÓN §4 — Esquema propuesto para producción (12-cambios-para-produccion.md)
-- ----------------------------------------------------------------------------
-- Este bloque amplía el esquema anterior para soportar los dos escenarios de
-- salida, el modelo de reglas v2, las fórmulas propias, el detalle por cuenta
-- de Fabric, el catálogo, las alertas, la programación y la bitácora de
-- corridas.
--
-- Todo el bloque es IDEMPOTENTE (`IF NOT EXISTS` en columnas, índices y
-- tablas): puede correrse sobre una base que ya tiene datos sin borrarlos ni
-- duplicarlos. Las tablas nuevas se crean ANTES de las columnas que las
-- referencian (proyeccion_formula antes de proyeccion_regla.formula_id) para
-- que las claves foráneas no fallen.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §4.1 Tablas nuevas que son referenciadas por otras (crear primero)
--      proyeccion_formula se crea ANTES de añadir proyeccion_regla.formula_id,
--      que la referencia por clave foránea.
-- ---------------------------------------------------------------------------

-- Métodos y fórmulas propias.
create table if not exists proyeccion_formula (
  id         bigserial primary key,
  nombre     text    not null,
  pasos      jsonb   not null,                 -- las piezas
  orden      smallint not null default 1,      -- turno; se deduce de las bases
  invertir   boolean not null default false,
  causado    text    not null default 'igual',
  de_fabrica boolean not null default false,
  rev        integer not null default 0
);

-- ---------------------------------------------------------------------------
-- §4.2 Salida: segundo escenario en proyeccion_resultado
--      escenario = 1 (Proyectado al cierre) | 2 (Causado al corte).
--      La llave única garantiza una sola fila por (periodo, escenario,
--      combinada): republicar reemplaza en vez de acumular.
-- ---------------------------------------------------------------------------
alter table proyeccion_resultado
  add column if not exists escenario smallint not null default 1;

create unique index if not exists ux_proy_resultado
  on proyeccion_resultado (periodo, escenario, combinada);

-- ---------------------------------------------------------------------------
-- §4.3 Reglas v2: 14 columnas nuevas en proyeccion_regla
--      formula_id referencia proyeccion_formula(id), ya creada arriba.
-- ---------------------------------------------------------------------------
alter table proyeccion_regla
  add column if not exists nombre          text,
  add column if not exists detalle         text,
  add column if not exists causado         text    not null default 'igual',    -- igual|habiles|calendario|real
  add column if not exists escenarios      text    not null default 'AMBOS',    -- AMBOS|PROYECCION|CAUSADO
  add column if not exists nivel           text    not null default 'concepto', -- concepto|cuenta
  add column if not exists n               smallint,                            -- meses a mirar
  add column if not exists destino         jsonb,                               -- capas + reparto
  add column if not exists formula_id      bigint references proyeccion_formula(id),
  add column if not exists eliminada       boolean not null default false,
  add column if not exists rev             integer not null default 0,
  add column if not exists wid             text,
  add column if not exists actualizado     timestamptz,
  add column if not exists actualizado_por text;

-- ---------------------------------------------------------------------------
-- §4.4 Detalle por cuenta que empuja Fabric
-- ---------------------------------------------------------------------------
create table if not exists gyp_historico_cuenta (
  periodo      text,
  empresa      text,
  combinada    text,
  cuenta       text,
  centro_costo text,
  concepto     text,
  acumulado    numeric,
  presupuesto  numeric,
  meses        jsonb,                           -- los 12 meses anteriores
  primary key (periodo, combinada)
);

-- ---------------------------------------------------------------------------
-- §4.5 Catálogo de cuentas con sus capas
-- ---------------------------------------------------------------------------
create table if not exists dim_cuenta (
  combinada    text primary key,
  empresa      text,
  pais         text,
  cuenta       text,
  centro_costo text,
  descripcion  text,
  seccion      text,
  linea        text,
  detalle      text,
  concepto     text
);

-- ---------------------------------------------------------------------------
-- §4.6 Alertas de revisión del catálogo
-- ---------------------------------------------------------------------------
create table if not exists proyeccion_alerta (
  periodo        text,
  combinada      text,
  accion         text,                          -- crear|corregir|clasificar
  sugerencia     text,
  movimiento_mes numeric,
  movimiento_12m numeric,
  ultimo_mes     numeric,
  primary key (periodo, combinada)
);

-- ---------------------------------------------------------------------------
-- §4.7 Actualización programada (CP-56). Fila única id = 1.
-- ---------------------------------------------------------------------------
create table if not exists proyeccion_programacion (
  id          smallint primary key default 1,
  activa      boolean not null default false,
  frecuencia  text    not null default 'diaria',       -- diaria|habiles|semanal
  dia_semana  smallint,                                -- 1..7, solo si frecuencia = 'semanal'
  hora_local  time    not null default '06:00',        -- HORA DE PUBLICACION, EN CARACAS
  zona        text    not null default 'America/Caracas',
  exige_datos_frescos boolean not null default true,   -- no publica con datos viejos
  periodo     text,                                    -- null = el mes de trabajo vigente
  rev         integer not null default 0,
  actualizado_por text
);
-- Garantizar la fila única id = 1 sin pisar la configuración existente.
insert into proyeccion_programacion (id, activa, frecuencia, hora_local)
  values (1, false, 'diaria', '06:00')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- §4.8 Bitácora de cada corrida, programada o manual (CP-14 y CP-56)
-- ---------------------------------------------------------------------------
create table if not exists proyeccion_corrida (
  id          bigserial primary key,
  periodo     text    not null,
  origen      text    not null,                 -- programada|manual
  paso        text    not null,                 -- extraccion|calculo|publicacion
  estado      text    not null,                 -- en_curso|ok|error|omitida
  inicio      timestamptz not null default now(),
  fin         timestamptz,
  filas       integer,
  corte       date,                             -- hasta qué día traía datos la extracción
  mensaje     text,
  lanzada_por text
);
create index if not exists ix_corrida on proyeccion_corrida (periodo, inicio desc);

-- ============================================================================
-- Fin de la migración §4. El script completo sigue siendo ejecutable de
-- principio a fin en el SQL Editor de Supabase, preservando los datos previos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §4.9 Vista de entrega: v_proyeccion_final (append de los dos escenarios)
--
--      Decisión: la vista vive en src/pages/proyeccion-gyp/schema.sql, pero se
--      incluye TAMBIÉN en este espejo versionado para que el despliegue
--      reproduzca la vista corregida sin pasos manuales. `create or replace
--      view` es idempotente y solo depende de proyeccion_resultado y de la
--      columna `escenario` (añadida en §4.2), ambas garantizadas más arriba.
--
--      "Proyeccion" refleja el ESCENARIO: 1 = Proyectado al cierre, 2 = Causado
--      al corte (12 §5, CP-01). El DISTINCT ON incluye `escenario` para quedarse
--      con la última versión de cada llave por escenario; así la vista devuelve
--      el append de los dos escenarios (~190 filas para 2026-10 en vez de 95).
--
--      Los nombres de columna van con mayúsculas EXACTAS: el modelo semántico de
--      Power BI los referencia uno a uno.
-- ---------------------------------------------------------------------------
drop view if exists v_proyeccion_final cascade;

create view v_proyeccion_final as
select distinct on (periodo, escenario, combinada)
       fecha            as "FECHA",            -- dia 1 del periodo
       ajuste           as "Ajuste",           -- siempre 0
       vista            as "Vista",            -- siempre 'GYP'
       combinada        as "Combinada",        -- CUENTA-CENTROCOSTO-EMPRESA
       pais             as "Pais",             -- derivado de la empresa
       empresa          as "Empresa",
       tasa_mensual     as "Tasa_Mensual",     -- NULA en las venezolanas
       ajuste_usd       as "Ajuste_USD",       -- siempre 0
       monto_local      as "Monto_Local",
       monto_usd        as "Monto_USD",
       centro_costo     as "CENTRO_COSTO",
       cuenta_contable  as "CUENTA_CONTABLE",
       escenario::integer as "Proyeccion",       -- 1 = Proyectado, 2 = Causado
       periodo,                                -- control: llave junto con Combinada
       calculado_en                            -- control: cuando se calculo
from proyeccion_resultado
order by periodo, escenario, combinada, calculado_en desc, id desc;

-- ---------------------------------------------------------------------------
-- §4.10 RPC de publicación idempotente transaccional (CP-02 / CP-03)
--
--       Espejo versionado de la función que vive en
--       src/pages/proyeccion-gyp/schema.sql. PostgREST / supabase-js no exponen
--       transacciones multi-statement desde el cliente, así que el DELETE +
--       INSERT por escenario se encapsula en una función plpgsql (una sola
--       transacción del lado servidor): publicar un escenario es atómico.
--
--       Idempotencia (CP-03): borra todo (periodo, escenario) antes de insertar;
--       republicar REEMPLAZA en vez de ACUMULAR. El índice único
--       ux_proy_resultado (periodo, escenario, combinada), creado en §4.2,
--       impide duplicados dentro del lote (las filas llegan ya fusionadas por
--       Combinada, CP-06, desde la Edge Function `publicar-proyeccion`).
--
--       `create or replace function` es idempotente y solo depende de
--       proyeccion_resultado y de la columna `escenario` (añadida en §4.2),
--       ambas garantizadas más arriba en este espejo.
-- ---------------------------------------------------------------------------
create or replace function publicar_proyeccion(
  p_periodo   text,
  p_escenario smallint,
  p_filas     jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insertadas integer;
begin
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'publicar_proyeccion: p_filas debe ser un arreglo jsonb (recibido: %)', jsonb_typeof(p_filas);
  end if;

  -- 1) Vaciar el escenario del periodo (idempotencia: reemplazar, no acumular).
  delete from proyeccion_resultado
   where periodo = p_periodo
     and escenario = p_escenario;

  -- 2) Insertar las filas del lote, forzando el escenario del parámetro.
  insert into proyeccion_resultado (
    periodo, fecha, ajuste, vista, combinada, pais, empresa,
    tasa_mensual, ajuste_usd, monto_local, monto_usd,
    centro_costo, cuenta_contable, proyeccion, escenario
  )
  select
    p_periodo,
    (f->>'fecha')::date,
    coalesce((f->>'ajuste')::numeric, 0),
    coalesce(f->>'vista', 'GYP'),
    f->>'combinada',
    coalesce(f->>'pais', ''),
    f->>'empresa',
    nullif(f->>'tasa_mensual', '')::numeric,
    coalesce((f->>'ajuste_usd')::numeric, 0),
    (f->>'monto_local')::numeric,
    (f->>'monto_usd')::numeric,
    f->>'centro_costo',
    f->>'cuenta_contable',
    coalesce((f->>'proyeccion')::int, p_escenario),
    p_escenario
  from jsonb_array_elements(p_filas) as f;

  get diagnostics v_insertadas = row_count;
  return v_insertadas;
end;
$$;
