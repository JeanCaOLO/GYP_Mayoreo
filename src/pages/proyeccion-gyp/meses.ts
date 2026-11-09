/**
 * Qué meses se pueden elegir en «Sobre qué mes trabajas».
 *
 * REGLA: solo el mes en curso y el inmediatamente anterior. Trabajar sobre un
 * mes más viejo no tiene sentido en este reporte — las reglas, los parámetros
 * (tasa, días hábiles) y el detalle por cuenta se guardan por periodo, y solo
 * existen para los meses que se están cerrando.
 *
 * EXCEPCIÓN: el mes de trabajo fijado SIEMPRE aparece, aunque se haya quedado
 * fuera de ese par. Si el 1 de noviembre el equipo sigue cerrando octubre y
 * nadie cambió nada, el mes fijado es septiembre, y esconderlo dejaría la
 * pantalla mostrando un mes que no se puede ni ver ni deseleccionar.
 *
 * Módulo puro a propósito: sin Supabase y sin `new Date()` por dentro, para
 * poder probar el cambio de mes y el de año sin tocar el reloj.
 */

/** Mes anterior a un periodo `aaaa-mm`. Cruza el año. */
export function mesAnterior(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number);
  if (!a || !m || m < 1 || m > 12) return periodo;
  const d = m === 1 ? 12 : m - 1;
  const anio = m === 1 ? a - 1 : a;
  return `${anio}-${String(d).padStart(2, '0')}`;
}

/** Periodo `aaaa-mm` de una fecha `aaaa-mm-dd`. */
export function periodoDeFecha(fecha: string): string {
  return fecha.slice(0, 7);
}

/**
 * Los meses que se ofrecen, del más reciente al más viejo.
 *
 * @param hoy        Fecha de hoy `aaaa-mm-dd` (se inyecta; no se lee el reloj).
 * @param mesTrabajo Mes fijado hoy, o `null` si todavía no hay ninguno.
 */
export function mesesSeleccionables(hoy: string, mesTrabajo: string | null): string[] {
  const actual = periodoDeFecha(hoy);
  const meses = new Set([actual, mesAnterior(actual)]);
  if (mesTrabajo) meses.add(mesTrabajo);
  return [...meses].sort().reverse();
}

/**
 * Hoy, `aaaa-mm-dd`, en la zona del negocio.
 *
 * NO se usa la del navegador: con `America/Caracas` el mes cambia a la vez para
 * todo el mundo. Alguien conectado desde otra zona veria el mes nuevo antes (o
 * despues) que el resto, y la lista de meses dejaria de coincidir con la que
 * usa la corrida programada, que ya trabaja en esta zona.
 */
export const ZONA_NEGOCIO = 'America/Caracas';

export function hoyISO(zona: string = ZONA_NEGOCIO): string {
  // 'en-CA' da directamente 'aaaa-mm-dd'.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
