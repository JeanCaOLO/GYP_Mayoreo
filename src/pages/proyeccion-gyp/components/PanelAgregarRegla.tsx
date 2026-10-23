import { useMemo, useState } from 'react';
import type { GrupoPL, Metodo, Regla } from '../engine';
import type { NuevaRegla } from './PestanaReglas';

/**
 * «+ Agregar regla» con tres caminos (CP-30, Requirement 18.4):
 *
 *   1. Agregar una regla — empresa, concepto, cuenta, nombre y detalle. Arranca
 *      en monto fijo 0 y se suma al concepto.
 *   2. Repartir un monto entre cuentas — un monto del mes repartido en partes
 *      iguales, por historia de 6 meses o por presupuesto.
 *   3. Estimar cada cuenta por separado — una regla por cuenta (lo típico de 6
 *      meses, el promedio, igual que el mes pasado o monto fijo; máximo 300).
 *
 * En los caminos 2 y 3 las cuentas se eligen en una lista simple con buscador,
 * no con las capas. Emite las reglas resultantes a `onCrear`, que las añade al
 * estado de la página (nuevas reglas, con borrado lógico al eliminar).
 */

type Camino = 'agregar' | 'repartir' | 'cada_cuenta';

const CAMINOS: { id: Camino; titulo: string; detalle: string }[] = [
  { id: 'agregar', titulo: 'Agregar una regla', detalle: 'Se suma al concepto. Arranca en monto fijo 0.' },
  { id: 'repartir', titulo: 'Repartir un monto entre cuentas', detalle: 'Un monto del mes repartido entre cuentas.' },
  { id: 'cada_cuenta', titulo: 'Estimar cada cuenta por separado', detalle: 'Una regla por cuenta (máximo 300).' },
];

const REPARTO_MODOS = [
  { id: 'iguales', label: 'En partes iguales' },
  { id: 'historia', label: 'Por historia de 6 meses' },
  { id: 'presupuesto', label: 'Por presupuesto' },
] as const;

const METODOS_CUENTA = [
  { op: 'mediana', label: 'Lo típico de 6 meses' },
  { op: 'promedio', label: 'El promedio' },
  { op: 'ultimo', label: 'Igual que el mes pasado' },
  { op: 'valor_fijo', label: 'Monto fijo' },
] as const;

const MAX_REGLAS = 300;

export interface PanelAgregarReglaProps {
  empresas: readonly string[];
  metodos: Record<string, Metodo>;
  series: Record<string, { a: number; s: (number | null)[] }>;
  reglasActuales: Regla[];
  onCancelar: () => void;
  onCrear: (reglas: NuevaRegla[]) => void;
}

