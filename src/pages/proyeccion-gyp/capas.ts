/**
 * Resolución de bases por capas del catálogo — v2 (CP-16, CP-17).
 *
 * Este módulo es PURO y ADITIVO: no cambia la aritmética de las reglas de
 * partida (los 190 casos no se mueven). El motor solo lo usará cuando una regla
 * tenga una base por capas real (origen Real/Presupuesto/Otra regla con capas);
 * las bases planas v1 siguen resolviéndose por `BaseCapas.ref` en `engine.ts`.
 *
 * ── CP-16 · Bases por capas (Parte II §F del paquete 12-cambios-para-produccion) ──
 * La base de un paso se filtra por doce tipos de capa del catálogo:
 *   Empresa, Sección, Línea, Detalle, Concepto, Cuenta, Prefijo de cuenta,
 *   Descripción contiene, Centro de costo, Prefijo de centro, Cuenta+centro y
 *   Grupo del P&L.
 * Álgebra de conjuntos (Property 5):
 *   - Varios valores de una MISMA capa → se SUMAN (unión de valores).
 *   - Capas DISTINTAS → se CRUZAN (intersección).
 *   - Una capa marcada `excluir` → resta/filtra fuera (diferencia).
 *
 * ── CP-17 · Origen con medida ──
 * Orígenes: Real (Fabric), Presupuesto u Otra regla ya calculada. Con origen
 * Real se elige una `MedidaReal` sobre el detalle por cuenta (CP-17). Los pasos
 * que la v1 llamaba "Real" pero leían otras reglas ya calculadas se migran a
 * `origen: 'otra_regla'` SIN cambiar cifras (corrección de nombre, no de número).
 *
 * ── Req 5.3 · Sin detalle por cuenta ──
 * Sin `gyp_historico_cuenta` cargado para el periodo, la base por capas se
 * limita a Empresa, Grupo del P&L y Concepto (las únicas capas resolubles sin el
 * detalle por cuenta). Una capa de cuenta/centro/sección/… sin detalle no
 * selecciona nada (la regla por cuenta sin detalle vale 0).
 */

import type { BaseCapas, Capa, GrupoPL, MedidaReal } from './engine';

// ─────────────────────────────────────────────────────────────────────────────
// Filas crudas tal como las escribe Fabric (contrato del §4 de schema.sql)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fila de `gyp_historico_cuenta`: el detalle por cuenta del periodo, con
 * acumulado del mes en curso, presupuesto y los 12 meses anteriores.
 */
export interface FilaHistoricoCuenta {
  periodo: string;
  empresa: string;
  combinada: string;
  cuenta: string;
  centro_costo: string;
  concepto: string;
  acumulado: number | null;
  presupuesto: number | null;
  /** Serie de los 12 meses anteriores (jsonb). Un mes sin registro va null. */
  meses: Array<number | null> | null;
}

/**
 * Fila de `dim_cuenta`: el catálogo con las capas dimensionales de cada cuenta.
 * Es la verdad de Sección/Línea/Detalle/Descripción; `concepto` y `centro_costo`
 * también viven aquí para poder resolver capas sin tocar el histórico.
 */
