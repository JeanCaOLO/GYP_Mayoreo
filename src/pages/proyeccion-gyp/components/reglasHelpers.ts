/**
 * Apoyo de la pestaña Reglas (tarea 16.2).
 *
 * Aquí viven las funciones PURAS que la pestaña y sus paneles comparten:
 *   - El bloque del P&L al que pertenece cada regla (CP-48): Venta y margen ·
 *     Gastos operativos · Otros, intereses y depreciación · Impuesto.
 *   - La frase «cómo se estima» de una fila (CP-24).
 *   - Las etiquetas de fila (CP-48): `cuenta`, `nueva`, `sin N ctas`,
 *     `sin detalle`, `solo proyectado`, `solo causado`.
 *   - Las ocho validaciones de CP-50 (Requirement 23.1 / 23.2); solo la octava
 *     bloquea.
 *
 * No depende de React ni de Supabase, para poder razonarse y probarse sola.
 */

import {
  detectarCiclos,
  formula,
  type GrupoPL,
  type Metodo,
  type Regla,
} from '../engine';

// ─────────────────────────────────────────────────────────────────────────────
// Bloques del P&L (CP-48)
// ─────────────────────────────────────────────────────────────────────────────

/** Los cuatro bloques del P&L en los que se agrupan las reglas (CP-48). */
export type BloquePL = 'VENTA_MARGEN' | 'GASTOS_OP' | 'OTROS' | 'IMPUESTO';

/** Orden y etiqueta de cada bloque del P&L (CP-48). */
export const BLOQUES_PL: { id: BloquePL; label: string }[] = [
  { id: 'VENTA_MARGEN', label: 'Venta y margen' },
  { id: 'GASTOS_OP', label: 'Gastos operativos' },
  { id: 'OTROS', label: 'Otros, intereses y depreciación' },
  { id: 'IMPUESTO', label: 'Impuesto' },
];

/** Conceptos que el P&L trata como impuesto (por coincidencia de texto). */
const CONCEPTOS_IMPUESTO = ['impuesto', 'islr', 'iva'];

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Bloque del P&L de una regla (CP-48). Se deriva de su grupo contable:
 *   - VENTAS → Venta y margen
 *   - GOP    → Gastos operativos
 *   - GANOP  → Otros, intereses y depreciación
 *   - SEMI o conceptos de impuesto → Impuesto
 * Los conceptos de impuesto se detectan por nombre para separarlos del resto.
 */
export function bloqueDeRegla(regla: Pick<Regla, 'grupo' | 'concepto'>): BloquePL {
  if (CONCEPTOS_IMPUESTO.some((k) => normalizar(regla.concepto).includes(k))) return 'IMPUESTO';
  const g: GrupoPL = regla.grupo;
  if (g === 'VENTAS') return 'VENTA_MARGEN';
  if (g === 'GOP') return 'GASTOS_OP';
  if (g === 'GANOP') return 'OTROS';
  return 'IMPUESTO';
}

// ─────────────────────────────────────────────────────────────────────────────
// Frase «cómo se estima» (CP-24)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Describe en una frase cómo se estima una regla (CP-24), p. ej. «Lo típico de
 * 9 meses», «0,50 % de la venta», «Monto fijo». Usa el método y el valor de la
 * regla. No incluye el causado (eso lo muestra el bloque Avanzado).
 */
export function comoSeEstima(regla: Regla, metodo: Metodo | undefined): string {
  if (!metodo) return regla.metodo;
  const n = regla.n ?? 9;
  const v = regla.valor ?? metodo.valor ?? 0;
  switch (metodo.op) {
    case 'promedio':
      return `El promedio de ${n} meses`;
    case 'mediana':
      return `Lo típico de ${n} meses`;
    case 'ultimo':
      return 'Igual que el mes pasado';
    case 'ratio_venta':
      return `Según la venta (${n} meses)`;
    case 'formula_venta':
      return 'Como va el mes';
    case 'derivada':
      return 'Del Cargo Fijo del grupo';
    case 'presupuesto':
      return 'Lo presupuestado';
    case 'valor_fijo':
      return `Monto fijo (${Math.round(v).toLocaleString('es-VE')})`;
    case 'porcentaje':
      return `${(v * 100).toLocaleString('es-VE', { maximumFractionDigits: 2 })} % de ${baseCorta(metodo)}`;
    case 'multiplicar':
      return `${v} × ${baseCorta(metodo)}`;
    case 'sumar':
    case 'restar':
      return formula(metodo);
    default:
      return metodo.nombre;
  }
}

