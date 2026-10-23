/** Formato numérico compartido por los componentes de pestaña (es-VE). */
export const fmt = (v: number | null | undefined, d = 0): string =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
