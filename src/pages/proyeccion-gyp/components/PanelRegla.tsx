import { useMemo, useState } from 'react';
import {
  formula,
  type Causado,
  type EscenarioRegla,
  type Metodo,
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
 * recálculo del impacto lo estima el panel con el método elegido; la cifra firme
 * la recalcula el motor tras guardar.
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

export default function PanelRegla({
  regla,
  valProyeccion,
  valCausado,
  semiNetoProy,
  semiNetoCaus,
  metodos,
  serieConcepto,
  serieVenta,
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

  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB((p) => ({ ...p, [k]: v }));

  const metodosList = Object.values(metodos);
  const m = metodos[b.metodo];
  const pideValor = m ? OP_PIDE_VALOR.includes(m.op) : false;
  const pideN = m ? OP_PIDE_N.includes(m.op) : false;

  // Recomendación y errores WAPE de las opciones de historia (CP-25, §G).
  const rec = useMemo(
    () => recomendar(serieConcepto, regla.concepto, claveActual(regla, metodos), wrapVenta(serieVenta)),
    [serieConcepto, regla, metodos, serieVenta],
  );

  const guardar = () => {
    const cuenta = b.cuenta.trim();
    const cc = b.cc.trim();
    const cambioDestino = cuenta !== regla.cuenta || cc !== regla.cc;
    onGuardar({
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
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-emerald-300 bg-white p-4">
      {/* Cabecera del panel */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          {regla.empresa} · {regla.concepto}
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

      {/* 2 · ¿Cómo quieres estimar el mes? — tarjetas con número y error (CP-25) */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          ¿Cómo quieres estimar el mes?
        </p>
        {rec.excepcion ? (
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Este concepto tiene método fijado por el negocio: <b>{rec.excepcion}</b>. No se prueban
            opciones de historia.
          </div>
        ) : rec.errores.length === 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Sin historia suficiente para probar opciones (hacen falta meses cerrados).
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {rec.errores.map((op) => (
              <TarjetaOpcion
                key={op.clave}
                op={op}
                serie={serieConcepto}
                n={b.n}
                esRecomendada={op.clave === rec.recomendada}
                esActual={op.clave === claveActual(regla, metodos)}
                onElegir={() => elegirOpcion(op, metodosList, set)}
              />
            ))}
          </div>
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
      </div>

      {/* 3 · Parámetros según la opción */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Método
          <select
            value={b.metodo}
            onChange={(e) => {
              set('metodo', e.target.value);
              set('valor', null);
            }}
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
                m.op === 'porcentaje'
                  ? ((b.valor ?? m.valor ?? 0) * 100).toFixed(2)
                  : Math.round(b.valor ?? m.valor ?? 0)
              }
              onChange={(e) =>
                set(
                  'valor',
                  m.op === 'porcentaje' ? (+e.target.value || 0) / 100 : +e.target.value || 0,
                )
              }
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
          <AsiCelda etiqueta="Proyectado" valor={valProyeccion} />
          <AsiCelda etiqueta="Causado" valor={valCausado} />
          <AsiCelda etiqueta="Semi Neto (proy.)" valor={semiNetoProy} />
          <AsiCelda etiqueta="Semi Neto (caus.)" valor={semiNetoCaus} />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          La cifra firme se recalcula al Guardar; el impacto exacto sobre el Semi Neto se ve en
          Resultado.
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

function AsiCelda({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{etiqueta}</p>
      <p className="font-mono text-sm font-semibold tabular-nums text-slate-800">{fmt(valor)}</p>
    </div>
  );
}

function TarjetaOpcion({
  op,
  serie,
  n,
  esRecomendada,
  esActual,
  onElegir,
}: {
  op: ErrorOpcion;
  serie: number[];
  n: number | null;
  esRecomendada: boolean;
  esActual: boolean;
  onElegir: () => void;
}) {
  const sem = Number.isFinite(op.error) ? op.semaforo : semaforoDeError(1);
  const numero = numeroDeOpcion(op, serie, n);
  return (
    <button
      type="button"
      onClick={onElegir}
      className={`flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors ${COLOR_SEMAFORO[sem]} hover:ring-2 hover:ring-emerald-200`}
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

/** Traduce la opción WAPE elegida al método/n del borrador. */
function elegirOpcion(
  op: ErrorOpcion,
  metodosList: Metodo[],
  set: <K extends keyof Borrador>(k: K, v: Borrador[K]) => void,
) {
  const porOp = (o: string) => metodosList.find((m) => m.op === o);
  let metodo: Metodo | undefined;
  switch (op.tipo) {
    case 'tipico':
      metodo = porOp('mediana');
      break;
    case 'promedio':
      metodo = porOp('promedio');
      break;
    case 'ultimo':
      metodo = porOp('ultimo');
      break;
    case 'ratio_venta':
      metodo = porOp('ratio_venta');
      break;
  }
  if (metodo) {
    set('metodo', metodo.id);
    set('valor', null);
    if (op.n) set('n', op.n);
  }
}
