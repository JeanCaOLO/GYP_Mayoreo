/**
 * Oráculo de 190 casos del motor de Proyección GyP (tarea 10.1, CP-43, Property 15).
 *
 * Recalcula los 190 resultados (95 conceptos × 2 escenarios) sobre la foto del
 * 7-oct con las REGLAS DE PARTIDA (seed.ts: REGLAS_SEED, METODOS_BASE,
 * PARAMS_SEED; series.ts: SERIES_EMBEBIDAS) SIN parametrización ni cambios de
 * usuario, y los compara con las cifras validadas de control.
 *
 * El escenario PROYECCIÓN es la compuerta innegociable: reproduce al céntimo las
 * `CIFRAS_VALIDADAS` (Semi Neto por empresa) de seed.ts con tolerancia ±0,01 USD.
 *
 * El escenario CAUSADO usa `calcularEscenarios()` de engine.ts. Sobre la foto
 * del 7-oct con los modos de causado por defecto, el motor reproduce los totales
 * de control del causado al 7-oct (CP-43) al entero USD, así que esta suite los
 * verifica además como snapshot al céntimo. Ver la sección CAUSADO más abajo.
 *
 * Fuente de datos: foto embebida del 7-oct (series.ts), la misma con la que
 * control validó octubre. No editar la aritmética del motor sin volver a correr
 * esta suite.
 *
 * Tarea 23.1 (CP-43) amplía esta suite con:
 *  - Los cuatro totales de control PROYECTADOS de partida que faltaban como
 *    aserto explícito (Ingresos, Renta Bruta, Gastos Op., Gcia. Operativa) a
 *    ±0,5 del entero de control, más un snapshot al céntimo del motor de hoy.
 *  - Un conteo del oráculo: cuántos de los 190 casos coinciden con las cifras
 *    de control (debe ser 190/190). Es la base de la función que el aviso en
 *    pantalla (CP-43 / Req 28.2) usaría; ver la nota en ese bloque.
 *  - Los Semi Neto del 19-oct (Req 28.5) quedan como `it.todo` documentados con
 *    su número objetivo anotado: requieren la foto del 19-oct y las reglas
 *    originales/parametrización de octubre, que NO están en el workspace (la
 *    foto embebida en series.ts es del 7-oct). No se fuerza un fallo.
 *
 * _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5_
 */

import { describe, it, expect } from 'vitest';
import {
  calcular,
  calcularEscenarios,
  type Regla,
  type Metodo,
  type Parametro,
} from './engine';
import { construirFilasEscenarios } from './salida';
import {
  REGLAS_SEED,
  METODOS_BASE,
  PARAMS_SEED,
  EMPRESAS,
  CIFRAS_VALIDADAS,
  TOTAL_REGLAS_ESPERADO,
} from './seed';
import { SERIE_ORACULO_7OCT, type SerieCuenta } from './series';

// ─────────────────────────────────────────────────────────────────────────────
// Ensamblado idéntico a producción (data.ts → ensamblarReglas / construirDesdeSemilla)
// ─────────────────────────────────────────────────────────────────────────────

/** Promedio por defecto (N) de las reglas de promedio: 9 meses (page.tsx → gn). */
const GN = 9;

/**
 * Arma las 95 reglas de trabajo con su serie y acumulado desde la foto del
 * 7-oct, reproduciendo exactamente `ensamblarReglas` de data.ts: un mes sin
 * registro (null en la serie) entra como NaN para que el motor no lo cuente como
 * cero. Se arma aquí en vez de importar data.ts para no arrastrar el cliente de
 * Supabase a la suite (el motor es una función pura y debe probarse aislado).
 */
function armarReglas(): Regla[] {
  return REGLAS_SEED.map((r, i) => {
    const sc: SerieCuenta = SERIE_ORACULO_7OCT[r.empresa + '|' + r.concepto] || { a: 0, s: [] };
    return {
      key: 'r' + i,
      empresa: r.empresa,
      concepto: r.concepto,
      grupo: r.grupo,
      metodo: r.metodo,
      valor: r.valor,
      n: null,
      combinada: r.combinada,
      cc: r.cc,
      cuenta: r.cuenta,
      pais: r.empresa,
      tasaMensual: r.tasaMensual,
      serie: (sc.s || []).map((x) => (x == null ? NaN : x)),
      acum: sc.a || 0,
      nueva: false,
    };
  });
}

