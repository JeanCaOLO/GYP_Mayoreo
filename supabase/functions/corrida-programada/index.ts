// supabase/functions/corrida-programada/index.ts
//
// Edge Function de CORRIDA PROGRAMADA de la Proyección GyP (CP-56).
//
// Es el trabajo del lado del servidor que publica la tabla final sin que nadie
// entre a hacerlo a mano. La dispara `pg_cron` a la `hora_local` configurada
// (en `America/Caracas`) convertida a UTC por el planificador —ver el SQL del
// job al final de este archivo—; el navegador NUNCA la ejecuta (R-27.3), porque
// nadie garantiza que la página esté abierta a las 6:45.
//
// La zona viaja con el dato: `hora_local` se guarda y se muestra en hora de
// Caracas, y la conversión a UTC (06:45 Caracas = 10:45 UTC, Venezuela es UTC−04
// sin horario de verano) la hace el planificador, no el usuario. Esta función
// NUNCA escribe un desfase de −4 a mano (R-27.2).
//
// ─────────────────────────────────────────────────────────────────────────────
// QUÉ HACE (CP-56, en orden)
// ─────────────────────────────────────────────────────────────────────────────
//   0. Lee la config de `proyeccion_programacion` (fila id=1): activa, frecuencia
//      (diaria|habiles|semanal + dia_semana), hora_local, zona,
//      exige_datos_frescos, periodo (null = el mes de trabajo guardado en
//      `proyeccion_mes_trabajo`, que NO cambia solo con el calendario).
//      ¿TOCA AHORA? pg_cron la llama cada 5 minutos; la función solo corre si
//      hoy toca según la frecuencia, ya pasó la `hora_local` en Caracas y pg_cron
//      aún no calculó ni publicó desde esa hora. Así un cambio de horario en
//      la pantalla rige sin reprogramar el cron. `{"manual": true}` lo salta.
//      Cada llamada deja una fila en `proyeccion_tick` con lo que decidió.
//   0b. DATOS DE FABRIC: NO se consulta Fabric. Fabric escribe por su cuenta
//      en `gyp_historico_mensual` (y el corte en `proyeccion_parametro`); la
//      corrida usa lo último que haya allí. Sin filas del mes no publica.
//   1. GUARDIA DE SOLAPAMIENTO (CP-56 #6 / R-27.7): si hay una corrida `en_curso`
//      (índice único `ux_corrida_una_en_curso`), la nueva se omite y termina.
//   2. GUARDIA DE DATOS FRESCOS (CP-56 #4 / R-27.6): si `exige_datos_frescos` y
//      Fabric no escribió el mes hoy (sello de `gyp_extraccion_sello`), la
//      corrida se omite y CONSERVA lo publicado; el siguiente tick reintenta.
//   3. PASO `calculo` (CP-56 #2 / R-27.8): recálculo de los DOS escenarios. Se
//      registra como un paso aparte en `proyeccion_corrida`. (Ver NOTA DE ALCANCE:
//      el motor vive en el cliente; aquí se reciben las filas ya calculadas o se
//      deja constancia de que el recálculo server-side exige portar el motor.)
//   4. CHECKLIST CP-44 (CP-56 #3 / R-27.5): si un ítem BLOQUEANTE falla, NO publica,
//      registra el error y avisa. Aquí corre una versión MÍNIMA/hook; el checklist
//      completo es la tarea 22.1 (`checklist.ts`).
//   5. PASO `publicacion` (CP-56 #1,#2 / R-27.4): publica los DOS escenarios de
//      forma idempotente (`DELETE`+`INSERT` por `(periodo, escenario)` en
//      transacción) delegando en la Edge Function `publicar-proyeccion` o en la
//      RPC `publicar_proyeccion`, usando las reglas tal como estén guardadas
//      (CP-56 #5). El paso 5 NO corre si el paso 3 no terminó (R-27.8).
//   6. Registra recálculo y publicación POR SEPARADO en `proyeccion_corrida` con
//      `origen='programada'` (pg_cron) o `'manual'` (botón).
//
// ─────────────────────────────────────────────────────────────────────────────
// DÓNDE VIVE EL MOTOR (recálculo server-side)
// ─────────────────────────────────────────────────────────────────────────────
// El motor de cálculo (`src/pages/proyeccion-gyp/engine.ts`) y sus módulos
// (`causado`, `capas`, `destino`, `salida`, `seed`) son TypeScript PURO: no usan
// el cliente de Supabase del navegador ni APIs de browser. Por eso SÍ corren en
// el runtime Deno. Esta corrida los reutiliza SIN duplicarlos, a través del
// puente `_shared/motor.ts`, que re-exporta esos módulos por ruta relativa. Así
// hay UNA sola fuente de verdad: la corrida programada calcula EXACTAMENTE las
// mismas cifras que la pantalla (el mismo motor que valida el oráculo de 190).
//
// El RECÁLCULO de los dos escenarios se resuelve así:
//   (a) Si el llamador envía en el body `filas: FilaSalida[]` ya calculadas, se
//       publican tal cual (p. ej. un disparo manual que ya tiene el resultado).
//   (b) Si no llegan filas (caso normal de pg_cron, body `{}`), la función LEE
//       los insumos de Supabase con el cliente de SERVICIO (`_shared/cargarInsumos.ts`)
//       y corre `construirFilasEscenarios`. Si faltan reglas o parámetros del
//       periodo, el paso `calculo` se marca `error` y NO se publica (R-27.8): una
//       corrida desatendida nunca publica datos incompletos ni la semilla de prueba.
//
// El núcleo de CP-56 que esta función implementa: el recálculo server-side, las
// guardias (solapamiento + datos frescos), la bitácora por pasos, la hora de
// Caracas y la delegación idempotente de la publicación.
//
// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO DE ENTRADA (body JSON, POST — opcional; pg_cron puede llamar sin body)
// ─────────────────────────────────────────────────────────────────────────────
//   {
//     "periodo":  "2026-10",        // opcional. Si se omite, se usa el de la
//                                   //   config, y si esa es null, el mes vigente.
//     "filas":    FilaSalida[],     // opcional. Filas de los DOS escenarios ya
//                                   //   calculadas por el motor (caso (a) arriba).
//     "dimCuenta": string[],        // opcional. Se reenvía a publicar-proyeccion.
//     "forzar":   false,            // opcional. Si true, salta el guardia de
//                                   //   datos frescos aun con exige_datos_frescos.
//     "manual":   false             // opcional. Si true, corre ya sin mirar el
//                                   //   horario (y aunque esté pausada).
//   }
//
// Credenciales fuera del navegador (R-NN-5): SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY del entorno con el createClient de servicio.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cargarInsumos } from "../_shared/cargarInsumos.ts";
import { construirFilasEscenarios } from "../_shared/motor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/** Config de la fila única id=1 de `proyeccion_programacion`. */
interface Programacion {
  id: number;
  activa: boolean;
  frecuencia: "diaria" | "habiles" | "semanal" | string;
  dia_semana: number | null;
  hora_local: string; // HH:MM[:SS], en Caracas
  zona: string; // 'America/Caracas'
  exige_datos_frescos: boolean;
  periodo: string | null; // null = mes de trabajo vigente
}

