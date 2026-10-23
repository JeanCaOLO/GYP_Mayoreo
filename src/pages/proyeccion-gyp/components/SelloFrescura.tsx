import type { Fuente } from '../data';

/**
 * Sello de frescura de tres estados (CP-46, Requirement 17.3).
 *
 *   verde  → `Fabric · <fecha> · datos al <corte>`      (datos leídos de la base)
 *   ámbar  → copia de respaldo / base sin extracción     (foto embebida)
 *   rojo   → sin datos del mes / no se pudo leer la base
 *
 * El estado se deriva de la `fuente` de la capa de datos:
 *   - `db`       → verde
 *   - `embebida` → ámbar
 *   - `error`    → rojo
 */
export interface SelloFrescuraProps {
  fuente: Fuente;
  /** Fecha de generación de la extracción (p. ej. "2026-10-13 10:28"). */
  generado: string | null;
  /** Último día con registros en la extracción (p. ej. "2026-10-07"). */
  corte: string | null;
}

interface SelloCfg {
  color: string;
  txt: string;
}

export function configurarSello({ fuente, generado, corte }: SelloFrescuraProps): SelloCfg {
  const sufijoCorte = corte ? ` · datos al ${corte}` : '';
  if (fuente === 'db') {
    return {
      color: 'bg-emerald-500',
      txt: `Fabric · ${generado || 'sin fecha'}${sufijoCorte}`,
    };
  }
  if (fuente === 'error') {
    return {
      color: 'bg-red-500',
      txt: 'No se pudo leer la base · sin datos del mes',
    };
  }
  // embebida
  return {
    color: 'bg-amber-500',
    txt: `Copia de respaldo · ${generado || 'sin fecha'}${sufijoCorte}`,
  };
}

export default function SelloFrescura(props: SelloFrescuraProps) {
  const cfg = configurarSello(props);
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] text-slate-500">
      <span className={`h-2 w-2 rounded-full ${cfg.color}`} aria-hidden="true"></span>
      {cfg.txt}
    </span>
  );
}
