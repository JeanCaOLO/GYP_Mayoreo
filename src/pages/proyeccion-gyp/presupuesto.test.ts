import { describe, it, expect } from 'vitest';
import {
  agregarPorCuenta,
  claveCuenta,
  conceptosPorCuenta,
  normalizarEmpresa,
  repartirEnConceptos,
  type LineaPresupuesto,
} from './presupuesto';

describe('normalizarEmpresa', () => {
  it('traduce MUNDIAL DE PARTES a Mundial', () => {
    // El caso que importa: sin esto el presupuesto de Mundial se agrega bajo una
    // empresa que el motor no conoce y desaparece sin error.
    expect(normalizarEmpresa('MUNDIAL DE PARTES')).toBe('Mundial');
  });

  it('pasa las otras cinco a su forma del modulo', () => {
    expect(normalizarEmpresa('BEVAL')).toBe('Beval');
    expect(normalizarEmpresa('FEBECA')).toBe('Febeca');
    expect(normalizarEmpresa('SILLACA')).toBe('Sillaca');
    expect(normalizarEmpresa('COFERSA')).toBe('Cofersa');
    expect(normalizarEmpresa('PRISMA')).toBe('Prisma');
  });

  it('no se come una empresa desconocida: la devuelve tal cual', () => {
    expect(normalizarEmpresa('NUEVA C.A.')).toBe('NUEVA C.A.');
  });

  it('tolera nulos y espacios', () => {
    expect(normalizarEmpresa(null)).toBe('');
    expect(normalizarEmpresa('  beval  ')).toBe('Beval');
  });
});

describe('agregarPorCuenta', () => {
  const lineas: LineaPresupuesto[] = [
    { empresa: 'Beval', cuenta: '6.1.2.01.1.036', montoUsd: 100 },
    { empresa: 'Beval', cuenta: '6.1.2.01.1.036', montoUsd: 25 },
    { empresa: 'Beval', cuenta: '6.1.2.01.1.036', montoUsd: -5 },
    { empresa: 'Febeca', cuenta: '6.1.2.01.1.036', montoUsd: 40 },
  ];

  it('SUMA las lineas repetidas en vez de quedarse con una', () => {
    // En octubre 2026 hay 181 lineas para 95 pares (empresa, cuenta): 76 pares
    // repetidos. Tomar la primera perderia el resto en silencio.
    const m = agregarPorCuenta(lineas);
    expect(m.get(claveCuenta('Beval', '6.1.2.01.1.036'))).toBe(120);
  });

  it('no mezcla la misma cuenta de dos empresas', () => {
    const m = agregarPorCuenta(lineas);
    expect(m.get(claveCuenta('Febeca', '6.1.2.01.1.036'))).toBe(40);
    expect(m.size).toBe(2);
  });

  it('un monto no numerico cuenta como cero, no como NaN', () => {
    const m = agregarPorCuenta([
      { empresa: 'Beval', cuenta: 'X', montoUsd: Number.NaN },
      { empresa: 'Beval', cuenta: 'X', montoUsd: 10 },
    ]);
    expect(m.get(claveCuenta('Beval', 'X'))).toBe(10);
  });
});

describe('conceptosPorCuenta', () => {
  it('reune los conceptos de una cuenta con su peso', () => {
    const m = conceptosPorCuenta([
      { empresa: 'Febeca', cuenta: '7.1.1.03.1.001', concepto: 'Personal Fijo', acumulado: -300 },
      { empresa: 'Febeca', cuenta: '7.1.1.03.1.001', concepto: 'Logistico', acumulado: 100 },
      { empresa: 'Febeca', cuenta: '7.1.1.03.1.001', concepto: 'Logistico', acumulado: 100 },
    ]);
    const suyos = m.get(claveCuenta('Febeca', '7.1.1.03.1.001'));
    expect(suyos?.get('Personal Fijo')).toBe(300);
    expect(suyos?.get('Logistico')).toBe(200);
  });

  it('el peso va en valor absoluto', () => {
    // Los ingresos vienen negativos; sin abs, una cuenta con ingresos y gastos
    // se repartiria con pesos que se cancelan entre si.
    const m = conceptosPorCuenta([
      { empresa: 'Beval', cuenta: 'A', concepto: 'Ventas', acumulado: -500 },
      { empresa: 'Beval', cuenta: 'A', concepto: 'Ventas', acumulado: 500 },
    ]);
    expect(m.get(claveCuenta('Beval', 'A'))?.get('Ventas')).toBe(1000);
  });

  it('descarta las filas sin empresa, cuenta o concepto', () => {
    const m = conceptosPorCuenta([
      { empresa: null, cuenta: 'A', concepto: 'Ventas' },
      { empresa: 'Beval', cuenta: null, concepto: 'Ventas' },
      { empresa: 'Beval', cuenta: 'A', concepto: null },
    ]);
    expect(m.size).toBe(0);
  });
});

