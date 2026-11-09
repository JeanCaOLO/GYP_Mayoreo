// ============================================================================
// Edge Function: refrescar-proyeccion-fabric
// ----------------------------------------------------------------------------
// Opción A del documento 07: el aplicativo (su backend) consulta Fabric
// DIRECTAMENTE y escribe el resultado en Supabase.
//
// El frontend llama a esta función por HTTPS. La credencial de Fabric (service
// principal de Entra ID) vive aquí, en el servidor, NUNCA en el navegador.
//
//   Frontend  --HTTP-->  esta función  --TDS/1433-->  Fabric (Gold/Silver)
//                              |
//                              +-- escribe -->  Supabase (historia + parámetros)
//
// Alimenta dos tablas (ver src/pages/proyeccion-gyp/schema.sql):
//   gyp_historico_mensual  : acumulado del mes + serie mensual por empresa/concepto
//   proyeccion_parametro   : días hábiles, transcurridos, factor, tasa y corte
//
// SECRETOS (supabase secrets set ...), nunca en el repositorio:
//   FABRIC_SERVER        5nd...datawarehouse.fabric.microsoft.com
//   FABRIC_TENANT_ID     tenant de Entra ID
//   FABRIC_CLIENT_ID     app id del service principal
//   FABRIC_CLIENT_SECRET secret del service principal
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (los inyecta Supabase)
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Driver TDS de SQL Server. El runtime de Supabase soporta imports npm:.
import mssql from "npm:mssql@11.0.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─────────────────────────────────────────────────────────────────────────────
// Dominio (documento 07)
// ─────────────────────────────────────────────────────────────────────────────

const EMP = ["Beval", "Febeca", "Sillaca", "Cofersa", "Mundial", "Prisma"];

const BANDERA: Record<string, string> = {
  Beval: "EsLaboralFE", Febeca: "EsLaboralFE", Sillaca: "EsLaboralFE",
  Prisma: "EsLaboralFE", Cofersa: "EslaboralCR", Mundial: "EslaboralCO",
};

// Factor por defecto. Lo fija control; solo se usa al crear una fila nueva.
const FACTOR_DEFECTO: Record<string, number> = {
  Beval: 1.4, Febeca: 1.32, Sillaca: 1.47, Cofersa: 1.0, Mundial: 1.19, Prisma: 1.0,
};

// Desdoble de Margen (07 §3): Margen-Venta = venta, Margen-Costo = costo.
const SLOT =
  "CASE WHEN c.Dim_SubClasificacion='Margen' THEN 'Margen-'+c.SubGrupo " +
  "ELSE c.Dim_SubClasificacion END";

// D3 · Mismas condiciones y misma suma que `fabric/refrescar_proyeccion_fabric.py`.
//
// Esta funcion escribe en las MISMAS tablas que el script de Fabric, asi que si
// suma distinto, pulsar "Actualizar" pisa los datos buenos con otros peores y
// nadie ve un error: solo cifras que cambian al refrescar. Faltaban tres cosas:
//   - el filtro de vista: sin el entran filas que no son del GyP
//   - la exclusion de 9.5.*: cuentas de cierre que no van en la proyeccion
//   - COALESCE en LAS DOS patas de la suma (CP-08): sin el, una fila con
//     Monto_USD nulo desaparecia sin avisar
const COND_GYP = "g.Vista = 'GYP'";
const COND_NO_95 = "g.CUENTA_CONTABLE NOT LIKE '9.5.%'";
const SUMA_USD = "SUM(COALESCE(g.Monto_USD,0) + COALESCE(g.Ajuste_USD,0))";

const CONCEPTO: Record<string, string> = {
  "Margen-Venta": "Ventas", "Margen-Costo": "Costo de Ventas",
  "Colocación": "Colocacion", "Ingresos Mercantiles": "Ingresos Mercantiles",
  "Fletes Recuperados": "Fletes Recuperados", "Merma": "Merma",
  "Personal": "Personal Fijo", "Gastos Varios": "Gastos Varios",
  "Alquileres": "Alquileres", "Cargo Fijo": "Cargo Fijo", "Tributos": "Tributos",
  "Incobrables": "Incobrables", "Fletes": "Fletes", "Logístico": "Logistico",
  "IVA Atrapado": "IVA Atrapado", "Otros egresos": "Otros egresos",
  "Intereses": "Intereses", "Depreciación": "Depreciacion", "ISLR": "ISLR",
};

