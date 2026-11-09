import { etiquetaConcepto } from '../seed';
import { useCallback, useMemo, useState } from 'react';
import {
  formula,
  type Base,
  type Causado,
  type EscenarioRegla,
  type Metodo,
  type Operacion,
  type Regla,
} from '../engine';
import { recomendar, semaforoDeError, type ErrorOpcion, type Semaforo } from '../wape';
import { fmt } from './formato';
import type { Override } from './PestanaReglas';

/**
 * Panel por regla (CP-24) de la pestaña Reglas.
 *
 * Se abre al pulsar una fila y muestra, en orden (CP-24):
 *   1. Nombre y detalle opcionales (CP-29).
 *   2. «¿Cómo quieres estimar el mes?» — tarjetas con cada opción, su número y
 *      su error WAPE de 6 meses con semáforo (CP-25), vía `recomendar()`.
 *   3. Parámetros según la opción (meses a mirar, % o monto).
 *   4. «Así quedaría» — proyectado, causado, Semi Neto de la empresa y su
 *      diferencia frente a hoy (CP-26).
 *   5. «Avanzado» — causado, escenario, otra fórmula, fórmula propia, destino y
 *      reparto (CP-27).
 *   6. Botones: Guardar · Cancelar · + Otra regla para el concepto · Eliminar ·
 *      Volver a como estaba.
 *
 * Es un componente CONTROLADO liviano: edita un borrador local y al Guardar
 * emite los cambios a `onGuardar` (que los traduce a overrides en page.tsx). El
 * impacto y el número de cada tarjeta salen del motor completo vía `simular`,
 * así que coinciden con lo que queda al guardar.
 */

const COLOR_SEMAFORO: Record<Semaforo, string> = {
  verde: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  ambar: 'border-amber-300 bg-amber-50 text-amber-700',
  rojo: 'border-red-300 bg-red-50 text-red-700',
};
const PUNTO_SEMAFORO: Record<Semaforo, string> = {
  verde: 'bg-emerald-500',
  ambar: 'bg-amber-500',
  rojo: 'bg-red-500',
};

const ESCENARIOS: { id: EscenarioRegla; label: string }[] = [
  { id: 'AMBOS', label: 'Ambos escenarios' },
  { id: 'PROYECCION', label: 'Solo proyectado' },
  { id: 'CAUSADO', label: 'Solo causado' },
];

const CAUSADOS: { id: Causado; label: string }[] = [
  { id: 'igual', label: 'Igual que el proyectado' },
  { id: 'habiles', label: 'Por días hábiles' },
  { id: 'calendario', label: 'Por días de calendario' },
  { id: 'real', label: 'Lo asentado al corte' },
];

/** Borrador editable de una regla dentro del panel. */
interface Borrador {
  metodo: string;
  valor: number | null;
  n: number | null;
  nombre: string;
  detalle: string;
  causado: Causado;
  escenarios: EscenarioRegla;
  cuenta: string;
  cc: string;
}

/** Resultado de recalcular con el borrador de la regla («Así quedaría»). */
export interface SimulacionRegla {
  proy: number;
  caus: number;
  snProy: number;
  snCaus: number;
}

export interface PanelReglaProps {
  regla: Regla;
  /** Monto proyectado actual de la regla (val[i]). */
  valProyeccion: number;
  /** Monto causado actual de la regla (valCausado[i]). */
  valCausado: number;
  /** Semi Neto proyectado de la empresa (agg[empresa].sn). */
  semiNetoProy: number;
  /** Semi Neto causado de la empresa. */
  semiNetoCaus: number;
  metodos: Record<string, Metodo>;
  /** Serie histórica mensual del concepto (para el backtest WAPE). */
  serieConcepto: number[];
  /** Serie histórica mensual de la venta de la empresa (para «según la venta»). */
  serieVenta?: number[];
  /** Crea un método nuevo («+ Crear otra forma») y lo deja disponible para todas. */
  onCrearMetodo?: (m: Metodo) => void;
  /** Recalcula con el borrador sin guardar; sin él, «Así quedaría» muestra lo actual. */
  simular?: (cambios: Partial<Override>) => SimulacionRegla | null;
  onGuardar: (cambios: Partial<Override>) => void;
  onCancelar: () => void;
  onOtraRegla: () => void;
  onEliminar: () => void;
  onVolver: () => void;
}

