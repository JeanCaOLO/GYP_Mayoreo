/**
 * Llevar al causado — los cuatro modos del §E (CP-19) de la Proyección del GyP.
 *
 * Esta es una capa PURA del motor v2: no habla con la red ni con la interfaz.
 * Toma el resultado ya PROYECTADO de una regla y lo transforma en su valor
 * CAUSADO al corte según el modo declarado por la regla. Al ser pura se prueba
 * sola contra la tabla del §E de `12-cambios-para-produccion.md`.
 *
 * ── Los cuatro modos (Parte II §E, CP-19) ──
 *   - `igual`      → mismo valor que en Proyección (default).
 *   - `habiles`    → resultado × transcurridos ÷ días hábiles de la empresa.
 *   - `calendario` → resultado × día del corte ÷ días del mes (calendario).
 *   - `real`       → lo asentado al corte en las cuentas de la regla o su destino.
 *
 * ── Qué NO se causa (§E) ──
 * El modo NO aplica a la fórmula de venta —que ya usa el acumulado al corte— ni a
 * la derivada —que sale de otras reglas ya causadas—. Para esos dos casos el
 * valor proyectado ya ES el causado, así que `llevarACausado` devuelve el
 * resultado sin tocar, sea cual sea el modo declarado (Requirement 13.3).
 *
 * Este módulo es ADITIVO: el motor v1 solo calculaba el escenario proyectado; el
 * causado es nuevo y se conecta en la tarea 5.3 (los dos escenarios del §H). No
 * mueve ninguno de los 190 casos de la compuerta (CP-43).
 *
 * _Requirements: 13.1, 13.2, 13.3_
 */

import type { Causado, Parametro } from './engine';

/** Modo de causado por defecto (§E, Requirement 13.2). */
export const CAUSADO_DEFAULT: Causado = 'igual';

/**
 * Datos del corte que algunos modos necesitan. Todos son opcionales porque cada
 * modo usa solo los suyos:
 *   - `habiles`    usa `params.trans` y `params.dias` (no necesita opts).
 *   - `calendario` necesita `diaDelCorte` y `diasDelMes` (del calendario).
 *   - `real`       necesita `asentadoAlCorte` (lo registrado en las cuentas).
 *
 * `esVentaODerivada` marca las reglas que el §E excluye (fórmula de venta y
 * derivada): cuando es `true`, el valor proyectado se devuelve intacto.
 */
export interface OpcionesCausado {
  /** Día del mes en que se tomó el corte (1..31). Solo modo `calendario`. */
  diaDelCorte?: number;
  /** Días del mes por calendario (28..31). Solo modo `calendario`. */
  diasDelMes?: number;
  /**
   * Monto ya asentado al corte en las cuentas de la regla o de su destino.
   * Solo modo `real`. Lo provee la capa de datos (detalle por cuenta).
   */
  asentadoAlCorte?: number;
  /**
   * `true` si la regla se calcula por fórmula de venta o por derivada. El §E no
   * les aplica causado: su valor proyectado ya viene al corte.
   */
  esVentaODerivada?: boolean;
}

/**
 * Lleva al causado el resultado proyectado de una regla según su `modo` (§E).
 *
 * Función pura: mismos argumentos → mismo resultado. No lanza; ante datos del
 * corte ausentes o inconsistentes cae a comportamiento seguro (ver abajo).
 *
 * @param resultadoProyectado  Monto proyectado al cierre de la regla (USD).
 * @param modo                 Modo de causado declarado por la regla.
 * @param params               Parámetros de la empresa (trans y dias hábiles).
 * @param opts                 Datos del corte que cada modo pueda necesitar.
 * @returns                    El monto causado al corte (USD).
 *
 * Comportamiento ante datos faltantes (no rompe los 190 casos ni la publicación):
 *   - Venta/derivada → devuelve el proyectado sin tocar (§E, Requirement 13.3).
 *   - `habiles`  con `dias` ≤ 0 → sin prorrateo posible: devuelve el proyectado.
 *   - `calendario` con `diasDelMes` ≤ 0 → devuelve el proyectado.
 *   - `calendario` sin `diaDelCorte` → usa los transcurridos como respaldo.
 *   - `real` sin `asentadoAlCorte` → 0 (al corte no hay nada asentado aún).
 */
export function llevarACausado(
  resultadoProyectado: number,
  modo: Causado,
  params: Parametro,
  opts: OpcionesCausado = {},
): number {
  // §E: la fórmula de venta y la derivada no se causan. Su proyectado ya viene
  // al corte, así que se devuelve intacto sin importar el modo (Requirement 13.3).
  if (opts.esVentaODerivada) return resultadoProyectado;

  switch (modo) {
    case 'igual':
      // Mismo valor que en Proyección (Requirement 13.1, default 13.2).
      return resultadoProyectado;

    case 'habiles': {
      // resultado × transcurridos ÷ días hábiles de la empresa (Requirement 13.1).
      const dias = params.dias;
      const trans = params.trans;
      if (!(dias > 0)) return resultadoProyectado;
      return (resultadoProyectado * trans) / dias;
    }

    case 'calendario': {
      // resultado × día del corte ÷ días del mes (Requirement 13.1).
      const diasDelMes = opts.diasDelMes;
      if (!(typeof diasDelMes === 'number' && diasDelMes > 0)) return resultadoProyectado;
      // Sin día del corte explícito, los transcurridos son el mejor respaldo.
      const diaDelCorte = typeof opts.diaDelCorte === 'number' ? opts.diaDelCorte : params.trans;
      return (resultadoProyectado * diaDelCorte) / diasDelMes;
    }

    case 'real':
      // Lo asentado al corte en las cuentas de la regla o su destino (Req. 13.1).
      return opts.asentadoAlCorte ?? 0;

    default: {
      // Modo desconocido: se comporta como `igual` (default seguro, Req. 13.2).
      return resultadoProyectado;
    }
  }
}
