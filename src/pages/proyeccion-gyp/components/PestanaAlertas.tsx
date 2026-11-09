/**
 * Pestaña 6 · Alertas (CP-34) + plantilla del catálogo (CP-53).
 *
 * Cuentas con movimiento en el mayor que el catálogo GyP no reconoce. Mientras
 * no se arreglen, su importe no entra al GyP ni a la proyección. Esta pestaña:
 *
 *  - Resume las alertas en tres tarjetas por acción (crear / corregir / clasificar).
 *  - Filtra por empresa, acción y búsqueda libre.
 *  - De cada cuenta muestra la referencia sugerida (la misma cuenta en otro centro
 *    u otra empresa), el movimiento del mes, el de 12 meses y el último mes.
 *  - No lista cuentas de balance marcadas GYP: las alertas llegan ya filtradas por
 *    la extracción (CP-15), que excluye activo/pasivo/patrimonio. Esta pestaña
 *    además omite cualquier alerta que llegue marcada como balance.
 *  - Ofrece la plantilla del catálogo (CP-53): «Copiar filas» (las cuentas por
 *    crear, sin encabezado, separadas por tabulador, para pegar en la fila 2 de la
 *    plantilla) y «Descargar plantilla (.xlsx)» generada en el navegador con las
 *    18 columnas del portal.
 *
 * El contador se muestra en la cabecera de la pestaña y el aviso correspondiente
 * lo dispara la pestaña Reglas.
 *
 * Las alertas se reciben como prop (`alertas`) junto con el `periodo`. Ambas son
 * opcionales con default para mantener compatibilidad con el cableado actual, que
 * solo pasa `contador`; `page.tsx` debe pasar las alertas reales más adelante.
 */
