import { useEffect, useMemo, useState } from 'react';
import type { AgregadoEmpresa, Metodo, Parametro, Regla } from '../engine';
import { fmt } from './formato';
import { desglosarRentaBrutaTodas } from './pruebaContable';
import { trazaRegla, type EscenarioTraza, type Traza } from './traza';

/**
 * Pestaña 3 · Resultado.
 *
 * Conserva el P&L proyectado del módulo actual (por empresa, con totales) y, por
 * debajo, la prueba contable de la Renta Bruta del CP-47 (Requirement 22.2):
 *
 *     Renta Bruta = Margen + Ingresos Mercantiles + Fletes Recuperados − Merma
 *
 * para las seis empresas. Si la identidad no cuadra en alguna, la prueba lo
 * señala y gobierna la publicación (Requirement 22.3): `page.tsx` recibe las
 * empresas malas (`onPruebaMalas`) para bloquear el botón de publicar.
 */
export interface PestanaResultadoProps {
  empresas: readonly string[];
  agg: Record<string, AgregadoEmpresa>;
  /**
   * P10 · Agregados del CAUSADO. El escenario 2 es la mitad de lo que se
   * publica y no se podia ver en ninguna parte.
   */
  aggCausado?: Record<string, AgregadoEmpresa>;
  cifrasValidadas: Record<string, number>;
  /** Suma de una clave del agregado sobre las seis empresas. */
  tot: (k: keyof AgregadoEmpresa) => number;
  /** Reglas de trabajo (para el desglose de la identidad y la traza). */
  reglas: Regla[];
  /** Monto USD por regla (proyectado), en el orden de `reglas`. */
  val: number[];
  /** Métodos efectivos, para la traza «¿Por qué este número?». */
  metodos: Record<string, Metodo>;
  /** Parámetros por empresa, para la traza. */
  params: Record<string, Parametro>;
  /** Abre la traza de una regla (CP-35). */
  onTraza?: (t: Traza) => void;
  /** Reporta al padre las empresas cuya prueba contable no cuadra (Req 22.3). */
  onPruebaMalas?: (empresas: string[]) => void;
}