describe('repartirEnConceptos', () => {
  it('con un solo concepto el presupuesto va entero ahi', () => {
    // El caso de las 95 cuentas presupuestadas de octubre 2026.
    const porCuenta = new Map([[claveCuenta('Beval', 'A'), 1000]]);
    const conceptos = conceptosPorCuenta([
      { empresa: 'Beval', cuenta: 'A', concepto: 'Personal Fijo', acumulado: 0 },
    ]);
    const { porConcepto, sinConcepto } = repartirEnConceptos(porCuenta, conceptos);
    expect(porConcepto).toEqual([{ empresa: 'Beval', concepto: 'Personal Fijo', presupuesto: 1000 }]);
    expect(sinConcepto).toEqual([]);
  });

  it('con varios conceptos reparte en proporcion al acumulado', () => {
    const porCuenta = new Map([[claveCuenta('Febeca', 'A'), 1000]]);
    const conceptos = conceptosPorCuenta([
      { empresa: 'Febeca', cuenta: 'A', concepto: 'Personal Fijo', acumulado: 750 },
      { empresa: 'Febeca', cuenta: 'A', concepto: 'Logistico', acumulado: 250 },
    ]);
    const { porConcepto } = repartirEnConceptos(porCuenta, conceptos);
    const m = new Map(porConcepto.map((p) => [p.concepto, p.presupuesto]));
    expect(m.get('Personal Fijo')).toBe(750);
    expect(m.get('Logistico')).toBe(250);
  });

  it('sin movimiento en ninguno, reparte en partes iguales', () => {
    const porCuenta = new Map([[claveCuenta('Febeca', 'A'), 900]]);
    const conceptos = conceptosPorCuenta([
      { empresa: 'Febeca', cuenta: 'A', concepto: 'Personal Fijo', acumulado: 0 },
      { empresa: 'Febeca', cuenta: 'A', concepto: 'Logistico', acumulado: 0 },
      { empresa: 'Febeca', cuenta: 'A', concepto: 'Gastos Varios', acumulado: 0 },
    ]);
    const { porConcepto } = repartirEnConceptos(porCuenta, conceptos);
    expect(porConcepto.map((p) => p.presupuesto)).toEqual([300, 300, 300]);
  });

  it('el reparto NO crea ni pierde dinero, aunque no sea divisible', () => {
    // El ultimo concepto se lleva el residuo; sin eso, un tercio de 100 se
    // reparte en 99,99 y el descuadre aparece como una cifra que no cuadra.
    const porCuenta = new Map([[claveCuenta('Febeca', 'A'), 100]]);
    const conceptos = conceptosPorCuenta([
      { empresa: 'Febeca', cuenta: 'A', concepto: 'C1', acumulado: 1 },
      { empresa: 'Febeca', cuenta: 'A', concepto: 'C2', acumulado: 1 },
      { empresa: 'Febeca', cuenta: 'A', concepto: 'C3', acumulado: 1 },
    ]);
    const { porConcepto } = repartirEnConceptos(porCuenta, conceptos);
    const suma = porConcepto.reduce((s, p) => s + p.presupuesto, 0);
    expect(Math.round(suma * 100) / 100).toBe(100);
  });

  it('acumula varias cuentas en el mismo concepto', () => {
    const porCuenta = new Map([
      [claveCuenta('Beval', 'A'), 100],
      [claveCuenta('Beval', 'B'), 250],
    ]);
    const conceptos = conceptosPorCuenta([
      { empresa: 'Beval', cuenta: 'A', concepto: 'Fletes' },
      { empresa: 'Beval', cuenta: 'B', concepto: 'Fletes' },
    ]);
    const { porConcepto } = repartirEnConceptos(porCuenta, conceptos);
    expect(porConcepto).toEqual([{ empresa: 'Beval', concepto: 'Fletes', presupuesto: 350 }]);
  });

  it('conserva el signo: los ingresos presupuestados siguen negativos', () => {
    // El fallo viejo dejaba entrar solo gasto (+278.501) cuando el total del mes
    // es −591.661: el presupuesto que llegaba iba al reves del real.
    const porCuenta = new Map([[claveCuenta('Beval', 'A'), -1448518]]);
    const conceptos = conceptosPorCuenta([
      { empresa: 'Beval', cuenta: 'A', concepto: 'Ventas' },
    ]);
    const { porConcepto } = repartirEnConceptos(porCuenta, conceptos);
    expect(porConcepto[0].presupuesto).toBe(-1448518);
  });

  it('una cuenta sin concepto NO se descarta en silencio', () => {
    // Un presupuesto que desaparece sin rastro es justo el fallo que este
    // modulo corrige: tiene que poder avisarse.
    const porCuenta = new Map([[claveCuenta('Beval', 'DESCONOCIDA'), 500]]);
    const { porConcepto, sinConcepto } = repartirEnConceptos(porCuenta, new Map());
    expect(porConcepto).toEqual([]);
    expect(sinConcepto).toEqual([{ empresa: 'Beval', cuenta: 'DESCONOCIDA', monto: 500 }]);
  });
});