function baseCorta(m: Metodo): string {
  switch (m.base) {
    case 'venta':
      return 'la venta';
    case 'semineto':
      return 'el Semi Neto';
    case 'g:VENTAS':
      return 'el grupo Ventas';
    case 'g:GOP':
      return 'los Gastos Op.';
    case 'g:GANOP':
      return 'Otros/Int./Depr.';
    default:
      if (typeof m.base === 'string' && m.base.indexOf('c:') === 0) return m.base.slice(2);
      return 'la base';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Etiquetas de fila (CP-48)
// ─────────────────────────────────────────────────────────────────────────────

export type EtiquetaFila =
  | 'cuenta'
  | 'nueva'
  | 'sin N ctas'
  | 'sin detalle'
  | 'solo proyectado'
  | 'solo causado';

/** Significado de cada etiqueta (para el `title` del chip). */
export const ETIQUETA_TITULO: Record<EtiquetaFila, string> = {
  cuenta: 'Regla de una sola cuenta',
  nueva: 'Creada por un usuario',
  'sin N ctas': 'El concepto excluye cuentas que tienen regla propia',
  'sin detalle': 'Falta el detalle por cuenta: la regla vale 0',
  'solo proyectado': 'Solo cuenta en el escenario proyectado (CP-49)',
  'solo causado': 'Solo cuenta en el escenario causado (CP-49)',
};

/**
 * Etiquetas de una fila de regla (CP-48). `cuentasPropias` es el nº de cuentas
 * con regla propia dentro del concepto (para «sin N ctas»); `sinDetalle` indica
 * que una regla por cuenta no tiene detalle cargado (vale 0).
 */
export function etiquetasDeFila(
  regla: Regla,
  opts: { cuentasPropias?: number; sinDetalle?: boolean } = {},
): { etiqueta: EtiquetaFila; texto: string }[] {
  const out: { etiqueta: EtiquetaFila; texto: string }[] = [];
  if (regla.nivel === 'cuenta') out.push({ etiqueta: 'cuenta', texto: 'cuenta' });
  if (regla.nueva) out.push({ etiqueta: 'nueva', texto: 'nueva' });
  if (regla.nivel !== 'cuenta' && opts.cuentasPropias)
    out.push({ etiqueta: 'sin N ctas', texto: `sin ${opts.cuentasPropias} ctas` });
  if (opts.sinDetalle) out.push({ etiqueta: 'sin detalle', texto: 'sin detalle' });
  const esc = regla.escenarios ?? 'AMBOS';
  if (esc === 'PROYECCION') out.push({ etiqueta: 'solo proyectado', texto: 'solo proyectado' });
  if (esc === 'CAUSADO') out.push({ etiqueta: 'solo causado', texto: 'solo causado' });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Las ocho validaciones (CP-50, Requirement 23.1 / 23.2)
// ─────────────────────────────────────────────────────────────────────────────

/** Una validación de CP-50. `bloquea` solo es true en la octava. */
export interface Validacion {
  /** 1..8 según el orden de CP-50. */
  n: number;
  titulo: string;
  /** detalles concretos (empresas/cuentas afectadas). */
  detalles: string[];
  /** true solo en la octava (errores al guardar fórmulas, incl. ciclos). */
  bloquea: boolean;
}

/** ¿El método de la regla usa la historia? (para la validación 3, CP-21). */
function metodoUsaHistoria(m: Metodo | undefined): boolean {
  if (!m) return false;
  return ['promedio', 'mediana', 'ultimo', 'ratio_venta', 'formula_venta'].includes(m.op);
}

/**
 * Calcula las ocho validaciones de CP-50 sobre el estado actual (Requirement
 * 23.1). Reutiliza `detectarCiclos` del motor para la octava (CP-51). Ninguna
 * bloquea salvo la octava (Requirement 23.2): esa marca `bloquea = true` cuando
 * hay un ciclo u otro error de guardado de fórmulas.
 *
 * @param reglas   reglas activas de trabajo.
 * @param metodos  métodos efectivos.
 * @param val      monto proyectado por regla (para el signo, validación 6).
 * @param empresas empresas del P&L (para «sin regla de ingreso», validación 5).
 * @param opts     avisos externos: reparto, detalle por cuenta y alertas.
 */
export function calcularValidaciones(
  reglas: Regla[],
  metodos: Record<string, Metodo>,
  val: number[],
  empresas: readonly string[],
  opts: {
    avisosReparto?: string[];
    reglasCuentaSinDetalle?: string[];
    cuentasFueraCatalogo?: number;
    erroresFormula?: string[];
    /** ¿La regla lleva un nombre que justifica el doble conteo? (validación 1). */
    tieneNombre?: (regla: Regla) => boolean;
  } = {},
): Validacion[] {
  const tieneNombre = opts.tieneNombre ?? (() => false);
  const out: Validacion[] = [];

  // 1 · Dos o más reglas a la misma cuenta sin nombre que lo justifique.
  const dobleConteo: string[] = [];
  const porCuenta = new Map<string, Regla[]>();
  reglas.forEach((r) => {
    const k = r.empresa + '|' + r.combinada;
    const arr = porCuenta.get(k) ?? [];
    arr.push(r);
    porCuenta.set(k, arr);
  });
  porCuenta.forEach((arr, k) => {
    if (arr.length > 1 && arr.every((r) => !tieneNombre(r))) {
      dobleConteo.push(`${arr.length} reglas sobre ${k.split('|')[1]} sin nombre que lo separe.`);
    }
  });
  out.push({ n: 1, titulo: 'Posible doble conteo a la misma cuenta', detalles: dobleConteo, bloquea: false });

  // 2 · Avisos de reparto (sin historia, sin cuentas que cumplan capas, detalle
  //     no cargado). Vienen de fuera (destino.ts); aquí solo se listan.
  out.push({
    n: 2,
    titulo: 'Avisos de reparto',
    detalles: opts.avisosReparto ?? [],
    bloquea: false,
  });

  // 3 · Conceptos con cuentas de regla propia cuyo método NO usa la historia.
  const sinHistoria: string[] = [];
  const conceptosConCuenta = new Set(
    reglas.filter((r) => r.nivel === 'cuenta').map((r) => r.empresa + '|' + r.concepto),
  );
  reglas.forEach((r) => {
    if (r.nivel === 'cuenta') return;
    const key = r.empresa + '|' + r.concepto;
    if (conceptosConCuenta.has(key) && !metodoUsaHistoria(metodos[r.metodo])) {
      sinHistoria.push(`${r.empresa} / ${r.concepto}: tiene cuentas aparte pero su método no usa historia.`);
    }
  });
  out.push({
    n: 3,
    titulo: 'Reglas por cuenta cuyo concepto no usa historia (doble conteo)',
    detalles: sinHistoria,
    bloquea: false,
  });

  // 4 · Reglas por cuenta sin detalle por cuenta cargado (valen 0).
  out.push({
    n: 4,
    titulo: 'Reglas por cuenta sin detalle cargado (valen 0)',
    detalles: opts.reglasCuentaSinDetalle ?? [],
    bloquea: false,
  });

  // 5 · Empresas sin regla de ingreso → venta proyectada cero.
  const sinIngreso: string[] = [];
  empresas.forEach((e) => {
    const tiene = reglas.some(
      (r) =>
        r.empresa === e &&
        (r.concepto === 'Ventas' || (metodos[r.metodo] || ({} as Metodo)).op === 'derivada'),
    );
    if (!tiene) sinIngreso.push(`${e} se quedó sin regla de ingreso: su venta proyectada es cero.`);
  });
  out.push({ n: 5, titulo: 'Empresas sin regla de ingreso', detalles: sinIngreso, bloquea: false });

  // 6 · Resultados con signo contrario a su historia, fuera del grupo Ventas.
  const signos: string[] = [];
  reglas.forEach((r, i) => {
    const m = metodos[r.metodo];
    if (r.grupo === 'VENTAS') return;
    const v = val[i] ?? 0;
    if (v < 0 && m && m.op !== 'promedio' && m.op !== 'mediana') {
      signos.push(`${r.empresa} / ${r.concepto}: da ${Math.round(v).toLocaleString('es-VE')} (signo a revisar).`);
    }
  });
  out.push({ n: 6, titulo: 'Resultados con signo contrario a su historia', detalles: signos, bloquea: false });

  // 7 · Cuentas con movimiento fuera del catálogo → remite a Alertas.
  const fuera = opts.cuentasFueraCatalogo ?? 0;
  out.push({
    n: 7,
    titulo: 'Cuentas con movimiento fuera del catálogo',
    detalles: fuera ? [`${fuera} cuenta(s) fuera del catálogo. Revísalas en la pestaña Alertas.`] : [],
    bloquea: false,
  });

  // 8 · Al guardar fórmulas: errores de capas/piezas y dependencias circulares
  //     (CP-51). Es la ÚNICA que bloquea (Requirement 23.2).
  const erroresFormula = [...(opts.erroresFormula ?? [])];
  const ciclo = detectarCiclos(reglas, metodos);
  if (ciclo) {
    erroresFormula.push(
      `Dependencia circular: ${ciclo.map((c) => c.split('|')[1] ?? c).join(' → ')}. Rómpela para poder guardar.`,
    );
  }
  out.push({
    n: 8,
    titulo: 'Errores al guardar fórmulas (bloquean)',
    detalles: erroresFormula,
    bloquea: erroresFormula.length > 0,
  });

  return out;
}

/** ¿Alguna validación bloquea el guardado? (solo la octava, Requirement 23.2). */
export function hayBloqueo(validaciones: Validacion[]): boolean {
  return validaciones.some((v) => v.bloquea && v.detalles.length > 0);
}

/** Total de incidencias a revisar (para el encabezado «N cosas por revisar»). */
export function totalIncidencias(validaciones: Validacion[]): number {
  return validaciones.reduce((a, v) => a + v.detalles.length, 0);
}
