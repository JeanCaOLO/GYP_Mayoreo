import { describe, expect, it } from 'vitest';
import {
  horaEnClaro,
  proximaPublicacionEnClaro,
  corteEnClaro,
  duracionEnClaro,
  origenCorrida,
  planificadorCallado,
} from './PanelProgramacion';
import { PROGRAMACION_DEFAULT, mesesCandidatos, type Programacion, type Tick } from '../data';

/**
 * Pruebas de las ayudas puras del panel de actualización programada (CP-56).
 * No tocan Supabase ni el motor: solo la lectura en claro de hora, próxima
 * publicación, corte y duración, siempre en hora de Caracas.
 */

const prog = (over: Partial<Programacion> = {}): Programacion => ({
  ...PROGRAMACION_DEFAULT,
  ...over,
});

describe('horaEnClaro', () => {
  it('convierte 24h de Caracas a 12h con a. m. / p. m.', () => {
    expect(horaEnClaro('07:30')).toBe('7:30 a. m.');
    expect(horaEnClaro('00:05')).toBe('12:05 a. m.');
    expect(horaEnClaro('12:00')).toBe('12:00 p. m.');
    expect(horaEnClaro('23:45')).toBe('11:45 p. m.');
  });
});

describe('proximaPublicacionEnClaro', () => {
  it('pausada no calcula próxima', () => {
    expect(proximaPublicacionEnClaro(prog({ activa: false }))).toBe('pausada');
  });

  it('diaria: hoy si aún no pasó la hora', () => {
    // miércoles 22 oct 2025, 06:00; hora 07:30 aún no pasó → hoy
    const ahora = new Date(2025, 9, 22, 6, 0);
    const r = proximaPublicacionEnClaro(prog({ activa: true, frecuencia: 'diaria' }), ahora);
    expect(r).toBe('hoy a las 7:30 a. m. (Caracas)');
  });

  it('diaria: mañana si ya pasó la hora de hoy', () => {
    const ahora = new Date(2025, 9, 22, 8, 0); // ya pasó 07:30
    const r = proximaPublicacionEnClaro(prog({ activa: true, frecuencia: 'diaria' }), ahora);
    expect(r).toBe('mañana 23 oct, 7:30 a. m. (Caracas)');
  });

  it('solo días hábiles: viernes tarde salta al lunes', () => {
    // viernes 24 oct 2025, 20:00 → el sábado/domingo no aplican → lunes 27
    const ahora = new Date(2025, 9, 24, 20, 0);
    const r = proximaPublicacionEnClaro(prog({ activa: true, frecuencia: 'habiles' }), ahora);
    expect(r).toBe('el lunes 27 oct, 7:30 a. m. (Caracas)');
  });

  it('semanal: salta al día de la semana elegido', () => {
    // miércoles 22 oct 2025, 08:00; día elegido = lunes (1) → lunes 27
    const ahora = new Date(2025, 9, 22, 8, 0);
    const r = proximaPublicacionEnClaro(
      prog({ activa: true, frecuencia: 'semanal', diaSemana: 1 }),
      ahora,
    );
    expect(r).toBe('el lunes 27 oct, 7:30 a. m. (Caracas)');
  });
});

describe('corteEnClaro', () => {
  it('formatea YYYY-MM-DD como «D mmm»', () => {
    expect(corteEnClaro('2026-10-21')).toBe('21 oct');
    expect(corteEnClaro(null)).toBe('—');
  });
});

describe('duracionEnClaro', () => {
  it('muestra segundos y minutos legibles', () => {
    expect(duracionEnClaro('2026-10-23T11:30:00Z', '2026-10-23T11:30:48Z')).toBe('48 s');
    expect(duracionEnClaro('2026-10-23T11:30:00Z', '2026-10-23T11:31:12Z')).toBe('1 min 12 s');
    expect(duracionEnClaro(null, null)).toBe('—');
  });
});

describe('mesesCandidatos', () => {
  it('ofrece el mes en curso y el anterior (Caracas), más recientes primero', () => {
    // 28 oct 2026, 10:00 Caracas
    expect(mesesCandidatos('2026-10', new Date('2026-10-28T14:00:00Z'))).toEqual(['2026-10', '2026-09']);
  });
  it('el 1 de noviembre conserva octubre guardado y ofrece noviembre', () => {
    // 1 nov 2026, 06:50 Caracas = 10:50 UTC
    expect(mesesCandidatos('2026-10', new Date('2026-11-01T10:50:00Z'))).toEqual(['2026-11', '2026-10']);
  });
  it('usa la fecha de Caracas, no la de UTC', () => {
    // 1 nov 02:00 UTC = 31 oct 22:00 Caracas
    expect(mesesCandidatos('2026-10', new Date('2026-11-01T02:00:00Z'))).toEqual(['2026-10', '2026-09']);
  });
  it('incluye el guardado aunque sea más viejo', () => {
    expect(mesesCandidatos('2026-08', new Date('2026-10-28T14:00:00Z'))).toEqual([
      '2026-10',
      '2026-09',
      '2026-08',
    ]);
  });
  it('cruza el año', () => {
    expect(mesesCandidatos('2026-12', new Date('2027-01-05T14:00:00Z'))).toEqual(['2027-01', '2026-12']);
  });
});

describe('origenCorrida', () => {
  it('el botón es manual aunque la fila vieja diga programada', () => {
    expect(origenCorrida({ origen: 'programada', lanzadaPor: 'manual' })).toBe('manual');
    expect(origenCorrida({ origen: 'manual', lanzadaPor: 'manual' })).toBe('manual');
    expect(origenCorrida({ origen: 'programada', lanzadaPor: 'pg_cron' })).toBe('programada');
  });
});

describe('planificadorCallado', () => {
  const tick = (ts: string): Tick => ({
    ts, origen: 'programada', estado: 'omitida', periodo: null, motivo: null, filas: null, duracionMs: null,
  });
  const ahora = new Date('2026-10-28T14:00:00Z');
  it('sin ticks, está callado', () => expect(planificadorCallado(null, ahora)).toBe(true));
  it('tick de hace 5 minutos: activo', () =>
    expect(planificadorCallado(tick('2026-10-28T13:55:00Z'), ahora)).toBe(false));
  it('tick de hace 20 minutos: callado', () =>
    expect(planificadorCallado(tick('2026-10-28T13:40:00Z'), ahora)).toBe(true));
});
