/**
 * Capa de datos de la Proyección del GyP.
 *
 * Arma el estado inicial desde la semilla validada (siempre disponible) y, si
 * Supabase responde, aplica encima los parámetros, métodos, reglas y la historia
 * que haya en la base. Esto reproduce el comportamiento del prototipo: la página
 * abre completa con la foto embebida y la base se superpone cuando está lista.
 *
 * Tablas (ver script SQL del módulo):
 *   proyeccion_parametro, proyeccion_metodo, proyeccion_regla,
 *   gyp_historico_mensual, proyeccion_resultado.
 */

import { supabase } from '@/lib/supabase';
import type { Metodo, Parametro, Regla, GrupoPL, Base, Operacion } from './engine';
import { PAIS } from './engine';
import {
  METODOS_BASE,
  PARAMS_SEED,
  REGLAS_SEED,
  PERIODO_DEFAULT,
  EMPRESAS,
} from './seed';
import { SERIES_EMBEBIDAS, type SerieCuenta } from './series';

export type Fuente = 'embebida' | 'db' | 'error';

export interface ProyeccionData {
  periodo: string;
  generado: string | null;
  corte: string | null;
  fuente: Fuente;
  params: Record<string, Parametro>;
  metodos: Record<string, Metodo>;
  /** empresa|concepto -> {acum, serie}. */
  series: Record<string, SerieCuenta>;
  /** Reglas base (sin overrides del usuario). */
  reglasBase: ReglaBase[];
}

export interface ReglaBase {
  empresa: string;
  concepto: string;
  grupo: GrupoPL;
  metodo: string;
  valor: number | null;
  combinada: string;
  cc: string;
  cuenta: string;
  tasaMensual: number | null;
}

/** Estado inicial 100% desde la semilla (sin red). Reproduce la aceptación. */
export function construirDesdeSemilla(): ProyeccionData {
  const params: Record<string, Parametro> = {};
  PARAMS_SEED.forEach((p) => {
    params[p.empresa] = { empresa: p.empresa, dias: p.dias, trans: p.trans, factor: p.factor, tasa: p.tasa };
  });
  const metodos: Record<string, Metodo> = {};
  Object.values(METODOS_BASE).forEach((m) => (metodos[m.id] = { ...m }));
  return {
    periodo: PERIODO_DEFAULT,
    generado: '2026-10-13 10:28',
    corte: '2026-10-07',
    fuente: 'embebida',
    params,
    metodos,
    series: { ...SERIES_EMBEBIDAS },
    reglasBase: REGLAS_SEED.map((r) => ({ ...r })),
  };
}