const ES_VENTA = new Set(["Ventas", "Colocacion"]);

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Token de Entra ID para el service principal (OAuth2 client credentials)
// ─────────────────────────────────────────────────────────────────────────────

async function tokenFabric(): Promise<string> {
  const tenant = (Deno.env.get("FABRIC_TENANT_ID") ?? "").trim();
  const body = new URLSearchParams({
    client_id: (Deno.env.get("FABRIC_CLIENT_ID") ?? "").trim(),
    client_secret: (Deno.env.get("FABRIC_CLIENT_SECRET") ?? "").trim(),
    grant_type: "client_credentials",
    // Scope correcto para el endpoint SQL de Fabric (07 §2).
    scope: "https://database.windows.net/.default",
  });
  const resp = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
  );
  if (!resp.ok) {
    throw new Error(`Entra ID token falló: ${resp.status} ${await resp.text()}`);
  }
  const j = await resp.json();
  return j.access_token as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conexión a Fabric por TDS, autenticando con el token
// ─────────────────────────────────────────────────────────────────────────────

async function conectar(database: string, token: string) {
  // trim(): protege contra saltos de línea o espacios que se cuelan al pegar
  // el valor en el secreto (getaddrinfo ENOTFOUND si el host trae un '\n').
  const server = (Deno.env.get("FABRIC_SERVER") ?? "").trim();
  const pool = new mssql.ConnectionPool({
    server,
    port: 1433,
    database,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token },
    },
  });
  await pool.connect();
  return pool;
}

type Fila = Record<string, unknown>;

