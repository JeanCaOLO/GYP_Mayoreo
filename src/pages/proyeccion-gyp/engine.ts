/**
 * Motor de cálculo de la Proyección del GyP Mayoreo — v2.
 *
 * Es una función PURA: mismos datos de entrada → mismo resultado. Está separada
 * de la interfaz para poder probarse sola contra las cifras de aceptación.
 *
 * ── Modelo v2 (CP-18, Parte II §D del paquete 12-cambios-para-produccion) ──
 * Un método es una secuencia de `pasos`: fold de izquierda a derecha, sin
 * precedencia ni paréntesis. El primer paso parte de su base; cada siguiente
 * opera sobre el resultado del anterior.
 *
 * Operaciones: formula_venta, promedio, mediana, ultimo, ratio_venta,
 * porcentaje, presupuesto, valor_fijo, multiplicar, sumar, restar, componentes,
 * derivada.
 *
 * TRAMPA CRÍTICA CP-18: el `valor` de la regla sobrescribe el del paso SOLO en
 * métodos de un único paso. Con varios pasos NO se propaga a todos.
 *
 * ── Retrocompatibilidad ──
 * El tipo `Metodo` v1 (op/base/valor/invertir/orden) se conserva: la interfaz y
 * la capa de datos siguen trabajando con él. Internamente `calcular()` expresa
 * cada `Metodo` v1 como un `MetodoV2` de un solo paso equivalente a las 8
 * operaciones v1 y evalúa con el fold de pasos. La aritmética coincide AL
 * CÉNTIMO con el motor v1 (ver seed.ts → CIFRAS_VALIDADAS y engine.test.ts).
 *
 * Las reglas de agregación, signos y turnos están en la Parte II §A, §B, §C.
 * No cambiar la aritmética sin volver a correr la prueba de los 190 casos.
 */

import { llevarACausado, CAUSADO_DEFAULT } from './causado';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos v1 (se conservan — la interfaz y data.ts dependen de ellos)
// ─────────────────────────────────────────────────────────────────────────────

export type Operacion =
  | 'porcentaje'
  | 'multiplicar'
  | 'sumar'
  | 'restar'
  | 'valor_fijo'
  | 'promedio'
  | 'formula_venta'
  | 'derivada'
  // Operaciones nuevas del §D (parametrización por backtest de octubre 2026).
  // Se evalúan ya en `evaluarPaso` (modelo v2) vía `metodoV1aV2`; las reglas de
  // partida NO las usan, por lo que no mueven los 190 casos.
  | 'mediana'
  | 'ultimo'
  | 'ratio_venta'
  | 'presupuesto';

export type GrupoPL = 'VENTAS' | 'GOP' | 'GANOP' | 'SEMI';

/**
 * Los dos escenarios del §H (CP-01). El motor corre una vez por escenario:
 *   - `PROYECCION`: la venta se extrapola con §B (lo que hace la v1).
 *   - `CAUSADO`: la venta es el acumulado real al corte, sin proyectar, y a cada
 *     método no-venta se le aplica el modo de causado del §E (llevarACausado).
 */
export type Escenario = 'PROYECCION' | 'CAUSADO';

/**
 * A qué escenario aplica una regla (CP-49). Una regla `PROYECCION` no aparece en
 * el causado y viceversa; `AMBOS` (por defecto) aparece en los dos.
 */
export type EscenarioRegla = 'AMBOS' | 'PROYECCION' | 'CAUSADO';

