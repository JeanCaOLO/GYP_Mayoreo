/**
 * Parametrización de octubre 2026 (CP-42) — carga de DATOS, no de cálculo.
 *
 * 69 de las 95 reglas cambiaron de método o de porcentaje con la calibración de
 * octubre (ver `12-cambios-para-produccion.md` → CP-42 y el criterio detallado
 * en `07-parametrizacion-oct-2026.md`). La parametrización NO es código del
 * motor: es una reasignación de método/valor que se aplica sobre las reglas de
 * partida y que queda COMO PUNTO DE PARTIDA COMPARTIDO.
 *
 * Orden de aplicación (Requirement 8.2):
 *
 *   reglas de partida  →  aplicarParametrizacion()  →  cambios de usuario (overrides)
 *   (REGLAS_SEED)          (esta capa, CP-42)            (data.ts, arriba de todo)
 *
 * La parametrización se aplica POR DEBAJO de los cambios de usuario: nunca los
 * pisa. En data.ts el flujo encaja así: primero se parte de las reglas de
 * partida, luego se aplica `aplicarParametrizacion` para obtener la base
 * compartida, y por último se superponen las reglas cambiadas/nuevas/eliminadas
 * que la persona guardó (persistencia compartida, CP-37). Si una regla tiene
 * cambio de usuario, ese cambio gana; si no, queda el valor parametrizado.
 *
 * Reglas protegidas (Requirement 8.3) que la parametrización NUNCA modifica:
 *   - Ventas            → fórmula de venta sobre su propio acumulado
 *   - Costo de Ventas   → fórmula de venta sobre su propio acumulado
 *   - Fletes Recuperados→ fórmula de venta sobre su propio acumulado
 *   - Colocación de Prisma → derivada sobre la venta de Prisma
 *
 * IMPORTANTE: la parametrización NO se aplica en el oráculo de los 190 casos
 * (engine.test.ts), que usa las reglas de partida sin parametrizar. Este módulo
 * no toca el motor ni los 190 casos; son funciones puras de reasignación de
 * datos sobre la lista de reglas.
 */

import type { Regla, Causado, EscenarioRegla } from './engine';

// ─────────────────────────────────────────────────────────────────────────────
// Estructura de una entrada de parametrización
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una entrada de parametrización reasigna el método y/o el valor de UNA regla,
 * identificada por empresa + concepto (que es la llave estable de una regla de
 * partida; una regla por empresa y concepto).
 *
 * Es carga de datos: refleja lo que control acordó para octubre. Todos los
 * campos de método son opcionales salvo la identidad; se aplica solo lo que la
 * entrada trae, dejando el resto de la regla intacto.
 */
export interface EntradaParametrizacion {
  /** Empresa de la regla a reasignar (Beval, Febeca, Sillaca, Cofersa, Mundial, Prisma). */
  empresa: string;
  /** Concepto de la regla a reasignar (p. ej. 'Personal Fijo', 'Alquileres'). */
  concepto: string;
  /** Método de fábrica nuevo (id de METODOS_BASE, p. ej. 'm_mediana', 'm_ultimo'). */
  metodo?: string;
  /**
   * Valor nuevo. En porcentaje va en tanto por uno (0.00137 = 0,137 %); null
   * para métodos sin valor (mediana, último, promedio). Si se omite, se conserva
   * el valor de la regla de partida.
   */
  valor?: number | null;
  /** Meses a promediar/mediar (N). Si se omite, se conserva el N de partida. */
  mesesPromedio?: number | null;
  /** Escenario(s) en que participa, si la parametrización lo cambia. */
  escenarios?: EscenarioRegla;
  /** Modo de causado del §E, si la parametrización lo cambia. */
  causado?: Causado;
  /** Motivo/criterio del cambio (trazabilidad; p. ej. "mediana 12m, Beval sin mes atípico"). */
  motivo?: string;
}

