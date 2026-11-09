import { describe, expect, it } from 'vitest';
import {
  horaEnClaro,
  proximaPublicacionEnClaro,
  corteEnClaro,
  duracionEnClaro,
} from './PanelProgramacion';
import { PROGRAMACION_DEFAULT, type Programacion } from '../data';

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
