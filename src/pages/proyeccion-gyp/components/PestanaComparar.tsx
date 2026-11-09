import { etiquetaConcepto } from '../seed';
import { Fragment, useMemo, useState } from 'react';
import type { Metodo, Parametro, Regla } from '../engine';
import type { PresupuestoFila } from '../data';
import { fmt } from './formato';
import { trazaRegla, type Traza } from './traza';

/**
 * Pestaña 5 · Comparar (CP-45).
 *
 * Por empresa y concepto: Proyectado al cierre · Causado al corte · Presupuesto ·
 * Proy. vs Ppto · Causado / Proy. Los conceptos con varias reglas se despliegan
 * para ver cada regla. Al pie de cada empresa, el total y «N de M días hábiles
 * transcurridos · X % del mes».
 *
 * La última columna (Causado / Proy.) es la que más se usa: a mitad de mes
 * debería rondar la mitad. Es la pestaña con la que control detecta un concepto
 * que se va de rango antes del cierre.
 */
export interface PestanaCompararProps {
  empresas: readonly string[];
  reglas: Regla[];
  /** Monto USD proyectado por regla, en el orden de `reglas`. */
  valProyeccion: number[];
  /** Monto USD causado por regla, en el orden de `reglas`. */
  valCausado: number[];
  /** Presupuesto del periodo agregado por empresa|concepto. */
  presupuesto: PresupuestoFila[];
  /** Parámetros por empresa (días hábiles / transcurridos para el pie). */
  params: Record<string, Parametro>;
  /** Métodos efectivos, para la traza «¿Por qué este número?». */
  metodos: Record<string, Metodo>;
  /** Abre la traza de una regla (CP-35). */
  onTraza?: (t: Traza) => void;
}

/** Una línea de concepto (agrupa todas las reglas del mismo empresa|concepto). */
interface FilaConcepto {
  concepto: string;
  /**
   * P14 · Grupo del P&L. Hace falta para el color: pasarse del presupuesto es
   * BUENO en un ingreso y MALO en un gasto, y antes todo lo positivo salia en
   * verde — un gasto disparado se pintaba como si fuera una buena noticia.
   */
  grupo: string;
  proyectado: number;
  causado: number;
  presupuesto: number | null;
  /** Reglas individuales (para desplegar si hay más de una). */
  reglas: { idx: number; regla: Regla }[];
}

