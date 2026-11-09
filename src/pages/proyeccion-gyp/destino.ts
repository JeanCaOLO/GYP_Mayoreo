/**
 * Destino y reparto de una regla (Parte II §F, CP-20).
 *
 * Módulo PURO: no habla con la red ni con Supabase, solo reparte el monto de una
 * regla entre sus cuentas de destino y devuelve `DestinoCuenta[]` que `salida.ts`
 * convierte en filas de la tabla final. Al ser aditivo, solo entra en juego
 * cuando una regla declara un `destino` con varias cuentas; sin destino la regla
 * sigue el camino de siempre (todo a su Combinada) y los 190 casos no se mueven.
 *
 * Reglas no negociables del §F:
 *   - Sin destino → todo el monto va a la Combinada de la regla.
 *   - Con varias cuentas, el monto se reparte según su HISTORIA (promedio de N
 *     meses), según su PRESUPUESTO o en PARTES IGUALES.
 *   - La suma del reparto SIEMPRE da el monto de la regla (conservación exacta al
 *     céntimo: el residuo de redondeo se ajusta en la última cuenta).
 *   - Se reparte con el SIGNO DOMINANTE: una cuenta con reversos no se lleva una
 *     parte de signo contrario. Los pesos se calculan sobre los valores del signo
 *     dominante del conjunto.
 *   - Si no hay historia ni presupuesto, se reparte en partes iguales CON AVISO.
 *
 * Reutiliza `DestinoCuenta` de `salida.ts` para que el reparto produzca
 * exactamente lo que la capa de salida sabe convertir en filas, sin duplicar el
 * tipo.
 */

import type { DestinoCuenta } from './salida';
import { prom } from './engine';

export type { DestinoCuenta } from './salida';

// ─────────────────────────────────────────────────────────────────────────────
// Cuenta candidata del reparto
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una cuenta de destino candidata del reparto. Lleva la identidad contable
 * (Combinada, centro de costo, cuenta) que viajará a la fila final, más los dos
 * insumos que deciden su peso: su HISTORIA (serie mensual) y su PRESUPUESTO.
 *
 * La historia puede venir como serie mensual (`serie`) —y entonces el peso por
 * historia es el promedio de los últimos N meses con registro— o como un promedio
 * ya calculado (`promedioHistoria`). Si se dan ambos, manda `serie`.
 */
export interface CuentaDestino {
  combinada: string;
  centroCosto: string;
  cuentaContable: string;
  /** Serie histórica mensual de la cuenta (para el reparto por historia). */
  serie?: number[];
  /** Promedio de historia ya calculado (alternativa a `serie`). */
  promedioHistoria?: number | null;
  /** Presupuesto del periodo para esta cuenta (para el reparto por presupuesto). */
  presupuesto?: number | null;
}

/** Criterio de reparto del §F. */
export type CriterioReparto = 'historia' | 'presupuesto' | 'iguales';

/** Opciones del reparto. */
export interface OpcionesReparto {
  /** Criterio elegido. Default `'iguales'`. */
  criterio?: CriterioReparto;
  /** Meses a mirar en el reparto por historia (default 9, como el §D). */
  n?: number;
}

/**
 * Resultado del reparto: las cuentas con su parte del monto y un aviso opcional.
 *
 * El aviso aparece cuando, pedido un reparto por historia o por presupuesto, no
 * había ni historia ni presupuesto utilizables y se cayó a partes iguales (§F:
 * "con aviso"). Un `aviso` nulo significa que el reparto usó el criterio pedido
 * sin degradar.
 */
