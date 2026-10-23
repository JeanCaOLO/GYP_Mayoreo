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
//      exige_datos_frescos, periodo (null = mes de trabajo vigente).
//   1. GUARDIA DE SOLAPAMIENTO (CP-56 #6 / R-27.7): si hay una corrida `en_curso`
//      para el periodo, la nueva se marca `omitida` y termina.
//   2. GUARDIA DE DATOS FRESCOS (CP-56 #4 / R-27.6): si `exige_datos_frescos` y la
//      extracción del mes no es del día —o su `corte` no avanzó desde la última
//      publicación—, la corrida se marca `omitida`, avisa y CONSERVA lo publicado.
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
//      `origen='programada'`.
//
// ─────────────────────────────────────────────────────────────────────────────
// NOTA DE ALCANCE — dónde vive el motor
// ─────────────────────────────────────────────────────────────────────────────
// El motor de cálculo (`src/pages/proyeccion-gyp/engine.ts`) es TypeScript del
// FRONTEND: importa el cliente de Supabase y utilidades de navegador, y no corre
// tal cual en el runtime Deno de una Edge Function. Por eso esta corrida NO
// reimplementa el motor. El RECÁLCULO de los dos escenarios se resuelve de una de
// estas dos formas, en este orden de preferencia:
//
//   (a) El llamador (otra pieza de servidor, o un paso previo del cron que sí
//       tenga el motor portado) envía en el body `filas: FilaSalida[]` ya
//       calculadas; esta función las publica.
//   (b) Si no llegan filas, el recálculo server-side queda como TODO explícito:
//       portar el motor a un módulo compartido Deno/navegador (sin dependencias
//       de cliente) y llamarlo aquí. Mientras tanto, el paso `calculo` se marca
//       `error` con un mensaje claro y la publicación NO corre.
//
// El núcleo de CP-56 que esta función SÍ implementa por completo: las guardias
// (solapamiento + datos frescos), la bitácora por pasos, la hora de Caracas y la
// delegación idempotente de la publicación.
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
//     "forzar":   false             // opcional. Si true, salta el guardia de
//                                   //   datos frescos aun con exige_datos_frescos.
//   }
//
// Credenciales fuera del navegador (R-NN-5): SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY del entorno con el createClient de servicio.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

type Paso = "calculo" | "publicacion";
type EstadoCorrida = "en_curso" | "ok" | "error" | "omitida";

/**
 * Inserta una fila de bitácora y devuelve su id, para luego cerrarla con
 * `cerrarCorrida`. `origen` es siempre 'programada' en esta función.
 */
async function abrirCorrida(
  db: SupabaseClient,
  periodo: string,
  paso: Paso,
  estado: EstadoCorrida,
  extra: Partial<{ mensaje: string; filas: number; corte: string | null }> = {},
): Promise<number | null> {
  const { data, error } = await db
    .from("proyeccion_corrida")
    .insert({
      periodo,
      origen: "programada",
      paso,
      estado,
      filas: extra.filas ?? null,
      corte: extra.corte ?? null,
      mensaje: extra.mensaje ?? null,
      lanzada_por: "pg_cron",
      // `inicio` lo pone el default now(); si el estado ya es terminal, cerramos fin.
      fin: estado === "en_curso" ? null : new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
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
// Periodo vigente (mes de trabajo) en hora de Caracas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve 'aaaa-mm' del mes vigente EN LA ZONA de la config (Caracas por
 * defecto). La zona viaja con el dato: se usa Intl para proyectar "ahora" a la
 * zona, en vez de restar −4 a mano (R-27.2). Así el mes de trabajo cambia a la
 * medianoche de Caracas, no a la de UTC.
 */
function periodoVigente(zona: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
  });
  // en-CA da 'aaaa-mm'; nos quedamos con los primeros 7 caracteres.
  const partes = fmt.format(new Date()); // p.ej. "2026-10"
  return partes.slice(0, 7);
}

