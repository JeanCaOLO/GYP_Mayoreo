import type { AgregadoEmpresa } from '../engine';

/**
 * Franja de KPIs fija e independiente de cualquier selector (CP-46, Requirement
 * 17.2). Suma las Six_Empresas y muestra el proyectado arriba y el causado
 * debajo para los cinco indicadores: Ingresos, Renta Bruta, Gastos Operativos,
 * Ganancia Operativa y Semi Neto.
 *
 * Recibe los agregados de los DOS escenarios (de `calcularEscenarios`) ya que la
 * franja no depende de ningún filtro de pestaña.
 */
export interface KpiHeaderProps {
  /** Agregados por empresa del escenario proyectado al cierre. */
  aggProyeccion: Record<string, AgregadoEmpresa>;
  /** Agregados por empresa del escenario causado al corte. */
  aggCausado: Record<string, AgregadoEmpresa>;
  /** Las seis empresas sobre las que se suma. */
  empresas: readonly string[];
}

const fmt = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Los cinco KPIs de la franja, con la llave del agregado por empresa. */
const KPIS: { k: keyof AgregadoEmpresa; label: string }[] = [
  { k: 'ing', label: 'Ingresos' },
  { k: 'rb', label: 'Renta Bruta' },
  { k: 'go', label: 'Gastos Operativos' },
  { k: 'gop', label: 'Ganancia Operativa' },
  { k: 'sn', label: 'Semi Neto' },
];

function sumar(
  agg: Record<string, AgregadoEmpresa>,
  empresas: readonly string[],
  k: keyof AgregadoEmpresa,
): number {
  return empresas.reduce((a, e) => a + (agg[e]?.[k] || 0), 0);
}

export default function KpiHeader({ aggProyeccion, aggCausado, empresas }: KpiHeaderProps) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {KPIS.map(({ k, label }) => {
        const proy = sumar(aggProyeccion, empresas, k);
        const caus = sumar(aggCausado, empresas, k);
        return (
          <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </div>
            {/* Proyectado arriba */}
            <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-900">
              {fmt(proy)}
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
              Proyectado al cierre
            </div>
            {/* Causado debajo */}
            <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-600">
              {fmt(caus)}
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
              Causado al corte
            </div>
          </div>
        );
      })}
    </div>
  );
}
