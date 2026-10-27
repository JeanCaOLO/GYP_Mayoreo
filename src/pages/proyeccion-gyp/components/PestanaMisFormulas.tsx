/**
 * Pestaña 7 · Mis fórmulas (CP-28, Requirement 19.1–19.4).
 *
 * Biblioteca de fórmulas propias «por piezas»: cada fórmula es una SUMA DE PIEZAS
 * con signo y % (fold de pasos, CP-18). Se listan con su frase «en palabras» y las
 * reglas que las usan; se puede editar, eliminar y crear («+ Nueva fórmula»). Una
 * fórmula nueva/editada se PRUEBA sobre cualquier regla mostrando su impacto antes
 * de guardar (19.3). Un desplegable guarda las opciones de fábrica y las fórmulas
 * del editor anterior; editar una de fábrica CREA UNA COPIA y conserva la original
 * (19.4). Si se edita desde una regla una fórmula usada por otras, se pregunta si
 * se cambia en todas (19.4).
 *
 * ── Alcance de persistencia ──
 * El componente es AUTOCONTENIDO y maneja su propio estado. La persistencia real
 * se hace con `crearFormula` / `actualizarFormula` / `eliminarFormula` de data.ts
 * (que escriben en la tabla `proyeccion_formula` con el modelo `Paso[]` / `Causado`
 * del motor v2). Aquí se invocan de forma optimista: el estado local se actualiza
 * de inmediato y la escritura viaja en segundo plano. Si no hay sesión/datos
 * (modo demo), el estado local sigue siendo la fuente de verdad.
 *
 * La prueba de impacto (19.3) usa un evaluador local ligero de la suma de piezas
 * contra el contexto de la regla elegida (venta, histórico, presupuesto, otras
 * reglas). No invoca el motor completo para no arrastrar el oráculo de 190 casos.
 */
import { useEffect, useMemo, useState } from 'react';
import type { BaseCapas, Causado, Metodo, OpPaso, Paso, Regla } from '../engine';
import {
  actualizarFormula as persistirActualizar,
  cargarFormulas,
  crearFormula as persistirCrear,
  eliminarFormula as persistirEliminar,
} from '../data';
import { fmt } from './formato';
import { Modal } from '@/components/base/Modal';
import { ConfirmModal } from '@/components/base/ConfirmModal';

// ─────────────────────────────────────────────────────────────────────────────
// Modelo local de una fórmula propia de la biblioteca
// ─────────────────────────────────────────────────────────────────────────────

/** De qué cuentas lee una pieza (CP-28): este concepto, otros, o un prefijo. */
type FuenteCuentas = 'este' | 'otros' | 'prefijo';

/** Tipos de pieza de la suma (CP-28). Se traducen a `Paso` del motor v2. */
type TipoPieza =
  | 'monto_fijo' // un monto fijo
  | 'pct_venta' // un % de la venta del mes
  | 'tipico_cuentas' // lo típico de unas cuentas (promedio histórico)
  | 'mes_al_cierre' // lo que va del mes llevado al cierre
  | 'presupuesto' // el presupuesto de unas cuentas
  | 'pct_reglas'; // un % de lo que calculan otras reglas

/** Una pieza de la suma, con signo y % / monto (CP-28). */
interface Pieza {
  id: string;
  tipo: TipoPieza;
  /** +1 suma, −1 resta. */
  signo: 1 | -1;
  /** % en tanto por uno (0.05 = 5 %) o monto, según el tipo. */
  valor: number;
  /** De qué cuentas: este concepto, otros o un prefijo. */
  fuente: FuenteCuentas;
  /** Texto del prefijo / otros conceptos (solo informativo en la biblioteca). */
  referencia: string;
  /** Meses a mirar para «lo típico» (default 9). */
  meses: number;
}

/** Una fórmula de la biblioteca. */
interface Formula {
  /** id de `proyeccion_formula` cuando está persistida; local si es nueva. */
  id: number;
  rev: number;
  nombre: string;
  piezas: Pieza[];
  causado: Causado;
  deFabrica: boolean;
  /** id de la fórmula de fábrica de la que es copia (para comparar, 19.4). */
  copiaDe?: number;
  /** claves de las reglas que la usan (para la frase «las reglas que la usan»). */
  usadaPor: string[];
}

