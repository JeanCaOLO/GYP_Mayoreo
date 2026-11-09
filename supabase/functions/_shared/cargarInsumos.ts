// supabase/functions/_shared/cargarInsumos.ts
//
// Lectura SERVER-SIDE de los insumos del motor (equivale a `cargarDesdeSupabase`
// + `ensamblarReglas` de `src/pages/proyeccion-gyp/data.ts`, pero con el cliente
// de SERVICIO y SIN la semilla embebida).
//
// Diferencia deliberada con el navegador: aquí NO se usa la foto embebida como
// respaldo de reglas/series/parámetros. En una corrida desatendida publicar la
// semilla equivaldría a publicar cifras de prueba; por eso, si faltan reglas o
// parámetros, esta función LANZA y la corrida se marca en error sin publicar.
// Los métodos de fábrica (`METODOS_BASE`) sí sirven de respaldo: son
// configuración estable del §D, no datos del periodo.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  EMPRESAS,
  METODOS_BASE,
  PAIS,
  datosDelCorte,
  type InsumosMotor,
  type Regla,
  type Metodo,
  type Parametro,
} from './motor.ts';

// Filas crudas de las tablas (igual contrato que data.ts).
interface RowParametro {
  periodo: string; empresa: string; dias_habiles_mes: number; dias_transcurridos: number;
  factor_correccion: number; tasa_local: number | null; corte: string | null;
}
interface RowMetodo {
  id: string; nombre: string; operacion: string; base: string; valor: number | null;
  invertir: boolean; turno: number; de_fabrica: boolean; activo: boolean;
}
interface RowRegla {
  periodo: string; empresa: string; concepto: string; grupo_pl: string; combinada: string;
  centro_costo: string; cuenta_contable: string; metodo: string; valor: number | null; activa: boolean;
  n?: number | null; nombre?: string | null; detalle?: string | null; causado?: Regla['causado'];
  escenarios?: Regla['escenarios']; nivel?: Regla['nivel']; eliminada?: boolean;
}
interface RowHistorico {
  periodo: string; empresa: string; concepto: string; monto_usd: number; es_venta: boolean;
}

/** Serie por cuenta: acumulado del mes (`a`) y serie de meses previos (`s`). */
interface SerieCuenta { a: number; s: (number | null)[]; }

export interface InsumosLeidos extends InsumosMotor {
  /** Corte más avanzado de la extracción del periodo (para la bitácora). */
  corte: string | null;
}

/**
 * Lee de Supabase los insumos del motor para un periodo y los ensambla igual que
 * el navegador. Lanza si faltan reglas o parámetros (no se publica con datos
 * incompletos).
 */