export default function PanelAgregarRegla({
  empresas,
  metodos,
  series,
  reglasActuales,
  onCancelar,
  onCrear,
}: PanelAgregarReglaProps) {
  const [camino, setCamino] = useState<Camino>('agregar');
  const [empresa, setEmpresa] = useState(empresas[0]);

  const conceptos = useMemo(
    () =>
      [
        ...new Set(
          Object.keys(series)
            .filter((k) => k.startsWith(empresa + '|'))
            .map((k) => k.split('|')[1]),
        ),
      ].sort(),
    [series, empresa],
  );

  const grupoDe = (concepto: string): GrupoPL =>
    (reglasActuales.find((x) => x.concepto === concepto)?.grupo as GrupoPL) || 'GOP';

  const plantillaDe = (concepto: string, parcial: Partial<NuevaRegla> = {}): NuevaRegla => {
    const existente = reglasActuales.find((x) => x.empresa === empresa && x.concepto === concepto);
    return {
      empresa,
      concepto,
      grupo: grupoDe(concepto),
      metodo: 'm_valor_fijo',
      valor: 0,
      combinada: existente?.combinada || `${concepto}-${empresa}`,
      cc: existente?.cc || '00.00.000.00',
      cuenta: existente?.cuenta || concepto,
      tasaMensual: existente?.tasaMensual ?? null,
      ...parcial,
    };
  };

  return (
    <div className="space-y-4 rounded-lg border border-emerald-300 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">+ Agregar regla</h3>
        <button onClick={onCancelar} className="text-xs text-slate-500 hover:text-slate-800">
          Cancelar
        </button>
      </div>

      {/* Selector de camino (CP-30) */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {CAMINOS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCamino(c.id)}
            className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
              camino === c.id
                ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="block font-semibold">{c.titulo}</span>
            <span className="text-[11px] text-slate-500">{c.detalle}</span>
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Empresa
        <select
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          className="w-48 rounded border border-slate-200 px-2 py-1.5 text-sm"
        >
          {empresas.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </label>

      {camino === 'agregar' && (
        <CaminoAgregar conceptos={conceptos} onCrear={(c, extra) => onCrear([plantillaDe(c, extra)])} />
      )}
      {camino === 'repartir' && (
        <CaminoRepartir
          conceptos={conceptos}
          metodos={metodos}
          onCrear={(regs) => onCrear(regs)}
          plantillaDe={plantillaDe}
        />
      )}
      {camino === 'cada_cuenta' && (
        <CaminoCadaCuenta
          conceptos={conceptos}
          metodos={metodos}
          onCrear={(regs) => onCrear(regs)}
          plantillaDe={plantillaDe}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Camino 1 · Agregar una regla
// ─────────────────────────────────────────────────────────────────────────────

function CaminoAgregar({
  conceptos,
  onCrear,
}: {
  conceptos: string[];
  onCrear: (concepto: string, extra: Partial<NuevaRegla>) => void;
}) {
  const [concepto, setConcepto] = useState(conceptos[0] ?? '');
  const [cuenta, setCuenta] = useState('');
  const [nombre, setNombre] = useState('');
  const [detalle, setDetalle] = useState('');

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Concepto
        <select
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          className="rounded border border-slate-200 px-2 py-1.5 text-sm"
        >
          {conceptos.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Cuenta (opcional)
        <input
          value={cuenta}
          onChange={(e) => setCuenta(e.target.value)}
          placeholder="se usa la del concepto"
          className="rounded border border-slate-200 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Nombre (opcional)
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="rounded border border-slate-200 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Detalle (opcional)
        <input
          value={detalle}
          onChange={(e) => setDetalle(e.target.value)}
          className="rounded border border-slate-200 px-2 py-1.5 text-sm"
        />
      </label>
      <div className="sm:col-span-2">
        <button
          disabled={!concepto}
          onClick={() =>
            onCrear(concepto, {
              cuenta: cuenta.trim() || undefined,
              nombre: nombre.trim() || null,
              detalle: detalle.trim() || null,
            })
          }
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          Agregar la regla
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Camino 2 · Repartir un monto entre cuentas
// ─────────────────────────────────────────────────────────────────────────────

function CaminoRepartir({
  conceptos,
  metodos,
  onCrear,
  plantillaDe,
}: {
  conceptos: string[];
  metodos: Record<string, Metodo>;
  onCrear: (regs: NuevaRegla[]) => void;
  plantillaDe: (concepto: string, parcial?: Partial<NuevaRegla>) => NuevaRegla;
}) {
  const [concepto, setConcepto] = useState(conceptos[0] ?? '');
  const [monto, setMonto] = useState('0');
  const [modo, setModo] = useState<(typeof REPARTO_MODOS)[number]['id']>('iguales');
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const { lista, filtrar, filtro } = useBuscadorCuentas(conceptos);

  const metodoFijo = Object.values(metodos).find((m) => m.op === 'valor_fijo')?.id ?? 'm_valor_fijo';

  const crear = () => {
    const cuentas = seleccion.length ? seleccion : lista.slice(0, 1);
    if (!cuentas.length) return;
    const total = +monto || 0;
    const parte = total / cuentas.length; // reparto en partes iguales (histórico/ppto se afinan en el motor)
    const regs = cuentas.map((c) =>
      plantillaDe(concepto, {
        metodo: metodoFijo,
        valor: parte,
        nivel: 'cuenta',
        cuenta: c,
        nombre: `Reparto ${modo} de ${concepto}`,
      }),
    );
    onCrear(regs);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Concepto a repartir
          <select
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            className="rounded border border-slate-200 px-2 py-1.5 text-sm"
          >
            {conceptos.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Monto del mes
          <input
            type="number"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="rounded border border-slate-200 px-2 py-1.5 text-right font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Cómo repartir
          <select
            value={modo}
            onChange={(e) => setModo(e.target.value as typeof modo)}
            className="rounded border border-slate-200 px-2 py-1.5 text-sm"
          >
            {REPARTO_MODOS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ListaCuentas
        lista={lista}
        filtro={filtro}
        onFiltrar={filtrar}
        seleccion={seleccion}
        onSeleccion={setSeleccion}
      />
      <button
        onClick={crear}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        Repartir entre {seleccion.length || 1} cuenta(s)
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Camino 3 · Estimar cada cuenta por separado
// ─────────────────────────────────────────────────────────────────────────────

function CaminoCadaCuenta({
  conceptos,
  metodos,
  onCrear,
  plantillaDe,
}: {
  conceptos: string[];
  metodos: Record<string, Metodo>;
  onCrear: (regs: NuevaRegla[]) => void;
  plantillaDe: (concepto: string, parcial?: Partial<NuevaRegla>) => NuevaRegla;
}) {
  const [concepto, setConcepto] = useState(conceptos[0] ?? '');
  const [op, setOp] = useState<(typeof METODOS_CUENTA)[number]['op']>('mediana');
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const { lista, filtrar, filtro } = useBuscadorCuentas(conceptos);

  const metodoId =
    Object.values(metodos).find((m) => m.op === op)?.id ?? `m_${op}`;
  const excede = seleccion.length > MAX_REGLAS;

  const crear = () => {
    const cuentas = (seleccion.length ? seleccion : lista.slice(0, 1)).slice(0, MAX_REGLAS);
    if (!cuentas.length) return;
    const regs = cuentas.map((c) =>
      plantillaDe(concepto, {
        metodo: metodoId,
        valor: op === 'valor_fijo' ? 0 : null,
        n: op === 'mediana' ? 6 : null,
        nivel: 'cuenta',
        cuenta: c,
      }),
    );
    onCrear(regs);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Concepto
          <select
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            className="rounded border border-slate-200 px-2 py-1.5 text-sm"
          >
            {conceptos.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Cómo estimar cada cuenta
          <select
            value={op}
            onChange={(e) => setOp(e.target.value as typeof op)}
            className="rounded border border-slate-200 px-2 py-1.5 text-sm"
          >
            {METODOS_CUENTA.map((m) => (
              <option key={m.op} value={m.op}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ListaCuentas
        lista={lista}
        filtro={filtro}
        onFiltrar={filtrar}
        seleccion={seleccion}
        onSeleccion={setSeleccion}
      />
      {excede && (
        <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
          Máximo {MAX_REGLAS} reglas: se crearán solo las primeras {MAX_REGLAS}.
        </p>
      )}
      <button
        onClick={crear}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        Crear {Math.min(seleccion.length || 1, MAX_REGLAS)} regla(s) por cuenta
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lista simple de cuentas con buscador (CP-30: sin capas)
// ─────────────────────────────────────────────────────────────────────────────

/** Deriva una lista de cuentas candidatas a partir de los conceptos disponibles. */
function useBuscadorCuentas(conceptos: string[]) {
  const [filtro, setFiltro] = useState('');
  const lista = useMemo(
    () =>
      conceptos.filter((c) => c.toLowerCase().includes(filtro.toLowerCase())),
    [conceptos, filtro],
  );
  return { lista, filtrar: setFiltro, filtro };
}

function ListaCuentas({
  lista,
  filtro,
  onFiltrar,
  seleccion,
  onSeleccion,
}: {
  lista: string[];
  filtro: string;
  onFiltrar: (v: string) => void;
  seleccion: string[];
  onSeleccion: (v: string[]) => void;
}) {
  const toggle = (c: string) =>
    onSeleccion(seleccion.includes(c) ? seleccion.filter((x) => x !== c) : [...seleccion, c]);
  return (
    <div className="rounded-lg border border-slate-200">
      <input
        value={filtro}
        onChange={(e) => onFiltrar(e.target.value)}
        placeholder="Buscar cuenta…"
        className="w-full rounded-t-lg border-b border-slate-100 px-3 py-1.5 text-sm"
      />
      <div className="max-h-40 overflow-auto p-1">
        {lista.length === 0 && (
          <p className="px-2 py-1 text-xs text-slate-400">Sin cuentas que coincidan.</p>
        )}
        {lista.map((c) => (
          <label
            key={c}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
          >
            <input type="checkbox" checked={seleccion.includes(c)} onChange={() => toggle(c)} />
            {c}
          </label>
        ))}
      </div>
    </div>
  );
}
