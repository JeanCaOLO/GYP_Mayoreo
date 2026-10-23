import { useMemo, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import type { Regla, Parametro } from '../engine';
import { fmt } from './formato';

/**
 * Pestaña 4 · Tabla de salida.
 *
 * Las trece columnas de F_Mayor en el mismo orden del contrato (CP-04/05/52).
 * Muestra los DOS escenarios (Proyectado = 1, Causado = 2) con un selector, y
 * permite copiar el CSV, descargar el CSV y generar el `.xlsx` en el navegador
 * (CP-55, Requirement 22.4). El botón «Publicar a la base» (solo admin) se
 * conserva del módulo actual.
 */
export interface PestanaTablaSalidaProps {
  reglas: Regla[];
  /** Monto USD proyectado por regla, en el orden de `reglas`. */
  val: number[];
  /** Monto USD causado por regla, en el orden de `reglas`. */
  valCausado?: number[];
  params: Record<string, Parametro>;
  periodo: string;
  isAdmin: boolean;
  publicando: boolean;
  onCopiarCsv: () => void;
  onPublicar: () => void;
}

const COLUMNAS = [
  'FECHA',
  'Ajuste',
  'Vista',
  'Combinada',
  'Pais',
  'Empresa',
  'Tasa_Mensual',
  'Ajuste_USD',
  'Monto_Local',
  'Monto_USD',
  'CENTRO_COSTO',
  'CUENTA_CONTABLE',
  'Proyeccion',
] as const;

type EscenarioSalida = 'proyeccion' | 'causado';

export default function PestanaTablaSalida({
  reglas,
  val,
  valCausado,
  params,
  periodo,
  isAdmin,
  publicando,
  onCopiarCsv,
  onPublicar,
}: PestanaTablaSalidaProps) {
  const { addToast } = useToast();
  const [escenario, setEscenario] = useState<EscenarioSalida>('proyeccion');
  const hayCausado = Array.isArray(valCausado) && valCausado.length === reglas.length;

  const valEscenario = escenario === 'causado' && hayCausado ? valCausado! : val;
  const codigoEscenario = escenario === 'causado' ? 2 : 1;

  /** Construye las filas de salida de un escenario (array de arrays). */
  const filasDe = (vals: number[], codigo: number): (string | number)[][] =>
    reglas.map((r, i) => [
      periodo + '-01',
      0,
      'GYP',
      r.combinada,
      r.pais,
      r.empresa,
      r.tasaMensual == null ? '' : r.tasaMensual,
      0,
      Number((vals[i] * (params[r.empresa]?.tasa || 0)).toFixed(2)),
      Number(vals[i].toFixed(2)),
      r.cc,
      r.cuenta,
      codigo,
    ]);

  /** Las filas de los dos escenarios en append (Proyeccion = 1 | 2). */
  const filasAmbos = useMemo(() => {
    const out = filasDe(val, 1);
    if (hayCausado) out.push(...filasDe(valCausado!, 2));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reglas, val, valCausado, params, periodo, hayCausado]);

  const descargarArchivo = (contenido: string | ArrayBuffer, nombre: string, tipo: string) => {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const descargarCsv = () => {
    const header = COLUMNAS.join(';');
    const lineas = filasAmbos.map((f) => f.join(';'));
    const txt = [header, ...lineas].join('\n');
    descargarArchivo(txt, `tabla_salida_${periodo}.csv`, 'text/csv;charset=utf-8');
    addToast('success', `CSV descargado (${filasAmbos.length} filas, ${hayCausado ? 2 : 1} escenario${hayCausado ? 's' : ''}).`);
  };

  const descargarXlsx = async () => {
    try {
      const xlsx = await import('xlsx');
      const ws = xlsx.utils.aoa_to_sheet([COLUMNAS as unknown as string[], ...filasAmbos]);
      ws['!cols'] = COLUMNAS.map(() => ({ wch: 16 }));
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Tabla de salida');
      const wbout = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
      descargarArchivo(
        wbout,
        `tabla_salida_${periodo}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      addToast('success', `XLSX descargado (${filasAmbos.length} filas).`);
    } catch (err) {
      addToast('error', 'No se pudo generar el XLSX: ' + (err as Error).message);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Tabla de salida</h2>
        <p className="text-sm text-slate-500">
          Las trece columnas de F_Mayor, en el mismo orden. Esto es lo que se escribe en{' '}
          <span className="font-mono">proyeccion_resultado</span>, con los dos escenarios en append
          (<span className="font-mono">Proyeccion = 1</span> proyectado · 2 causado).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          <button
            onClick={() => setEscenario('proyeccion')}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
              escenario === 'proyeccion' ? 'bg-emerald-600 text-white' : 'text-slate-600'
            }`}
          >
            Proyectado (1)
          </button>
          <button
            onClick={() => setEscenario('causado')}
            disabled={!hayCausado}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${
              escenario === 'causado' ? 'bg-emerald-600 text-white' : 'text-slate-600'
            }`}
          >
            Causado (2)
          </button>
        </div>
        <span className="font-mono text-xs text-slate-500">
          {reglas.length} filas · FECHA {periodo}-01 · Proyeccion = {codigoEscenario}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={onCopiarCsv}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Copiar CSV
          </button>
          <button
            onClick={descargarCsv}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Descargar CSV
          </button>
          <button
            onClick={descargarXlsx}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Descargar XLSX
          </button>
          {isAdmin && (
            <button
              onClick={onPublicar}
              disabled={publicando}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {publicando ? 'Publicando…' : 'Publicar a la base'}
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left">FECHA</th>
              <th className="px-3 py-2 text-left">Vista</th>
              <th className="px-3 py-2 text-left">Combinada</th>
              <th className="px-3 py-2 text-left">País</th>
              <th className="px-3 py-2 text-left">Empresa</th>
              <th className="px-3 py-2 text-right">Tasa_Mensual</th>
              <th className="px-3 py-2 text-right">Monto_Local</th>
              <th className="px-3 py-2 text-right">Monto_USD</th>
              <th className="px-3 py-2 text-left">CENTRO_COSTO</th>
              <th className="px-3 py-2 text-left">CUENTA_CONTABLE</th>
              <th className="px-3 py-2 text-right">Proyeccion</th>
            </tr>
          </thead>
          <tbody>
            {reglas.map((r, i) => (
              <tr
                key={r.key}
                className={`border-t border-slate-100 ${r.nueva ? 'bg-emerald-50/40' : ''}`}
              >
                <td className="px-3 py-2 font-mono text-[11px]">{periodo}-01</td>
                <td className="px-3 py-2">GYP</td>
                <td className="px-3 py-2 font-mono text-[11px]">{r.combinada}</td>
                <td className="px-3 py-2">{r.pais}</td>
                <td className="px-3 py-2">{r.empresa}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {r.tasaMensual == null ? (
                    <span className="text-slate-400">nulo</span>
                  ) : (
                    fmt(r.tasaMensual, 4)
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fmt(valEscenario[i] * (params[r.empresa]?.tasa || 0), 2)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fmt(valEscenario[i], 2)}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">{r.cc}</td>
                <td className="px-3 py-2 font-mono text-[11px]">{r.cuenta}</td>
                <td className="px-3 py-2 text-right font-mono">{codigoEscenario}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Montos en <b>signo crudo</b>: ingresos negativos, gastos positivos. El CSV y el XLSX incluyen
        {hayCausado ? ' los dos escenarios en append.' : ' el escenario proyectado.'}
      </p>
    </section>
  );
}