/** Ensambla las reglas de trabajo (con serie y acumulado) listas para el motor. */
export function ensamblarReglas(
  reglasBase: ReglaBase[],
  series: Record<string, SerieCuenta>,
): Regla[] {
  return reglasBase.map((r, i) => {
    const sc = series[r.empresa + '|' + r.concepto] || { a: 0, s: [] };
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
      pais: PAIS[r.empresa] || r.empresa,
      tasaMensual: r.tasaMensual,
      serie: (sc.s || []).map((x) => (x == null ? NaN : x)),
      acum: sc.a || 0,
      nueva: false,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Carga desde Supabase (opcional: superpone sobre la semilla)
// ─────────────────────────────────────────────────────────────────────────────

interface RowParametro {
  periodo: string; empresa: string; dias_habiles_mes: number; dias_transcurridos: number;
  factor_correccion: number; tasa_local: number | null; corte: string | null;
}
interface RowMetodo {
  id: string; nombre: string; operacion: Operacion; base: string; valor: number | null;
  invertir: boolean; turno: number; de_fabrica: boolean; activo: boolean;
}
interface RowRegla {
  periodo: string; empresa: string; concepto: string; grupo_pl: GrupoPL; combinada: string;
  centro_costo: string; cuenta_contable: string; metodo: string; valor: number | null; activa: boolean;
}
interface RowHistorico {
  periodo: string; empresa: string; concepto: string; monto_usd: number; es_venta: boolean;
}

/**
 * Intenta leer la base. Devuelve la data con fuente 'db' si encontró algo útil,
 * o re-lanza para que el llamador conserve la semilla y marque 'error'.
 */
export async function cargarDesdeSupabase(
  periodo: string,
  seed: ProyeccionData,
): Promise<ProyeccionData> {
  const data: ProyeccionData = {
    ...seed,
    params: { ...seed.params },
    metodos: { ...seed.metodos },
    series: { ...seed.series },
    reglasBase: seed.reglasBase.map((r) => ({ ...r })),
  };
  let encontroAlgo = false;

  // Parámetros
  const { data: pr } = await supabase
    .from('proyeccion_parametro')
    .select('*')
    .eq('periodo', periodo);
  if (pr && pr.length) {
    (pr as RowParametro[]).forEach((row) => {
      if (!EMPRESAS.includes(row.empresa)) return;
      const prev = data.params[row.empresa];
      data.params[row.empresa] = {
        empresa: row.empresa,
        dias: row.dias_habiles_mes,
        trans: row.dias_transcurridos,
        factor: row.factor_correccion,
        tasa: row.tasa_local ?? prev?.tasa ?? 0,
      };
      if (row.corte) data.corte = row.corte;
    });
    encontroAlgo = true;
  }

  // Métodos
  const { data: mr } = await supabase.from('proyeccion_metodo').select('*').eq('activo', true);
  if (mr && mr.length) {
    const metodos: Record<string, Metodo> = {};
    (mr as RowMetodo[]).forEach((row) => {
      metodos[row.id] = {
        id: row.id,
        nombre: row.nombre,
        op: row.operacion,
        base: row.base as Base,
        valor: row.valor,
        invertir: row.invertir,
        orden: row.turno,
        fijo: row.de_fabrica,
      };
    });
    data.metodos = metodos;
    encontroAlgo = true;
  }

  // Reglas
  const { data: rr } = await supabase
    .from('proyeccion_regla')
    .select('*')
    .eq('periodo', periodo)
    .eq('activa', true);
  if (rr && rr.length) {
    data.reglasBase = (rr as RowRegla[]).map((row) => ({
      empresa: row.empresa,
      concepto: row.concepto,
      grupo: row.grupo_pl,
      metodo: row.metodo,
      valor: row.valor,
      combinada: row.combinada,
      cc: row.centro_costo,
      cuenta: row.cuenta_contable,
      tasaMensual: null,
    }));
    encontroAlgo = true;
  }

  // Historia mensual (acumulado del mes + serie). Opcional: la foto embebida ya sirve.
  const { data: hr } = await supabase
    .from('gyp_historico_mensual')
    .select('periodo,empresa,concepto,monto_usd,es_venta');
  if (hr && hr.length) {
    const series: Record<string, SerieCuenta> = {};
    const periodosOrden = [...new Set((hr as RowHistorico[]).map((h) => h.periodo))].sort();
    const prevPeriodos = periodosOrden.filter((p) => p < periodo);
    for (const h of hr as RowHistorico[]) {
      const key = h.empresa + '|' + h.concepto;
      if (!series[key]) series[key] = { a: 0, s: new Array(prevPeriodos.length).fill(null) };
      if (h.periodo === periodo) {
        series[key].a += h.monto_usd;
      } else {
        const idx = prevPeriodos.indexOf(h.periodo);
        if (idx >= 0) series[key].s[idx] = (series[key].s[idx] ?? 0) + h.monto_usd;
      }
    }
    // Sólo reemplaza si la base trajo historia; si no, conserva la foto embebida.
    data.series = { ...seed.series, ...series };
    encontroAlgo = true;
  }

  if (!encontroAlgo) throw new Error('sin-datos');
  data.fuente = 'db';
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Publicar el resultado (escribe proyeccion_resultado)
// ─────────────────────────────────────────────────────────────────────────────

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

/** Reemplaza las filas del periodo y escribe el nuevo resultado. */
export async function publicarResultado(periodo: string, filas: FilaResultado[]): Promise<void> {
  const { error: delErr } = await supabase.from('proyeccion_resultado').delete().eq('periodo', periodo);
  if (delErr) throw delErr;
  // Insertar por lotes de 500.
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const { error } = await supabase.from('proyeccion_resultado').insert(lote);
    if (error) throw error;
  }
}
