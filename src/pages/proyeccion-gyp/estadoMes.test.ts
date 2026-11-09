import { describe, it, expect } from 'vitest';
import {
  estadoDelPeriodo,
  fraseEstadoMes,
  ultimoDiaDelMes,
  nombreMes,
} from './components/PestanaParametros';

describe('ultimoDiaDelMes', () => {
  it('conoce los meses de 30 y 31', () => {
    expect(ultimoDiaDelMes('2026-09')).toBe(30);
    expect(ultimoDiaDelMes('2026-10')).toBe(31);
  });
  it('conoce febrero, tambien bisiesto', () => {
    expect(ultimoDiaDelMes('2026-02')).toBe(28);
    expect(ultimoDiaDelMes('2024-02')).toBe(29);
  });
});

describe('nombreMes', () => {
  it('da el mes corto en castellano', () => {
    expect(nombreMes('2026-09')).toBe('sep 2026');
    expect(nombreMes('2026-01')).toBe('ene 2026');
  });
});

describe('estadoDelPeriodo', () => {
  it('un mes cuyo corte llega al ultimo dia esta completo', () => {
    const e = estadoDelPeriodo('2026-09', '2026-09-30', 'db', 26, 26);
    expect(e.fase).toBe('completo');
  });

  it('un mes cuyo corte no llega al ultimo dia va en curso', () => {
    const e = estadoDelPeriodo('2026-10', '2026-10-29', 'db', 26, 24);
    expect(e.fase).toBe('en_curso');
  });

  it('sin corte, o con la fuente en error, queda sin datos', () => {
    expect(estadoDelPeriodo('2026-09', null, 'db').fase).toBe('sin_datos');
    expect(estadoDelPeriodo('2026-09', '2026-09-30', 'error').fase).toBe('sin_datos');
  });
});

describe('fraseEstadoMes', () => {
  // LA REGRESION QUE MOTIVA ESTE ARCHIVO: septiembre tenia sus datos, sus
  // reglas y sus parametros, y la tarjeta decia «todavia sin datos». La causa
  // era que se le pasaba `corte: null` a un mes marcado como terminado, y la
  // frase mira el corte ANTES que la fase. Un mes preparado tiene que
  // describirse con su corte real.
  it('un mes cerrado dice hasta cuando llegan sus datos', () => {
    const e = estadoDelPeriodo('2026-09', '2026-09-30', 'db', 26, 26);
    expect(fraseEstadoMes(e)).toBe('mes completo · datos al 30 sep');
    expect(fraseEstadoMes(e)).not.toContain('sin datos');
  });

  it('el mes en curso dice los dias habiles transcurridos', () => {
    const e = estadoDelPeriodo('2026-10', '2026-10-29', 'db', 26, 24);
    expect(fraseEstadoMes(e)).toBe('en curso · datos al 29 oct (24 de 26 días hábiles)');
  });

  it('sin corte si dice que no hay datos', () => {
    expect(fraseEstadoMes({ periodo: '2026-08', corte: null, fase: 'sin_datos' }))
      .toBe('todavía sin datos');
  });

  // Esta es la trampa exacta: la fase decia una cosa y el corte otra. Mientras
  // `fraseEstadoMes` mire el corte primero, quien construya un EstadoMes tiene
  // que darle uno; si no, la fase no se respeta.
  it('una fase de mes terminado SIN corte sigue leyendose como sin datos', () => {
    expect(fraseEstadoMes({ periodo: '2026-09', corte: null, fase: 'terminado' }))
      .toBe('todavía sin datos');
  });

  it('un mes terminado con corte parcial lo dice', () => {
    expect(fraseEstadoMes({ periodo: '2026-09', corte: '2026-09-28', fase: 'terminado' }))
      .toBe('terminó · datos solo hasta el 28 sep');
  });
});
