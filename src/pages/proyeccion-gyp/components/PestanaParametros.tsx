import type { Metodo, Regla, Parametro } from '../engine';
import type { Fuente, Programacion, CambiosProgramacion, Corrida } from '../data';
import { fmt } from './formato';
import PanelProgramacion from './PanelProgramacion';

/**
 * Pestaña 1 · Parámetros y mes de trabajo (CP-33, Requirements 20.1–20.4).
 *
 * Orden de la pestaña (CP-33): sobre qué mes trabajas · la venta del mes · cuándo
 * se actualiza solo.
 *
 *  1. «Sobre qué mes trabajas» — tarjetas por mes disponible, cada una con su
 *     estado (mes completo / terminó / en curso / todavía sin datos). Elegir un
 *     mes lo fija para todos: limpia el detalle por cuenta, los repartos y el
 *     presupuesto del anterior, y los conceptos sin movimiento quedan en cero
 *     (lo gobierna `onElegirMes` en page.tsx). El FACTOR se guarda por mes.
 *  2. «La venta del mes» — tabla de venta por empresa (días hábiles,
 *     transcurridos, factor y tasa editables; venta al corte y proyectada
 *     calculadas). Es la tabla del módulo base, conservada.
 *  3. «Cuándo se actualiza solo» — la actualización programada (CP-56): estado,
 *     frecuencia, hora de publicación en hora de Caracas, mes y «no publicar con
 *     datos viejos», más la lectura de los datos de Fabric y de la última/próxima
 *     publicación. Vive en `PanelProgramacion`.
 *
 * Nota sobre la lista de meses: por ahora el mes de trabajo vigente es la única
 * tarjeta real; la lista completa de meses disponibles vendrá de
 * `gyp_historico_mensual` / `cargarDatosDetalle`. `mesesDisponibles` permite a
 * page.tsx inyectar esa lista cuando exista sin tocar este componente.
 */

/** Estado de un mes disponible, derivado del corte y los días hábiles. */
export interface EstadoMes {
  /** Periodo YYYY-MM. */
  periodo: string;
  /** Último día con datos (corte), si lo hay. */
  corte: string | null;
  /** Días hábiles del mes (para «en curso · X de Y días hábiles»). */
  diasHabiles?: number | null;
  /** Días hábiles transcurridos al corte. */
  transcurridos?: number | null;
  /** Fase del mes: completo, terminado (datos parciales), en curso, sin datos. */
  fase: 'completo' | 'terminado' | 'en_curso' | 'sin_datos';
}

const MES_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** Último día del mes para un periodo YYYY-MM (1..31). */
export function ultimoDiaDelMes(periodo: string): number {
  const [a, m] = periodo.split('-').map(Number);
  if (!a || !m) return 31;
  return new Date(a, m, 0).getDate();
}

/** Nombre corto de un periodo YYYY-MM → «oct 2026». */
export function nombreMes(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number);
  if (!a || !m || m < 1 || m > 12) return periodo;
  return `${MES_ES[m - 1]} ${a}`;
}

/** Día «D mmm» a partir de una fecha YYYY-MM-DD. */
function diaCorto(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number);
  if (!a || !m || !d) return fecha;
  return `${d} ${MES_ES[m - 1]}`;
}

/**
 * Frase de estado de un mes (CP-33). Pura y testable.
 *
 *   completo   → «mes completo · datos al 31 oct»
 *   terminado  → «terminó · datos solo hasta el 28 oct»
 *   en_curso   → «en curso · datos al 7 oct (6 de 26 días hábiles)»
 *   sin_datos  → «todavía sin datos»
 */
export function fraseEstadoMes(e: EstadoMes): string {
  if (e.fase === 'sin_datos' || !e.corte) return 'todavía sin datos';
  const corte = diaCorto(e.corte);
  if (e.fase === 'completo') return `mes completo · datos al ${corte}`;
  if (e.fase === 'terminado') return `terminó · datos solo hasta el ${corte}`;
  // en curso
  const hay = e.transcurridos != null && e.diasHabiles != null;
  const detalle = hay ? ` (${e.transcurridos} de ${e.diasHabiles} días hábiles)` : '';
  return `en curso · datos al ${corte}${detalle}`;
}

/**
 * Deriva el estado del mes vigente a partir de la frescura de la capa de datos.
 * Es un fallback mientras la lista real de meses no llega de
 * `gyp_historico_mensual`: con datos cargados y corte < último día del mes el
 * mes va «en curso»; sin corte, «todavía sin datos».
 */
export function estadoDelPeriodo(
  periodo: string,
  corte: string | null,
  fuente: Fuente,
  dias?: number | null,
  trans?: number | null,
): EstadoMes {
  if (!corte || fuente === 'error') {
    return { periodo, corte: null, fase: 'sin_datos', diasHabiles: dias, transcurridos: trans };
  }
  const diaCorte = Number(corte.split('-')[2]) || 0;
  const fase: EstadoMes['fase'] =
    diaCorte >= ultimoDiaDelMes(periodo) ? 'completo' : 'en_curso';
  return { periodo, corte, fase, diasHabiles: dias, transcurridos: trans };
}