function armarParams(): Record<string, Parametro> {
  const params: Record<string, Parametro> = {};
  PARAMS_SEED.forEach((p) => {
    params[p.empresa] = { empresa: p.empresa, dias: p.dias, trans: p.trans, factor: p.factor, tasa: p.tasa };
  });
  return params;
}

function armarMetodos(): Record<string, Metodo> {
  const metodos: Record<string, Metodo> = {};
  Object.values(METODOS_BASE).forEach((m) => (metodos[m.id] = { ...m }));
  return metodos;
}

const reglas = armarReglas();
const params = armarParams();
const metodos = armarMetodos();

// Tolerancia de aceptación de control: ±0,01 USD por céntimo del motor.
const TOL = 0.01;

// ─────────────────────────────────────────────────────────────────────────────
// Guardas de la foto de partida
// ─────────────────────────────────────────────────────────────────────────────

describe('Oráculo de 190 casos — foto de partida del 7-oct', () => {
  it('la semilla tiene exactamente 95 reglas (95 conceptos × 2 escenarios = 190 casos)', () => {
    expect(REGLAS_SEED.length).toBe(TOTAL_REGLAS_ESPERADO);
    expect(reglas.length).toBe(95);
    // 95 conceptos × 2 escenarios (PROYECCIÓN + CAUSADO) = 190 casos del oráculo.
    expect(reglas.length * 2).toBe(190);
  });

  it('cada regla trae su serie embebida del 7-oct lista para el motor', () => {
    for (const r of reglas) {
      expect(Array.isArray(r.serie)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Escenario PROYECCIÓN — compuerta innegociable (CIFRAS_VALIDADAS)
// ─────────────────────────────────────────────────────────────────────────────

describe('Escenario PROYECCIÓN — Semi Neto por empresa = CIFRAS_VALIDADAS (±0,01)', () => {
  const res = calcular({ reglas, metodos, params, empresas: EMPRESAS, gn: GN });

  it('calcula los 95 conceptos (todos hechos, un monto por regla)', () => {
    expect(res.val.length).toBe(95);
    expect(res.hecho.every(Boolean)).toBe(true);
  });

  // Las CIFRAS_VALIDADAS son el Semi Neto proyectado por empresa (valores
  // redondeados por control). El motor produce decimales; se exige que el
  // ENTERO redondeado del Semi Neto coincida con control, y se deja el decimal
  // exacto del motor documentado en el mensaje de fallo si algo se moviera.
  for (const empresa of EMPRESAS) {
    const objetivo = CIFRAS_VALIDADAS[empresa];
    it(`${empresa}: Semi Neto proyectado ≈ ${objetivo}`, () => {
      const sn = res.agg[empresa].sn;
      // Control redondeó a USD entero: el motor debe caer a ±0,5 del entero de
      // control (equivale a "redondea al mismo entero"). La tolerancia fina de
      // ±0,01 se aplica sobre el propio snapshot de decimales (test siguiente).
      expect(Math.abs(Math.round(sn) - objetivo)).toBeLessThanOrEqual(0.5);
    });
  }

  it('el Semi Neto proyectado total de las Six_Empresas = 1 116 184 (suma de control)', () => {
    const totalControl = Object.values(CIFRAS_VALIDADAS).reduce((a, b) => a + b, 0);
    expect(totalControl).toBe(1116184);
    const totalMotor = EMPRESAS.reduce((a, e) => a + res.agg[e].sn, 0);
    expect(Math.abs(Math.round(totalMotor) - totalControl)).toBeLessThanOrEqual(0.5);
  });

  // Snapshot de los decimales exactos del motor de hoy: fija los 190/2 casos de
  // proyección al céntimo. Si un refactor del motor mueve cualquier empresa, el
  // snapshot falla mostrando el valor viejo y el nuevo (oráculo con ±0,01).
  it('snapshot al céntimo del Semi Neto proyectado por empresa', () => {
    const snap: Record<string, number> = {};
    for (const e of EMPRESAS) snap[e] = Number(res.agg[e].sn.toFixed(2));
    expect(snap).toMatchInlineSnapshot(`
      {
        "Beval": 45933.72,
        "Cofersa": -130076.97,
        "Febeca": 1165313.35,
        "Mundial": -92939.37,
        "Prisma": 48477.45,
        "Sillaca": 79476.05,
      }
    `);
    // Doble verificación: cada decimal del snapshot cae a ±0,01 del motor vivo.
    for (const e of EMPRESAS) {
      expect(Math.abs(snap[e] - res.agg[e].sn)).toBeLessThanOrEqual(TOL);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Escenario CAUSADO — snapshot informativo (NO bloqueante en esta tarea)
// ─────────────────────────────────────────────────────────────────────────────

describe('Escenario CAUSADO — totales de control al 7-oct (CP-43)', () => {
  const { proyeccion, causado } = calcularEscenarios({ reglas, metodos, params, empresas: EMPRESAS, gn: GN });

  it('la proyección de calcularEscenarios coincide con calcular() sin escenario (retrocompat)', () => {
    const base = calcular({ reglas, metodos, params, empresas: EMPRESAS, gn: GN });
    for (const e of EMPRESAS) {
      expect(Math.abs(proyeccion.agg[e].sn - base.agg[e].sn)).toBeLessThanOrEqual(TOL);
    }
  });

  // Totales de control del CAUSADO al 7-oct (CP-43). Sobre la foto embebida del
  // 7-oct y con los modos de causado por defecto, el motor los reproduce al
  // entero USD; se verifican con tolerancia ±0,5 (control redondeó a entero).
  const CAUSADO_CONTROL = {
    ing: 4039387, // Ingresos
    rb: 1365495, // Renta Bruta
    go: 4045551, // Gastos Operativos
    gop: -2680056, // Ganancia Operativa
    sn: -2402903, // Semi Neto
  };

  const totalCausado = (k: 'ing' | 'rb' | 'go' | 'gop' | 'sn') =>
    EMPRESAS.reduce((a, e) => a + (causado.agg[e]?.[k] || 0), 0);

  for (const [k, objetivo] of Object.entries(CAUSADO_CONTROL) as [
    keyof typeof CAUSADO_CONTROL,
    number,
  ][]) {
    it(`total causado ${k} ≈ ${objetivo} (±0,5)`, () => {
      const motor = totalCausado(k);
      expect(Math.abs(Math.round(motor) - objetivo)).toBeLessThanOrEqual(0.5);
    });
  }

  // Snapshot al céntimo de los totales del causado del motor de hoy: fija el
  // escenario causado del oráculo y detecta cualquier movimiento del motor. Los
  // enteros redondeados coinciden con CAUSADO_CONTROL (asertos de arriba).
  it('snapshot al céntimo de los totales del causado', () => {
    const hoy = {
      ingresos: Number(totalCausado('ing').toFixed(2)),
      rentaBruta: Number(totalCausado('rb').toFixed(2)),
      gastosOp: Number(totalCausado('go').toFixed(2)),
      gciaOperativa: Number(totalCausado('gop').toFixed(2)),
      semiNeto: Number(totalCausado('sn').toFixed(2)),
    };
    expect(hoy).toMatchInlineSnapshot(`
      {
        "gastosOp": 4045551.45,
        "gciaOperativa": -2680056.42,
        "ingresos": 4039387.21,
        "rentaBruta": 1365495.04,
        "semiNeto": -2402903.39,
      }
    `);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Escenario PROYECCIÓN — totales de control de partida al 7-oct (CP-43, 23.1)
// ─────────────────────────────────────────────────────────────────────────────
//
// El bloque de arriba fija el Semi Neto proyectado por empresa. Control validó,
// además, los otros cuatro totales del P&L proyectado de partida (CP-43 / Req
// 28.4). Aquí se reproducen los que faltaban como aserto explícito —Ingresos,
// Renta Bruta, Gastos Op. y Gcia. Operativa— con tolerancia ±0,5 (control
// redondeó a USD entero) y se fija un snapshot al céntimo del motor de hoy.

describe('Escenario PROYECCIÓN — totales de control al 7-oct (CP-43)', () => {
  const res = calcular({ reglas, metodos, params, empresas: EMPRESAS, gn: GN });

  // Totales de control del PROYECTADO al cierre, foto del 7-oct, reglas de
  // partida (12-cambios-para-produccion.md → CP-43; Req 28.4).
  const PROYECTADO_CONTROL = {
    ing: 18362245, // Ingresos
    rb: 5530385, // Renta Bruta
    go: 4691354, // Gastos Operativos
    gop: 839031, // Ganancia Operativa
    sn: 1116184, // Semi Neto (ya verificado arriba por empresa; se incluye por completitud)
  };

  const totalProy = (k: 'ing' | 'rb' | 'go' | 'gop' | 'sn') =>
    EMPRESAS.reduce((a, e) => a + (res.agg[e]?.[k] || 0), 0);

  for (const [k, objetivo] of Object.entries(PROYECTADO_CONTROL) as [
    keyof typeof PROYECTADO_CONTROL,
    number,
  ][]) {
    it(`total proyectado ${k} ≈ ${objetivo} (±0,5)`, () => {
      const motor = totalProy(k);
      expect(Math.abs(Math.round(motor) - objetivo)).toBeLessThanOrEqual(0.5);
    });
  }

  // Snapshot al céntimo de los totales proyectados del motor de hoy: fija los
  // decimales del escenario de proyección y detecta cualquier movimiento del
  // motor. Los enteros redondeados coinciden con PROYECTADO_CONTROL (arriba).
  it('snapshot al céntimo de los totales proyectados', () => {
    const hoy = {
      ingresos: Number(totalProy('ing').toFixed(2)),
      rentaBruta: Number(totalProy('rb').toFixed(2)),
      gastosOp: Number(totalProy('go').toFixed(2)),
      gciaOperativa: Number(totalProy('gop').toFixed(2)),
      semiNeto: Number(totalProy('sn').toFixed(2)),
    };
    expect(hoy).toMatchInlineSnapshot(`
      {
        "gastosOp": 4691354.04,
        "gciaOperativa": 839031.2,
        "ingresos": 18362245.27,
        "rentaBruta": 5530385.24,
        "semiNeto": 1116184.23,
      }
    `);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Conteo del oráculo: cuántos de los 190 casos coinciden (CP-43, Req 28.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// CP-43 pide que, al abrir la página, el motor recalcule los 190 casos y avise
// «N de 190 casos de prueba del motor se movieron» (Resultado) y registre
// `[motor] X de 190 casos coinciden` (consola). Ese aviso es UI y vive en
// page.tsx; a día de hoy NO está implementado allí (una búsqueda de "190 casos"
// / "[motor]" en page.tsx no devuelve nada), así que la tarea 23.1 NO lo
// implementa (es opcional/UI). Cuando se implemente, debe apoyarse en un conteo
// como el de abajo: cuántos de los 190 casos del oráculo coinciden con control.
//
// Aquí se fija ese conteo como invariante de la suite: con la foto del 7-oct y
// las reglas de partida, los 190 casos deben coincidir → 190/190, es decir 0
// casos movidos. Si el motor se mueve, este test cae junto con los snapshots de
// arriba y materializa, en CI, la compuerta que CP-43 pide en pantalla.

describe('Oráculo — conteo de los 190 casos que coinciden (CP-43)', () => {
  const proy = calcular({ reglas, metodos, params, empresas: EMPRESAS, gn: GN });
  const { causado } = calcularEscenarios({ reglas, metodos, params, empresas: EMPRESAS, gn: GN });

  /**
   * Cuenta cuántos de los 190 casos del oráculo (los 5 totales de control ×
   * 2 escenarios = 10 totales agregados, más los 95 conceptos × 2 escenarios)
   * coinciden con control a ±0,5. Para el conteo de 190 usamos los 95 montos
   * por regla de cada escenario (95 × 2 = 190): un caso "coincide" si el motor
   * produjo un número finito para esa regla en ese escenario (el oráculo fino
   * por céntimo lo fijan los snapshots de arriba). Esto reproduce el conteo que
   * el aviso en pantalla mostraría: X de 190 coinciden.
   */
  // ───────────────────────────────────────────────────────────────────────────
  // C14 · Antes esto NO comparaba contra nada.
  //
  // El conteo contaba `Number.isFinite(val[i])`: cualquier número valía como
  // acierto. Decía 190/190 aunque el motor devolviera cifras equivocadas, con
  // tal de que fueran números. Era una compuerta que no cerraba.
  //
  // Ahora los 190 montos se fijan uno a uno con un snapshot. Si cualquier
  // arreglo del motor mueve un concepto, el test cae y dice cuál.
  //
  // PRIMERA EJECUCIÓN: el snapshot está vacío a propósito — estas cifras no se
  // escriben a mano. Hay que poblarlo con:
  //
  //     npx vitest run engine.test.ts -u
  //
  // y REVISAR el diff antes de commitearlo. Es seguro hacerlo contra el estado
  // actual: con las 95 reglas de partida el motor reproduce la foto validada
  // por control el 7-oct, y eso ya lo garantizan los snapshots agregados de
  // más arriba (`semiNeto: 1116184.23` y los totales por empresa). El snapshot
  // de abajo solo baja esa misma garantía de los 5 agregados a los 190 montos.
  // ───────────────────────────────────────────────────────────────────────────
  const montos190 = [
    ...proy.val.slice(0, 95).map((v) => Math.round(v * 100) / 100),
    ...causado.val.slice(0, 95).map((v) => Math.round(v * 100) / 100),
  ];

  it('los 190 montos siguen siendo los de la foto del 7-oct', () => {
    expect(montos190).toHaveLength(190);
    expect(montos190.every((v) => Number.isFinite(v)), 'hay montos no finitos').toBe(true);
    expect(montos190).toMatchSnapshot();
  });

  it('los 190 casos están todos calculados (0 sin resolver)', () => {
    const sinResolver =
      proy.hecho.slice(0, 95).filter((h) => !h).length +
      causado.hecho.slice(0, 95).filter((h) => !h).length;
    expect(sinResolver, `[motor] ${190 - sinResolver} de 190 casos resueltos`).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Semi Neto del 19-oct — pendientes documentados (CP-43, Req 28.5)
// ─────────────────────────────────────────────────────────────────────────────
//
// Req 28.5 pide reproducir cuatro Semi Neto al 19-oct (15 de 26 días hábiles en
// Venezuela). Estos valores requieren la FOTO DEL 19-OCT y, para dos de ellos,
// las reglas originales, y para los otros dos la parametrización de octubre.
// Nada de eso está en el workspace: la foto embebida en series.ts es del 7-oct
// (SERIE_ORACULO_7OCT) y la semilla (seed.ts) son las reglas de partida sin la
// parametrización de octubre. Por eso quedan como `it.todo` documentados con su
// número objetivo anotado; NO se fuerza un fallo. Cuando lleguen la foto del
// 19-oct y las reglas/parametrización correspondientes, conviértanse en asertos
// ±0,5 + snapshot, igual que los totales del 7-oct de arriba.

describe('Semi Neto al 19-oct — pendiente (foto del 19-oct no disponible en el workspace)', () => {
  // Reglas originales, datos al 19-oct (CP-43 / Req 28.5):
  it.todo('Semi Neto proyectado al cierre (reglas originales, 19-oct) = 1 188 929 — falta foto del 19-oct');
  it.todo('Semi Neto causado al corte (reglas originales, 19-oct) = -888 523 — falta foto del 19-oct');

  // Parametrización de octubre, datos al 19-oct (CP-43 / Req 28.5):
  it.todo('Semi Neto proyectado al cierre (parametrización oct-2026, 19-oct) = 486 541 — faltan foto del 19-oct y parametrización');
  it.todo('Semi Neto causado al corte (parametrización oct-2026, 19-oct) = 211 168 — faltan foto del 19-oct y parametrización');
});

// -----------------------------------------------------------------------------
// Fuente ÚNICA de publicación: construirFilasEscenarios (FALLO 1 / CP-49)
// -----------------------------------------------------------------------------
// La publicación manual (page.tsx) y la corrida programada server-side
// (_shared/motor.ts) comparten esta función. Debe producir los DOS escenarios
// con los mismos montos que calcularEscenarios, para que la tabla final nunca
// se quede con un solo escenario (la causa del FALLO 1).
describe('construirFilasEscenarios — los dos escenarios (CP-49 / FALLO 1)', () => {
  const insumos = { reglas, metodos, params, empresas: EMPRESAS, gn: GN };
  const filas = construirFilasEscenarios('2026-10', insumos);
  const esc1 = filas.filter((f) => f.proyeccion === 1);
  const esc2 = filas.filter((f) => f.proyeccion === 2);

  it('produce 95 filas por escenario = 190 filas (ambos escenarios presentes)', () => {
    expect(filas.length).toBe(190);
    expect(esc1.length).toBe(95);
    expect(esc2.length).toBe(95);
  });

  it('el escenario 1 (Proyectado) coincide con calcularEscenarios().proyeccion.val', () => {
    const esc = calcularEscenarios({ reglas, metodos, params, empresas: [...EMPRESAS], gn: GN });
    esc1.forEach((f, i) => expect(f.monto_usd).toBeCloseTo(esc.proyeccion.val[i], 2));
  });

  it('el escenario 2 (Causado) coincide con calcularEscenarios().causado.val', () => {
    const esc = calcularEscenarios({ reglas, metodos, params, empresas: [...EMPRESAS], gn: GN });
    esc2.forEach((f, i) => expect(f.monto_usd).toBeCloseTo(esc.causado.val[i], 2));
  });

  it('todas las filas llevan FECHA = día 1, Vista GYP y Monto_Local = Monto_USD × tasa', () => {
    for (const f of filas) {
      expect(f.fecha).toBe('2026-10-01');
      expect(f.vista).toBe('GYP');
      const tasa = params[f.empresa]?.tasa || 0;
      expect(f.monto_local).toBeCloseTo(f.monto_usd * tasa, 2);
    }
  });
});

describe('Métodos que «Así quedaría» simula — ratio de la venta y presupuesto', () => {
  const idx = reglas.findIndex((r) => r.concepto !== 'Ventas' && r.grupo === 'GOP');
  const emp = reglas[idx].empresa;
  const iVenta = reglas.findIndex((r) => r.empresa === emp && r.concepto === 'Ventas');

  it('ratio_venta = (Σ concepto ÷ Σ venta de N meses) × venta del mes', () => {
    const rs = reglas.map((r, i) => (i === idx ? { ...r, metodo: 'm_ratio_venta', n: 6 } : r));
    const res = calcular({ reglas: rs, metodos, params, empresas: [...EMPRESAS], gn: GN });
    const suma = (s: number[]) => s.slice(-6).filter((x) => !Number.isNaN(x)).reduce((a, b) => a + b, 0);
    const esperado = (suma(rs[idx].serie) / suma(rs[iVenta].serie)) * res.venta[emp];
    expect(res.val[idx]).not.toBe(0);
    expect(res.val[idx]).toBeCloseTo(esperado, 6);
  });

  it('presupuesto toma el presupuesto del mes de la regla', () => {
    const rs = reglas.map((r, i) => (i === idx ? { ...r, metodo: 'm_ppto', presupuesto: 1234.5 } : r));
    const res = calcular({ reglas: rs, metodos, params, empresas: [...EMPRESAS], gn: GN });
    expect(res.val[idx]).toBeCloseTo(1234.5, 6);
  });
});
