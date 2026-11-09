/**
 * Capa de salida pura de la Proyección del GyP.
 *
 * Esta capa NO habla con la red: solo transforma los resultados del motor en las
 * filas de la tabla final que lee Power BI (`F_Mayor`). Al ser pura, se prueba
 * sola contra el contrato de 13 columnas del §5 de `12-cambios-para-produccion.md`
 * (contrato completo en `08-tabla-final-proyeccion.md`).
 *
 * Reglas no negociables del contrato:
 *   - CP-04 · `FECHA` = día 1 del periodo (aaaa-mm-01). Una fecha intermedia
 *     desalinea el mes en curso de Gold.
 *   - CP-05 · `Tasa_Mensual` solo para Cofersa y Mundial; NULL en las venezolanas
 *     (el mayor ya trae el local para esas empresas).
 *   - CP-52 · El país se llena desde un mapa PROPIO del aplicativo, nunca desde
 *     el origen (que viene NULL en Beval, Sillaca y Cofersa).
 *   - Signos crudos (ingresos negativos); no se renombran claves internas
 *     heredadas; `Monto_Local = Monto_USD × tasa`.
 *   - Una fila POR CUENTA DE DESTINO: una regla repartida aporta varias filas.
 *
 * Reutiliza los tipos del módulo: `FilaResultado` de `data.ts` y el mapa `PAIS`
 * de `engine.ts`, para no duplicar la verdad.
 */

import type { Regla, Metodo, Parametro } from './engine';
import { PAIS, calcularEscenarios } from './engine';

/**
 * Las 13 columnas de la tabla final (contrato CP-52/CP-05), más `proyeccion`
 * (escenario: 1 proyectado, 2 causado). Vive aquí —módulo PURO— para que el
 * motor y la publicación puedan compartirla sin arrastrar el cliente de Supabase
 * del navegador. `data.ts` la re-exporta para no romper a sus consumidores.
 */
export interface FilaResultado {
  periodo: string;
  fecha: string;
  vista: string;
  combinada: string;
  pais: string;
  empresa: string;
  tasa_mensual: number | null;
  ajuste: number;
  ajuste_usd: number;
  monto_local: number;
  monto_usd: number;
  centro_costo: string;
  cuenta_contable: string;
  proyeccion: number;
}
// ─────────────────────────────────────────────────────────────────────────────
// Mapas propios del contrato (CP-52 / CP-05)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapa de países propio del aplicativo (CP-52). Se re-exporta el `PAIS` del
 * motor para que la salida tenga una sola fuente de verdad: en el origen el
 * campo viene NULL en Beval, Sillaca y Cofersa, así que confiar en él dejaría
 * tres de las seis empresas sin país.
 */
export const PAIS_SALIDA: Record<string, string> = PAIS;

/** Empresas cuya `Tasa_Mensual` SÍ se puebla en la tabla final (CP-05). */
export const EMPRESAS_CON_TASA = new Set(['Cofersa', 'Mundial']);

/**
 * ¿Esta empresa lleva `Tasa_Mensual` en la tabla final? Solo Cofersa y Mundial;
 * las venezolanas la dejan NULL porque el mayor ya trae su local.
 */
export function llevaTasaMensual(empresa: string): boolean {
  return EMPRESAS_CON_TASA.has(empresa);
}

/**
 * `FECHA` = día 1 del periodo, en formato `aaaa-mm-01` (CP-04). El periodo llega
 * como `aaaa-mm` o `aaaa-mm-dd`; en ambos casos la fecha de salida se fija al día 1.
 */