export async function cargarInsumos(
  db: SupabaseClient,
  periodo: string,
  gn = 9,
): Promise<InsumosLeidos> {
  // ── Parámetros por empresa ──
  const { data: pr, error: eParam } = await db
    .from('proyeccion_parametro')
    .select('periodo,empresa,dias_habiles_mes,dias_transcurridos,factor_correccion,tasa_local,corte')
    .eq('periodo', periodo);
  if (eParam) throw new Error('No se pudieron leer los parámetros: ' + eParam.message);
  const params: Record<string, Parametro> = {};
  let corte: string | null = null;
  for (const row of (pr ?? []) as RowParametro[]) {
    if (!EMPRESAS.includes(row.empresa)) continue;
    params[row.empresa] = {
      empresa: row.empresa,
      dias: row.dias_habiles_mes,
      trans: row.dias_transcurridos,
      factor: row.factor_correccion,
      tasa: row.tasa_local ?? 0,
    };
    if (row.corte && (!corte || row.corte > corte)) corte = row.corte;
  }
  if (Object.keys(params).length === 0) {
    throw new Error(`sin parámetros para ${periodo}: no se publica con datos incompletos.`);
  }

  // ── Métodos (fallback a los de fábrica si la tabla viene vacía) ──
  const metodos: Record<string, Metodo> = {};
  const { data: mr } = await db.from('proyeccion_metodo').select('*').eq('activo', true);
  if (mr && mr.length) {
    for (const row of mr as RowMetodo[]) {
      metodos[row.id] = {
        id: row.id,
        nombre: row.nombre,
        op: row.operacion as Metodo['op'],
        base: row.base as Metodo['base'],
        valor: row.valor,
        invertir: row.invertir,
        orden: row.turno,
        fijo: row.de_fabrica,
      };
    }
  } else {
    for (const m of Object.values(METODOS_BASE)) metodos[m.id] = { ...m };
  }

  // ── Reglas base ──
  const { data: rr, error: eRegla } = await db
    .from('proyeccion_regla')
    .select('*')
    .eq('periodo', periodo)
    .eq('activa', true);
  if (eRegla) throw new Error('No se pudieron leer las reglas: ' + eRegla.message);
  // Las borradas (borrado lógico, CP-31) no entran, igual que en la pantalla.
  const reglasBase = ((rr ?? []) as RowRegla[]).filter((r) => !r.eliminada);
  if (reglasBase.length === 0) {
    throw new Error(`sin reglas activas para ${periodo}: no se publica con datos incompletos.`);
  }

  // ── Historia mensual → serie + acumulado por cuenta (igual que data.ts) ──
  //
  // D2: PAGINADO. Supabase corta en 1.000 filas y no avisa; esta tabla ya va por
  // ~1.300 y crece cada mes. Truncada, la corrida programada publicaria series
  // incompletas sin dar ningun error: cifras mal en Power BI y nadie sabria por que.
  const historico: RowHistorico[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data: pagina, error: eHist } = await db
      .from('gyp_historico_mensual')
      .select('periodo,empresa,concepto,monto_usd,es_venta')
      .range(desde, desde + 999);
    if (eHist) throw new Error('No se pudo leer la historia mensual: ' + eHist.message);
    if (!pagina || pagina.length === 0) break;
    historico.push(...(pagina as RowHistorico[]));
    if (pagina.length < 1000) break;
  }
  const series: Record<string, SerieCuenta> = {};
  if (historico.length) {
    const periodosOrden = [...new Set(historico.map((h) => h.periodo))].sort();
    const prevPeriodos = periodosOrden.filter((p) => p < periodo);
    for (const h of historico) {
      const key = h.empresa + '|' + h.concepto;
      if (!series[key]) series[key] = { a: 0, s: new Array(prevPeriodos.length).fill(null) };
      if (h.periodo === periodo) {
        series[key].a += h.monto_usd;
      } else {
        const idx = prevPeriodos.indexOf(h.periodo);
        if (idx >= 0) series[key].s[idx] = (series[key].s[idx] ?? 0) + h.monto_usd;
      }
    }
  }

  // ── Presupuesto del mes por empresa|concepto (método «presupuesto») ──
  // D2: PAGINADO. gyp_historico_cuenta va por ~1.900 filas en un solo periodo,
  // asi que sin paginar el metodo «presupuesto» trabajaba con la MITAD del
  // presupuesto y sin dar ningun error.
  type FilaPpto = { empresa: string; concepto: string; presupuesto: number | null };
  const pp: FilaPpto[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data: pagina, error: ePpto } = await db
      .from('gyp_historico_cuenta')
      .select('empresa,concepto,presupuesto')
      .eq('periodo', periodo)
      .range(desde, desde + 999);
    if (ePpto) throw new Error('No se pudo leer el presupuesto: ' + ePpto.message);
    if (!pagina || pagina.length === 0) break;
    pp.push(...(pagina as FilaPpto[]));
    if (pagina.length < 1000) break;
  }
  const ppto = new Map<string, number>();
  for (const f of pp) {
    const key = f.empresa + '|' + f.concepto;
    ppto.set(key, (ppto.get(key) ?? 0) + (Number(f.presupuesto) || 0));
  }

  // ── Ensamblado de reglas de trabajo (idéntico a `ensamblarReglas`) ──
  const reglas: Regla[] = reglasBase.map((r, i) => {
    const sc = series[r.empresa + '|' + r.concepto] || { a: 0, s: [] };
    return {
      key: 'r' + i,
      empresa: r.empresa,
      concepto: r.concepto,
      grupo: r.grupo_pl as Regla['grupo'],
      metodo: r.metodo,
      valor: r.valor,
      n: r.n ?? null,
      nombre: r.nombre ?? null,
      detalle: r.detalle ?? null,
      causado: r.causado,
      escenarios: r.escenarios,
      nivel: r.nivel,
      combinada: r.combinada,
      cc: r.centro_costo,
      cuenta: r.cuenta_contable,
      pais: PAIS[r.empresa] || r.empresa,
      tasaMensual: null,
      serie: (sc.s || []).map((x) => (x == null ? NaN : x)),
      acum: sc.a || 0,
      nueva: false,
      presupuesto: ppto.get(r.empresa + '|' + r.concepto) ?? null,
    };
  });

  // C3: la corrida programada tambien necesita los datos del corte, o publicaria
  // el causado sin prorratear. Mismo helper que usa la pantalla, para que la
  // publicacion manual y la programada no puedan divergir.
  const { diaDelCorte, diasDelMes } = datosDelCorte(periodo, corte);

  return { reglas, metodos, params, empresas: EMPRESAS, gn, corte, diaDelCorte, diasDelMes };
}