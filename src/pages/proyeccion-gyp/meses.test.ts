import { describe, it, expect } from 'vitest';
import { mesAnterior, periodoDeFecha, mesesSeleccionables, mesSeleccionable } from './meses';

describe('mesAnterior', () => {
  it('resta un mes', () => {
    expect(mesAnterior('2026-10')).toBe('2026-09');
  });
  it('cruza el año', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12');
  });
  it('rellena el cero a la izquierda', () => {
    expect(mesAnterior('2026-10')).toBe('2026-09');
    expect(mesAnterior('2026-11')).toBe('2026-10');
  });
  it('devuelve lo mismo si el periodo no es valido', () => {
    expect(mesAnterior('basura')).toBe('basura');
    expect(mesAnterior('2026-13')).toBe('2026-13');
  });
});

describe('periodoDeFecha', () => {
  it('recorta el dia', () => {
    expect(periodoDeFecha('2026-10-30')).toBe('2026-10');
  });
});

describe('mesesSeleccionables', () => {
  it('ofrece el mes en curso y el anterior', () => {
    expect(mesesSeleccionables('2026-10-30', '2026-10')).toEqual(['2026-10', '2026-09']);
  });

  it('son solo dos: no aparece el antepenultimo', () => {
    const m = mesesSeleccionables('2026-10-30', '2026-10');
    expect(m).toHaveLength(2);
    expect(m).not.toContain('2026-08');
  });

  it('sin mes fijado, igual ofrece los dos', () => {
    expect(mesesSeleccionables('2026-10-01', null)).toEqual(['2026-10', '2026-09']);
  });

  it('cruza el año en diciembre y enero', () => {
    expect(mesesSeleccionables('2026-01-05', '2026-01')).toEqual(['2026-01', '2025-12']);
  });

  // El caso que motiva todo esto: ya es noviembre y el equipo sigue en octubre.
  it('al pasar a noviembre, el mes fijado NO cambia y sigue ofreciendose', () => {
    const m = mesesSeleccionables('2026-11-01', '2026-10');
    expect(m).toEqual(['2026-11', '2026-10']);
    // octubre sigue ahi: el usuario puede seguir trabajandolo sin hacer nada.
    expect(m).toContain('2026-10');
  });

  // Si nadie avanza el mes durante semanas, el fijado se queda fuera del par
  // y hay que mostrarlo igual: esconderlo dejaria un mes seleccionado invisible.
  it('el mes fijado aparece aunque se haya quedado fuera del par', () => {
    const m = mesesSeleccionables('2026-11-20', '2026-09');
    expect(m).toEqual(['2026-11', '2026-10', '2026-09']);
  });

  it('no duplica cuando el fijado ya esta en el par', () => {
    expect(mesesSeleccionables('2026-11-20', '2026-11')).toEqual(['2026-11', '2026-10']);
  });

  it('siempre viene del mas reciente al mas viejo', () => {
    const m = mesesSeleccionables('2026-11-20', '2026-09');
    expect([...m].sort().reverse()).toEqual(m);
  });
});

describe('mesSeleccionable', () => {
  // El fallo que hubo en QA: noviembre salia en gris y no se podia pulsar.
  // No se podia elegir porque no tenia datos, y no tenia datos porque nadie
  // podia elegirlo. El mes en curso quedaba inalcanzable desde la pantalla.
  it('un mes SIN datos se puede elegir: elegirlo es lo que le trae los datos', () => {
    expect(mesSeleccionable({ activo: false, puedeElegir: true })).toBe(true);
  });

  it('el mes que ya es el activo no se vuelve a pulsar', () => {
    expect(mesSeleccionable({ activo: true, puedeElegir: true })).toBe(false);
  });

  it('sin a quien avisar del cambio, no se puede elegir', () => {
    expect(mesSeleccionable({ activo: false, puedeElegir: false })).toBe(false);
  });
});
