/**
 * Recomendación y prueba de acierto — backtest WAPE (Parte II §G).
 *
 * Es una función PURA: mismas series de entrada → mismo resultado. No depende de
 * la interfaz ni de Supabase, para poder probarse sola (unit test 15.2) y para
 * que la pestaña Reglas (16.2) la consuma sin estado.
 *
 * ── Qué hace (§G) ──
 * Para cada opción de estimación se pronostica cada uno de los ÚLTIMOS 6 MESES
 * CERRADOS usando SOLO la historia anterior a ese mes, y se mide el error:
 *
 *   error = Σ |pronóstico − real| ÷ Σ |real|            (WAPE)
 *
 * - Lo que depende de la venta se prueba DOS VECES —con la venta real y con una
 *   venta mal proyectada (promedio de 3 meses)— y se PROMEDIAN. Así una opción
 *   no gana apoyándose en un acierto de la venta que no vamos a tener.
 * - La RECOMENDADA es la de menor error entre: lo típico (mediana), el promedio,
 *   según la venta (proporción) con 3/6/9/12 meses, e igual que el mes pasado.
 * - A MENOS DE 1 PUNTO de diferencia se prefiere lo típico (la mediana), que
 *   resiste mejor un mes atípico.
 * - Si la opción ACTUAL acierta casi igual (dentro de 1 punto del mejor), se
 *   recomienda quedarse.
 * - Excepciones: Ventas, Costo de Ventas y Fletes Recuperados → «Como va el mes»
 *   (fórmula de venta); Colocación → derivada. En esos conceptos no se recomienda
 *   una opción de historia: su método está fijado por el negocio.
 * - Otros egresos, Ingresos Mercantiles e Intereses: si la mejor opción se
 *   equivoca más de ±50 %, se sugiere revisarlos a mano en cada cierre.
 * - En reglas adicionales de un concepto que ya tiene la suya, NO se muestra
 *   acierto (lo decide la interfaz, que no llama a `recomendar` en ese caso).
 *
 * Semáforo: verde ≤ 10 %, ámbar ≤ 25 %, rojo > 25 %.
 *
 * ── Reutiliza el motor ──
 * Las estimaciones (`prom`, `mediana`, `ultimo`, `sumaN`) vienen de `engine.ts`
 * para no duplicar aritmética; el backtest solo las aplica sobre recortes de la
 * historia anterior a cada mes.
 *
 * _Requirements: 18.3_
 */

import { prom, mediana, ultimo, sumaN } from './engine';

// ─────────────────────────────────────────────────────────────────────────────
// Opciones de estimación (§D) en lenguaje llano
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las once opciones del §D tal como se presentan en pantalla. El backtest solo
 * prueba las que dependen de la historia o de la venta (ver `OPCIONES_BACKTEST`);
 * el resto son fijas, de usuario o no admiten prueba de acierto.
 */
export type OpcionEstimacion =
  | 'tipico' // Lo típico (mediana)
  | 'promedio' // El promedio
  | 'ultimo' // Igual que el mes pasado (último cerrado)
  | 'ratio_venta' // Según la venta (proporción histórica)
  | 'pct_venta' // Un % de la venta
  | 'formula_venta' // Como va el mes (fórmula de venta)
  | 'presupuesto' // Lo presupuestado
  | 'fijo' // Un monto fijo
  | 'pct_semineto' // Un % del Semi Neto
  | 'derivada' // Del Cargo Fijo del grupo
  | 'formula_propia'; // Armar mi fórmula

/** Etiqueta en lenguaje llano de cada opción (para la interfaz). */
export const OPCION_LABEL: Record<OpcionEstimacion, string> = {
  tipico: 'Lo típico',
  promedio: 'El promedio',
  ultimo: 'Igual que el mes pasado',
  ratio_venta: 'Según la venta',
  pct_venta: 'Un % de la venta',
  formula_venta: 'Como va el mes',
  presupuesto: 'Lo presupuestado',
  fijo: 'Un monto fijo',
  pct_semineto: 'Un % del Semi Neto',
  derivada: 'Del Cargo Fijo del grupo',
  formula_propia: 'Armar mi fórmula',
};

/**
 * Una opción candidata del backtest: su tipo y, para «según la venta», la
 * ventana de meses (3, 6, 9, 12). Se identifica por `clave` estable para que la
 * interfaz asocie el error a la tarjeta correcta.
 */