import { useMemo, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import type { Alerta } from '../data';
import { fmt } from './formato';

export interface PestanaAlertasProps {
  /** Número de alertas pendientes (contador mostrado en la pestaña). */
  contador: number;
  /** Alertas del periodo (CP-34). Default `[]` mientras page.tsx no las cablee. */
  alertas?: Alerta[];
  /** Periodo activo (AAAA-MM), para el nombre de la plantilla. */
  periodo?: string;
}

/** Las tres acciones posibles de una alerta, en el orden de las tarjetas. */
const ACCIONES = ['crear', 'corregir', 'clasificar'] as const;
type Accion = (typeof ACCIONES)[number];

const ETIQUETA_ACCION: Record<Accion, string> = {
  crear: 'Crear en el catálogo',
  corregir: 'Corregir la Combinada',
  clasificar: 'Clasificar',
};

const DESCRIPCION_ACCION: Record<Accion, string> = {
  crear: 'La cuenta no está en el catálogo.',
  corregir: 'El centro o las mayúsculas no coinciden.',
  clasificar: 'Sin sección, sin subclasificación, o con una que la proyección no usa.',
};

const ESTILO_ACCION: Record<Accion, { card: string; chip: string }> = {
  crear: { card: 'border-rose-200 bg-rose-50', chip: 'bg-rose-100 text-rose-700' },
  corregir: { card: 'border-amber-200 bg-amber-50', chip: 'bg-amber-100 text-amber-700' },
  clasificar: { card: 'border-sky-200 bg-sky-50', chip: 'bg-sky-100 text-sky-700' },
};

/** Las 18 columnas del portal, en orden (CP-53). */
const COLUMNAS_PLANTILLA = [
  'Linea',
  'Grupo',
  'Cuenta',
  'Descripcion',
  'Saldo Normal',
  'Comercializadora',
  'Balance_GyP',
  'Clasificacion',
  'Clasificacion 1',
  'Clasificacion 2',
  'Clasificacion Combinado 1',
  'Clasificacion Combinado 2',
  'Clasificacion Combinado 3',
  'Orden Clasificacion',
  'Organizacion',
  'Pais',
  'Compania',
  'Centro Costo',
] as const;

/** Columnas que van siempre vacías en la plantilla (CP-53). */
const COLUMNAS_VACIAS = new Set<string>([
  'Linea',
  'Grupo',
  'Saldo Normal',
  'Comercializadora',
  'Orden Clasificacion',
]);

/** Normaliza la acción de una alerta a una de las tres conocidas. */
function normalizarAccion(accion: string): Accion | null {
  const a = (accion || '').trim().toLowerCase();
  if (a === 'crear' || a === 'corregir' || a === 'clasificar') return a;
  return null;
}

/**
 * Empresa de una combinada `cuenta-centro-Empresa`: el segmento tras el último
 * guion. Si no se puede partir, devuelve la combinada completa.
 */
function empresaDeCombinada(combinada: string): string {
  const i = combinada.lastIndexOf('-');
  return i >= 0 ? combinada.slice(i + 1) : combinada;
}

/**
 * Cuenta de una combinada `cuenta-centro-Empresa`: el primer segmento. Se usa
 * para rellenar la columna «Cuenta» de la plantilla.
 */
function cuentaDeCombinada(combinada: string): string {
  const i = combinada.indexOf('-');
  return i >= 0 ? combinada.slice(0, i) : combinada;
}

/**
 * Centro de costo de una combinada `cuenta-centro-Empresa`: el segmento central.
 */
function centroDeCombinada(combinada: string): string {
  const partes = combinada.split('-');
  return partes.length >= 3 ? partes.slice(1, -1).join('-') : '';
}

/**
 * ¿Es una cuenta de balance marcada GYP? Las alertas llegan ya filtradas por la
 * extracción (CP-15), pero por si alguna trae marca de balance la omitimos aquí
 * también. La forma de la marca puede variar, así que aceptamos varias.
 */
function esBalanceGyp(a: Alerta): boolean {
  const raw = a as unknown as Record<string, unknown>;
  const balance = raw.balance ?? raw.balanceGyp ?? raw.esBalance;
  if (typeof balance === 'boolean') return balance;
  if (typeof balance === 'string') {
    const b = balance.trim().toLowerCase();
    return b === 'balance' || b === 'true' || b === 'si' || b === 'sí';
  }
  return false;
}

export default function PestanaAlertas({ contador, alertas = [], periodo = '' }: PestanaAlertasProps) {
  const { addToast } = useToast();
  const [empresaFiltro, setEmpresaFiltro] = useState<string>('');
  const [accionFiltro, setAccionFiltro] = useState<'' | Accion>('');
  const [busqueda, setBusqueda] = useState<string>('');

  /** Alertas visibles: sin cuentas de balance marcadas GYP. */
  const alertasVisibles = useMemo(() => alertas.filter((a) => !esBalanceGyp(a)), [alertas]);

  /** Empresas presentes en las alertas, para el selector. */
  const empresas = useMemo(() => {
    const set = new Set<string>();
    for (const a of alertasVisibles) set.add(empresaDeCombinada(a.combinada));
    return Array.from(set).sort((x, y) => x.localeCompare(y, 'es'));
  }, [alertasVisibles]);

  /** Conteo por acción para las tres tarjetas resumen. */
  const conteoPorAccion = useMemo(() => {
    const base: Record<Accion, number> = { crear: 0, corregir: 0, clasificar: 0 };
    for (const a of alertasVisibles) {
      const acc = normalizarAccion(a.accion);
      if (acc) base[acc] += 1;
    }
    return base;
  }, [alertasVisibles]);

  /** Alertas tras aplicar empresa + acción + búsqueda. */
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return alertasVisibles.filter((a) => {
      if (empresaFiltro && empresaDeCombinada(a.combinada) !== empresaFiltro) return false;
      if (accionFiltro && normalizarAccion(a.accion) !== accionFiltro) return false;
      if (q) {
        const texto = `${a.combinada} ${a.sugerencia ?? ''} ${a.accion}`.toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }, [alertasVisibles, empresaFiltro, accionFiltro, busqueda]);

  /** Las cuentas por crear (acción `crear`), base de la plantilla del catálogo. */
  const porCrear = useMemo(
    () => alertasVisibles.filter((a) => normalizarAccion(a.accion) === 'crear'),
    [alertasVisibles],
  );

  /**
   * Una fila de la plantilla a partir de una alerta por crear. Las columnas
   * Linea, Grupo, Saldo Normal, Comercializadora y Orden Clasificacion van vacías
   * (CP-53); Cuenta, País, Compañía y Centro Costo se derivan de la combinada.
   */
  const filaPlantilla = (a: Alerta): string[] =>
    COLUMNAS_PLANTILLA.map((col) => {
      if (COLUMNAS_VACIAS.has(col)) return '';
      switch (col) {
        case 'Cuenta':
          return cuentaDeCombinada(a.combinada);
        case 'Pais':
          return '';
        case 'Compania':
          return empresaDeCombinada(a.combinada);
        case 'Centro Costo':
          return centroDeCombinada(a.combinada);
        default:
          return '';
      }
    });

  /** Texto de «Copiar filas»: una fila por cuenta por crear, columnas por tabulador, sin encabezado. */
  const textoFilas = useMemo(
    () => porCrear.map((a) => filaPlantilla(a).join('\t')).join('\n'),
    [porCrear],
  );

  const copiarFilas = async () => {
    if (porCrear.length === 0) {
      addToast('info', 'No hay cuentas por crear para copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(textoFilas);
      addToast(
        'success',
        `${porCrear.length} fila${porCrear.length > 1 ? 's' : ''} copiada${
          porCrear.length > 1 ? 's' : ''
        }. Pégalas en la fila 2 de la plantilla.`,
      );
    } catch (err) {
      addToast('error', 'No se pudo copiar: ' + (err as Error).message);
    }
  };

  const descargarPlantilla = async () => {
    if (porCrear.length === 0) {
      addToast('info', 'No hay cuentas por crear para la plantilla.');
      return;
    }
    try {
      const xlsx = await import('xlsx');
      const filas = porCrear.map((a) => filaPlantilla(a));
      const ws = xlsx.utils.aoa_to_sheet([COLUMNAS_PLANTILLA as unknown as string[], ...filas]);
      ws['!cols'] = COLUMNAS_PLANTILLA.map(() => ({ wch: 18 }));
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Catalogo');
      const wbout = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
      const nombre = `Plantilla_Catalogo_GYP_${periodo || 'periodo'}.xlsx`;
      const blob = new Blob([wbout], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url;
      el.download = nombre;
      document.body.appendChild(el);
      el.click();
      document.body.removeChild(el);
      URL.revokeObjectURL(url);
      addToast('success', `Plantilla descargada (${filas.length} cuentas por crear).`);
    } catch (err) {
      addToast('error', 'No se pudo generar la plantilla: ' + (err as Error).message);
    }
  };

  const hayAlertas = alertasVisibles.length > 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          Alertas{' '}
          {contador > 0 && (
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-xs text-amber-700">
              {contador}
            </span>
          )}
        </h2>
        <p className="text-sm text-slate-500">
          Cuentas con movimiento que el catálogo no reconoce. Mientras no se arreglen, su importe no
          entra al GyP ni a la proyección. No se listan cuentas de balance marcadas GYP.
        </p>
      </div>

      {/* Tres tarjetas resumen por acción */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACCIONES.map((acc) => {
          const estilo = ESTILO_ACCION[acc];
          const activa = accionFiltro === acc;
          return (
            <button
              key={acc}
              onClick={() => setAccionFiltro(activa ? '' : acc)}
              className={`rounded-lg border px-4 py-3 text-left transition ${estilo.card} ${
                activa ? 'ring-2 ring-slate-400' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">{ETIQUETA_ACCION[acc]}</span>
                <span className={`rounded-full px-2 py-0.5 font-mono text-xs ${estilo.chip}`}>
                  {conteoPorAccion[acc]}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{DESCRIPCION_ACCION[acc]}</p>
            </button>
          );
        })}
      </div>

      {/* Filtros + plantilla del catálogo */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <select
          value={empresaFiltro}
          onChange={(e) => setEmpresaFiltro(e.target.value)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700"
        >
          <option value="">Todas las empresas</option>
          {empresas.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select
          value={accionFiltro}
          onChange={(e) => setAccionFiltro(e.target.value as '' | Accion)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700"
        >
          <option value="">Todas las acciones</option>
          {ACCIONES.map((acc) => (
            <option key={acc} value={acc}>
              {ETIQUETA_ACCION[acc]}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar combinada o referencia…"
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700"
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={copiarFilas}
            disabled={porCrear.length === 0}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Copiar filas ({porCrear.length})
          </button>
          <button
            onClick={descargarPlantilla}
            disabled={porCrear.length === 0}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Descargar plantilla (.xlsx)
          </button>
        </div>
      </div>

      {/* Listado de alertas filtradas */}
      {!hayAlertas ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
          Sin alertas por ahora. El catálogo reconoce todas las cuentas con movimiento.
        </div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
          Ninguna alerta coincide con los filtros.
        </div>
      ) : (
        <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-left">Acción</th>
                <th className="px-3 py-2 text-left">Combinada</th>
                <th className="px-3 py-2 text-left">Empresa</th>
                <th className="px-3 py-2 text-left">Referencia sugerida</th>
                <th className="px-3 py-2 text-right">Movimiento mes</th>
                <th className="px-3 py-2 text-right">12 meses</th>
                <th className="px-3 py-2 text-right">Último mes</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((a, i) => {
                const acc = normalizarAccion(a.accion);
                const chip = acc ? ESTILO_ACCION[acc].chip : 'bg-slate-100 text-slate-600';
                return (
                  <tr key={`${a.combinada}-${i}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${chip}`}>
                        {acc ? ETIQUETA_ACCION[acc] : a.accion}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{a.combinada}</td>
                    <td className="px-3 py-2">{empresaDeCombinada(a.combinada)}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {a.sugerencia ? (
                        <span className="font-mono text-[11px]">{a.sugerencia}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {fmt(a.movimientoMes, 2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {fmt(a.movimiento12m, 2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {fmt(a.ultimoMes, 2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        «Copiar filas» pega las cuentas por crear (sin encabezado, por tabulador) en la fila 2 de la
        plantilla; «Descargar plantilla» genera{' '}
        <span className="font-mono">Plantilla_Catalogo_GYP_{periodo || 'periodo'}.xlsx</span> en el
        navegador con las 18 columnas del portal (Linea, Grupo, Saldo Normal, Comercializadora y
        Orden Clasificacion vacías).
      </p>
    </section>
  );
}
