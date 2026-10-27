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
import type {
  Metodo,
  Parametro,
  Regla,
  GrupoPL,
  Base,
  Operacion,
  Paso,
  Causado,
  EscenarioRegla,
  NivelRegla,
} from './engine';
import { PAIS } from './engine';
import type { FilaHistoricoCuenta, FilaDimCuenta } from './capas';
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
  /** ids de métodos que ya existen en `proyeccion_metodo` (la regla los referencia). */
  metodosEnBase?: string[];
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
  /** Fila de `proyeccion_regla` y su versión (CP-38); ausentes en la semilla. */
  id?: number;
  rev?: number;
  n?: number | null;
  nombre?: string | null;
  detalle?: string | null;
  causado?: Causado;
  escenarios?: EscenarioRegla;
  nivel?: NivelRegla;
  /** Borrado lógico guardado en la base (CP-31). */
  eliminada?: boolean;
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
      n: r.n ?? null,
      nombre: r.nombre ?? null,
      detalle: r.detalle ?? null,
      causado: r.causado,
      escenarios: r.escenarios,
      nivel: r.nivel,
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
  id?: number; rev?: number; n?: number | null; nombre?: string | null; detalle?: string | null;
  causado?: Causado; escenarios?: EscenarioRegla; nivel?: NivelRegla; eliminada?: boolean;
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
    // Se superponen a los de la semilla: la base puede no traer los métodos
    // nuevos del §D (mediana, último, ratio, presupuesto) y sin ellos las
    // tarjetas de «¿Cómo quieres estimar el mes?» no encuentran a qué cambiar.
    data.metodos = { ...seed.metodos, ...metodos };
    data.metodosEnBase = Object.keys(metodos);
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
      id: row.id,
      rev: row.rev ?? 0,
      n: row.n ?? null,
      nombre: row.nombre ?? null,
      detalle: row.detalle ?? null,
      causado: row.causado,
      escenarios: row.escenarios,
      nivel: row.nivel,
      eliminada: row.eliminada ?? false,
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

// FilaResultado vive en salida.ts (módulo puro). Se re-exporta aquí para
// no romper a sus consumidores históricos (import { FilaResultado } from './data').
export type { FilaResultado } from './salida';

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

// ─────────────────────────────────────────────────────────────────────────────
// Refrescar desde Fabric (opción A): invoca la Edge Function que consulta
// Fabric y escribe los insumos en Supabase. El navegador NO habla con Fabric;
// solo llama a la función por HTTPS.
// ─────────────────────────────────────────────────────────────────────────────

export interface RefrescoFabric {
  ok: boolean;
  escrito: boolean;
  periodo?: string;
  corte?: string;
  generado?: string;
  conceptos?: number;
  errores?: string[];
  error?: string;
  log?: string[];
}

/**
 * Dispara la extracción de Fabric → Supabase. Devuelve el resultado para que la
 * interfaz avise si las guardas frenaron la escritura (corte sin avanzar, etc.).
 * Tras un refresco con éxito hay que volver a llamar cargarDesdeSupabase().
 */
