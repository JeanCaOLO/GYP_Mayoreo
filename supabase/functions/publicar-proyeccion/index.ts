// supabase/functions/publicar-proyeccion/index.ts
//
// Edge Function de PUBLICACIÓN idempotente transaccional de la Proyección GyP.
//
// Publica los DOS escenarios de la tabla final en `proyeccion_resultado`,
// recorriendo `['PROYECCION','CAUSADO']` (CP-01) y escribiendo cada uno de forma
// idempotente —republicar reemplaza, no acumula— mediante la RPC de Postgres
// `publicar_proyeccion(periodo, escenario, filas)`, que hace DELETE + INSERT en
// una sola transacción del lado servidor (CP-02 / CP-03). PostgREST/supabase-js
// no exponen transacciones multi-statement desde el cliente, por eso la
// atomicidad vive en la función SQL (ver src/pages/proyeccion-gyp/schema.sql
// §4.9 y el espejo supabase/migrations/..._proyeccion_produccion.sql §4.10).
//
// Antes de publicar, por cada escenario:
//   - FILTRA las filas que le corresponden (CP-49): el escenario 1 lleva
//     PROYECCION + AMBOS, el escenario 2 lleva CAUSADO + AMBOS. El cliente puede
//     mandar las filas ya separadas por `proyeccion` (1|2) o adjuntar el campo
//     `escenarios` por fila; aquí se respeta lo que llegue.
//   - FUSIONA por Combinada (CP-06): dos reglas que caen en la misma cuenta
//     salen sumadas en una sola fila, o el índice único ux_proy_resultado
//     (periodo, escenario, combinada) rechaza el insert.
//   - VALIDA contra el catálogo `dim_cuenta` (CP-07): si hay Combinadas
//     huérfanas NO publica NINGÚN escenario y devuelve el listado.
//
// Credenciales fuera del navegador (R-NN-5): usa SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY del entorno con el createClient de servicio.
//
// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO DE ENTRADA (body JSON, POST)
// ─────────────────────────────────────────────────────────────────────────────
//   {
//     "periodo": "2026-10",               // requerido. aaaa-mm o aaaa-mm-dd
//     "filas": FilaSalida[],              // requerido. las filas ya construidas
//                                         //   por el cliente/motor con salida.ts
//                                         //   (aFilaFinal / filasDeRegla), de los
//                                         //   DOS escenarios mezcladas o no.
//     "dimCuenta": string[]               // opcional. Combinadas válidas del
//                                         //   catálogo. Si se omite, la función
//                                         //   las lee de la tabla dim_cuenta.
//     "escenarios": (1|2)[]               // opcional. Qué escenarios escribir.
//                                         //   Default [1, 2]. Con [2] se ANEXA el
//                                         //   causado a v_proyeccion_final sin
//                                         //   tocar el proyectado ya publicado.
//   }
//
// Cada FilaSalida es el objeto de 13 columnas de `FilaResultado` (claves en
// minúscula): periodo, fecha, vista, combinada, pais, empresa, tasa_mensual,
// ajuste, ajuste_usd, monto_local, monto_usd, centro_costo, cuenta_contable,
// proyeccion (1|2). Opcionalmente puede traer `escenarios`
// ('AMBOS'|'PROYECCION'|'CAUSADO') para el filtro CP-49; si no viene, se usa
// `proyeccion` como pertenencia exacta a un escenario.
//
// ─────────────────────────────────────────────────────────────────────────────
// RESPUESTA
// ─────────────────────────────────────────────────────────────────────────────
//   200 { ok: true, periodo, publicado: { "1": nInsertadas, "2": nInsertadas }, aviso? }
//       (solo trae las llaves de los escenarios pedidos)
//   200 { ok: false, motivo: "huerfanas", huerfanas: string[] }   // CP-07
//   400 { ok: false, error }   // body inválido
//   500 { ok: false, error }   // fallo de la RPC u otro
//
// NOTA DE ALCANCE: esta función solo ESCRIBE de forma idempotente los dos
// escenarios con validación y fusión. No calcula el resultado del motor: asume
// que el body trae las filas de salida ya construidas (o las lee de una fuente
// que el llamador le indique). El cálculo vive en el motor del cliente.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del contrato de salida (espejo de FilaResultado de data.ts / salida.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Una fila de la tabla final (las 13 columnas del contrato, claves en minúscula). */
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
  /** 1 = Proyectado al cierre, 2 = Causado al corte. */
  proyeccion: 1 | 2 | number;
  /** Opcional (CP-49): a qué escenarios pertenece la regla de origen. */
  escenarios?: "AMBOS" | "PROYECCION" | "CAUSADO" | string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Escenarios (CP-01 / CP-49)