export default function PestanaResultado({
  empresas,
  agg,
  aggCausado,
  cifrasValidadas,
  tot,
  reglas,
  val,
  metodos,
  params,
  onTraza,
  onPruebaMalas,
}: PestanaResultadoProps) {
  /**
   * P10 · Proyectado o Causado.
   *
   * La pestaña solo mostraba el proyectado al cierre, y el causado —que es el
   * otro escenario que se publica— no se podía ver en ninguna parte: para
   * saber qué iba a Power BI había que mirar la tabla de salida.
   */
  const [escenario, setEscenario] = useState<'PROYECTADO' | 'CAUSADO'>('PROYECTADO');
  const aggVista = escenario === 'CAUSADO' && aggCausado ? aggCausado : agg;

  const sn = tot('sn');
  const snBase = Object.values(cifrasValidadas).reduce((a, b) => a + b, 0);
  const dsn = sn - snBase;

  // ── Prueba contable CP-47 (Req 22.2) ──
  const desgloses = useMemo(
    () => desglosarRentaBrutaTodas(empresas, reglas, val, agg),
    [empresas, reglas, val, agg],
  );
  const malas = useMemo(() => desgloses.filter((d) => !d.cuadra).map((d) => d.empresa), [desgloses]);

  // Informa al padre (para bloquear publicación) cuando cambia el conjunto malo.
  const malasKey = malas.join(',');
  useEffect(() => {
    onPruebaMalas?.(malas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [malasKey]);

  const abrirTraza = (empresa: string, concepto: string, escenario: EscenarioTraza = 'PROYECCION') => {
    if (!onTraza) return;
    const i = reglas.findIndex((r) => r.empresa === empresa && r.concepto === concepto);
    if (i < 0) return;
    const r = reglas[i];
    onTraza(trazaRegla(r, metodos[r.metodo], params[r.empresa], escenario, val[i]));
  };

  return (
    <section className="space-y-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            {escenario === 'CAUSADO' ? 'P&L causado al corte' : 'P&L proyectado al cierre'}
          </h2>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
            {(['PROYECTADO', 'CAUSADO'] as const).map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setEscenario(x)}
                disabled={x === 'CAUSADO' && !aggCausado}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${
                  escenario === x ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {x === 'PROYECTADO' ? 'Proyectado' : 'Causado'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-slate-500">
          {escenario === 'CAUSADO'
            ? 'Lo que va del mes al corte. Es el escenario 2 de la tabla que alimenta Power BI.'
            : 'La estimación al cierre del mes. Es el escenario 1 de la tabla que alimenta Power BI.'}
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left">Empresa</th>
              <th className="px-3 py-2 text-right">Ingresos</th>
              <th className="px-3 py-2 text-right">Renta Bruta</th>
              <th className="px-3 py-2 text-right">Gastos Op.</th>
              <th className="px-3 py-2 text-right">Gcia. Operativa</th>
              <th className="px-3 py-2 text-right">Semi Neto</th>
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => {
              const a = aggVista[e];
              if (!a) return null;
              return (
                <tr key={e} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-slate-800">{e}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(a.ing)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(a.rb)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(a.go)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(a.gop)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    {fmt(a.sn)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(tot('ing'))}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(tot('rb'))}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(tot('go'))}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(tot('gop'))}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(sn)}</td>
              <td
                className={`px-3 py-2 text-right font-mono tabular-nums ${
                  Math.abs(dsn) < 1 ? 'text-slate-400' : dsn > 0 ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {Math.abs(dsn) < 1 ? 'igual' : `${dsn > 0 ? '+' : ''}${fmt(dsn)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Prueba contable de la Renta Bruta (CP-47, Req 22.2 / 22.3) ── */}
      <div>
        <h2 className="text-base font-semibold text-slate-900">Prueba contable de la Renta Bruta</h2>
        <p className="text-sm text-slate-500">
          Identidad que vigila el proyecto:{' '}
          <span className="font-mono text-xs">
            Renta Bruta = Margen + Ingresos Mercantiles + Fletes Recuperados − Merma
          </span>
          . Si no cuadra en alguna empresa, el resultado no se publica.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left">Empresa</th>
              <th className="px-3 py-2 text-right">Margen</th>
              <th className="px-3 py-2 text-right">Ing. Mercantiles</th>
              <th className="px-3 py-2 text-right">Fletes Recup.</th>
              <th className="px-3 py-2 text-right">Merma</th>
              <th className="px-3 py-2 text-right">RB (identidad)</th>
              <th className="px-3 py-2 text-right">RB (motor)</th>
              <th className="px-3 py-2 text-center">Prueba</th>
            </tr>
          </thead>
          <tbody>
            {desgloses.map((d) => (
              <tr key={d.empresa} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold text-slate-800">
                  <button
                    type="button"
                    onClick={() => abrirTraza(d.empresa, 'Ventas')}
                    className="text-left hover:text-emerald-700 hover:underline"
                    title="¿Por qué este número?"
                  >
                    {d.empresa}
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(d.margen)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  <button
                    type="button"
                    onClick={() => abrirTraza(d.empresa, 'Ingresos Mercantiles')}
                    className="hover:text-emerald-700 hover:underline"
                  >
                    {fmt(d.ingresosMercantiles)}
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  <button
                    type="button"
                    onClick={() => abrirTraza(d.empresa, 'Fletes Recuperados')}
                    className="hover:text-emerald-700 hover:underline"
                  >
                    {fmt(d.fletesRecuperados)}
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  <button
                    type="button"
                    onClick={() => abrirTraza(d.empresa, 'Merma')}
                    className="hover:text-emerald-700 hover:underline"
                  >
                    {fmt(d.merma)}
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(d.rbIdentidad)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(d.rbMotor)}</td>
                <td className="px-3 py-2 text-center">
                  {d.cuadra ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      cuadra
                    </span>
                  ) : (
                    <span
                      className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700"
                      title={
                        d.conceptosNoContemplados.length
                          ? `Conceptos fuera de la identidad: ${d.conceptosNoContemplados.join(', ')}`
                          : `Diferencia ${fmt(d.diferencia, 2)} USD`
                      }
                    >
                      no cuadra
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className={`rounded border-l-4 px-3 py-2 text-xs ${
          malas.length
            ? 'border-red-400 bg-red-50 text-red-700'
            : 'border-emerald-400 bg-emerald-50 text-slate-600'
        }`}
      >
        {malas.length
          ? `No se puede publicar: la Renta Bruta no cuadra con sus componentes en ${malas.join(', ')}.`
          : 'Prueba contable superada. La identidad de la Renta Bruta cuadra en las seis empresas.'}
      </div>
    </section>
  );
}
