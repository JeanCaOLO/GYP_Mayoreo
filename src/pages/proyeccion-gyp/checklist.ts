/**
 * CP-44 · Checklist antes de publicar (Fase 7, Verificación permanente).
 *
 * Módulo PURO: no habla con la red ni con Supabase. Recibe las filas de salida
 * ya construidas de los DOS escenarios (lo que `salida.ts` produce con
 * `aFilaFinal`/`filasDeRegla`), el catálogo de Combinadas (`dim_cuenta`), los
 * insumos de las comprobaciones que dependen del motor (prueba contable CP-47 y
 * cuadre reglas-por-cuenta CP-21) y, opcionalmente, el total USD del mes anterior
 * por empresa. Devuelve la lista de ítems del checklist y un `puedePublicar`.
 *
 * La publicación (manual en `page.tsx` y automática en la Edge Function
 * `corrida-programada`) corre este checklist y lo muestra en pantalla. Un fallo
 * BLOQUEANTE (comprobaciones 1-8) impide publicar; la comprobación 9 (variación
 * del total USD frente al mes anterior) solo AVISA, nunca bloquea. Un checklist
 * sin bloqueantes fallidos ⇒ `puedePublicar = true`.
 *
 * Las nueve comprobaciones del §7 (CP-44):
 *   1. La prueba contable de la Renta Bruta cuadra en las seis empresas (CP-47;
 *      reutiliza `empresasPruebaFallida` de `components/pruebaContable.ts`).
 *   2. Cada escenario lleva las llaves que le corresponden según CP-49.
 *   3. Toda `Combinada` existe en `dim_cuenta` (reutiliza `validarContraCatalogo`).
 *   4. `FECHA` = día 1 del periodo, en todas las filas.
 *   5. `Pais` lleno en las seis empresas (CP-52).
 *   6. `Tasa_Mensual` no nula para Cofersa y Mundial, nula para el resto (CP-05).
 *   7. Ninguna `Combinada` repetida dentro de un mismo escenario.
 *   8. La suma de las reglas por cuenta más el resto cuadra con el concepto
 *      (CP-21; el llamador arma el cuadre con `insumosDelResto` de `destino.ts`).
 *   9. El total en USD por empresa es del orden del mes anterior: una variación
 *      grande se AVISA, no se bloquea.
 *
 * _Requirements: 29.1, 29.2, 29.3_
 */

import type { FilaResultado } from './data';
import { fechaDia1, validarContraCatalogo, llevaTasaMensual, type CatalogoCombinadas } from './salida';
import { empresasPruebaFallida, type DesgloseRentaBruta } from './components/pruebaContable';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del resultado
// ─────────────────────────────────────────────────────────────────────────────

/** Número de cada comprobación del checklist (CP-44, 1..9). */
export type NumeroItem = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Un ítem del checklist: el resultado de una de las nueve comprobaciones. */
export interface ItemChecklist {
  /** Número de la comprobación (1..9), en el orden del CP-44. */
  n: NumeroItem;
  /** Título legible de la comprobación. */
  titulo: string;
  /** ¿Pasó la comprobación? */
  ok: boolean;
  /**
   * ¿Un fallo detiene la publicación? Las comprobaciones 1-8 son bloqueantes; la
   * 9 (variación del total USD) es solo de aviso.
   */
  bloqueante: boolean;
  /**
   * Detalle legible: vacío cuando `ok`, o la lista de problemas concretos
   * (empresas, combinadas, escenarios) cuando falla. En la comprobación 9
   * describe la variación aunque `ok` sea true (es un aviso, no un fallo).
   */
  detalle: string[];
}

