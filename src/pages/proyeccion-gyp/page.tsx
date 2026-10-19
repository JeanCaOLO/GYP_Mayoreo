import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  calcular,
  formula,
  turnoSugerido,
  OPS,
  BASES,
  TURNOS,
  TURNO_CORTO,
  PAIS,
  type Metodo,
  type Regla,
  type Operacion,
  type Base,
  type GrupoPL,
} from './engine';
import { CIFRAS_VALIDADAS, EMPRESAS } from './seed';
import {
  construirDesdeSemilla,
  cargarDesdeSupabase,
  ensamblarReglas,
  publicarResultado,
  type ProyeccionData,
  type ReglaBase,
  type FilaResultado,
} from './data';

// ─────────────────────────────────────────────────────────────────────────────
// Formato
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined, d = 0): string =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });

const OP_SIN_BASE: Operacion[] = ['valor_fijo', 'promedio', 'formula_venta', 'derivada'];
const OP_PIDE_VALOR: Operacion[] = ['porcentaje', 'multiplicar', 'sumar', 'restar', 'valor_fijo'];

type TabId = 'p1' | 'p2' | 'p3' | 'p4' | 'p5';
const TABS: { id: TabId; n: number; label: string }[] = [
  { id: 'p1', n: 1, label: 'Parámetros' },
  { id: 'p2', n: 2, label: 'Métodos' },
  { id: 'p3', n: 3, label: 'Reglas' },
  { id: 'p4', n: 4, label: 'Resultado' },
  { id: 'p5', n: 5, label: 'Tabla de salida' },
];

/** Overrides del usuario sobre una regla base, por clave empresa|concepto. */
interface Override {
  metodo?: string;
  valor?: number | null;
  n?: number | null;
  borrada?: boolean;
}
interface NuevaRegla extends ReglaBase {
  n?: number | null;
}