const BADGE_FASE: Record<EstadoMes['fase'], string> = {
  completo: 'bg-emerald-100 text-emerald-700',
  terminado: 'bg-amber-100 text-amber-700',
  en_curso: 'bg-sky-100 text-sky-700',
  sin_datos: 'bg-slate-100 text-slate-500',
};

export interface PestanaParametrosProps {
  empresas: readonly string[];
  params: Record<string, Parametro>;
  setParams: React.Dispatch<React.SetStateAction<Record<string, Parametro>>>;
  reglas: Regla[];
  metodos: Record<string, Metodo>;
  /** Monto USD por regla, en el orden de `reglas`. */
  val: number[];
  /** Mes de trabajo vigente (CP-33). */
  periodo: string;
  /** Último día con datos del mes vigente. */
  corte: string | null;
  /** Frescura de la capa de datos (deriva el estado del mes). */
  fuente: Fuente;
  /**
   * Meses disponibles con su estado. Si no se pasa, se muestra solo el vigente
   * derivado de `periodo`/`corte`/`fuente`. La lista real vendrá de
   * `gyp_historico_mensual` / `cargarDatosDetalle`.
   */
  mesesDisponibles?: EstadoMes[];
  /**
   * Fija el mes de trabajo para todos (CP-33). page.tsx limpia el detalle por
   * cuenta, los repartos y el presupuesto del mes anterior.
   */
  onElegirMes?: (periodo: string) => void;
  /**
   * Persiste el factor de corrección por mes (CP-33 / CP-37). page.tsx lo enlaza
   * a `guardarFactorMes(periodo, empresa, factor)`; si no se pasa, el factor vive
   * solo en `params` y se publica con el resto al guardar.
   */
  onFactorMes?: (empresa: string, factor: number) => void;
  /**
   * P2 · Guarda días, transcurridos y tasa del mes. Antes se editaban en
   * pantalla y se perdían al recargar; la tasa ni siquiera era editable.
   */
  onParametroMes?: (
    empresa: string,
    campos: { dias?: number; trans?: number; tasa?: number | null },
  ) => void;
  /**
   * Configuración de la actualización programada (CP-56). Si no se pasa, la
   * tercera sección no se muestra (fallback mientras la base no responde).
   */
  programacion?: Programacion;
  /** Persiste un cambio de la programación (bloqueo optimista por rev, CP-38). */
  onGuardarProgramacion?: (cambios: CambiosProgramacion) => void;
  /** Última publicación con éxito del periodo (de `proyeccion_corrida`). */
  ultimaPublicacion?: Corrida | null;
  /** Fecha de generación de la última extracción de Fabric (informativo, CP-56). */
  generado?: string | null;
}

