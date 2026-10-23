/**
 * Semilla validada por control de la Proyección del GyP Mayoreo.
 *
 * Contiene los 10 métodos de fábrica del §D, las 95 reglas vigentes, los
 * parámetros por empresa y la foto histórica embebida (acumulado + serie mensual
 * por cuenta).
 *
 * Esta foto permite que el módulo abra completo y calcule las cifras de
 * aceptación aunque Supabase todavía no tenga datos. Cuando la base responde,
 * sus valores se aplican encima (ver data.ts).
 *
 * Fuente: prototipo ejecutable demo.html + datos_ejemplo.json del paquete
 * "Proyeccion_GyP_Aplicativo". Cifras reales de corridas contra Fabric.
 */

import type { Metodo, Operacion, GrupoPL, Base } from './engine';

export const PERIODO_DEFAULT = '2026-10';
export const EMPRESAS = ['Beval', 'Febeca', 'Sillaca', 'Cofersa', 'Mundial', 'Prisma'];

/** Cifras que control validó: periodo 2026-10, datos al 7-oct, promedio 9 meses. */
export const CIFRAS_VALIDADAS: Record<string, number> = {
  Beval: 45934,
  Febeca: 1165313,
  Sillaca: 79476,
  Cofersa: -130077,
  Mundial: -92939,
  Prisma: 48477,
};

// ─────────────────────────────────────────────────────────────────────────────
// Métodos de fábrica
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Biblioteca de métodos de fábrica (Parte II §D de 12-cambios-para-produccion).
 *
 * Cada método trae su operación, valor por defecto, turno (`orden`) y causado por
 * defecto del §D. El promedio por defecto (N) es 9 meses; vive en el motor (`gn`)
 * y no se guarda aquí, por lo que no aparece en estos registros.
 *
 * Los cuatro métodos nuevos respecto a la v1 —`m_mediana`, `m_ultimo`,
 * `m_ratio_venta`, `m_ppto`— se agregaron con la parametrización por backtest de
 * octubre 2026. Son solo biblioteca: las 95 REGLAS_SEED siguen usando los mismos
 * métodos que la v1, así que estos nuevos métodos NO mueven los 190 casos. La
 * reasignación de reglas a estos métodos es la parametrización de octubre (otra
 * fase, tarea 13.1).
 *
 * Restricciones del §D:
 *   - `m_pct_semineto` solo aplica al grupo Impuesto (ISLR).
 *   - `m_derivada` solo aplica a la Colocación de Prisma.
 *
 * El tipo `Metodo` v1 (op/base/valor/invertir/orden/fijo) se conserva: el motor
 * expresa cada método como un `MetodoV2` de un paso y evalúa con el fold de pasos.
 * Las operaciones nuevas (`mediana`, `ultimo`, `ratio_venta`, `presupuesto`) ya se
 * evalúan en `evaluarPaso` del motor v2.
 */
export const METODOS_BASE: Record<string, Metodo> = {
  m_venta: { id: 'm_venta', nombre: 'Fórmula de venta', op: 'formula_venta', base: 'ninguna', valor: null, invertir: false, orden: 1, fijo: true },
  m_promedio: { id: 'm_promedio', nombre: 'Promedio histórico', op: 'promedio', base: 'ninguna', valor: null, invertir: false, orden: 2, fijo: true },
  m_mediana: { id: 'm_mediana', nombre: 'Mediana histórica', op: 'mediana', base: 'ninguna', valor: null, invertir: false, orden: 2, fijo: true },
  m_ultimo: { id: 'm_ultimo', nombre: 'Último mes cerrado', op: 'ultimo', base: 'ninguna', valor: null, invertir: false, orden: 2, fijo: true },
  m_ppto: { id: 'm_ppto', nombre: 'Presupuesto del mes', op: 'presupuesto', base: 'ninguna', valor: null, invertir: false, orden: 2, fijo: true },
  m_fijo: { id: 'm_fijo', nombre: 'Monto fijo', op: 'valor_fijo', base: 'ninguna', valor: 0, invertir: false, orden: 2, fijo: true },
  m_pct_venta: { id: 'm_pct_venta', nombre: '% sobre venta', op: 'porcentaje', base: 'venta', valor: 0.01, invertir: true, orden: 3, fijo: true },
  m_ratio_venta: { id: 'm_ratio_venta', nombre: 'Proporción histórica de la venta', op: 'ratio_venta', base: 'venta', valor: null, invertir: false, orden: 3, fijo: true },
  m_derivada: { id: 'm_derivada', nombre: 'Derivada (Cargo Fijo)', op: 'derivada', base: 'ninguna', valor: null, invertir: false, orden: 4, fijo: true },
  m_pct_semineto: { id: 'm_pct_semineto', nombre: '% sobre Semi Neto', op: 'porcentaje', base: 'semineto', valor: 0.009, invertir: false, orden: 5, fijo: true },
};

