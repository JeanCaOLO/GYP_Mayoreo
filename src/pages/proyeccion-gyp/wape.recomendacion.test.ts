/**
 * C13 de la auditoría: la recomendación probaba solo 9 meses y desalineaba los
 * meses sin registro.
 */
import { describe, it, expect } from 'vitest';
import { OPCIONES_BACKTEST } from './wape';

describe('C13 · la recomendación prueba las cuatro ventanas', () => {
  it('lo típico se prueba con 3, 6, 9 y 12 meses', () => {
    const n = OPCIONES_BACKTEST.filter((o) => o.tipo === 'tipico').map((o) => o.n).sort((a, b) => a! - b!);
    expect(n).toEqual([3, 6, 9, 12]);
  });

  it('el promedio se prueba con 3, 6, 9 y 12 meses', () => {
    const n = OPCIONES_BACKTEST.filter((o) => o.tipo === 'promedio').map((o) => o.n).sort((a, b) => a! - b!);
    expect(n).toEqual([3, 6, 9, 12]);
  });

  it('según la venta mantiene sus cuatro ventanas', () => {
    const n = OPCIONES_BACKTEST.filter((o) => o.tipo === 'ratio_venta').map((o) => o.n).sort((a, b) => a! - b!);
    expect(n).toEqual([3, 6, 9, 12]);
  });

  it('las claves son únicas: una tarjeta por opción', () => {
    const claves = OPCIONES_BACKTEST.map((o) => o.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('antes eran 6 opciones; ahora se miden 13', () => {
    expect(OPCIONES_BACKTEST.length).toBe(13); // 4 típico + 4 promedio + 1 último + 4 ratio
  });
});
