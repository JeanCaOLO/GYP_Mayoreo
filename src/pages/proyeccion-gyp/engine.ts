/**
 * Motor de cálculo de la Proyección del GyP Mayoreo.
 *
 * Es una función PURA: mismos datos de entrada → mismo resultado. Está separada
 * de la interfaz para poder probarse sola contra las cifras de aceptación.
 *
 * Portado 1:1 desde el prototipo ejecutable (demo.html) del paquete
 * "Proyeccion_GyP_Aplicativo". Reproduce las seis empresas al dólar.
 *
 * Las 8 operaciones, las bases, los 5 turnos y los signos están documentados en
 * documentacion/01-motor-de-calculo.md. No cambiar la aritmética sin volver a
 * correr la prueba de aceptación (ver seed.ts → CIFRAS_VALIDADAS).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type Operacion =
  | 'porcentaje'
  | 'multiplicar'
  | 'sumar'
  | 'restar'
  | 'valor_fijo'
  | 'promedio'
  | 'formula_venta'
  | 'derivada';

export type GrupoPL = 'VENTAS' | 'GOP' | 'GANOP' | 'SEMI';

/** Base de un método. 'g:*' = total de grupo, 'c:*' = concepto. */
export type Base =
  | 'ninguna'
  | 'venta'
  | 'semineto'
  | 'g:VENTAS'
  | 'g:GOP'
  | 'g:GANOP'
  | `c:${string}`;

export interface Metodo {
  id: string;
  nombre: string;
  op: Operacion;
  base: Base;
  /** Valor por defecto. En porcentaje va en tanto por uno (0.01 = 1%). */
  valor: number | null;
  invertir: boolean;
  /** Turno 1..5: cuándo se calcula. */
  orden: number;
  /** true = método de fábrica (no se puede perder sin reasignar). */
  fijo: boolean;
}

export interface Parametro {
  empresa: string;
  dias: number;
  trans: number;
  factor: number;
  tasa: number;
}

export interface Regla {
  key: string;
  empresa: string;
  concepto: string;
  grupo: GrupoPL;
  metodo: string;
  /** Sobrescribe el valor por defecto del método. */
  valor: number | null;
  /** Meses a promediar; sólo si la operación es 'promedio'. */
  n: number | null;
  combinada: string;
  cc: string;
  cuenta: string;
  pais: string;
  tasaMensual: number | null;
  /** Serie histórica mensual de la cuenta (los últimos N meses). */
  serie: number[];
  /** Acumulado del mes en curso. */
  acum: number;
  nueva: boolean;
}

export interface AgregadoEmpresa {
  /** Renta Bruta. */
  rb: number;
  /** Total Gastos Operativos. */
  go: number;
  /** Ganancia Operativa. */
  gop: number;
  /** Semi Neto. */
  sn: number;
  /** Ingresos proyectados (venta en positivo). */
  ing: number;
}