/** Resultado completo del checklist CP-44. */
export interface ResultadoChecklist {
  /** Los nueve ítems, en orden. */
  items: ItemChecklist[];
  /**
   * `false` si alguna comprobación BLOQUEANTE (1-8) falló. La comprobación 9 no
   * afecta este valor: una variación grande avisa pero deja publicar.
   */
  puedePublicar: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entradas del checklist
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un cuadre de un concepto para la comprobación 8 (CP-21): la suma de las reglas
 * por cuenta más el resto debe reproducir el total del concepto. El llamador arma
 * estos cuadres con los insumos de `destino.ts` (`insumosDelResto`): `reglas` es
 * la suma de los montos de las reglas por cuenta, `resto` el monto del concepto
 * sobre el resto de sus cuentas, y `concepto` el total que debería cuadrar.
 */
export interface CuadreConcepto {
  empresa: string;
  concepto: string;
  /** Suma de los montos de las reglas por cuenta del concepto. */
  reglas: number;
  /** Monto del concepto estimado sobre «el resto» de sus cuentas. */
  resto: number;
  /**
   * Total del concepto que debe cuadrar con `reglas + resto`.
   * Se llama `total` y no `concepto` porque `concepto` ya es el NOMBRE
   * del concepto (string): declarar los dos con el mismo nombre dejaba
   * el campo resuelto como string y la comprobacion 8 muerta.
   */
  total: number;
}

/**
 * Las filas de salida de UN escenario, con su desglose de la Renta Bruta (CP-47)
 * y los cuadres de reglas-por-cuenta (CP-21) de ese escenario.
 *
 * `proyeccion` identifica el escenario (1 = Proyectado al cierre, 2 = Causado al
 * corte) y sirve para la comprobación 2 (CP-49): toda fila del escenario debe
 * declarar ese mismo `proyeccion`.
 */
export interface EscenarioChecklist {
  /** 1 = Proyectado al cierre, 2 = Causado al corte. */
  proyeccion: 1 | 2;
  /** Nombre legible del escenario (para los detalles). */
  nombre: string;
  /** Filas de salida del escenario (una por cuenta de destino, ya fusionadas). */
  filas: FilaResultado[];
  /** Desglose de la Renta Bruta por empresa del escenario (CP-47). */
  desgloses: DesgloseRentaBruta[];
  /** Cuadres reglas-por-cuenta + resto = concepto del escenario (CP-21). */
  cuadres: CuadreConcepto[];
}

/** Opciones del checklist. */
export interface OpcionesChecklist {
  /** Periodo `aaaa-mm` (o `aaaa-mm-dd`); fija la `FECHA` esperada (día 1). */
  periodo: string;
  /** Las seis empresas del P&L, para la comprobación 5 (Pais lleno). */
  empresas: readonly string[];
  /** Catálogo de Combinadas válidas de `dim_cuenta` (CP-07 / comprobación 3). */
  dimCuenta: CatalogoCombinadas;
  /**
   * Total USD por empresa del MES ANTERIOR, para la comprobación 9 (aviso de
   * variación). Opcional: sin él la comprobación 9 no se puede evaluar y queda en
   * verde con un detalle explicativo (nunca bloquea).
   */
  totalMesAnteriorPorEmpresa?: Record<string, number> | null;
  /**
   * Umbral de variación relativa a partir del cual la comprobación 9 avisa.
   * Default 0,30 (±30 %). Un total nuevo que se sale de ese margen se señala.
   */
  umbralVariacion?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes del contrato
// ─────────────────────────────────────────────────────────────────────────────

/** Tolerancia en USD para los cuadres de la comprobación 8 (CP-21). */
const TOLERANCIA_USD = 0.01;

/** Umbral de variación por defecto de la comprobación 9 (±30 %). */
const UMBRAL_VARIACION_DEFAULT = 0.3;

// ─────────────────────────────────────────────────────────────────────────────
// Comprobaciones (una función pura por cada punto del CP-44)
// ─────────────────────────────────────────────────────────────────────────────

/** Todas las filas de los dos escenarios, en un solo arreglo. */
function todasLasFilas(escenarios: EscenarioChecklist[]): FilaResultado[] {
  return escenarios.flatMap((e) => e.filas);
}

/**
 * 1 · La prueba contable de la Renta Bruta cuadra en las seis empresas (CP-47).
 * Reutiliza `empresasPruebaFallida`: si alguna empresa de algún escenario no
 * cuadra, la lista de detalles la nombra y el ítem falla.
 */
function comprobar1PruebaContable(escenarios: EscenarioChecklist[]): ItemChecklist {
  const detalle: string[] = [];
  for (const esc of escenarios) {
    const fallidas = empresasPruebaFallida(esc.desgloses);
    for (const empresa of fallidas) {
      detalle.push(`${esc.nombre}: la Renta Bruta de ${empresa} no cuadra (CP-47).`);
    }
  }
  return {
    n: 1,
    titulo: 'Prueba contable de la Renta Bruta en las seis empresas',
    ok: detalle.length === 0,
    bloqueante: true,
    detalle,
  };
}

/**
 * 2 · Cada escenario lleva las llaves que le corresponden según CP-49: toda fila
 * del escenario debe declarar el `proyeccion` del escenario (1 o 2). Una fila con
 * otro `proyeccion` sería una llave del escenario equivocado.
 */
function comprobar2LlavesPorEscenario(escenarios: EscenarioChecklist[]): ItemChecklist {
  const detalle: string[] = [];
  for (const esc of escenarios) {
    const descolocadas = new Set<string>();
    for (const f of esc.filas) {
      if (f.proyeccion !== esc.proyeccion) descolocadas.add(f.combinada);
    }
    for (const combinada of descolocadas) {
      detalle.push(
        `${esc.nombre}: la Combinada ${combinada} tiene Proyeccion distinta de ${esc.proyeccion} (CP-49).`,
      );
    }
  }
  return {
    n: 2,
    titulo: 'Cada escenario lleva sus llaves (CP-49)',
    ok: detalle.length === 0,
    bloqueante: true,
    detalle,
  };
}

/**
 * 3 · Toda `Combinada` existe en `dim_cuenta` (CP-07). Reutiliza
 * `validarContraCatalogo` sobre las filas de los dos escenarios juntos; las
 * Combinadas huérfanas se nombran.
 */
function comprobar3Catalogo(
  escenarios: EscenarioChecklist[],
  dimCuenta: CatalogoCombinadas,
): ItemChecklist {
  const huerfanas = validarContraCatalogo(todasLasFilas(escenarios), dimCuenta);
  return {
    n: 3,
    titulo: 'Toda Combinada existe en dim_cuenta (CP-07)',
    ok: huerfanas.length === 0,
    bloqueante: true,
    detalle: huerfanas.map((c) => `Combinada huérfana sin catálogo: ${c}.`),
  };
}

/**
 * 4 · `FECHA` = día 1 del periodo, en todas las filas (CP-04). Cualquier fila con
 * una fecha distinta al día 1 esperado se señala.
 */
function comprobar4Fecha(escenarios: EscenarioChecklist[], periodo: string): ItemChecklist {
  const esperada = fechaDia1(periodo);
  const malas = new Set<string>();
  for (const f of todasLasFilas(escenarios)) {
    if (f.fecha !== esperada) malas.add(`${f.combinada} (${f.fecha})`);
  }
  return {
    n: 4,
    titulo: `FECHA = día 1 del periodo (${esperada})`,
    ok: malas.size === 0,
    bloqueante: true,
    detalle: [...malas].map((d) => `FECHA distinta del día 1: ${d}.`),
  };
}

/**
 * 5 · `Pais` lleno en las seis empresas (CP-52). Se revisan dos cosas: ninguna
 * fila con `Pais` vacío, y que cada una de las seis empresas aparezca con país.
 */
function comprobar5Pais(
  escenarios: EscenarioChecklist[],
  empresas: readonly string[],
): ItemChecklist {
  const detalle: string[] = [];
  // Ninguna fila con país vacío.
  const vacias = new Set<string>();
  const paisPorEmpresa = new Map<string, string>();
  for (const f of todasLasFilas(escenarios)) {
    if (f.pais == null || f.pais === '') vacias.add(`${f.empresa} / ${f.combinada}`);
    else if (!paisPorEmpresa.has(f.empresa)) paisPorEmpresa.set(f.empresa, f.pais);
  }
  for (const d of vacias) detalle.push(`Fila sin país (CP-52): ${d}.`);
  // Cada una de las seis empresas debe tener al menos una fila con país.
  for (const e of empresas) {
    if (!paisPorEmpresa.has(e)) {
      detalle.push(`${e} no tiene ninguna fila con país (CP-52).`);
    }
  }
  return {
    n: 5,
    titulo: 'Pais lleno en las seis empresas (CP-52)',
    ok: detalle.length === 0,
    bloqueante: true,
    detalle,
  };
}

/**
 * 6 · `Tasa_Mensual` no nula para Cofersa y Mundial, nula para el resto (CP-05).
 * Se apoya en `llevaTasaMensual`: una empresa con tasa que debería ser nula, o
 * sin tasa cuando debería tenerla, se señala.
 */
function comprobar6TasaMensual(escenarios: EscenarioChecklist[]): ItemChecklist {
  const detalle = new Set<string>();
  for (const f of todasLasFilas(escenarios)) {
    const debeLlevar = llevaTasaMensual(f.empresa);
    const tiene = f.tasa_mensual != null;
    if (debeLlevar && !tiene) {
      detalle.add(`${f.empresa} / ${f.combinada}: falta Tasa_Mensual (CP-05).`);
    } else if (!debeLlevar && tiene) {
      detalle.add(`${f.empresa} / ${f.combinada}: Tasa_Mensual debería ser nula (CP-05).`);
    }
  }
  return {
    n: 6,
    titulo: 'Tasa_Mensual solo para Cofersa y Mundial (CP-05)',
    ok: detalle.size === 0,
    bloqueante: true,
    detalle: [...detalle],
  };
}

/**
 * 7 · Ninguna `Combinada` repetida dentro de un mismo escenario. Una Combinada
 * duplicada en un escenario violaría el índice único `(periodo, escenario,
 * combinada)` de CP-02; la fusión de `salida.ts` debería haberla evitado, así que
 * un duplicado aquí señala un fallo de la fusión.
 */
function comprobar7SinDuplicados(escenarios: EscenarioChecklist[]): ItemChecklist {
  const detalle: string[] = [];
  for (const esc of escenarios) {
    const vistas = new Set<string>();
    const repetidas = new Set<string>();
    for (const f of esc.filas) {
      if (vistas.has(f.combinada)) repetidas.add(f.combinada);
      else vistas.add(f.combinada);
    }
    for (const c of repetidas) {
      detalle.push(`${esc.nombre}: Combinada repetida ${c}.`);
    }
  }
  return {
    n: 7,
    titulo: 'Ninguna Combinada repetida por escenario',
    ok: detalle.length === 0,
    bloqueante: true,
    detalle,
  };
}

/**
 * 8 · La suma de las reglas por cuenta más el resto cuadra con el concepto
 * (CP-21). Para cada cuadre aportado, `reglas + resto` debe reproducir `concepto`
 * a ±0,01 USD; un cuadre que no cierra señala doble conteo o reparto mal migrado.
 */
function comprobar8CuadreReglasResto(escenarios: EscenarioChecklist[]): ItemChecklist {
  const detalle: string[] = [];
  for (const esc of escenarios) {
    for (const c of esc.cuadres) {
      const suma = c.reglas + c.resto;
      const diferencia = suma - c.total;
      if (Math.abs(diferencia) > TOLERANCIA_USD) {
        detalle.push(
          `${esc.nombre}: ${c.empresa} / ${c.concepto}: reglas (${c.reglas.toFixed(2)}) + resto (${c.resto.toFixed(2)}) = ${suma.toFixed(2)} ≠ concepto (${c.total.toFixed(2)}), diferencia ${diferencia.toFixed(2)} (CP-21).`,
        );
      }
    }
  }
  return {
    n: 8,
    titulo: 'Reglas por cuenta + resto cuadran con el concepto (CP-21)',
    ok: detalle.length === 0,
    bloqueante: true,
    detalle,
  };
}

/**
 * 9 · El total en USD por empresa es del orden del mes anterior (AVISO, no
 * bloquea). Suma el `Monto_USD` por empresa de los dos escenarios (como los
 * escenarios se publican en append, se usa el proyectado al cierre: escenario 1)
 * y lo compara con el total del mes anterior. Una variación relativa por encima
 * del umbral se describe en el detalle, pero el ítem NO es bloqueante.
 *
 * Sin `totalMesAnteriorPorEmpresa` no hay con qué comparar: el ítem queda en
 * verde con un detalle explicativo (y, por ser aviso, nunca bloquea igualmente).
 */
function comprobar9VariacionTotal(
  escenarios: EscenarioChecklist[],
  opts: OpcionesChecklist,
): ItemChecklist {
  const anterior = opts.totalMesAnteriorPorEmpresa;
  if (anterior == null) {
    return {
      n: 9,
      titulo: 'Total USD por empresa del orden del mes anterior (aviso)',
      ok: true,
      bloqueante: false,
      detalle: ['Sin total del mes anterior: no se evalúa la variación (solo aviso).'],
    };
  }

  const umbral = opts.umbralVariacion ?? UMBRAL_VARIACION_DEFAULT;

  // Total USD del escenario Proyectado al cierre (escenario 1) por empresa. Si no
  // hay escenario 1, se usan todas las filas disponibles como aproximación.
  const esc1 = escenarios.find((e) => e.proyeccion === 1);
  const filas = esc1 ? esc1.filas : todasLasFilas(escenarios);
  const totalActual = new Map<string, number>();
  for (const f of filas) {
    totalActual.set(f.empresa, (totalActual.get(f.empresa) ?? 0) + f.monto_usd);
  }

  const detalle: string[] = [];
  for (const [empresa, prev] of Object.entries(anterior)) {
    const actual = totalActual.get(empresa) ?? 0;
    // Variación relativa respecto al mes anterior. Con base cero se mira la
    // magnitud absoluta del nuevo total como señal.
    const base = Math.abs(prev);
    const variacion = base > 0 ? Math.abs(actual - prev) / base : actual === 0 ? 0 : 1;
    if (variacion > umbral) {
      const pct = (variacion * 100).toFixed(0);
      detalle.push(
        `${empresa}: total USD ${actual.toFixed(2)} vs mes anterior ${prev.toFixed(2)} (variación ${pct} %).`,
      );
    }
  }

  // Es un AVISO: aunque haya variaciones grandes, `ok` refleja que no hay nada que
  // bloquee. Se mantiene `ok: true` siempre; el detalle comunica las variaciones.
  return {
    n: 9,
    titulo: 'Total USD por empresa del orden del mes anterior (aviso)',
    ok: true,
    bloqueante: false,
    detalle,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// checklistPublicacion — función pura principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Corre el checklist CP-44 sobre los dos escenarios y devuelve los nueve ítems y
 * si se puede publicar. Las comprobaciones 1-8 son bloqueantes; la 9 es un aviso.
 *
 * `puedePublicar` es `false` si y solo si alguna comprobación bloqueante falló.
 * La comprobación 9 nunca lo afecta (variación grande ⇒ aviso, no bloqueo).
 *
 * Función PURA: no muta sus entradas ni habla con la red. La UI (`page.tsx`) y la
 * corrida programada muestran `items` en pantalla y respetan `puedePublicar`.
 *
 * @param escenarios Los dos escenarios con sus filas, desgloses y cuadres.
 * @param opts       Periodo, empresas, catálogo y total del mes anterior.
 * @returns          Los nueve ítems y `puedePublicar`.
 *
 * _Requirements: 29.1, 29.2, 29.3_
 */
export function checklistPublicacion(
  escenarios: EscenarioChecklist[],
  opts: OpcionesChecklist,
): ResultadoChecklist {
  const items: ItemChecklist[] = [
    comprobar1PruebaContable(escenarios),
    comprobar2LlavesPorEscenario(escenarios),
    comprobar3Catalogo(escenarios, opts.dimCuenta),
    comprobar4Fecha(escenarios, opts.periodo),
    comprobar5Pais(escenarios, opts.empresas),
    comprobar6TasaMensual(escenarios),
    comprobar7SinDuplicados(escenarios),
    comprobar8CuadreReglasResto(escenarios),
    comprobar9VariacionTotal(escenarios, opts),
  ];

  const puedePublicar = items.every((item) => item.ok || !item.bloqueante);

  return { items, puedePublicar };
}