/** ¿La operación del método pide un valor (% o monto)? */
const OP_PIDE_VALOR = ['porcentaje', 'multiplicar', 'sumar', 'restar', 'valor_fijo'];
/** Operaciones que miran una ventana de meses. */
const OP_PIDE_N = ['promedio', 'mediana', 'ratio_venta'];
/** Operaciones que ya aparecen como tarjeta de historia con su error WAPE. */
const OPS_CON_TARJETA = ['promedio', 'mediana', 'ultimo', 'ratio_venta'];

/**
 * C5 · Modo de causado que le corresponde a cada método de fábrica.
 *
 * Copiado de la tabla `OPCIONES` del prototipo (campo `causa`), que es la
 * referencia de aceptación. `undefined` = el prototipo pone `causa: null`, es
 * decir NO fijar causado: «Como va el mes» (fórmula de venta) y «Del Cargo Fijo
 * del grupo» (derivada) ya son su propio causado (§E / Requirement 13.3).
 */
export const CAUSADO_DE_METODO: Record<string, Causado | undefined> = {
  m_mediana: 'calendario', // Lo típico
  m_promedio: 'calendario', // El promedio
  m_ultimo: 'calendario', // Igual que el mes pasado
  m_ppto: 'calendario', // Lo presupuestado
  m_fijo: 'calendario', // Un monto fijo
  m_ratio_venta: 'igual', // Según la venta
  m_pct_venta: 'igual', // Un % de la venta
  m_pct_semineto: 'igual', // Un % del Semi Neto
  m_venta: undefined, // Como va el mes          → causa: null
  m_derivada: undefined, // Del Cargo Fijo del grupo → causa: null
};