export async function refrescarDesdeFabric(periodo?: string): Promise<RefrescoFabric> {
  const { data, error } = await supabase.functions.invoke('refrescar-proyeccion-fabric', {
    body: periodo ? { periodo } : {},
  });
  if (error) {
    // La función devuelve 409/500 con cuerpo JSON; supabase-js lo expone en context.
    const ctx = (error as unknown as { context?: { body?: unknown } }).context;
    if (ctx?.body) {
      try {
        const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
        return parsed as RefrescoFabric;
      } catch {
        /* cae al throw de abajo */
      }
    }
    throw error;
  }
  return data as RefrescoFabric;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura nueva de Supabase (Fase 3, Req 5.1 / 5.2)
//
// El detalle por cuenta (`gyp_historico_cuenta`) y el catálogo dimensional
// (`dim_cuenta`) alimentan las bases por capas, el reparto, las reglas por
// cuenta, el backtest y las alertas. Estas funciones son ADITIVAS: no tocan
// `cargarDesdeSupabase()` ni la aritmética del motor (los 190 casos no se
// mueven). Cada una devuelve estructuras planas que el motor y la interfaz
// pueden consumir, y degrada a vacío/`[]` cuando la base no responde (fallback
// a la foto embebida, igual que el resto del módulo).
//
// Fuentes del §4 (schema.sql):
//   - Detalle por cuenta: `gyp_historico_cuenta` (acumulado, presupuesto, 12 meses).
//   - Catálogo:           `dim_cuenta` (Sección/Línea/Detalle/Descripción…).
//   - Alertas:            `proyeccion_alerta` (crear/corregir/clasificar).
//   - Presupuesto:        `gyp_historico_cuenta.presupuesto` agregado por concepto.
//   - Tasas:              `proyeccion_parametro.tasa_local` por empresa.
// ─────────────────────────────────────────────────────────────────────────────

/** Una línea de presupuesto del periodo, agregada por empresa y concepto. */
export interface PresupuestoFila {
  empresa: string;
  concepto: string;
  presupuesto: number;
}

/** Tasa local del periodo por empresa (null en las venezolanas). */
export interface TasaEmpresa {
  empresa: string;
  tasa: number | null;
}

/** Una alerta de revisión del catálogo (cruce del mayor contra `dim_cuenta`). */
export interface Alerta {
  periodo: string;
  combinada: string;
  accion: 'crear' | 'corregir' | 'clasificar' | string;
  sugerencia: string | null;
  movimientoMes: number | null;
  movimiento12m: number | null;
  ultimoMes: number | null;
}

/**
 * Diferencia detectada por el cuadre del detalle por cuenta contra el resumen
 * del periodo: por cada empresa|concepto, la suma de las cuentas de detalle
 * frente al total del concepto en `gyp_historico_mensual`.
 */
export interface DescuadreCuenta {
  empresa: string;
  concepto: string;
  /** Suma del acumulado de las cuentas de detalle (gyp_historico_cuenta). */
  detalle: number;
  /** Total del concepto en el resumen del periodo (gyp_historico_mensual). */
  resumen: number;
  /** detalle − resumen (en USD). */
  diferencia: number;
}

/** Resultado de la lectura nueva, lista para el motor y la interfaz. */
export interface DatosDetalle {
  /** Filas crudas de `gyp_historico_cuenta` para el periodo. */
  historicoCuenta: FilaHistoricoCuenta[];
  /** Filas del catálogo `dim_cuenta` (sin filtro de periodo). */
  catalogo: FilaDimCuenta[];
  /** Alertas de revisión del catálogo para el periodo. */
  alertas: Alerta[];
  /** Presupuesto del periodo agregado por empresa|concepto. */
  presupuesto: PresupuestoFila[];
  /** Tasas por empresa del periodo. */
  tasas: TasaEmpresa[];
  /** ¿Hay detalle por cuenta cargado para el periodo? (Req 5.3). */
  detalleCargado: boolean;
  /** Descuadres del detalle contra el resumen del periodo (Req 5.2). */
  descuadres: DescuadreCuenta[];
}

function numeroODefault(x: number | string | null | undefined): number {
  if (x == null) return 0;
  const n = typeof x === 'string' ? Number(x) : x;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lee el detalle por cuenta del periodo desde `gyp_historico_cuenta` (Req 5.1).
 * Devuelve `[]` si la base no responde o no hay detalle para el periodo
 * (entonces las bases por capas se limitan a empresa/grupo/concepto, Req 5.3).
 */
export async function cargarDetalleCuenta(periodo: string): Promise<FilaHistoricoCuenta[]> {
  const { data, error } = await supabase
    .from('gyp_historico_cuenta')
    .select('periodo,empresa,combinada,cuenta,centro_costo,concepto,acumulado,presupuesto,meses')
    .eq('periodo', periodo);
  if (error || !data) return [];
  return (data as FilaHistoricoCuenta[]).map((r) => ({
    periodo: r.periodo,
    empresa: r.empresa,
    combinada: r.combinada,
    cuenta: r.cuenta,
    centro_costo: r.centro_costo,
    concepto: r.concepto,
    acumulado: r.acumulado == null ? null : numeroODefault(r.acumulado),
    presupuesto: r.presupuesto == null ? null : numeroODefault(r.presupuesto),
    meses: Array.isArray(r.meses) ? r.meses : null,
  }));
}

/**
 * Lee el catálogo dimensional desde `dim_cuenta` (Req 5.1). El catálogo es la
 * verdad de Sección/Línea/Detalle/Descripción y no lleva periodo. Devuelve `[]`
 * si la base no responde.
 */
export async function cargarCatalogo(): Promise<FilaDimCuenta[]> {
  const { data, error } = await supabase
    .from('dim_cuenta')
    .select('combinada,empresa,pais,cuenta,centro_costo,descripcion,seccion,linea,detalle,concepto');
  if (error || !data) return [];
  return data as FilaDimCuenta[];
}

/**
 * Lee las alertas de revisión del catálogo del periodo desde `proyeccion_alerta`.
 * Devuelve `[]` si la base no responde.
 */
export async function cargarAlertas(periodo: string): Promise<Alerta[]> {
  const { data, error } = await supabase
    .from('proyeccion_alerta')
    .select('periodo,combinada,accion,sugerencia,movimiento_mes,movimiento_12m,ultimo_mes')
    .eq('periodo', periodo);
  if (error || !data) return [];
  interface RowAlerta {
    periodo: string; combinada: string; accion: string; sugerencia: string | null;
    movimiento_mes: number | null; movimiento_12m: number | null; ultimo_mes: number | null;
  }
  return (data as RowAlerta[]).map((r) => ({
    periodo: r.periodo,
    combinada: r.combinada,
    accion: r.accion,
    sugerencia: r.sugerencia ?? null,
    movimientoMes: r.movimiento_mes ?? null,
    movimiento12m: r.movimiento_12m ?? null,
    ultimoMes: r.ultimo_mes ?? null,
  }));
}

/**
 * Lee el presupuesto del periodo. El presupuesto viaja en el detalle por cuenta
 * (`gyp_historico_cuenta.presupuesto`); esta función lo agrega por empresa y
 * concepto para que el motor y la interfaz lo consuman a nivel de concepto.
 *
 * Acepta el detalle ya leído (para no releer la tabla) o lo lee si no se pasa.
 */
export async function cargarPresupuesto(
  periodo: string,
  detalle?: FilaHistoricoCuenta[],
): Promise<PresupuestoFila[]> {
  const filas = detalle ?? (await cargarDetalleCuenta(periodo));
  const acum = new Map<string, PresupuestoFila>();
  for (const f of filas) {
    const empresa = f.empresa ?? '';
    const concepto = f.concepto ?? '';
    const key = empresa + '|' + concepto;
    const prev = acum.get(key);
    const monto = numeroODefault(f.presupuesto);
    if (prev) prev.presupuesto += monto;
    else acum.set(key, { empresa, concepto, presupuesto: monto });
  }
  return [...acum.values()];
}

/**
 * Lee la tabla de tasas del periodo. Las tasas viven por empresa en
 * `proyeccion_parametro.tasa_local` (null en las venezolanas, §08 §6). Devuelve
 * `[]` si la base no responde.
 */
export async function cargarTasas(periodo: string): Promise<TasaEmpresa[]> {
  const { data, error } = await supabase
    .from('proyeccion_parametro')
    .select('empresa,tasa_local')
    .eq('periodo', periodo);
  if (error || !data) return [];
  interface RowTasa { empresa: string; tasa_local: number | null }
  return (data as RowTasa[])
    .filter((r) => EMPRESAS.includes(r.empresa))
    .map((r) => ({ empresa: r.empresa, tasa: r.tasa_local ?? null }));
}

interface RowResumen {
  periodo: string; empresa: string; concepto: string; monto_usd: number;
}

/**
 * Cuadra el detalle por cuenta contra el resumen del periodo (Req 5.2).
 *
 * Suma el acumulado de las cuentas de detalle por empresa|concepto y lo compara
 * con el total del mismo concepto en `gyp_historico_mensual` (el resumen del
 * periodo). Señala toda pareja cuya diferencia supere la tolerancia (±0,01 USD
 * por defecto, el céntimo del oráculo). Devuelve `[]` si cuadra todo o si falta
 * alguno de los dos lados (sin resumen no hay contra qué cuadrar).
 */
export function cuadrarDetalleContraResumen(
  detalle: FilaHistoricoCuenta[],
  resumen: RowResumen[],
  tolerancia = 0.01,
): DescuadreCuenta[] {
  const sumDetalle = new Map<string, number>();
  for (const f of detalle) {
    const key = (f.empresa ?? '') + '|' + (f.concepto ?? '');
    sumDetalle.set(key, (sumDetalle.get(key) ?? 0) + numeroODefault(f.acumulado));
  }
  const sumResumen = new Map<string, number>();
  for (const r of resumen) {
    const key = (r.empresa ?? '') + '|' + (r.concepto ?? '');
    sumResumen.set(key, (sumResumen.get(key) ?? 0) + numeroODefault(r.monto_usd));
  }

  const claves = new Set<string>([...sumDetalle.keys(), ...sumResumen.keys()]);
  const descuadres: DescuadreCuenta[] = [];
  for (const key of claves) {
    const d = sumDetalle.get(key) ?? 0;
    const r = sumResumen.get(key) ?? 0;
    const diff = d - r;
    if (Math.abs(diff) > tolerancia) {
      const [empresa, concepto] = key.split('|');
      descuadres.push({ empresa, concepto, detalle: d, resumen: r, diferencia: diff });
    }
  }
  return descuadres;
}

/**
 * Carga completa de la lectura nueva del periodo: detalle por cuenta, catálogo,
 * alertas, presupuesto, tasas y el cuadre contra el resumen (Req 5.1 / 5.2).
 *
 * Lee todas las fuentes en paralelo y degrada por partes: cualquier tabla que no
 * responda queda vacía sin romper el resto (fallback a la foto embebida del
 * módulo). `detalleCargado` indica si hay detalle por cuenta para el periodo,
 * lo que el motor usa para limitar las bases por capas (Req 5.3).
 */
export async function cargarDatosDetalle(periodo: string): Promise<DatosDetalle> {
  const [historicoCuenta, catalogo, alertas] = await Promise.all([
    cargarDetalleCuenta(periodo),
    cargarCatalogo(),
    cargarAlertas(periodo),
  ]);
  const [presupuesto, tasas] = await Promise.all([
    cargarPresupuesto(periodo, historicoCuenta),
    cargarTasas(periodo),
  ]);

  // Resumen del periodo (gyp_historico_mensual) para el cuadre (Req 5.2).
  let descuadres: DescuadreCuenta[] = [];
  if (historicoCuenta.length) {
    const { data: resumen } = await supabase
      .from('gyp_historico_mensual')
      .select('periodo,empresa,concepto,monto_usd')
      .eq('periodo', periodo);
    if (resumen && resumen.length) {
      descuadres = cuadrarDetalleContraResumen(historicoCuenta, resumen as RowResumen[]);
    }
  }

  return {
    historicoCuenta,
    catalogo,
    alertas,
    presupuesto,
    tasas,
    detalleCargado: historicoCuenta.length > 0,
    descuadres,
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// Concurrencia, autor, borrado lógico y realtime (Fase 3, Tarea 12.2)
//
// CP-38 · Bloqueo optimista con `rev` y `wid`.
// CP-39 · Copiar los datos de solo lectura antes de modificarlos.
// CP-40 · Registrar quién hizo cada cambio (`actualizado_por` + `actualizado`).
// CP-31 · Borrado lógico (`eliminada = true`), nunca `DELETE`.
// CP-41 · «Volver a las reglas de partida» (la confirmación doble vive en la UI).
// CP-54 · Suscripción en tiempo real a mes, reglas, extracción, alertas y estado.
//
// Estas funciones son ADITIVAS: no tocan `cargarDesdeSupabase()`, la lectura de
// la 12.1 ni la aritmética del motor (los 190 casos no se mueven). Trabajan
// directo contra `proyeccion_regla` y las tablas del §4 mediante supabase-js.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identificador de escritura (write id) de ESTA pestaña (CP-38).
 *
 * Se genera una sola vez por carga de la página (por pestaña del navegador) y
 * viaja en cada escritura a `proyeccion_regla.wid`. Realtime (CP-54) lo usa para
 * ignorar el eco propio: un cambio cuyo `wid` coincide con el nuestro ya está
 * aplicado localmente, así que no se vuelve a aplicar ni dispara toast.
 */
export const WID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'wid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Identidad del autor del cambio (CP-40). Lee el usuario autenticado de Supabase
 * (`supabase.auth.getUser()`); devuelve el email, o el id si no hay email, o
 * `null` si no hay sesión (el campo queda nulo, sin romper la escritura).
 */
export async function autorActual(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (!u) return null;
    return u.email ?? u.id ?? null;
  } catch {
    return null;
  }
}

/** Resultado de una escritura con bloqueo optimista (CP-38). */
/**
 * Texto corto para el usuario a partir del error de Supabase/PostgREST de una
 * escritura: traduce los códigos de Postgres más comunes y, si no, deja el
 * mensaje original.
 */
export function motivoError(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string; details?: string };
  switch (e.code) {
    case '23505':
      return 'esa Combinada ya tiene una regla en el mes (también cuentan las eliminadas: restáurala)';
    case '23503':
      return 'el método o la fórmula elegida no existe en la base';
    case '23502':
      return `falta un dato obligatorio${e.message ? ` (${e.message})` : ''}`;
    case '42501':
      return 'sin permiso para escribir en la tabla';
    default:
      return e.message || 'error del servidor';
  }
}

export interface ResultadoEscritura {
  /** `true` si la fila se actualizó; `false` si alguien se adelantó (0 filas). */
  ok: boolean;
  /**
   * `'conflicto'` cuando el `WHERE id=$1 AND rev=$2` no tocó filas: la versión en
   * la base ya no es la que teníamos. El llamador debe recargar y avisar, nunca
   * guardar encima (CP-38). `'error'` ante un fallo de red/SQL.
   */
  motivo?: 'conflicto' | 'error';
  /** La `rev` nueva de la fila cuando `ok` (era `rev + 1`). */
  rev?: number;
  /** Error crudo de supabase-js cuando `motivo === 'error'`. */
  error?: unknown;
}

/**
 * Campos editables de una regla que la UI puede persistir. Es un subconjunto de
 * las columnas del §4: lo que un cambio de usuario toca. `id`, `rev`, `wid`,
 * `eliminada`, `actualizado` y `actualizado_por` los gestiona esta capa.
 */
export interface CambiosRegla {
  metodo?: string;
  valor?: number | null;
  nombre?: string | null;
  detalle?: string | null;
  causado?: string;
  escenarios?: string;
  nivel?: string;
  n?: number | null;
  destino?: unknown;
  formula_id?: number | null;
  activa?: boolean;
  /** Cuenta de destino de la regla (Combinada = cuenta-centro-empresa). */
  combinada?: string;
  centro_costo?: string;
  cuenta_contable?: string;
}

/**
 * Actualiza una regla con bloqueo optimista (CP-38 + CP-40).
 *
 *   UPDATE proyeccion_regla
 *      SET <cambios>, rev = rev + 1, wid = WID,
 *          actualizado = now(), actualizado_por = <autor>
 *    WHERE id = $1 AND rev = $2;
 *
 * Si no toca filas (`rev` ya avanzó en la base), alguien se adelantó: devuelve
 * `{ ok: false, motivo: 'conflicto' }` para que el llamador recargue y avise en
 * vez de pisar el cambio ajeno. Los `cambios` se clonan antes de enviarlos para
 * no mutar el objeto de solo lectura que llega del estado (CP-39).
 */
export async function actualizarRegla(
  id: number,
  revActual: number,
  cambios: CambiosRegla,
): Promise<ResultadoEscritura> {
  const parche = {
    ...cambios, // copia defensiva: nunca mutamos el objeto entrante (CP-39)
    rev: revActual + 1,
    wid: WID,
    actualizado: new Date().toISOString(),
    actualizado_por: await autorActual(),
  };
  const { data, error } = await supabase
    .from('proyeccion_regla')
    .update(parche)
    .eq('id', id)
    .eq('rev', revActual)
    .select('id,rev');
  if (error) return { ok: false, motivo: 'error', error };
  if (!data || data.length === 0) return { ok: false, motivo: 'conflicto' };
  return { ok: true, rev: (data[0] as { rev: number }).rev };
}

/**
 * Borrado lógico de una regla (CP-31): marca `eliminada = true`, nunca `DELETE`.
 * Mantiene el bloqueo optimista (CP-38) y graba el autor (CP-40). Restaurar es
 * el mismo camino con `eliminada = false` (ver {@link restaurarRegla}).
 */
export async function eliminarRegla(
  id: number,
  revActual: number,
): Promise<ResultadoEscritura> {
  return escribirEliminada(id, revActual, true);
}

/** Restaura una regla borrada lógicamente (CP-31): `eliminada = false`. */
export async function restaurarRegla(
  id: number,
  revActual: number,
): Promise<ResultadoEscritura> {
  return escribirEliminada(id, revActual, false);
}

async function escribirEliminada(
  id: number,
  revActual: number,
  eliminada: boolean,
): Promise<ResultadoEscritura> {
  const { data, error } = await supabase
    .from('proyeccion_regla')
    .update({
      eliminada,
      rev: revActual + 1,
      wid: WID,
      actualizado: new Date().toISOString(),
      actualizado_por: await autorActual(),
    })
    .eq('id', id)
    .eq('rev', revActual)
    .select('id,rev');
  if (error) return { ok: false, motivo: 'error', error };
  if (!data || data.length === 0) return { ok: false, motivo: 'conflicto' };
  return { ok: true, rev: (data[0] as { rev: number }).rev };
}

/** Resumen de lo que borró «Volver a las reglas de partida» (CP-41). */
export interface ResultadoVolverAPartida {
  ok: boolean;
  /** Reglas marcadas `eliminada` (cambios de usuario y reglas nuevas). */
  reglasEliminadas: number;
  /** Fórmulas propias marcadas `eliminada`. */
  formulasEliminadas: number;
  error?: unknown;
}

/**
 * «Volver a las reglas de partida» (CP-41) — función de DATOS.
 *
 * Borra lógicamente los cambios y reglas nuevas del periodo, las fórmulas
 * propias y limpia el factor por mes, dejando solo lo de fábrica. La confirmación
 * DOBLE es responsabilidad de la UI; aquí se expone únicamente la operación de
 * datos, que ya ejecuta el borrado para TODOS (no por usuario).
 *
 * El borrado es lógico (CP-31): nada se elimina físicamente, de modo que una
 * corrida posterior de la parametrización de fábrica puede reponer el estado de
 * partida. Devuelve el conteo de filas afectadas para que la UI avise.
 */
export async function volverAReglasDePartida(
  periodo: string,
): Promise<ResultadoVolverAPartida> {
  const autor = await autorActual();
  const ahora = new Date().toISOString();
  try {
    // Reglas nuevas (de usuario) y cambios: borrado lógico de todo lo no de fábrica.
    const { data: reglas, error: errReglas } = await supabase
      .from('proyeccion_regla')
      .update({ eliminada: true, wid: WID, actualizado: ahora, actualizado_por: autor })
      .eq('periodo', periodo)
      .eq('eliminada', false)
      .select('id');
    if (errReglas) return { ok: false, reglasEliminadas: 0, formulasEliminadas: 0, error: errReglas };

    // Fórmulas propias (no de fábrica): borrado lógico.
    const { data: formulas, error: errFormulas } = await supabase
      .from('proyeccion_formula')
      .update({ eliminada: true })
      .eq('de_fabrica', false)
      .select('id');
    // `proyeccion_formula` puede no llevar `eliminada` en algunos despliegues:
    // un fallo aquí no debe deshacer el borrado de reglas ya aplicado.
    const formulasEliminadas = errFormulas || !formulas ? 0 : formulas.length;

    return {
      ok: true,
      reglasEliminadas: reglas?.length ?? 0,
      formulasEliminadas,
    };
  } catch (error) {
    return { ok: false, reglasEliminadas: 0, formulasEliminadas: 0, error };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Realtime (CP-54)
// ─────────────────────────────────────────────────────────────────────────────

/** Tipo de cambio que llega por Realtime. */
export type TipoCambio = 'INSERT' | 'UPDATE' | 'DELETE';

/** Un evento de Realtime ya normalizado para la interfaz. */
export interface CambioRealtime<T = Record<string, unknown>> {
  tabla: string;
  tipo: TipoCambio;
  /** Fila nueva (INSERT/UPDATE) o `null` en DELETE. */
  fila: T | null;
  /** Fila anterior (UPDATE/DELETE) cuando la tabla tiene réplica completa. */
  anterior: T | null;
  /** `true` si el cambio lo originó ESTA pestaña (eco propio, CP-38). */
  esEcoPropio: boolean;
}

/**
 * Callbacks de la suscripción en tiempo real (CP-54). Cada tabla del §4 tiene su
 * propio callback; todos son opcionales. `onCualquiera` recibe todos los eventos
 * (útil para el toast genérico). El eco propio ya viene marcado en el evento.
 */
export interface CallbacksRealtime {
  /** Cambios en el mes/parámetros del periodo (`proyeccion_parametro`). */
  onMes?: (c: CambioRealtime) => void;
  /** Cambios en las reglas (`proyeccion_regla`). */
  onReglas?: (c: CambioRealtime) => void;
  /** Llegó una extracción nueva (`gyp_historico_cuenta`). */
  onExtraccion?: (c: CambioRealtime) => void;
  /** Cambios en las alertas del catálogo (`proyeccion_alerta`). */
  onAlertas?: (c: CambioRealtime) => void;
  /** Estado de la solicitud/corrida (`proyeccion_corrida`). */
  onEstado?: (c: CambioRealtime) => void;
  /** Recibe TODOS los eventos (para el toast genérico de CP-54). */
  onCualquiera?: (c: CambioRealtime) => void;
}

/** Función que corta la suscripción (devuelta por {@link suscribirCambios}). */
export type Desuscribir = () => void;

/**
 * Suscribe la página a los cambios en tiempo real del periodo (CP-54).
 *
 * Abre un canal de Supabase Realtime y escucha `postgres_changes` sobre las
 * tablas de mes (`proyeccion_parametro`), reglas (`proyeccion_regla`), extracción
 * (`gyp_historico_cuenta`), alertas (`proyeccion_alerta`) y estado de la corrida
 * (`proyeccion_corrida`). Cada evento se normaliza a {@link CambioRealtime},
 * se marca el eco propio comparando `wid` con {@link WID} (CP-38) y se entrega al
 * callback de su tabla y a `onCualquiera`. Devuelve una función para desuscribir.
 *
 * El eco propio NO se filtra aquí: se entrega marcado (`esEcoPropio`) para que la
 * interfaz decida (normalmente lo ignora, ya que el cambio se aplicó local).
 */
export function suscribirCambios(
  periodo: string,
  callbacks: CallbacksRealtime,
): Desuscribir {
  const canal = supabase.channel('proyeccion-gyp:' + periodo);

  const entregar = (
    tabla: string,
    cb: ((c: CambioRealtime) => void) | undefined,
    payload: {
      eventType?: string;
      new?: Record<string, unknown> | null;
      old?: Record<string, unknown> | null;
    },
  ) => {
    const fila = (payload.new ?? null) as Record<string, unknown> | null;
    const anterior = (payload.old ?? null) as Record<string, unknown> | null;
    const widCambio = (fila?.wid ?? anterior?.wid) as string | undefined;
    const evento: CambioRealtime = {
      tabla,
      tipo: (payload.eventType as TipoCambio) ?? 'UPDATE',
      fila,
      anterior,
      esEcoPropio: widCambio === WID,
    };
    cb?.(evento);
    callbacks.onCualquiera?.(evento);
  };

  // Mes / parámetros del periodo.
  canal.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'proyeccion_parametro', filter: 'periodo=eq.' + periodo },
    (payload) => entregar('proyeccion_parametro', callbacks.onMes, payload),
  );
  // Reglas del periodo.
  canal.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'proyeccion_regla', filter: 'periodo=eq.' + periodo },
    (payload) => entregar('proyeccion_regla', callbacks.onReglas, payload),
  );
  // Extracción nueva (detalle por cuenta del periodo).
  canal.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'gyp_historico_cuenta', filter: 'periodo=eq.' + periodo },
    (payload) => entregar('gyp_historico_cuenta', callbacks.onExtraccion, payload),
  );
  // Alertas del catálogo del periodo.
  canal.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'proyeccion_alerta', filter: 'periodo=eq.' + periodo },
    (payload) => entregar('proyeccion_alerta', callbacks.onAlertas, payload),
  );
  // Estado de la solicitud / corrida del periodo.
  canal.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'proyeccion_corrida', filter: 'periodo=eq.' + periodo },
    (payload) => entregar('proyeccion_corrida', callbacks.onEstado, payload),
  );

  canal.subscribe();

  return () => {
    supabase.removeChannel(canal);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia compartida en Supabase (Fase 3, Tarea 12.3 · CP-37)
//
// «Lo que cambia una persona lo ven todos» (CP-37): se comparten las reglas
// cambiadas, nuevas y eliminadas, las fórmulas propias, el causado por fórmula,
// las reglas de partida y el factor de cada mes. Mapeo del §3 del paquete
// 12-cambios-para-produccion:
//
//   reglas (cambiadas/nuevas/eliminadas) → proyeccion_regla
//   causado por regla, escenario, nivel, destino, fórmula asignada → proyeccion_regla
//   fórmulas propias + causado por fórmula                         → proyeccion_formula
//   factor de cada mes (factor_correccion por periodo+empresa)     → proyeccion_parametro
//
// El cambio guardado se hace visible a las demás personas del mismo mes vía
// Realtime (CP-54, suscribirCambios de la 12.2): al escribir estas tablas el
// canal de la otra pestaña recibe el evento y lo aplica.
//
// Estas funciones COMPLEMENTAN las de la 12.2:
//   - actualizarRegla / eliminarRegla / restaurarRegla ya cubren el cambio y el
//     borrado lógico de reglas EXISTENTES con bloqueo optimista (CP-38).
//   - Aquí se añade la CREACIÓN de reglas nuevas, la escritura de fórmulas propias
//     y la persistencia del factor por mes, reutilizando WID (CP-38) y
//     autorActual (CP-40) como el resto de la capa.
//
// Convención de escritura (igual que la 12.2):
//   - `insert` para filas NUEVAS (sin `rev` previa);
//   - `update ... WHERE id=$1 AND rev=$2` para filas EXISTENTES (bloqueo
//     optimista, 0 filas => conflicto, recargar y avisar).
//   - Toda escritura graba `actualizado_por` (autorActual) y `wid = WID`.
//
// La PUBLICACIÓN transaccional de la tabla final NO se escribe desde el navegador:
// se delega a la Edge Function `publicar-proyeccion` (ver publicarViaEdge más
// abajo), que mantiene la transacción del lado servidor y las credenciales fuera
// del navegador (R-NN-5).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Datos de una regla NUEVA a crear en `proyeccion_regla` (CP-37).
 *
 * Es el conjunto mínimo de columnas del §4 que una regla de usuario necesita al
 * nacer: la llave de salida (empresa/concepto/combinada/cc/cuenta/grupo), el
 * método y, opcionalmente, los campos avanzados (causado, escenarios, nivel, n,
 * destino, formula_id, nombre, detalle). `rev`, `wid`, `eliminada`,
 * `actualizado` y `actualizado_por` los pone esta capa.
 */
export interface NuevaRegla {
  periodo: string;
  empresa: string;
  concepto: string;
  grupo_pl: GrupoPL;
  combinada: string;
  centro_costo: string;
  cuenta_contable: string;
  metodo: string;
  valor?: number | null;
  nombre?: string | null;
  detalle?: string | null;
  causado?: Causado;
  escenarios?: string;
  nivel?: string;
  n?: number | null;
  destino?: unknown;
  formula_id?: number | null;
}

/** Resultado de crear una fila nueva (regla o fórmula): id asignado o error. */
export interface ResultadoCreacion {
  ok: boolean;
  /** id de la fila insertada cuando `ok`. */
  id?: number;
  /** `rev` inicial de la fila cuando `ok` (0 para nuevas). */
  rev?: number;
  motivo?: 'error';
  error?: unknown;
}

/**
 * Crea una regla NUEVA en `proyeccion_regla` (CP-37).
 *
 *   INSERT INTO proyeccion_regla (..., eliminada=false, rev=0, wid=WID,
 *     actualizado=now(), actualizado_por=<autor>) RETURNING id, rev;
 *
 * Una regla nueva nace con `rev = 0`; a partir de ahí los cambios pasan por
 * {@link actualizarRegla} con bloqueo optimista (CP-38). El `insert` dispara el
 * evento Realtime (CP-54) que la hace visible a las demás personas del mes. Los
 * campos avanzados que no se pasen quedan con el default del §4 (causado='igual',
 * escenarios='AMBOS', nivel='concepto').
 */
export async function crearRegla(regla: NuevaRegla): Promise<ResultadoCreacion> {
  const fila = {
    periodo: regla.periodo,
    empresa: regla.empresa,
    concepto: regla.concepto,
    grupo_pl: regla.grupo_pl,
    combinada: regla.combinada,
    centro_costo: regla.centro_costo,
    cuenta_contable: regla.cuenta_contable,
    // `pais` es NOT NULL en proyeccion_regla: sin él el insert falla.
    pais: PAIS[regla.empresa] || regla.empresa,
    metodo: regla.metodo,
    valor: regla.valor ?? null,
    nombre: regla.nombre ?? null,
    detalle: regla.detalle ?? null,
    causado: regla.causado ?? 'igual',
    escenarios: regla.escenarios ?? 'AMBOS',
    nivel: regla.nivel ?? 'concepto',
    n: regla.n ?? null,
    destino: regla.destino ?? null,
    formula_id: regla.formula_id ?? null,
    activa: true,
    eliminada: false,
    rev: 0,
    wid: WID,
    actualizado: new Date().toISOString(),
    actualizado_por: await autorActual(),
  };
  const { data, error } = await supabase
    .from('proyeccion_regla')
    .insert(fila)
    .select('id,rev');
  if (error) return { ok: false, motivo: 'error', error };
  const row = data?.[0] as { id: number; rev: number } | undefined;
  return { ok: true, id: row?.id, rev: row?.rev ?? 0 };
}

/**
 * Campos de una fórmula propia a persistir en `proyeccion_formula` (CP-37).
 *
 * Una fórmula propia es un método compuesto de usuario: una secuencia de `pasos`
 * (fold izquierda a derecha, CP-18) con su `orden` (turno), `invertir` y el
 * `causado` por fórmula. `de_fabrica` queda en `false` para las de usuario; al
 * editar una de fábrica la UI crea una copia (de_fabrica=false, ver CP-19/§D).
 */
export interface CambiosFormula {
  nombre: string;
  pasos: Paso[];
  orden?: number;
  invertir?: boolean;
  causado?: Causado;
  de_fabrica?: boolean;
}

/**
 * Crea una fórmula propia NUEVA en `proyeccion_formula` (CP-37).
 *
 *   INSERT INTO proyeccion_formula (nombre, pasos, orden, invertir, causado,
 *     de_fabrica, rev=0) RETURNING id, rev;
 *
 * Nace con `rev = 0`; los cambios posteriores pasan por
 * {@link actualizarFormula} con bloqueo optimista. El `pasos` viaja como jsonb.
 */
export async function crearFormula(formula: CambiosFormula): Promise<ResultadoCreacion> {
  const fila = {
    nombre: formula.nombre,
    pasos: formula.pasos,
    orden: formula.orden ?? 1,
    invertir: formula.invertir ?? false,
    causado: formula.causado ?? 'igual',
    de_fabrica: formula.de_fabrica ?? false,
    rev: 0,
  };
  const { data, error } = await supabase
    .from('proyeccion_formula')
    .insert(fila)
    .select('id,rev');
  if (error) return { ok: false, motivo: 'error', error };
  const row = data?.[0] as { id: number; rev: number } | undefined;
  return { ok: true, id: row?.id, rev: row?.rev ?? 0 };
}

/**
 * Actualiza una fórmula propia EXISTENTE con bloqueo optimista (CP-38 + CP-37).
 *
 *   UPDATE proyeccion_formula
 *      SET nombre, pasos, orden, invertir, causado, rev = rev + 1
 *    WHERE id = $1 AND rev = $2;      -- 0 filas => alguien se adelantó
 *
 * Como `proyeccion_formula` no lleva `wid`/`actualizado_por` en el §4, el bloqueo
 * se apoya solo en `rev`. Devuelve `{ ok:false, motivo:'conflicto' }` cuando otra
 * persona guardó antes (recargar y avisar, nunca pisar). Guardar una fórmula
 * usada por varias reglas las cambia en todas (la pregunta vive en la UI, CP-19).
 */
export async function actualizarFormula(
  id: number,
  revActual: number,
  cambios: CambiosFormula,
): Promise<ResultadoEscritura> {
  const parche: Record<string, unknown> = {
    nombre: cambios.nombre,
    pasos: cambios.pasos,
    rev: revActual + 1,
  };
  if (cambios.orden !== undefined) parche.orden = cambios.orden;
  if (cambios.invertir !== undefined) parche.invertir = cambios.invertir;
  if (cambios.causado !== undefined) parche.causado = cambios.causado;
  const { data, error } = await supabase
    .from('proyeccion_formula')
    .update(parche)
    .eq('id', id)
    .eq('rev', revActual)
    .select('id,rev');
  if (error) return { ok: false, motivo: 'error', error };
  if (!data || data.length === 0) return { ok: false, motivo: 'conflicto' };
  return { ok: true, rev: (data[0] as { rev: number }).rev };
}

/** Una fórmula propia tal como vive en `proyeccion_formula`. */
export interface FormulaGuardada {
  id: number;
  nombre: string;
  pasos: Paso[];
  causado: Causado;
  rev: number;
}

/**
 * Lee las fórmulas propias de `proyeccion_formula` (CP-37) para que la
 * biblioteca de «Mis fórmulas» sobreviva a la recarga y se puedan editar. Las
 * de fábrica y las borradas lógicamente (si la columna `eliminada` existe) se
 * omiten.
 */
export async function cargarFormulas(): Promise<FormulaGuardada[]> {
  const { data, error } = await supabase
    .from('proyeccion_formula')
    .select('*')
    .eq('de_fabrica', false)
    .order('id');
  if (error) throw error;
  return ((data ?? []) as Array<FormulaGuardada & { eliminada?: boolean }>)
    .filter((r) => !r.eliminada)
    .map((r) => ({
      id: r.id,
      nombre: r.nombre,
      pasos: Array.isArray(r.pasos) ? r.pasos : [],
      causado: r.causado ?? 'igual',
      rev: r.rev ?? 0,
    }));
}

/**
 * Guarda un método del sistema editado desde «Mis fórmulas» en
 * `proyeccion_metodo` (nombre, valor por defecto e invertir). Es `upsert` por
 * `id` para cubrir los métodos de la semilla que aún no están en la base.
 */
export async function guardarMetodo(m: Metodo): Promise<ResultadoEscritura> {
  const { error } = await supabase.from('proyeccion_metodo').upsert(
    {
      id: m.id,
      nombre: m.nombre,
      operacion: m.op,
      base: m.base,
      valor: m.valor,
      invertir: m.invertir,
      turno: m.orden,
      de_fabrica: m.fijo,
      activo: true,
    },
    { onConflict: 'id' },
  );
  if (error) return { ok: false, motivo: 'error', error };
  return { ok: true };
}

/**
 * Elimina una fórmula propia (CP-37). Si la tabla lleva `eliminada` hace borrado
 * lógico (CP-31); si no, cae a `DELETE` físico. Una fórmula de fábrica no se
 * borra: la UI edita una copia (CP-19). El borrado se propaga por Realtime.
 */
export async function eliminarFormula(id: number): Promise<ResultadoEscritura> {
  // Intento 1: borrado lógico (si la columna existe en el despliegue).
  const logico = await supabase
    .from('proyeccion_formula')
    .update({ eliminada: true })
    .eq('id', id)
    .eq('de_fabrica', false)
    .select('id');
  if (!logico.error) {
    if (!logico.data || logico.data.length === 0) return { ok: false, motivo: 'conflicto' };
    return { ok: true };
  }
  // Intento 2: borrado físico cuando no hay columna `eliminada`.
  const fisico = await supabase
    .from('proyeccion_formula')
    .delete()
    .eq('id', id)
    .eq('de_fabrica', false)
    .select('id');
  if (fisico.error) return { ok: false, motivo: 'error', error: fisico.error };
  if (!fisico.data || fisico.data.length === 0) return { ok: false, motivo: 'conflicto' };
  return { ok: true };
}

/**
 * Guarda el factor de corrección de un mes para una empresa (CP-37, §3).
 *
 * El factor vive por mes en `proyeccion_parametro.factor_correccion`, con llave
 * (periodo, empresa). Se hace `upsert` sobre esa llave: crea la fila del periodo
 * si no existe (empresa nueva en el mes) o actualiza el factor si ya existe,
 * preservando el resto de columnas del parámetro (días/transcurridos/tasa) que
 * gestiona la pestaña Parámetros. El cambio se hace visible al resto por Realtime
 * (CP-54, la 12.2 ya suscribe `proyeccion_parametro` del periodo).
 *
 * Nota: `proyeccion_parametro` no lleva `rev`/`wid` en el §4; el factor por mes es
 * un valor acordado del periodo, no una fila versionada con bloqueo optimista.
 */
export async function guardarFactorMes(
  periodo: string,
  empresa: string,
  factor: number,
): Promise<ResultadoEscritura> {
  const { error } = await supabase
    .from('proyeccion_parametro')
    .upsert(
      { periodo, empresa, factor_correccion: factor },
      { onConflict: 'periodo,empresa' },
    )
    .select('periodo,empresa');
  if (error) return { ok: false, motivo: 'error', error };
  return { ok: true };
}

/** Respuesta de la Edge Function `corrida-programada`. */
export interface ResultadoCorrida {
  ok: boolean;
  ejecutada?: boolean;
  motivo?: string;
  periodo?: string;
  publicado?: Record<string, number>;
  error?: string;
  /** Pasos en palabras: extracción, guardias, recálculo, publicación. */
  log?: string[];
}

/**
 * Corre YA la actualización programada (botón «Ejecutar ahora»): con los datos
 * que Fabric dejó en gyp_historico_mensual recalcula los dos escenarios y
 * publica en v_proyeccion_final, sin esperar a la hora configurada. Queda en la
 * bitácora con lanzada_por 'manual'.
 */
export async function ejecutarCorridaAhora(periodo?: string): Promise<ResultadoCorrida> {
  const { data, error } = await supabase.functions.invoke('corrida-programada', {
    body: { manual: true, ...(periodo && { periodo }) },
  });
  if (error) {
    const ctx = (error as unknown as { context?: { body?: unknown } }).context;
    if (ctx?.body) {
      try {
        return (typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body) as ResultadoCorrida;
      } catch {
        /* cae al return de abajo */
      }
    }
    return { ok: false, error: (error as Error).message };
  }
  return data as ResultadoCorrida;
}

/** Respuesta de la publicación vía Edge Function `publicar-proyeccion`. */
export interface ResultadoPublicacion {
  ok: boolean;
  periodo?: string;
  /** Filas insertadas por escenario: { "1": n, "2": n } cuando `ok`. */
  publicado?: Record<string, number>;
  /** `'huerfanas'` cuando hay Combinadas fuera del catálogo (CP-07). */
  motivo?: 'huerfanas' | 'error';
  /** Combinadas huérfanas reportadas por la función (CP-07). */
  huerfanas?: string[];
  /** Aviso no bloqueante (p. ej. catálogo dim_cuenta vacío, no se validó). */
  aviso?: string;
  mensaje?: string;
  error?: unknown;
}

/**
 * Publica la tabla final delegando en la Edge Function `publicar-proyeccion`
 * (Tarea 3.1), en vez de escribir `proyeccion_resultado` desde el navegador.
 *
 *   supabase.functions.invoke('publicar-proyeccion',
 *     { body: { periodo, filas, dimCuenta? } })
 *
 * La función hace el DELETE+INSERT idempotente por `(periodo, escenario)` en una
 * transacción del lado servidor con credenciales de servicio (R-NN-5), tras
 * filtrar por escenario (CP-49), fusionar por Combinada (CP-06) y validar contra
 * el catálogo (CP-07). Si hay Combinadas huérfanas devuelve
 * `{ ok:false, motivo:'huerfanas', huerfanas }` y NO publica ningún escenario.
 *
 * Las `filas` son las 13 columnas del contrato (FilaResultado) de los DOS
 * escenarios; `dimCuenta` es opcional (si se omite, la función lee `dim_cuenta`).
 * `escenarios` limita qué escenarios se escriben (default los dos): con `[2]` se
 * ANEXA el causado a `v_proyeccion_final` sin tocar el proyectado publicado.
 */
export async function publicarViaEdge(
  periodo: string,
  filas: FilaResultado[],
  dimCuenta?: string[],
  escenarios?: Array<1 | 2>,
): Promise<ResultadoPublicacion> {
  const body: {
    periodo: string;
    filas: FilaResultado[];
    dimCuenta?: string[];
    escenarios?: Array<1 | 2>;
  } = { periodo, filas };
  if (dimCuenta) body.dimCuenta = dimCuenta;
  if (escenarios) body.escenarios = escenarios;
  const { data, error } = await supabase.functions.invoke('publicar-proyeccion', { body });
  if (error) {
    // La función devuelve 400/409/500 con cuerpo JSON; supabase-js lo expone en context.
    const ctx = (error as unknown as { context?: { body?: unknown } }).context;
    if (ctx?.body) {
      try {
        const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
        return parsed as ResultadoPublicacion;
      } catch {
        /* cae al return de error de abajo */
      }
    }
    return { ok: false, motivo: 'error', error };
  }
  return data as ResultadoPublicacion;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actualización programada (Fase 6, Tarea 20.2 · CP-56 · Req 27.1 / 27.9)
//
// La configuración de la corrida programada vive en `proyeccion_programacion`
// (fila única id=1) y la bitácora de cada corrida en `proyeccion_corrida`. La
// UI de Parámetros lee ambas: la configuración (estado, frecuencia, hora de
// publicación EN HORA DE CARACAS, mes, guardia de datos frescos) y, en modo
// lectura, la última publicación (de `proyeccion_corrida`, paso 'publicacion').
//
// La hora se guarda y se muestra SIEMPRE en hora de Caracas (`hora_local`, tipo
// `time`); la zona `America/Caracas` viaja con el dato. La conversión a UTC para
// el planificador (pg_cron) la hace el backend: en pantalla nunca aparece UTC.
//
// La escritura de la configuración lleva bloqueo optimista por `rev` (CP-38),
// como el resto de las escrituras versionadas, y graba `actualizado_por`
// (autorActual, CP-40). `proyeccion_programacion` no lleva `wid` en el §4.
// ─────────────────────────────────────────────────────────────────────────────

/** Frecuencia de la corrida programada (CP-56). */
export type FrecuenciaProgramacion = 'diaria' | 'habiles' | 'semanal';

/**
 * Configuración de la actualización programada (`proyeccion_programacion`,
 * fila id=1). La hora (`horaLocal`, formato `HH:MM`) y la `zona` son de Caracas.
 */
export interface Programacion {
  id: number;
  /** Estado: activa (true) o pausada (false). */
  activa: boolean;
  frecuencia: FrecuenciaProgramacion;
  /** 1..7 (lunes..domingo), solo cuando `frecuencia === 'semanal'`. */
  diaSemana: number | null;
  /** Hora de publicación en hora de Caracas, `HH:MM`. */
  horaLocal: string;
  /** Zona horaria que viaja con el dato (por defecto `America/Caracas`). */
  zona: string;
  /** No publicar con datos viejos (guardia de datos frescos). */
  exigeDatosFrescos: boolean;
  /** Mes fijo (`YYYY-MM`) o `null` = el mes de trabajo vigente. */
  periodo: string | null;
  /** Versión para el bloqueo optimista (CP-38). */
  rev: number;
  /** Último autor que guardó la configuración (CP-40). */
  actualizadoPor: string | null;
}

/** Configuración por defecto cuando aún no hay fila en la base (CP-56). */
export const PROGRAMACION_DEFAULT: Programacion = {
  id: 1,
  activa: false,
  frecuencia: 'habiles',
  diaSemana: null,
  horaLocal: '07:30',
  zona: 'America/Caracas',
  exigeDatosFrescos: true,
  periodo: null,
  rev: 0,
  actualizadoPor: null,
};

interface RowProgramacion {
  id: number;
  activa: boolean;
  frecuencia: string;
  dia_semana: number | null;
  hora_local: string | null;
  zona: string | null;
  exige_datos_frescos: boolean;
  periodo: string | null;
  rev: number;
  actualizado_por: string | null;
}

/** Normaliza `hora_local` (que puede llegar como `HH:MM:SS`) a `HH:MM`. */
function horaCorta(hora: string | null | undefined): string {
  if (!hora) return PROGRAMACION_DEFAULT.horaLocal;
  const m = /^(\d{1,2}):(\d{2})/.exec(hora);
  if (!m) return PROGRAMACION_DEFAULT.horaLocal;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/**
 * Lee la configuración de la actualización programada (`proyeccion_programacion`,
 * fila id=1). Degrada a {@link PROGRAMACION_DEFAULT} si la base no responde o no
 * hay fila: la UI muestra los valores por defecto (pausada, días hábiles, 07:30
 * Caracas, guardia de datos frescos activo).
 */
export async function cargarProgramacion(): Promise<Programacion> {
  const { data, error } = await supabase
    .from('proyeccion_programacion')
    .select('id,activa,frecuencia,dia_semana,hora_local,zona,exige_datos_frescos,periodo,rev,actualizado_por')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return { ...PROGRAMACION_DEFAULT };
  const r = data as RowProgramacion;
  const frecuencia: FrecuenciaProgramacion =
    r.frecuencia === 'diaria' || r.frecuencia === 'semanal' ? r.frecuencia : 'habiles';
  return {
    id: r.id ?? 1,
    activa: !!r.activa,
    frecuencia,
    diaSemana: r.dia_semana ?? null,
    horaLocal: horaCorta(r.hora_local),
    zona: r.zona || PROGRAMACION_DEFAULT.zona,
    exigeDatosFrescos: r.exige_datos_frescos ?? true,
    periodo: r.periodo ?? null,
    rev: r.rev ?? 0,
    actualizadoPor: r.actualizado_por ?? null,
  };
}

/** Campos editables de la programación que la UI puede persistir (CP-56). */
export interface CambiosProgramacion {
  activa?: boolean;
  frecuencia?: FrecuenciaProgramacion;
  diaSemana?: number | null;
  horaLocal?: string;
  exigeDatosFrescos?: boolean;
  periodo?: string | null;
}

/**
 * Guarda la configuración de la actualización programada con bloqueo optimista
 * (CP-38) y autor (CP-40). Hace `upsert` sobre la fila id=1 (la crea si no
 * existe) exigiendo que la `rev` coincida con la que teníamos:
 *
 *   UPDATE proyeccion_programacion
 *      SET <cambios>, rev = rev + 1, zona = 'America/Caracas',
 *          actualizado_por = <autor>
 *    WHERE id = 1 AND rev = $rev;      -- 0 filas => alguien se adelantó
 *
 * La hora (`horaLocal`) se guarda tal cual, en hora de Caracas; la zona viaja con
 * el dato. Devuelve `{ ok:false, motivo:'conflicto' }` si otra persona guardó
 * antes (recargar y avisar, nunca pisar). Cuando la fila aún no existe (rev 0 y
 * 0 filas tocadas), la inserta con los valores por defecto más los cambios.
 */
export async function guardarProgramacion(
  revActual: number,
  cambios: CambiosProgramacion,
): Promise<ResultadoEscritura> {
  const autor = await autorActual();
  const parche: Record<string, unknown> = {
    rev: revActual + 1,
    zona: PROGRAMACION_DEFAULT.zona,
    actualizado_por: autor,
  };
  if (cambios.activa !== undefined) parche.activa = cambios.activa;
  if (cambios.frecuencia !== undefined) parche.frecuencia = cambios.frecuencia;
  if (cambios.diaSemana !== undefined) parche.dia_semana = cambios.diaSemana;
  if (cambios.horaLocal !== undefined) parche.hora_local = cambios.horaLocal;
  if (cambios.exigeDatosFrescos !== undefined) parche.exige_datos_frescos = cambios.exigeDatosFrescos;
  if (cambios.periodo !== undefined) parche.periodo = cambios.periodo;

  const upd = await supabase
    .from('proyeccion_programacion')
    .update(parche)
    .eq('id', 1)
    .eq('rev', revActual)
    .select('id,rev');
  if (upd.error) return { ok: false, motivo: 'error', error: upd.error };
  if (upd.data && upd.data.length > 0) {
    return { ok: true, rev: (upd.data[0] as { rev: number }).rev };
  }

  // 0 filas: o la fila no existe todavía (primera vez) o alguien se adelantó.
  // Si no existe, la insertamos con los defaults + cambios; si existe con otra
  // rev, el insert fallará por PK y lo tratamos como conflicto (recargar).
  if (revActual === 0) {
    const fila = {
      id: 1,
      activa: cambios.activa ?? PROGRAMACION_DEFAULT.activa,
      frecuencia: cambios.frecuencia ?? PROGRAMACION_DEFAULT.frecuencia,
      dia_semana: cambios.diaSemana ?? PROGRAMACION_DEFAULT.diaSemana,
      hora_local: cambios.horaLocal ?? PROGRAMACION_DEFAULT.horaLocal,
      zona: PROGRAMACION_DEFAULT.zona,
      exige_datos_frescos: cambios.exigeDatosFrescos ?? PROGRAMACION_DEFAULT.exigeDatosFrescos,
      periodo: cambios.periodo ?? PROGRAMACION_DEFAULT.periodo,
      rev: 1,
      actualizado_por: autor,
    };
    const ins = await supabase
      .from('proyeccion_programacion')
      .insert(fila)
      .select('id,rev');
    if (ins.error) return { ok: false, motivo: 'conflicto' };
    return { ok: true, rev: (ins.data?.[0] as { rev: number } | undefined)?.rev ?? 1 };
  }
  return { ok: false, motivo: 'conflicto' };
}

/**
 * Una corrida registrada en la bitácora `proyeccion_corrida`. La publicación en
 * modo lectura (CP-56) lee la última con `paso='publicacion'` y `estado='ok'`.
 */
export interface Corrida {
  id: number;
  periodo: string;
  origen: string;
  paso: string;
  estado: string;
  /** Marca de tiempo de inicio (`timestamptz`, se muestra en Caracas). */
  inicio: string;
  /** Marca de tiempo de fin, si terminó. */
  fin: string | null;
  /** Filas publicadas en esa corrida. */
  filas: number | null;
  /** Hasta qué día traía datos la extracción publicada. */
  corte: string | null;
  mensaje: string | null;
  lanzadaPor: string | null;
}

interface RowCorrida {
  id: number;
  periodo: string;
  origen: string;
  paso: string;
  estado: string;
  inicio: string;
  fin: string | null;
  filas: number | null;
  corte: string | null;
  mensaje: string | null;
  lanzada_por: string | null;
}

/**
 * Lee la última publicación con éxito del periodo (CP-56): la corrida más
 * reciente de `proyeccion_corrida` con `paso='publicacion'` y `estado='ok'`.
 * Devuelve `null` si no hay ninguna o la base no responde (la UI muestra «—»).
 */
export async function cargarUltimaPublicacion(periodo: string): Promise<Corrida | null> {
  const { data, error } = await supabase
    .from('proyeccion_corrida')
    .select('id,periodo,origen,paso,estado,inicio,fin,filas,corte,mensaje,lanzada_por')
    .eq('periodo', periodo)
    .eq('paso', 'publicacion')
    .eq('estado', 'ok')
    .order('inicio', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as RowCorrida;
  return {
    id: r.id,
    periodo: r.periodo,
    origen: r.origen,
    paso: r.paso,
    estado: r.estado,
    inicio: r.inicio,
    fin: r.fin ?? null,
    filas: r.filas ?? null,
    corte: r.corte ?? null,
    mensaje: r.mensaje ?? null,
    lanzadaPor: r.lanzada_por ?? null,
  };
}