/** La parametrización completa de un periodo: lista de reasignaciones + metadatos. */
export interface Parametrizacion {
  /** Periodo al que pertenece la parametrización (p. ej. '2026-10'). */
  periodo: string;
  /** Reasignaciones de método/valor por regla. */
  entradas: EntradaParametrizacion[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas protegidas (Requirement 8.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conceptos que conservan su fórmula de venta sobre su propio acumulado y que la
 * parametrización NUNCA toca, sea cual sea la empresa.
 */
export const CONCEPTOS_PROTEGIDOS: ReadonlySet<string> = new Set([
  'Ventas',
  'Costo de Ventas',
  'Fletes Recuperados',
]);

/** Pares empresa+concepto protegidos específicos (la Colocación de Prisma, derivada). */
const PROTEGIDOS_POR_EMPRESA: ReadonlySet<string> = new Set([
  'Prisma|Colocacion',
]);

/**
 * ¿Es una regla protegida que la parametrización debe dejar intacta? (CP-42,
 * Requirement 8.3.) Protege Ventas, Costo de Ventas y Fletes Recuperados de
 * cualquier empresa, más la Colocación de Prisma.
 */
export function esReglaProtegida(regla: Pick<Regla, 'empresa' | 'concepto'>): boolean {
  if (CONCEPTOS_PROTEGIDOS.has(regla.concepto)) return true;
  return PROTEGIDOS_POR_EMPRESA.has(`${regla.empresa}|${regla.concepto}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Aplicación de la parametrización (función pura)
// ─────────────────────────────────────────────────────────────────────────────

/** Llave estable de una regla para emparejar con la parametrización. */
function llaveRegla(r: Pick<Regla, 'empresa' | 'concepto'>): string {
  return `${r.empresa}|${r.concepto}`;
}

/**
 * Aplica la parametrización sobre las reglas de partida y devuelve una lista
 * NUEVA de reglas (no muta la entrada). Para cada regla:
 *
 *   - Si es una regla protegida (Requirement 8.3) → se deja intacta, aunque la
 *     parametrización traiga una entrada para ella (defensa en profundidad).
 *   - Si hay una entrada de parametrización que la empareja → se reasigna método
 *     y/o valor (y, si vienen, N, escenarios y causado). Los campos que la
 *     entrada no trae se conservan de la regla de partida.
 *   - Si no hay entrada → la regla queda igual que la de partida.
 *
 * Esta es la capa "por debajo del usuario" (Requirement 8.2): produce el punto
 * de partida compartido. Los cambios de usuario se superponen DESPUÉS, en el
 * flujo de overrides de data.ts.
 */
export function aplicarParametrizacion(
  reglasBase: readonly Regla[],
  parametrizacion: Parametrizacion | null | undefined,
): Regla[] {
  const entradas = parametrizacion?.entradas ?? [];
  const porLlave = new Map<string, EntradaParametrizacion>();
  for (const e of entradas) {
    porLlave.set(`${e.empresa}|${e.concepto}`, e);
  }

  return reglasBase.map((regla) => {
    // Las reglas protegidas no se tocan nunca (Requirement 8.3).
    if (esReglaProtegida(regla)) return { ...regla };

    const entrada = porLlave.get(llaveRegla(regla));
    if (!entrada) return { ...regla };

    const reasignada: Regla = { ...regla };
    if (entrada.metodo !== undefined) reasignada.metodo = entrada.metodo;
    if (entrada.valor !== undefined) reasignada.valor = entrada.valor;
    if (entrada.mesesPromedio !== undefined) reasignada.n = entrada.mesesPromedio;
    if (entrada.escenarios !== undefined) reasignada.escenarios = entrada.escenarios;
    if (entrada.causado !== undefined) reasignada.causado = entrada.causado;
    return reasignada;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Carga de la parametrización (stubs — los datos concretos de octubre faltan)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carga la parametrización desde un JSON como el del prototipo
 * (`prototipo/datos/parametrizacion_2026-10.json`).
 *
 * PENDIENTE DE DATOS: el JSON concreto de octubre (las 69 reglas recalibradas)
 * venía en el paquete del prototipo externo y todavía NO está en este workspace.
 * El criterio de cada reasignación está en `07-parametrizacion-oct-2026.md`
 * (mediana 29, último mes 14, proporción de la venta 11, % sobre venta 9,
 * promedio 6; el resto son ventas/costo/fletes/derivadas o quedan igual).
 *
 * Cuando el JSON exista, esta función solo valida su forma y lo devuelve como
 * `Parametrizacion`; la aplicación ya está resuelta en `aplicarParametrizacion`.
 */
export function parametrizacionDesdeJson(
  raw: unknown,
  periodo: string,
): Parametrizacion {
  // Forma esperada del JSON: { entradas: EntradaParametrizacion[] } o un arreglo
  // plano de entradas. Se normalizan ambas para no acoplarse al formato exacto
  // del prototipo hasta tener el archivo real.
  const entradas: EntradaParametrizacion[] = Array.isArray(raw)
    ? (raw as EntradaParametrizacion[])
    : Array.isArray((raw as { entradas?: unknown })?.entradas)
      ? ((raw as { entradas: EntradaParametrizacion[] }).entradas)
      : [];
  return { periodo, entradas };
}

/**
 * Carga la parametrización desde Supabase. La tabla `proyeccion_regla` ya tiene
 * las columnas necesarias (método, valor, N, escenarios, causado) tras la
 * migración del §4, de modo que la parametrización puede vivir allí como el
 * conjunto de reglas de partida del periodo.
 *
 * PENDIENTE DE DATOS: hasta que se carguen las 69 reglas de octubre en
 * `proyeccion_regla` (según `07-parametrizacion-oct-2026.md`), este cargador
 * devuelve una parametrización vacía, lo que hace que `aplicarParametrizacion`
 * sea la identidad sobre las reglas de partida. La lectura concreta se conecta
 * en la capa de datos (data.ts, tarea 12.x); aquí queda el contrato y el stub.
 *
 * @param _periodo periodo a leer (p. ej. '2026-10').
 * @param _cargar  función inyectable que trae las filas de `proyeccion_regla`
 *                  parametrizadas para el periodo. Se inyecta para mantener este
 *                  módulo puro y testeable sin tocar la red.
 */
export async function parametrizacionDesdeSupabase(
  _periodo: string,
  _cargar?: (periodo: string) => Promise<EntradaParametrizacion[]>,
): Promise<Parametrizacion> {
  // TODO(CP-42): conectar con la lectura real de `proyeccion_regla` en data.ts.
  // Los datos concretos de octubre (69 reglas) deben aportarse; ver
  // `07-parametrizacion-oct-2026.md`.
  if (!_cargar) return { periodo: _periodo, entradas: [] };
  const entradas = await _cargar(_periodo);
  return { periodo: _periodo, entradas };
}