/** Base v1 de un método. 'g:*' = total de grupo, 'c:*' = concepto. */
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
  /** Sobrescribe el valor por defecto del método (solo métodos de un paso). */
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
  /**
   * Nombre y detalle opcionales de la regla (CP-29). Son metadatos de la
   * interfaz: a qué corresponde la regla y quién la pidió. El motor NO los lee
   * (no mueven los 190 casos); solo la pestaña Reglas los muestra y edita.
   */
  nombre?: string | null;
  detalle?: string | null;
  /** Presupuesto del periodo (opcional; lo usa la operación 'presupuesto'). */
  presupuesto?: number | null;
  /**
   * Escenario(s) en los que participa la regla (CP-49). Por defecto 'AMBOS'.
   * Una regla 'PROYECCION' se excluye del causado y una 'CAUSADO' del proyectado.
   */
  escenarios?: EscenarioRegla;
  /**
   * Modo de causado del §E para esta regla (default 'igual'). Solo se aplica en
   * el escenario CAUSADO y nunca a la fórmula de venta ni a la derivada.
   */
  causado?: Causado;
  /**
   * Nivel de la regla (CP-21). Por defecto 'concepto': la regla estima el
   * concepto completo, que es el comportamiento de la v1 y de todas las reglas
   * de partida (por eso el oráculo de 190 casos no se mueve).
   *
   * 'cuenta' = la regla estima UNA cuenta por separado, usando la historia y el
   * acumulado de ESA cuenta; entonces su concepto pasa a calcular sobre el RESTO
   * de sus cuentas (ver destino.ts → insumosDelResto). El cálculo del resto solo
   * vive en destino.ts y no toca `calcular()`, de modo que este campo no altera
   * el motor mientras todas las reglas sigan en 'concepto'.
   */
  nivel?: NivelRegla;
}

/**
 * Nivel de una regla (CP-21). 'concepto' (por defecto) estima el concepto
 * completo; 'cuenta' estima una sola cuenta y deja que el concepto calcule sobre
 * el resto de sus cuentas.
 */
export type NivelRegla = 'concepto' | 'cuenta';

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
// Modelo v2: pasos compuestos (CP-18, §D) — scaffolding para 6.1/7.1/8.1
// ─────────────────────────────────────────────────────────────────────────────

/** Las trece operaciones de un paso (Parte II §D, CP-18). */
export type OpPaso =
  | 'formula_venta'
  | 'promedio'
  | 'mediana'
  | 'ultimo'
  | 'ratio_venta'
  | 'porcentaje'
  | 'presupuesto'
  | 'valor_fijo'
  | 'multiplicar'
  | 'sumar'
  | 'restar'
  | 'componentes'
  | 'derivada';

/** Modos de causado (§E). No aplica a formula_venta ni derivada. */
export type Causado = 'igual' | 'habiles' | 'calendario' | 'real';

/**
 * Medidas del origen Real (CP-17). Solo describen el espacio de medidas para
 * que 6.1 construya encima; la resolución completa por capas llega en capas.ts.
 */
export type MedidaReal =
  | 'promedio_n'
  | 'mediana_n'
  | 'suma_n'
  | 'un_mes_cerrado'
  | 'mismo_mes_anio_anterior'
  | 'mes_en_curso_corte'
  | 'mes_en_curso_habiles'
  | 'acumulado_anio_cerrado'
  | 'acumulado_anio_corte';

/** Una capa del catálogo (CP-16). La resolución completa vive en capas.ts (6.1). */
export interface Capa {
  /** tipo de capa: empresa, grupo, concepto, cuenta, cc, prefijo_cuenta, etc. */
  tipo: string;
  /** valores de la capa; varios valores de una misma capa se suman (unión). */
  valores: string[];
  /** true = la capa resta en vez de incluir (excluir). */
  excluir?: boolean;
}

/**
 * Base de un paso v2. Generaliza la `Base` v1 a capas del catálogo (CP-16) y al
 * origen con medida (CP-17). En esta tarea (5.1) basta describirla; capas.ts
 * (6.1) resuelve el álgebra de conjuntos completa.
 *
 * Para expresar las reglas de partida se usa la referencia directa `ref`, que
 * reproduce exactamente las bases planas de la v1 ('venta', 'semineto', 'g:*',
 * 'c:*', 'ninguna').
 */