async function consultar(pool: unknown, sql: string): Promise<Fila[]> {
  // deno-lint-ignore no-explicit-any
  const r = await (pool as any).request().query(sql);
  return r.recordset as Fila[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const log: string[] = [];
  let goldPool: unknown = null;
  let silverPool: unknown = null;

  try {
    const body = await req.json().catch(() => ({}));
    const hoy = new Date();
    const periodo: string =
      body.periodo ||
      `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, "0")}`;
    const umbral: number = body.umbral ?? 0.25;

    const anio = parseInt(periodo.slice(0, 4), 10);
    const mes = parseInt(periodo.slice(5, 7), 10);
    const p2 = (n: number) => String(n).padStart(2, "0");
    const ini = `${anio}-${p2(mes)}-01`;
    const fin = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${p2(mes + 1)}-01`;
    // D3: 12 meses hacia atras, como el script de Fabric. Antes arrancaba en
    // enero, asi que en enero la serie quedaba vacia y en febrero tenia un solo
    // mes: los metodos de historia (mediana, promedio) estimaban sobre nada.
    const dSerie = new Date(Date.UTC(anio, mes - 1 - 12, 1));
    const serieIni = `${dSerie.getUTCFullYear()}-${p2(dSerie.getUTCMonth() + 1)}-01`;
    log.push(`Periodo ${periodo} (${ini} a ${fin})`);

    // ── Fabric ──
    const token = await tokenFabric();
    goldPool = await conectar("Gold", token);
    silverPool = await conectar("Silver", token);

    // 1. Acumulado del mes
    const acum = new Map<string, number>();
    for (const f of await consultar(goldPool, `
      SELECT c.Empresa AS emp, ${SLOT} AS slot,
             ${SUMA_USD} AS usd
      FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
      JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
      WHERE g.FECHA >= '${ini}' AND g.FECHA < '${fin}'
        AND ${COND_GYP} AND ${COND_NO_95}
      GROUP BY c.Empresa, ${SLOT}`)) {
      const con = CONCEPTO[String(f.slot)];
      if (con) acum.set(`${f.emp}|${con}`, Math.round(num(f.usd) * 100) / 100);
    }
    log.push(`acumulado del mes: ${acum.size} conceptos`);

    // 2. Serie mensual del año
    const serie = new Map<string, Map<string, number>>();
    for (const f of await consultar(goldPool, `
      SELECT c.Empresa AS emp, ${SLOT} AS slot, FORMAT(g.FECHA,'yyyy-MM') AS mes,
             ${SUMA_USD} AS usd
      FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
      JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
      WHERE c.Empresa IN ('Beval','Febeca','Sillaca','Cofersa','Mundial','Prisma')
        AND g.FECHA >= '${serieIni}' AND g.FECHA < '${ini}'
        AND ${COND_GYP} AND ${COND_NO_95}
      GROUP BY c.Empresa, ${SLOT}, FORMAT(g.FECHA,'yyyy-MM')`)) {
      const con = CONCEPTO[String(f.slot)];
      if (!con) continue;
      const k = `${f.emp}|${con}`;
      if (!serie.has(k)) serie.set(k, new Map());
      serie.get(k)!.set(String(f.mes), Math.round(num(f.usd) * 100) / 100);
    }
    const meses: string[] = [];
    for (let k = 12; k >= 1; k--) {
      const d = new Date(Date.UTC(anio, mes - 1 - k, 1));
      meses.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`);
    }
    log.push(`serie histórica: ${meses.length} meses, ${serie.size} conceptos`);

    // 3. El corte (07 §4): último día con volumen >= umbral*mediana, contra Silver.
    const diasVol = await consultar(silverPool, `
      SELECT CONVERT(varchar(10), FECHA, 23) AS f, COUNT(*) AS n
      FROM Silver.dbo.slv_mayor_mayoreo_consolidado_v2
      WHERE FECHA >= '${ini}' AND FECHA < '${fin}'
      GROUP BY FECHA ORDER BY FECHA`);
    const pares = diasVol
      .map((x) => ({ f: String(x.f), n: num(x.n) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => (a.f < b.f ? -1 : 1));
    let corte = ini;
    if (pares.length) {
      const vols = pares.map((x) => x.n).sort((a, b) => a - b);
      const tipico = vols[Math.floor(vols.length / 2)];
      const minimo = tipico * umbral;
      const completos = pares.filter((x) => x.n >= minimo).map((x) => x.f);
      if (completos.length) corte = completos[completos.length - 1];
      const flojos = pares.filter((x) => x.n < minimo && x.f > corte);
      log.push(`día típico: ${tipico} filas; mínimo ${Math.round(minimo)} (${umbral * 100}%)`);
      if (flojos.length) {
        log.push("se descartan: " + flojos.map((x) => `${x.f} (${x.n})`).join(", "));
      }
    }
    log.push(`datos completos hasta: ${corte}`);

    // 4. Días hábiles del mes y transcurridos (DISTINCT obligatorio, 07 §3.4)
    const dias: Record<string, { mes: number; trans: number }> = {};
    for (const emp of EMP) {
      const b = BANDERA[emp];
      const r = (await consultar(goldPool, `
        SELECT COUNT(DISTINCT CASE WHEN ${b}=1 THEN Date END) AS mes,
               COUNT(DISTINCT CASE WHEN ${b}=1 AND Date <= '${corte}' THEN Date END) AS trans
        FROM Gold.SIM.rolling WHERE Date >= '${ini}' AND Date < '${fin}'`))[0];
      dias[emp] = { mes: num(r?.mes), trans: num(r?.trans) };
    }
    log.push("días: " + EMP.map((e) => `${e} ${dias[e].trans}/${dias[e].mes}`).join(", "));

    // 5. Tasa del mes (07 §3.5)
    const tasa: Record<string, number> = {};
    for (const f of await consultar(goldPool, `
      SELECT c.Empresa AS emp,
             MAX(g.Tasa_Mensual) AS declarada,
             SUM(g.Monto_Local + ISNULL(g.Ajuste,0))
               / NULLIF(SUM(g.Monto_USD + ISNULL(g.Ajuste_USD,0)),0) AS implicita
      FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
      JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
      WHERE c.SubGrupo = 'Venta' AND g.FECHA >= '${ini}' AND g.FECHA < '${fin}'
      GROUP BY c.Empresa`)) {
      tasa[String(f.emp)] =
        Math.round((num(f.declarada) || num(f.implicita)) * 10000) / 10000;
    }
    const ve = ["Beval", "Febeca", "Sillaca"].map((e) => tasa[e]).filter(Boolean);
    if (ve.length && !tasa["Prisma"]) {
      tasa["Prisma"] = Math.round((ve.reduce((a, b) => a + b, 0) / ve.length) * 10000) / 10000;
    }
    log.push("tasas: " + EMP.map((e) => `${e} ${(tasa[e] || 0).toFixed(2)}`).join(", "));

    // ── Guardas antes de escribir (07 §7) ──
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const errores: string[] = [];
    if (EMP.every((e) => dias[e].trans < 1))
      errores.push("ningún día transcurrido tiene datos completos (trans=0).");
    if (acum.size === 0 && serie.size === 0)
      errores.push("la extracción no devolvió ningún concepto.");
    // Guarda 2 (la que más duele): el corte debe avanzar respecto al publicado.
    const { data: prevRows } = await supabase
      .from("proyeccion_parametro")
      .select("corte")
      .eq("periodo", periodo)
      .not("corte", "is", null)
      .limit(1);
    const prev = prevRows?.[0]?.corte as string | undefined;
    if (prev && corte <= prev)
      errores.push(`el corte NO avanzó (publicado ${prev}, nuevo ${corte}).`);

    if (errores.length) {
      return new Response(
        JSON.stringify({ ok: false, escrito: false, errores, log }, null, 2),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Escritura a Supabase. Primero los datos, después el sello (07 §6). ──
    const hist: Record<string, unknown>[] = [];
    const todas = new Set<string>([...acum.keys(), ...serie.keys()]);
    for (const k of todas) {
      const [emp, con] = k.split("|");
      const esV = ES_VENTA.has(con);
      hist.push({
        periodo, empresa: emp, concepto: con,
        dim_subclasificacion: con, subgrupo: "",
        monto_usd: acum.get(k) ?? 0, es_venta: esV,
      });
      for (const [m, v] of serie.get(k) ?? []) {
        hist.push({
          periodo: m, empresa: emp, concepto: con,
          dim_subclasificacion: con, subgrupo: "",
          monto_usd: v, es_venta: esV,
        });
      }
    }
    for (let i = 0; i < hist.length; i += 500) {
      const { error } = await supabase
        .from("gyp_historico_mensual")
        .upsert(hist.slice(i, i + 500), {
          onConflict: "periodo,empresa,dim_subclasificacion,subgrupo",
        });
      if (error) throw new Error("gyp_historico_mensual: " + error.message);
    }
    log.push(`escritas ${hist.length} filas en gyp_historico_mensual`);

    // Parámetros: insertar la fila con factor por defecto solo si no existe,
    // y luego actualizar días/tasa/corte sin pisar el factor que fijó control.
    const semilla = EMP.map((e) => ({
      periodo, empresa: e,
      dias_habiles_mes: dias[e].mes, dias_transcurridos: dias[e].trans,
      tasa_local: tasa[e] ?? 0, corte, factor_correccion: FACTOR_DEFECTO[e],
    }));
    await supabase
      .from("proyeccion_parametro")
      .upsert(semilla, { onConflict: "periodo,empresa", ignoreDuplicates: true });
    for (const e of EMP) {
      const { error } = await supabase
        .from("proyeccion_parametro")
        .update({
          dias_habiles_mes: dias[e].mes, dias_transcurridos: dias[e].trans,
          tasa_local: tasa[e] ?? 0, corte, updated_at: new Date().toISOString(),
        })
        .eq("periodo", periodo)
        .eq("empresa", e);
      if (error) throw new Error("proyeccion_parametro: " + error.message);
    }
    log.push(`actualizadas ${EMP.length} filas en proyeccion_parametro (factor intacto)`);

    return new Response(
      JSON.stringify({
        ok: true, escrito: true, periodo, corte,
        generado: new Date().toISOString(),
        conceptos: todas.size, filas_historia: hist.length, log,
      }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, escrito: false, error: (err as Error).message, log }, null, 2),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } finally {
    // deno-lint-ignore no-explicit-any
    try { await (goldPool as any)?.close?.(); } catch { /* noop */ }
    // deno-lint-ignore no-explicit-any
    try { await (silverPool as any)?.close?.(); } catch { /* noop */ }
  }
});