export interface FilaDimCuenta {
  combinada: string;
  empresa: string | null;
  pais: string | null;
  cuenta: string | null;
  centro_costo: string | null;
  descripcion: string | null;
  seccion: string | null;
  linea: string | null;
  detalle: string | null;
  concepto: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cuenta de detalle: unión de dim_cuenta + gyp_historico_cuenta por Combinada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una cuenta del detalle lista para resolver capas: las dimensiones del catálogo
 * (`dim_cuenta`) más los valores del histórico (`gyp_historico_cuenta`), unidas
 * por `combinada`. Es la unidad sobre la que opera el álgebra de conjuntos.
 *
 * Una cuenta puede existir en el catálogo sin histórico del periodo (acumulado y
 * meses quedan vacíos) o traer histórico sin estar aún en el catálogo (las
 * dimensiones quedan en null y solo resuelven las capas empresa/concepto/centro).
 */
export interface CuentaDetalle {
  combinada: string;
  empresa: string;
  pais: string | null;
  cuenta: string | null;
  centroCosto: string | null;
  descripcion: string | null;
  seccion: string | null;
  linea: string | null;
  detalle: string | null;
  concepto: string | null;
  /** Grupo del P&L de la cuenta (derivado del concepto; opcional). */
  grupo: GrupoPL | null;
  /** Acumulado del mes en curso (0 si no hay histórico). */
  acumulado: number;
  /** Presupuesto del periodo (0 si no hay histórico). */
  presupuesto: number;
  /** Serie de los 12 meses anteriores; meses sin registro van null. */
  meses: Array<number | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de tipos de capa (CP-16)
// ─────────────────────────────────────────────────────────────────────────────

/** Los doce tipos de capa del catálogo (CP-16). */
export type TipoCapa =
  | 'empresa'
  | 'seccion'
  | 'linea'
  | 'detalle'
  | 'concepto'
  | 'cuenta'
  | 'prefijo_cuenta'
  | 'descripcion_contiene'
  | 'centro_costo'
  | 'prefijo_centro'
  | 'cuenta_centro'
  | 'grupo';

/** Etiquetas de presentación de cada tipo de capa (interfaz). */
export const TIPOS_CAPA: Record<TipoCapa, string> = {
  empresa: 'Empresa',
  seccion: 'Sección',
  linea: 'Línea',
  detalle: 'Detalle',
  concepto: 'Concepto',
  cuenta: 'Cuenta',
  prefijo_cuenta: 'Prefijo de cuenta',
  descripcion_contiene: 'Descripción contiene',
  centro_costo: 'Centro de costo',
  prefijo_centro: 'Prefijo de centro',
  cuenta_centro: 'Cuenta + centro',
  grupo: 'Grupo del P&L',
};

/**
 * Capas resolubles SIN el detalle por cuenta cargado (Req 5.3). Empresa, Grupo
 * del P&L y Concepto son las únicas que no necesitan `gyp_historico_cuenta`;
 * cualquier otra capa, sin detalle, no selecciona cuentas.
 */
export const CAPAS_SIN_DETALLE: ReadonlySet<TipoCapa> = new Set<TipoCapa>([
  'empresa',
  'grupo',
  'concepto',
]);

/** Medidas válidas del origen Real (CP-17). */
export const MEDIDAS_REAL: readonly MedidaReal[] = [
  'promedio_n',
  'mediana_n',
  'suma_n',
  'un_mes_cerrado',
  'mismo_mes_anio_anterior',
  'mes_en_curso_corte',
  'mes_en_curso_habiles',
  'acumulado_anio_cerrado',
  'acumulado_anio_corte',
];

// ─────────────────────────────────────────────────────────────────────────────
// Construcción de las cuentas de detalle (unión de las dos tablas)
// ─────────────────────────────────────────────────────────────────────────────

function numero(x: number | null | undefined): number {
  return x == null || Number.isNaN(x) ? 0 : x;
}

/** Normaliza la serie jsonb de meses a un arreglo (meses sin registro → null). */
function normalizarMeses(meses: Array<number | null> | null | undefined): Array<number | null> {
  return Array.isArray(meses) ? meses.slice() : [];
}

/**
 * Une `dim_cuenta` y `gyp_historico_cuenta` por `combinada` en las cuentas de
 * detalle sobre las que se resuelven las capas. El parámetro opcional `grupoDe`
 * deriva el Grupo del P&L de cada cuenta a partir de su concepto (el catálogo no
 * lleva columna de grupo); sin él, la capa `grupo` no selecciona nada.
 */
export function construirCuentas(
  dim: FilaDimCuenta[],
  historico: FilaHistoricoCuenta[],
  grupoDe?: (empresa: string, concepto: string | null) => GrupoPL | null,
): CuentaDetalle[] {
  const porCombinada = new Map<string, FilaHistoricoCuenta>();
  for (const h of historico) porCombinada.set(h.combinada, h);

  const cuentas: CuentaDetalle[] = [];
  const vistas = new Set<string>();

  const agregar = (combinada: string, d: FilaDimCuenta | null, h: FilaHistoricoCuenta | null) => {
    if (vistas.has(combinada)) return;
    vistas.add(combinada);
    const empresa = (d?.empresa ?? h?.empresa ?? '') || '';
    const concepto = d?.concepto ?? h?.concepto ?? null;
    cuentas.push({
      combinada,
      empresa,
      pais: d?.pais ?? null,
      cuenta: d?.cuenta ?? h?.cuenta ?? null,
      centroCosto: d?.centro_costo ?? h?.centro_costo ?? null,
      descripcion: d?.descripcion ?? null,
      seccion: d?.seccion ?? null,
      linea: d?.linea ?? null,
      detalle: d?.detalle ?? null,
      concepto,
      grupo: grupoDe ? grupoDe(empresa, concepto) : null,
      acumulado: numero(h?.acumulado),
      presupuesto: numero(h?.presupuesto),
      meses: normalizarMeses(h?.meses),
    });
  };

  for (const d of dim) agregar(d.combinada, d, porCombinada.get(d.combinada) ?? null);
  for (const h of historico) {
    if (!vistas.has(h.combinada)) agregar(h.combinada, null, h);
  }
  return cuentas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Álgebra de conjuntos de las capas (CP-16, Property 5)
// ─────────────────────────────────────────────────────────────────────────────

/** Normaliza a texto comparable (sin espacios al borde, en minúsculas). */
function norm(x: string | null | undefined): string {
  return (x ?? '').trim().toLowerCase();
}

/** ¿`valor` empieza por alguno de los prefijos dados (comparación normalizada)? */
function tienePrefijo(valor: string | null | undefined, prefijos: string[]): boolean {
  const v = norm(valor);
  return prefijos.some((p) => v.startsWith(norm(p)));
}

/** ¿`texto` contiene alguna de las subcadenas dadas (comparación normalizada)? */
function contiene(texto: string | null | undefined, partes: string[]): boolean {
  const t = norm(texto);
  return partes.some((p) => t.includes(norm(p)));
}

/** ¿`valor` es igual a alguno de los valores dados (comparación normalizada)? */
function igualAlguno(valor: string | null | undefined, valores: string[]): boolean {
  const v = norm(valor);
  return valores.some((x) => norm(x) === v);
}

/**
 * ¿La cuenta cumple UNA capa (unión de sus valores)?
 *
 * La capa `cuenta_centro` espera valores `cuenta|centro` (una tubería separa la
 * cuenta del centro). La capa `grupo` solo resuelve si la cuenta trae `grupo`.
 * Cualquier capa que necesite detalle y no lo tenga se filtra antes (ver
 * `resolverCapas`), así que aquí todas las capas presentes son resolubles.
 */
function cumpleCapa(c: CuentaDetalle, capa: Capa): boolean {
  const tipo = capa.tipo as TipoCapa;
  const valores = capa.valores ?? [];
  if (valores.length === 0) return false; // capa sin valores no selecciona nada
  switch (tipo) {
    case 'empresa':
      return igualAlguno(c.empresa, valores);
    case 'seccion':
      return igualAlguno(c.seccion, valores);
    case 'linea':
      return igualAlguno(c.linea, valores);
    case 'detalle':
      return igualAlguno(c.detalle, valores);
    case 'concepto':
      return igualAlguno(c.concepto, valores);
    case 'cuenta':
      return igualAlguno(c.cuenta, valores);
    case 'prefijo_cuenta':
      return tienePrefijo(c.cuenta, valores);
    case 'descripcion_contiene':
      return contiene(c.descripcion, valores);
    case 'centro_costo':
      return igualAlguno(c.centroCosto, valores);
    case 'prefijo_centro':
      return tienePrefijo(c.centroCosto, valores);
    case 'cuenta_centro':
      return valores.some((par) => {
        const [cu, ce] = par.split('|');
        return norm(c.cuenta) === norm(cu) && norm(c.centroCosto) === norm(ce);
      });
    case 'grupo':
      return c.grupo != null && igualAlguno(c.grupo, valores);
    default:
      return false;
  }
}

export interface OpcionesResolucion {
  /**
   * ¿Está cargado el detalle por cuenta del periodo? Sin él (Req 5.3) solo se
   * evalúan las capas Empresa, Grupo y Concepto; las demás se ignoran y una
   * base que dependa solo de ellas selecciona el conjunto vacío.
   */
  detalleCargado?: boolean;
}

/**
 * Resuelve el conjunto de cuentas que cumplen una lista de capas (CP-16).
 *
 * Álgebra (Property 5):
 *   - Capas de INCLUSIÓN distintas → intersección (una cuenta debe cumplir TODAS).
 *   - Dentro de una capa, varios valores → unión (basta cumplir uno).
 *   - Capas de EXCLUSIÓN → se quitan las cuentas que cumplan cualquiera de ellas.
 *   - Sin capas de inclusión → conjunto vacío (una base no selecciona "todo").
 *
 * Req 5.3: sin detalle cargado solo cuentan las capas empresa/grupo/concepto;
 * las demás se descartan (no restringen ni excluyen).
 */
export function resolverCapas(
  cuentas: CuentaDetalle[],
  capas: Capa[],
  opts: OpcionesResolucion = {},
): CuentaDetalle[] {
  const detalleCargado = opts.detalleCargado !== false;

  const resolubles = capas.filter(
    (capa) => detalleCargado || CAPAS_SIN_DETALLE.has(capa.tipo as TipoCapa),
  );

  const incluir = resolubles.filter((c) => !c.excluir);
  const excluir = resolubles.filter((c) => c.excluir);

  // Sin ninguna capa de inclusión resoluble no hay selección (conjunto vacío).
  if (incluir.length === 0) return [];

  return cuentas.filter((cuenta) => {
    // Intersección: la cuenta debe cumplir TODAS las capas de inclusión.
    if (!incluir.every((capa) => cumpleCapa(cuenta, capa))) return false;
    // Diferencia: fuera si cumple ALGUNA capa de exclusión.
    if (excluir.some((capa) => cumpleCapa(cuenta, capa))) return false;
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Medida del origen Real (CP-17) sobre un conjunto de cuentas
// ─────────────────────────────────────────────────────────────────────────────

/** Deja en la serie solo los meses CON registro (ni null ni NaN). */
function conRegistro(serie: Array<number | null>): number[] {
  return serie.filter((x): x is number => x != null && !Number.isNaN(x));
}

function promedio(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function medianaDe(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Datos del periodo que algunas medidas necesitan y que no viven en la cuenta:
 * días hábiles/transcurridos para extrapolar el mes en curso, y un índice del
 * año para los acumulados anuales (meses cerrados del año y mes del año anterior).
 */
export interface ContextoMedida {
  /** Días hábiles del mes en curso (para `mes_en_curso_habiles`). */
  diasHabiles?: number;
  /** Días transcurridos del mes en curso (para `mes_en_curso_habiles`). */
  diasTranscurridos?: number;
  /**
   * N por defecto para las medidas de N meses (promedio/mediana/suma). Default 9.
   */
  n?: number;
  /**
   * Cuántos de los meses de la serie pertenecen al año en curso ya cerrado
   * (para `acumulado_anio_cerrado`). Si no se indica, se usa toda la serie.
   */
  mesesAnioCerrado?: number;
  /**
   * Posición (desde el final, 1 = último) del "mismo mes del año anterior" dentro
   * de la serie de 12 meses. Default 12 (hace un año exacto). 
   */
  mismoMesAnioAnteriorDesdeFinal?: number;
}

/**
 * Serie agregada del conjunto: suma mes a mes las series de las cuentas (un mes
 * es null solo si NINGUNA cuenta registró ese mes). Alinea por el final para que
 * el último mes de cada cuenta coincida.
 */
export function serieAgregada(cuentas: CuentaDetalle[]): Array<number | null> {
  const largo = cuentas.reduce((m, c) => Math.max(m, c.meses.length), 0);
  if (largo === 0) return [];
  const suma: Array<number | null> = new Array(largo).fill(null);
  for (const c of cuentas) {
    const desfase = largo - c.meses.length;
    c.meses.forEach((valor, i) => {
      if (valor == null || Number.isNaN(valor)) return;
      const j = desfase + i;
      suma[j] = (suma[j] ?? 0) + valor;
    });
  }
  return suma;
}

/** Acumulado total del conjunto (mes en curso al corte). */
export function acumuladoTotal(cuentas: CuentaDetalle[]): number {
  return cuentas.reduce((s, c) => s + numero(c.acumulado), 0);
}

/** Presupuesto total del conjunto. */
export function presupuestoTotal(cuentas: CuentaDetalle[]): number {
  return cuentas.reduce((s, c) => s + numero(c.presupuesto), 0);
}

/**
 * Aplica una medida del origen Real (CP-17) al conjunto de cuentas ya resuelto
 * por capas. Trabaja sobre la serie agregada y el acumulado del conjunto.
 */
export function aplicarMedida(
  cuentas: CuentaDetalle[],
  medida: MedidaReal,
  ctx: ContextoMedida = {},
): number {
  const n = ctx.n ?? 9;
  const serie = serieAgregada(cuentas);
  const cerrados = conRegistro(serie);
  const acum = acumuladoTotal(cuentas);

  switch (medida) {
    case 'promedio_n':
      return promedio(conRegistro(serie.slice(-n)));
    case 'mediana_n':
      return medianaDe(conRegistro(serie.slice(-n)));
    case 'suma_n':
      return conRegistro(serie.slice(-n)).reduce((x, y) => x + y, 0);
    case 'un_mes_cerrado':
      return cerrados.length ? cerrados[cerrados.length - 1] : 0;
    case 'mismo_mes_anio_anterior': {
      const desde = ctx.mismoMesAnioAnteriorDesdeFinal ?? 12;
      const idx = serie.length - desde;
      const v = idx >= 0 ? serie[idx] : null;
      return v == null || Number.isNaN(v) ? 0 : v;
    }
    case 'mes_en_curso_corte':
      return acum;
    case 'mes_en_curso_habiles': {
      const dias = ctx.diasHabiles ?? 0;
      const trans = ctx.diasTranscurridos ?? 0;
      return trans > 0 ? (acum * dias) / trans : acum;
    }
    case 'acumulado_anio_cerrado': {
      const meses = ctx.mesesAnioCerrado;
      const trozo = meses != null ? serie.slice(-meses) : serie;
      return conRegistro(trozo).reduce((x, y) => x + y, 0);
    }
    case 'acumulado_anio_corte': {
      const meses = ctx.mesesAnioCerrado;
      const trozo = meses != null ? serie.slice(-meses) : serie;
      return conRegistro(trozo).reduce((x, y) => x + y, 0) + acum;
    }
    default:
      return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolución completa de una BaseCapas al valor numérico de la base
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextoBase extends OpcionesResolucion {
  /** Universo de cuentas de detalle del periodo (dim ∪ histórico). */
  cuentas: CuentaDetalle[];
  /** Contexto de las medidas Real (días hábiles, N, índices anuales). */
  medida?: ContextoMedida;
  /**
   * Resuelve el valor de "otra regla ya calculada" (origen 'otra_regla') a
   * partir de las capas que la identifican. Lo provee el motor por turnos; sin
   * él, el origen 'otra_regla' vale 0 (no hay referencia que leer todavía).
   */
  otraRegla?: (base: BaseCapas) => number;
}

/**
 * Resuelve una `BaseCapas` al valor numérico de la base, según su origen:
 *   - `real`:        resuelve las capas y aplica la `medida` (default `promedio_n`).
 *   - `presupuesto`: suma el presupuesto de las cuentas resueltas por capas.
 *   - `otra_regla`:  delega en `ctx.otraRegla` (lo calcula el motor por turnos).
 *
 * Esta función NO toca las bases planas v1 (`ref`): el motor las resuelve aparte
 * en `engine.ts`. Aquí solo se resuelve la base por capas real, de modo que el
 * módulo es puramente aditivo y no mueve ninguno de los 190 casos.
 */
export function valorBase(base: BaseCapas, ctx: ContextoBase): number {
  if (base.origen === 'otra_regla') {
    return ctx.otraRegla ? ctx.otraRegla(base) : 0;
  }

  const capas = base.capas ?? [];
  const seleccion = resolverCapas(ctx.cuentas, capas, {
    detalleCargado: ctx.detalleCargado,
  });

  if (base.origen === 'presupuesto') {
    return presupuestoTotal(seleccion);
  }

  // origen === 'real'
  const medida: MedidaReal = base.medida ?? 'promedio_n';
  return aplicarMedida(seleccion, medida, ctx.medida);
}