export interface BaseCapas {
  origen: 'real' | 'presupuesto' | 'otra_regla';
  /** solo origen 'real' (CP-17). */
  medida?: MedidaReal;
  /** capas del catálogo (CP-16). */
  capas?: Capa[];
  /**
   * Referencia plana directa (puente v1→v2): reproduce las bases de la v1 sin
   * depender del detalle por cuenta. capas.ts puede ignorarla.
   */
  ref?: Base;
}

export interface Paso {
  op: OpPaso;
  base: BaseCapas;
  /** % en tanto por uno (0.01 = 1%), o monto. */
  valor: number | null;
  /** meses a mirar; default 9. */
  n: number | null;
  invertir: boolean;
}

export interface MetodoV2 {
  id: string;
  nombre: string;
  /** secuencia de pasos: fold izquierda a derecha, sin precedencia (CP-18). */
  pasos: Paso[];
  /** turno 1..5; se deduce de las bases (§C). */
  orden: number;
  /** causado por defecto (§E). */
  causadoDefault: Causado;
  deFabrica: boolean;
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
  mediana: 'Mediana histórica',
  ultimo: 'Último mes cerrado',
  ratio_venta: 'Proporción histórica de la venta',
  presupuesto: 'Presupuesto del mes',
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

/** Deja en la serie solo los meses CON registro (ni null ni NaN). Trampa 2. */
function conRegistro(serie: number[]): number[] {
  return serie.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
}

/**
 * Promedio de los últimos n meses de una serie, contando SOLO los meses con
 * registro. Un mes sin movimiento (null) no cuenta como cero (trampa 2).
 */
export function prom(serie: number[], n: number): number {
  const a = conRegistro(serie.slice(-n));
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

/**
 * Mediana de los últimos n meses de una serie, solo meses con registro (§D).
 * Con cantidad par promedia los dos centrales. Sin registros → 0.
 */
export function mediana(serie: number[], n: number): number {
  const a = conRegistro(serie.slice(-n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Último mes CON registro de la serie (§D: `m_ultimo`). Sin registros → 0. */
export function ultimo(serie: number[]): number {
  const a = conRegistro(serie);
  return a.length ? a[a.length - 1] : 0;
}

/** Suma de los últimos n meses con registro (base para `ratio_venta`). */
export function sumaN(serie: number[], n: number): number {
  return conRegistro(serie.slice(-n)).reduce((x, y) => x + y, 0);
}

/**
 * Fórmula de venta del §B (`m_venta`). Replica AL CÉNTIMO la especificación de
 * referencia; no cambiar sin volver a correr el oráculo de los 190 casos.
 *
 *   ritmo      = acumulado ÷ días transcurridos
 *   restantes  = días hábiles del mes − transcurridos
 *   Proyección = acumulado
 *              + ritmo × max(restantes − 5, 0)        (días normales)
 *              + ritmo × factor × min(restantes, 5)   (últimos 5 días hábiles)
 *   Causado    = acumulado                            (lo resuelve el escenario, 5.3)
 *
 * - El `factor` multiplica el ritmo de los últimos 5 días hábiles (cierre de
 *   mes) y es editable por empresa y por mes (viene en `Parametro.factor`).
 * - Si no hay acumulado, usa el promedio histórico (respaldo).
 * - `min(restantes, 5)` es un tope OBLIGATORIO: con menos de 5 días hábiles
 *   evita que `max(restantes − 5, 0)` quede negativo (de ahí el `max(…, 0)`) y
 *   que el último tramo del mes dé resultados absurdos.
 *
 * Días hábiles (§B): Venezuela trabaja sábados; el resto, lunes a viernes. Ese
 * conteo NO vive en el motor: `q.dias` (hábiles del mes) y `q.trans`
 * (transcurridos) llegan ya calculados desde la extracción de Fabric, y solo se
 * ajustan a mano si hace falta. El motor los consume tal cual.
 *
 * Nota (§E): el causado NO aplica a esta fórmula —ya usa el acumulado—; el
 * escenario Causado toma directamente `acumulado` (ver 5.3).
 */
export function formulaVenta(acum: number, serie: number[], q: Parametro, n: number): number {
  if (!acum) return prom(serie, n);
  const rest = q.dias - q.trans; // restantes = días hábiles − transcurridos
  const ritmo = q.trans ? acum / q.trans : 0; // ritmo = acumulado ÷ transcurridos
  // acumulado + ritmo·max(restantes−5,0) + ritmo·factor·min(restantes,5)
  return acum + (rest - 5 > 0 ? ritmo * (rest - 5) : 0) + Math.min(rest, 5) * ritmo * q.factor;
}

/** Fórmula de un método (v1 o v2) en texto plano, para la interfaz. */
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
// Puente v1 → v2: expresar un Metodo v1 como MetodoV2 de un solo paso
// ─────────────────────────────────────────────────────────────────────────────

/** Convierte una Base v1 plana en una BaseCapas v2 por referencia directa. */
export function baseV1aV2(b: Base): BaseCapas {
  // Las bases planas de la v1 que leían "otra regla ya calculada" (c:*) se
  // expresan con origen 'otra_regla' (CP-17: corrección de nombre, no de número).
  if (typeof b === 'string' && b.indexOf('c:') === 0) {
    return { origen: 'otra_regla', ref: b };
  }
  return { origen: 'real', ref: b };
}

/**
 * Expresa un `Metodo` v1 como un `MetodoV2` de un solo paso equivalente.
 *
 * Las 8 operaciones v1 se mapean 1:1 a operaciones de paso. El causado por
 * defecto se deja en 'igual' (la v1 no lo modelaba; el motor v1 solo calculaba
 * el escenario proyectado). Esto es el puente que mantiene la aritmética idéntica.
 */
export function metodoV1aV2(m: Metodo): MetodoV2 {
  return {
    id: m.id,
    nombre: m.nombre,
    orden: m.orden,
    causadoDefault: 'igual',
    deFabrica: m.fijo,
    pasos: [
      {
        op: m.op as OpPaso,
        base: baseV1aV2(m.base),
        valor: m.valor,
        n: null,
        invertir: m.invertir,
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluador de pasos (fold izquierda a derecha, CP-18)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contexto que un paso puede necesitar para resolver su base y su operación.
 * Lo provee `calcular()` por turnos; capas.ts (6.1) lo ampliará con el detalle
 * por cuenta y el presupuesto completo.
 */
export interface CtxPaso {
  regla: Regla;
  param: Parametro;
  gn: number;
  /**
   * Escenario en curso (§H). En 'CAUSADO' la fórmula de venta usa el acumulado
   * real al corte en lugar de extrapolar. Por defecto 'PROYECCION'.
   */
  escenario: Escenario;
  /** venta por empresa (proyectada en PROYECCION, acumulada al corte en CAUSADO). */
  venta: Record<string, number>;
  /** agregados del P&L por empresa (foto del turno anterior). */
  agg: Record<string, AgregadoEmpresa>;
  /** totales por grupo del P&L por empresa (foto del turno anterior). */
  grupo: Record<string, Record<GrupoPL, number>>;
  /** resuelve una referencia plana a otra regla (c:concepto) ya calculada. */
  refConcepto: (empresa: string, concepto: string) => number;
  /** suma del Cargo Fijo de las demás empresas (para la derivada). */
  cargoFijoDemas: (empresa: string) => number;
  /** serie histórica de la venta de la empresa (para «según la venta»). */
  serieVenta?: (empresa: string) => number[];
}

/** Resuelve el valor de una base plana v1 expresada en una BaseCapas (puente). */
function resolverBaseRef(b: BaseCapas, ctx: CtxPaso): number {
  const ref = b.ref;
  if (!ref || ref === 'ninguna') return 0;
  if (ref === 'venta') return ctx.venta[ctx.regla.empresa] || 0;
  if (ref === 'semineto') {
    const a = ctx.agg[ctx.regla.empresa];
    return a ? a.sn : 0;
  }
  if (ref.indexOf('g:') === 0) {
    const g = ref.slice(2) as GrupoPL;
    const gg = ctx.grupo[ctx.regla.empresa];
    return gg ? gg[g] || 0 : 0;
  }
  if (ref.indexOf('c:') === 0) {
    return ctx.refConcepto(ctx.regla.empresa, ref.slice(2));
  }
  return 0;
}

/**
 * Evalúa un solo paso dado el acumulador `acc` del paso anterior.
 * El primer paso recibe `acc` indefinido (parte de su base).
 */
function evaluarPaso(paso: Paso, acc: number | undefined, valorEfectivo: number | null, ctx: CtxPaso): number {
  const r = ctx.regla;
  const n = paso.n ?? r.n ?? ctx.gn;
  const v = valorEfectivo != null ? valorEfectivo : paso.valor != null ? paso.valor : 0;
  const sg = paso.invertir ? -1 : 1;

  switch (paso.op) {
    case 'formula_venta':
      // §H · CAUSADO: la venta es el acumulado REAL al corte, sin extrapolar.
      // §B/§E: la fórmula de venta ya es su propio causado, así que no se re-causa.
      if (ctx.escenario === 'CAUSADO') return r.acum;
      return formulaVenta(r.acum, r.serie, ctx.param, n);
    case 'promedio':
      return sg * prom(r.serie, n);
    case 'mediana':
      return sg * mediana(r.serie, n);
    case 'ultimo':
      return sg * ultimo(r.serie);
    case 'presupuesto':
      return sg * (r.presupuesto ?? 0);
    case 'valor_fijo':
      return sg * v;
    case 'ratio_venta': {
      // (Σ concepto ÷ Σ venta de N meses) × venta del mes (§D), igual que el
      // pronóstico del backtest (wape.ts). La venta del mes ya está calculada:
      // la fórmula de venta corre en el turno 1 y esta operación en el 3.
      const sumaVenta = sumaN(ctx.serieVenta?.(r.empresa) ?? [], n);
      if (sumaVenta === 0) return 0;
      return sg * (sumaN(r.serie, n) / sumaVenta) * (ctx.venta[r.empresa] || 0);
    }
    case 'derivada':
      return -ctx.cargoFijoDemas(r.empresa);
    case 'componentes':
      // Suma de otras reglas ya calculadas (6.1 lo resuelve por capas). Andamiaje.
      return acc ?? 0;
    case 'porcentaje':
    case 'multiplicar': {
      const b = acc !== undefined ? acc : resolverBaseRef(paso.base, ctx);
      return sg * (v * b);
    }
    case 'sumar': {
      const b = acc !== undefined ? acc : resolverBaseRef(paso.base, ctx);
      return sg * (b + v);
    }
    case 'restar': {
      const b = acc !== undefined ? acc : resolverBaseRef(paso.base, ctx);
      return sg * (b - v);
    }
    default:
      return acc ?? 0;
  }
}

/**
 * Evalúa un método v2 completo: fold de izquierda a derecha sobre sus pasos.
 *
 * TRAMPA CP-18: `regla.valor` sobrescribe el valor del paso SOLO si el método
 * tiene un único paso. Con varios pasos, cada paso conserva su propio valor.
 */
export function evaluarMetodoV2(m: MetodoV2, ctx: CtxPaso): number {
  const unSoloPaso = m.pasos.length === 1;
  let acc: number | undefined;
  for (let i = 0; i < m.pasos.length; i++) {
    const paso = m.pasos[i];
    // La sobrescritura por regla.valor solo aplica a métodos de un paso (CP-18).
    const valorEfectivo = unSoloPaso ? (ctx.regla.valor != null ? ctx.regla.valor : paso.valor) : paso.valor;
    acc = evaluarPaso(paso, acc, valorEfectivo, ctx);
  }
  return acc ?? 0;
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
  /**
   * Escenario a calcular (§H). Por defecto 'PROYECCION', que reproduce AL
   * CÉNTIMO el motor v1 (oráculo de 190). 'CAUSADO' cambia la base de venta al
   * acumulado real al corte y lleva cada método al causado del §E.
   *
   * RETROCOMPATIBILIDAD: sin este campo, `calcular()` se comporta exactamente
   * como antes (escenario proyectado), por lo que los 190 casos no se mueven.
   */
  escenario?: Escenario;
  /**
   * Datos del corte para el modo de causado 'calendario' del §E (opcionales).
   * Solo se usan en el escenario CAUSADO. Si faltan, 'calendario' cae al
   * respaldo de `params.trans` (ver causado.ts). Los modos 'igual' y 'habiles'
   * son operativos sin estos datos.
   */
  diaDelCorte?: number;
  diasDelMes?: number;
}

/** Resultado de correr los dos escenarios del §H (CP-01). */
export interface ResultadoEscenarios {
  proyeccion: ResultadoCalculo;
  causado: ResultadoCalculo;
}

/**
 * Calcula el monto USD de cada regla, resolviendo por TURNOS 1..5 (§C).
 *
 * §C · Foto por turno (la sutileza que se pierde al refactorizar): tras cada
 * turno se recalculan los agregados, pero un filtro de SOLO GRUPO (bases `g:*`
 * y `semineto`) usa la FOTO DEL TURNO ANTERIOR. Así el resultado NO depende del
 * orden de las reglas dentro de un turno (confluencia, 12.4/12.5).
 *
 * Cómo se garantiza aquí: `grupo` y `agg` solo se reconstruyen en
 * `recalcular()`, que se invoca UNA vez al inicio y UNA vez DESPUÉS de cada
 * turno completo — nunca a mitad de turno. Durante un turno `grupo`/`agg`
 * quedan congelados en la foto del turno anterior, que es exactamente lo que
 * leen las bases de solo grupo. Si la base se evaluara en vivo, el resultado
 * cambiaría según el orden en que se recorran las reglas.
 *
 * Una base sólo puede leer lo que se calculó en turnos anteriores: esa es la
 * regla que impide la referencia circular. El turno de cada método se deduce de
 * sus bases (§C): fórmula de venta=1; historia/fijos/presupuesto=2; sobre la
 * venta=3; derivada y fórmulas sobre otras reglas=4; sobre el Semi Neto=5.
 *
 * Internamente expresa cada `Metodo` v1 como `MetodoV2` de un paso y evalúa con
 * el fold de pasos (CP-18). La aritmética es idéntica a la v1 (oráculo de 190).
 */
export function calcular({
  reglas: R,
  metodos: M,
  params,
  empresas,
  gn,
  escenario = 'PROYECCION',
  diaDelCorte,
  diasDelMes,
}: CalcularOpts): ResultadoCalculo {
  const val = new Array<number>(R.length).fill(0);
  const hecho = new Array<boolean>(R.length).fill(false);
  const venta: Record<string, number> = {};

  // CP-49: una regla participa en el escenario si declara 'AMBOS' (default) o
  // justo este escenario. Las que no participan quedan en 0 y marcadas `hecho`
  // (su aporte al P&L es nulo, pero no bloquean turnos ni referencias).
  const participa = (r: Regla): boolean => {
    const e = r.escenarios ?? 'AMBOS';
    return e === 'AMBOS' || e === escenario;
  };

  const pasadas = [...new Set(Object.values(M).map((m) => m.orden))].sort((a, b) => a - b);

  // Foto de grupo/agg por turno (§C). Se reasignan ENTEROS en recalcular() al
  // cerrar cada turno; nunca se mutan a mitad de turno. Las bases de solo grupo
  // leen esta foto (la del turno anterior) durante todo el turno en curso.
  let grupo: Record<string, Record<GrupoPL, number>> = {};
  let agg: Record<string, AgregadoEmpresa> = {};

  // Reconstruye la foto de grupo/agg a partir de lo ya calculado (`hecho`).
  // Se llama una vez al inicio y una vez DESPUÉS de cada turno completo — así la
  // foto que ve un turno es siempre la del turno anterior (foto por turno, §C).
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
      // §A: el grupo SEMI (ISLR) se calcula pero NO resta en el Semi Neto.
      agg[e] = { rb, go: s.GOP, gop, sn: gop - s.GANOP, ing: -(venta[e] || 0) };
    }
  };

  // Resuelve una referencia a otro concepto ya calculado de la misma empresa.
  const refConcepto = (empresa: string, concepto: string): number => {
    const j = R.findIndex((x) => x.empresa === empresa && x.concepto === concepto);
    return j >= 0 && hecho[j] ? val[j] : 0;
  };

  // Suma del Cargo Fijo de las demás empresas (para la derivada de Prisma).
  const cargoFijoDemas = (empresa: string): number => {
    let cf = 0;
    R.forEach((x, j) => {
      if (x.concepto === 'Cargo Fijo' && x.empresa !== empresa && hecho[j]) cf += val[j];
    });
    return cf;
  };

  // Serie de venta de la empresa (la de su regla de Ventas) para «según la venta».
  const serieVenta = (empresa: string): number[] =>
    R.find((x) => x.empresa === empresa && x.concepto === 'Ventas')?.serie ?? [];

  // CP-49: las reglas que no participan en este escenario quedan en 0 y marcadas
  // `hecho` desde el inicio. Así no entran en ningún turno (su aporte es nulo)
  // pero tampoco cuelgan referencias de otras reglas. En PROYECCION con la
  // semilla todas participan ('AMBOS'), por lo que el oráculo no se mueve.
  R.forEach((r, i) => {
    if (!participa(r)) hecho[i] = true;
  });

  recalcular(); // foto inicial (todo en cero): el turno 1 no lee grupo/agg

  for (const p of pasadas) {
    // Un turno completo: todas las reglas del turno leen la MISMA foto de
    // grupo/agg (la del turno anterior). No se recalcula dentro del forEach, de
    // modo que permutar las reglas del turno da el mismo resultado (§C, 12.5).
    R.forEach((r, i) => {
      const m = M[r.metodo];
      if (!m || m.orden !== p || hecho[i]) return;

      const mv2 = metodoV1aV2(m);
      const ctx: CtxPaso = {
        regla: r,
        param: params[r.empresa],
        gn,
        escenario,
        venta,
        agg, // foto del turno anterior (congelada durante todo el turno)
        grupo, // idem: base de solo grupo del §C
        refConcepto,
        cargoFijoDemas,
        serieVenta,
      };
      let res = evaluarMetodoV2(mv2, ctx);

      // §H · Escenario CAUSADO: a cada método se le aplica el modo de causado
      // del §E (regla.causado, default 'igual') SALVO la fórmula de venta y la
      // derivada, que ya son su propio causado (Requirement 13.3). La fórmula de
      // venta en CAUSADO ya devolvió el acumulado dentro de `evaluarPaso`.
      if (escenario === 'CAUSADO') {
        const esVentaODerivada = m.op === 'formula_venta' || m.op === 'derivada';
        res = llevarACausado(res, r.causado ?? CAUSADO_DEFAULT, params[r.empresa], {
          esVentaODerivada,
          diaDelCorte,
          diasDelMes,
        });
      }

      val[i] = res;
      hecho[i] = true;
      if (r.concepto === 'Ventas' || m.op === 'derivada') venta[r.empresa] = res;
    });
    recalcular(); // cerrado el turno, se refresca la foto para el siguiente
  }

  return { val, venta, agg, hecho };
}

/**
 * Corre los DOS escenarios del §H (CP-01) sobre el mismo juego de reglas.
 *
 * No duplica lógica: invoca `calcular()` una vez por escenario. El resultado
 * `proyeccion` es idéntico al de `calcular()` sin `escenario` (retrocompat), y
 * `causado` cambia la base de venta al acumulado real al corte aplicando el §E.
 *
 * _Requirements: 16.1, 16.2_
 */
export function calcularEscenarios(opts: CalcularOpts): ResultadoEscenarios {
  return {
    proyeccion: calcular({ ...opts, escenario: 'PROYECCION' }),
    causado: calcular({ ...opts, escenario: 'CAUSADO' }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CP-51 · Detección de dependencias circulares (AL GUARDAR, no al calcular)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado de `detectarCiclos`: el ciclo encontrado como lista de conceptos
 * (en orden de recorrido, cerrando sobre el primero), o `null` si no hay ciclo.
 */
export type Ciclo = string[] | null;

/**
 * Detecta dependencias circulares entre conceptos (CP-51). Es una función PURA
 * pensada para correr AL GUARDAR, no al calcular: un ciclo deja el cálculo dando
 * vueltas o sumando ceros silenciosos al P&L, así que se bloquea el guardado.
 *
 * Construye el grafo concepto→concepto a partir de las bases que leen "otra
 * regla ya calculada": la base plana `c:<concepto>` y cualquier paso v2 cuyo
 * origen sea `otra_regla` con `ref` de la forma `c:<concepto>`. El grafo se
 * arma por empresa (una regla solo puede referenciar conceptos de su empresa,
 * ver `refConcepto`), de modo que un mismo nombre de concepto en dos empresas
 * no se confunde.
 *
 * Hace DFS con detección de back-edge (coloreado blanco/gris/negro). Devuelve el
 * primer ciclo hallado como la lista de conceptos que lo forman —nombrada para
 * el aviso— o `null` si el grafo es acíclico.
 *
 * @param reglas   Reglas a guardar (con empresa, concepto y método).
 * @param metodos  Métodos disponibles (para leer la base de cada regla).
 * @returns        El ciclo `['Empresa|A','Empresa|B','Empresa|A']` o `null`.
 *
 * _Requirements: 16.3_
 */
export function detectarCiclos(reglas: Regla[], metodos: Record<string, Metodo>): Ciclo {
  // Nodo = empresa|concepto (una regla solo referencia conceptos de su empresa).
  const nodo = (empresa: string, concepto: string): string => empresa + '|' + concepto;

  // Aristas: concepto → conceptos de los que depende (bases 'otra_regla' / c:*).
  const adj = new Map<string, string[]>();
  const asegura = (k: string) => {
    if (!adj.has(k)) adj.set(k, []);
    return adj.get(k)!;
  };

  // Extrae de un método los conceptos referenciados por sus bases 'otra_regla'.
  const dependenciasDe = (m: Metodo): string[] => {
    const deps: string[] = [];
    // Base plana v1 'c:<concepto>' (puente v1→v2, origen 'otra_regla').
    if (typeof m.base === 'string' && m.base.indexOf('c:') === 0) {
      deps.push(m.base.slice(2));
    }
    return deps;
  };

  for (const r of reglas) {
    const from = nodo(r.empresa, r.concepto);
    asegura(from);
    const m = metodos[r.metodo];
    if (!m) continue;
    for (const dep of dependenciasDe(m)) {
      // La arista apunta al concepto del que depende, dentro de la misma empresa.
      asegura(from).push(nodo(r.empresa, dep));
    }
  }

  // DFS con coloreado: 0 = blanco (sin visitar), 1 = gris (en pila), 2 = negro.
  const color = new Map<string, number>();
  const pila: string[] = [];

  const dfs = (u: string): Ciclo => {
    color.set(u, 1);
    pila.push(u);
    for (const v of adj.get(u) ?? []) {
      // Arista a un nodo que no está en el grafo (concepto inexistente): se ignora.
      if (!adj.has(v)) continue;
      const c = color.get(v) ?? 0;
      if (c === 1) {
        // Back-edge → ciclo. Se extrae el tramo de la pila desde `v` y se cierra.
        const desde = pila.indexOf(v);
        return [...pila.slice(desde), v];
      }
      if (c === 0) {
        const hit = dfs(v);
        if (hit) return hit;
      }
    }
    pila.pop();
    color.set(u, 2);
    return null;
  };

  for (const u of adj.keys()) {
    if ((color.get(u) ?? 0) === 0) {
      const hit = dfs(u);
      if (hit) return hit;
    }
  }
  return null;
}
