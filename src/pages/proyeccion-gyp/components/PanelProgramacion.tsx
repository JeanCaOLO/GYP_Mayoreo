import { useMemo, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import {
  ejecutarCorridaAhora,
  type Programacion,
  type CambiosProgramacion,
  type FrecuenciaProgramacion,
  type Corrida,
  type Fuente,
} from '../data';
import { nombreMes } from './PestanaParametros';

/**
 * Panel de actualización programada (CP-56, Requirements 27.1 / 27.9).
 *
 * Es la tercera sección de la pestaña Parámetros, abajo y a primera vista (no
 * detrás de ningún desplegable). Dos bloques:
 *
 *  1. Configuración — estado (activa/pausada), frecuencia (todos los días · solo
 *     días hábiles · semanal con día), hora de publicación EN HORA DE CARACAS,
 *     mes (el vigente por defecto o uno fijo) y «no publicar con datos viejos».
 *  2. Lectura — dos cosas distintas que no hay que confundir:
 *       · Datos de Fabric: «última extracción <fecha> · registros hasta el
 *         <corte>» (informativo; lo trae Fabric, el aplicativo no lo controla).
 *       · Publicación: la última (cuándo, cuánto tardó, cuántas filas) y la
 *         próxima, escrita en claro: «Próxima: mañana 23 oct, 7:30 a. m.
 *         (Caracas)».
 *
 * La hora se guarda y se muestra en hora de Caracas; en pantalla nunca aparece
 * UTC. La conversión a UTC para el planificador la hace el backend (CP-56).
 */

const MES_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** Días de la semana para `frecuencia = 'semanal'` (1 = lunes … 7 = domingo). */
const DIAS_SEMANA: { v: number; label: string }[] = [
  { v: 1, label: 'lunes' },
  { v: 2, label: 'martes' },
  { v: 3, label: 'miércoles' },
  { v: 4, label: 'jueves' },
  { v: 5, label: 'viernes' },
  { v: 6, label: 'sábado' },
  { v: 7, label: 'domingo' },
];

const FRECUENCIAS: { v: FrecuenciaProgramacion; label: string }[] = [
  { v: 'diaria', label: 'todos los días' },
  { v: 'habiles', label: 'solo días hábiles' },
  { v: 'semanal', label: 'semanal' },
];

/** `HH:MM` (24h, Caracas) → «7:30 a. m.» / «11:45 p. m.». Pura y testable. */
export function horaEnClaro(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  let h = Number(m[1]);
  const min = m[2];
  const meridiano = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${meridiano}`;
}

/** Día «D mmm» a partir de un Date (en la fecha local del Date). */
function diaCorto(d: Date): string {
  return `${d.getDate()} ${MES_ES[d.getMonth()]}`;
}

/**
 * Estima la próxima publicación en claro (CP-56), en hora de Caracas. No es un
 * cron parser perfecto: da una lectura aproximada y legible a partir de la
 * frecuencia y la hora local.
 *
 *   hoy a las 7:30 a. m.        → si aún no pasó la hora de hoy y hoy aplica
 *   mañana 23 oct, 7:30 a. m.   → si ya pasó la hora o mañana es el próximo día
 *   el lunes 27 oct, 7:30 a. m. → frecuencia semanal, al próximo día elegido
 *
 * `ahora` se inyecta para poder probar la función sin depender del reloj.
 */
export function proximaPublicacionEnClaro(p: Programacion, ahora: Date = new Date()): string {
  if (!p.activa) return 'pausada';
  const hora = horaEnClaro(p.horaLocal);
  const m = /^(\d{1,2}):(\d{2})/.exec(p.horaLocal);
  const hh = m ? Number(m[1]) : 0;
  const mm = m ? Number(m[2]) : 0;

  // Minutos del día de «ahora» vs la hora programada, para saber si ya pasó.
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const minutosHora = hh * 60 + mm;
  const yaPaso = minutosAhora >= minutosHora;

  // getDay(): 0 = domingo … 6 = sábado. Lo pasamos a 1 = lunes … 7 = domingo.
  const diaISO = (d: Date): number => ((d.getDay() + 6) % 7) + 1;

  // Candidato más temprano según la frecuencia, empezando por hoy (offset 0).
  const aplica = (offset: number): boolean => {
    const d = new Date(ahora);
    d.setDate(d.getDate() + offset);
    const iso = diaISO(d);
    if (p.frecuencia === 'diaria') return true;
    if (p.frecuencia === 'habiles') return iso >= 1 && iso <= 5; // lun–vie
    // semanal con día fijo (por defecto lunes si no se fijó)
    return iso === (p.diaSemana ?? 1);
  };

  for (let offset = 0; offset <= 7; offset++) {
    if (!aplica(offset)) continue;
    // Hoy solo cuenta si la hora aún no pasó.
    if (offset === 0 && yaPaso) continue;
    const d = new Date(ahora);
    d.setDate(d.getDate() + offset);
    if (offset === 0) return `hoy a las ${hora} (Caracas)`;
    if (offset === 1) return `mañana ${diaCorto(d)}, ${hora} (Caracas)`;
    const nombreDia = DIAS_SEMANA.find((x) => x.v === diaISO(d))?.label ?? '';
    return `el ${nombreDia} ${diaCorto(d)}, ${hora} (Caracas)`;
  }
  return `${hora} (Caracas)`;
}

/** `timestamptz` → «22 oct, 6:10 a. m.» en hora de Caracas (nunca UTC). */
export function fechaCaracasEnClaro(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const partes = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  const mes = get('month').replace('.', '');
  const dp = get('dayPeriod').toLowerCase().replace(/\s/g, ' ');
  return `${get('day')} ${mes}, ${get('hour')}:${get('minute')} ${dp}`;
}

/** Corte «YYYY-MM-DD» → «21 oct». */
export function corteEnClaro(fecha: string | null | undefined): string {
  if (!fecha) return '—';
  const [, m, d] = fecha.split('-').map(Number);
  if (!m || !d) return fecha;
  return `${d} ${MES_ES[m - 1]}`;
}

/** Duración entre inicio y fin, en claro: «1 min 12 s» / «48 s». */
export function duracionEnClaro(inicio: string | null, fin: string | null): string {
  if (!inicio || !fin) return '—';
  const ms = new Date(fin).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seg = Math.round(ms / 1000);
  if (seg < 60) return `${seg} s`;
  const min = Math.floor(seg / 60);
  const resto = seg % 60;
  return resto ? `${min} min ${resto} s` : `${min} min`;
}

export interface PanelProgramacionProps {
  /** Configuración actual (de `proyeccion_programacion`). */
  programacion: Programacion;
  /** Persiste un cambio de configuración (bloqueo optimista por rev, CP-38). */
  onGuardarProgramacion: (cambios: CambiosProgramacion) => void;
  /** Última publicación con éxito del periodo (de `proyeccion_corrida`). */
  ultimaPublicacion: Corrida | null;
  /** Mes de trabajo vigente (para «el mes vigente» y la etiqueta del select). */
  periodo: string;
  /** Datos de Fabric: fecha de la última extracción y su corte (informativo). */
  generado: string | null;
  corte: string | null;
  /** Frescura de la capa de datos (deriva si hay o no datos de Fabric). */
  fuente: Fuente;
}

const SEG_BTN = 'rounded-md px-3 py-1.5 text-xs font-medium transition-colors';

export default function PanelProgramacion({
  programacion,
  onGuardarProgramacion,
  ultimaPublicacion,
  periodo,
  generado,
  corte,
  fuente,
}: PanelProgramacionProps) {
  const p = programacion;
  const proxima = useMemo(() => proximaPublicacionEnClaro(p), [p]);
  const { addToast } = useToast();
  const [ejecutando, setEjecutando] = useState(false);
  const [bitacora, setBitacora] = useState<string[] | null>(null);

  // Corre la cadena completa ya: datos de Fabric en Supabase → recálculo → v_proyeccion_final.
  const ejecutarAhora = async () => {
    if (!window.confirm('¿Recalcular con los últimos datos de Fabric y publicar proyectado y causado ahora?')) return;
    setEjecutando(true);
    setBitacora(null);
    try {
      const r = await ejecutarCorridaAhora(p.periodo ?? periodo);
      setBitacora(r.log ?? (r.error ? [r.error] : []));
      if (r.ok && r.ejecutada) {
        addToast('success', `Actualización publicada: ${JSON.stringify(r.publicado ?? {})} filas por escenario.`);
      } else {
        addToast('error', `La actualización no publicó (${r.motivo ?? r.error ?? 'error'}). Revisa la bitácora.`);
      }
    } catch (err) {
      addToast('error', 'No se pudo ejecutar: ' + (err as Error).message);
    } finally {
      setEjecutando(false);
    }
  };
  const mesFijo = p.periodo != null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Cuándo se actualiza solo</h2>
        <p className="text-sm text-slate-500">
          A la <b>hora de publicación, en hora de Caracas</b>, el servidor toma los últimos datos que
          Fabric escribió en <span className="font-mono">gyp_historico_mensual</span>, recalcula las
          reglas de los dos escenarios y publica proyectado y causado en{' '}
          <span className="font-mono">v_proyeccion_final</span>. Revisa cada 5 minutos si
          ya toca, así que publica a lo sumo 5 minutos después de la hora elegida.
        </p>
      </div>

      {/* ── Configuración (a primera vista) ──────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-1 gap-px bg-slate-100 md:grid-cols-2">
          {/* Estado */}
          <div className="bg-white p-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Estado
            </label>
            <div className="mt-2 inline-flex rounded-lg bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => onGuardarProgramacion({ activa: true })}
                className={`${SEG_BTN} ${p.activa ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                Activa
              </button>
              <button
                type="button"
                onClick={() => onGuardarProgramacion({ activa: false })}
                className={`${SEG_BTN} ${!p.activa ? 'bg-slate-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                Pausada
              </button>
            </div>
          </div>

          {/* Hora de publicación (Caracas) */}
          <div className="bg-white p-4">
            <label
              htmlFor="prog-hora"
              className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Hora de publicación <span className="text-slate-400">(Caracas)</span>
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="prog-hora"
                type="time"
                value={p.horaLocal}
                onChange={(e) => onGuardarProgramacion({ horaLocal: e.target.value })}
                className="rounded border border-slate-200 px-2 py-1 font-mono text-sm"
              />
              <span className="text-xs text-slate-400">= {horaEnClaro(p.horaLocal)} (Caracas)</span>
            </div>
          </div>

          {/* Frecuencia */}
          <div className="bg-white p-4">
            <label
              htmlFor="prog-frecuencia"
              className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Frecuencia
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                id="prog-frecuencia"
                value={p.frecuencia}
                onChange={(e) =>
                  onGuardarProgramacion({ frecuencia: e.target.value as FrecuenciaProgramacion })
                }
                className="rounded border border-slate-200 px-2 py-1 text-sm"
              >
                {FRECUENCIAS.map((f) => (
                  <option key={f.v} value={f.v}>
                    {f.label}
                  </option>
                ))}
              </select>
              {p.frecuencia === 'semanal' && (
                <select
                  aria-label="Día de la semana"
                  value={p.diaSemana ?? 1}
                  onChange={(e) => onGuardarProgramacion({ diaSemana: +e.target.value })}
                  className="rounded border border-slate-200 px-2 py-1 text-sm"
                >
                  {DIAS_SEMANA.map((d) => (
                    <option key={d.v} value={d.v}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Mes */}
          <div className="bg-white p-4">
            <label
              htmlFor="prog-mes"
              className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Mes
            </label>
            <div className="mt-2">
              <select
                id="prog-mes"
                value={mesFijo ? 'fijo' : 'vigente'}
                onChange={(e) =>
                  onGuardarProgramacion({ periodo: e.target.value === 'fijo' ? periodo : null })
                }
                className="rounded border border-slate-200 px-2 py-1 text-sm"
              >
                <option value="vigente">el mes de trabajo vigente</option>
                <option value="fijo">un mes fijo ({nombreMes(mesFijo ? p.periodo! : periodo)})</option>
              </select>
            </div>
          </div>

          {/* No publicar con datos viejos */}
          <div className="bg-white p-4 md:col-span-2">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={p.exigeDatosFrescos}
                onChange={(e) => onGuardarProgramacion({ exigeDatosFrescos: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                <span className="text-sm font-medium text-slate-800">
                  No publicar con datos viejos
                </span>
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  recomendado
                </span>
                <span className="block text-xs text-slate-500">
                  Si la extracción no es del día o su corte no avanzó, la corrida se omite y se
                  conserva lo publicado. Es el guardia que evita publicar los números de ayer.
                </span>
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* ── Lectura: datos de Fabric vs publicación ──────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Datos de Fabric (informativo) */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Datos de Fabric
          </h3>
          {fuente === 'error' ? (
            <p className="mt-2 text-sm text-slate-500">No se pudo leer la extracción.</p>
          ) : (
            <p className="mt-2 text-sm text-slate-700">
              Última extracción <b>{generado || '—'}</b>
              <span className="text-slate-500"> · registros hasta el {corteEnClaro(corte)}</span>
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-400">
            Informativo: lo trae Fabric por su cuenta. El aplicativo no dispara la extracción.
          </p>
        </div>

        {/* Publicación (última + próxima) */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Publicación
          </h3>
          {ultimaPublicacion ? (
            <p className="mt-2 text-sm text-slate-700">
              Última: <b>{fechaCaracasEnClaro(ultimaPublicacion.inicio)}</b>
              <span className="text-slate-500">
                {' · '}
                {duracionEnClaro(ultimaPublicacion.inicio, ultimaPublicacion.fin)}
                {ultimaPublicacion.filas != null && (
                  <> · {ultimaPublicacion.filas.toLocaleString('es-VE')} filas</>
                )}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Todavía no hay publicaciones registradas.</p>
          )}
          <p className="mt-2 text-sm text-slate-700">
            Próxima:{' '}
            {p.activa ? (
              <b>{proxima}</b>
            ) : (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                pausada
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={ejecutarAhora}
            disabled={ejecutando}
            className="mt-3 rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {ejecutando ? 'Ejecutando… (puede tardar unos minutos)' : 'Ejecutar ahora'}
          </button>
          {bitacora && bitacora.length > 0 && (
            <ul className="mt-2 space-y-0.5 rounded bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600">
              {bitacora.map((l, i) => (
                <li key={i}>· {l}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
