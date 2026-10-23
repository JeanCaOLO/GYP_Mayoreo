import type { AgregadoEmpresa, Regla } from '../engine';

/**
 * CP-47 · Prueba contable de la Renta Bruta.
 *
 * En Resultado, debajo del P&L, se comprueba para cada empresa la identidad que
 * el proyecto entero vigila:
 *
 *     Renta Bruta = Margen + Ingresos Mercantiles + Fletes Recuperados − Merma
 *
 * donde `Margen = Ventas − Costo de Ventas` (Colocación hace de Venta en Prisma).
 *
 * El motor guarda los montos en **signo crudo** (ingresos en negativo, gastos en
 * positivo) y define `agg.rb = −(suma del grupo VENTAS)`. La identidad desglosa
 * esa Renta Bruta en sus componentes nombrados; si algún concepto del grupo
 * VENTAS no entra en el desglose (o lleva signo contrario), la suma de los
 * componentes deja de cuadrar con `agg.rb` y la empresa se marca.
 *
 * Si la prueba no cuadra en alguna empresa, el resultado **no se publica**
 * (Requirement 22.3): `page.tsx` expone las empresas malas al padre para
 * bloquear la publicación.
 */

/** Conceptos del grupo VENTAS que participan en la identidad CP-47. */
const CONCEPTOS_VENTA = new Set(['Ventas', 'Colocacion', 'Colocación']);
const CONCEPTO_COSTO = 'Costo de Ventas';
const CONCEPTO_ING_MERC = 'Ingresos Mercantiles';
const CONCEPTO_FLETES = 'Fletes Recuperados';
const CONCEPTO_MERMA = 'Merma';

/** Desglose de la Renta Bruta de una empresa según la identidad CP-47. */
export interface DesgloseRentaBruta {
  empresa: string;
  /** Ventas (o Colocación) en signo natural positivo. */
  venta: number;
  /** Costo de Ventas en signo natural positivo. */
  costo: number;
  /** Margen = Venta − Costo. */
  margen: number;
  ingresosMercantiles: number;
  fletesRecuperados: number;
  merma: number;
  /** Renta Bruta por la identidad = Margen + Ing.Merc + Fletes − Merma. */
  rbIdentidad: number;
  /** Renta Bruta que calcula el motor (−suma del grupo VENTAS). */
  rbMotor: number;
  /** Conceptos del grupo VENTAS que no entran en la identidad (stray). */
  conceptosNoContemplados: string[];
  /** rbIdentidad − rbMotor. */
  diferencia: number;
  /** ¿Cuadra a ±0,01 USD y sin conceptos sueltos? */
  cuadra: boolean;
}

const TOLERANCIA = 0.01;

/**
 * Calcula el desglose de la Renta Bruta de una empresa a partir de las reglas y
 * sus montos (signo crudo), y lo contrasta con la Renta Bruta del motor.
 */
export function desglosarRentaBruta(
  empresa: string,
  reglas: Regla[],
  val: number[],
  agg: Record<string, AgregadoEmpresa>,
): DesgloseRentaBruta {
  let venta = 0;
  let costo = 0;
  let ingresosMercantiles = 0;
  let fletesRecuperados = 0;
  let merma = 0;
  const conceptosNoContemplados: string[] = [];

  reglas.forEach((r, i) => {
    if (r.empresa !== empresa || r.grupo !== 'VENTAS') return;
    const v = val[i] ?? 0;
    if (CONCEPTOS_VENTA.has(r.concepto)) {
      venta += -v; // ingreso (negativo) → venta positiva
    } else if (r.concepto === CONCEPTO_COSTO) {
      costo += v; // costo guardado en positivo
    } else if (r.concepto === CONCEPTO_ING_MERC) {
      ingresosMercantiles += -v;
    } else if (r.concepto === CONCEPTO_FLETES) {
      fletesRecuperados += -v;
    } else if (r.concepto === CONCEPTO_MERMA) {
      merma += v; // merma guardada en positivo (gasto)
    } else {
      conceptosNoContemplados.push(r.concepto);
    }
  });

  const margen = venta - costo;
  const rbIdentidad = margen + ingresosMercantiles + fletesRecuperados - merma;
  const rbMotor = agg[empresa]?.rb ?? 0;
  const diferencia = rbIdentidad - rbMotor;
  const cuadra = Math.abs(diferencia) <= TOLERANCIA && conceptosNoContemplados.length === 0;

  return {
    empresa,
    venta,
    costo,
    margen,
    ingresosMercantiles,
    fletesRecuperados,
    merma,
    rbIdentidad,
    rbMotor,
    conceptosNoContemplados,
    diferencia,
    cuadra,
  };
}

/** Desglose de la identidad CP-47 para cada empresa. */
export function desglosarRentaBrutaTodas(
  empresas: readonly string[],
  reglas: Regla[],
  val: number[],
  agg: Record<string, AgregadoEmpresa>,
): DesgloseRentaBruta[] {
  return empresas.map((e) => desglosarRentaBruta(e, reglas, val, agg));
}

/**
 * Empresas cuya identidad CP-47 no cuadra. Si la lista no está vacía, la
 * publicación debe detenerse (Requirement 22.3 / CP-44 punto 1).
 */
export function empresasPruebaFallida(desgloses: DesgloseRentaBruta[]): string[] {
  return desgloses.filter((d) => !d.cuadra).map((d) => d.empresa);
}
