-- ============================================================================
-- Módulo: Proyección del GyP Mayoreo
-- Script de base de datos (Supabase / PostgreSQL)
-- ============================================================================
-- Crea las tablas del motor de proyección y carga la semilla validada por
-- control: 6 métodos de fábrica, parámetros por empresa (periodo 2026-10) y las
-- 95 reglas vigentes.
--
-- La historia mensual (gyp_historico_mensual) la alimenta un proceso de Fabric;
-- el módulo trae una foto embebida que reproduce las cifras de aceptación
-- aunque esta tabla esté vacía.
--
-- Es idempotente: puede correrse varias veces sin duplicar. Ejecútalo completo
-- en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------

-- Parámetros de proyección de venta, por empresa y periodo
create table if not exists proyeccion_parametro (
  id                 bigserial primary key,
  periodo            text    not null,          -- 'aaaa-mm'
  empresa            text    not null,
  dias_habiles_mes   int     not null,
  dias_transcurridos int     not null,
  factor_correccion  numeric not null default 1,
  tasa_local         numeric,                   -- null = deducirla de los datos
  corte              date,                      -- hasta qué día hay datos completos
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (periodo, empresa)
);

-- Métodos: una fórmula con nombre, reutilizable
create table if not exists proyeccion_metodo (
  id          text primary key,                 -- 'm_pct_venta', 'u_xxxx'
  nombre      text    not null,
  operacion   text    not null check (operacion in
                ('porcentaje','multiplicar','sumar','restar',
                 'valor_fijo','promedio','formula_venta','derivada')),
  base        text    not null default 'ninguna',
  valor       numeric,                          -- por defecto; % en tanto por uno
  invertir    boolean not null default false,
  turno       int     not null check (turno between 1 and 5),
  de_fabrica  boolean not null default false,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Reglas: aplican un método a un concepto de una empresa
create table if not exists proyeccion_regla (
  id               bigserial primary key,
  periodo          text    not null,
  empresa          text    not null,
  concepto         text    not null,
  grupo_pl         text    not null check (grupo_pl in ('VENTAS','GOP','GANOP','SEMI')),
  combinada        text    not null,            -- debe existir en el catálogo de Gold
  centro_costo     text    not null,
  cuenta_contable  text    not null,
  pais             text    not null,
  metodo           text    not null references proyeccion_metodo(id),
  valor            numeric,                     -- sobrescribe el del método
  meses_promedio   int,                         -- solo si la operación es 'promedio'
  activa           boolean not null default true,
  created_at       timestamptz not null default now(),
  -- La restricción es por CUENTA (combinada), no por concepto: un concepto
  -- puede abrirse en varias cuentas (p. ej. Personal por centro de costo), pero
  -- dos reglas sobre la misma cuenta son doble conteo.
  unique (periodo, empresa, combinada)
);

-- Salida: el mismo formato que la tabla de mayor (F_Mayor + Proyeccion)
create table if not exists proyeccion_resultado (
  id               bigserial primary key,
  periodo          text    not null,
  fecha            date    not null,
  ajuste           numeric not null default 0,
  vista            text    not null default 'GYP',
  combinada        text    not null,
  pais             text    not null,
  empresa          text    not null,
  tasa_mensual     numeric,
  ajuste_usd       numeric not null default 0,
  monto_local      numeric not null,
  monto_usd        numeric not null,
  centro_costo     text    not null,
  cuenta_contable  text    not null,
  proyeccion       int     not null default 1,
  calculado_en     timestamptz not null default now()
);
create index if not exists ix_proyeccion_resultado_periodo on proyeccion_resultado (periodo);

-- Historia mensual por cuenta: la alimenta un proceso de Fabric
create table if not exists gyp_historico_mensual (
  periodo              text    not null,
  empresa              text    not null,
  concepto             text    not null,
  dim_subclasificacion text    not null default '',
  -- subgrupo entra en la PK, así que no puede ser nulo: un subgrupo ausente
  -- se guarda como '' (Postgres no admite funciones como coalesce() en una PK).
  subgrupo             text    not null default '',
  monto_usd            numeric not null,
  monto_local          numeric,
  es_venta             boolean not null default false,
  primary key (periodo, empresa, dim_subclasificacion, subgrupo)
);

-- ---------------------------------------------------------------------------
-- 2. Métodos de fábrica
-- ---------------------------------------------------------------------------
insert into proyeccion_metodo (id, nombre, operacion, base, valor, invertir, turno, de_fabrica, activo) values
  ('m_venta',        'Fórmula de venta',      'formula_venta', 'ninguna',  NULL,  false, 1, true, true),
  ('m_promedio',     'Promedio histórico',    'promedio',      'ninguna',  NULL,  false, 2, true, true),
  ('m_fijo',         'Monto fijo',            'valor_fijo',    'ninguna',  0,     false, 2, true, true),
  ('m_pct_venta',    '% sobre venta',         'porcentaje',    'venta',    0.01,  true,  3, true, true),
  ('m_derivada',     'Derivada (Cargo Fijo)', 'derivada',      'ninguna',  NULL,  false, 4, true, true),
  ('m_pct_semineto', '% sobre Semi Neto',     'porcentaje',    'semineto', 0.009, false, 5, true, true)
on conflict (id) do update set
  nombre = excluded.nombre, operacion = excluded.operacion, base = excluded.base,
  valor = excluded.valor, invertir = excluded.invertir, turno = excluded.turno,
  de_fabrica = excluded.de_fabrica, activo = excluded.activo;

-- ---------------------------------------------------------------------------
-- 3. Parámetros por empresa (periodo 2026-10, validado por control)
-- ---------------------------------------------------------------------------
insert into proyeccion_parametro (periodo, empresa, dias_habiles_mes, dias_transcurridos, factor_correccion, tasa_local) values
  ('2026-10', 'Beval', 26, 6, 1.4, 885.7341),
  ('2026-10', 'Febeca', 26, 6, 1.32, 875.9338),
  ('2026-10', 'Sillaca', 26, 6, 1.47, 876.8367),
  ('2026-10', 'Cofersa', 22, 5, 1, 452.1257),
  ('2026-10', 'Mundial', 21, 5, 1.19, 3126.78),
  ('2026-10', 'Prisma', 26, 6, 1, 879.5015)
on conflict (periodo, empresa) do update set
  dias_habiles_mes = excluded.dias_habiles_mes,
  dias_transcurridos = excluded.dias_transcurridos,
  factor_correccion = excluded.factor_correccion,
  tasa_local = excluded.tasa_local,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. Las 95 reglas vigentes (periodo 2026-10)
--    valor en % va en tanto por uno (0.01 = 1 %).
-- ---------------------------------------------------------------------------
insert into proyeccion_regla
  (periodo, empresa, concepto, grupo_pl, combinada, centro_costo, cuenta_contable, pais, metodo, valor) values
  ('2026-10', 'Beval', 'Ventas', 'VENTAS', '4.1.1.01.2.001-00.00.000.00-Beval', '00.00.000.00', '4.1.1.01.2.001', 'Venezuela', 'm_venta', NULL),
  ('2026-10', 'Beval', 'Costo de Ventas', 'VENTAS', '5.1.1.01.1.001-00.00.000.00-Beval', '00.00.000.00', '5.1.1.01.1.001', 'Venezuela', 'm_venta', NULL),
  ('2026-10', 'Beval', 'Ingresos Mercantiles', 'VENTAS', '6.1.1.12.1.996-00.00.000.00-Beval', '00.00.000.00', '6.1.1.12.1.996', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Beval', 'Fletes Recuperados', 'VENTAS', '7.1.3.45.1.997-00.00.000.00-Beval', '00.00.000.00', '7.1.3.45.1.997', 'Venezuela', 'm_venta', NULL),
  ('2026-10', 'Beval', 'Merma', 'VENTAS', '5.1.1.14.1.998-00.00.000.00-Beval', '00.00.000.00', '5.1.1.14.1.998', 'Venezuela', 'm_pct_venta', 0.005),
  ('2026-10', 'Beval', 'Personal Fijo', 'GOP', '6.1.2.01.1.009-00.00.000.00-Beval', '00.00.000.00', '6.1.2.01.1.009', 'Venezuela', 'm_promedio', 91981),
  ('2026-10', 'Beval', 'Gastos Varios', 'GOP', '6.1.2.01.1.036-00.00.000.00-Beval', '00.00.000.00', '6.1.2.01.1.036', 'Venezuela', 'm_promedio', 63500),
  ('2026-10', 'Beval', 'Alquileres', 'GOP', '7.1.3.10.1.001-00.00.000.00-Beval', '00.00.000.00', '7.1.3.10.1.001', 'Venezuela', 'm_pct_venta', 0.01),
  ('2026-10', 'Beval', 'Cargo Fijo', 'GOP', '7.1.3.56.1.001-00.00.000.00-Beval', '00.00.000.00', '7.1.3.56.1.001', 'Venezuela', 'm_pct_venta', 0.012),
  ('2026-10', 'Beval', 'Tributos', 'GOP', '6.1.2.01.1.046-00.00.000.00-Beval', '00.00.000.00', '6.1.2.01.1.046', 'Venezuela', 'm_pct_venta', 0.027),
  ('2026-10', 'Beval', 'Incobrables', 'GOP', '6.1.2.01.1.019-00.00.000.00-Beval', '00.00.000.00', '6.1.2.01.1.019', 'Venezuela', 'm_pct_venta', 0.01),
  ('2026-10', 'Beval', 'Fletes', 'GOP', '7.1.3.45.1.001-00.00.000.00-Beval', '00.00.000.00', '7.1.3.45.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Beval', 'Logistico', 'GOP', '6.1.2.01.1.009-01.01.089.01-Beval', '01.01.089.01', '6.1.2.01.1.009', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Beval', 'IVA Atrapado', 'GOP', '6.1.1.12.1.994-00.00.000.00-Beval', '00.00.000.00', '6.1.1.12.1.994', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Beval', 'Otros egresos', 'GANOP', '6.1.1.05.1.001-00.00.000.00-Beval', '00.00.000.00', '6.1.1.05.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Beval', 'Intereses', 'GANOP', '6.1.1.15.1.001-00.00.000.00-Beval', '00.00.000.00', '6.1.1.15.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Beval', 'Depreciacion', 'GANOP', '7.1.3.05.1.001-00.00.000.00-Beval', '00.00.000.00', '7.1.3.05.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Beval', 'ISLR', 'SEMI', '7.1.4.01.1.047-00.00.000.00-Beval', '00.00.000.00', '7.1.4.01.1.047', 'Venezuela', 'm_pct_venta', 0.01),
  ('2026-10', 'Febeca', 'Ventas', 'VENTAS', '4.1.1.01.2.001-00.00.000.00-Febeca', '00.00.000.00', '4.1.1.01.2.001', 'Venezuela', 'm_venta', NULL),
  ('2026-10', 'Febeca', 'Costo de Ventas', 'VENTAS', '5.1.1.01.1.001-00.00.000.00-Febeca', '00.00.000.00', '5.1.1.01.1.001', 'Venezuela', 'm_venta', NULL),
  ('2026-10', 'Febeca', 'Ingresos Mercantiles', 'VENTAS', '6.1.1.12.1.996-00.00.000.00-Febeca', '00.00.000.00', '6.1.1.12.1.996', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Febeca', 'Fletes Recuperados', 'VENTAS', '7.1.3.45.1.997-00.00.000.00-Febeca', '00.00.000.00', '7.1.3.45.1.997', 'Venezuela', 'm_venta', NULL),
  ('2026-10', 'Febeca', 'Merma', 'VENTAS', '5.1.1.14.1.998-00.00.000.00-Febeca', '00.00.000.00', '5.1.1.14.1.998', 'Venezuela', 'm_pct_venta', 0.005),
  ('2026-10', 'Febeca', 'Personal Fijo', 'GOP', '6.1.2.01.1.009-00.00.000.00-Febeca', '00.00.000.00', '6.1.2.01.1.009', 'Venezuela', 'm_promedio', 245096),
  ('2026-10', 'Febeca', 'Gastos Varios', 'GOP', '6.1.2.01.1.036-00.00.000.00-Febeca', '00.00.000.00', '6.1.2.01.1.036', 'Venezuela', 'm_promedio', 228858),
  ('2026-10', 'Febeca', 'Alquileres', 'GOP', '7.1.3.10.1.001-00.00.000.00-Febeca', '00.00.000.00', '7.1.3.10.1.001', 'Venezuela', 'm_promedio', 33539),
  ('2026-10', 'Febeca', 'Cargo Fijo', 'GOP', '7.1.3.56.1.001-00.00.000.00-Febeca', '00.00.000.00', '7.1.3.56.1.001', 'Venezuela', 'm_pct_venta', 0.015),
  ('2026-10', 'Febeca', 'Tributos', 'GOP', '6.1.2.01.1.046-00.00.000.00-Febeca', '00.00.000.00', '6.1.2.01.1.046', 'Venezuela', 'm_pct_venta', 0.028),
  ('2026-10', 'Febeca', 'Incobrables', 'GOP', '6.1.2.01.1.019-00.00.000.00-Febeca', '00.00.000.00', '6.1.2.01.1.019', 'Venezuela', 'm_pct_venta', 0.01),
  ('2026-10', 'Febeca', 'Fletes', 'GOP', '7.1.3.45.1.001-00.00.000.00-Febeca', '00.00.000.00', '7.1.3.45.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Febeca', 'Logistico', 'GOP', '6.1.2.01.1.009-01.01.089.01-Febeca', '01.01.089.01', '6.1.2.01.1.009', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Febeca', 'IVA Atrapado', 'GOP', '6.1.1.12.1.994-00.00.000.00-Febeca', '00.00.000.00', '6.1.1.12.1.994', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Febeca', 'Otros egresos', 'GANOP', '6.1.1.05.1.001-00.00.000.00-Febeca', '00.00.000.00', '6.1.1.05.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Febeca', 'Intereses', 'GANOP', '6.1.1.15.1.001-01.01.080.01-Febeca', '01.01.080.01', '6.1.1.15.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Febeca', 'Depreciacion', 'GANOP', '7.1.3.05.1.001-00.00.000.00-Febeca', '00.00.000.00', '7.1.3.05.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Febeca', 'ISLR', 'SEMI', '7.1.4.01.1.047-00.00.000.00-Febeca', '00.00.000.00', '7.1.4.01.1.047', 'Venezuela', 'm_pct_venta', 0.01),
  ('2026-10', 'Sillaca', 'Ventas', 'VENTAS', '4.1.1.01.2.001-00.00.000.00-Sillaca', '00.00.000.00', '4.1.1.01.2.001', 'Venezuela', 'm_venta', NULL),
  ('2026-10', 'Sillaca', 'Costo de Ventas', 'VENTAS', '5.1.1.01.1.001-00.00.000.00-Sillaca', '00.00.000.00', '5.1.1.01.1.001', 'Venezuela', 'm_venta', NULL),
  ('2026-10', 'Sillaca', 'Ingresos Mercantiles', 'VENTAS', '6.1.1.12.1.996-00.00.000.00-Sillaca', '00.00.000.00', '6.1.1.12.1.996', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Sillaca', 'Fletes Recuperados', 'VENTAS', '7.1.3.45.1.997-00.00.000.00-Sillaca', '00.00.000.00', '7.1.3.45.1.997', 'Venezuela', 'm_venta', NULL),
  ('2026-10', 'Sillaca', 'Merma', 'VENTAS', '5.1.1.14.1.998-00.00.000.00-Sillaca', '00.00.000.00', '5.1.1.14.1.998', 'Venezuela', 'm_pct_venta', 0.005),
  ('2026-10', 'Sillaca', 'Personal Fijo', 'GOP', '6.1.2.01.1.009-00.00.000.00-Sillaca', '00.00.000.00', '6.1.2.01.1.009', 'Venezuela', 'm_promedio', 71015),
  ('2026-10', 'Sillaca', 'Gastos Varios', 'GOP', '6.1.2.01.1.036-00.00.000.00-Sillaca', '00.00.000.00', '6.1.2.01.1.036', 'Venezuela', 'm_promedio', 51952),
  ('2026-10', 'Sillaca', 'Alquileres', 'GOP', '7.1.3.10.1.001-00.00.000.00-Sillaca', '00.00.000.00', '7.1.3.10.1.001', 'Venezuela', 'm_promedio', 2000),
  ('2026-10', 'Sillaca', 'Cargo Fijo', 'GOP', '7.1.3.56.1.001-00.00.000.00-Sillaca', '00.00.000.00', '7.1.3.56.1.001', 'Venezuela', 'm_pct_venta', 0.012),
  ('2026-10', 'Sillaca', 'Tributos', 'GOP', '6.1.2.01.1.046-00.00.000.00-Sillaca', '00.00.000.00', '6.1.2.01.1.046', 'Venezuela', 'm_pct_venta', 0.021),
  ('2026-10', 'Sillaca', 'Incobrables', 'GOP', '6.1.2.01.1.019-00.00.000.00-Sillaca', '00.00.000.00', '6.1.2.01.1.019', 'Venezuela', 'm_pct_venta', 0.01),
  ('2026-10', 'Sillaca', 'Fletes', 'GOP', '7.1.3.45.1.001-00.00.000.00-Sillaca', '00.00.000.00', '7.1.3.45.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Sillaca', 'Logistico', 'GOP', '6.1.2.01.1.009-01.01.089.01-Sillaca', '01.01.089.01', '6.1.2.01.1.009', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Sillaca', 'IVA Atrapado', 'GOP', '6.1.1.12.1.994-00.00.000.00-Sillaca', '00.00.000.00', '6.1.1.12.1.994', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Sillaca', 'Otros egresos', 'GANOP', '6.1.1.05.1.001-00.00.000.00-Sillaca', '00.00.000.00', '6.1.1.05.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Sillaca', 'Intereses', 'GANOP', '6.1.1.15.1.001-00.00.000.00-Sillaca', '00.00.000.00', '6.1.1.15.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Sillaca', 'Depreciacion', 'GANOP', '7.1.3.05.1.001-00.00.000.00-Sillaca', '00.00.000.00', '7.1.3.05.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Sillaca', 'ISLR', 'SEMI', '7.1.4.01.1.047-00.00.000.00-Sillaca', '00.00.000.00', '7.1.4.01.1.047', 'Venezuela', 'm_pct_venta', 0.01),
  ('2026-10', 'Cofersa', 'Ventas', 'VENTAS', '4-01-01-01-00-0-00-00-Cofersa', '0-00-00', '4-01-01-01-00', 'Costa Rica', 'm_venta', NULL),
  ('2026-10', 'Cofersa', 'Costo de Ventas', 'VENTAS', '5-01-01-00-00-0-00-00-Cofersa', '0-00-00', '5-01-01-00-00', 'Costa Rica', 'm_venta', NULL),
  ('2026-10', 'Cofersa', 'Ingresos Mercantiles', 'VENTAS', '4-02-06-00-00-0-00-00-Cofersa', '0-00-00', '4-02-06-00-00', 'Costa Rica', 'm_promedio', NULL),
  ('2026-10', 'Cofersa', 'Merma', 'VENTAS', '5-01-98-00-00-0-00-00-Cofersa', '0-00-00', '5-01-98-00-00', 'Costa Rica', 'm_pct_venta', 0.004),
  ('2026-10', 'Cofersa', 'Personal Fijo', 'GOP', '5-02-01-01-00-0-00-00-Cofersa', '0-00-00', '5-02-01-01-00', 'Costa Rica', 'm_promedio', 477863),
  ('2026-10', 'Cofersa', 'Gastos Varios', 'GOP', '4-02-05-00-00-0-00-00-Cofersa', '0-00-00', '4-02-05-00-00', 'Costa Rica', 'm_promedio', 140534),
  ('2026-10', 'Cofersa', 'Alquileres', 'GOP', '4-02-15-00-00-0-00-00-Cofersa', '0-00-00', '4-02-15-00-00', 'Costa Rica', 'm_pct_venta', 0.015),
  ('2026-10', 'Cofersa', 'Cargo Fijo', 'GOP', '4-02-25-00-00-0-00-00-Cofersa', '0-00-00', '4-02-25-00-00', 'Costa Rica', 'm_pct_venta', 0.012),
  ('2026-10', 'Cofersa', 'Tributos', 'GOP', '5-02-09-01-00-0-00-00-Cofersa', '0-00-00', '5-02-09-01-00', 'Costa Rica', 'm_pct_venta', 0.001),
  ('2026-10', 'Cofersa', 'Incobrables', 'GOP', '5-02-15-02-00-0-00-00-Cofersa', '0-00-00', '5-02-15-02-00', 'Costa Rica', 'm_pct_venta', 0.002),
  ('2026-10', 'Cofersa', 'Fletes', 'GOP', '5-01-04-00-00-0-00-00-Cofersa', '0-00-00', '5-01-04-00-00', 'Costa Rica', 'm_promedio', NULL),
  ('2026-10', 'Cofersa', 'Logistico', 'GOP', '5-02-04-17-00-4-03-00-Cofersa', '4-03-00', '5-02-04-17-00', 'Costa Rica', 'm_promedio', NULL),
  ('2026-10', 'Cofersa', 'Otros egresos', 'GANOP', '4-02-10-00-00-0-00-00-Cofersa', '0-00-00', '4-02-10-00-00', 'Costa Rica', 'm_promedio', NULL),
  ('2026-10', 'Cofersa', 'Intereses', 'GANOP', '4-02-03-00-00-0-00-00-Cofersa', '0-00-00', '4-02-03-00-00', 'Costa Rica', 'm_promedio', NULL),
  ('2026-10', 'Cofersa', 'Depreciacion', 'GANOP', '5-02-12-01-00-0-00-00-Cofersa', '0-00-00', '5-02-12-01-00', 'Costa Rica', 'm_promedio', NULL),
  ('2026-10', 'Cofersa', 'ISLR', 'SEMI', '5-02-09-05-00-0-00-00-Cofersa', '0-00-00', '5-02-09-05-00', 'Costa Rica', 'm_pct_semineto', 0.009),
  ('2026-10', 'Mundial', 'Ventas', 'VENTAS', '4-1-35-06-01-0-00-00-Mundial', '0-00-00', '4-1-35-06-01', 'Colombia', 'm_venta', NULL),
  ('2026-10', 'Mundial', 'Costo de Ventas', 'VENTAS', '4-2-10-60-00-00-00-00-Mundial', '00-00-00', '4-2-10-60-00', 'Colombia', 'm_venta', NULL),
  ('2026-10', 'Mundial', 'Ingresos Mercantiles', 'VENTAS', '4-2-10-50-00-0-00-00-Mundial', '0-00-00', '4-2-10-50-00', 'Colombia', 'm_venta', NULL),
  ('2026-10', 'Mundial', 'Merma', 'VENTAS', '5-2-99-15-00-0-00-00-Mundial', '0-00-00', '5-2-99-15-00', 'Colombia', 'm_pct_venta', 0.002),
  ('2026-10', 'Mundial', 'Personal Fijo', 'GOP', '5-1-05-03-00-0-00-00-Mundial', '0-00-00', '5-1-05-03-00', 'Colombia', 'm_promedio', 120589),
  ('2026-10', 'Mundial', 'Gastos Varios', 'GOP', '4-2-10-40-00-0-00-00-Mundial', '0-00-00', '4-2-10-40-00', 'Colombia', 'm_promedio', 36667),
  ('2026-10', 'Mundial', 'Alquileres', 'GOP', '5-1-20-10-00-0-00-00-Mundial', '0-00-00', '5-1-20-10-00', 'Colombia', 'm_pct_venta', 0.02),
  ('2026-10', 'Mundial', 'Tributos', 'GOP', '5-1-15-05-00-0-00-00-Mundial', '0-00-00', '5-1-15-05-00', 'Colombia', 'm_pct_venta', 0.013),
  ('2026-10', 'Mundial', 'Incobrables', 'GOP', '5-2-99-10-00-0-00-00-Mundial', '0-00-00', '5-2-99-10-00', 'Colombia', 'm_pct_venta', 0.003),
  ('2026-10', 'Mundial', 'Fletes', 'GOP', '5-2-35-50-00-0-00-00-Mundial', '0-00-00', '5-2-35-50-00', 'Colombia', 'm_promedio', NULL),
  ('2026-10', 'Mundial', 'Logistico', 'GOP', '5-1-05-06-00-11-00-00-Mundial', '11-00-00', '5-1-05-06-00', 'Colombia', 'm_promedio', NULL),
  ('2026-10', 'Mundial', 'Otros egresos', 'GANOP', '4-2-10-10-00-00-00-00-Mundial', '00-00-00', '4-2-10-10-00', 'Colombia', 'm_promedio', NULL),
  ('2026-10', 'Mundial', 'Intereses', 'GANOP', '4-2-10-05-00-0-00-00-Mundial', '0-00-00', '4-2-10-05-00', 'Colombia', 'm_promedio', NULL),
  ('2026-10', 'Mundial', 'Depreciacion', 'GANOP', '5-1-60-05-00-0-00-00-Mundial', '0-00-00', '5-1-60-05-00', 'Colombia', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'Colocacion', 'VENTAS', '6.1.1.20.1.001-00.00.000.00-Prisma', '00.00.000.00', '6.1.1.20.1.001', 'Venezuela', 'm_derivada', NULL),
  ('2026-10', 'Prisma', 'Ingresos Mercantiles', 'VENTAS', '6.1.1.12.1.996-00.00.000.00-Prisma', '00.00.000.00', '6.1.1.12.1.996', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'Personal Fijo', 'GOP', '6.1.2.01.1.009-00.00.000.00-Prisma', '00.00.000.00', '6.1.2.01.1.009', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'Gastos Varios', 'GOP', '6.1.2.01.1.036-00.00.000.00-Prisma', '00.00.000.00', '6.1.2.01.1.036', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'Tributos', 'GOP', '6.1.2.01.1.046-00.00.000.00-Prisma', '00.00.000.00', '6.1.2.01.1.046', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'Logistico', 'GOP', '7.1.3.04.1.005-01.01.089.01-Prisma', '01.01.089.01', '7.1.3.04.1.005', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'IVA Atrapado', 'GOP', '6.1.1.12.1.994-00.00.000.00-Prisma', '00.00.000.00', '6.1.1.12.1.994', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'Otros egresos', 'GANOP', '6.1.1.05.1.001-00.00.000.00-Prisma', '00.00.000.00', '6.1.1.05.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'Intereses', 'GANOP', '6.1.1.15.1.001-00.00.000.00-Prisma', '00.00.000.00', '6.1.1.15.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'Depreciacion', 'GANOP', '7.1.3.05.1.001-00.00.000.00-Prisma', '00.00.000.00', '7.1.3.05.1.001', 'Venezuela', 'm_promedio', NULL),
  ('2026-10', 'Prisma', 'ISLR', 'SEMI', '7.1.4.01.1.047-00.00.000.00-Prisma', '00.00.000.00', '7.1.4.01.1.047', 'Venezuela', 'm_promedio', NULL)


on conflict (periodo, empresa, combinada) do update set
  concepto = excluded.concepto, grupo_pl = excluded.grupo_pl,
  centro_costo = excluded.centro_costo, cuenta_contable = excluded.cuenta_contable,
  pais = excluded.pais, metodo = excluded.metodo, valor = excluded.valor,
  activa = true;

-- ============================================================================
-- Fin del script. 6 metodos + 6 parametros + 95 reglas cargadas.
-- Validacion: con promedio de 9 meses y estos datos, el Semi Neto debe dar
-- Beval 45.934 | Febeca 1.165.313 | Sillaca 79.476 | Cofersa -130.077 |
-- Mundial -92.939 | Prisma 48.477 (total 1.116.184).
-- ============================================================================

-- ============================================================================
-- 5. Vista de entrega: v_proyeccion_final
--    Contrato con Fabric (documento 08). Es el UNICO objeto que Fabric lee.
--    Fabric NO reconstruye la proyeccion: lee esta vista ya resuelta, con la
--    forma exacta del mayor (las 12 columnas de F_Mayor + Proyeccion) y la pega
--    al reporte.
--
--    Grano: una fila por (periodo, Combinada). Como proyeccion_resultado
--    INSERTA en cada corrida, aqui nos quedamos con la ULTIMA version de cada
--    llave (DISTINCT ON por calculado_en, id). Asi, aunque control pulse
--    "calcular" varias veces, el mes no sale multiplicado (08 §3).
--
--    Los nombres de columna van con mayusculas EXACTAS: el modelo semantico de
--    Fabric los referencia uno a uno.
-- ============================================================================
create or replace view v_proyeccion_final as
select distinct on (periodo, combinada)
       fecha            as "FECHA",            -- dia 1 del periodo (08 §4)
       ajuste           as "Ajuste",           -- siempre 0
       vista            as "Vista",            -- siempre 'GYP'
       combinada        as "Combinada",        -- CUENTA-CENTROCOSTO-EMPRESA (08 §5)
       pais             as "Pais",             -- derivado de la empresa
       empresa          as "Empresa",
       tasa_mensual     as "Tasa_Mensual",     -- NULA en las venezolanas (08 §6)
       ajuste_usd       as "Ajuste_USD",       -- siempre 0
       monto_local      as "Monto_Local",
       monto_usd        as "Monto_USD",
       centro_costo     as "CENTRO_COSTO",
       cuenta_contable  as "CUENTA_CONTABLE",
       proyeccion       as "Proyeccion",       -- siempre 1
       periodo,                                -- control: llave junto con Combinada
       calculado_en                            -- control: cuando se calculo
from proyeccion_resultado
order by periodo, combinada, calculado_en desc, id desc;

-- ============================================================================
-- 6. Comprobaciones que el aplicativo puede correr solo (08 §10).
--    Cada una debe devolver 0 filas. Ejecutarlas tras publicar un periodo.
-- ============================================================================

-- 6.1 Grano: ninguna (periodo, Combinada) puede repetirse.
-- select periodo, "Combinada", count(*)
-- from v_proyeccion_final group by 1, 2 having count(*) > 1;

-- 6.2 Constantes: Proyeccion=1, Vista='GYP', Ajuste=0, Ajuste_USD=0, dia 1.
-- select * from v_proyeccion_final
-- where "Proyeccion" <> 1 or "Vista" <> 'GYP'
--    or "Ajuste" <> 0 or "Ajuste_USD" <> 0
--    or extract(day from "FECHA") <> 1;

-- 6.3 Tasa (al reves de lo intuitivo): las venezolanas deben tener tasa NULA.
-- select * from v_proyeccion_final
-- where ("Empresa" in ('Beval','Febeca','Sillaca','Prisma') and "Tasa_Mensual" is not null)
--    or ("Empresa" in ('Cofersa','Mundial')                 and "Tasa_Mensual" is null);

-- 6.4 Signos: la venta proyectada de cada empresa debe salir NEGATIVA.
-- select "Empresa", sum("Monto_USD")
-- from v_proyeccion_final
-- where "CUENTA_CONTABLE" in (
--   '4.1.1.01.2.001',  -- Ventas Venezuela (Beval/Febeca/Sillaca)
--   '4-01-01-01-00',   -- Ventas Cofersa
--   '4-1-35-06-01',    -- Ventas Mundial
--   '6.1.1.20.1.001'   -- Colocacion Prisma
-- )
-- group by 1;

-- ============================================================================
-- Fin de la vista de entrega. Fabric carga v_proyeccion_final via copyjob.
-- ============================================================================
