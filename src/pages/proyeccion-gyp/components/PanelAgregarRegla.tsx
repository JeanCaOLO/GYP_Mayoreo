import { useMemo, useState } from 'react';
import type { GrupoPL, Metodo, Regla } from '../engine';
import type { FilaHistoricoCuenta } from '../capas';
import type { NuevaRegla } from './PestanaReglas';

/**
 * «+ Agregar regla» con tres caminos (CP-30, Requirement 18.4):
 *
 *   1. Agregar una regla — empresa, concepto, cuenta, centro, nombre y detalle.
 *      Arranca en monto fijo 0 y se suma al concepto.
 *   2. Repartir un monto entre cuentas — un monto del mes repartido en partes
 *      iguales, por historia de 6 meses o por presupuesto.
 *   3. Estimar cada cuenta por separado — una regla por cuenta (lo típico de 6
 *      meses, el promedio, igual que el mes pasado o monto fijo; máximo 300).
 *
 * En los caminos 2 y 3 las cuentas se eligen en una lista simple con buscador,
 * no con las capas, a partir del detalle por cuenta del mes. Emite las reglas
 * resultantes a `onCrear`, que las añade al estado de la página (nuevas reglas,
 * con borrado lógico al eliminar).
 *
 * La base admite UNA regla por Combinada (periodo, empresa, combinada): una
 * cuenta que ya tiene regla no se ofrece y el camino 1 pide otra cuenta o centro.
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

/** Cuenta candidata del detalle del mes. */
interface CuentaCandidata {
  combinada: string;
  cuenta: string;
  cc: string;
}

const combinadaDe = (cuenta: string, cc: string, empresa: string) => `${cuenta}-${cc}-${empresa}`;

/**
 * Id del método con esa operación; se prefiere el de fábrica. Los ids van tal
 * cual están en `proyeccion_metodo` (el monto fijo es `m_fijo`): uno inventado
 * hace fallar el insert por la clave foránea de `proyeccion_regla.metodo`.
 */
const metodoPorOp = (metodos: Record<string, Metodo>, op: string, porDefecto: string) => {
  const lista = Object.values(metodos).filter((m) => m.op === op);
  return (lista.find((m) => m.fijo) ?? lista[0])?.id ?? porDefecto;
};

export interface PanelAgregarReglaProps {
  empresas: readonly string[];
  metodos: Record<string, Metodo>;
  series: Record<string, { a: number; s: (number | null)[] }>;
  reglasActuales: Regla[];
  /** Detalle por cuenta del mes (gyp_historico_cuenta) para elegir cuentas. */
  detalleCuenta?: FilaHistoricoCuenta[];
  onCancelar: () => void;
  onCrear: (reglas: NuevaRegla[]) => void;
}