function proporcion(causado: number, proyectado: number): string {
  if (!proyectado || Number.isNaN(proyectado)) return '—';
  return (causado / proyectado).toLocaleString('es-VE', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export default function PestanaComparar({
  empresas,
  reglas,
  valProyeccion,
  valCausado,
  presupuesto,
  params,
  metodos,
  onTraza,
}: PestanaCompararProps) {
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  const presuMap = useMemo(() => {
    const m = new Map<string, number>();
    presupuesto.forEach((p) => m.set(p.empresa + '|' + p.concepto, p.presupuesto));
    return m;
  }, [presupuesto]);

  // Agrupa reglas por empresa → concepto conservando el índice original.
  const porEmpresa = useMemo(() => {
    const out = new Map<string, FilaConcepto[]>();
    empresas.forEach((e) => out.set(e, []));
    const porKey = new Map<string, FilaConcepto>();
    reglas.forEach((r, idx) => {
      if (!out.has(r.empresa)) return;
      const key = r.empresa + '|' + r.concepto;
      let fila = porKey.get(key);
      if (!fila) {
        fila = {
          concepto: r.concepto,
          grupo: r.grupo,
          proyectado: 0,
          causado: 0,
          presupuesto: presuMap.has(key) ? 0 : null,
          reglas: [],
        };
        porKey.set(key, fila);
        out.get(r.empresa)!.push(fila);
      }
      fila.proyectado += valProyeccion[idx] ?? 0;
      fila.causado += valCausado[idx] ?? 0;
      if (presuMap.has(key)) fila.presupuesto = presuMap.get(key)!;
      fila.reglas.push({ idx, regla: r });
    });
    return out;
  }, [empresas, reglas, valProyeccion, valCausado, presuMap]);

  const toggle = (k: string) => setAbiertos((p) => ({ ...p, [k]: !p[k] }));

  const abrirTraza = (idx: number, escenario: 'PROYECCION' | 'CAUSADO') => {
    if (!onTraza) return;
    const r = reglas[idx];
    const val = escenario === 'CAUSADO' ? valCausado[idx] : valProyeccion[idx];
    onTraza(trazaRegla(r, metodos[r.metodo], params[r.empresa], escenario, val));
  };

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Comparar</h2>
        <p className="text-sm text-slate-500">
          Proyectado al cierre, Causado al corte y Presupuesto por empresa y concepto. La columna{' '}
          <b>Causado / Proy.</b> dice qué proporción del mes ya está causada.
        </p>
      </div>

      {empresas.map((e) => {
        const filas = porEmpresa.get(e) ?? [];
        const p = params[e];
        const totProy = filas.reduce((a, f) => a + f.proyectado, 0);
        const totCaus = filas.reduce((a, f) => a + f.causado, 0);
        const totPpto = filas.reduce((a, f) => a + (f.presupuesto ?? 0), 0);
        const pctMes = p && p.dias ? p.trans / p.dias : null;
        return (
          <div key={e} className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <div className="flex items-baseline justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
              <h3 className="text-sm font-semibold text-slate-800">{e}</h3>
              {p && (
                <span className="font-mono text-[11px] text-slate-500">
                  {p.trans} de {p.dias} días hábiles transcurridos ·{' '}
                  {pctMes == null ? '—' : (pctMes * 100).toFixed(0) + '% del mes'}
                </span>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">Concepto</th>
                  <th className="px-3 py-2 text-right">Proyectado</th>
                  <th className="px-3 py-2 text-right">Causado</th>
                  <th className="px-3 py-2 text-right">Presupuesto</th>
                  <th className="px-3 py-2 text-right">Proy. vs Ppto</th>
                  <th className="px-3 py-2 text-right">Causado / Proy.</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const key = e + '|' + f.concepto;
                  const abierto = !!abiertos[key];
                  const multiple = f.reglas.length > 1;
                  const proyVsPpto =
                    f.presupuesto != null && f.presupuesto !== 0
                      ? f.proyectado - f.presupuesto
                      : null;
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-800">
                          {multiple ? (
                            <button
                              type="button"
                              onClick={() => toggle(key)}
                              className="inline-flex items-center gap-1 font-medium hover:text-emerald-700"
                            >
                              <i
                                className={`ri-arrow-right-s-line transition-transform ${
                                  abierto ? 'rotate-90' : ''
                                }`}
                              />
                              {etiquetaConcepto(f.concepto)}
                              <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">
                                {f.reglas.length} reglas
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => abrirTraza(f.reglas[0].idx, 'PROYECCION')}
                              className="text-left hover:text-emerald-700 hover:underline"
                              title="¿Por qué este número?"
                            >
                              {etiquetaConcepto(f.concepto)}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {fmt(f.proyectado)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {fmt(f.causado)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                          {f.presupuesto == null ? '—' : fmt(f.presupuesto)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono tabular-nums ${
                            proyVsPpto == null
                              ? 'text-slate-400'
                              : // P14 · En VENTAS, por encima del presupuesto es
                                // bueno. En un gasto es lo contrario.
                                (f.grupo === 'VENTAS' ? proyVsPpto >= 0 : proyVsPpto <= 0)
                                ? 'text-emerald-600'
                                : 'text-red-600'
                          }`}
                        >
                          {proyVsPpto == null
                            ? '—'
                            : `${proyVsPpto > 0 ? '+' : ''}${fmt(proyVsPpto)}`}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {proporcion(f.causado, f.proyectado)}
                        </td>
                      </tr>
                      {multiple &&
                        abierto &&
                        f.reglas.map(({ idx, regla }) => (
                          <tr key={key + '#' + idx} className="border-t border-slate-50 bg-slate-50/40">
                            <td className="px-3 py-1.5 pl-9 text-[13px] text-slate-500">
                              <button
                                type="button"
                                onClick={() => abrirTraza(idx, 'PROYECCION')}
                                className="hover:text-emerald-700 hover:underline"
                                title="¿Por qué este número?"
                              >
                                {regla.combinada}
                                {regla.nueva && (
                                  <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">
                                    nueva
                                  </span>
                                )}
                              </button>
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-[13px] tabular-nums">
                              {fmt(valProyeccion[idx] ?? 0)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-[13px] tabular-nums">
                              {fmt(valCausado[idx] ?? 0)}
                            </td>
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5 text-right font-mono text-[13px] tabular-nums">
                              {proporcion(valCausado[idx] ?? 0, valProyeccion[idx] ?? 0)}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                  <td className="px-3 py-2">Total {e}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(totProy)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(totCaus)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {totPpto ? fmt(totPpto) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {totPpto ? `${totProy - totPpto > 0 ? '+' : ''}${fmt(totProy - totPpto)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {proporcion(totCaus, totProy)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </section>
  );
}
