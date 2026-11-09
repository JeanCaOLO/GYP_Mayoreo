/**
 * C1 de la auditoría del 29-oct: abrir un concepto por cuentas duplicaba el gasto.
 *
 * El oráculo de los 190 casos no lo atrapaba porque las 95 reglas de partida
 * están todas en nivel 'concepto': `insumosDelRestoDeReglas` devolvía null y el
 * camino roto no se ejercitaba nunca. Esta suite lo fuerza.
 */
import { describe, it, expect } from 'vitest';
import { aplicarHistoriaPorCuenta, type HistoriaDeCuenta } from './destino';
import type { Regla } from './engine';

/** Regla mínima para el ensamblado; solo importan nivel, combinada, serie y acum. */
function regla(p: Partial<Regla> & { key: string; combinada: string }): Regla {
  return {
    empresa: 'Beval', concepto: 'Gastos Varios', grupo: 'GOP', metodo: 'tipico',
    valor: null, n: null, cc: '', cuenta: '', pais: 'Venezuela', tasaMensual: null,
    serie: [], acum: 0, nueva: false, ...p,
  } as Regla;
}

const SERIE_CONCEPTO = [1000, 1200, 800, 1000];
const ACUM_CONCEPTO = 900;

describe('C1 · El concepto estima «el resto», no su total completo', () => {
  it('sin reglas por cuenta no toca nada (las 95 de partida)', () => {
    const rs = [regla({ key: 'c', combinada: 'X', serie: [...SERIE_CONCEPTO], acum: ACUM_CONCEPTO })];
    aplicarHistoriaPorCuenta(rs, new Map(), () => 'promedio');
    expect(rs[0].serie).toEqual(SERIE_CONCEPTO);
    expect(rs[0].acum).toBe(ACUM_CONCEPTO);
  });

  it('cada cuenta toma SU historia, no la del concepto', () => {
    const rs = [
      regla({ key: 'c', combinada: 'CONCEPTO', serie: [...SERIE_CONCEPTO], acum: ACUM_CONCEPTO }),
      regla({ key: 'a', combinada: 'CTA-A', nivel: 'cuenta', serie: [...SERIE_CONCEPTO], acum: ACUM_CONCEPTO }),
    ];
    const historia = new Map<string, HistoriaDeCuenta>([
      ['CTA-A', { combinada: 'CTA-A', serie: [100, 120, 80, 100], acum: 90 }],
    ]);
    aplicarHistoriaPorCuenta(rs, historia, () => 'promedio');
    // La cuenta dejó de llevar el concepto entero.
    expect(rs[1].serie).toEqual([100, 120, 80, 100]);
    expect(rs[1].acum).toBe(90);
  });

  it('PROPIEDAD: cuentas + resto vuelven a sumar el total del concepto', () => {
    const rs = [
      regla({ key: 'c', combinada: 'CONCEPTO', serie: [...SERIE_CONCEPTO], acum: ACUM_CONCEPTO }),
      regla({ key: 'a', combinada: 'CTA-A', nivel: 'cuenta', serie: [], acum: 0 }),
      regla({ key: 'b', combinada: 'CTA-B', nivel: 'cuenta', serie: [], acum: 0 }),
    ];
    const historia = new Map<string, HistoriaDeCuenta>([
      ['CTA-A', { combinada: 'CTA-A', serie: [100, 120, 80, 100], acum: 90 }],
      ['CTA-B', { combinada: 'CTA-B', serie: [250, 300, 200, 250], acum: 225 }],
    ]);
    aplicarHistoriaPorCuenta(rs, historia, () => 'promedio');

    const resto = rs[0];
    expect(resto.serie).toEqual([650, 780, 520, 650]);
    expect(resto.acum).toBeCloseTo(585, 2);

    // Esto es lo que el defecto rompía: mes a mes, resto + cuentas = concepto.
    for (let m = 0; m < SERIE_CONCEPTO.length; m++) {
      const suma = resto.serie[m] + historia.get('CTA-A')!.serie[m] + historia.get('CTA-B')!.serie[m];
      expect(suma).toBeCloseTo(SERIE_CONCEPTO[m], 2);
    }
    expect(resto.acum + 90 + 225).toBeCloseTo(ACUM_CONCEPTO, 2);
  });

  it('el defecto reproducido: sin la corrección el gasto se contaba de más', () => {
    // Antes, las 2 cuentas y el concepto llevaban los MISMOS insumos, así que
    // un método sobre la historia estimaba el concepto entero tres veces.
    const sinCorregir = [SERIE_CONCEPTO, SERIE_CONCEPTO, SERIE_CONCEPTO];
    const totalMalo = sinCorregir.reduce((a, s) => a + s[0], 0);
    expect(totalMalo).toBe(3000); // 3 × 1000

    const rs = [
      regla({ key: 'c', combinada: 'CONCEPTO', serie: [...SERIE_CONCEPTO], acum: ACUM_CONCEPTO }),
      regla({ key: 'a', combinada: 'CTA-A', nivel: 'cuenta', serie: [...SERIE_CONCEPTO], acum: ACUM_CONCEPTO }),
      regla({ key: 'b', combinada: 'CTA-B', nivel: 'cuenta', serie: [...SERIE_CONCEPTO], acum: ACUM_CONCEPTO }),
    ];
    const historia = new Map<string, HistoriaDeCuenta>([
      ['CTA-A', { combinada: 'CTA-A', serie: [100, 120, 80, 100], acum: 90 }],
      ['CTA-B', { combinada: 'CTA-B', serie: [250, 300, 200, 250], acum: 225 }],
    ]);
    aplicarHistoriaPorCuenta(rs, historia, () => 'promedio');
    const totalBueno = rs[0].serie[0] + rs[1].serie[0] + rs[2].serie[0];
    expect(totalBueno).toBeCloseTo(SERIE_CONCEPTO[0], 2); // 1000, no 3000
  });

  it('una cuenta sin historia conserva la suya: el gasto no desaparece', () => {
    const rs = [
      regla({ key: 'c', combinada: 'CONCEPTO', serie: [...SERIE_CONCEPTO], acum: ACUM_CONCEPTO }),
      regla({ key: 'z', combinada: 'SIN-DETALLE', nivel: 'cuenta', serie: [5, 5, 5, 5], acum: 4 }),
    ];
    aplicarHistoriaPorCuenta(rs, new Map(), () => 'promedio');
    expect(rs[1].serie).toEqual([5, 5, 5, 5]);
    expect(rs[1].acum).toBe(4);
  });
});
