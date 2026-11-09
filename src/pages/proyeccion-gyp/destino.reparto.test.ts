/**
 * C8 de la auditoría: el reparto entre cuentas no se aplicaba.
 *
 * `repartir()` (§F, CP-20) estaba escrita y no la llamaba nadie: el panel hacía
 * `total / nCuentas`, así que elegir «por historia» o «por presupuesto» no
 * cambiaba nada y el reparto salía siempre en partes iguales, en silencio.
 */
import { describe, it, expect } from 'vitest';
import { repartir, type CuentaDestino } from './destino';

const cuentas: CuentaDestino[] = [
  { combinada: 'A', centroCosto: 'cc1', cuentaContable: '1', serie: [100, 100, 100], presupuesto: 900 },
  { combinada: 'B', centroCosto: 'cc2', cuentaContable: '2', serie: [300, 300, 300], presupuesto: 100 },
];

describe('C8 · repartir reparte de verdad', () => {
  it('«iguales» parte por el número de cuentas', () => {
    const { destinos } = repartir(1000, cuentas, { criterio: 'iguales' });
    expect(destinos.map((d) => d.montoUsd)).toEqual([500, 500]);
  });

  it('«historia» pondera 1:3, no en partes iguales', () => {
    const { destinos, aviso } = repartir(1000, cuentas, { criterio: 'historia', n: 3 });
    expect(aviso).toBeNull();
    expect(destinos[0].montoUsd).toBeCloseTo(250, 2);
    expect(destinos[1].montoUsd).toBeCloseTo(750, 2);
    // El defecto: antes esto daba 500 y 500.
    expect(destinos[0].montoUsd).not.toBeCloseTo(500, 2);
  });

  it('«presupuesto» pondera 9:1', () => {
    const { destinos } = repartir(1000, cuentas, { criterio: 'presupuesto' });
    expect(destinos[0].montoUsd).toBeCloseTo(900, 2);
    expect(destinos[1].montoUsd).toBeCloseTo(100, 2);
  });

  it('PROPIEDAD: las partes suman EXACTAMENTE el total, sin perder céntimos', () => {
    for (const criterio of ['iguales', 'historia', 'presupuesto'] as const) {
      for (const total of [1000, 333.33, -777.77, 0.01]) {
        const { destinos } = repartir(total, cuentas, { criterio, n: 3 });
        const suma = destinos.reduce((a, d) => a + d.montoUsd, 0);
        expect(suma, `${criterio} con ${total}`).toBeCloseTo(Math.round(total * 100) / 100, 2);
      }
    }
  });

  it('sin historia ni presupuesto cae a partes iguales y AVISA', () => {
    const vacias: CuentaDestino[] = [
      { combinada: 'A', centroCosto: 'c', cuentaContable: '1', serie: [], presupuesto: null },
      { combinada: 'B', centroCosto: 'c', cuentaContable: '2', serie: [], presupuesto: null },
    ];
    const { destinos, aviso } = repartir(1000, vacias, { criterio: 'historia' });
    expect(destinos.map((d) => d.montoUsd)).toEqual([500, 500]);
    expect(aviso).toContain('partes iguales');
  });
});
