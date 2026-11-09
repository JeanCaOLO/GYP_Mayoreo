/**
 * Compuertas del escenario CAUSADO (§E) — C3 y C4 de la auditoría del 29-oct.
 *
 * Estas dos fallas no las atrapaba la suite existente: las 95 reglas de partida
 * usan 'igual' o 'habiles', así que ni el prorrateo por calendario ni el modo
 * "lo registrado al corte" se ejercitaban nunca. El oráculo de los 190 casos
 * seguía en verde con los dos rotos.
 *
 * Por eso van aparte: cada test fuerza el modo de causado en UNA regla y
 * comprueba la aritmética del §E contra el valor esperado, no contra sí misma.
 */
import { describe, it, expect } from 'vitest';
import { calcularEscenarios } from './engine';
import type { Regla, Metodo, Parametro } from './engine';
import { REGLAS_SEED, METODOS_BASE, PARAMS_SEED, EMPRESAS } from './seed';
import { SERIE_ORACULO_7OCT } from './series';
import { CAUSADO_DE_METODO } from './components/PanelRegla';

/** Mismo ensamblado que `ensamblarReglas` de data.ts (ver engine.test.ts). */
function armarReglas(): Regla[] {
  return REGLAS_SEED.map((r, i) => {
    const sc = SERIE_ORACULO_7OCT[r.empresa + '|' + r.concepto] || { a: 0, s: [] };
    return {
      key: 'r' + i, empresa: r.empresa, concepto: r.concepto, grupo: r.grupo,
      metodo: r.metodo, valor: r.valor, n: null, combinada: r.combinada, cc: r.cc,
      cuenta: r.cuenta, pais: r.empresa, tasaMensual: r.tasaMensual,
      serie: (sc.s || []).map((x) => (x == null ? NaN : x)),
      acum: sc.a || 0, nueva: false,
    } as Regla;
  });
}

const metodos: Record<string, Metodo> = {};
Object.values(METODOS_BASE).forEach((m) => (metodos[m.id] = { ...m }));
const params: Record<string, Parametro> = {};
PARAMS_SEED.forEach((p) => {
  params[p.empresa] = { empresa: p.empresa, dias: p.dias, trans: p.trans, factor: p.factor, tasa: p.tasa };
});

const reglas = armarReglas();
const base = { reglas, metodos, params, empresas: EMPRESAS, gn: 9 };
/** Gasto puro: su causado no depende de la venta ni de otros conceptos. */
const iGV = reglas.findIndex((r) => r.empresa === 'Beval' && r.concepto === 'Gastos Varios');

describe('§E · Causado por días calendario (C3)', () => {
  it('sin los datos del corte cae al respaldo y NO prorratea', () => {
    const rs = reglas.map((r, j) => (j === iGV ? { ...r, causado: 'calendario' } : r)) as Regla[];
    const res = calcularEscenarios({ ...base, reglas: rs });
    // Este es el comportamiento que veía el usuario: causado == proyectado.
    expect(res.causado.val[iGV]).toBeCloseTo(res.proyeccion.val[iGV], 2);
  });

  it('con día del corte y días del mes prorratea: resultado × 7 ÷ 31', () => {
    const rs = reglas.map((r, j) => (j === iGV ? { ...r, causado: 'calendario' } : r)) as Regla[];
    const res = calcularEscenarios({ ...base, reglas: rs, diaDelCorte: 7, diasDelMes: 31 });
    const proyectado = res.proyeccion.val[iGV];
    expect(proyectado).toBeCloseTo(74413.8, 2);
    expect(res.causado.val[iGV]).toBeCloseTo((proyectado * 7) / 31, 2);
    expect(res.causado.val[iGV]).toBeCloseTo(16803.12, 2);
  });
});

describe('§E · Causado "lo registrado al corte" (C4)', () => {
  it('devuelve lo asentado de la cuenta, no 0', () => {
    const rs = reglas.map((r, j) => (j === iGV ? { ...r, causado: 'real' } : r)) as Regla[];
    const res = calcularEscenarios({ ...base, reglas: rs, diaDelCorte: 7, diasDelMes: 31 });
    expect(rs[iGV].acum).toBeGreaterThan(0);
    expect(res.causado.val[iGV]).toBeCloseTo(rs[iGV].acum, 2);
    expect(res.causado.val[iGV]).toBeCloseTo(22993.21, 2);
  });
});

describe('Por qué el oráculo de 190 no atrapaba C3 ni C4', () => {
  it('ninguna regla de partida usa un modo de causado que los ejercite', () => {
    const porModo = reglas.reduce<Record<string, number>>((acc, r) => {
      const m = (r as { causado?: string }).causado ?? 'igual';
      acc[m] = (acc[m] ?? 0) + 1;
      return acc;
    }, {});
    expect(porModo['real'] ?? 0).toBe(0);
    expect(porModo['calendario'] ?? 0).toBe(0);
  });
});

/**
 * C5 · Elegir una opción debe fijar su modo de causado.
 *
 * El mapeo sale de la tabla `OPCIONES` del prototipo (campo `causa`). Esta
 * compuerta existe para que no se desvíe en silencio: si alguien cambia un
 * modo, el test lo dice y obliga a mirar el prototipo antes.
 */
describe('§E · Causado por defecto de cada opción (C5)', () => {
  it('las cinco opciones sobre historia o monto causan por calendario', () => {
    for (const id of ['m_mediana', 'm_promedio', 'm_ultimo', 'm_ppto', 'm_fijo']) {
      expect(CAUSADO_DE_METODO[id], id).toBe('calendario');
    }
  });

  it('las opciones sobre la venta o el Semi Neto causan igual', () => {
    for (const id of ['m_ratio_venta', 'm_pct_venta', 'm_pct_semineto']) {
      expect(CAUSADO_DE_METODO[id], id).toBe('igual');
    }
  });

  it('la fórmula de venta y la derivada NO fijan causado: ya son el suyo', () => {
    expect(CAUSADO_DE_METODO['m_venta']).toBeUndefined();
    expect(CAUSADO_DE_METODO['m_derivada']).toBeUndefined();
  });

  it('un método propio no está en el mapa y conserva su causado', () => {
    expect(CAUSADO_DE_METODO['m_inventado_por_el_usuario']).toBeUndefined();
  });
});