export default function PanelAgregarRegla({
  empresas,
  metodos,
  series,
  reglasActuales,
  detalleCuenta = [],
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

  // Combinadas que ya tienen regla en la empresa: no admiten otra.
  const ocupadas = useMemo(
    () => new Set(reglasActuales.filter((x) => x.empresa === empresa).map((x) => x.combinada)),
    [reglasActuales, empresa],
  );

  const cuentasDe = (concepto: string): CuentaCandidata[] => {
    const vistas = new Map<string, CuentaCandidata>();
    detalleCuenta
      .filter((f) => f.empresa === empresa && f.concepto === concepto)
      .forEach((f) => vistas.set(f.combinada, { combinada: f.combinada, cuenta: f.cuenta, cc: f.centro_costo }));
    return [...vistas.values()].sort((a, b) => a.combinada.localeCompare(b.combinada));
  };

  const grupoDe = (concepto: string): GrupoPL =>
    (reglasActuales.find((x) => x.concepto === concepto)?.grupo as GrupoPL) || 'GOP';

  const plantillaDe = (concepto: string, parcial: Partial<NuevaRegla> = {}): NuevaRegla => {
    const existente = reglasActuales.find((x) => x.empresa === empresa && x.concepto === concepto);
    return {
      empresa,
      concepto,
      grupo: grupoDe(concepto),
      metodo: metodoPorOp(metodos, 'valor_fijo', 'm_fijo'),
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
        <CaminoAgregar
          empresa={empresa}
          conceptos={conceptos}
          ocupadas={ocupadas}
          plantillaDe={plantillaDe}
          onCrear={(regla) => onCrear([regla])}
        />
      )}
      {camino === 'repartir' && (
        <CaminoRepartir
          conceptos={conceptos}
          cuentasDe={cuentasDe}
          ocupadas={ocupadas}
          metodos={metodos}
          onCrear={(regs) => onCrear(regs)}
          plantillaDe={plantillaDe}
        />
      )}
      {camino === 'cada_cuenta' && (
        <CaminoCadaCuenta
          conceptos={conceptos}
          cuentasDe={cuentasDe}
          ocupadas={ocupadas}
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
  empresa,
  conceptos,
  ocupadas,
  plantillaDe,
  onCrear,
}: {
  empresa: string;
  conceptos: string[];
  ocupadas: Set<string>;
  plantillaDe: (concepto: string, parcial?: Partial<NuevaRegla>) => NuevaRegla;
  onCrear: (regla: NuevaRegla) => void;
}) {
  const [concepto, setConcepto] = useState(conceptos[0] ?? '');
  const [cuenta, setCuenta] = useState('');
  const [cc, setCc] = useState('');
  const [nombre, setNombre] = useState('');
  const [detalle, setDetalle] = useState('');

  // Cuenta y centro vacíos toman los de la regla del concepto.
  const base = concepto ? plantillaDe(concepto) : null;
  const cuentaFinal = cuenta.trim() || base?.cuenta || '';
  const ccFinal = cc.trim() || base?.cc || '';
  const combinada = combinadaDe(cuentaFinal, ccFinal, empresa);
  const repetida = ocupadas.has(combinada);

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
        Cuenta contable
        <input
          value={cuenta}
          onChange={(e) => setCuenta(e.target.value)}
          placeholder={base?.cuenta ? `${base.cuenta} (la del concepto)` : 'cuenta contable'}
          className="rounded border border-slate-200 px-2 py-1.5 font-mono text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Centro de costo
        <input
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          placeholder={base?.cc ? `${base.cc} (el del concepto)` : 'centro de costo'}
          className="rounded border border-slate-200 px-2 py-1.5 font-mono text-sm"
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
      <div className="space-y-2 sm:col-span-2">
        <p className="text-[11px] text-slate-500">
          Combinada: <span className="font-mono">{combinada}</span>
        </p>
        {repetida && (
          <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
            Esa Combinada ya tiene una regla y la base admite una sola por cuenta. Escribe otra
            cuenta o centro de costo, o abre la regla existente y cambia su forma de estimar.
          </p>
        )}
        <button
          disabled={!concepto || !cuentaFinal || !ccFinal || repetida}
          onClick={() =>
            onCrear(
              plantillaDe(concepto, {
                cuenta: cuentaFinal,
                cc: ccFinal,
                combinada,
                nombre: nombre.trim() || null,
                detalle: detalle.trim() || null,
              }),
            )
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
  cuentasDe,
  ocupadas,
  metodos,
  onCrear,
  plantillaDe,
}: {
  conceptos: string[];
  cuentasDe: (concepto: string) => CuentaCandidata[];
  ocupadas: Set<string>;
  metodos: Record<string, Metodo>;
  onCrear: (regs: NuevaRegla[]) => void;
  plantillaDe: (concepto: string, parcial?: Partial<NuevaRegla>) => NuevaRegla;
}) {
  const [concepto, setConcepto] = useState(conceptos[0] ?? '');
  const [monto, setMonto] = useState('0');
  const [modo, setModo] = useState<(typeof REPARTO_MODOS)[number]['id']>('iguales');
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const { lista, filtrar, filtro } = useBuscadorCuentas(cuentasDe(concepto));

  const metodoFijo = metodoPorOp(metodos, 'valor_fijo', 'm_fijo');
  const elegidas = lista.filter((c) => seleccion.includes(c.combinada) && !ocupadas.has(c.combinada));

  const crear = () => {
    if (!elegidas.length) return;
    const total = +monto || 0;
    const parte = total / elegidas.length; // reparto en partes iguales (histórico/ppto se afinan en el motor)
    const regs = elegidas.map((c) =>
      plantillaDe(concepto, {
        metodo: metodoFijo,
        valor: parte,
        nivel: 'cuenta',
        cuenta: c.cuenta,
        cc: c.cc,
        combinada: c.combinada,
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
            onChange={(e) => {
              setConcepto(e.target.value);
              setSeleccion([]);
            }}
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
        ocupadas={ocupadas}
        seleccion={seleccion}
        onSeleccion={setSeleccion}
      />
      <button
        onClick={crear}
        disabled={!elegidas.length}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        Repartir entre {elegidas.length} cuenta(s)
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Camino 3 · Estimar cada cuenta por separado
// ─────────────────────────────────────────────────────────────────────────────

function CaminoCadaCuenta({
  conceptos,
  cuentasDe,
  ocupadas,
  metodos,
  onCrear,
  plantillaDe,
}: {
  conceptos: string[];
  cuentasDe: (concepto: string) => CuentaCandidata[];
  ocupadas: Set<string>;
  metodos: Record<string, Metodo>;
  onCrear: (regs: NuevaRegla[]) => void;
  plantillaDe: (concepto: string, parcial?: Partial<NuevaRegla>) => NuevaRegla;
}) {
  const [concepto, setConcepto] = useState(conceptos[0] ?? '');
  const [op, setOp] = useState<(typeof METODOS_CUENTA)[number]['op']>('mediana');
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const { lista, filtrar, filtro } = useBuscadorCuentas(cuentasDe(concepto));

  const metodoId = metodoPorOp(metodos, op, op === 'valor_fijo' ? 'm_fijo' : `m_${op}`);
  const elegidas = lista.filter((c) => seleccion.includes(c.combinada) && !ocupadas.has(c.combinada));
  const excede = elegidas.length > MAX_REGLAS;

  const crear = () => {
    const cuentas = elegidas.slice(0, MAX_REGLAS);
    if (!cuentas.length) return;
    const regs = cuentas.map((c) =>
      plantillaDe(concepto, {
        metodo: metodoId,
        valor: op === 'valor_fijo' ? 0 : null,
        n: op === 'mediana' ? 6 : null,
        nivel: 'cuenta',
        cuenta: c.cuenta,
        cc: c.cc,
        combinada: c.combinada,
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
            onChange={(e) => {
              setConcepto(e.target.value);
              setSeleccion([]);
            }}
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
        ocupadas={ocupadas}
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
        disabled={!elegidas.length}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        Crear {Math.min(elegidas.length, MAX_REGLAS)} regla(s) por cuenta
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lista simple de cuentas con buscador (CP-30: sin capas)
// ─────────────────────────────────────────────────────────────────────────────

/** Filtra las cuentas del concepto por el texto del buscador. */
function useBuscadorCuentas(cuentas: CuentaCandidata[]) {
  const [filtro, setFiltro] = useState('');
  const f = filtro.toLowerCase();
  const lista = cuentas.filter((c) => c.combinada.toLowerCase().includes(f));
  return { lista, filtrar: setFiltro, filtro };
}

function ListaCuentas({
  lista,
  filtro,
  onFiltrar,
  ocupadas,
  seleccion,
  onSeleccion,
}: {
  lista: CuentaCandidata[];
  filtro: string;
  onFiltrar: (v: string) => void;
  ocupadas: Set<string>;
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
          <p className="px-2 py-1 text-xs text-slate-400">
            Sin cuentas que coincidan (hace falta el detalle por cuenta del mes).
          </p>
        )}
        {lista.map((c) => {
          const ocupada = ocupadas.has(c.combinada);
          return (
            <label
              key={c.combinada}
              className={`flex items-center gap-2 rounded px-2 py-1 font-mono text-xs ${
                ocupada ? 'text-slate-400' : 'cursor-pointer hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                disabled={ocupada}
                checked={!ocupada && seleccion.includes(c.combinada)}
                onChange={() => toggle(c.combinada)}
              />
              {c.combinada}
              {ocupada && <span className="font-sans text-[10px]">· ya tiene regla</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}