// ─────────────────────────────────────────────────────────────────────────────
// Parámetros por empresa (periodo 2026-10)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParamSeed {
  empresa: string;
  pais: string;
  dias: number;
  trans: number;
  factor: number;
  tasa: number;
}

export const PARAMS_SEED: ParamSeed[] = [
  { empresa: 'Beval', pais: 'NULL', dias: 26, trans: 6, factor: 1.4, tasa: 885.7341 },
  { empresa: 'Febeca', pais: 'Venezuela', dias: 26, trans: 6, factor: 1.32, tasa: 875.9338 },
  { empresa: 'Sillaca', pais: 'NULL', dias: 26, trans: 6, factor: 1.47, tasa: 876.8367 },
  { empresa: 'Cofersa', pais: 'NULL', dias: 22, trans: 5, factor: 1, tasa: 452.1257 },
  { empresa: 'Mundial', pais: 'Colombia', dias: 21, trans: 5, factor: 1.19, tasa: 3126.78 },
  { empresa: 'Prisma', pais: 'Venezuela', dias: 26, trans: 6, factor: 1, tasa: 879.5015 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Las 95 reglas vigentes
// ─────────────────────────────────────────────────────────────────────────────

export interface ReglaSeed {
  empresa: string;
  concepto: string;
  grupo: GrupoPL;
  metodo: string;
  valor: number | null;
  combinada: string;
  cc: string;
  cuenta: string;
  tasaMensual: number | null;
}

export const REGLAS_SEED: ReglaSeed[] = [
  // ── Beval ──
  { empresa: 'Beval', concepto: 'Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '4.1.1.01.2.001-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '4.1.1.01.2.001', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Costo de Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '5.1.1.01.1.001-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '5.1.1.01.1.001', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Ingresos Mercantiles', grupo: 'VENTAS', metodo: 'm_promedio', valor: null, combinada: '6.1.1.12.1.996-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '6.1.1.12.1.996', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Fletes Recuperados', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '7.1.3.45.1.997-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '7.1.3.45.1.997', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Merma', grupo: 'VENTAS', metodo: 'm_pct_venta', valor: 0.005, combinada: '5.1.1.14.1.998-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '5.1.1.14.1.998', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Personal Fijo', grupo: 'GOP', metodo: 'm_promedio', valor: 91981, combinada: '6.1.2.01.1.009-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '6.1.2.01.1.009', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Gastos Varios', grupo: 'GOP', metodo: 'm_promedio', valor: 63500, combinada: '6.1.2.01.1.036-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '6.1.2.01.1.036', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Alquileres', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.01, combinada: '7.1.3.10.1.001-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '7.1.3.10.1.001', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Cargo Fijo', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.012, combinada: '7.1.3.56.1.001-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '7.1.3.56.1.001', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Tributos', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.027, combinada: '6.1.2.01.1.046-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '6.1.2.01.1.046', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Incobrables', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.01, combinada: '6.1.2.01.1.019-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '6.1.2.01.1.019', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Fletes', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '7.1.3.45.1.001-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '7.1.3.45.1.001', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Logistico', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.2.01.1.009-01.01.089.01-Beval', cc: '01.01.089.01', cuenta: '6.1.2.01.1.009', tasaMensual: null },
  { empresa: 'Beval', concepto: 'IVA Atrapado', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.12.1.994-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '6.1.1.12.1.994', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Otros egresos', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.05.1.001-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '6.1.1.05.1.001', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Intereses', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.15.1.001-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '6.1.1.15.1.001', tasaMensual: null },
  { empresa: 'Beval', concepto: 'Depreciacion', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '7.1.3.05.1.001-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '7.1.3.05.1.001', tasaMensual: null },
  { empresa: 'Beval', concepto: 'ISLR', grupo: 'SEMI', metodo: 'm_pct_venta', valor: 0.01, combinada: '7.1.4.01.1.047-00.00.000.00-Beval', cc: '00.00.000.00', cuenta: '7.1.4.01.1.047', tasaMensual: null },

  // ── Febeca ──
  { empresa: 'Febeca', concepto: 'Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '4.1.1.01.2.001-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '4.1.1.01.2.001', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Costo de Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '5.1.1.01.1.001-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '5.1.1.01.1.001', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Ingresos Mercantiles', grupo: 'VENTAS', metodo: 'm_promedio', valor: null, combinada: '6.1.1.12.1.996-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '6.1.1.12.1.996', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Fletes Recuperados', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '7.1.3.45.1.997-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '7.1.3.45.1.997', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Merma', grupo: 'VENTAS', metodo: 'm_pct_venta', valor: 0.005, combinada: '5.1.1.14.1.998-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '5.1.1.14.1.998', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Personal Fijo', grupo: 'GOP', metodo: 'm_promedio', valor: 245096, combinada: '6.1.2.01.1.009-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '6.1.2.01.1.009', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Gastos Varios', grupo: 'GOP', metodo: 'm_promedio', valor: 228858, combinada: '6.1.2.01.1.036-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '6.1.2.01.1.036', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Alquileres', grupo: 'GOP', metodo: 'm_promedio', valor: 33539, combinada: '7.1.3.10.1.001-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '7.1.3.10.1.001', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Cargo Fijo', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.015, combinada: '7.1.3.56.1.001-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '7.1.3.56.1.001', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Tributos', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.028, combinada: '6.1.2.01.1.046-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '6.1.2.01.1.046', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Incobrables', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.01, combinada: '6.1.2.01.1.019-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '6.1.2.01.1.019', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Fletes', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '7.1.3.45.1.001-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '7.1.3.45.1.001', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Logistico', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.2.01.1.009-01.01.089.01-Febeca', cc: '01.01.089.01', cuenta: '6.1.2.01.1.009', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'IVA Atrapado', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.12.1.994-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '6.1.1.12.1.994', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Otros egresos', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.05.1.001-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '6.1.1.05.1.001', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Intereses', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.15.1.001-01.01.080.01-Febeca', cc: '01.01.080.01', cuenta: '6.1.1.15.1.001', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'Depreciacion', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '7.1.3.05.1.001-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '7.1.3.05.1.001', tasaMensual: null },
  { empresa: 'Febeca', concepto: 'ISLR', grupo: 'SEMI', metodo: 'm_pct_venta', valor: 0.01, combinada: '7.1.4.01.1.047-00.00.000.00-Febeca', cc: '00.00.000.00', cuenta: '7.1.4.01.1.047', tasaMensual: null },

  // ── Sillaca ──
  { empresa: 'Sillaca', concepto: 'Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '4.1.1.01.2.001-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '4.1.1.01.2.001', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Costo de Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '5.1.1.01.1.001-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '5.1.1.01.1.001', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Ingresos Mercantiles', grupo: 'VENTAS', metodo: 'm_promedio', valor: null, combinada: '6.1.1.12.1.996-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '6.1.1.12.1.996', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Fletes Recuperados', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '7.1.3.45.1.997-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '7.1.3.45.1.997', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Merma', grupo: 'VENTAS', metodo: 'm_pct_venta', valor: 0.005, combinada: '5.1.1.14.1.998-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '5.1.1.14.1.998', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Personal Fijo', grupo: 'GOP', metodo: 'm_promedio', valor: 71015, combinada: '6.1.2.01.1.009-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '6.1.2.01.1.009', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Gastos Varios', grupo: 'GOP', metodo: 'm_promedio', valor: 51952, combinada: '6.1.2.01.1.036-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '6.1.2.01.1.036', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Alquileres', grupo: 'GOP', metodo: 'm_promedio', valor: 2000, combinada: '7.1.3.10.1.001-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '7.1.3.10.1.001', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Cargo Fijo', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.012, combinada: '7.1.3.56.1.001-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '7.1.3.56.1.001', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Tributos', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.021, combinada: '6.1.2.01.1.046-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '6.1.2.01.1.046', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Incobrables', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.01, combinada: '6.1.2.01.1.019-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '6.1.2.01.1.019', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Fletes', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '7.1.3.45.1.001-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '7.1.3.45.1.001', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Logistico', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.2.01.1.009-01.01.089.01-Sillaca', cc: '01.01.089.01', cuenta: '6.1.2.01.1.009', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'IVA Atrapado', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.12.1.994-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '6.1.1.12.1.994', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Otros egresos', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.05.1.001-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '6.1.1.05.1.001', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Intereses', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.15.1.001-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '6.1.1.15.1.001', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'Depreciacion', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '7.1.3.05.1.001-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '7.1.3.05.1.001', tasaMensual: null },
  { empresa: 'Sillaca', concepto: 'ISLR', grupo: 'SEMI', metodo: 'm_pct_venta', valor: 0.01, combinada: '7.1.4.01.1.047-00.00.000.00-Sillaca', cc: '00.00.000.00', cuenta: '7.1.4.01.1.047', tasaMensual: null },

  // ── Cofersa ──
  { empresa: 'Cofersa', concepto: 'Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '4-01-01-01-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '4-01-01-01-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Costo de Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '5-01-01-00-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '5-01-01-00-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Ingresos Mercantiles', grupo: 'VENTAS', metodo: 'm_promedio', valor: null, combinada: '4-02-06-00-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '4-02-06-00-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Merma', grupo: 'VENTAS', metodo: 'm_pct_venta', valor: 0.004, combinada: '5-01-98-00-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '5-01-98-00-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Personal Fijo', grupo: 'GOP', metodo: 'm_promedio', valor: 477863, combinada: '5-02-01-01-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '5-02-01-01-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Gastos Varios', grupo: 'GOP', metodo: 'm_promedio', valor: 140534, combinada: '4-02-05-00-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '4-02-05-00-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Alquileres', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.015, combinada: '4-02-15-00-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '4-02-15-00-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Cargo Fijo', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.012, combinada: '4-02-25-00-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '4-02-25-00-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Tributos', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.001, combinada: '5-02-09-01-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '5-02-09-01-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Incobrables', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.002, combinada: '5-02-15-02-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '5-02-15-02-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Fletes', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '5-01-04-00-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '5-01-04-00-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Logistico', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '5-02-04-17-00-4-03-00-Cofersa', cc: '4-03-00', cuenta: '5-02-04-17-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Otros egresos', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '4-02-10-00-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '4-02-10-00-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Intereses', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '4-02-03-00-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '4-02-03-00-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'Depreciacion', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '5-02-12-01-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '5-02-12-01-00', tasaMensual: 452.1257 },
  { empresa: 'Cofersa', concepto: 'ISLR', grupo: 'SEMI', metodo: 'm_pct_semineto', valor: 0.009, combinada: '5-02-09-05-00-0-00-00-Cofersa', cc: '0-00-00', cuenta: '5-02-09-05-00', tasaMensual: 452.1257 },

  // ── Mundial ──
  { empresa: 'Mundial', concepto: 'Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '4-1-35-06-01-0-00-00-Mundial', cc: '0-00-00', cuenta: '4-1-35-06-01', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Costo de Ventas', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '4-2-10-60-00-00-00-00-Mundial', cc: '00-00-00', cuenta: '4-2-10-60-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Ingresos Mercantiles', grupo: 'VENTAS', metodo: 'm_venta', valor: null, combinada: '4-2-10-50-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '4-2-10-50-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Merma', grupo: 'VENTAS', metodo: 'm_pct_venta', valor: 0.002, combinada: '5-2-99-15-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '5-2-99-15-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Personal Fijo', grupo: 'GOP', metodo: 'm_promedio', valor: 120589, combinada: '5-1-05-03-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '5-1-05-03-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Gastos Varios', grupo: 'GOP', metodo: 'm_promedio', valor: 36667, combinada: '4-2-10-40-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '4-2-10-40-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Alquileres', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.02, combinada: '5-1-20-10-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '5-1-20-10-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Tributos', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.013, combinada: '5-1-15-05-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '5-1-15-05-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Incobrables', grupo: 'GOP', metodo: 'm_pct_venta', valor: 0.003, combinada: '5-2-99-10-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '5-2-99-10-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Fletes', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '5-2-35-50-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '5-2-35-50-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Logistico', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '5-1-05-06-00-11-00-00-Mundial', cc: '11-00-00', cuenta: '5-1-05-06-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Otros egresos', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '4-2-10-10-00-00-00-00-Mundial', cc: '00-00-00', cuenta: '4-2-10-10-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Intereses', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '4-2-10-05-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '4-2-10-05-00', tasaMensual: 3126.78 },
  { empresa: 'Mundial', concepto: 'Depreciacion', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '5-1-60-05-00-0-00-00-Mundial', cc: '0-00-00', cuenta: '5-1-60-05-00', tasaMensual: 3126.78 },

  // ── Prisma ──
  { empresa: 'Prisma', concepto: 'Colocacion', grupo: 'VENTAS', metodo: 'm_derivada', valor: null, combinada: '6.1.1.20.1.001-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '6.1.1.20.1.001', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'Ingresos Mercantiles', grupo: 'VENTAS', metodo: 'm_promedio', valor: null, combinada: '6.1.1.12.1.996-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '6.1.1.12.1.996', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'Personal Fijo', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.2.01.1.009-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '6.1.2.01.1.009', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'Gastos Varios', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.2.01.1.036-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '6.1.2.01.1.036', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'Tributos', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.2.01.1.046-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '6.1.2.01.1.046', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'Logistico', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '7.1.3.04.1.005-01.01.089.01-Prisma', cc: '01.01.089.01', cuenta: '7.1.3.04.1.005', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'IVA Atrapado', grupo: 'GOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.12.1.994-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '6.1.1.12.1.994', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'Otros egresos', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.05.1.001-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '6.1.1.05.1.001', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'Intereses', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '6.1.1.15.1.001-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '6.1.1.15.1.001', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'Depreciacion', grupo: 'GANOP', metodo: 'm_promedio', valor: null, combinada: '7.1.3.05.1.001-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '7.1.3.05.1.001', tasaMensual: null },
  { empresa: 'Prisma', concepto: 'ISLR', grupo: 'SEMI', metodo: 'm_promedio', valor: null, combinada: '7.1.4.01.1.047-00.00.000.00-Prisma', cc: '00.00.000.00', cuenta: '7.1.4.01.1.047', tasaMensual: null },
];

// Guardas de desarrollo: la semilla debe tener exactamente 95 reglas.
export const TOTAL_REGLAS_ESPERADO = 95;

export type { Operacion, GrupoPL, Base };
