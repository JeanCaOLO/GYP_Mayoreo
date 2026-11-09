-- ==========================================================================
-- C12 - Parametrizacion de metodos de octubre 2026
-- --------------------------------------------------------------------------
-- Transcrito AUTOMATICAMENTE de la tabla "Regla por regla" de
-- 07-parametrizacion-oct-2026.md. No hay ningun valor inventado.
--
-- CONTRASTE: los totales deducidos cuadran con el resumen que el propio
-- documento declara en su seccion 2:
--   mediana 29 | ultimo 14 | proporcion de la venta 11 | % sobre venta 9
--   promedio 6 | se mantiene 26   -> 69 cambios sobre 95 reglas
--
-- ESTO MUEVE EL P&L A PROPOSITO. Segun el documento:
--   Semi Neto proyectado   1.188.929 -> 486.541
--   Semi Neto causado      -888.523  -> 211.168
-- El snapshot de los 190 montos CAMBIARA. Revisar el diff antes de aceptarlo.
--
-- NO se ejecuta solo. Revisar, correr en QA, comparar contra el documento,
-- y solo despues considerar productivo.
-- ==========================================================================

begin;

-- Beval    Ventas                 se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Ventas                 se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Ventas                 se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Ventas                 se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Ventas                 se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Costo de Ventas        se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Costo de Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Costo de Ventas        se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Costo de Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Costo de Ventas        se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Costo de Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Costo de Ventas        se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Costo de Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Costo de Ventas        se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Costo de Ventas'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Fletes Recuperados     se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Fletes Recuperados'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Fletes Recuperados     se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Fletes Recuperados'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Fletes Recuperados     se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Fletes Recuperados'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Ingresos Mercantiles   Mediana histórica 3m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Ingresos Mercantiles'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Ingresos Mercantiles   Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Ingresos Mercantiles'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Ingresos Mercantiles   Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Ingresos Mercantiles'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Ingresos Mercantiles   Promedio histórico 3m / días calendario
update proyeccion_regla set metodo = 'm_promedio', n = 3, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Ingresos Mercantiles'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Ingresos Mercantiles   Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Ingresos Mercantiles'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   Ingresos Mercantiles   Mediana histórica 3m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'Ingresos Mercantiles'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Merma                  se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Merma'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Merma                  se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Merma'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Merma                  se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Merma'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Merma                  % sobre venta 0.504 % / igual que proyectado
update proyeccion_regla set metodo = 'm_pct_venta', n = null, valor = 0.00504, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Merma'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Merma                  % sobre venta 0.500 % / igual que proyectado
update proyeccion_regla set metodo = 'm_pct_venta', n = null, valor = 0.00500, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Merma'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   Colocacion             se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'Colocacion'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Personal Fijo          Proporción histórica de la venta 6m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 6, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Personal Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Personal Fijo          Proporción histórica de la venta 6m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 6, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Personal Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Personal Fijo          Proporción histórica de la venta 3m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 3, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Personal Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Personal Fijo          Promedio histórico 3m / días hábiles
update proyeccion_regla set metodo = 'm_promedio', n = 3, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Personal Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Personal Fijo          Último mes cerrado / días hábiles
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Personal Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   Personal Fijo          Mediana histórica 3m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'Personal Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Gastos Varios          Mediana histórica 3m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Gastos Varios'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Gastos Varios          Promedio histórico 3m / días hábiles
update proyeccion_regla set metodo = 'm_promedio', n = 3, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Gastos Varios'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Gastos Varios          Mediana histórica 6m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 6, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Gastos Varios'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Gastos Varios          Último mes cerrado / días hábiles
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Gastos Varios'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Gastos Varios          Promedio histórico 9m / días hábiles
update proyeccion_regla set metodo = 'm_promedio', n = 9, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Gastos Varios'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   Gastos Varios          Mediana histórica 3m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'Gastos Varios'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Alquileres             % sobre venta 0.137 % / igual que proyectado
update proyeccion_regla set metodo = 'm_pct_venta', n = null, valor = 0.00137, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Alquileres'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Alquileres             Último mes cerrado / días calendario
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Alquileres'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Alquileres             Último mes cerrado / días calendario
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Alquileres'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Alquileres             % sobre venta 0.298 % / igual que proyectado
update proyeccion_regla set metodo = 'm_pct_venta', n = null, valor = 0.00298, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Alquileres'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Alquileres             % sobre venta 1.271 % / igual que proyectado
update proyeccion_regla set metodo = 'm_pct_venta', n = null, valor = 0.01271, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Alquileres'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Cargo Fijo             Proporción histórica de la venta 6m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 6, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Cargo Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Cargo Fijo             se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Cargo Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Cargo Fijo             Proporción histórica de la venta 3m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 3, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Cargo Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Cargo Fijo             % sobre venta 1.537 % / igual que proyectado
update proyeccion_regla set metodo = 'm_pct_venta', n = null, valor = 0.01537, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Cargo Fijo'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Tributos               Proporción histórica de la venta 3m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 3, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Tributos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Tributos               Proporción histórica de la venta 3m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 3, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Tributos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Tributos               Proporción histórica de la venta 6m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 6, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Tributos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Tributos               % sobre venta 0.022 % / igual que proyectado
update proyeccion_regla set metodo = 'm_pct_venta', n = null, valor = 0.00022, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Tributos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Tributos               se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Tributos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   Tributos               Último mes cerrado / días hábiles
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'Tributos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Incobrables            se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Incobrables'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Incobrables            se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Incobrables'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Incobrables            se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Incobrables'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Incobrables            % sobre venta 1.000 % / igual que proyectado
update proyeccion_regla set metodo = 'm_pct_venta', n = null, valor = 0.01000, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Incobrables'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Incobrables            % sobre venta 1.000 % / igual que proyectado
update proyeccion_regla set metodo = 'm_pct_venta', n = null, valor = 0.01000, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Incobrables'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Fletes                 Último mes cerrado / días hábiles
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Fletes'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Fletes                 Proporción histórica de la venta 6m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 6, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Fletes'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Fletes                 Proporción histórica de la venta 6m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 6, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Fletes'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Fletes                 Promedio histórico 3m / días hábiles
update proyeccion_regla set metodo = 'm_promedio', n = 3, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Fletes'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Fletes                 Proporción histórica de la venta 3m / sigue a la venta
update proyeccion_regla set metodo = 'm_ratio_venta', n = 3, causado = 'igual'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Fletes'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Logistico              Mediana histórica 6m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 6, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Logistico'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Logistico              Mediana histórica 3m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Logistico'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Logistico              Último mes cerrado / días hábiles
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Logistico'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Logistico              Mediana histórica 6m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 6, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Logistico'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Logistico              Último mes cerrado / días hábiles
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Logistico'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   Logistico              Último mes cerrado / días hábiles
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'Logistico'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    IVA Atrapado           Mediana histórica 12m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'IVA Atrapado'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   IVA Atrapado           Mediana histórica 3m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'IVA Atrapado'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  IVA Atrapado           Mediana histórica 3m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'IVA Atrapado'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   IVA Atrapado           Mediana histórica 6m / días hábiles
update proyeccion_regla set metodo = 'm_mediana', n = 6, causado = 'habiles'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'IVA Atrapado'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Otros egresos          Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Otros egresos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Otros egresos          Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Otros egresos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Otros egresos          Mediana histórica 6m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 6, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Otros egresos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Otros egresos          Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Otros egresos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Otros egresos          Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Otros egresos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   Otros egresos          Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'Otros egresos'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Intereses              Mediana histórica 6m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 6, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Intereses'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Intereses              Mediana histórica 6m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 6, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Intereses'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Intereses              Mediana histórica 3m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Intereses'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Intereses              Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Intereses'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Intereses              Mediana histórica 6m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 6, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Intereses'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   Intereses              Mediana histórica 12m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 12, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'Intereses'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    Depreciacion           Último mes cerrado / días calendario
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'Depreciacion'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   Depreciacion           Promedio histórico 3m / días calendario
update proyeccion_regla set metodo = 'm_promedio', n = 3, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'Depreciacion'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  Depreciacion           Último mes cerrado / días calendario
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'Depreciacion'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  Depreciacion           Último mes cerrado / días calendario
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'Depreciacion'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Mundial  Depreciacion           Último mes cerrado / días calendario
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Mundial' and concepto = 'Depreciacion'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   Depreciacion           Mediana histórica 3m / días calendario
update proyeccion_regla set metodo = 'm_mediana', n = 3, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'Depreciacion'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Beval    ISLR                   se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Beval' and concepto = 'ISLR'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Febeca   ISLR                   se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Febeca' and concepto = 'ISLR'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Sillaca  ISLR                   se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Sillaca' and concepto = 'ISLR'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Cofersa  ISLR                   se mantiene / igual que proyectado
update proyeccion_regla set causado = 'igual'
  where periodo = '2026-10' and empresa = 'Cofersa' and concepto = 'ISLR'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Prisma   ISLR                   Último mes cerrado / días calendario
update proyeccion_regla set metodo = 'm_ultimo', n = null, causado = 'calendario'
  where periodo = '2026-10' and empresa = 'Prisma' and concepto = 'ISLR'
    and coalesce(nivel, 'concepto') = 'concepto';

-- Comprobacion: estos recuentos deben coincidir con el documento.
select metodo, count(*) from proyeccion_regla
 where periodo = '2026-10' and activa and not coalesce(eliminada, false)
 group by metodo order by 2 desc;

select causado, count(*) from proyeccion_regla
 where periodo = '2026-10' and activa and not coalesce(eliminada, false)
 group by causado order by 2 desc;

-- commit;   <- descomentar tras revisar los recuentos
rollback;