/** 'aaaa-mm-dd' de hoy en la zona dada (para el guardia de datos frescos). */
function hoyEnZona(zona: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // "2026-10-22"
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardia de datos frescos (CP-56 #4 / R-27.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determina si los datos del mes están "frescos" para publicar. Lee el `corte`
 * de la extracción en `proyeccion_parametro` y el `corte` de la última
 * publicación registrada en `proyeccion_corrida`.
 *
 * Son VIEJOS (no se debe publicar) cuando:
 *   - no hay `corte` de extracción para el periodo, o
 *   - el `corte` de la extracción NO avanzó respecto al de la última publicación.
 *
 * (La condición "la extracción no es del día" se interpreta aquí como que el
 * corte no haya avanzado desde la última publicación; el sello de "última
 * extracción" lo escribe Fabric en `proyeccion_parametro` y se muestra en
 * pantalla —R-27.9—, pero la señal operativa dura es el avance del corte, igual
 * que en refrescar-proyeccion-fabric.)
 */
async function datosFrescos(
  db: SupabaseClient,
  periodo: string,
): Promise<{ frescos: boolean; corteExtraccion: string | null; motivo?: string }> {
  // Corte de la extracción del mes (lo escribe Fabric; puede haber uno por empresa,
  // tomamos el más avanzado).
  const { data: params, error: eParam } = await db
    .from("proyeccion_parametro")
    .select("corte")
    .eq("periodo", periodo)
    .not("corte", "is", null);
  if (eParam) throw eParam;

  const cortes = (params ?? [])
    .map((r: { corte: string | null }) => r.corte)
    .filter((c): c is string => !!c)
    .sort();
  const corteExtraccion = cortes.length ? cortes[cortes.length - 1] : null;

  if (!corteExtraccion) {
    return {
      frescos: false,
      corteExtraccion: null,
      motivo: "la extracción del mes no tiene corte (Fabric no ha escrito datos).",
    };
  }

  // Corte de la última PUBLICACIÓN ok registrada en la bitácora.
  const { data: ultima, error: eCorr } = await db
    .from("proyeccion_corrida")
    .select("corte")
    .eq("periodo", periodo)
    .eq("paso", "publicacion")
    .eq("estado", "ok")
    .order("inicio", { ascending: false })
    .limit(1);
  if (eCorr) throw eCorr;

  const cortePublicado = (ultima?.[0]?.corte as string | null) ?? null;

  if (cortePublicado && corteExtraccion <= cortePublicado) {
    return {
      frescos: false,
      corteExtraccion,
      motivo: `el corte no avanzó desde la última publicación (publicado ${cortePublicado}, extracción ${corteExtraccion}).`,
    };
  }

  return { frescos: true, corteExtraccion };
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
      ? `${tasaMala.length} fila(s) con Tasa_Mensual en la empresa equivocada.`
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

  const log: string[] = [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

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

    // La programación puede estar pausada; el cron no debería ni llamar, pero si
    // lo hace (p.ej. el job quedó activo), respetamos el estado y no hacemos nada.
    if (!prog.activa) {
      log.push("programación pausada (activa=false): no se ejecuta.");
      return json({ ok: true, ejecutada: false, motivo: "pausada", log });
    }

    // Periodo: body → config → mes vigente en Caracas.
    const periodo: string =
      (typeof body.periodo === "string" && body.periodo) ||
      prog.periodo ||
      periodoVigente(zona);
    log.push(`periodo de trabajo: ${periodo} (zona ${zona})`);

    // 1. GUARDIA DE SOLAPAMIENTO (CP-56 #6 / R-27.7).
    const { data: enCurso, error: eCurso } = await db
      .from("proyeccion_corrida")
      .select("id, paso, inicio")
      .eq("periodo", periodo)
      .eq("estado", "en_curso")
      .limit(1);
    if (eCurso) throw new Error(`No se pudo comprobar solapamiento: ${eCurso.message}`);
    if (enCurso && enCurso.length > 0) {
      const msg = "la corrida anterior sigue en curso; esta se omite.";
      log.push(msg);
      await abrirCorrida(db, periodo, "calculo", "omitida", { mensaje: msg });
      return json({ ok: true, ejecutada: false, motivo: "solapamiento", periodo, log });
    }

    // 2. GUARDIA DE DATOS FRESCOS (CP-56 #4 / R-27.6).
    const forzar = body.forzar === true;
    let corteExtraccion: string | null = null;
    if (prog.exige_datos_frescos && !forzar) {
      const f = await datosFrescos(db, periodo);
      corteExtraccion = f.corteExtraccion;
      if (!f.frescos) {
        const msg = `datos viejos: ${f.motivo} Se conserva lo publicado.`;
        log.push(msg);
        await abrirCorrida(db, periodo, "calculo", "omitida", {
          mensaje: msg,
          corte: f.corteExtraccion,
        });
        return json({ ok: true, ejecutada: false, motivo: "datos_viejos", periodo, log });
      }
      log.push(`datos frescos: corte de extracción ${corteExtraccion}.`);
    } else {
      log.push(
        forzar
          ? "guardia de datos frescos saltada por 'forzar'."
          : "guardia de datos frescos desactivada en la config.",
      );
      // Aun sin exigirlo, registramos el corte si lo hay para la bitácora.
      const { data: params } = await db
        .from("proyeccion_parametro")
        .select("corte")
        .eq("periodo", periodo)
        .not("corte", "is", null);
      const cortes = (params ?? [])
        .map((r: { corte: string | null }) => r.corte)
        .filter((c): c is string => !!c)
        .sort();
      corteExtraccion = cortes.length ? cortes[cortes.length - 1] : null;
    }

    // ── PASO 3: RECÁLCULO (CP-56 #2 / R-27.8) ────────────────────────────────
    // Se abre el paso `calculo` en `en_curso` para que un segundo disparo lo vea
    // como solapamiento (guardia #1), y se cierra al terminar.
    const idCalculo = await abrirCorrida(db, periodo, "calculo", "en_curso", {
      corte: corteExtraccion,
    });

    const filas: FilaSalida[] = Array.isArray(body.filas) ? body.filas : [];
    const dimCuenta: string[] | undefined = Array.isArray(body.dimCuenta)
      ? body.dimCuenta.map(String)
      : undefined;

    if (filas.length === 0) {
      // Caso (b) de la NOTA DE ALCANCE: el motor vive en el cliente y no se
      // recibieron filas calculadas. El recálculo server-side exige portar el
      // motor a un módulo compartido Deno/navegador. Se marca el paso `calculo`
      // en error y NO se publica (R-27.8: la publicación no corre si el cálculo
      // no terminó).
      const msg =
        "recálculo server-side no disponible: el motor (engine.ts) vive en el " +
        "cliente. Enviar 'filas' ya calculadas en el body, o portar el motor a un " +
        "módulo compartido Deno/navegador (TODO tarea de porte). No se publica.";
      log.push(msg);
      await cerrarCorrida(db, idCalculo, "error", { mensaje: msg, filas: 0 });
      return json(
        { ok: false, ejecutada: false, motivo: "sin_motor_server", periodo, log },
        200,
      );
    }
    await cerrarCorrida(db, idCalculo, "ok", { filas: filas.length, corte: corteExtraccion });
    log.push(`recálculo ok: ${filas.length} filas de los dos escenarios.`);

    // ── PASO 4: CHECKLIST CP-44 (CP-56 #3 / R-27.5) ──────────────────────────
    // Catálogo para el ítem "Combinada ⊂ dim_cuenta" (si no vino en el body).
    let catalogo: Set<string> | null = null;
    if (dimCuenta) {
      catalogo = new Set(dimCuenta);
    } else {
      const { data: dc } = await db.from("dim_cuenta").select("combinada");
      if (dc) catalogo = new Set(dc.map((r: { combinada: string }) => r.combinada));
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
});

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
// La corrida la dispara pg_cron DEL LADO DEL SERVIDOR, nunca el navegador. pg_cron
// trabaja en UTC, así que la `hora_local` (en Caracas) se convierte a UTC al
// definir el job. La zona viaja con el dato; la conversión la hace el backend al
// programar, NUNCA se escribe un −4 a mano en el código.
//
//   Caracas = UTC−04:00, sin horario de verano.  →  06:45 Caracas = 10:45 UTC.
//
// Requiere las extensiones `pg_cron` y `pg_net` (ambas disponibles en Supabase):
//
//   create extension if not exists pg_cron;
//   create extension if not exists pg_net;
//
// Ejemplo: publicar todos los días a las 06:45 de Caracas (= 10:45 UTC).
// El cron de abajo usa minuto=45 hora=10 (UTC). Si la config cambia de hora, se
// recrea el job con la nueva hora convertida a UTC (ver la función de ayuda).
//
//   select cron.schedule(
//     'corrida-programada-gyp',           -- nombre del job
//     '45 10 * * *',                      -- 10:45 UTC = 06:45 America/Caracas
//     $$
//       select net.http_post(
//         url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/corrida-programada',
//         headers := jsonb_build_object(
//                      'Content-Type',  'application/json',
//                      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
//                    ),
//         body    := '{}'::jsonb           -- periodo lo resuelve la función (mes vigente)
//       );
//     $$
//   );
//
// NOTA sobre la credencial: en Supabase se suele guardar el service_role_key en
// `vault` o en un GUC (`app.service_role_key`) en lugar de incrustarlo en el SQL
// (R-NN-5). Ajustar el header a como esté guardado el secreto en el proyecto.
//
// ── Conversión Caracas → UTC al (re)crear el job ────────────────────────────
// Si se quiere derivar el patrón de cron desde `proyeccion_programacion` en vez de
// escribirlo a mano, Postgres convierte la zona por nosotros (sin −4 literal):
//
//   -- Devuelve 'mm hh * * *' en UTC a partir de hora_local + zona de la config.
//   with cfg as (
//     select hora_local, zona from proyeccion_programacion where id = 1
//   ),
//   utc as (
//     select ( (current_date + hora_local) at time zone zona  -- interpreta en Caracas
//                                          at time zone 'UTC'  -- lleva a UTC
//            )::time as h
//     from cfg
//   )
//   select to_char(h, 'MI HH24') || ' * * *' from utc;   -- p.ej. '45 10 * * *'
//
// La frecuencia (diaria | habiles | semanal + dia_semana) también se traduce al
// patrón de cron:
//   - diaria   : 'MI HH * * *'
//   - semanal  : 'MI HH * * D'      (D = dia_semana, 0/7=domingo … 6=sábado)
//   - habiles  : 'MI HH * * 1-5'    (lun–vie; los feriados de Venezuela los filtra
//                                     la propia función si hiciera falta)
//
// Para reprogramar tras un cambio en la UI: cron.unschedule('corrida-programada-gyp')
// y volver a cron.schedule con el nuevo patrón UTC.
// ═════════════════════════════════════════════════════════════════════════════