export interface ResultadoReparto {
  destinos: DestinoCuenta[];
  /** Mensaje de degradación a partes iguales, o `null` si no hubo. */
  aviso: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Redondeo a céntimos y conservación
// ─────────────────────────────────────────────────────────────────────────────

const N_POR_DEFECTO = 9;

/** Redondea a céntimos (2 decimales) de forma estable. */
function aCentimos(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * El signo dominante de un conjunto de valores: el signo de la SUMA. Si la suma
 * es cero (o no hay valores), se toma `+1` por convención, de modo que el reparto
 * en partes iguales quede en positivo. Con este signo se filtran los pesos: una
 * cuenta cuyo valor va en contra del signo dominante (un reverso) no aporta peso
 * y por tanto no se lleva una parte de signo contrario.
 */
export function signoDominante(valores: number[]): 1 | -1 {
  let suma = 0;
  for (const v of valores) suma += v;
  return suma < 0 ? -1 : 1;
}

/**
 * Peso del signo dominante de un valor: su magnitud si acompaña al signo
 * dominante, 0 si va en contra (reverso). Así los pesos nunca son negativos y
 * una cuenta con reversos no recibe parte de signo contrario.
 */
function pesoSigno(valor: number, signo: 1 | -1): number {
  const alineado = signo === 1 ? valor > 0 : valor < 0;
  return alineado ? Math.abs(valor) : 0;
}

/**
 * Reparte `monto` entre las cuentas en proporción a `pesos` (no negativos),
 * redondeando cada parte a céntimos y ajustando el residuo de redondeo en la
 * última cuenta para que la suma sea EXACTAMENTE `monto` redondeado a céntimos.
 *
 * Supone `pesos.length === cuentas.length` y que al menos un peso es > 0; los
 * casos degenerados (todos los pesos en cero) los resuelve el llamador cayendo a
 * partes iguales.
 */
function repartirPorPesos(
  monto: number,
  cuentas: CuentaDestino[],
  pesos: number[],
): DestinoCuenta[] {
  const total = pesos.reduce((a, b) => a + b, 0);
  const objetivo = aCentimos(monto);
  const partes: number[] = new Array(cuentas.length).fill(0);
  let acumulado = 0;
  // Última cuenta con peso > 0: ahí cae el residuo de redondeo.
  let ultimaConPeso = -1;
  for (let i = 0; i < pesos.length; i++) {
    if (pesos[i] > 0) ultimaConPeso = i;
  }
  for (let i = 0; i < cuentas.length; i++) {
    if (i === ultimaConPeso) continue;
    const parte = pesos[i] > 0 ? aCentimos((monto * pesos[i]) / total) : 0;
    partes[i] = parte;
    acumulado += parte;
  }
  // El residuo (incluida toda corrección de redondeo) va a la última con peso.
  partes[ultimaConPeso] = aCentimos(objetivo - acumulado);
  return cuentas.map((c, i) => aDestino(c, partes[i]));
}

/** Convierte una cuenta candidata + su parte en un `DestinoCuenta` de salida. */
function aDestino(c: CuentaDestino, montoUsd: number): DestinoCuenta {
  return {
    combinada: c.combinada,
    centroCosto: c.centroCosto,
    cuentaContable: c.cuentaContable,
    montoUsd,
  };
}

/** Reparte `monto` en partes iguales entre las cuentas, con residuo en la última. */
function repartirIguales(monto: number, cuentas: CuentaDestino[]): DestinoCuenta[] {
  return repartirPorPesos(monto, cuentas, new Array(cuentas.length).fill(1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pesos por criterio
// ─────────────────────────────────────────────────────────────────────────────

/** Valor de historia de una cuenta: promedio de serie, o promedio ya calculado. */
function valorHistoria(c: CuentaDestino, n: number): number {
  if (c.serie && c.serie.length) return prom(c.serie, n);
  return c.promedioHistoria ?? 0;
}

/** Valor de presupuesto de una cuenta (0 si no tiene). */
function valorPresupuesto(c: CuentaDestino): number {
  return c.presupuesto ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// repartir — función pura principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reparte `montoRegla` entre `cuentas` según `criterio` (§F, CP-20). Devuelve un
 * `DestinoCuenta[]` cuya suma de `montoUsd` es EXACTAMENTE `montoRegla` redondeado
 * a céntimos (conservación: el residuo se ajusta en la última cuenta), y un aviso
 * cuando el reparto cayó a partes iguales por falta de historia o presupuesto.
 *
 * Signo dominante: los pesos de historia/presupuesto se filtran al signo de la
 * suma del conjunto, de modo que una cuenta con reversos (valor de signo
 * contrario) no se lleva una parte negativa.
 *
 * Casos:
 *   - 0 cuentas → arreglo vacío (el llamador debe tratar "sin destino" con
 *     `destinoUnico`, no con `repartir`).
 *   - 1 cuenta → toda la regla a esa cuenta.
 *   - `iguales` → partes iguales, sin aviso.
 *   - `historia` / `presupuesto` → pesos del criterio con signo dominante; si
 *     todos los pesos quedan en cero (sin historia ni presupuesto utilizables),
 *     cae a partes iguales CON aviso.
 */
export function repartir(
  montoRegla: number,
  cuentas: CuentaDestino[],
  opts: OpcionesReparto = {},
): ResultadoReparto {
  const criterio = opts.criterio ?? 'iguales';
  const n = opts.n ?? N_POR_DEFECTO;

  if (cuentas.length === 0) {
    return { destinos: [], aviso: null };
  }
  if (cuentas.length === 1) {
    return { destinos: [aDestino(cuentas[0], aCentimos(montoRegla))], aviso: null };
  }

  if (criterio === 'iguales') {
    return { destinos: repartirIguales(montoRegla, cuentas), aviso: null };
  }

  // Valores crudos del criterio (pueden traer reversos de signo contrario).
  const valores =
    criterio === 'historia'
      ? cuentas.map((c) => valorHistoria(c, n))
      : cuentas.map((c) => valorPresupuesto(c));

  const signo = signoDominante(valores);
  const pesos = valores.map((v) => pesoSigno(v, signo));
  const sumaPesos = pesos.reduce((a, b) => a + b, 0);

  if (sumaPesos === 0) {
    // Sin historia ni presupuesto utilizables: partes iguales CON aviso (§F).
    const que = criterio === 'historia' ? 'historia' : 'presupuesto';
    return {
      destinos: repartirIguales(montoRegla, cuentas),
      aviso: `Sin ${que} para repartir: se repartió en partes iguales.`,
    };
  }

  return { destinos: repartirPorPesos(montoRegla, cuentas, pesos), aviso: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// destinoUnico — sin destino, todo a la Combinada de la regla (§F, Req 14.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sin destino explícito: todo el monto va a la Combinada de la regla (Req 14.1).
 * Es el equivalente a `destinoRegla` de `salida.ts`, expresado aquí para que el
 * módulo de reparto cubra los dos lados del §F (sin destino y con destino) con
 * una sola fuente de verdad del tipo `DestinoCuenta`.
 */
export function destinoUnico(
  combinada: string,
  centroCosto: string,
  cuentaContable: string,
  montoUsd: number,
): DestinoCuenta {
  return { combinada, centroCosto, cuentaContable, montoUsd: aCentimos(montoUsd) };
}
// ═════════════════════════════════════════════════════════════════════════════
// CP-21 · Reglas por cuenta y «el resto» (§F, Req 15)
// ═════════════════════════════════════════════════════════════════════════════
//
// Una regla de NIVEL 'cuenta' estima UNA de las cuentas del concepto usando la
// historia y el acumulado DE ESA CUENTA. Su concepto deja entonces de estimar el
// total y pasa a estimar el RESTO de sus cuentas: a los insumos del concepto se
// les resta lo que ya cubren las reglas por cuenta.
//
//   resto_acumulado = acumulado_concepto − Σ acumulado_cuentas_con_regla_propia
//   resto_serie[m]  = serie_concepto[m]  − Σ serie_cuentas_con_regla_propia[m]
//
// redondeado a céntimos mes a mes. Así la suma «reglas por cuenta + resto» cuadra
// con el concepto (Property 7), sin duplicar gasto en el P&L.
//
// Esto SOLO es correcto si el método del concepto USA SU HISTORIA (promedio,
// mediana, último, proporción de venta, fórmula de venta): solo entonces restar
// acumulado y serie cambia de verdad el número del concepto. Si el método no mira
// su historia (un monto fijo, un porcentaje de otra cosa, un presupuesto…),
// restar la historia no evita el doble conteo y hay que AVISAR (CP-50 #3).
//
// Todo lo de aquí es PURO: no toca `calcular()` ni el motor. Mientras las reglas
// sigan en nivel 'concepto' (todas las de partida), el «resto» no se activa y el
// oráculo de 190 casos no se mueve.

import type { Regla, Operacion, OpPaso } from './engine';

/**
 * Tope de creación en lote de reglas por cuenta (CP-21, Req 15.3). Crear más de
 * 300 reglas de una sola vez se rechaza.
 */
export const MAX_REGLAS_LOTE = 300;

/**
 * Operaciones cuyo resultado DEPENDE de la historia propia de la regla (serie /
 * acumulado). Son las únicas con las que «el resto» del concepto funciona: al
 * restar la historia de las cuentas con regla propia, el número del concepto
 * cambia de verdad y no se duplica gasto (CP-21).
 *
 *   - `promedio`, `mediana`, `ultimo`  → leen la serie.
 *   - `ratio_venta`                    → proporción histórica de la venta.
 *   - `formula_venta`                  → acumulado + ritmo (ritmo = acum/trans).
 *
 * El resto de operaciones (valor_fijo, porcentaje, multiplicar, sumar, restar,
 * presupuesto, componentes, derivada) NO miran la historia propia: con ellas
 * restar la serie no evita el doble conteo (de ahí el aviso de CP-50 #3).
 */
const OPS_CON_HISTORIA: ReadonlySet<Operacion | OpPaso> = new Set<Operacion | OpPaso>([
  'promedio',
  'mediana',
  'ultimo',
  'ratio_venta',
  'formula_venta',
]);

/**
 * ¿El método del concepto usa su propia historia? (CP-21). Es la condición que
 * decide si «el resto» es correcto o si hay que avisar de doble conteo.
 *
 * Acepta la operación v1 (`Metodo.op`) o la de un paso v2 (`OpPaso`), que
 * comparten los nombres relevantes.
 */
export function metodoUsaHistoria(op: Operacion | OpPaso): boolean {
  return OPS_CON_HISTORIA.has(op);
}

/**
 * Insumos (serie + acumulado) de una cuenta con regla propia de nivel 'cuenta'.
 * Son los que se restan del concepto para formar «el resto».
 */
export interface InsumosCuenta {
  /** Serie histórica mensual de la cuenta (alineada con la del concepto). */
  serie: number[];
  /** Acumulado del mes en curso de la cuenta. */
  acum: number;
}

/** Insumos del concepto completo, antes de descontar las reglas por cuenta. */
export interface InsumosConcepto {
  serie: number[];
  acum: number;
}

/**
 * Resultado de `insumosDelResto`: los insumos que debe usar el concepto para
 * estimar el RESTO de sus cuentas (concepto − Σ cuentas con regla propia), más
 * el aviso de doble conteo cuando el método del concepto no usa su historia.
 */
export interface ResultadoResto {
  /** Serie del resto, mes a mes, redondeada a céntimos. */
  serie: number[];
  /** Acumulado del resto, redondeado a céntimos. */
  acum: number;
  /**
   * Aviso de doble conteo (CP-50 #3) o `null`. Aparece cuando hay al menos una
   * regla por cuenta pero el método del concepto NO usa su historia, de modo que
   * restar la historia no evita duplicar gasto en el P&L.
   */
  avisoDobleConteo: string | null;
}

/** Redondea a céntimos (2 decimales) de forma estable. Igual que en el reparto. */
function aCentimosResto(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula los insumos del «resto» del concepto (CP-21, Req 15.1, 15.2).
 *
 * Dado el concepto (su serie y acumulado completos) y las cuentas que ya tienen
 * regla propia de nivel 'cuenta', resta mes a mes la serie y el acumulado de esas
 * cuentas y redondea a céntimos:
 *
 *   resto_serie[m] = round(serie_concepto[m] − Σ serie_cuenta[m])
 *   resto_acum     = round(acum_concepto     − Σ acum_cuenta)
 *
 * El concepto estima entonces sobre estos insumos, de forma que «reglas por
 * cuenta + resto» cuadra con el total del concepto (Property 7).
 *
 * Doble conteo (CP-50 #3): si hay al menos una regla por cuenta y `opConcepto`
 * NO usa la historia, el «resto» no corrige nada y se devuelve un aviso. El
 * cálculo del resto se hace igual (por si el llamador quiere mostrarlo), pero el
 * aviso señala que ese concepto puede duplicar gasto.
 *
 * Series de distinta longitud se alinean por la COLA (los meses más recientes
 * coinciden), que es como viven las series del motor (`serie.slice(-n)`).
 *
 * Función PURA, sin efectos. No modifica las entradas.
 *
 * @param concepto   Serie y acumulado del concepto completo.
 * @param cuentas    Insumos de cada cuenta con regla propia de nivel 'cuenta'.
 * @param opConcepto Operación del método del concepto (para el aviso CP-50 #3).
 * @returns          Serie y acumulado del resto + aviso de doble conteo o null.
 *
 * _Requirements: 15.1, 15.2_
 */
export function insumosDelResto(
  concepto: InsumosConcepto,
  cuentas: InsumosCuenta[],
  opConcepto: Operacion | OpPaso,
): ResultadoResto {
  // Longitud común: la de la serie más larga (concepto o cualquier cuenta).
  let largo = concepto.serie.length;
  for (const c of cuentas) largo = Math.max(largo, c.serie.length);

  // Alinea una serie a la cola de longitud `largo` (meses recientes al final),
  // rellenando con ceros los meses antiguos ausentes.
  const alinear = (s: number[]): number[] => {
    const out = new Array<number>(largo).fill(0);
    for (let i = 0; i < s.length; i++) out[largo - s.length + i] = s[i] ?? 0;
    return out;
  };

  const base = alinear(concepto.serie);
  const serie = base.slice();
  for (const c of cuentas) {
    const sc = alinear(c.serie);
    for (let m = 0; m < largo; m++) serie[m] -= sc[m];
  }
  for (let m = 0; m < largo; m++) serie[m] = aCentimosResto(serie[m]);

  let acum = concepto.acum;
  for (const c of cuentas) acum -= c.acum;
  acum = aCentimosResto(acum);

  // Aviso de doble conteo (CP-50 #3): solo con reglas por cuenta y método que no
  // usa la historia.
  const avisoDobleConteo =
    cuentas.length > 0 && !metodoUsaHistoria(opConcepto)
      ? 'Posible doble conteo: el concepto tiene reglas por cuenta pero su método no usa la historia; restar el resto no evita duplicar gasto.'
      : null;

  return { serie, acum, avisoDobleConteo };
}

/**
 * Valida el tope de creación en lote de reglas por cuenta (CP-21, Req 15.3).
 * Devuelve `null` si `cantidad` está dentro del tope, o un mensaje de error si lo
 * supera. Función PURA pensada para la interfaz de creación en lote.
 *
 * _Requirements: 15.3_
 */
export function validarLoteReglasCuenta(cantidad: number): string | null {
  if (cantidad > MAX_REGLAS_LOTE) {
    return `No se pueden crear ${cantidad} reglas por cuenta de una sola vez: el máximo es ${MAX_REGLAS_LOTE}.`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CP-22 · Regla adicional que se suma al concepto — soporte del modelo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insumos de «el resto» de un concepto a partir de SUS reglas (CP-21 + CP-22).
 *
 * Una función pura de conveniencia que separa, de un juego de reglas de un mismo
 * concepto, cuáles son de nivel 'cuenta' (descuentan del concepto) y construye
 * los insumos del resto para la regla principal del concepto. Las reglas
 * adicionales (CP-22) se suman al concepto y NO descuentan historia, así que no
 * entran en el cálculo del resto; se dejan tal cual para que el motor las sume.
 *
 * La regla principal del concepto es la de nivel 'concepto' (default). Si hay
 * varias, se toma la primera; el llamador normalmente garantiza una principal
 * más sus adicionales y sus reglas por cuenta.
 *
 * @param reglasDelConcepto Todas las reglas de un mismo concepto/empresa.
 * @param serieCuentaDe     Dada una regla por cuenta, devuelve sus insumos
 *                          (serie + acumulado) de ESA cuenta.
 * @param opConcepto        Operación del método de la regla principal.
 * @returns                 Insumos del resto + aviso de doble conteo, o `null` si
 *                          el concepto no tiene ninguna regla por cuenta (el
 *                          concepto estima su total de siempre, sin «resto»).
 *
 * _Requirements: 15.1, 15.2, 15.4_
 */
export function insumosDelRestoDeReglas(
  reglasDelConcepto: Regla[],
  serieCuentaDe: (regla: Regla) => InsumosCuenta,
  opConcepto: Operacion | OpPaso,
): ResultadoResto | null {
  const principal = reglasDelConcepto.find((r) => (r.nivel ?? 'concepto') === 'concepto');
  const porCuenta = reglasDelConcepto.filter((r) => r.nivel === 'cuenta');

  // Sin reglas por cuenta: el concepto estima su total completo, no hay «resto».
  if (porCuenta.length === 0) return null;
  if (!principal) return null;

  const concepto: InsumosConcepto = { serie: principal.serie, acum: principal.acum };
  const cuentas = porCuenta.map(serieCuentaDe);
  return insumosDelResto(concepto, cuentas, opConcepto);
}

/**
 * Serie y acumulado de una cuenta, tal como vienen de `gyp_historico_cuenta`.
 * `meses` llega con `null` en los meses sin registro; aquí ya son NaN, que es
 * como el motor distingue «sin movimiento» de «cero» (trampa 2).
 */
export interface HistoriaDeCuenta {
  combinada: string;
  /** Serie mensual con NaN en los meses sin registro. */
  serie: number[];
  acum: number;
}

/**
 * C1 · Reasigna la historia de un juego de reglas para que las cuentas usen la
 * suya y el concepto estime «el resto».
 *
 * MUTA las reglas recibidas, a propósito: el llamador acaba de construirlas y
 * esto es el último paso del ensamblado.
 *
 * Qué arregla. Una regla de nivel 'cuenta' nacía con la historia del CONCEPTO
 * ENTERO. Abrir Gastos Varios de Beval en 5 cuentas con «Lo típico» daba 74.414
 * en cada cuenta —el concepto completo, cinco veces— y el concepto seguía
 * estimando sus 74.414 encima: el gasto se contaba seis veces y el Semi Neto de
 * Beval pasaba de 45.934 a −326.135.
 *
 * Qué hace:
 *   1. Cada regla de nivel 'cuenta' toma la serie y el acumulado de SU cuenta.
 *      Si no hay historia para esa Combinada se deja lo que tenía: es preferible
 *      el valor anterior a una serie en cero, que haría desaparecer el gasto.
 *   2. La regla principal del concepto (nivel 'concepto') pasa a estimar
 *      `concepto − Σ cuentas con regla propia`, de modo que
 *      «reglas por cuenta + resto» vuelve a sumar el total del concepto.
 *
 * Sin reglas por cuenta no toca nada: las 95 reglas de partida están todas en
 * nivel 'concepto', así que el oráculo de los 190 casos no se mueve.
 *
 * Las reglas ADICIONALES (CP-22) se suman al concepto y NO descuentan historia;
 * `insumosDelRestoDeReglas` ya las distingue por nivel.
 *
 * @param reglas   Todas las reglas ya ensambladas (de todas las empresas).
 * @param historia Historia por `combinada` del periodo.
 * @param opDe     Operación del método de una regla (para el aviso CP-50 #3).
 * @returns        Los avisos de doble conteo encontrados, por `empresa|concepto`.
 */
export function aplicarHistoriaPorCuenta(
  reglas: Regla[],
  historia: Map<string, HistoriaDeCuenta>,
  opDe: (regla: Regla) => Operacion | OpPaso,
): Record<string, string> {
  // 1) Cada cuenta con su propia historia.
  for (const r of reglas) {
    if (r.nivel !== 'cuenta') continue;
    const h = historia.get(r.combinada);
    if (!h) continue;
    r.serie = h.serie;
    r.acum = h.acum;
  }

  // 2) El concepto estima el resto.
  const porConcepto = new Map<string, Regla[]>();
  for (const r of reglas) {
    const k = r.empresa + '|' + r.concepto;
    const g = porConcepto.get(k);
    if (g) g.push(r);
    else porConcepto.set(k, [r]);
  }

  const avisos: Record<string, string> = {};
  porConcepto.forEach((rs, k) => {
    const principal = rs.find((r) => (r.nivel ?? 'concepto') === 'concepto');
    if (!principal) return;
    const resto = insumosDelRestoDeReglas(
      rs,
      (r) => {
        const h = historia.get(r.combinada);
        return { serie: h?.serie ?? r.serie, acum: h?.acum ?? r.acum };
      },
      opDe(principal),
    );
    if (!resto) return;
    principal.serie = resto.serie;
    principal.acum = resto.acum;
    if (resto.avisoDobleConteo) avisos[k] = resto.avisoDobleConteo;
  });
  return avisos;
}