export interface OpcionBacktest {
  tipo: 'tipico' | 'promedio' | 'ultimo' | 'ratio_venta';
  /** meses a mirar; solo relevante para `promedio`, `tipico` y `ratio_venta`. */
  n?: number;
  /** clave estable, p. ej. 'tipico', 'ratio_venta:6'. */
  clave: string;
  /** etiqueta en lenguaje llano para la tarjeta. */
  etiqueta: string;
}

/** N por defecto del §D para lo típico y el promedio. */
const N_DEFECTO = 9;

/** Ventanas de la proporción «según la venta» (§G). */
const VENTANAS_RATIO = [3, 6, 9, 12];

/**
 * Las opciones que el backtest compara (§G): lo típico, el promedio, igual que
 * el mes pasado y según la venta con 3/6/9/12 meses.
 */
export const OPCIONES_BACKTEST: OpcionBacktest[] = [
  { tipo: 'tipico', n: N_DEFECTO, clave: 'tipico', etiqueta: OPCION_LABEL.tipico },
  { tipo: 'promedio', n: N_DEFECTO, clave: 'promedio', etiqueta: OPCION_LABEL.promedio },
  { tipo: 'ultimo', clave: 'ultimo', etiqueta: OPCION_LABEL.ultimo },
  ...VENTANAS_RATIO.map((n) => ({
    tipo: 'ratio_venta' as const,
    n,
    clave: `ratio_venta:${n}`,
    etiqueta: `${OPCION_LABEL.ratio_venta} (${n} meses)`,
  })),
];

// ─────────────────────────────────────────────────────────────────────────────
// Semáforo (§G)
// ─────────────────────────────────────────────────────────────────────────────

export type Semaforo = 'verde' | 'ambar' | 'rojo';

/** verde ≤ 10 %, ámbar ≤ 25 %, rojo > 25 % (§G). El error va en tanto por uno. */
export function semaforoDeError(error: number): Semaforo {
  if (error <= 0.1) return 'verde';
  if (error <= 0.25) return 'ambar';
  return 'rojo';
}

/** Meses cerrados que se pronostican hacia atrás (§G). */
const MESES_BACKTEST = 6;

/** Tolerancia de empate: «menos de 1 punto» de WAPE = 0,01 en tanto por uno. */
const UN_PUNTO = 0.01;

/** Umbral de «se equivoca más de ±50 %» para sugerir revisar a mano (§G). */
const UMBRAL_REVISAR = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// WAPE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error WAPE entre pronósticos y reales (§G):
 *
 *   error = Σ |pronóstico − real| ÷ Σ |real|
 *
 * - Ambos arreglos deben tener el mismo largo (pares mes a mes).
 * - Si Σ|real| = 0 el cociente no está definido: devuelve 0 cuando el numerador
 *   también es 0 (pronóstico perfecto sobre ceros) y +∞ en otro caso, de modo que
 *   una opción que inventa monto sobre meses reales en cero nunca gana.
 */
