/**
 * D8 · La publicación no debe esconder errores detrás de ceros.
 *
 * `monto_local = monto * (tasa || 0)` convertía una tasa ausente en una columna
 * entera de ceros en Power BI: un dato que parece bueno y no lo es. Y el país
 * caía a `r.empresa`, así que la columna Pais acababa diciendo «Beval».
 */
import { describe, it, expect } from 'vitest';
import { construirFilasEscenarios } from './salida';
import { METODOS_BASE, PARAMS_SEED, REGLAS_SEED, EMPRESAS } from './seed';
import { SERIE_ORACULO_7OCT } from './series';
import type { Metodo, Parametro, Regla } from './engine';

const metodos: Record<string, Metodo> = {};
Object.values(METODOS_BASE).forEach((m) => (metodos[m.id] = { ...m }));

function armarParams(): Record<string, Parametro> {
  const p: Record<string, Parametro> = {};
  PARAMS_SEED.forEach((x) => {
    p[x.empresa] = { empresa: x.empresa, dias: x.dias, trans: x.trans, factor: x.factor, tasa: x.tasa };
  });
  return p;
}
function armarReglas(): Regla[] {
  return REGLAS_SEED.map((r, i) => {
    const sc = SERIE_ORACULO_7OCT[r.empresa + '|' + r.concepto] || { a: 0, s: [] };
    return {
      key: 'r' + i, empresa: r.empresa, concepto: r.concepto, grupo: r.grupo, metodo: r.metodo,
      valor: r.valor, n: null, combinada: r.combinada, cc: r.cc, cuenta: r.cuenta,
      pais: r.empresa, tasaMensual: r.tasaMensual,
      serie: (sc.s || []).map((x) => (x == null ? NaN : x)), acum: sc.a || 0, nueva: false,
    } as Regla;
  });
}

const base = { reglas: armarReglas(), metodos, params: armarParams(), empresas: EMPRESAS, gn: 9 };

describe('D8 · ceros que esconden errores', () => {
  it('con todas las tasas, publica normal', () => {
    const filas = construirFilasEscenarios('2026-10', base);
    expect(filas).toHaveLength(190);
    expect(filas.every((f) => Number.isFinite(f.monto_local))).toBe(true);
  });

  it('sin la tasa de una empresa NO publica ceros: se niega y dice cuál', () => {
    const params = armarParams();
    params['Beval'] = { ...params['Beval'], tasa: null as unknown as number };
    expect(() => construirFilasEscenarios('2026-10', { ...base, params })).toThrow(/Beval/);
  });

  it('con tasa 0 tampoco publica: 0 no es una tasa válida', () => {
    const params = armarParams();
    params['Febeca'] = { ...params['Febeca'], tasa: 0 };
    expect(() => construirFilasEscenarios('2026-10', { ...base, params })).toThrow(/Febeca/);
  });

  it('la columna Pais nunca lleva el nombre de la empresa', () => {
    const filas = construirFilasEscenarios('2026-10', base);
    for (const f of filas) expect(f.pais).not.toBe(f.empresa);
  });
});