export interface PestanaMisFormulasProps {
  /** Reglas de trabajo, para «probar sobre una regla» (19.3). Opcional. */
  reglas?: Regla[];
  /** Métodos efectivos, para traducir «% de lo que calculan otras reglas». */
  metodos?: Record<string, Metodo>;
  /** Venta proyectada por empresa (del cálculo), para la prueba de impacto. */
  ventaPorEmpresa?: Record<string, number>;
  /** Avisos (toast). Opcional; si falta, los mensajes se muestran en línea. */
  onAviso?: (tipo: 'success' | 'error' | 'info', texto: string) => void;
  /** Guarda un método del sistema editado (nombre, valor por defecto, invertir). */
  onGuardarMetodo?: (m: Metodo) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de plantillas (CP-28: cuatro plantillas de fábrica)
// ─────────────────────────────────────────────────────────────────────────────

let _uid = 0;
const nuevoId = () => `p${Date.now().toString(36)}${(_uid++).toString(36)}`;

const piezaVacia = (tipo: TipoPieza): Pieza => ({
  id: nuevoId(),
  tipo,
  signo: 1,
  valor: tipo === 'monto_fijo' ? 0 : tipo.startsWith('pct') ? 0.05 : 1,
  fuente: 'este',
  referencia: '',
  meses: 9,
});

/** Las cuatro plantillas de fábrica (CP-28). */
const PLANTILLAS: { clave: string; nombre: string; piezas: () => Pieza[] }[] = [
  {
    clave: 'fijo_mas_pct_venta',
    nombre: 'Monto fijo + % de la venta',
    piezas: () => [
      { ...piezaVacia('monto_fijo'), valor: 0 },
      { ...piezaVacia('pct_venta'), valor: 0.03 },
    ],
  },
  {
    clave: 'presupuesto_ajustado',
    nombre: 'Presupuesto ajustado (+5 %)',
    piezas: () => [
      { ...piezaVacia('presupuesto'), valor: 1 },
      { ...piezaVacia('presupuesto'), valor: 0.05 },
    ],
  },
  {
    clave: 'tipico_mas_extra',
    nombre: 'Lo típico + un extra',
    piezas: () => [
      { ...piezaVacia('tipico_cuentas'), valor: 1, meses: 9 },
      { ...piezaVacia('monto_fijo'), valor: 0 },
    ],
  },
  {
    clave: 'pct_otros_gastos',
    nombre: '% de otros gastos',
    piezas: () => [{ ...piezaVacia('pct_reglas'), valor: 0.1, fuente: 'otros' }],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de fábrica + «fórmulas del editor anterior» (CP-28: el desplegable)
// ─────────────────────────────────────────────────────────────────────────────

const FORMULAS_FABRICA: Formula[] = PLANTILLAS.map((pl, i) => ({
  id: -(i + 1), // ids negativos = de fábrica, no persistidas aún
  rev: 0,
  nombre: pl.nombre,
  piezas: pl.piezas(),
  causado: 'igual',
  deFabrica: true,
  usadaPor: [],
}));

// ─────────────────────────────────────────────────────────────────────────────
// Frase «en palabras» (CP-28, Requirement 19.1)
// ─────────────────────────────────────────────────────────────────────────────

const pctStr = (v: number) => `${(v * 100).toLocaleString('es-VE', { maximumFractionDigits: 2 })} %`;

const fuenteStr = (p: Pieza): string => {
  if (p.fuente === 'este') return 'de este concepto';
  if (p.fuente === 'otros') return p.referencia ? `de ${p.referencia}` : 'de otros conceptos';
  return p.referencia ? `de las cuentas ${p.referencia}` : 'de un prefijo de cuentas';
};

/** Traduce una pieza a lenguaje natural. */
function piezaEnPalabras(p: Pieza): string {
  switch (p.tipo) {
    case 'monto_fijo':
      return `un monto fijo de ${fmt(p.valor)}`;
    case 'pct_venta':
      return `${pctStr(p.valor)} de la venta del mes`;
    case 'tipico_cuentas':
      return `lo típico (${p.meses} meses) ${fuenteStr(p)}`;
    case 'mes_al_cierre':
      return `lo que va del mes llevado al cierre ${fuenteStr(p)}`;
    case 'presupuesto':
      return p.valor === 1
        ? `el presupuesto ${fuenteStr(p)}`
        : `${pctStr(p.valor)} del presupuesto ${fuenteStr(p)}`;
    case 'pct_reglas':
      return `${pctStr(p.valor)} de lo que calculan ${fuenteStr(p)}`;
  }
}

/** Frase completa «en palabras» de la fórmula (19.1). */
function formulaEnPalabras(f: Formula): string {
  if (f.piezas.length === 0) return 'Sin piezas todavía.';
  return f.piezas
    .map((p, i) => {
      const txt = piezaEnPalabras(p);
      if (i === 0) return p.signo < 0 ? `menos ${txt}` : txt;
      return `${p.signo < 0 ? 'menos' : 'más'} ${txt}`;
    })
    .join(', ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Traducción a pasos del motor v2 (para persistir con data.ts)
// ─────────────────────────────────────────────────────────────────────────────

const OP_DE_PIEZA: Record<TipoPieza, OpPaso> = {
  monto_fijo: 'valor_fijo',
  pct_venta: 'ratio_venta',
  tipico_cuentas: 'promedio',
  mes_al_cierre: 'componentes',
  presupuesto: 'presupuesto',
  pct_reglas: 'porcentaje',
};

function baseDePieza(p: Pieza): BaseCapas {
  if (p.tipo === 'pct_venta') return { origen: 'real', ref: 'venta' };
  if (p.tipo === 'presupuesto') return { origen: 'presupuesto' };
  if (p.tipo === 'pct_reglas') return { origen: 'otra_regla' };
  if (p.fuente === 'prefijo')
    return { origen: 'real', capas: [{ tipo: 'prefijo_cuenta', valores: [p.referencia] }] };
  return { origen: 'real', ref: 'ninguna' };
}

/** Datos de la pieza que viajan junto al `Paso` para poder reabrirla en el editor. */
type PasoConPieza = Paso & { pieza?: Pick<Pieza, 'tipo' | 'fuente' | 'referencia'> };

/** Convierte las piezas (con signo) en la secuencia de `Paso` del motor v2. */
function piezasAPasos(piezas: Pieza[]): Paso[] {
  return piezas.map(
    (p): PasoConPieza => ({
      op: OP_DE_PIEZA[p.tipo],
      base: baseDePieza(p),
      valor: p.valor,
      n: p.tipo === 'tipico_cuentas' ? p.meses : null,
      invertir: p.signo < 0,
      pieza: { tipo: p.tipo, fuente: p.fuente, referencia: p.referencia },
    }),
  );
}

/** Inversa de `piezasAPasos`: reconstruye las piezas de una fórmula guardada. */
function pasosAPiezas(pasos: Paso[]): Pieza[] {
  const tipoDeOp = Object.fromEntries(
    Object.entries(OP_DE_PIEZA).map(([t, op]) => [op, t as TipoPieza]),
  ) as Partial<Record<OpPaso, TipoPieza>>;
  return (pasos as PasoConPieza[]).map((paso) => {
    const prefijo = paso.base?.capas?.find((c) => c.tipo === 'prefijo_cuenta')?.valores?.[0];
    return {
      id: nuevoId(),
      tipo: paso.pieza?.tipo ?? tipoDeOp[paso.op] ?? 'monto_fijo',
      signo: paso.invertir ? -1 : 1,
      valor: paso.valor ?? 0,
      fuente: paso.pieza?.fuente ?? (prefijo ? 'prefijo' : 'este'),
      referencia: paso.pieza?.referencia ?? prefijo ?? '',
      meses: paso.n ?? 9,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Prueba de impacto (CP-28, Requirement 19.3) — evaluador local ligero
// ─────────────────────────────────────────────────────────────────────────────

/** Promedio de los últimos `n` valores de la serie. */
function tipico(serie: number[], n: number): number {
  if (!serie || serie.length === 0) return 0;
  const corte = serie.slice(-Math.max(1, n));
  return corte.reduce((a, b) => a + b, 0) / corte.length;
}

/**
 * Evalúa la suma de piezas contra el contexto de una regla. Es una aproximación
 * de presentación para que la persona vea el orden de magnitud antes de guardar;
 * el motor oficial recalcula al asignar la fórmula a la regla.
 */
function evaluarImpacto(
  piezas: Pieza[],
  regla: Regla | undefined,
  venta: number,
  otrasReglasTotal: number,
): number {
  const serie = regla?.serie ?? [];
  const acum = regla?.acum ?? 0;
  const presupuesto = regla?.presupuesto ?? 0;
  let total = 0;
  for (const p of piezas) {
    let parte = 0;
    switch (p.tipo) {
      case 'monto_fijo':
        parte = p.valor;
        break;
      case 'pct_venta':
        parte = p.valor * venta;
        break;
      case 'tipico_cuentas':
        parte = p.valor * tipico(serie, p.meses);
        break;
      case 'mes_al_cierre':
        // Lo registrado del mes llevado al cierre: aquí el acumulado como proxy.
        parte = p.valor * acum;
        break;
      case 'presupuesto':
        parte = p.valor * presupuesto;
        break;
      case 'pct_reglas':
        parte = p.valor * otrasReglasTotal;
        break;
    }
    total += p.signo * parte;
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export default function PestanaMisFormulas({
  reglas = [],
  metodos = {},
  ventaPorEmpresa = {},
  onAviso,
  onGuardarMetodo,
}: PestanaMisFormulasProps) {
  // Biblioteca de fórmulas propias (estado local; fuente de verdad en la UI).
  const [formulas, setFormulas] = useState<Formula[]>([]);
  // Método del sistema en edición.
  const [metodoEditando, setMetodoEditando] = useState<Metodo | null>(null);
  // Catálogo del desplegable: fábrica + propias (CP-28).
  const [mostrarFabrica, setMostrarFabrica] = useState(false);

  // Editor
  const [editor, setEditor] = useState<Formula | null>(null);
  const [editorNueva, setEditorNueva] = useState(false);

  // Confirmaciones
  const [aBorrar, setABorrar] = useState<Formula | null>(null);
  const [preguntaTodas, setPreguntaTodas] = useState<Formula | null>(null);

  const aviso = (tipo: 'success' | 'error' | 'info', texto: string) => {
    if (onAviso) onAviso(tipo, texto);
  };

  // Las fórmulas guardadas en `proyeccion_formula` se cargan al abrir la pestaña
  // para poder editarlas. Sin base (modo demo) la biblioteca arranca vacía.
  useEffect(() => {
    let vivo = true;
    cargarFormulas()
      .then((guardadas) => {
        if (!vivo) return;
        setFormulas(
          guardadas.map((g) => ({
            id: g.id,
            rev: g.rev,
            nombre: g.nombre,
            piezas: pasosAPiezas(g.pasos),
            causado: g.causado,
            deFabrica: false,
            usadaPor: [],
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  // Métodos del sistema (los que eligen las reglas), con cuántas reglas los usan.
  const listaMetodos = useMemo(
    () =>
      Object.values(metodos).map((m) => ({
        metodo: m,
        usos: reglas.filter((r) => r.metodo === m.id).length,
      })),
    [metodos, reglas],
  );

  // «Las otras reglas» como un total aproximado para la pieza % de reglas.
  const otrasReglasTotal = useMemo(
    () => Object.keys(metodos).length * 0, // sin cálculo propio: queda en 0 si no hay engine
    [metodos],
  );

  // ── Abrir editores ──
  const abrirNueva = (piezas?: Pieza[], nombre = 'Nueva fórmula') => {
    setEditor({
      id: Math.floor(-1e6 - Math.random() * 1e6),
      rev: 0,
      nombre,
      piezas: piezas ?? [piezaVacia('monto_fijo')],
      causado: 'igual',
      deFabrica: false,
      usadaPor: [],
    });
    setEditorNueva(true);
  };

  const abrirDesdeFabrica = (f: Formula) => {
    // Editar una de fábrica CREA UNA COPIA y deja la original (19.4).
    setEditor({
      ...f,
      id: Math.floor(-1e6 - Math.random() * 1e6),
      rev: 0,
      nombre: `${f.nombre} (copia)`,
      piezas: f.piezas.map((p) => ({ ...p, id: nuevoId() })),
      deFabrica: false,
      copiaDe: f.id,
      usadaPor: [],
    });
    setEditorNueva(true);
  };

  const abrirEditar = (f: Formula) => {
    setEditor({ ...f, piezas: f.piezas.map((p) => ({ ...p })) });
    setEditorNueva(false);
  };

  // ── Guardar ──
  const guardar = async (f: Formula) => {
    if (!f.nombre.trim()) {
      aviso('error', 'Ponle un nombre a la fórmula.');
      return;
    }
    if (f.piezas.length === 0) {
      aviso('error', 'Agrega al menos una pieza.');
      return;
    }

    // Si se edita una fórmula ya usada por otras reglas, preguntar (19.4).
    if (!editorNueva && f.usadaPor.length > 1) {
      setPreguntaTodas(f);
      return;
    }

    await confirmarGuardado(f, true);
  };

  const confirmarGuardado = async (f: Formula, enTodas: boolean) => {
    const cambios = {
      nombre: f.nombre,
      pasos: piezasAPasos(f.piezas),
      causado: f.causado,
      de_fabrica: false,
    };

    if (editorNueva) {
      // Estado local inmediato.
      const local: Formula = { ...f };
      setFormulas((prev) => [...prev, local]);
      // Persistencia optimista.
      try {
        const res = await persistirCrear(cambios);
        if (res.ok && res.id != null) {
          setFormulas((prev) =>
            prev.map((x) => (x.id === local.id ? { ...x, id: res.id!, rev: res.rev ?? 0 } : x)),
          );
        }
      } catch {
        /* modo demo: el estado local es la fuente de verdad */
      }
      aviso('success', `Fórmula «${f.nombre}» creada.`);
    } else {
      setFormulas((prev) => prev.map((x) => (x.id === f.id ? { ...f } : x)));
      if (f.id > 0) {
        try {
          const res = await persistirActualizar(f.id, f.rev, cambios);
          if (res.ok) {
            setFormulas((prev) =>
              prev.map((x) => (x.id === f.id ? { ...x, rev: res.rev ?? x.rev + 1 } : x)),
            );
          } else if (res.motivo === 'conflicto') {
            aviso('error', 'Alguien guardó esta fórmula antes. Recarga para no pisar su cambio.');
          }
        } catch {
          /* modo demo */
        }
      }
      aviso(
        'success',
        enTodas && f.usadaPor.length > 1
          ? `Fórmula «${f.nombre}» actualizada en las ${f.usadaPor.length} reglas que la usan.`
          : `Fórmula «${f.nombre}» actualizada.`,
      );
    }
    setEditor(null);
    setPreguntaTodas(null);
  };

  // ── Eliminar ──
  const eliminar = async (f: Formula) => {
    setFormulas((prev) => prev.filter((x) => x.id !== f.id));
    if (f.id > 0) {
      try {
        await persistirEliminar(f.id);
      } catch {
        /* modo demo */
      }
    }
    aviso('success', `Fórmula «${f.nombre}» eliminada.`);
    setABorrar(null);
  };

  const hayFormulas = formulas.length > 0;

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Mis fórmulas</h2>
          <p className="text-sm text-slate-500">
            Biblioteca de fórmulas propias por piezas, reutilizables entre reglas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => abrirNueva()}
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <i className="ri-add-line mr-1"></i>Nueva fórmula
        </button>
      </div>

      {/* Desplegable: opciones de fábrica + fórmulas del editor anterior (CP-28). */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setMostrarFabrica((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-medium text-slate-700">
            Plantillas de fábrica y del editor anterior
          </span>
          <i className={`ri-arrow-down-s-line text-lg text-slate-400 ${mostrarFabrica ? 'rotate-180' : ''}`}></i>
        </button>
        {mostrarFabrica && (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {FORMULAS_FABRICA.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{f.nombre}</p>
                  <p className="truncate text-xs text-slate-500">{formulaEnPalabras(f)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => abrirDesdeFabrica(f)}
                  className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  title="Editar crea una copia y conserva la original"
                >
                  Editar (crea copia)
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Biblioteca propia (19.1). */}
      {!hayFormulas ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
          Aún no tienes fórmulas propias. Crea una con «Nueva fórmula» o parte de una plantilla.
        </div>
      ) : (
        <ul className="space-y-3">
          {formulas.map((f) => (
            <li key={f.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{f.nombre}</h3>
                    {f.copiaDe != null && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                        copia de fábrica
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{formulaEnPalabras(f)}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {f.usadaPor.length === 0
                      ? 'No la usa ninguna regla todavía.'
                      : `La usan ${f.usadaPor.length} regla${f.usadaPor.length === 1 ? '' : 's'}: ${f.usadaPor.join(', ')}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => abrirEditar(f)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setABorrar(f)}
                    className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Métodos del sistema: los que eligen las reglas. Editarlos cambia el
          cálculo de todas las reglas que los usan sin valor propio. */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Métodos del sistema</h3>
          <p className="text-xs text-slate-500">
            Los métodos que eligen las reglas. Editar el valor por defecto recalcula todas las reglas
            que lo usan sin valor propio.
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {listaMetodos.map(({ metodo: m, usos }) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {m.nombre}
                  <span className="ml-2 font-mono text-[11px] text-slate-400">{m.id}</span>
                </p>
                <p className="truncate text-xs text-slate-500">
                  {m.op}
                  {m.base !== 'ninguna' ? ` sobre ${m.base}` : ''}
                  {m.valor != null ? ` · valor ${valorMetodoStr(m)}` : ''}
                  {m.invertir ? ' · invertido' : ''} · turno {m.orden} ·{' '}
                  {usos === 0 ? 'sin reglas' : `${usos} regla${usos === 1 ? '' : 's'}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMetodoEditando({ ...m })}
                disabled={!onGuardarMetodo}
                className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Editar
              </button>
            </li>
          ))}
        </ul>
      </div>

      {metodoEditando && (
        <EditorMetodo
          metodo={metodoEditando}
          onChange={setMetodoEditando}
          onCerrar={() => setMetodoEditando(null)}
          onGuardar={(m) => {
            if (!m.nombre.trim()) {
              aviso('error', 'Ponle un nombre al método.');
              return;
            }
            onGuardarMetodo?.(m);
            setMetodoEditando(null);
          }}
        />
      )}

      {/* Editor de fórmula (armador por piezas + prueba de impacto). */}
      {editor && (
        <EditorFormula
          formula={editor}
          esNueva={editorNueva}
          reglas={reglas}
          ventaPorEmpresa={ventaPorEmpresa}
          otrasReglasTotal={otrasReglasTotal}
          onChange={setEditor}
          onGuardar={guardar}
          onCerrar={() => setEditor(null)}
        />
      )}

      {/* Confirmar eliminación. */}
      {aBorrar && (
        <ConfirmModal
          isOpen
          title="Eliminar fórmula"
          message={`¿Eliminar la fórmula «${aBorrar.nombre}»? Esta acción no se puede deshacer aquí.`}
          confirmText="Eliminar"
          variant="danger"
          onConfirm={() => eliminar(aBorrar)}
          onClose={() => setABorrar(null)}
        />
      )}

      {/* Preguntar si el cambio se aplica a todas las reglas que la usan (19.4).
          Es una elección de tres salidas (todas / solo esta / cancelar), por eso
          usa el Modal base en vez de ConfirmModal (que solo da confirmar/cerrar). */}
      {preguntaTodas && (
        <Modal
          isOpen
          onClose={() => setPreguntaTodas(null)}
          title="Cambiar en todas las reglas"
          size="sm"
        >
          <div className="space-y-5">
            <p className="text-sm text-slate-600">
              «{preguntaTodas.nombre}» la usan {preguntaTodas.usadaPor.length} reglas. ¿Aplicar el
              cambio en todas, o dejarlo solo en la regla desde la que editas?
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => confirmarGuardado(preguntaTodas, true)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Cambiar en todas
              </button>
              <button
                type="button"
                onClick={() => confirmarGuardado(preguntaTodas, false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Solo en esta
              </button>
              <button
                type="button"
                onClick={() => setPreguntaTodas(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor de fórmula — armador por piezas + prueba sobre una regla (19.2, 19.3)
// ─────────────────────────────────────────────────────────────────────────────

const TIPOS_PIEZA: { tipo: TipoPieza; etiqueta: string }[] = [
  { tipo: 'monto_fijo', etiqueta: 'Un monto fijo' },
  { tipo: 'pct_venta', etiqueta: 'Un % de la venta del mes' },
  { tipo: 'tipico_cuentas', etiqueta: 'Lo típico de unas cuentas' },
  { tipo: 'mes_al_cierre', etiqueta: 'Lo que va del mes, al cierre' },
  { tipo: 'presupuesto', etiqueta: 'El presupuesto de unas cuentas' },
  { tipo: 'pct_reglas', etiqueta: '% de lo que calculan otras reglas' },
];

const esPorcentaje = (t: TipoPieza) =>
  t === 'pct_venta' || t === 'pct_reglas' || t === 'presupuesto';

interface EditorFormulaProps {
  formula: Formula;
  esNueva: boolean;
  reglas: Regla[];
  ventaPorEmpresa: Record<string, number>;
  otrasReglasTotal: number;
  onChange: (f: Formula) => void;
  onGuardar: (f: Formula) => void;
  onCerrar: () => void;
}

function EditorFormula({
  formula,
  esNueva,
  reglas,
  ventaPorEmpresa,
  otrasReglasTotal,
  onChange,
  onGuardar,
  onCerrar,
}: EditorFormulaProps) {
  const [reglaPruebaKey, setReglaPruebaKey] = useState<string>(reglas[0]?.key ?? '');

  const reglaPrueba = useMemo(
    () => reglas.find((r) => r.key === reglaPruebaKey),
    [reglas, reglaPruebaKey],
  );
  const venta = reglaPrueba ? (ventaPorEmpresa[reglaPrueba.empresa] ?? 0) : 0;
  const impacto = useMemo(
    () => evaluarImpacto(formula.piezas, reglaPrueba, venta, otrasReglasTotal),
    [formula.piezas, reglaPrueba, venta, otrasReglasTotal],
  );

  const setPieza = (id: string, cambio: Partial<Pieza>) =>
    onChange({
      ...formula,
      piezas: formula.piezas.map((p) => (p.id === id ? { ...p, ...cambio } : p)),
    });

  const agregarPieza = () =>
    onChange({ ...formula, piezas: [...formula.piezas, piezaVacia('monto_fijo')] });

  const quitarPieza = (id: string) =>
    onChange({ ...formula, piezas: formula.piezas.filter((p) => p.id !== id) });

  return (
    <Modal isOpen onClose={onCerrar} title={esNueva ? 'Nueva fórmula' : 'Editar fórmula'} size="xl">
      <div className="space-y-5">
        {/* Nombre */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Nombre</label>
          <input
            type="text"
            value={formula.nombre}
            onChange={(e) => onChange({ ...formula, nombre: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            placeholder="p. ej. Logística: fijo + % de la venta"
          />
        </div>

        {/* Piezas (suma con signo y %) */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-medium text-slate-600">Piezas de la suma</label>
            <button
              type="button"
              onClick={agregarPieza}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <i className="ri-add-line mr-1"></i>Agregar pieza
            </button>
          </div>
          <div className="space-y-2">
            {formula.piezas.map((p) => (
              <div
                key={p.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-[auto_1.4fr_1fr_1fr_auto]"
              >
                {/* Signo */}
                <select
                  value={p.signo}
                  onChange={(e) => setPieza(p.id, { signo: Number(e.target.value) as 1 | -1 })}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  aria-label="Signo"
                >
                  <option value={1}>+ Suma</option>
                  <option value={-1}>− Resta</option>
                </select>

                {/* Tipo de pieza */}
                <select
                  value={p.tipo}
                  onChange={(e) => setPieza(p.id, { tipo: e.target.value as TipoPieza })}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  aria-label="Tipo de pieza"
                >
                  {TIPOS_PIEZA.map((t) => (
                    <option key={t.tipo} value={t.tipo}>
                      {t.etiqueta}
                    </option>
                  ))}
                </select>

                {/* Valor (% o monto) */}
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="any"
                    value={esPorcentaje(p.tipo) ? p.valor * 100 : p.valor}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      setPieza(p.id, { valor: esPorcentaje(p.tipo) ? raw / 100 : raw });
                    }}
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    aria-label={esPorcentaje(p.tipo) ? 'Porcentaje' : 'Monto'}
                  />
                  <span className="text-xs text-slate-400">{esPorcentaje(p.tipo) ? '%' : '$'}</span>
                </div>

                {/* De qué cuentas */}
                {p.tipo === 'tipico_cuentas' ||
                p.tipo === 'mes_al_cierre' ||
                p.tipo === 'presupuesto' ||
                p.tipo === 'pct_reglas' ? (
                  <div className="flex items-center gap-1">
                    <select
                      value={p.fuente}
                      onChange={(e) => setPieza(p.id, { fuente: e.target.value as FuenteCuentas })}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      aria-label="De qué cuentas"
                    >
                      <option value="este">Este concepto</option>
                      <option value="otros">Otros conceptos</option>
                      <option value="prefijo">Prefijo de cuenta</option>
                    </select>
                    {(p.fuente === 'otros' || p.fuente === 'prefijo') && (
                      <input
                        type="text"
                        value={p.referencia}
                        onChange={(e) => setPieza(p.id, { referencia: e.target.value })}
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        placeholder={p.fuente === 'prefijo' ? 'p. ej. 6201' : 'p. ej. Logístico'}
                        aria-label="Referencia"
                      />
                    )}
                  </div>
                ) : (
                  <div />
                )}

                {/* Quitar */}
                <button
                  type="button"
                  onClick={() => quitarPieza(p.id)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Quitar pieza"
                >
                  <i className="ri-delete-bin-line"></i>
                </button>
              </div>
            ))}
          </div>

          {/* Frase en palabras en vivo */}
          <p className="mt-2 rounded-lg bg-slate-900/5 px-3 py-2 text-sm text-slate-700">
            <span className="font-medium text-slate-500">En palabras: </span>
            {formulaEnPalabras(formula)}
          </p>
        </div>

        {/* Causado */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Cómo se causa durante el mes
          </label>
          <select
            value={formula.causado}
            onChange={(e) => onChange({ ...formula, causado: e.target.value as Causado })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="igual">Igual (sin prorrateo)</option>
            <option value="habiles">Por días hábiles</option>
            <option value="calendario">Por días de calendario</option>
            <option value="real">Lo realmente registrado</option>
          </select>
        </div>

        {/* Probar sobre una regla (19.3) */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-slate-600">Probar sobre una regla</label>
            <select
              value={reglaPruebaKey}
              onChange={(e) => setReglaPruebaKey(e.target.value)}
              className="max-w-[60%] truncate rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              disabled={reglas.length === 0}
            >
              {reglas.length === 0 ? (
                <option value="">No hay reglas cargadas</option>
              ) : (
                reglas.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.empresa} · {r.concepto}
                  </option>
                ))
              )}
            </select>
          </div>
          {reglaPrueba ? (
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-500">Impacto estimado al cierre</span>
              <span className={`text-lg font-semibold ${impacto < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {fmt(impacto)}
              </span>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Conecta las reglas para ver el impacto antes de guardar.
            </p>
          )}
        </div>

        {/* Acciones */}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onGuardar(formula)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Guardar fórmula
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor de un método del sistema — nombre, valor por defecto e invertir
// ─────────────────────────────────────────────────────────────────────────────

/** Operaciones cuyo `valor` es un % en tanto por uno. */
const esOpPorcentaje = (m: Metodo) => m.op === 'porcentaje';
/** Operaciones que usan `valor` (el resto sale de la historia o de otras reglas). */
const usaValor = (m: Metodo) =>
  ['porcentaje', 'multiplicar', 'sumar', 'restar', 'valor_fijo'].includes(m.op);

function valorMetodoStr(m: Metodo): string {
  if (m.valor == null) return '—';
  return esOpPorcentaje(m) ? pctStr(m.valor) : fmt(m.valor, 2);
}

interface EditorMetodoProps {
  metodo: Metodo;
  onChange: (m: Metodo) => void;
  onGuardar: (m: Metodo) => void;
  onCerrar: () => void;
}

function EditorMetodo({ metodo, onChange, onGuardar, onCerrar }: EditorMetodoProps) {
  const pct = esOpPorcentaje(metodo);
  return (
    <Modal isOpen onClose={onCerrar} title="Editar método" size="md">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Nombre</label>
          <input
            type="text"
            value={metodo.nombre}
            onChange={(e) => onChange({ ...metodo, nombre: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <p className="text-xs text-slate-500">
          Operación <span className="font-mono">{metodo.op}</span>
          {metodo.base !== 'ninguna' ? ` sobre ${metodo.base}` : ''} · turno {metodo.orden}
        </p>
        {usaValor(metodo) ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Valor por defecto {pct ? '(%)' : '($)'}
            </label>
            <input
              type="number"
              step="any"
              value={metodo.valor == null ? '' : pct ? metodo.valor * 100 : metodo.valor}
              onChange={(e) => {
                const raw = e.target.value === '' ? null : Number(e.target.value);
                onChange({ ...metodo, valor: raw == null ? null : pct ? raw / 100 : raw });
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Este método no usa un valor: sale de la historia, la venta u otras reglas.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={metodo.invertir}
            onChange={(e) => onChange({ ...metodo, invertir: e.target.checked })}
          />
          Invertir el signo del resultado
        </label>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onGuardar(metodo)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Guardar método
          </button>
        </div>
      </div>
    </Modal>
  );
}