export function wape(pronosticos: number[], reales: number[]): number {
  const m = Math.min(pronosticos.length, reales.length);
  let num = 0;
  let den = 0;
  for (let i = 0; i < m; i++) {
    num += Math.abs(pronosticos[i] - reales[i]);
    den += Math.abs(reales[i]);
  }
  if (den === 0) return num === 0 ? 0 : Number.POSITIVE_INFINITY;
  return num / den;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pronóstico de una opción sobre un recorte de historia
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estima un mes con la opción dada usando SOLO la historia `previa` (los meses
 * anteriores al que se pronostica). Para «según la venta» hace falta además la
 * venta de esos meses (`ventaPrevia`) y la venta del mes pronosticado
 * (`ventaMes`): el ratio histórico concepto÷venta se aplica a la venta del mes.
 */
export function pronosticar(
  opcion: OpcionBacktest,
  previa: number[],
  ventaPrevia: number[],
  ventaMes: number,
): number {
  const n = opcion.n ?? N_DEFECTO;
  switch (opcion.tipo) {
    case 'tipico':
      return mediana(previa, n);
    case 'promedio':
      return prom(previa, n);
    case 'ultimo':
      return ultimo(previa);
    case 'ratio_venta': {
      const sumaVenta = sumaN(ventaPrevia, n);
      if (sumaVenta === 0) return 0;
      const ratio = sumaN(previa, n) / sumaVenta;
      return ratio * ventaMes;
    }
    default:
      return 0;
  }
}

/** ¿La opción depende de la venta? (se prueba dos veces, §G). */
export function dependeDeVenta(opcion: OpcionBacktest): boolean {
  return opcion.tipo === 'ratio_venta';
}

// ─────────────────────────────────────────────────────────────────────────────
// Backtest de una opción
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Datos de venta de la empresa para el backtest de las opciones «según la venta».
 * Alineados mes a mes con `serie` (misma longitud y mismos meses). Opcional:
 * una opción que no depende de la venta no lo necesita.
 */
export interface SerieVenta {
  /** venta de la empresa, mes a mes, alineada con la serie del concepto. */
  valores: number[];
}

/**
 * Backtest de UNA opción sobre la serie del concepto (§G).
 *
 * Toma los últimos 6 meses cerrados con los que se puede medir (hace falta al
 * menos un mes de historia anterior) y pronostica cada uno usando solo la
 * historia previa. Devuelve el WAPE.
 *
 * Para «según la venta» se prueba DOS VECES y se promedia:
 *   1. con la venta REAL de cada mes,
 *   2. con una venta MAL PROYECTADA = promedio de los 3 meses de venta anteriores.
 * Así la opción no se beneficia de una venta que acertamos de casualidad.
 *
 * Si no hay suficientes meses para medir ningún punto, devuelve +∞ (la opción no
 * puede recomendarse por falta de historia).
 */
export function backtestOpcion(
  serie: number[],
  opcion: OpcionBacktest,
  serieVenta?: SerieVenta,
): number {
  const L = serie.length;
  if (L < 2) return Number.POSITIVE_INFINITY;

  // Índices de los meses a pronosticar: los últimos 6 cerrados que tengan al
  // menos un mes de historia anterior (índice ≥ 1).
  const desde = Math.max(1, L - MESES_BACKTEST);
  const indices: number[] = [];
  for (let t = desde; t < L; t++) indices.push(t);
  if (indices.length === 0) return Number.POSITIVE_INFINITY;

  const venta = serieVenta?.valores ?? [];

  // Pasada con una venta dada (real o mal proyectada). `ventaDe(t)` devuelve la
  // venta a usar para el mes t; para la pasada «mal proyectada» es el promedio
  // de los 3 meses de venta anteriores a t.
  const pasada = (ventaDe: (t: number) => number): number => {
    const pron: number[] = [];
    const real: number[] = [];
    for (const t of indices) {
      const previa = serie.slice(0, t);
      const ventaPrevia = venta.slice(0, t);
      pron.push(pronosticar(opcion, previa, ventaPrevia, ventaDe(t)));
      real.push(serie[t]);
    }
    return wape(pron, real);
  };

  if (!dependeDeVenta(opcion)) {
    // No depende de la venta: una sola pasada (la venta no entra en el cálculo).
    return pasada(() => 0);
  }

  // Depende de la venta: dos pasadas promediadas (§G).
  const conVentaReal = pasada((t) => venta[t] ?? 0);
  const conVentaMala = pasada((t) => prom(venta.slice(0, t), 3));
  // Promedio de las dos pasadas; +∞ si cualquiera no es medible.
  if (!Number.isFinite(conVentaReal) || !Number.isFinite(conVentaMala)) {
    return Number.POSITIVE_INFINITY;
  }
  return (conVentaReal + conVentaMala) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recomendación
// ─────────────────────────────────────────────────────────────────────────────

/** Error de una opción candidata, con su semáforo, para la interfaz. */
export interface ErrorOpcion {
  clave: string;
  etiqueta: string;
  tipo: OpcionBacktest['tipo'];
  n?: number;
  /** WAPE en tanto por uno; +∞ si no es medible. */
  error: number;
  semaforo: Semaforo;
}

export interface Recomendacion {
  /** clave de la opción recomendada (p. ej. 'tipico', 'ratio_venta:6'); null si
   *  el concepto tiene método fijado por el negocio (excepciones del §G). */
  recomendada: string | null;
  /** errores por opción, ordenados de menor a mayor error. */
  errores: ErrorOpcion[];
  /** semáforo del error de la opción recomendada. */
  semaforo: Semaforo | null;
  /** true si la mejor opción se equivoca más de ±50 % y el concepto es de los
   *  que se sugiere revisar a mano (Otros egresos, Ingresos Mercantiles,
   *  Intereses). */
  revisarAMano: boolean;
  /** true si la opción ACTUAL acierta casi igual que la mejor (dentro de 1
   *  punto): entonces se recomienda quedarse. */
  quedarse: boolean;
  /** mensaje de excepción cuando el concepto tiene método fijado (o null). */
  excepcion: string | null;
}

/**
 * Conceptos con método fijado por el negocio (§G). La recomendación no propone
 * una opción de historia para ellos: su estimación está decidida.
 *
 * El emparejamiento es por coincidencia de texto (insensible a mayúsculas y
 * acentos) para tolerar variantes del nombre del concepto.
 */
const EXCEPCIONES_FORMULA_VENTA = ['ventas', 'costo de ventas', 'fletes recuperados'];
const EXCEPCION_DERIVADA = 'colocacion';

/** Conceptos que se sugieren revisar a mano si el error supera ±50 % (§G). */
const CONCEPTOS_REVISAR = ['otros egresos', 'ingresos mercantiles', 'intereses'];

/** Normaliza un nombre de concepto: minúsculas y sin acentos, para comparar. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function incluyeAlguno(concepto: string, claves: string[]): boolean {
  const c = normalizar(concepto);
  return claves.some((k) => c.includes(k));
}

/**
 * Recomienda la mejor opción de estimación para un concepto (§G).
 *
 * @param serie        histórico mensual del concepto/cuenta (orden cronológico).
 * @param concepto     nombre del concepto (para las excepciones del §G).
 * @param opcionActual clave de la opción vigente (para «quedarse» si acierta casi
 *                     igual); null si no hay una definida.
 * @param serieVenta   histórico mensual de la venta de la empresa, alineado con
 *                     `serie`; necesario para las opciones «según la venta».
 */
export function recomendar(
  serie: number[],
  concepto: string,
  opcionActual: string | null = null,
  serieVenta?: SerieVenta,
): Recomendacion {
  // Excepciones: conceptos con método fijado por el negocio (§G).
  if (incluyeAlguno(concepto, EXCEPCIONES_FORMULA_VENTA)) {
    return {
      recomendada: null,
      errores: [],
      semaforo: null,
      revisarAMano: false,
      quedarse: false,
      excepcion: 'Como va el mes',
    };
  }
  if (normalizar(concepto).includes(EXCEPCION_DERIVADA)) {
    return {
      recomendada: null,
      errores: [],
      semaforo: null,
      revisarAMano: false,
      quedarse: false,
      excepcion: 'Derivada (Cargo Fijo del grupo)',
    };
  }

  // Backtest de cada opción candidata.
  const errores: ErrorOpcion[] = OPCIONES_BACKTEST.map((op) => {
    const error = backtestOpcion(serie, op, serieVenta);
    return {
      clave: op.clave,
      etiqueta: op.etiqueta,
      tipo: op.tipo,
      n: op.n,
      error,
      semaforo: semaforoDeError(error),
    };
  }).sort((a, b) => a.error - b.error);

  const mejor = errores[0];
  // Sin ninguna opción medible (historia insuficiente): no se recomienda.
  if (!mejor || !Number.isFinite(mejor.error)) {
    return {
      recomendada: null,
      errores,
      semaforo: null,
      revisarAMano: false,
      quedarse: false,
      excepcion: null,
    };
  }

  // Desempate hacia lo típico (la mediana) a menos de 1 punto del mejor (§G).
  const tipico = errores.find((e) => e.tipo === 'tipico');
  let recomendada = mejor.clave;
  let semaforo = mejor.semaforo;
  if (tipico && Number.isFinite(tipico.error) && tipico.error - mejor.error < UN_PUNTO) {
    recomendada = tipico.clave;
    semaforo = tipico.semaforo;
  }

  // Si la opción ACTUAL acierta casi igual que la mejor (dentro de 1 punto), se
  // recomienda quedarse (§G).
  let quedarse = false;
  if (opcionActual) {
    const actual = errores.find((e) => e.clave === opcionActual);
    if (actual && Number.isFinite(actual.error) && actual.error - mejor.error < UN_PUNTO) {
      quedarse = true;
    }
  }

  // Otros egresos / Ingresos Mercantiles / Intereses: revisar a mano si la mejor
  // opción se equivoca más de ±50 % (§G).
  const revisarAMano = incluyeAlguno(concepto, CONCEPTOS_REVISAR) && mejor.error > UMBRAL_REVISAR;

  return {
    recomendada,
    errores,
    semaforo,
    revisarAMano,
    quedarse,
    excepcion: null,
  };
}