export function fechaDia1(periodo: string): string {
  const [anio, mes] = periodo.split('-');
  return `${anio}-${mes}-01`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Destino de una regla (una cuenta de la tabla final)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una cuenta de destino con su parte del monto. Sin reparto hay un único destino
 * (la Combinada de la regla con todo su monto); con reparto hay uno por cuenta,
 * y la suma de `montoUsd` de todos los destinos reproduce el monto de la regla.
 */
export interface DestinoCuenta {
  combinada: string;
  centroCosto: string;
  cuentaContable: string;
  /** Parte del monto USD que cae en esta cuenta (signo crudo). */
  montoUsd: number;
}

/**
 * Convierte el destino de la regla en la Combinada, el centro de costo, la
 * cuenta y el monto propios. Sin destino explícito, todo va a la Combinada de la
 * regla con la totalidad del monto.
 */
export function destinoRegla(regla: Regla, montoUsd: number): DestinoCuenta {
  return {
    combinada: regla.combinada,
    centroCosto: regla.cc,
    cuentaContable: regla.cuenta,
    montoUsd,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// aFilaFinal — el contrato de las 13 columnas (CP-04 / CP-05 / CP-52)
// ─────────────────────────────────────────────────────────────────────────────

export interface OpcionesFila {
  /** Periodo `aaaa-mm` (o `aaaa-mm-dd`); se usa para `FECHA` = día 1. */
  periodo: string;
  /** 1 = Proyectado al cierre, 2 = Causado al corte. */
  proyeccion: 1 | 2;
  /**
   * Tasa local del periodo para la empresa. Se usa tal cual para `Monto_Local`.
   * En Cofersa/Mundial también va a `Tasa_Mensual`; en las venezolanas esa
   * columna queda NULL aunque la tasa exista (contrato CP-05).
   */
  tasa: number;
}

/**
 * Produce UNA `FilaResultado` para una cuenta de destino, cumpliendo el contrato:
 *   - `FECHA` = día 1 del periodo (CP-04).
 *   - `Vista = 'GYP'`, `Ajuste = 0`, `Ajuste_USD = 0`.
 *   - `Pais` del mapa propio (CP-52).
 *   - `Tasa_Mensual` solo Cofersa/Mundial; NULL en las venezolanas (CP-05).
 *   - `Monto_Local = Monto_USD × tasa`.
 *
 * El monto con signo crudo se conserva (los ingresos salen negativos).
 */
export function aFilaFinal(
  regla: Regla,
  destino: DestinoCuenta,
  opts: OpcionesFila,
): FilaResultado {
  const empresa = regla.empresa;
  const tasa = opts.tasa;
  return {
    periodo: opts.periodo,
    fecha: fechaDia1(opts.periodo),
    vista: 'GYP',
    combinada: destino.combinada,
    pais: PAIS_SALIDA[empresa] ?? '',
    empresa,
    tasa_mensual: llevaTasaMensual(empresa) ? tasa : null,
    ajuste: 0,
    ajuste_usd: 0,
    monto_local: destino.montoUsd * tasa,
    monto_usd: destino.montoUsd,
    centro_costo: destino.centroCosto,
    cuenta_contable: destino.cuentaContable,
    proyeccion: opts.proyeccion,
  };
}

/**
 * Produce las filas de una regla, una por cuenta de destino (CP-08). Sin reparto
 * es una sola fila; con reparto, tantas como destinos tenga, y la suma de sus
 * `Monto_USD` reproduce el monto de la regla.
 */
export function filasDeRegla(
  regla: Regla,
  destinos: DestinoCuenta[],
  opts: OpcionesFila,
): FilaResultado[] {
  return destinos.map((d) => aFilaFinal(regla, d, opts));
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialización CSV (orden y separador exactos del §5)
// ─────────────────────────────────────────────────────────────────────────────

/** Encabezado exacto del CSV, en el orden del contrato, separado por `;`. */
export const ENCABEZADO_SALIDA =
  'FECHA;Ajuste;Vista;Combinada;Pais;Empresa;Tasa_Mensual;Ajuste_USD;Monto_Local;Monto_USD;CENTRO_COSTO;CUENTA_CONTABLE;Proyeccion';

/** Columnas de la tabla final, en el orden exacto del contrato. */
export const COLUMNAS_SALIDA = ENCABEZADO_SALIDA.split(';');

/** Celda vacía para los NULL (la `Tasa_Mensual` de las venezolanas). */
function celda(valor: number | string | null): string {
  return valor == null ? '' : String(valor);
}

/** Serializa una `FilaResultado` a los 13 campos en orden, separados por `;`. */
export function filaACsv(f: FilaResultado): string {
  const campos: Array<number | string | null> = [
    f.fecha,
    f.ajuste,
    f.vista,
    f.combinada,
    f.pais,
    f.empresa,
    f.tasa_mensual,
    f.ajuste_usd,
    f.monto_local,
    f.monto_usd,
    f.centro_costo,
    f.cuenta_contable,
    f.proyeccion,
  ];
  return campos.map(celda).join(';');
}

/**
 * Serializa el conjunto de filas a CSV con el encabezado y el orden del contrato.
 * Las líneas se separan con `\n` y el documento empieza por el encabezado exacto.
 */
export function aCsv(filas: FilaResultado[]): string {
  return [ENCABEZADO_SALIDA, ...filas.map(filaACsv)].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Fusión por Combinada (CP-06) y validación contra catálogo (CP-07)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fusiona las filas que resuelven a la misma Combinada, sumando sus montos en
 * una sola fila (CP-06). Con `destino`/reparto dos reglas distintas pueden caer
 * en la misma Combinada; si llegaran por separado al insert violarían el índice
 * único `(periodo, escenario, combinada)` de CP-02, así que la fusión ocurre
 * ANTES de publicar.
 *
 * Supuesto de escenario: `FilaResultado` no lleva columna `escenario`, y esta
 * función se invoca con las filas de UN solo escenario y periodo (el publicador
 * recorre los escenarios por separado). Para que el resultado sea válido incluso
 * si llegara una mezcla, la clave de agrupación es `(periodo, combinada)`: así
 * nunca se fusionan filas de periodos distintos. Mientras las filas vengan de un
 * único escenario —el caso real— esto equivale a agrupar por la clave completa.
 *
 * Se preservan las demás columnas del contrato (fecha, vista, pais, empresa,
 * tasa_mensual, centro_costo, cuenta_contable, proyeccion, ajuste, ajuste_usd)
 * de la PRIMERA fila del grupo; solo `monto_usd` se suma y `monto_local` se
 * recalcula como la suma de los locales del grupo (cada local ya es
 * `monto_usd × tasa` de su fila, y la tasa es constante dentro de una empresa).
 * El orden de aparición de las Combinadas se respeta.
 */
export function fusionarPorCombinada(filas: FilaResultado[]): FilaResultado[] {
  const grupos = new Map<string, FilaResultado>();
  for (const fila of filas) {
    const clave = `${fila.periodo}\u0000${fila.combinada}`;
    const existente = grupos.get(clave);
    if (existente === undefined) {
      // Copia para no mutar la fila de entrada (funciones puras).
      grupos.set(clave, { ...fila });
    } else {
      existente.monto_usd += fila.monto_usd;
      existente.monto_local += fila.monto_local;
    }
  }
  return [...grupos.values()];
}

/**
 * Catálogo de Combinadas válidas de `dim_cuenta`. Se acepta cualquier iterable
 * (arreglo o `Set`) de Combinadas para no atar al llamador a una estructura.
 */
export type CatalogoCombinadas = Iterable<string>;

/**
 * Valida las Combinadas de las filas contra el catálogo `dim_cuenta` (CP-07).
 * Devuelve las llaves HUÉRFANAS: Combinadas presentes en las filas pero ausentes
 * del catálogo, en su orden de primera aparición y sin repetir.
 *
 * Una llave huérfana no da error en el insert: simplemente desaparece del
 * reporte sin aviso. Por eso el publicador debe detenerse cuando este arreglo no
 * esté vacío y reportar las Combinadas que devuelve, en lugar de publicar a
 * ciegas. Un resultado vacío significa que todas las Combinadas existen en el
 * catálogo y la publicación puede continuar.
 */
export function validarContraCatalogo(
  filas: FilaResultado[],
  dimCuenta: CatalogoCombinadas,
): string[] {
  const validas = dimCuenta instanceof Set ? dimCuenta : new Set(dimCuenta);
  const huerfanas: string[] = [];
  const vistas = new Set<string>();
  for (const fila of filas) {
    const combinada = fila.combinada;
    if (!validas.has(combinada) && !vistas.has(combinada)) {
      vistas.add(combinada);
      huerfanas.push(combinada);
    }
  }
  return huerfanas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Construcción de las filas de los DOS escenarios (fuente única de publicación)
// ─────────────────────────────────────────────────────────────────────────────

/** Insumos del motor ya ensamblados (estado de la pantalla o de la corrida). */
export interface InsumosPublicacion {
  reglas: Regla[];
  metodos: Record<string, Metodo>;
  params: Record<string, Parametro>;
  empresas: readonly string[];
  /** Promedio por defecto (N) de las reglas de promedio sin N propio. */
  gn: number;
  /** Datos del corte para el modo de causado 'calendario' (§E), opcionales. */
  diaDelCorte?: number;
  diasDelMes?: number;
}

/**
 * C3 · Deriva los datos del corte que necesita el causado por días calendario
 * (§E) a partir del periodo (`'2026-10'`) y del corte (`'2026-10-07'`).
 *
 * FUENTE ÚNICA a propósito: lo usan la pantalla y la corrida programada
 * server-side. Calculado por separado en cada sitio, acabarían divergiendo y
 * la publicación manual y la programada darían causados distintos.
 *
 * Se parsea a mano, NO con `new Date('2026-10-07')`: ese constructor lee la
 * cadena como UTC y en Caracas (UTC−4) `getDate()` devolvería el día anterior,
 * corriendo todo el causado un día.
 */
export function datosDelCorte(
  periodo: string | null | undefined,
  corte: string | null | undefined,
): { diaDelCorte?: number; diasDelMes?: number } {
  const c = (corte ?? '').split('-').map(Number);
  const p = (periodo ?? '').split('-').map(Number);
  const dia = c[2];
  const anio = p[0];
  const mes = p[1];
  return {
    diaDelCorte: Number.isFinite(dia) ? dia : undefined,
    // Día 0 del mes siguiente = último día de este mes.
    diasDelMes:
      Number.isFinite(anio) && Number.isFinite(mes) ? new Date(anio, mes, 0).getDate() : undefined,
  };
}

/**
 * Construye las `FilaResultado` de los DOS escenarios (CP-01/CP-49): una fila por
 * regla, `proyeccion.val[i]` para el escenario 1 (Proyectado, `proyeccion=1`) y
 * `causado.val[i]` para el escenario 2 (Causado, `proyeccion=2`), alineados por
 * índice con `reglas`. `Monto_Local = Monto_USD × tasa` de la empresa, `FECHA` =
 * día 1 (CP-04), `Vista='GYP'`, `Ajuste`/`Ajuste_USD`=0, país del mapa propio
 * (CP-52), `Tasa_Mensual` solo en Cofersa/Mundial con la tasa del mes (CP-05).
 *
 * FUENTE ÚNICA: la usan tanto la publicación manual (`page.tsx`) como la corrida
 * programada server-side (`supabase/functions/_shared/motor.ts`), para que ambas
 * produzcan EXACTAMENTE las mismas filas. La fusión por Combinada, la validación
 * de catálogo y el DELETE+INSERT por escenario los hace `publicar-proyeccion`.
 */
export function construirFilasEscenarios(
  periodo: string,
  insumos: InsumosPublicacion,
): FilaResultado[] {
  const { reglas, metodos, params, empresas, gn, diaDelCorte, diasDelMes } = insumos;
  const escenarios = calcularEscenarios({
    reglas,
    metodos,
    params,
    empresas: [...empresas],
    gn,
    diaDelCorte,
    diasDelMes,
  });
  const fecha = fechaDia1(periodo);

  // D8 · Sin tasa NO se publica un cero. `monto_local = monto * (tasa || 0)`
  // convertia una tasa ausente en una columna entera de ceros en Power BI: un
  // dato que parece bueno y no lo es. Es preferible negarse a publicar.
  const sinTasa = [...new Set(reglas.map((r) => r.empresa))].filter(
    (e) => !(typeof params[e]?.tasa === 'number' && params[e].tasa !== 0),
  );
  if (sinTasa.length) {
    throw new Error(
      `No hay tasa del periodo para ${sinTasa.join(', ')}: Monto_Local saldria en 0 ` +
        `para esas empresas. Carga la tasa en proyeccion_parametro antes de publicar.`,
    );
  }

  // D8 · Lo mismo con el pais: `r.pais || PAIS[...] || r.empresa` acababa
  // poniendo el NOMBRE DE LA EMPRESA en la columna Pais cuando faltaba el mapa.
  // El mapa propio (CP-52) cubre las seis empresas; si alguna no esta, es un
  // error de configuracion y se dice, no se rellena con cualquier cosa.
  const sinPais = [...new Set(reglas.map((r) => r.empresa))].filter((e) => !PAIS[e]);
  if (sinPais.length) {
    throw new Error(
      `Sin pais en el mapa para ${sinPais.join(', ')}: la columna Pais saldria con ` +
        `el nombre de la empresa. Revisa PAIS en engine.ts.`,
    );
  }

  const filaDe = (r: Regla, monto: number, escenario: number): FilaResultado => ({
    periodo,
    fecha,
    vista: 'GYP',
    combinada: r.combinada,
    pais: PAIS[r.empresa],
    empresa: r.empresa,
    // CP-05: solo Cofersa/Mundial, con la tasa del mes. Las reglas leídas de la
    // base llegan sin tasa propia; se completa con la de `proyeccion_parametro`.
    tasa_mensual: llevaTasaMensual(r.empresa)
      ? (r.tasaMensual ?? params[r.empresa]?.tasa ?? null)
      : null,
    ajuste: 0,
    ajuste_usd: 0,
    monto_local: monto * (params[r.empresa] as Parametro).tasa!,
    monto_usd: monto,
    centro_costo: r.cc,
    cuenta_contable: r.cuenta,
    proyeccion: escenario,
  });
  return [
    ...reglas.map((r, i) => filaDe(r, escenarios.proyeccion.val[i], 1)),
    ...reglas.map((r, i) => filaDe(r, escenarios.causado.val[i], 2)),
  ];
}