/** Fila de la tabla final (espejo del contrato de publicar-proyeccion). */
interface FilaSalida {
  periodo: string;
  fecha: string;
  vista: string;
  combinada: string;
  pais: string;
  empresa: string;
  tasa_mensual: number | null;
  ajuste: number;
  ajuste_usd: number;
  monto_local: number;
  monto_usd: number;
  centro_costo: string;
  cuenta_contable: string;
  proyeccion: 1 | 2 | number;
  escenarios?: string;
}

/** Resultado de una comprobación del checklist (CP-44, versión mínima). */
interface ItemChecklist {
  nombre: string;
  bloqueante: boolean;
  ok: boolean;
  detalle?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bitácora: `proyeccion_corrida`, un registro por paso (CP-56 #? / R-27.8)
// ─────────────────────────────────────────────────────────────────────────────

type Paso = "extraccion" | "calculo" | "publicacion";
type EstadoCorrida = "en_curso" | "ok" | "error" | "omitida";

/**
 * Inserta una fila de bitácora y devuelve su id, para luego cerrarla con
 * `cerrarCorrida`. `origen` es 'programada' (pg_cron) o 'manual' (botón).
 * Devuelve "ocupado" si ya hay otra corrida en curso: el índice único
 * `ux_corrida_una_en_curso` rechaza la segunda fila `en_curso`.
 */
async function abrirCorrida(
  db: SupabaseClient,
  periodo: string,
  paso: Paso,
  estado: EstadoCorrida,
  extra: Partial<{ mensaje: string; filas: number; corte: string | null }> = {},
): Promise<number | null | "ocupado"> {
  const { data, error } = await db
    .from("proyeccion_corrida")
    .insert({
      periodo,
      origen: ORIGEN,
      paso,
      estado,
      filas: extra.filas ?? null,
      corte: extra.corte ?? null,
      mensaje: extra.mensaje ?? null,
      lanzada_por: LANZADA_POR,
      // `inicio` lo pone el default now(); si el estado ya es terminal, cerramos fin.
      fin: estado === "en_curso" ? null : new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505" && estado === "en_curso") return "ocupado";
    // La bitácora no debe tumbar la corrida, pero sí se registra en el log.
    console.error("proyeccion_corrida insert falló:", error.message);
    return null;
  }
  return (data as { id: number }).id;
}

/** Cierra una corrida `en_curso` previamente abierta con su estado terminal. */
async function cerrarCorrida(
  db: SupabaseClient,
  id: number | null,
  estado: Exclude<EstadoCorrida, "en_curso">,
  extra: Partial<{ mensaje: string; filas: number; corte: string | null }> = {},
): Promise<void> {
  if (id == null) return;
  const patch: Record<string, unknown> = {
    estado,
    fin: new Date().toISOString(),
  };
  if (extra.mensaje !== undefined) patch.mensaje = extra.mensaje;
  if (extra.filas !== undefined) patch.filas = extra.filas;
  if (extra.corte !== undefined) patch.corte = extra.corte;
  const { error } = await db
    .from("proyeccion_corrida")
    .update(patch)
    .eq("id", id);
  if (error) console.error("proyeccion_corrida update falló:", error.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mes de trabajo: el guardado en `proyeccion_mes_trabajo` (CP-33)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mes de trabajo elegido en la pantalla y compartido por todos. NO se deriva
 * del calendario: el 1 de noviembre, con octubre guardado, se sigue publicando
 * octubre hasta que alguien elija noviembre.
 */
async function mesDeTrabajo(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db
    .from("proyeccion_mes_trabajo")
    .select("periodo")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer proyeccion_mes_trabajo: ${error.message}`);
  return (data as { periodo: string } | null)?.periodo ?? null;
}

/**
 * Respaldo si aún no hay mes guardado: 'aaaa-mm' del mes del calendario EN LA
 * ZONA de la config (Caracas por defecto), con Intl en vez de restar −4 a mano
 * (R-27.2).
 */
function periodoCalendario(zona: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
  });
  // en-CA da 'aaaa-mm'; nos quedamos con los primeros 7 caracteres.
  const partes = fmt.format(new Date()); // p.ej. "2026-10"
  return partes.slice(0, 7);
}

// ─────────────────────────────────────────────────────────────────────────────
// ¿Toca correr ahora? (el cron llama cada 5 minutos)
// ─────────────────────────────────────────────────────────────────────────────

/** Quién lanzó la corrida, para la bitácora. Se fijan por petición en el handler. */
let LANZADA_POR = "pg_cron";
let ORIGEN: "programada" | "manual" = "programada";

/** Una corrida `en_curso` más vieja que esto se da por caída y no bloquea. */
const CORRIDA_COLGADA_MS = 30 * 60 * 1000;

/** Fecha y hora "de pared" de un instante en la zona dada. */
function partesEnZona(instante: Date, zona: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    anio: +p.year,
    mes: +p.month,
    dia: +p.day,
    hora: +p.hour,
    minuto: +p.minute,
    segundo: +p.second,
  };
}

/**
 * Instante UTC que corresponde a `fecha` + `hora` (HH:MM) de pared en `zona`.
 * Se calcula el desfase de la zona con Intl en vez de escribir −4 a mano (R-27.2).
 */
function instanteDeLocal(fecha: string, hora: string, zona: string): Date {
  const [a, m, d] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  const supuesto = Date.UTC(a, m - 1, d, hh, mm, 0);
  const p = partesEnZona(new Date(supuesto), zona);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return new Date(supuesto - (comoUtc - supuesto));
}

/** Día ISO (1 = lunes … 7 = domingo) de una fecha 'aaaa-mm-dd'. */
function diaIso(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  return ((new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/**
 * Decide si la corrida programada toca ahora: hoy (en la zona) es un día de la
 * frecuencia, ya pasó `hora_local` y pg_cron aún no calculó ni publicó desde
 * entonces. Una corrida omitida (sin datos, datos viejos, solapamiento) no
 * cuenta: el siguiente tick lo vuelve a intentar. Una que terminó en error sí
 * cuenta, para no repetir el mismo fallo cada 5 minutos.
 */
async function tocaAhora(
  db: SupabaseClient,
  prog: Programacion,
  zona: string,
): Promise<{ toca: boolean; motivo: string }> {
  const ahora = new Date();
  const hoy = partesEnZona(ahora, zona).fecha;
  const iso = diaIso(hoy);
  const diaOk =
    prog.frecuencia === "habiles"
      ? iso >= 1 && iso <= 5
      : prog.frecuencia === "semanal"
        ? iso === (prog.dia_semana ?? 1)
        : true;
  if (!diaOk) return { toca: false, motivo: `hoy (${hoy}) no toca según la frecuencia ${prog.frecuencia}.` };

  const programada = instanteDeLocal(hoy, prog.hora_local.slice(0, 5), zona);
  if (ahora < programada) {
    return { toca: false, motivo: `aún no son las ${prog.hora_local.slice(0, 5)} en ${zona}.` };
  }

  const { data, error } = await db
    .from("proyeccion_corrida")
    .select("id")
    .eq("lanzada_por", "pg_cron")
    .in("paso", ["calculo", "publicacion"])
    .in("estado", ["en_curso", "ok", "error"])
    .gte("inicio", programada.toISOString())
    .limit(1);
  if (error) throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  if (data && data.length > 0) {
    return { toca: false, motivo: `ya corrió hoy después de las ${prog.hora_local.slice(0, 5)}.` };
  }
  return { toca: true, motivo: `programada ${hoy} ${prog.hora_local.slice(0, 5)} (${zona}).` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Datos de Fabric ya escritos en Supabase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuántas filas dejó Fabric en `gyp_historico_mensual` para el periodo. La
 * corrida NO consulta Fabric: recalcula con lo último que Fabric escribió.
 */
async function filasHistoricoDelMes(db: SupabaseClient, periodo: string): Promise<number> {
  const { count, error } = await db
    .from("gyp_historico_mensual")
    .select("periodo", { count: "exact", head: true })
    .eq("periodo", periodo);
  if (error) throw new Error(`No se pudo leer gyp_historico_mensual: ${error.message}`);
  return count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardia de datos frescos (CP-56 #4 / R-27.6)
// ─────────────────────────────────────────────────────────────────────────────

/** Corte más avanzado que Fabric dejó en `proyeccion_parametro` para el periodo. */
async function corteDeExtraccion(db: SupabaseClient, periodo: string): Promise<string | null> {
  const { data, error } = await db
    .from("proyeccion_parametro")
    .select("corte")
    .eq("periodo", periodo)
    .not("corte", "is", null);
  if (error) throw error;
  const cortes = (data ?? [])
    .map((r: { corte: string | null }) => r.corte)
    .filter((c): c is string => !!c)
    .sort();
  return cortes.length ? cortes[cortes.length - 1] : null;
}

/**
 * Los datos del mes están "frescos" si Fabric escribió el periodo HOY (fecha de
 * Caracas). El sello lo pone el trigger de `gyp_historico_mensual` en
 * `gyp_extraccion_sello` cada vez que Fabric escribe, así que refleja la última
 * escritura real y no un campo que el notebook pueda olvidar.
 */
async function datosFrescos(
  db: SupabaseClient,
  periodo: string,
  zona: string,
): Promise<{ frescos: boolean; motivo?: string }> {
  const { data, error } = await db
    .from("gyp_extraccion_sello")
    .select("escrito_en")
    .eq("periodo", periodo)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer gyp_extraccion_sello: ${error.message}`);
  const escrito = (data as { escrito_en: string } | null)?.escrito_en;
  if (!escrito) {
    return { frescos: false, motivo: `no hay sello de extracción de ${periodo}.` };
  }
  const hoy = partesEnZona(new Date(), zona).fecha;
  const diaSello = partesEnZona(new Date(escrito), zona).fecha;
  if (diaSello !== hoy) {
    return { frescos: false, motivo: `la última extracción es del ${diaSello}, no de hoy (${hoy}).` };
  }
  return { frescos: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Checklist CP-44 — versión MÍNIMA / hook (el completo es la tarea 22.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Corre una versión ligera del checklist de publicación (CP-44). El checklist
 * COMPLETO —prueba contable de Renta Bruta en las 6 empresas, llaves por
 * escenario según CP-49, Combinada ⊂ dim_cuenta, FECHA=día 1, Pais lleno,
 * Tasa_Mensual solo Cofersa/Mundial, sin Combinadas repetidas por escenario,
 * suma de reglas por cuenta + resto = concepto, y el aviso (no bloqueante) de
 * variación grande del total USD por empresa— es la tarea 22.1 en
 * `src/pages/proyeccion-gyp/checklist.ts`.
 *
 * Aquí se implementan solo las comprobaciones que esta función puede hacer con
 * las filas en mano, de forma barata, y se deja el hook para delegar en el
 * checklist completo cuando exista. Si algún ítem BLOQUEANTE falla, la corrida NO
 * publica (CP-56 #3 / R-27.5).
 */
function checklistMinimo(
  filas: FilaSalida[],
  periodo: string,
  dimCuenta: Set<string> | null,
): ItemChecklist[] {
  const items: ItemChecklist[] = [];

  // (CP-44 #4) FECHA = día 1 del periodo en todas las filas.
  const dia1 = `${periodo.slice(0, 7)}-01`;
  const fechasMalas = filas.filter((f) => String(f.fecha).slice(0, 10) !== dia1);
  items.push({
    nombre: "FECHA = día 1 del periodo",
    bloqueante: true,
    ok: fechasMalas.length === 0,
    detalle: fechasMalas.length
      ? `${fechasMalas.length} fila(s) con FECHA distinta de ${dia1}.`
      : undefined,
  });

  // (CP-44 #5) Pais lleno en todas las filas.
  const sinPais = filas.filter((f) => !f.pais || String(f.pais).trim() === "");
  items.push({
    nombre: "Pais lleno",
    bloqueante: true,
    ok: sinPais.length === 0,
    detalle: sinPais.length ? `${sinPais.length} fila(s) sin país.` : undefined,
  });

  // (CP-44 #6) Tasa_Mensual no nula solo para Cofersa y Mundial, nula para el resto.
  const conTasa = new Set(["Cofersa", "Mundial"]);
  const tasaMala = filas.filter((f) => {
    const debeTener = conTasa.has(f.empresa);
    const tiene = f.tasa_mensual != null;
    return debeTener !== tiene;
  });
  items.push({
    nombre: "Tasa_Mensual solo Cofersa/Mundial",
    bloqueante: true,
    ok: tasaMala.length === 0,
    detalle: tasaMala.length
      ? (() => {
          const faltan = tasaMala.filter((f) => conTasa.has(f.empresa));
          const sobran = tasaMala.length - faltan.length;
          const partes: string[] = [];
          if (faltan.length) {
            const emps = [...new Set(faltan.map((f) => f.empresa))].join(", ");
            partes.push(`${faltan.length} fila(s) de ${emps} sin Tasa_Mensual`);
          }
          if (sobran) partes.push(`${sobran} fila(s) venezolanas con Tasa_Mensual`);
          return partes.join("; ") + ".";
        })()
      : undefined,
  });

  // (CP-44 #7) Ninguna Combinada repetida dentro de un mismo escenario.
  const porEscenario = new Map<string, Set<string>>();
  const repetidas: string[] = [];
  for (const f of filas) {
    const esc = String(f.proyeccion);
    if (!porEscenario.has(esc)) porEscenario.set(esc, new Set());
    const vistas = porEscenario.get(esc)!;
    if (vistas.has(f.combinada)) repetidas.push(`${esc}:${f.combinada}`);
    else vistas.add(f.combinada);
  }
  items.push({
    nombre: "Sin Combinada repetida por escenario",
    bloqueante: true,
    ok: repetidas.length === 0,
    detalle: repetidas.length
      ? `${repetidas.length} repetición(es): ${repetidas.slice(0, 5).join(", ")}…`
      : undefined,
  });

  // (CP-44 #3) Toda Combinada existe en dim_cuenta (si el catálogo está en mano).
  if (dimCuenta) {
    const huerfanas = [...new Set(
      filas.map((f) => f.combinada).filter((c) => !dimCuenta.has(c)),
    )];
    items.push({
      nombre: "Combinada ⊂ dim_cuenta",
      bloqueante: true,
      ok: huerfanas.length === 0,
      detalle: huerfanas.length
        ? `${huerfanas.length} Combinada(s) huérfana(s): ${huerfanas.slice(0, 5).join(", ")}…`
        : undefined,
    });
  }

  // (CP-44 #2) Cada escenario trae filas. Una publicación con un solo escenario
  // dejaría el otro congelado sin que nadie lo note (CP-56 #1).
  const tieneEsc1 = filas.some((f) => Number(f.proyeccion) === 1);
  const tieneEsc2 = filas.some((f) => Number(f.proyeccion) === 2);
  items.push({
    nombre: "Los dos escenarios presentes",
    bloqueante: true,
    ok: tieneEsc1 && tieneEsc2,
    detalle: tieneEsc1 && tieneEsc2
      ? undefined
      : `falta el escenario ${!tieneEsc1 ? "1 (Proyectado)" : "2 (Causado)"}.`,
  });

  // NOTA: los ítems contables (Renta Bruta cuadra, suma reglas+resto=concepto,
  // CP-49 llaves por escenario) y el aviso de variación grande del total USD
  // (no bloqueante) los cubre el checklist completo de la tarea 22.1.
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Publicación: delega en la Edge Function publicar-proyeccion (CP-56 #1,#2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invoca la Edge Function `publicar-proyeccion` (ya existe) con las filas de los
 * DOS escenarios. Esa función hace el filtro por escenario (CP-49), la fusión por
 * Combinada (CP-06), la validación contra dim_cuenta (CP-07) y el `DELETE`+`INSERT`
 * idempotente por `(periodo, escenario)` vía la RPC transaccional
 * `publicar_proyeccion` (CP-02/CP-03). No se reimplementa nada de eso aquí.
 */
async function publicar(
  supabaseUrl: string,
  serviceKey: string,
  periodo: string,
  filas: FilaSalida[],
  dimCuenta: string[] | undefined,
): Promise<{ ok: boolean; publicado?: Record<string, number>; error?: string; cuerpo: unknown }> {
  const resp = await fetch(`${supabaseUrl}/functions/v1/publicar-proyeccion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify({ periodo, filas, dimCuenta }),
  });
  const cuerpo = await resp.json().catch(() => null);
  if (!resp.ok || !cuerpo || cuerpo.ok !== true) {
    return {
      ok: false,
      error:
        (cuerpo && (cuerpo.error || cuerpo.mensaje)) ??
        `publicar-proyeccion respondió ${resp.status}`,
      cuerpo,
    };
  }
  return { ok: true, publicado: cuerpo.publicado, cuerpo };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const t0 = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // Disparo manual (botón o prueba): corre ya, sin mirar horario ni pausa.
  const manual = body.manual === true;
  LANZADA_POR = manual ? "manual" : "pg_cron";
  ORIGEN = manual ? "manual" : "programada";

  // Cada llamada deja su tick. El de pg_cron ya lo abrió
  // proyeccion_disparar_corrida() y llega en el body; el resto se abre aquí.
  let tickId = typeof body.tick_id === "number" ? body.tick_id : null;
  if (tickId == null) {
    const { data } = await db
      .from("proyeccion_tick")
      .insert({ origen: ORIGEN, estado: "enviado" })
      .select("id")
      .single();
    tickId = (data as { id: number } | null)?.id ?? null;
  }

  const resp = await manejar(db, body, manual, supabaseUrl, serviceKey);
  const payload = await resp.clone().json().catch(() => null);
  await cerrarTick(db, tickId, payload, Date.now() - t0);
  return resp;
});

/** Escribe en el tick lo que decidió la función y cuánto tardó. */
async function cerrarTick(
  db: SupabaseClient,
  id: number | null,
  payload: Record<string, unknown> | null,
  duracionMs: number,
): Promise<void> {
  if (id == null) return;
  const log = Array.isArray(payload?.log) ? (payload!.log as string[]) : [];
  const publicado = payload?.publicado as Record<string, number> | undefined;
  const estado = payload?.ejecutada ? "ejecutada" : payload?.ok ? "omitida" : "error";
  const motivo = payload?.ejecutada
    ? `publicado ${JSON.stringify(publicado ?? {})}`
    : [payload?.motivo ?? payload?.error ?? "sin respuesta", log[log.length - 1]]
        .filter(Boolean)
        .join(": ");
  const { error } = await db
    .from("proyeccion_tick")
    .update({
      estado,
      motivo: String(motivo).slice(0, 2000),
      periodo: (payload?.periodo as string | undefined) ?? null,
      filas: publicado ? Object.values(publicado).reduce((a, b) => a + b, 0) : null,
      duracion_ms: duracionMs,
      fin: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) console.error("proyeccion_tick update falló:", error.message);
}

async function manejar(
  db: SupabaseClient,
  body: Record<string, unknown>,
  manual: boolean,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const log: string[] = [];

  // Una omisión del botón queda en la bitácora para que la vea quien lo pulsó.
  // Las de pg_cron solo van al tick: el siguiente tick reintenta y no se llena
  // proyeccion_corrida con una fila cada 5 minutos.
  const omitir = async (periodo: string, msg: string, corte: string | null = null) => {
    log.push(msg);
    if (manual) await abrirCorrida(db, periodo, "calculo", "omitida", { mensaje: msg, corte });
  };

  try {
    // 0. Config de programación (fila única id=1).
    const { data: progRow, error: eProg } = await db
      .from("proyeccion_programacion")
      .select(
        "id, activa, frecuencia, dia_semana, hora_local, zona, exige_datos_frescos, periodo",
      )
      .eq("id", 1)
      .single();
    if (eProg) throw new Error(`No se pudo leer proyeccion_programacion: ${eProg.message}`);
    const prog = progRow as Programacion;
    const zona = prog.zona || "America/Caracas";

    // La programación puede estar pausada: el cron sigue llamando cada 5 minutos,
    // pero no se hace nada hasta que la reactiven en la pantalla.
    if (!prog.activa && !manual) {
      log.push("programación pausada (activa=false): no se ejecuta.");
      return json({ ok: true, ejecutada: false, motivo: "pausada", log });
    }
    if (!manual) {
      const t = await tocaAhora(db, prog, zona);
      log.push(t.motivo);
      if (!t.toca) return json({ ok: true, ejecutada: false, motivo: "fuera_de_horario", log });
    }

    // Periodo: body → mes fijo de la config → mes de trabajo guardado →
    // (respaldo) mes del calendario en Caracas.
    const periodo: string =
      (typeof body.periodo === "string" && body.periodo) ||
      prog.periodo ||
      (await mesDeTrabajo(db)) ||
      periodoCalendario(zona);
    log.push(`periodo de trabajo: ${periodo} (zona ${zona})`);

    // 1. GUARDIA DE SOLAPAMIENTO (CP-56 #6 / R-27.7).
    // Una corrida `en_curso` de hace más de 30 min se da por caída: se cierra
    // como error para que no bloquee para siempre a las siguientes. El bloqueo
    // real es el índice único al abrir el paso `calculo` (más abajo).
    const limiteColgada = new Date(Date.now() - CORRIDA_COLGADA_MS).toISOString();
    await db
      .from("proyeccion_corrida")
      .update({ estado: "error", fin: new Date().toISOString(), mensaje: "quedó en curso más de 30 min; se da por caída." })
      .in("paso", ["calculo", "publicacion"])
      .eq("estado", "en_curso")
      .lt("inicio", limiteColgada);
    const { data: enCurso, error: eCurso } = await db
      .from("proyeccion_corrida")
      .select("id")
      .in("paso", ["calculo", "publicacion"])
      .eq("estado", "en_curso")
      .limit(1);
    if (eCurso) throw new Error(`No se pudo comprobar solapamiento: ${eCurso.message}`);
    if (enCurso && enCurso.length > 0) {
      await omitir(periodo, "la corrida anterior sigue en curso; esta se omite.");
      return json({ ok: true, ejecutada: false, motivo: "solapamiento", periodo, log });
    }

    // 1b. DATOS DE FABRIC: se usan los que Fabric ya escribió en
    // gyp_historico_mensual. Sin filas del mes no se recalcula ni se publica.
    const filasMes = await filasHistoricoDelMes(db, periodo);
    if (filasMes === 0) {
      await omitir(
        periodo,
        `gyp_historico_mensual no tiene datos de ${periodo}: Fabric aún no escribió el mes. Se conserva lo publicado.`,
      );
      return json({ ok: true, ejecutada: false, motivo: "sin_datos", periodo, log });
    }
    log.push(`datos de Fabric en gyp_historico_mensual: ${filasMes} filas de ${periodo}.`);

    // 2. GUARDIA DE DATOS FRESCOS (CP-56 #4 / R-27.6).
    const forzar = body.forzar === true;
    let corteExtraccion: string | null = await corteDeExtraccion(db, periodo);
    if (prog.exige_datos_frescos && !forzar) {
      const f = await datosFrescos(db, periodo, zona);
      if (!f.frescos) {
        await omitir(periodo, `datos viejos: ${f.motivo} Se conserva lo publicado.`, corteExtraccion);
        return json({ ok: true, ejecutada: false, motivo: "datos_viejos", periodo, log });
      }
      log.push(`datos frescos: Fabric escribió hoy; corte ${corteExtraccion ?? "—"}.`);
    } else {
      log.push(
        forzar
          ? "guardia de datos frescos saltada por 'forzar'."
          : "guardia de datos frescos desactivada en la config.",
      );
    }

    // ── PASO 3: RECÁLCULO (CP-56 #2 / R-27.8) ────────────────────────────────
    // Se abre el paso `calculo` en `en_curso`: si otra corrida ya está en curso,
    // el índice único lo rechaza y esta se omite (guardia #1).
    const idCalculo = await abrirCorrida(db, periodo, "calculo", "en_curso", {
      corte: corteExtraccion,
    });
    if (idCalculo === "ocupado") {
      await omitir(periodo, "otra corrida empezó al mismo tiempo; esta se omite.");
      return json({ ok: true, ejecutada: false, motivo: "solapamiento", periodo, log });
    }

    const dimCuenta: string[] | undefined = Array.isArray(body.dimCuenta)
      ? body.dimCuenta.map(String)
      : undefined;

    // El recálculo de los DOS escenarios corre SERVER-SIDE con el mismo motor del
    // navegador (módulo compartido `_shared/motor.ts`, que re-exporta `engine.ts`
    // sin duplicarlo). Así la corrida programada produce EXACTAMENTE las mismas
    // cifras que la publicación manual (CP-56 #2 / R-27.8). Si el llamador ya envía
    // `filas` calculadas (p. ej. un disparo manual con oráculo), se respetan.
    let filas: FilaSalida[] = Array.isArray(body.filas) ? body.filas : [];
    try {
      if (filas.length === 0) {
        const insumos = await cargarInsumos(db, periodo);
        if (insumos.corte && !corteExtraccion) corteExtraccion = insumos.corte;
        filas = construirFilasEscenarios(periodo, insumos) as FilaSalida[];
        if (filas.length === 0) {
          throw new Error("el motor no produjo filas (sin reglas activas para el periodo).");
        }
        log.push(`recálculo server-side ok: ${filas.length} filas de los dos escenarios.`);
      } else {
        log.push(`filas recibidas en el body: ${filas.length} (no se recalcula).`);
      }
    } catch (errCalc) {
      // Datos incompletos o fallo del motor: NO se publica (R-27.8). Se conserva
      // lo ya publicado y se registra el error del paso `calculo`.
      const msg = "recálculo falló: " + String(errCalc instanceof Error ? errCalc.message : errCalc);
      log.push(msg);
      await cerrarCorrida(db, idCalculo, "error", { mensaje: msg, filas: 0 });
      return json(
        { ok: false, ejecutada: false, motivo: "calculo", periodo, log },
        200,
      );
    }
    await cerrarCorrida(db, idCalculo, "ok", { filas: filas.length, corte: corteExtraccion });

    // ── PASO 4: CHECKLIST CP-44 (CP-56 #3 / R-27.5) ──────────────────────────
    // Catálogo para el ítem "Combinada ⊂ dim_cuenta" (si no vino en el body).
    let catalogo: Set<string> | null = null;
    if (dimCuenta) {
      catalogo = new Set(dimCuenta);
    } else {
      const { data: dc } = await db.from("dim_cuenta").select("combinada");
      // Catálogo vacío = aún no cargado por Fabric: no hay contra qué validar.
      if (dc && dc.length) catalogo = new Set(dc.map((r: { combinada: string }) => r.combinada));
    }

    const items = checklistMinimo(filas, periodo, catalogo);
    const fallos = items.filter((i) => i.bloqueante && !i.ok);
    if (fallos.length > 0) {
      const msg =
        "checklist bloqueante (CP-44) falló: " +
        fallos.map((f) => `${f.nombre}${f.detalle ? ` — ${f.detalle}` : ""}`).join("; ");
      log.push(msg);
      // Se registra el intento de publicación como error; NO se publica (R-27.5).
      await abrirCorrida(db, periodo, "publicacion", "error", {
        mensaje: msg,
        corte: corteExtraccion,
      });
      return json(
        { ok: false, ejecutada: false, motivo: "checklist", periodo, fallos, log },
        200,
      );
    }
    log.push(`checklist CP-44 (mínimo): ${items.length} ítems ok.`);

    // ── PASO 5: PUBLICACIÓN (CP-56 #1,#2,#5 / R-27.4) ────────────────────────
    const idPub = await abrirCorrida(db, periodo, "publicacion", "en_curso", {
      corte: corteExtraccion,
    });
    if (idPub === "ocupado") {
      await omitir(periodo, "otra corrida empezó a publicar entre el cálculo y la publicación; esta se omite.");
      return json({ ok: true, ejecutada: false, motivo: "solapamiento", periodo, log });
    }
    const res = await publicar(supabaseUrl, serviceKey, periodo, filas, dimCuenta);
    if (!res.ok) {
      const msg = `publicación falló: ${res.error}`;
      log.push(msg);
      await cerrarCorrida(db, idPub, "error", { mensaje: msg, corte: corteExtraccion });
      return json(
        { ok: false, ejecutada: false, motivo: "publicacion", periodo, detalle: res.cuerpo, log },
        200,
      );
    }
    const totalFilas = Object.values(res.publicado ?? {}).reduce((a, b) => a + b, 0);
    await cerrarCorrida(db, idPub, "ok", { filas: totalFilas, corte: corteExtraccion });
    log.push(`publicación ok: ${JSON.stringify(res.publicado)} filas por escenario.`);

    return json({
      ok: true,
      ejecutada: true,
      periodo,
      corte: corteExtraccion,
      publicado: res.publicado,
      log,
    });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    log.push(`error inesperado: ${msg}`);
    return json({ ok: false, error: msg, log }, 500);
  }
}

/** Respuesta JSON con los headers de CORS. */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// JOB DE pg_cron QUE INVOCA ESTA FUNCIÓN (CP-56, R-27.3)
// ═════════════════════════════════════════════════════════════════════════════
//
// Lo crea supabase/migrations/20261030120000_disparador_mes_trabajo_sello.sql:
// pg_cron corre CADA 5 MINUTOS proyeccion_disparar_corrida(), que abre el tick y
// llama a esta función con la clave de Vault; la función decide si toca
// (frecuencia + hora_local de Caracas). Por eso cambiar el horario en la
// pantalla no exige reprogramar el cron.
// ═════════════════════════════════════════════════════════════════════════════
