import { Fragment, useMemo, useState } from 'react';
import {
  type Causado,
  type EscenarioRegla,
  type Metodo,
  type NivelRegla,
  type Regla,
} from '../engine';
import type { ReglaBase } from '../data';
import type { FilaHistoricoCuenta } from '../capas';
import { trazaRegla, type Traza } from './traza';
import { fmt } from './formato';
import PanelRegla, { type SimulacionRegla } from './PanelRegla';
import PanelAgregarRegla from './PanelAgregarRegla';
import {
  BLOQUES_PL,
  bloqueDeRegla,
  calcularValidaciones,
  comoSeEstima,
  etiquetasDeFila,
  ETIQUETA_TITULO,
  hayBloqueo,
  totalIncidencias,
  type BloquePL,
  type EtiquetaFila,
} from './reglasHelpers';

/**
 * Pestaña 2 · Reglas — único lugar de trabajo (CP-23, CP-24, CP-48, CP-50).
 *
 * Muestra el proyectado y el causado LADO A LADO, sin selector global de
 * escenario (CP-23, Requirement 18.1). Las reglas se agrupan por empresa y por
 * bloque del P&L con etiquetas de fila (CP-48, Requirement 18.6). Al pulsar una
 * fila se abre el panel por regla con tarjetas de estimación WAPE, «Así
 * quedaría» y «Avanzado» (CP-24..27). «+ Agregar regla» ofrece los tres caminos
 * (CP-30). Las eliminadas se listan al pie con «Restaurar» (CP-31). Un bloque
 * plegable reúne las ocho validaciones de CP-50 (Requirement 23); solo la octava
 * bloquea.
 */

/** Override del usuario sobre una regla base, por clave empresa|concepto. */
export interface Override {
  metodo?: string;
  valor?: number | null;
  n?: number | null;
  nombre?: string | null;
  detalle?: string | null;
  causado?: Causado;
  escenarios?: EscenarioRegla;
  /** Cuenta de destino (Combinada = cuenta-centro-empresa). */
  cuenta?: string;
  cc?: string;
  combinada?: string;
  borrada?: boolean;
}

export interface NuevaRegla extends ReglaBase {
  n?: number | null;
  nombre?: string | null;
  detalle?: string | null;
  nivel?: NivelRegla;
  escenarios?: EscenarioRegla;
  causado?: Causado;
}

/** Una regla eliminada, para el pie con «Restaurar» (CP-31). */
export interface ReglaEliminada {
  key: string;
  empresa: string;
  concepto: string;
  combinada: string;
}

export interface PestanaReglasProps {
  empresas: readonly string[];
  reglas: Regla[];
  metodos: Record<string, Metodo>;
  series: Record<string, { a: number; s: (number | null)[] }>;
  /** Monto USD proyectado por regla, en el orden de `reglas`. */
  val: number[];
  /** Monto USD causado por regla, en el orden de `reglas`. */
  valCausado: number[];
  /** Semi Neto por empresa (proyectado y causado) para «Así quedaría». */
  semiNeto: Record<string, { proy: number; caus: number }>;
  /** Reglas eliminadas (borrado lógico) para el pie con restaurar (CP-31). */
  eliminadas: ReglaEliminada[];
  /** Nº de cuentas fuera del catálogo (validación 7, remite a Alertas). */
  cuentasFueraCatalogo?: number;
  onModRegla: (key: string, cambios: Partial<Override>) => void;
  /** Crea (o guarda) un método nuevo desde el panel de una regla. */
  onCrearMetodo?: (m: Metodo) => void;
  /** Recalcula con el borrador de una regla, sin guardar («Así quedaría»). */
  onSimular?: (key: string, cambios: Partial<Override>) => SimulacionRegla | null;
  onEliminarRegla: (key: string) => void;
  onRestaurarRegla: (key: string) => void;
  onCrearNuevas: (reglas: NuevaRegla[]) => void;
  /** Detalle por cuenta del mes, para elegir cuentas en «+ Agregar regla». */
  detalleCuenta?: FilaHistoricoCuenta[];
  onRestablecer: () => void;
  /** Abre la traza «¿Por qué este número?» (CP-35). */
  onTraza?: (t: Traza) => void;
}