export default function PanelRegla({
  regla,
  valProyeccion,
  valCausado,
  semiNetoProy,
  semiNetoCaus,
  metodos,
  serieConcepto,
  serieVenta,
  onCrearMetodo,
  simular,
  onGuardar,
  onCancelar,
  onOtraRegla,
  onEliminar,
  onVolver,
}: PanelReglaProps) {
  const [b, setB] = useState<Borrador>({
    metodo: regla.metodo,
    valor: regla.valor,
    n: regla.n,
    nombre: regla.nombre ?? '',
    detalle: regla.detalle ?? '',
    causado: regla.causado ?? 'igual',
    escenarios: regla.escenarios ?? 'AMBOS',
    cuenta: regla.cuenta,
    cc: regla.cc,
  });
  const [avanzado, setAvanzado] = useState(false);
  /**
   * P5 · Borrador del campo de porcentaje/monto mientras se escribe.
   *
   * El campo se reformateaba en CADA tecla: `value` salia de
   * `(valor * 100).toFixed(2)`, asi que escribir "35" dejaba "3,01" y no se
   * podia borrar el contenido. Mientras el campo tiene el foco manda lo que la
   * persona escribio; al salir se vuelve a formatear.
   */
  const [txtValor, setTxtValor] = useState<string | null>(null);

  // P4 · ¿La empresa tiene venta con historia? Prisma vive de la Colocación y
  // no la tiene, así que «Según la venta» allí siempre da 0.
  const hayVenta = !!(serieVenta && serieVenta.some((v) => Number.isFinite(v) && v !== 0));
  const [creando, setCreando] = useState(false);

  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB((p) => ({ ...p, [k]: v }));

  /**
   * C5 · Elegir una opción fija también su modo de causado.
   *
   * Antes solo cambiaba el método: el causado se quedaba en 'igual' y el
   * escenario Causado salía inflado (el mes entero en vez de lo que va del
   * mes). El mapeo es el de la tabla `OPCIONES` del prototipo, que es la
   * referencia de aceptación — no una interpretación:
   *
   *   Lo típico · El promedio · Igual que el mes pasado · Lo presupuestado ·
   *   Un monto fijo · Armar mi fórmula        → 'calendario'
   *   Según la venta · Un % de la venta · % del Semi Neto → 'igual'
   *   Como va el mes · Del Cargo Fijo del grupo → NO se toca (`causa: null` en
   *       el prototipo): la fórmula de venta y la derivada ya son su propio
   *       causado (§E / Requirement 13.3).
   *
   * Un método propio del usuario no está en el mapa y conserva su causado: no
   * hay forma de adivinar qué quiso, y cambiárselo en silencio sería peor.
   */
  const elegirMetodo = (id: string, extras?: Partial<Borrador>) => {
    const causado = CAUSADO_DE_METODO[id];
    setB((p) => ({ ...p, metodo: id, valor: null, ...(causado ? { causado } : {}), ...extras }));
  };

  const metodosList = Object.values(metodos);
  const m = metodos[b.metodo];
  const pideValor = m ? OP_PIDE_VALOR.includes(m.op) : false;
  const pideN = m ? OP_PIDE_N.includes(m.op) : false;

  // Recomendación y errores WAPE de las opciones de historia (CP-25, §G).
  const rec = useMemo(
    () => recomendar(serieConcepto, regla.concepto, claveActual(regla, metodos), wrapVenta(serieVenta)),
    [serieConcepto, regla, metodos, serieVenta],
  );

  /**
   * P4 · Solo se ofrecen las opciones que APLICAN a esta regla.
   *
   * Antes se podia poner "Del Cargo Fijo del grupo" o "% del Semi Neto" en
   * cualquier concepto, o "Segun la venta" en Prisma —que vive de la
   * Colocacion y no tiene regla de Ventas, asi que da 0—. Una opcion que
   * siempre devuelve cero no es una opcion: es una trampa.
   *
   * Las reglas son las de `opcionesPara` del prototipo:
   *   - % del Semi Neto   -> solo si la regla es del grupo SEMI
   *   - Del Cargo Fijo    -> solo para el concepto Colocacion
   *   - Segun la venta / % de la venta -> solo si la empresa tiene venta con
   *                          historia y la regla NO es la de Ventas
   *   - Armar mi formula  -> no para Colocacion
   * El metodo que la regla YA tiene se ofrece siempre, para no dejarla sin
   * poder volver a su estado anterior.
   */
  const aplica = useCallback(
    (mm: Metodo): boolean => {
      if (mm.id === regla.metodo) return true; // el actual, siempre
      // `pct_semineto` y `pct_venta` NO son operaciones: las dos son
      // 'porcentaje' y se distinguen por su base. Por eso van por id.
      if (mm.id === 'm_pct_semineto') return regla.grupo === 'SEMI';
      if (mm.op === 'derivada') return regla.concepto === 'Colocacion';
      if (mm.op === 'ratio_venta' || mm.id === 'm_pct_venta') {
        return hayVenta && regla.concepto !== 'Ventas';
      }
      if (mm.op === 'formula_venta') return regla.concepto === 'Ventas';
      return true;
    },
    [regla.metodo, regla.grupo, regla.concepto, hayVenta],
  );

  // Las tarjetas de historia ya cubren los métodos de fábrica de esas
  // operaciones; «Otras formas» lista el resto (sin historia: todos).
  const otrasFormas = useMemo(() => {
    const base =
      rec.errores.length === 0
        ? metodosList
        : metodosList.filter((mm) => !mm.fijo || !OPS_CON_TARJETA.includes(mm.op));
    return base.filter(aplica);
  }, [metodosList, rec.errores.length, aplica]);

  // Cambios del borrador: los usan «Así quedaría» (sin guardar) y Guardar.
  const cambios = useMemo<Partial<Override>>(() => {
    const cuenta = b.cuenta.trim();
    const cc = b.cc.trim();
    const cambioDestino = cuenta !== regla.cuenta || cc !== regla.cc;
    return {
      metodo: b.metodo,
      valor: b.valor,
      n: b.n,
      nombre: b.nombre.trim() || null,
      detalle: b.detalle.trim() || null,
      causado: b.causado,
      escenarios: b.escenarios,
      // La Combinada se recompone con el mismo formato: cuenta-centro-empresa.
      ...(cambioDestino &&
        cuenta &&
        cc && { cuenta, cc, combinada: `${cuenta}-${cc}-${regla.empresa}` }),
    };
  }, [b, regla.cuenta, regla.cc, regla.empresa]);

  // «Así quedaría» (CP-26): se recalcula cada vez que cambia la selección.
  const sim = useMemo(() => simular?.(cambios) ?? null, [simular, cambios]);

  // Número de cada tarjeta con el motor completo (el mismo que daría «Así
  // quedaría» al elegirla); sin simulador se cae a la vista previa local.
  const numeroTarjeta = useMemo(() => {
    const out: Record<string, number> = {};
    rec.errores.forEach((op) => {
      const mo = metodoDeOpcion(op, metodosList);
      const s = mo && simular?.({ ...cambios, metodo: mo.id, valor: null, n: op.n ?? cambios.n });
      out[op.clave] = s ? s.proy : numeroDeOpcion(op, serieConcepto, b.n);
    });
    return out;
  }, [rec.errores, metodosList, simular, cambios, serieConcepto, b.n]);
  /**
   * P3 · Cuanto daria cada una de las OTRAS opciones.
   *
   * "Lo presupuestado", "Como va el mes", "Un monto fijo", "Un % de la venta",
   * "% del Semi Neto" y "Del Cargo Fijo" quedaban en una lista de botones sin
   * mostrar su numero, asi que elegir entre ellas era a ciegas: habia que
   * seleccionar una, mirar el resultado y volver atras si no servia.
   *
   * Se simula con el motor completo, igual que las tarjetas de historia.
   */
  const numeroOtraForma = useMemo(() => {
    const out: Record<string, number | null> = {};
    otrasFormas.forEach((mm) => {
      const s = simular?.({ ...cambios, metodo: mm.id, valor: null, n: cambios.n });
      out[mm.id] = s ? s.proy : null;
    });
    return out;
  }, [otrasFormas, simular, cambios]);

  const hayCambio =
    !!sim &&
    [sim.proy - valProyeccion, sim.caus - valCausado, sim.snProy - semiNetoProy, sim.snCaus - semiNetoCaus].some(
      (d) => Math.abs(d) >= 0.005,
    );

  const guardar = () => onGuardar(cambios);

  return (
    <div className="space-y-4 rounded-lg border border-emerald-300 bg-white p-4">
      {/* Cabecera del panel */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          {regla.empresa} · {etiquetaConcepto(regla.concepto)}
        </h3>
        <span className="font-mono text-[11px] text-slate-500">{regla.combinada}</span>
      </div>

      {/* 1 · Nombre y detalle opcionales (CP-29) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Nombre (opcional)
          <input
            value={b.nombre}
            onChange={(e) => set('nombre', e.target.value)}
            placeholder="A qué corresponde"
            className="rounded border border-slate-200 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Detalle (opcional)
          <input
            value={b.detalle}
            onChange={(e) => set('detalle', e.target.value)}
            placeholder="Quién lo pidió"
            className="rounded border border-slate-200 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {/* 2 · ¿Cómo quieres estimar el mes? — tarjetas con número y error (CP-25).
          Pulsar una tarjeta la deja SELECCIONADA para esta regla; se aplica al
          Guardar. «+ Crear otra forma» arma un método nuevo y lo selecciona. */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          ¿Cómo quieres estimar el mes?
        </p>
        {rec.excepcion ? (
          <div className="mb-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Este concepto tiene método fijado por el negocio: <b>{rec.excepcion}</b>. No se prueban
            opciones de historia.
          </div>
        ) : rec.errores.length === 0 ? (
          <div className="mb-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Sin historia suficiente para probar opciones (hacen falta meses cerrados).
          </div>
        ) : (
          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {rec.errores.map((op) => {
              const mo = metodoDeOpcion(op, metodosList);
              return (
                <TarjetaOpcion
                  key={op.clave}
                  op={op}
                  numero={numeroTarjeta[op.clave] ?? 0}
                  esRecomendada={op.clave === rec.recomendada}
                  esActual={op.clave === claveActual(regla, metodos)}
                  seleccionada={!!mo && mo.id === b.metodo && (op.n == null || (b.n ?? 9) === op.n)}
                  disponible={!!mo}
                  onElegir={() => {
                    if (!mo) return;
                    elegirMetodo(mo.id, op.n ? { n: op.n } : undefined);
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Otras formas: el resto de métodos (de fábrica y propios). */}
        <p className="mb-1 mt-3 text-[11px] font-semibold text-slate-500">Otras formas</p>
        <div className="flex flex-wrap gap-2">
          {otrasFormas.map((mm) => {
            const sel = mm.id === b.metodo;
            return (
              <button
                key={mm.id}
                type="button"
                onClick={() => elegirMetodo(mm.id)}
                title={formula(mm)}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                  sel
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
                }`}
              >
                <span className="font-semibold">{mm.nombre}</span>
                {!mm.fijo && (
                  <span className={`ml-1 text-[10px] ${sel ? 'text-emerald-100' : 'text-emerald-700'}`}>
                    propia
                  </span>
                )}
                {/* P3 · El numero que daria, para no elegir a ciegas. */}
                {numeroOtraForma[mm.id] != null && (
                  <span
                    className={`block font-mono text-[11px] tabular-nums ${
                      sel ? 'text-emerald-50' : 'text-slate-500'
                    }`}
                  >
                    {fmt(numeroOtraForma[mm.id] as number)}
                  </span>
                )}
              </button>
            );
          })}
          {onCrearMetodo && (
            <button
              type="button"
              onClick={() => setCreando((v) => !v)}
              className="rounded-lg border border-dashed border-emerald-400 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              + Crear otra forma
            </button>
          )}
        </div>

        {creando && onCrearMetodo && (
          <CrearForma
            empresa={regla.empresa}
            onCancelar={() => setCreando(false)}
            onCrear={(nuevo) => {
              onCrearMetodo(nuevo);
              // "Armar mi formula" causa por calendario en el prototipo.
              elegirMetodo(nuevo.id, { causado: 'calendario' });
              setCreando(false);
            }}
          />
        )}

        {rec.revisarAMano && (
          <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
            La mejor opción se equivoca más de ±50 %. Conviene revisar este concepto a mano cada
            cierre.
          </p>
        )}
        {rec.quedarse && (
          <p className="mt-2 text-[11px] text-emerald-700">
            La opción actual acierta casi igual que la mejor: puedes quedarte como estás.
          </p>
        )}
        {b.metodo !== regla.metodo && (
          <p className="mt-2 text-[11px] text-slate-500">
            Seleccionada: <b>{m?.nombre ?? b.metodo}</b>. Se aplica a esta regla al pulsar Guardar.
          </p>
        )}
      </div>

      {/* 3 · Parámetros según la opción */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Método
          <select
            value={b.metodo}
            onChange={(e) => elegirMetodo(e.target.value)}
            className="rounded border border-slate-200 px-2 py-1.5 text-sm"
          >
            {metodosList.map((mm) => (
              <option key={mm.id} value={mm.id}>
                {mm.nombre}
              </option>
            ))}
          </select>
        </label>
        {pideN && (
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Meses a mirar
            <select
              value={b.n ?? 9}
              onChange={(e) => set('n', +e.target.value)}
              className="rounded border border-slate-200 px-2 py-1.5 text-sm"
            >
              {[3, 6, 9, 12].map((x) => (
                <option key={x} value={x}>
                  {x} meses
                </option>
              ))}
            </select>
          </label>
        )}
        {pideValor && m && (
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {m.op === 'porcentaje' ? 'Porcentaje (%)' : 'Monto'}
            <input
              type="number"
              step={0.01}
              value={
                txtValor ??
                (m.op === 'porcentaje'
                  ? ((b.valor ?? m.valor ?? 0) * 100).toFixed(2)
                  : String(Math.round(b.valor ?? m.valor ?? 0)))
              }
              onChange={(e) => {
                const txt = e.target.value;
                setTxtValor(txt); // manda lo escrito mientras se escribe
                const v = parseFloat(txt);
                // Un campo vacio o a medias ("-", "0.") no se guarda como 0:
                // se deja el valor anterior hasta que haya un numero usable.
                if (Number.isFinite(v)) set('valor', m.op === 'porcentaje' ? v / 100 : v);
              }}
              onBlur={() => setTxtValor(null)} // al salir, se vuelve a formatear
              className="w-28 rounded border border-slate-200 px-2 py-1.5 text-right font-mono text-sm"
            />
          </label>
        )}
        <span className="rounded bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-emerald-700">
          {m ? formula(m) : '—'}
        </span>
      </div>

      {/* 4 · Así quedaría (CP-26) */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Así quedaría
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <AsiCelda etiqueta="Proyectado" valor={sim?.proy ?? valProyeccion} hoy={valProyeccion} />
          <AsiCelda etiqueta="Causado" valor={sim?.caus ?? valCausado} hoy={valCausado} />
          <AsiCelda etiqueta="Semi Neto (proy.)" valor={sim?.snProy ?? semiNetoProy} hoy={semiNetoProy} />
          <AsiCelda etiqueta="Semi Neto (caus.)" valor={sim?.snCaus ?? semiNetoCaus} hoy={semiNetoCaus} />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {hayCambio
            ? 'Con lo seleccionado, sin guardar todavía. Se aplica al pulsar Guardar.'
            : 'Así está hoy. Cambia la forma de estimar o los parámetros para ver el impacto.'}
        </p>
      </div>

      {/* 5 · Avanzado (CP-27) */}
      <div className="rounded-lg border border-slate-200">
        <button
          type="button"
          onClick={() => setAvanzado((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700"
        >
          Avanzado
          <i className={`ri-arrow-down-s-line transition-transform ${avanzado ? 'rotate-180' : ''}`} />
        </button>
        {avanzado && (
          <div className="grid grid-cols-1 gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Cómo se causa
              <select
                value={b.causado}
                onChange={(e) => set('causado', e.target.value as Causado)}
                className="rounded border border-slate-200 px-2 py-1.5 text-sm"
              >
                {CAUSADOS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              En qué escenario cuenta
              <select
                value={b.escenarios}
                onChange={(e) => set('escenarios', e.target.value as EscenarioRegla)}
                className="rounded border border-slate-200 px-2 py-1.5 text-sm"
              >
                {ESCENARIOS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Cuenta contable de destino
              <input
                value={b.cuenta}
                onChange={(e) => set('cuenta', e.target.value)}
                className="rounded border border-slate-200 px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Centro de costo de destino
              <input
                value={b.cc}
                onChange={(e) => set('cc', e.target.value)}
                className="rounded border border-slate-200 px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <p className="text-[11px] text-slate-400 sm:col-span-2">
              Combinada resultante:{' '}
              <span className="font-mono">
                {b.cuenta.trim()}-{b.cc.trim()}-{regla.empresa}
              </span>
              . Debe existir en el catálogo para publicar. Las fórmulas propias se editan en «Mis
              fórmulas».
            </p>
          </div>
        )}
      </div>

      {/* 6 · Botones (CP-24) */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={guardar}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Guardar
        </button>
        <button
          onClick={onCancelar}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          onClick={onOtraRegla}
          className="rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          + Otra regla para el concepto
        </button>
        <button
          onClick={onVolver}
          className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Volver a como estaba
        </button>
        <button
          onClick={onEliminar}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
        >
          Eliminar regla
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────────────────────

function AsiCelda({ etiqueta, valor, hoy }: { etiqueta: string; valor: number; hoy: number }) {
  const dif = valor - hoy;
  const cambia = Math.abs(dif) >= 0.005;
  return (
    <div>
      <p className="text-[11px] text-slate-500">{etiqueta}</p>
      <p className="font-mono text-sm font-semibold tabular-nums text-slate-800">{fmt(valor)}</p>
      {cambia && (
        <p className="font-mono text-[11px] tabular-nums text-slate-500">
          hoy {fmt(hoy)} ·{' '}
          <span className="font-semibold text-slate-700">
            {dif > 0 ? '+' : ''}
            {fmt(dif)}
          </span>
        </p>
      )}
    </div>
  );
}

function TarjetaOpcion({
  op,
  numero,
  esRecomendada,
  esActual,
  seleccionada,
  disponible,
  onElegir,
}: {
  op: ErrorOpcion;
  numero: number;
  esRecomendada: boolean;
  esActual: boolean;
  seleccionada: boolean;
  disponible: boolean;
  onElegir: () => void;
}) {
  const sem = Number.isFinite(op.error) ? op.semaforo : semaforoDeError(1);
  return (
    <button
      type="button"
      onClick={onElegir}
      disabled={!disponible}
      title={disponible ? 'Usar esta forma para la regla' : 'No hay un método para esta opción'}
      className={`flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${COLOR_SEMAFORO[sem]} ${
        seleccionada ? 'ring-2 ring-emerald-600' : 'hover:ring-2 hover:ring-emerald-200'
      }`}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold">{op.etiqueta}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${PUNTO_SEMAFORO[sem]}`} />
      </span>
      <span className="font-mono text-sm font-bold tabular-nums text-slate-800">{fmt(numero)}</span>
      <span className="text-[10px]">
        error {Number.isFinite(op.error) ? (op.error * 100).toFixed(0) + ' %' : '—'}
      </span>
      <span className="flex gap-1">
        {esRecomendada && (
          <span className="rounded bg-emerald-600 px-1 text-[9px] font-semibold text-white">
            recomendada
          </span>
        )}
        {esActual && (
          <span className="rounded bg-slate-700 px-1 text-[9px] font-semibold text-white">
            actual
          </span>
        )}
        {seleccionada && (
          <span className="rounded bg-emerald-700 px-1 text-[9px] font-semibold text-white">
            ✓ seleccionada
          </span>
        )}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades locales
// ─────────────────────────────────────────────────────────────────────────────

/** Clave WAPE de la opción vigente de una regla (para marcar «actual»). */
function claveActual(regla: Regla, metodos: Record<string, Metodo>): string | null {
  const m = metodos[regla.metodo];
  if (!m) return null;
  const n = regla.n ?? 9;
  switch (m.op) {
    case 'mediana':
      return 'tipico';
    case 'promedio':
      return 'promedio';
    case 'ultimo':
      return 'ultimo';
    case 'ratio_venta':
      return `ratio_venta:${n}`;
    default:
      return null;
  }
}

/** Envuelve la serie de venta en la forma que espera `recomendar`. */
function wrapVenta(serieVenta?: number[]) {
  return serieVenta && serieVenta.length ? { valores: serieVenta } : undefined;
}

/** Número que daría una opción sobre la serie completa (vista previa de tarjeta). */
function numeroDeOpcion(op: ErrorOpcion, serie: number[], n: number | null): number {
  const meses = op.n ?? n ?? 9;
  const conReg = serie.filter((x) => x != null && !Number.isNaN(x));
  const ult = conReg.slice(-meses);
  if (!ult.length) return 0;
  switch (op.tipo) {
    case 'promedio':
      return ult.reduce((a, c) => a + c, 0) / ult.length;
    case 'tipico': {
      const s = [...ult].sort((a, c) => a - c);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    case 'ultimo':
      return conReg[conReg.length - 1];
    case 'ratio_venta':
      // Vista previa: el promedio histórico (el ratio real necesita la venta
      // proyectada, que no está en este contexto de tarjeta).
      return ult.reduce((a, c) => a + c, 0) / ult.length;
    default:
      return 0;
  }
}

/** Método que corresponde a una opción WAPE (por su operación). */
function metodoDeOpcion(op: ErrorOpcion, metodosList: Metodo[]): Metodo | undefined {
  const opDeTipo: Record<string, string> = {
    tipico: 'mediana',
    promedio: 'promedio',
    ultimo: 'ultimo',
    ratio_venta: 'ratio_venta',
  };
  const buscada = opDeTipo[op.tipo];
  if (!buscada) return undefined;
  // Se prefiere el de fábrica; si no hay, cualquiera con esa operación.
  return (
    metodosList.find((mm) => mm.op === buscada && mm.fijo) ??
    metodosList.find((mm) => mm.op === buscada)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// «+ Crear otra forma» — arma un método nuevo (modelo v1: op/base/valor)
// ─────────────────────────────────────────────────────────────────────────────

interface TipoForma {
  id: string;
  label: string;
  op: Operacion;
  base: (concepto: string) => Base;
  orden: number;
  invertir: boolean;
  /** Pide valor: 'pct' (porcentaje) o 'monto'. */
  valor?: 'pct' | 'monto';
  /** Pide el concepto de la misma empresa sobre el que se calcula. */
  pideConcepto?: boolean;
}

/** Turnos como en los métodos de fábrica (§D): historia 2, sobre venta 3, Semi Neto 5. */
const TIPOS_FORMA: TipoForma[] = [
  { id: 'promedio', label: 'Promedio de los últimos meses', op: 'promedio', base: () => 'ninguna', orden: 2, invertir: false },
  { id: 'mediana', label: 'Lo típico (mediana)', op: 'mediana', base: () => 'ninguna', orden: 2, invertir: false },
  { id: 'ultimo', label: 'El último mes cerrado', op: 'ultimo', base: () => 'ninguna', orden: 2, invertir: false },
  { id: 'presupuesto', label: 'El presupuesto del mes', op: 'presupuesto', base: () => 'ninguna', orden: 2, invertir: false },
  { id: 'fijo', label: 'Un monto fijo', op: 'valor_fijo', base: () => 'ninguna', orden: 2, invertir: false, valor: 'monto' },
  { id: 'pct_venta', label: 'Un % de la venta', op: 'porcentaje', base: () => 'venta', orden: 3, invertir: true, valor: 'pct' },
  { id: 'pct_concepto', label: 'Un % de otro concepto', op: 'porcentaje', base: (c) => `c:${c}`, orden: 4, invertir: false, valor: 'pct', pideConcepto: true },
  { id: 'pct_semineto', label: 'Un % del Semi Neto', op: 'porcentaje', base: () => 'semineto', orden: 5, invertir: false, valor: 'pct' },
];

function CrearForma({
  empresa,
  onCrear,
  onCancelar,
}: {
  empresa: string;
  onCrear: (m: Metodo) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [tipoId, setTipoId] = useState(TIPOS_FORMA[0].id);
  const [valor, setValor] = useState(0);
  const [concepto, setConcepto] = useState('');
  const tipo = TIPOS_FORMA.find((t) => t.id === tipoId)!;
  const [invertir, setInvertir] = useState(tipo.invertir);

  const valido = nombre.trim() !== '' && (!tipo.pideConcepto || concepto.trim() !== '');

  const crear = () => {
    if (!valido) return;
    onCrear({
      id: `u_${Date.now().toString(36)}`,
      nombre: nombre.trim(),
      op: tipo.op,
      base: tipo.base(concepto.trim()),
      valor: tipo.valor === 'pct' ? valor / 100 : tipo.valor === 'monto' ? valor : null,
      invertir,
      orden: tipo.orden,
      fijo: false,
    });
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
      <p className="text-xs font-semibold text-slate-700">Nueva forma de estimar</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Nombre
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="p. ej. 2 % de la venta"
            className="rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Cómo se calcula
          <select
            value={tipoId}
            onChange={(e) => {
              const t = TIPOS_FORMA.find((x) => x.id === e.target.value)!;
              setTipoId(t.id);
              setInvertir(t.invertir);
            }}
            className="rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            {TIPOS_FORMA.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {tipo.valor && (
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            {tipo.valor === 'pct' ? 'Porcentaje (%)' : 'Monto (USD)'}
            <input
              type="number"
              step="any"
              value={valor}
              onChange={(e) => setValor(+e.target.value || 0)}
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-right font-mono text-sm"
            />
          </label>
        )}
        {tipo.pideConcepto && (
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Concepto de {empresa}
            <input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="p. ej. Personal Fijo"
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
            />
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
          <input type="checkbox" checked={invertir} onChange={(e) => setInvertir(e.target.checked)} />
          Invertir el signo (la venta es negativa: un % de la venta como gasto va invertido)
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={crear}
          disabled={!valido}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Crear y seleccionar
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