// ─────────────────────────────────────────────────────────────────────────────

/** El publicador recorre los dos escenarios en orden; `num` va a la columna. */
const ESCENARIOS: Array<{ nombre: "PROYECCION" | "CAUSADO"; num: 1 | 2 }> = [
  { nombre: "PROYECCION", num: 1 }, // Proyectado al cierre
  { nombre: "CAUSADO", num: 2 }, //    Causado al corte
];

/**
 * Filtro por escenario (CP-49). Una fila pertenece al escenario cuando:
 *   - su campo `escenarios` es 'AMBOS' o coincide con el escenario, O
 *   - no trae `escenarios` y su `proyeccion` coincide con el número del escenario.
 * Así una regla `solo causado` nunca aparece con Proyeccion = 1, y una `AMBOS`
 * aparece en los dos sin duplicar reglas (CP-49 ↔ CP-01).
 */
function filasDelEscenario(
  filas: FilaSalida[],
  esc: { nombre: "PROYECCION" | "CAUSADO"; num: 1 | 2 },
): FilaSalida[] {
  return filas.filter((f) => {
    if (f.escenarios != null && f.escenarios !== "") {
      const e = String(f.escenarios).toUpperCase();
      return e === "AMBOS" || e === esc.nombre;
    }
    return Number(f.proyeccion) === esc.num;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fusión por Combinada (CP-06) — espejo puro de salida.ts#fusionarPorCombinada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fusiona las filas que resuelven a la misma Combinada dentro de UN escenario,
 * sumando `monto_usd` y `monto_local` en una sola fila. Las demás columnas se
 * toman de la primera fila del grupo. Se respeta el orden de primera aparición.
 * Debe correr ANTES del insert o el índice único de CP-02 rechaza el lote.
 *
 * (Idéntica en espíritu a src/pages/proyeccion-gyp/salida.ts; se replica aquí
 * porque ese módulo importa código de frontend/Supabase-client que no corre en
 * la Edge Function de Deno.)
 */
function fusionarPorCombinada(filas: FilaSalida[]): FilaSalida[] {
  const grupos = new Map<string, FilaSalida>();
  for (const fila of filas) {
    const clave = `${fila.periodo}\u0000${fila.combinada}`;
    const existente = grupos.get(clave);
    if (existente === undefined) {
      grupos.set(clave, { ...fila });
    } else {
      existente.monto_usd += fila.monto_usd;
      existente.monto_local += fila.monto_local;
    }
  }
  return [...grupos.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación contra catálogo (CP-07) — espejo de salida.ts#validarContraCatalogo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve las Combinadas HUÉRFANAS: presentes en las filas pero ausentes del
 * catálogo `dim_cuenta`, en orden de primera aparición y sin repetir. Una llave
 * huérfana no da error en el insert (la fila desaparece del reporte sin aviso),
 * por eso el publicador se detiene cuando este arreglo no está vacío (CP-07).
 */
function validarContraCatalogo(
  filas: FilaSalida[],
  dimCuenta: Iterable<string>,
): string[] {
  const validas = dimCuenta instanceof Set ? dimCuenta : new Set(dimCuenta);
  const huerfanas: string[] = [];
  const vistas = new Set<string>();
  for (const fila of filas) {
    const combinada = fila.combinada;
    if (!validas.has(combinada) && !vistas.has(combinada)) {
      vistas.add(combinada);
      huerfanas.push(combinada);
    }
  }
  return huerfanas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "Body JSON inválido o vacío." }, 400);
    }

    const periodo: string = body.periodo;
    const filas: FilaSalida[] = Array.isArray(body.filas) ? body.filas : [];

    if (!periodo || typeof periodo !== "string") {
      return json({ ok: false, error: "Falta 'periodo' (aaaa-mm)." }, 400);
    }
    if (filas.length === 0) {
      return json(
        { ok: false, error: "Falta 'filas': no hay nada que publicar." },
        400,
      );
    }

    // Escenarios a escribir: por defecto los dos. Un escenario que no se pide
    // no se toca (su DELETE no corre), así el causado se puede anexar solo.
    const pedidos: number[] = Array.isArray(body.escenarios)
      ? body.escenarios.map(Number)
      : [1, 2];
    const aPublicar = ESCENARIOS.filter((e) => pedidos.includes(e.num));
    if (aPublicar.length === 0) {
      return json({ ok: false, error: "'escenarios' debe incluir 1 y/o 2." }, 400);
    }

    // Catálogo de Combinadas válidas (CP-07): del body o de dim_cuenta. Un
    // catálogo VACÍO (Fabric aún no cargó dim_cuenta) no permite validar: se
    // publica sin el chequeo y se avisa, en vez de marcar todo como huérfano.
    let catalogo: Set<string>;
    if (Array.isArray(body.dimCuenta)) {
      catalogo = new Set<string>(body.dimCuenta.map(String));
    } else {
      const { data, error } = await supabase
        .from("dim_cuenta")
        .select("combinada");
      if (error) throw error;
      catalogo = new Set<string>((data ?? []).map((r: { combinada: string }) => r.combinada));
    }

    // Preparar los dos escenarios ANTES de escribir nada: filtrar (CP-49),
    // fusionar (CP-06) y validar (CP-07). Si cualquier escenario tiene huérfanas,
    // no se publica NINGUNO (la publicación es todo-o-nada a nivel de petición).
    const preparados: Array<{ num: 1 | 2; filas: FilaSalida[] }> = [];
    const huerfanasTotales: string[] = [];
    const vistoHuerfana = new Set<string>();

    for (const esc of aPublicar) {
      const delEscenario = filasDelEscenario(filas, esc);
      // Nunca vaciar un escenario porque el lote no trajo filas suyas: el
      // DELETE de la RPC borraría lo publicado sin reponerlo.
      if (delEscenario.length === 0) {
        return json(
          { ok: false, error: `No llegaron filas del escenario ${esc.num}; no se publicó nada.` },
          400,
        );
      }
      const fusionadas = fusionarPorCombinada(delEscenario);
      const huerfanas = catalogo.size > 0 ? validarContraCatalogo(fusionadas, catalogo) : [];
      for (const h of huerfanas) {
        if (!vistoHuerfana.has(h)) {
          vistoHuerfana.add(h);
          huerfanasTotales.push(h);
        }
      }
      preparados.push({ num: esc.num, filas: fusionadas });
    }

    if (huerfanasTotales.length > 0) {
      // CP-07: detener la publicación y reportar las llaves huérfanas.
      return json({
        ok: false,
        motivo: "huerfanas",
        periodo,
        huerfanas: huerfanasTotales,
        mensaje:
          "Hay Combinadas que no existen en dim_cuenta. No se publicó ningún escenario.",
      });
    }

    // Publicar cada escenario de forma idempotente y atómica vía la RPC.
    const publicado: Record<string, number> = {};
    for (const esc of preparados) {
      const { data, error } = await supabase.rpc("publicar_proyeccion", {
        p_periodo: periodo,
        p_escenario: esc.num,
        p_filas: esc.filas,
      });
      if (error) {
        throw new Error(
          `Fallo al publicar el escenario ${esc.num}: ${error.message}`,
        );
      }
      publicado[String(esc.num)] = typeof data === "number" ? data : esc.filas.length;
    }

    return json({
      ok: true,
      periodo,
      publicado,
      ...(catalogo.size === 0 && {
        aviso: "dim_cuenta está vacía: se publicó sin validar las Combinadas contra el catálogo.",
      }),
    });
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});

/** Respuesta JSON con los headers de CORS. */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