/** Color del chip de cada etiqueta de fila. */
const COLOR_ETIQUETA: Record<EtiquetaFila, string> = {
  cuenta: 'bg-sky-100 text-sky-700',
  nueva: 'bg-emerald-100 text-emerald-700',
  'sin N ctas': 'bg-slate-100 text-slate-600',
  'sin detalle': 'bg-amber-100 text-amber-700',
  'solo proyectado': 'bg-indigo-100 text-indigo-700',
  'solo causado': 'bg-violet-100 text-violet-700',
};

export default function PestanaReglas({
  empresas,
  reglas,
  metodos,
  series,
  val,
  valCausado,
  semiNeto,
  eliminadas,
  cuentasFueraCatalogo,
  onModRegla,
  onCrearMetodo,
  onSimular,
  onEliminarRegla,
  onRestaurarRegla,
  onCrearNuevas,
  detalleCuenta,
  onRestablecer,
  onTraza,
}: PestanaReglasProps) {
  const [filtroEmpresa, setFiltroEmpresa] = useState('*');
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const [agregar, setAgregar] = useState(false);
  const [validacionesAbiertas, setValidacionesAbiertas] = useState(false);

  // Índice del monto por clave de regla (para el panel y las validaciones).
  const idxDe = useMemo(() => {
    const m = new Map<string, number>();
    reglas.forEach((r, i) => m.set(r.key, i));
    return m;
  }, [reglas]);

  // Cuentas con regla propia por concepto, para la etiqueta «sin N ctas».
  const cuentasPropiasPorConcepto = useMemo(() => {
    const m = new Map<string, number>();
    reglas.forEach((r) => {
      if (r.nivel === 'cuenta') {
        const k = r.empresa + '|' + r.concepto;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    });
    return m;
  }, [reglas]);

  // Validaciones de CP-50 (Requirement 23).
  const validaciones = useMemo(
    () =>
      calcularValidaciones(reglas, metodos, val, empresas, {
        cuentasFueraCatalogo,
        reglasCuentaSinDetalle: reglas
          .filter((r) => r.nivel === 'cuenta' && (!r.serie || r.serie.length === 0))
          .map((r) => `${r.empresa} / ${r.combinada}: sin detalle por cuenta (vale 0).`),
        tieneNombre: (r) => !!r.nombre,
      }),
    [reglas, metodos, val, empresas, cuentasFueraCatalogo],
  );
  const bloqueado = hayBloqueo(validaciones);
  const nIncidencias = totalIncidencias(validaciones);

  // Agrupa reglas por empresa → bloque del P&L (CP-48).
  const empresasVisibles = filtroEmpresa === '*' ? empresas : empresas.filter((e) => e === filtroEmpresa);

  const serieVentaDe = (empresa: string): number[] => {
    const sc = series[empresa + '|Ventas'];
    return (sc?.s ?? []).map((v) => (v == null ? 0 : v));
  };

  const abrirTraza = (key: string, escenario: 'PROYECCION' | 'CAUSADO') => {
    if (!onTraza) return;
    const i = idxDe.get(key);
    if (i == null) return;
    const r = reglas[i];
    const v = escenario === 'CAUSADO' ? valCausado[i] : val[i];
    onTraza(trazaRegla(r, metodos[r.metodo], undefined, escenario, v));
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Reglas de cálculo</h2>
        <p className="text-sm text-slate-500">
          El proyectado y el causado van lado a lado. Pulsa una fila para abrir su panel: cómo se
          estima el mes, el impacto y lo avanzado. Aquí se trabaja todo.
        </p>
      </div>

      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <label className="text-xs text-slate-500">
          Empresa{' '}
          <select
            value={filtroEmpresa}
            onChange={(e) => setFiltroEmpresa(e.target.value)}
            className="rounded border border-slate-200 px-2 py-1 text-sm"
          >
            <option value="*">Todas</option>
            {empresas.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setAgregar((v) => !v);
            setPanelKey(null);
          }}
          className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          + Agregar regla
        </button>
        <button
          onClick={onRestablecer}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Restablecer
        </button>
      </div>

      {/* Bloque plegable «N cosas por revisar» (CP-50) */}
      <div
        className={`rounded-lg border ${
          bloqueado ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
        }`}
      >
        <button
          type="button"
          onClick={() => setValidacionesAbiertas((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-slate-800"
        >
          <span>
            {nIncidencias} cosa{nIncidencias === 1 ? '' : 's'} por revisar
            {bloqueado && (
              <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                bloquea guardar
              </span>
            )}
          </span>
          <i
            className={`ri-arrow-down-s-line transition-transform ${
              validacionesAbiertas ? 'rotate-180' : ''
            }`}
          />
        </button>
        {validacionesAbiertas && (
          <div className="space-y-2 border-t border-slate-100 px-3 py-2">
            {validaciones.map((v) => (
              <div key={v.n} className="text-xs">
                <p
                  className={`font-semibold ${
                    v.detalles.length === 0
                      ? 'text-slate-400'
                      : v.bloquea
                        ? 'text-red-700'
                        : 'text-slate-700'
                  }`}
                >
                  {v.n}. {v.titulo}{' '}
                  {v.detalles.length > 0 && (
                    <span className="font-mono text-[10px]">({v.detalles.length})</span>
                  )}
                </p>
                {v.detalles.map((d, i) => (
                  <p key={i} className="pl-4 text-slate-500">
                    · {d}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Panel + Agregar regla (CP-30) */}
      {agregar && (
        <PanelAgregarRegla
          empresas={empresas}
          metodos={metodos}
          series={series}
          reglasActuales={reglas}
          detalleCuenta={detalleCuenta}
          onCancelar={() => setAgregar(false)}
          onCrear={(nuevasReglas) => {
            onCrearNuevas(nuevasReglas);
            setAgregar(false);
          }}
        />
      )}

      {/* Reglas agrupadas por empresa y bloque del P&L (CP-48) */}
      {empresasVisibles.map((empresa) => {
        const reglasEmpresa = reglas
          .map((r, i) => ({ r, i }))
          .filter((o) => o.r.empresa === empresa);
        if (reglasEmpresa.length === 0) return null;

        return (
          <div key={empresa} className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
              <h3 className="text-sm font-semibold text-slate-800">{empresa}</h3>
            </div>
            {BLOQUES_PL.map((bloque) => {
              const filas = reglasEmpresa.filter((o) => bloqueDeRegla(o.r) === bloque.id);
              if (filas.length === 0) return null;
              return (
                <BloqueTabla
                  key={bloque.id}
                  bloque={bloque}
                  filas={filas}
                  metodos={metodos}
                  val={val}
                  valCausado={valCausado}
                  cuentasPropiasPorConcepto={cuentasPropiasPorConcepto}
                  panelKey={panelKey}
                  onAbrir={(key) => {
                    setPanelKey((k) => (k === key ? null : key));
                    setAgregar(false);
                  }}
                  onAbrirTraza={abrirTraza}
                  renderPanel={(key, i) => (
                    <PanelRegla
                      regla={reglas[i]}
                      valProyeccion={val[i] ?? 0}
                      valCausado={valCausado[i] ?? 0}
                      semiNetoProy={semiNeto[empresa]?.proy ?? 0}
                      semiNetoCaus={semiNeto[empresa]?.caus ?? 0}
                      metodos={metodos}
                      serieConcepto={(reglas[i].serie ?? []).filter((x) => !Number.isNaN(x))}
                      serieVenta={serieVentaDe(empresa)}
                      onCrearMetodo={onCrearMetodo}
                      simular={onSimular ? (c) => onSimular(key, c) : undefined}
                      onGuardar={(cambios) => {
                        onModRegla(key, cambios);
                        setPanelKey(null);
                      }}
                      onCancelar={() => setPanelKey(null)}
                      onOtraRegla={() => {
                        setPanelKey(null);
                        setAgregar(true);
                      }}
                      onEliminar={() => {
                        onEliminarRegla(key);
                        setPanelKey(null);
                      }}
                      onVolver={() => {
                        onModRegla(key, {
                          metodo: undefined,
                          valor: undefined,
                          n: undefined,
                          nombre: undefined,
                          detalle: undefined,
                          causado: undefined,
                          escenarios: undefined,
                          cuenta: undefined,
                          cc: undefined,
                          combinada: undefined,
                        });
                        setPanelKey(null);
                      }}
                    />
                  )}
                  etiquetasFila={(r) =>
                    etiquetasDeFila(r, {
                      cuentasPropias: cuentasPropiasPorConcepto.get(r.empresa + '|' + r.concepto),
                      sinDetalle: r.nivel === 'cuenta' && (!r.serie || r.serie.length === 0),
                    })
                  }
                />
              );
            })}
          </div>
        );
      })}

      {/* Eliminadas al pie con restaurar (CP-31) */}
      {eliminadas.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="mb-1 text-xs font-semibold text-slate-600">
            Reglas eliminadas ({eliminadas.length})
          </p>
          <div className="space-y-1">
            {eliminadas.map((e) => (
              <div key={e.key} className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {e.empresa} · {e.concepto}{' '}
                  <span className="font-mono text-[11px] text-slate-400">{e.combinada}</span>
                </span>
                <button
                  onClick={() => onRestaurarRegla(e.key)}
                  className="rounded border border-emerald-300 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  Restaurar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabla de un bloque del P&L
// ─────────────────────────────────────────────────────────────────────────────

function BloqueTabla({
  bloque,
  filas,
  metodos,
  val,
  valCausado,
  panelKey,
  onAbrir,
  onAbrirTraza,
  renderPanel,
  etiquetasFila,
}: {
  bloque: { id: BloquePL; label: string };
  filas: { r: Regla; i: number }[];
  metodos: Record<string, Metodo>;
  val: number[];
  valCausado: number[];
  cuentasPropiasPorConcepto: Map<string, number>;
  panelKey: string | null;
  onAbrir: (key: string) => void;
  onAbrirTraza: (key: string, escenario: 'PROYECCION' | 'CAUSADO') => void;
  renderPanel: (key: string, i: number) => React.ReactNode;
  etiquetasFila: (r: Regla) => { etiqueta: EtiquetaFila; texto: string }[];
}) {
  return (
    <div>
      <div className="bg-white px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {bloque.label}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-3 py-1.5 text-left">Concepto</th>
            <th className="px-3 py-1.5 text-left">Cómo se estima</th>
            <th className="px-3 py-1.5 text-right">Proyectado</th>
            <th className="px-3 py-1.5 text-right">Causado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(({ r, i }) => {
            const abierto = panelKey === r.key;
            const etiquetas = etiquetasFila(r);
            return (
              <Fragment key={r.key}>
                <tr
                  className={`cursor-pointer border-t border-slate-100 hover:bg-emerald-50/40 ${
                    abierto ? 'bg-emerald-50/60' : ''
                  }`}
                  onClick={() => onAbrir(r.key)}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 font-medium text-slate-800">
                      <i
                        className={`ri-arrow-right-s-line text-slate-400 transition-transform ${
                          abierto ? 'rotate-90' : ''
                        }`}
                      />
                      {r.concepto}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 pl-5">
                      {r.nombre && <span className="text-[11px] text-slate-500">{r.nombre}</span>}
                      {etiquetas.map((e) => (
                        <span
                          key={e.etiqueta}
                          title={ETIQUETA_TITULO[e.etiqueta]}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${COLOR_ETIQUETA[e.etiqueta]}`}
                        >
                          {e.texto}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{comoSeEstima(r, metodos[r.metodo])}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onAbrirTraza(r.key, 'PROYECCION');
                      }}
                      className="font-mono font-semibold tabular-nums hover:text-emerald-700 hover:underline"
                      title="¿Por qué este número?"
                    >
                      {fmt(val[i])}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onAbrirTraza(r.key, 'CAUSADO');
                      }}
                      className="font-mono tabular-nums text-slate-600 hover:text-emerald-700 hover:underline"
                      title="¿Por qué este número?"
                    >
                      {fmt(valCausado[i])}
                    </button>
                  </td>
                </tr>
                {abierto && (
                  <tr>
                    <td colSpan={4} className="bg-slate-50/60 px-3 py-3">
                      {renderPanel(r.key, i)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