export default function ProyeccionGypPage() {
  const { addToast } = useToast();
  const { isAdmin } = useAuth();

  const [data, setData] = useState<ProyeccionData>(() => construirDesdeSemilla());
  const [tab, setTab] = useState<TabId>('p1');

  // Estado editable del usuario (equivalente a `est` del prototipo).
  const [gn, setGn] = useState(9);
  const [params, setParams] = useState(() => data.params);
  const [metodosUser, setMetodosUser] = useState<Record<string, Metodo>>({});
  const [metBorrados, setMetBorrados] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [nuevas, setNuevas] = useState<NuevaRegla[]>([]);

  // Filtros / paneles
  const [filtroEmpresa, setFiltroEmpresa] = useState('*');
  const [filtroMetodo, setFiltroMetodo] = useState('*');
  const [panelMetodo, setPanelMetodo] = useState(false);
  const [panelAlta, setPanelAlta] = useState(false);
  const [publicando, setPublicando] = useState(false);

  const kk = (empresa: string, concepto: string) => empresa + '|' + concepto;

  // ── Métodos efectivos (fábrica + propios − borrados) ──
  const metodos = useMemo<Record<string, Metodo>>(() => {
    const m: Record<string, Metodo> = { ...data.metodos, ...metodosUser };
    metBorrados.forEach((k) => delete m[k]);
    return m;
  }, [data.metodos, metodosUser, metBorrados]);

  // ── Lista de reglas de trabajo (base con overrides + nuevas) ──
  const reglas = useMemo<Regla[]>(() => {
    const ensambladas = ensamblarReglas(data.reglasBase, data.series);
    const out: Regla[] = [];
    ensambladas.forEach((r) => {
      const o = overrides[kk(r.empresa, r.concepto)] || {};
      if (o.borrada) return;
      out.push({
        ...r,
        key: kk(r.empresa, r.concepto),
        metodo: o.metodo || r.metodo,
        valor: o.valor !== undefined ? o.valor : r.valor,
        n: o.n ?? null,
      });
    });
    nuevas.forEach((x, i) => {
      const sc = data.series[kk(x.empresa, x.concepto)] || { a: 0, s: [] };
      out.push({
        key: 'n' + i,
        empresa: x.empresa,
        concepto: x.concepto,
        grupo: x.grupo,
        metodo: x.metodo,
        valor: x.valor ?? null,
        n: x.n ?? null,
        combinada: x.combinada,
        cc: x.cc,
        cuenta: x.cuenta,
        pais: PAIS[x.empresa] || x.empresa,
        tasaMensual: x.tasaMensual,
        serie: (sc.s || []).map((v) => (v == null ? NaN : v)),
        acum: sc.a || 0,
        nueva: true,
      });
    });
    return out;
  }, [data.reglasBase, data.series, overrides, nuevas]);

  // ── Cálculo ──
  const resultado = useMemo(
    () => calcular({ reglas, metodos, params, empresas: EMPRESAS, gn }),
    [reglas, metodos, params, gn],
  );
  const { val, agg } = resultado;

  const tot = useCallback(
    (k: keyof (typeof agg)[string]) => EMPRESAS.reduce((a, e) => a + (agg[e]?.[k] || 0), 0),
    [agg],
  );
  const snBase = Object.values(CIFRAS_VALIDADAS).reduce((a, b) => a + b, 0);
  const sn = tot('sn');
  const dsn = sn - snBase;

  // ── Carga desde Supabase (opcional) ──
  const traer = useCallback(
    async (manual: boolean) => {
      const seed = construirDesdeSemilla();
      try {
        const nuevo = await cargarDesdeSupabase(seed.periodo, seed);
        setData(nuevo);
        setParams(nuevo.params);
        if (manual)
          addToast(
            'success',
            `Actualización completada — Fabric del ${nuevo.generado || '—'}, datos al ${nuevo.corte || '—'}. 6 empresas y ${nuevo.reglasBase.length} reglas recalculadas.`,
          );
      } catch {
        setData((d) => ({ ...d, fuente: manual ? 'error' : d.fuente }));
        if (manual)
          addToast('error', 'No hay extracción en la base. Se mantiene la foto embebida validada.');
      }
    },
    [addToast],
  );

  useEffect(() => {
    traer(false);
  }, [traer]);

  // ── Mutadores de reglas ──
  const mod = (key: string, campo: keyof Override, v: Override[keyof Override]) => {
    if (/^n\d+$/.test(key)) {
      const i = +key.slice(1);
      setNuevas((prev) => prev.map((x, j) => (j === i ? { ...x, [campo]: v } : x)));
    } else {
      setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], [campo]: v } }));
    }
  };
  const eliminarRegla = (key: string) => {
    if (/^n\d+$/.test(key)) {
      const i = +key.slice(1);
      setNuevas((prev) => prev.filter((_, j) => j !== i));
    } else {
      setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], borrada: true } }));
    }
  };

  const restablecer = () => {
    const seed = construirDesdeSemilla();
    setData(seed);
    setParams(seed.params);
    setMetodosUser({});
    setMetBorrados([]);
    setOverrides({});
    setNuevas([]);
    setGn(9);
    setPanelAlta(false);
    setPanelMetodo(false);
    addToast('info', 'Se restableció todo al estado validado por control.');
  };

  const eliminarMetodo = (id: string) => {
    const M = metodos;
    if (Object.keys(M).length <= 1) {
      addToast('error', 'No se puede eliminar: es el último método que queda.');
      return;
    }
    const usan = reglas.filter((r) => r.metodo === id);
    const destino =
      Object.keys(M).find((x) => x !== id && M[x].op === 'promedio') ||
      Object.keys(M).find((x) => x !== id)!;
    usan.forEach((r) => mod(r.key, 'metodo', destino));
    if (M[id].fijo) setMetBorrados((prev) => [...prev, id]);
    else setMetodosUser((prev) => { const c = { ...prev }; delete c[id]; return c; });
    addToast(
      'success',
      `Método "${M[id].nombre}" eliminado.${usan.length ? ` ${usan.length} regla${usan.length > 1 ? 's pasaron' : ' pasó'} a "${M[destino].nombre}".` : ''}`,
    );
  };

  // ── Publicar resultado a Supabase ──
  const publicar = async () => {
    if (!window.confirm('¿Publicar la proyección a la base? Reemplaza el resultado del periodo ' + data.periodo + '.')) return;
    setPublicando(true);
    try {
      const filas: FilaResultado[] = reglas.map((r, i) => ({
        periodo: data.periodo,
        // Contrato (08 §4): día 1 del periodo, nunca fin de mes.
        fecha: data.periodo + '-01',
        vista: 'GYP',
        combinada: r.combinada,
        pais: r.pais,
        empresa: r.empresa,
        tasa_mensual: r.tasaMensual,
        ajuste: 0,
        ajuste_usd: 0,
        monto_local: val[i] * (params[r.empresa]?.tasa || 0),
        monto_usd: val[i],
        centro_costo: r.cc,
        cuenta_contable: r.cuenta,
        proyeccion: 1,
      }));
      await publicarResultado(data.periodo, filas);
      addToast('success', `Proyección publicada: ${filas.length} filas en proyeccion_resultado.`);
    } catch (err) {
      addToast('error', 'No se pudo publicar: ' + (err as Error).message);
    } finally {
      setPublicando(false);
    }
  };

  // ── Tabla de salida (13 columnas) ──
  const copiarCsv = async () => {
    const header =
      'FECHA;Ajuste;Vista;Combinada;Pais;Empresa;Tasa_Mensual;Ajuste_USD;Monto_Local;Monto_USD;CENTRO_COSTO;CUENTA_CONTABLE;Proyeccion';
    const lineas = reglas.map((r, i) =>
      [
        data.periodo + '-01',
        0,
        'GYP',
        r.combinada,
        r.pais,
        r.empresa,
        r.tasaMensual == null ? '' : r.tasaMensual,
        0,
        (val[i] * (params[r.empresa]?.tasa || 0)).toFixed(2),
        val[i].toFixed(2),
        r.cc,
        r.cuenta,
        1,
      ].join(';'),
    );
    const txt = [header, ...lineas].join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      addToast('success', 'Tabla copiada como CSV (' + reglas.length + ' filas).');
    } catch {
      addToast('error', 'No se pudo copiar al portapapeles.');
    }
  };

  // Validaciones
  const avisos = useMemo(() => {
    const av: string[] = [];
    const dup: Record<string, number> = {};
    reglas.forEach((r) => {
      const k = r.empresa + '|' + r.combinada;
      dup[k] = (dup[k] || 0) + 1;
    });
    Object.keys(dup)
      .filter((k) => dup[k] > 1)
      .forEach((k) =>
        av.push(`Hay ${dup[k]} reglas activas sobre la cuenta ${k.split('|')[1]}. Ese monto se cuenta dos veces.`),
      );
    EMPRESAS.forEach((e) => {
      if (!reglas.some((r) => r.empresa === e && (r.concepto === 'Ventas' || (metodos[r.metodo] || {}).op === 'derivada')))
        av.push(`${e} se quedó sin regla de ingreso: su venta proyectada es cero.`);
    });
    reglas.forEach((r, i) => {
      if (r.grupo !== 'VENTAS' && val[i] < 0 && (metodos[r.metodo] || {}).op !== 'promedio')
        av.push(`${r.empresa} / ${r.concepto} da un gasto negativo (${fmt(val[i])}). Revisa el signo del método.`);
    });
    return av;
  }, [reglas, metodos, val]);

  // Prueba contable
  const pruebaMalas = useMemo(
    () =>
      EMPRESAS.filter((e) => {
        let s = 0;
        reglas.forEach((r, i) => {
          if (r.empresa === e && r.grupo === 'VENTAS') s += val[i];
        });
        return Math.abs(-s - (agg[e]?.rb || 0)) > 0.01;
      }),
    [reglas, val, agg],
  );

  const selloCfg =
    data.fuente === 'db'
      ? { color: 'bg-emerald-500', txt: `Fabric · ${data.generado || 'sin fecha'}${data.corte ? ' · datos al ' + data.corte : ''}` }
      : data.fuente === 'error'
      ? { color: 'bg-red-500', txt: 'No se pudo leer la base · usando la foto embebida' }
      : { color: 'bg-amber-500', txt: `Foto embebida · ${data.generado || 'sin fecha'}${data.corte ? ' · datos al ' + data.corte : ''}` };

  const kpis: { k: string; v: number; d: number | null }[] = [
    { k: 'Ingresos proyectados', v: tot('ing'), d: null },
    { k: 'Renta Bruta', v: tot('rb'), d: null },
    { k: 'Gastos Operativos', v: tot('go'), d: null },
    { k: 'Ganancia Operativa', v: tot('gop'), d: null },
    { k: 'Semi Neto', v: sn, d: dsn },
  ];

  const metodosList = Object.values(metodos);
  const uso: Record<string, number> = {};
  reglas.forEach((r) => (uso[r.metodo] = (uso[r.metodo] || 0) + 1));

  const reglasVisibles = reglas
    .map((r, i) => ({ r, i }))
    .filter(
      (o) =>
        (filtroEmpresa === '*' || o.r.empresa === filtroEmpresa) &&
        (filtroMetodo === '*' || o.r.metodo === filtroMetodo),
    );

  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Cabecera fija */}
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 bg-white border-b border-slate-200 px-4 md:px-6 pt-2 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Aplicativo de control</p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Proyección del GyP Mayoreo</h1>
          </div>
          <span className="ml-auto font-mono text-xs text-slate-500">
            Periodo {data.periodo} · {reglas.length} reglas · {metodosList.length} métodos
          </span>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 font-mono text-[11px] text-slate-500">
              <span className={`h-2 w-2 rounded-full ${selloCfg.color}`}></span>
              {selloCfg.txt}
            </span>
            <button
              onClick={() => traer(true)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Actualizar
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map((x) => (
            <div key={x.k} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{x.k}</div>
              <div className="mt-0.5 font-mono text-base font-semibold text-slate-900 tabular-nums">{fmt(x.v)}</div>
              <div className={`font-mono text-[11px] ${x.d == null ? 'text-slate-400' : x.d >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {x.d == null ? 'USD' : `${x.d >= 0 ? '+' : ''}${fmt(x.d)} vs validado`}
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <nav className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                tab === t.id ? 'border-emerald-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <span className="mr-1.5 font-mono text-xs text-slate-400">{t.n}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Paso 1: Parámetros ── */}
      {tab === 'p1' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Parámetros de proyección de venta</h2>
            <p className="text-sm text-slate-500">
              Solo afectan a los métodos con operación <b>Fórmula de venta</b>. Los días los propone el calendario de Fabric; el factor
              de corrección lo fija control.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">Empresa</th>
                  <th className="px-3 py-2 text-right">Días hábiles</th>
                  <th className="px-3 py-2 text-right">Transcurridos</th>
                  <th className="px-3 py-2 text-right">Restantes</th>
                  <th className="px-3 py-2 text-right">Factor</th>
                  <th className="px-3 py-2 text-right">Tasa local</th>
                  <th className="px-3 py-2 text-right">Venta acumulada</th>
                  <th className="px-3 py-2 text-right">Venta proyectada</th>
                </tr>
              </thead>
              <tbody>
                {EMPRESAS.map((e) => {
                  const p = params[e];
                  const rest = p.dias - p.trans;
                  const iv = reglas.findIndex((r) => r.empresa === e && r.concepto === 'Ventas');
                  const ic = reglas.findIndex((r) => r.empresa === e && (metodos[r.metodo] || {}).op === 'derivada');
                  const ac = iv >= 0 ? reglas[iv].acum : null;
                  const pr = iv >= 0 ? val[iv] : ic >= 0 ? val[ic] : 0;
                  const upd = (campo: 'dias' | 'trans' | 'factor', v: number) =>
                    setParams((prev) => ({ ...prev, [e]: { ...prev[e], [campo]: v } }));
                  return (
                    <tr key={e} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-800">{e}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input type="number" min={1} max={31} value={p.dias} onChange={(ev) => upd('dias', +ev.target.value || 0)} className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs" />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input type="number" min={0} max={31} value={p.trans} onChange={(ev) => upd('trans', +ev.target.value || 0)} className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs" />
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{rest}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input type="number" step={0.01} min={0} max={5} value={p.factor} onChange={(ev) => upd('factor', +ev.target.value || 0)} className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs" />
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(p.tasa, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {ac == null ? <span className="text-slate-400">por Colocación</span> : fmt(-ac)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{fmt(-pr)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-slate-600">
            <b>Venta proyectada =</b> acumulado + (si días restantes − 5 &gt; 0: promedio simple × (días restantes − 5)) + mín(días
            restantes, 5) × promedio simple × factor.
          </div>
        </section>
      )}

      {/* ── Paso 2: Métodos ── */}
      {tab === 'p2' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Métodos de cálculo</h2>
            <p className="text-sm text-slate-500">
              Un método es una fórmula con nombre: <b>una operación aplicada a una base</b>. Defínelo una vez y asígnalo a las reglas.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setPanelMetodo((v) => !v)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
              + Nuevo método
            </button>
            <span className="ml-auto text-xs text-slate-500">
              {metodosList.length} métodos · {Object.keys(metodosUser).length} creados por ti
            </span>
          </div>

          {panelMetodo && <PanelMetodo onCancel={() => setPanelMetodo(false)} onCreate={(m) => { setMetodosUser((prev) => ({ ...prev, [m.id]: m })); setPanelMetodo(false); }} />}

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">Método</th>
                  <th className="px-3 py-2 text-left">Fórmula</th>
                  <th className="px-3 py-2 text-right">Valor por defecto</th>
                  <th className="px-3 py-2 text-left">Se calcula</th>
                  <th className="px-3 py-2 text-right">Reglas que lo usan</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {metodosList.map((m) => (
                  <tr key={m.id} className={`border-t border-slate-100 ${m.fijo ? '' : 'bg-emerald-50/40'}`}>
                    <td className="px-3 py-2 font-semibold text-slate-800">
                      {m.nombre} {!m.fijo && <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">propio</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{formula(m)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {m.valor == null ? '—' : m.op === 'porcentaje' ? (m.valor * 100).toFixed(2) + ' %' : fmt(m.valor)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{m.orden} · {TURNO_CORTO[m.orden]}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{uso[m.id] || 0}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => eliminarMetodo(m.id)} className="rounded border border-slate-200 px-2 text-slate-400 hover:border-red-400 hover:text-red-500" title="Eliminar método">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded border-l-4 border-emerald-400 bg-emerald-50 px-3 py-2 text-xs text-slate-600">
            <b>¿Qué es eso de "cuándo se calcula"?</b> El motor no calcula todo de una vez: lo hace <b>por turnos</b>. En cada turno
            resuelve un grupo de reglas, y las siguientes ya pueden usar ese resultado como base. La única pregunta es: ¿qué necesita
            saber mi método antes de calcular? Normalmente no tienes que elegirlo: al escoger la base, el turno se pone solo.
          </div>
        </section>
      )}

      {/* ── Paso 3: Reglas ── */}
      {tab === 'p3' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Reglas de cálculo</h2>
            <p className="text-sm text-slate-500">
              Una regla aplica un método a un concepto de una empresa, con su cuenta contable. Puedes cambiar el método, el valor, crear
              reglas o eliminarlas.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <label className="text-xs text-slate-500">
              Empresa{' '}
              <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} className="rounded border border-slate-200 px-2 py-1 text-sm">
                <option value="*">Todas</option>
                {EMPRESAS.map((e) => (<option key={e}>{e}</option>))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Método{' '}
              <select value={filtroMetodo} onChange={(e) => setFiltroMetodo(e.target.value)} className="rounded border border-slate-200 px-2 py-1 text-sm">
                <option value="*">Todos</option>
                {metodosList.map((m) => (<option key={m.id} value={m.id}>{m.nombre}</option>))}
              </select>
            </label>
            <label className="ml-auto text-xs text-slate-500">
              Promedio por defecto{' '}
              <select value={gn} onChange={(e) => setGn(+e.target.value)} className="rounded border border-slate-200 px-2 py-1 text-sm">
                {[2, 3, 4, 6, 9].map((x) => (<option key={x} value={x}>{x} meses</option>))}
              </select>
            </label>
            <button onClick={() => setPanelAlta((v) => !v)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
              + Nuevas reglas
            </button>
            <button onClick={restablecer} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Restablecer
            </button>
          </div>

          {panelAlta && (
            <PanelAlta
              metodos={metodos}
              series={data.series}
              reglasActuales={reglas}
              onCancel={() => setPanelAlta(false)}
              onCreate={(nuevasReglas) => { setNuevas((prev) => [...prev, ...nuevasReglas]); setPanelAlta(false); }}
            />
          )}

          {avisos.length > 0 && (
            <div className="rounded border-l-4 border-red-400 bg-red-50 px-3 py-2 text-xs text-slate-700">
              {avisos.slice(0, 6).map((a, i) => (<div key={i}>{a}</div>))}
              {avisos.length > 6 && <div>y {avisos.length - 6} más.</div>}
            </div>
          )}

          <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">Empresa</th>
                  <th className="px-3 py-2 text-left">Concepto</th>
                  <th className="px-3 py-2 text-left">Método</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-left">Cuenta contable</th>
                  <th className="px-3 py-2 text-left">Centro costo</th>
                  <th className="px-3 py-2 text-right">Proyectado USD</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {reglasVisibles.map(({ r, i }) => {
                  const m = metodos[r.metodo] || ({} as Metodo);
                  return (
                    <tr key={r.key} className={`border-t border-slate-100 ${r.nueva ? 'bg-emerald-50/40' : ''}`}>
                      <td className="px-3 py-2">{r.empresa}</td>
                      <td className="px-3 py-2">
                        {r.concepto} {r.nueva && <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">nueva</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={r.metodo}
                          onChange={(e) => { mod(r.key, 'metodo', e.target.value); mod(r.key, 'valor', null); }}
                          className="rounded border border-slate-200 px-2 py-1 text-xs"
                        >
                          {metodosList.map((mm) => (<option key={mm.id} value={mm.id}>{mm.nombre}</option>))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {m.op === 'promedio' ? (
                          <select value={r.n || gn} onChange={(e) => mod(r.key, 'n', +e.target.value)} className="rounded border border-slate-200 px-2 py-1 text-xs">
                            {[2, 3, 4, 6, 9].map((x) => (<option key={x} value={x}>{x} meses</option>))}
                          </select>
                        ) : OP_PIDE_VALOR.includes(m.op) ? (
                          <input
                            type="number"
                            step={0.01}
                            value={m.op === 'porcentaje' ? ((r.valor ?? m.valor ?? 0) * 100).toFixed(2) : Math.round(r.valor ?? m.valor ?? 0)}
                            onChange={(e) => mod(r.key, 'valor', m.op === 'porcentaje' ? (+e.target.value || 0) / 100 : +e.target.value || 0)}
                            className="w-24 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs"
                          />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{r.cuenta}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{r.cc}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{fmt(val[i])}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => eliminarRegla(r.key)} className="rounded border border-slate-200 px-2 text-slate-400 hover:border-red-400 hover:text-red-500" title="Eliminar regla">
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Mostrando <b>{reglasVisibles.length}</b> de {reglas.length} reglas.
          </p>
        </section>
      )}

      {/* ── Paso 4: Resultado ── */}
      {tab === 'p4' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">P&amp;L proyectado al cierre</h2>
            <p className="text-sm text-slate-500">
              Se compara contra las cifras que control validó (promedio de 9 meses, 95 reglas originales).
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">Empresa</th>
                  <th className="px-3 py-2 text-right">Ingresos</th>
                  <th className="px-3 py-2 text-right">Renta Bruta</th>
                  <th className="px-3 py-2 text-right">Gastos Op.</th>
                  <th className="px-3 py-2 text-right">Gcia. Operativa</th>
                  <th className="px-3 py-2 text-right">Semi Neto</th>
                  <th className="px-3 py-2 text-right">vs. validado</th>
                </tr>
              </thead>
              <tbody>
                {EMPRESAS.map((e) => {
                  const a = agg[e];
                  const d = a.sn - CIFRAS_VALIDADAS[e];
                  return (
                    <tr key={e} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-800">{e}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(a.ing)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(a.rb)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(a.go)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(a.gop)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{fmt(a.sn)}</td>
                      <td className={`px-3 py-2 text-right font-mono tabular-nums ${Math.abs(d) < 1 ? 'text-slate-400' : d > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {Math.abs(d) < 1 ? 'igual' : `${d > 0 ? '+' : ''}${fmt(d)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(tot('ing'))}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(tot('rb'))}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(tot('go'))}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(tot('gop'))}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(sn)}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${Math.abs(dsn) < 1 ? 'text-slate-400' : dsn > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {Math.abs(dsn) < 1 ? 'igual' : `${dsn > 0 ? '+' : ''}${fmt(dsn)}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="rounded border-l-4 border-emerald-400 bg-emerald-50 px-3 py-2 text-xs text-slate-600">
            {pruebaMalas.length
              ? `Revisar: la Renta Bruta no cuadra con sus componentes en ${pruebaMalas.join(', ')}.`
              : 'Prueba contable superada. Renta Bruta = −(suma del grupo VENTAS) cuadra en las seis empresas.'}
          </div>
        </section>
      )}

      {/* ── Paso 5: Tabla de salida ── */}
      {tab === 'p5' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Tabla de salida</h2>
            <p className="text-sm text-slate-500">
              Las trece columnas de F_Mayor, en el mismo orden. Esto es lo que se escribe en <span className="font-mono">proyeccion_resultado</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <span className="font-mono text-xs text-slate-500">{reglas.length} filas · FECHA {data.periodo}-01 · Proyeccion = 1</span>
            <div className="ml-auto flex gap-2">
              <button onClick={copiarCsv} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Copiar como CSV
              </button>
              {isAdmin && (
                <button onClick={publicar} disabled={publicando} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {publicando ? 'Publicando…' : 'Publicar a la base'}
                </button>
              )}
            </div>
          </div>
          <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">FECHA</th>
                  <th className="px-3 py-2 text-left">Vista</th>
                  <th className="px-3 py-2 text-left">Combinada</th>
                  <th className="px-3 py-2 text-left">País</th>
                  <th className="px-3 py-2 text-left">Empresa</th>
                  <th className="px-3 py-2 text-right">Tasa_Mensual</th>
                  <th className="px-3 py-2 text-right">Monto_Local</th>
                  <th className="px-3 py-2 text-right">Monto_USD</th>
                  <th className="px-3 py-2 text-left">CENTRO_COSTO</th>
                  <th className="px-3 py-2 text-left">CUENTA_CONTABLE</th>
                  <th className="px-3 py-2 text-right">Proyeccion</th>
                </tr>
              </thead>
              <tbody>
                {reglas.map((r, i) => (
                  <tr key={r.key} className={`border-t border-slate-100 ${r.nueva ? 'bg-emerald-50/40' : ''}`}>
                    <td className="px-3 py-2 font-mono text-[11px]">{data.periodo}-01</td>
                    <td className="px-3 py-2">GYP</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.combinada}</td>
                    <td className="px-3 py-2">{r.pais}</td>
                    <td className="px-3 py-2">{r.empresa}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.tasaMensual == null ? <span className="text-slate-400">nulo</span> : fmt(r.tasaMensual, 4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(val[i] * (params[r.empresa]?.tasa || 0), 2)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(val[i], 2)}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.cc}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.cuenta}</td>
                    <td className="px-3 py-2 text-right font-mono">1</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Montos en <b>signo crudo</b>: ingresos negativos, gastos positivos.
          </p>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel: nuevo método
// ─────────────────────────────────────────────────────────────────────────────

function PanelMetodo({ onCancel, onCreate }: { onCancel: () => void; onCreate: (m: Metodo) => void }) {
  const [nombre, setNombre] = useState('');
  const [op, setOp] = useState<Operacion>('porcentaje');
  const [base, setBase] = useState<Base>('g:GOP');
  const [valor, setValor] = useState('5.00');
  const [invertir, setInvertir] = useState(false);
  const [orden, setOrden] = useState<number | null>(null);

  const sinBase = OP_SIN_BASE.includes(op);
  const ordenSug = turnoSugerido(sinBase ? 'ninguna' : base);
  const ordenEfectivo = orden ?? (sinBase ? 2 : ordenSug);
  const prev: Pick<Metodo, 'op' | 'base' | 'invertir'> = { op, base: sinBase ? 'ninguna' : base, invertir };

  const crear = () => {
    const n = nombre.trim();
    if (!n) return;
    const v = +valor || 0;
    onCreate({
      id: 'u_' + Date.now().toString(36),
      nombre: n,
      op,
      base: sinBase ? 'ninguna' : base,
      valor: op === 'porcentaje' ? v / 100 : v,
      invertir,
      orden: ordenEfectivo,
      fijo: false,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-emerald-300 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Nombre
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="5% de Gastos Operativos" className="rounded border border-slate-200 px-2 py-1.5 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Operación
        <select value={op} onChange={(e) => { setOp(e.target.value as Operacion); setOrden(null); }} className="rounded border border-slate-200 px-2 py-1.5 text-sm">
          {(Object.keys(OPS) as Operacion[]).map((k) => (<option key={k} value={k}>{OPS[k]}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Base
        {sinBase ? (
          <span className="py-1.5 text-slate-400">no aplica</span>
        ) : (
          <select value={base} onChange={(e) => { setBase(e.target.value as Base); setOrden(null); }} className="rounded border border-slate-200 px-2 py-1.5 text-sm">
            {Object.keys(BASES).filter((k) => k !== 'ninguna').map((k) => (<option key={k} value={k}>{BASES[k]}</option>))}
          </select>
        )}
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Valor por defecto{op === 'porcentaje' ? ' (%)' : ''}
        <input type="number" step={0.01} value={valor} onChange={(e) => setValor(e.target.value)} className="rounded border border-slate-200 px-2 py-1.5 text-right font-mono text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 sm:col-span-2">
        ¿Cuándo se calcula? <span className="text-emerald-600">lo elegimos por ti según la base</span>
        <select value={ordenEfectivo} onChange={(e) => setOrden(+e.target.value)} className="rounded border border-slate-200 px-2 py-1.5 text-sm">
          {[1, 2, 3, 4, 5].map((x) => (<option key={x} value={x}>{x} · {TURNOS[x]}</option>))}
        </select>
      </label>
      <label className="flex items-end gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={invertir} onChange={(e) => setInvertir(e.target.checked)} /> invertir signo
      </label>
      <div className="rounded bg-slate-50 px-3 py-2 font-mono text-[11px] text-emerald-700 sm:col-span-2 lg:col-span-3">
        Resultado = {formula(prev)}
      </div>
      {ordenEfectivo < ordenSug && (
        <div className="rounded bg-amber-50 px-3 py-2 text-[11px] text-amber-700 sm:col-span-2 lg:col-span-3">
          Se calcula antes de que {BASES[sinBase ? 'ninguna' : base]} esté completo, así que la base va a estar a medias. Lo normal para
          esta base es el turno {ordenSug}.
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <button onClick={crear} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Crear método</button>
        <button onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel: nuevas reglas
// ─────────────────────────────────────────────────────────────────────────────

function PanelAlta({
  metodos,
  series,
  reglasActuales,
  onCancel,
  onCreate,
}: {
  metodos: Record<string, Metodo>;
  series: Record<string, { a: number; s: (number | null)[] }>;
  reglasActuales: Regla[];
  onCancel: () => void;
  onCreate: (reglas: NuevaRegla[]) => void;
}) {
  const [empresa, setEmpresa] = useState(EMPRESAS[0]);
  const [metodoId, setMetodoId] = useState('m_promedio');
  const [valor, setValor] = useState('');
  const [seleccion, setSeleccion] = useState<string[]>([]);

  // Conceptos del catálogo (serie) para esa empresa.
  const conceptos = useMemo(
    () => [...new Set(Object.keys(series).filter((k) => k.startsWith(empresa + '|')).map((k) => k.split('|')[1]))].sort(),
    [series, empresa],
  );
  const elegidos = seleccion.length ? seleccion : conceptos.length ? [conceptos[0]] : [];
  const m = metodos[metodoId] || metodos['m_promedio'];
  const pideValor = OP_PIDE_VALOR.includes(m.op);

  // Grupo P&L por concepto, tomado de las reglas existentes si lo hay.
  const grupoDe = (concepto: string): GrupoPL => {
    const r = reglasActuales.find((x) => x.concepto === concepto);
    return (r?.grupo as GrupoPL) || 'GOP';
  };

  const crear = () => {
    const nuevas: NuevaRegla[] = elegidos.map((c) => {
      const existente = reglasActuales.find((x) => x.empresa === empresa && x.concepto === c);
      const v = pideValor ? (m.op === 'porcentaje' ? (+valor || 0) / 100 : +valor || 0) : null;
      return {
        empresa,
        concepto: c,
        grupo: grupoDe(c),
        metodo: metodoId,
        valor: v,
        combinada: existente?.combinada || `${c}-${empresa}`,
        cc: existente?.cc || '00.00.000.00',
        cuenta: existente?.cuenta || c,
        tasaMensual: existente?.tasaMensual ?? null,
      };
    });
    onCreate(nuevas);
  };

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-emerald-300 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Empresa
        <select value={empresa} onChange={(e) => { setEmpresa(e.target.value); setSeleccion([]); }} className="rounded border border-slate-200 px-2 py-1.5 text-sm">
          {EMPRESAS.map((e) => (<option key={e}>{e}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 sm:row-span-2">
        Conceptos <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">{elegidos.length} elegidos</span>
        <select multiple value={elegidos} onChange={(e) => setSeleccion([...e.target.selectedOptions].map((o) => o.value))} className="h-28 rounded border border-slate-200 px-2 py-1 text-xs">
          {conceptos.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Método
        <select value={metodoId} onChange={(e) => setMetodoId(e.target.value)} className="rounded border border-slate-200 px-2 py-1.5 text-sm">
          {Object.values(metodos).map((mm) => (<option key={mm.id} value={mm.id}>{mm.nombre}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Valor{m.op === 'porcentaje' ? ' (%)' : ''}
        {pideValor ? (
          <input type="number" step={0.01} value={valor} onChange={(e) => setValor(e.target.value)} className="rounded border border-slate-200 px-2 py-1.5 text-right font-mono text-sm" />
        ) : (
          <span className="py-1.5 text-slate-400">sin valor</span>
        )}
      </label>
      <div className="rounded bg-slate-50 px-3 py-2 font-mono text-[11px] text-emerald-700 sm:col-span-2 lg:col-span-4">
        Resultado = {formula(m)}
      </div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button onClick={crear} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
          Crear {elegidos.length} regla{elegidos.length > 1 ? 's' : ''}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
      </div>
    </div>
  );
}