export default function PestanaParametros({
  empresas,
  params,
  setParams,
  reglas,
  metodos,
  val,
  periodo,
  corte,
  fuente,
  mesesDisponibles,
  onElegirMes,
  onFactorMes,
  onParametroMes,
  programacion,
  onGuardarProgramacion,
  ultimaPublicacion,
  generado,
}: PestanaParametrosProps) {
  // Una tarjeta por mes disponible. Mientras no llegue la lista real, el único
  // mes es el vigente, con su estado derivado de la frescura de los datos.
  const diasVigente = empresas.map((e) => params[e]?.dias).find((d) => d != null) ?? null;
  const transVigente = empresas.map((e) => params[e]?.trans).find((t) => t != null) ?? null;
  const meses: EstadoMes[] =
    mesesDisponibles && mesesDisponibles.length
      ? mesesDisponibles
      : [estadoDelPeriodo(periodo, corte, fuente, diasVigente, transVigente)];

  return (
    <section className="space-y-6">
      {/* ── 1 · Sobre qué mes trabajas (CP-33) ───────────────────────────── */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Sobre qué mes trabajas</h2>
          <p className="text-sm text-slate-500">
            El mes elegido se fija para todos: de ahí salen el proyectado, el causado, las reglas,
            la comparación y la <code className="font-mono text-xs">FECHA</code> de la tabla de
            salida. Al cambiar de mes se limpian el detalle por cuenta, los repartos y el
            presupuesto del anterior; los conceptos sin movimiento quedan en cero. El factor se
            guarda por mes.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {meses.map((m) => {
            const activo = m.periodo === periodo;
            const deshabilitado = m.fase === 'sin_datos';
            return (
              <button
                key={m.periodo}
                type="button"
                disabled={deshabilitado || (!onElegirMes && !activo)}
                onClick={() => !activo && onElegirMes?.(m.periodo)}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  activo
                    ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                    : deshabilitado
                      ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'
                      : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">{nombreMes(m.periodo)}</span>
                  {activo && (
                    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                      mes de trabajo
                    </span>
                  )}
                </div>
                <span
                  className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_FASE[m.fase]}`}
                >
                  {fraseEstadoMes(m)}
                </span>
                {m.fase === 'terminado' && (
                  <p className="mt-2 text-[11px] text-amber-600">Pide una extracción nueva.</p>
                )}
              </button>
            );
          })}
        </div>
        {(!mesesDisponibles || mesesDisponibles.length <= 1) && (
          <p className="text-[11px] text-slate-400">
            La lista completa de meses disponibles se tomará de{' '}
            <code className="font-mono">gyp_historico_mensual</code>. Por ahora se muestra el mes de
            trabajo vigente.
          </p>
        )}
      </div>

      {/* ── 2 · La venta del mes (tabla conservada del módulo base) ───────── */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">La venta del mes</h2>
          <p className="text-sm text-slate-500">
            Solo afecta a los métodos con operación <b>Fórmula de venta</b>. Los días los propone el
            calendario de Fabric; el factor de corrección lo fija control y se guarda por mes.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-left">Empresa</th>
                <th className="px-3 py-2 text-right">Días hábiles</th>
                <th className="px-3 py-2 text-right">Transcurridos</th>
                <th className="px-3 py-2 text-right">Restantes</th>
                <th className="px-3 py-2 text-right">Factor</th>
                <th className="px-3 py-2 text-right">Tasa local</th>
                <th className="px-3 py-2 text-right">Venta acumulada</th>
                <th className="px-3 py-2 text-right">Venta proyectada</th>
              </tr>
            </thead>
            <tbody>
              {empresas.map((e) => {
                const p = params[e];
                if (!p) return null;
                const rest = p.dias - p.trans;
                const iv = reglas.findIndex((r) => r.empresa === e && r.concepto === 'Ventas');
                const ic = reglas.findIndex(
                  (r) => r.empresa === e && (metodos[r.metodo] || {}).op === 'derivada',
                );
                const ac = iv >= 0 ? reglas[iv].acum : null;
                const pr = iv >= 0 ? val[iv] : ic >= 0 ? val[ic] : 0;
                const upd = (campo: 'dias' | 'trans' | 'factor' | 'tasa', v: number) =>
                  setParams((prev) => ({ ...prev, [e]: { ...prev[e], [campo]: v } }));

                // P2 · Un campo vacío NO vale 0. `+'' || 0` convertía borrar el
                // contenido en guardar un cero: factor 0 anula la proyección y
                // días 0 la vuelve indefinida. Si lo escrito no es un número
                // utilizable, se conserva lo que había.
                const num = (txt: string, previo: number): number => {
                  const v = parseFloat(txt);
                  return Number.isFinite(v) ? v : previo;
                };
                return (
                  <tr key={e} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-800">{e}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={p.dias}
                        onChange={(ev) => upd('dias', num(ev.target.value, p.dias))}
                        onBlur={(ev) =>
                          onParametroMes?.(e, { dias: num(ev.target.value, p.dias) })
                        }
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        max={31}
                        value={p.trans}
                        onChange={(ev) => upd('trans', num(ev.target.value, p.trans))}
                        onBlur={(ev) =>
                          onParametroMes?.(e, { trans: num(ev.target.value, p.trans) })
                        }
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{rest}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        step={0.01}
                        min={0}
                        max={5}
                        value={p.factor}
                        onChange={(ev) => upd('factor', num(ev.target.value, p.factor))}
                        onBlur={(ev) => onFactorMes?.(e, num(ev.target.value, p.factor))}
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {/* P2 · La tasa es editable: una tasa mal extraída no se
                          podía corregir sin tocar la base a mano. */}
                      <input
                        type="number"
                        step={0.0001}
                        min={0}
                        value={p.tasa ?? ''}
                        onChange={(ev) => upd('tasa', num(ev.target.value, p.tasa ?? 0))}
                        onBlur={(ev) =>
                          onParametroMes?.(e, { tasa: num(ev.target.value, p.tasa ?? 0) })
                        }
                        className="w-28 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {ac == null ? <span className="text-slate-400">por Colocación</span> : fmt(-ac)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {fmt(-pr)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="rounded border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-slate-600">
          <b>Venta proyectada =</b> acumulado + (si días restantes − 5 &gt; 0: promedio simple × (días
          restantes − 5)) + mín(días restantes, 5) × promedio simple × factor.
        </div>
      </div>

      {/* ── 3 · Cuándo se actualiza solo (programación, CP-56 / Req 27.1·27.9) ─ */}
      {programacion && onGuardarProgramacion ? (
        <PanelProgramacion
          programacion={programacion}
          onGuardarProgramacion={onGuardarProgramacion}
          ultimaPublicacion={ultimaPublicacion ?? null}
          periodo={periodo}
          generado={generado ?? null}
          corte={corte}
          fuente={fuente}
        />
      ) : (
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Cuándo se actualiza solo</h2>
          </div>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-slate-500">Actualización programada</p>
            <p className="mt-1 text-xs text-slate-400">
              Sin conexión con la base: la configuración se mostrará cuando responda
              <code className="mx-1 font-mono">proyeccion_programacion</code>.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