export interface ResultadoCalculo {
  /** Monto USD por cada regla, en el mismo orden del arreglo de entrada. */
  val: number[];
  /** Venta proyectada por empresa (signo crudo, negativo). */
  venta: Record<string, number>;
  /** Agregados del P&L por empresa. */
  agg: Record<string, AgregadoEmpresa>;
  hecho: boolean[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de presentación (etiquetas de la interfaz)
// ─────────────────────────────────────────────────────────────────────────────

export const OPS: Record<Operacion, string> = {
  porcentaje: 'Porcentaje de',
  multiplicar: 'Multiplicar por',
  sumar: 'Sumar a',
  restar: 'Restar de',
  valor_fijo: 'Monto fijo',
  promedio: 'Promedio histórico',
  formula_venta: 'Fórmula de venta',
  derivada: 'Suma de otro concepto',
};

export const BASES: Record<string, string> = {
  ninguna: '(sin base)',
  venta: 'Venta proyectada',
  semineto: 'Semi Neto proyectado',
  'g:VENTAS': 'Total del grupo Ventas',
  'g:GOP': 'Total de Gastos Operativos',
  'g:GANOP': 'Total de Otros / Intereses / Depreciación',
};

export const GRUPOS: Record<GrupoPL, string> = {
  VENTAS: 'Ventas',
  GOP: 'Gastos Operativos',
  GANOP: 'Otros / Int. / Depr.',
  SEMI: 'Semi Neto',
};

/**
 * El cálculo se hace por turnos. Cada turno se describe por lo que ya está listo
 * cuando llega, que es lo único que el usuario necesita entender para elegirlo.
 */
export const TURNOS: Record<number, string> = {
  1: 'Primero de todo · no necesita ningún otro resultado',
  2: 'Cuando ya están la historia y los montos fijos',
  3: 'Cuando ya está la venta proyectada',
  4: 'Cuando ya están los totales por grupo del P&L',
  5: 'Al final · cuando ya está armado el Semi Neto',
};

export const TURNO_CORTO: Record<number, string> = {
  1: 'primero',
  2: 'tras la historia',
  3: 'tras la venta',
  4: 'tras los grupos',
  5: 'al final',
};

const TURNO_DE_BASE: Record<string, number> = { ninguna: 2, venta: 3, semineto: 5 };

/** Turno sugerido según la base. g:* y c:* → 4. */
export const turnoSugerido = (b: string): number => TURNO_DE_BASE[b] || 4;

/** País derivado de la empresa (el catálogo no es confiable). */
export const PAIS: Record<string, string> = {
  Beval: 'Venezuela',
  Sillaca: 'Venezuela',
  Febeca: 'Venezuela',
  Prisma: 'Venezuela',
  Cofersa: 'Costa Rica',
  Mundial: 'Colombia',
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Promedio de los últimos n meses de una serie, contando SOLO los meses con
 * registro. Un mes sin movimiento (null) no cuenta como cero (trampa 2).
 */
export function prom(serie: number[], n: number): number {
  const a = serie.slice(-n).filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

/** Fórmula de un método en texto plano, para la interfaz. */
export function formula(m: Pick<Metodo, 'op' | 'base' | 'invertir'>): string {
  if (m.op === 'formula_venta') return 'acumulado + promedio × días restantes, con factor';
  if (m.op === 'promedio') return 'promedio de los últimos N meses';
  if (m.op === 'derivada') return '−(suma de Cargo Fijo de las demás empresas)';
  if (m.op === 'valor_fijo') return (m.invertir ? '−' : '') + 'valor';
  const sg = m.invertir ? '−' : '';
  const b = BASES[m.base] || m.base;
  if (m.op === 'porcentaje') return sg + 'valor % × ' + b;
  if (m.op === 'multiplicar') return sg + 'valor × ' + b;
  if (m.op === 'sumar') return sg + '(' + b + ' + valor)';
  if (m.op === 'restar') return sg + '(' + b + ' − valor)';
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// El motor
// ─────────────────────────────────────────────────────────────────────────────

export interface CalcularOpts {
  reglas: Regla[];
  metodos: Record<string, Metodo>;
  params: Record<string, Parametro>;
  empresas: string[];
  /** Promedio por defecto (N) para las reglas de promedio sin N propio. */
  gn: number;
}

/**
 * Calcula el monto USD de cada regla, resolviendo por turnos (1..5).
 * Una base sólo puede leer lo que se calculó en turnos anteriores: esa es la
 * regla que impide la referencia circular.
 */
export function calcular({ reglas: R, metodos: M, params, empresas, gn }: CalcularOpts): ResultadoCalculo {
  const val = new Array<number>(R.length).fill(0);
  const hecho = new Array<boolean>(R.length).fill(false);
  const venta: Record<string, number> = {};

  const pasadas = [...new Set(Object.values(M).map((m) => m.orden))].sort((a, b) => a - b);

  let grupo: Record<string, Record<GrupoPL, number>> = {};
  let agg: Record<string, AgregadoEmpresa> = {};

  const recalcular = () => {
    grupo = {};
    agg = {};
    for (const e of empresas) {
      const s: Record<GrupoPL, number> = { VENTAS: 0, GOP: 0, GANOP: 0, SEMI: 0 };
      R.forEach((r, i) => {
        if (hecho[i] && r.empresa === e) s[r.grupo] += val[i];
      });
      grupo[e] = s;
      const rb = -s.VENTAS;
      const gop = rb - s.GOP;
      agg[e] = { rb, go: s.GOP, gop, sn: gop - s.GANOP, ing: -(venta[e] || 0) };
    }
  };

  const baseDe = (r: Regla, m: Metodo): number => {
    if (m.base === 'venta') return venta[r.empresa] || 0;
    if (m.base === 'semineto') return agg[r.empresa] ? agg[r.empresa].sn : 0;
    if (m.base.indexOf('g:') === 0) {
      const g = m.base.slice(2) as GrupoPL;
      return grupo[r.empresa] ? grupo[r.empresa][g] || 0 : 0;
    }
    if (m.base.indexOf('c:') === 0) {
      const concepto = m.base.slice(2);
      const j = R.findIndex((x) => x.empresa === r.empresa && x.concepto === concepto);
      return j >= 0 && hecho[j] ? val[j] : 0;
    }
    return 0;
  };

  recalcular();

  for (const p of pasadas) {
    R.forEach((r, i) => {
      const m = M[r.metodo];
      if (!m || m.orden !== p || hecho[i]) return;

      const v = r.valor != null ? r.valor : m.valor != null ? m.valor : 0;
      const n = r.n || gn;
      let res: number;

      if (m.op === 'formula_venta') {
        // Respaldo obligatorio: sin acumulado, cae a promedio (trampa Ingresos en cero).
        if (!r.acum) {
          res = prom(r.serie, n);
        } else {
          const q = params[r.empresa];
          const rest = q.dias - q.trans;
          const ps = q.trans ? r.acum / q.trans : 0;
          res = r.acum + (rest - 5 > 0 ? ps * (rest - 5) : 0) + Math.min(rest, 5) * ps * q.factor;
        }
      } else if (m.op === 'promedio') {
        res = prom(r.serie, n);
      } else if (m.op === 'valor_fijo') {
        res = (m.invertir ? -1 : 1) * v;
      } else if (m.op === 'derivada') {
        // Colocación de Prisma = −(suma del Cargo Fijo de las demás empresas).
        let cf = 0;
        R.forEach((x, j) => {
          if (x.concepto === 'Cargo Fijo' && x.empresa !== 'Prisma' && hecho[j]) cf += val[j];
        });
        res = -cf;
      } else {
        const b = baseDe(r, m);
        let x: number;
        if (m.op === 'porcentaje' || m.op === 'multiplicar') x = v * b;
        else if (m.op === 'sumar') x = b + v;
        else if (m.op === 'restar') x = b - v;
        else x = v;
        res = (m.invertir ? -1 : 1) * x;
      }

      val[i] = res;
      hecho[i] = true;
      if (r.concepto === 'Ventas' || m.op === 'derivada') venta[r.empresa] = res;
    });
    recalcular();
  }

  return { val, venta, agg, hecho };
}
