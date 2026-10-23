import type { Metodo, Parametro, Regla } from '../engine';
import { formula, prom, mediana, ultimo } from '../engine';

/**
 * CP-35 · «¿Por qué este número?».
 *
 * Al pulsar una cifra, reconstruye la traza paso a paso del cálculo de esa regla
 * en el escenario elegido: acumulado, ritmo diario, días normales y finales con
 * factor, la serie usada, el método y su valor, el ajuste al causado y a qué
 * cuenta/centro/Combinada va el resultado.
 *
 * Es un desglose **acotado** del cálculo (no reinstrumenta el motor paso por
 * paso): recompone los números que alimentan la fórmula para el método de la
 * regla. Para métodos compuestos o de capas (que la Fase 2 dejó como andamiaje)
 * muestra el método, el valor y el resultado final sin desglosar cada paso.
 */

export type EscenarioTraza = 'PROYECCION' | 'CAUSADO';

/** Una línea del desglose: etiqueta + valor (ya formateado por el componente). */
export interface LineaTraza {
  etiqueta: string;
  /** Valor numérico; el componente lo formatea con `fmt`. */
  valor?: number;
  /** Cantidad de decimales sugerida al formatear. */
  decimales?: number;
  /** Texto libre cuando el dato no es un número (p. ej. la fórmula en palabras). */
  texto?: string;
}

export interface Traza {
  empresa: string;
  concepto: string;
  escenario: EscenarioTraza;
  metodoNombre: string;
  /** Resultado final en USD de la regla en el escenario. */
  resultado: number;
  /** Combinada / cuenta / centro de destino. */
  combinada: string;
  cuenta: string;
  cc: string;
  /** Líneas del desglose en orden de lectura. */
  lineas: LineaTraza[];
}

const CAUSADO_LABEL: Record<string, string> = {
  igual: 'igual (mismo valor que el proyectado)',
  habiles: 'por días hábiles (× transcurridos ÷ días hábiles)',
  calendario: 'por calendario (× día del corte ÷ días del mes)',
  real: 'lo asentado al corte',
};

/**
 * Construye la traza de una regla. `resultado` es el valor ya calculado por el
 * motor para esa regla en el escenario (val[i]).
 */
export function trazaRegla(
  regla: Regla,
  metodo: Metodo | undefined,
  param: Parametro | undefined,
  escenario: EscenarioTraza,
  resultado: number,
): Traza {
  const lineas: LineaTraza[] = [];
  const op = metodo?.op;
  const n = regla.n ?? 9;

  lineas.push({
    etiqueta: 'Método',
    texto: metodo ? `${metodo.nombre} — ${formula(metodo)}` : regla.metodo,
  });
  if (regla.valor != null) lineas.push({ etiqueta: 'Valor de la regla', valor: regla.valor, decimales: 4 });

  if (op === 'formula_venta') {
    const dias = param?.dias ?? 0;
    const trans = param?.trans ?? 0;
    const factor = param?.factor ?? 1;
    const restantes = dias - trans;
    const ritmo = trans ? regla.acum / trans : 0;
    const normales = Math.max(restantes - 5, 0);
    const finales = Math.min(restantes, 5);
    lineas.push({ etiqueta: 'Acumulado al corte', valor: regla.acum, decimales: 2 });
    if (escenario === 'CAUSADO') {
      lineas.push({
        etiqueta: 'Escenario Causado',
        texto: 'la fórmula de venta usa el acumulado real al corte (no extrapola).',
      });
    } else {
      lineas.push({ etiqueta: 'Días hábiles del mes', valor: dias });
      lineas.push({ etiqueta: 'Días transcurridos', valor: trans });
      lineas.push({ etiqueta: 'Días restantes', valor: restantes });
      lineas.push({ etiqueta: 'Ritmo diario (acum ÷ transcurridos)', valor: ritmo, decimales: 2 });
      lineas.push({ etiqueta: 'Días normales (restantes − 5)', valor: normales });
      lineas.push({ etiqueta: 'Días finales (× factor)', valor: finales });
      lineas.push({ etiqueta: 'Factor de días finales', valor: factor, decimales: 3 });
      if (!regla.acum)
        lineas.push({
          etiqueta: 'Sin acumulado',
          texto: `se usa el promedio histórico de ${n} meses.`,
        });
    }
  } else if (op === 'promedio') {
    lineas.push({ etiqueta: 'Meses promediados (N)', valor: n });
    lineas.push({ etiqueta: 'Promedio de la serie', valor: prom(regla.serie, n), decimales: 2 });
  } else if (op === 'mediana') {
    lineas.push({ etiqueta: 'Meses considerados (N)', valor: n });
    lineas.push({ etiqueta: 'Mediana de la serie', valor: mediana(regla.serie, n), decimales: 2 });
  } else if (op === 'ultimo') {
    lineas.push({ etiqueta: 'Último mes con registro', valor: ultimo(regla.serie), decimales: 2 });
  } else if (op === 'presupuesto') {
    lineas.push({ etiqueta: 'Presupuesto del periodo', valor: regla.presupuesto ?? 0, decimales: 2 });
  } else if (op === 'porcentaje' || op === 'multiplicar') {
    lineas.push({
      etiqueta: 'Base del cálculo',
      texto: 'se multiplica el valor por la base (venta, grupo o concepto) del turno anterior.',
    });
  }

  // Serie usada (últimos N meses con registro), acotada para la lectura.
  const serie = (regla.serie || []).slice(-n);
  if (serie.length)
    lineas.push({
      etiqueta: `Serie usada (${serie.length} meses)`,
      texto: serie
        .map((v) => (v == null || Number.isNaN(v) ? '·' : Math.round(v).toLocaleString('es-VE')))
        .join('  '),
    });

  // Ajuste al causado (solo en el escenario Causado y si no es venta/derivada).
  if (escenario === 'CAUSADO' && op !== 'formula_venta' && op !== 'derivada') {
    const modo = regla.causado ?? 'igual';
    lineas.push({ etiqueta: 'Ajuste al causado', texto: CAUSADO_LABEL[modo] ?? modo });
  }

  lineas.push({ etiqueta: 'Resultado (USD)', valor: resultado, decimales: 2 });

  return {
    empresa: regla.empresa,
    concepto: regla.concepto,
    escenario,
    metodoNombre: metodo?.nombre ?? regla.metodo,
    resultado,
    combinada: regla.combinada,
    cuenta: regla.cuenta,
    cc: regla.cc,
    lineas,
  };
}
