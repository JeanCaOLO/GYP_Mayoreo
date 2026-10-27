import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
/**
* Lleva al causado el resultado proyectado de una regla según su `modo` (§E).
*
* Función pura: mismos argumentos → mismo resultado. No lanza; ante datos del
* corte ausentes o inconsistentes cae a comportamiento seguro (ver abajo).
*
* @param resultadoProyectado  Monto proyectado al cierre de la regla (USD).
* @param modo                 Modo de causado declarado por la regla.
* @param params               Parámetros de la empresa (trans y dias hábiles).
* @param opts                 Datos del corte que cada modo pueda necesitar.
* @returns                    El monto causado al corte (USD).
*
* Comportamiento ante datos faltantes (no rompe los 190 casos ni la publicación):
*   - Venta/derivada → devuelve el proyectado sin tocar (§E, Requirement 13.3).
*   - `habiles`  con `dias` ≤ 0 → sin prorrateo posible: devuelve el proyectado.
*   - `calendario` con `diasDelMes` ≤ 0 → devuelve el proyectado.
*   - `calendario` sin `diaDelCorte` → usa los transcurridos como respaldo.
*   - `real` sin `asentadoAlCorte` → 0 (al corte no hay nada asentado aún).
*/
function llevarACausado(resultadoProyectado, modo, params, opts = {}) {
	if (opts.esVentaODerivada) return resultadoProyectado;
	switch (modo) {
		case "igual": return resultadoProyectado;
		case "habiles": {
			const dias = params.dias;
			const trans = params.trans;
			if (!(dias > 0)) return resultadoProyectado;
			return resultadoProyectado * trans / dias;
		}
		case "calendario": {
			const diasDelMes = opts.diasDelMes;
			if (!(typeof diasDelMes === "number" && diasDelMes > 0)) return resultadoProyectado;
			return resultadoProyectado * (typeof opts.diaDelCorte === "number" ? opts.diaDelCorte : params.trans) / diasDelMes;
		}
		case "real": return opts.asentadoAlCorte ?? 0;
		default: return resultadoProyectado;
	}
}
//#endregion
//#region src/pages/proyeccion-gyp/engine.ts
/**
* Motor de cálculo de la Proyección del GyP Mayoreo — v2.
*
* Es una función PURA: mismos datos de entrada → mismo resultado. Está separada
* de la interfaz para poder probarse sola contra las cifras de aceptación.
*
* ── Modelo v2 (CP-18, Parte II §D del paquete 12-cambios-para-produccion) ──
* Un método es una secuencia de `pasos`: fold de izquierda a derecha, sin
* precedencia ni paréntesis. El primer paso parte de su base; cada siguiente
* opera sobre el resultado del anterior.
*
* Operaciones: formula_venta, promedio, mediana, ultimo, ratio_venta,
* porcentaje, presupuesto, valor_fijo, multiplicar, sumar, restar, componentes,
* derivada.
*
* TRAMPA CRÍTICA CP-18: el `valor` de la regla sobrescribe el del paso SOLO en
* métodos de un único paso. Con varios pasos NO se propaga a todos.
*
* ── Retrocompatibilidad ──
* El tipo `Metodo` v1 (op/base/valor/invertir/orden) se conserva: la interfaz y
* la capa de datos siguen trabajando con él. Internamente `calcular()` expresa
* cada `Metodo` v1 como un `MetodoV2` de un solo paso equivalente a las 8
* operaciones v1 y evalúa con el fold de pasos. La aritmética coincide AL
* CÉNTIMO con el motor v1 (ver seed.ts → CIFRAS_VALIDADAS y engine.test.ts).
*
* Las reglas de agregación, signos y turnos están en la Parte II §A, §B, §C.
* No cambiar la aritmética sin volver a correr la prueba de los 190 casos.
*/
/** País derivado de la empresa (el catálogo no es confiable). */
const PAIS = {
	Beval: "Venezuela",
	Sillaca: "Venezuela",
	Febeca: "Venezuela",
	Prisma: "Venezuela",
	Cofersa: "Costa Rica",
	Mundial: "Colombia"
};
/** Deja en la serie solo los meses CON registro (ni null ni NaN). Trampa 2. */
function conRegistro(serie) {
	return serie.filter((x) => x !== null && x !== void 0 && !Number.isNaN(x));
}
/**
* Promedio de los últimos n meses de una serie, contando SOLO los meses con
* registro. Un mes sin movimiento (null) no cuenta como cero (trampa 2).
*/
function prom(serie, n) {
	const a = conRegistro(serie.slice(-n));
	return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
/**
* Mediana de los últimos n meses de una serie, solo meses con registro (§D).
* Con cantidad par promedia los dos centrales. Sin registros → 0.
*/
function mediana(serie, n) {
	const a = conRegistro(serie.slice(-n)).sort((x, y) => x - y);
	if (!a.length) return 0;
	const m = Math.floor(a.length / 2);
	return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
/** Último mes CON registro de la serie (§D: `m_ultimo`). Sin registros → 0. */
function ultimo(serie) {
	const a = conRegistro(serie);
	return a.length ? a[a.length - 1] : 0;
}
/** Suma de los últimos n meses con registro (base para `ratio_venta`). */
function sumaN(serie, n) {
	return conRegistro(serie.slice(-n)).reduce((x, y) => x + y, 0);
}
/**
* Fórmula de venta del §B (`m_venta`). Replica AL CÉNTIMO la especificación de
* referencia; no cambiar sin volver a correr el oráculo de los 190 casos.
*
*   ritmo      = acumulado ÷ días transcurridos
*   restantes  = días hábiles del mes − transcurridos
*   Proyección = acumulado
*              + ritmo × max(restantes − 5, 0)        (días normales)
*              + ritmo × factor × min(restantes, 5)   (últimos 5 días hábiles)
*   Causado    = acumulado                            (lo resuelve el escenario, 5.3)
*
* - El `factor` multiplica el ritmo de los últimos 5 días hábiles (cierre de
*   mes) y es editable por empresa y por mes (viene en `Parametro.factor`).
* - Si no hay acumulado, usa el promedio histórico (respaldo).
* - `min(restantes, 5)` es un tope OBLIGATORIO: con menos de 5 días hábiles
*   evita que `max(restantes − 5, 0)` quede negativo (de ahí el `max(…, 0)`) y
*   que el último tramo del mes dé resultados absurdos.
*
* Días hábiles (§B): Venezuela trabaja sábados; el resto, lunes a viernes. Ese
* conteo NO vive en el motor: `q.dias` (hábiles del mes) y `q.trans`
* (transcurridos) llegan ya calculados desde la extracción de Fabric, y solo se
* ajustan a mano si hace falta. El motor los consume tal cual.
*
* Nota (§E): el causado NO aplica a esta fórmula —ya usa el acumulado—; el
* escenario Causado toma directamente `acumulado` (ver 5.3).
*/
function formulaVenta(acum, serie, q, n) {
	if (!acum) return prom(serie, n);
	const rest = q.dias - q.trans;
	const ritmo = q.trans ? acum / q.trans : 0;
	return acum + (rest - 5 > 0 ? ritmo * (rest - 5) : 0) + Math.min(rest, 5) * ritmo * q.factor;
}
/** Convierte una Base v1 plana en una BaseCapas v2 por referencia directa. */
function baseV1aV2(b) {
	if (typeof b === "string" && b.indexOf("c:") === 0) return {
		origen: "otra_regla",
		ref: b
	};
	return {
		origen: "real",
		ref: b
	};
}
/**
* Expresa un `Metodo` v1 como un `MetodoV2` de un solo paso equivalente.
*
* Las 8 operaciones v1 se mapean 1:1 a operaciones de paso. El causado por
* defecto se deja en 'igual' (la v1 no lo modelaba; el motor v1 solo calculaba
* el escenario proyectado). Esto es el puente que mantiene la aritmética idéntica.
*/
function metodoV1aV2(m) {
	return {
		id: m.id,
		nombre: m.nombre,
		orden: m.orden,
		causadoDefault: "igual",
		deFabrica: m.fijo,
		pasos: [{
			op: m.op,
			base: baseV1aV2(m.base),
			valor: m.valor,
			n: null,
			invertir: m.invertir
		}]
	};
}
/** Resuelve el valor de una base plana v1 expresada en una BaseCapas (puente). */
function resolverBaseRef(b, ctx) {
	const ref = b.ref;
	if (!ref || ref === "ninguna") return 0;
	if (ref === "venta") return ctx.venta[ctx.regla.empresa] || 0;
	if (ref === "semineto") {
		const a = ctx.agg[ctx.regla.empresa];
		return a ? a.sn : 0;
	}
	if (ref.indexOf("g:") === 0) {
		const g = ref.slice(2);
		const gg = ctx.grupo[ctx.regla.empresa];
		return gg ? gg[g] || 0 : 0;
	}
	if (ref.indexOf("c:") === 0) return ctx.refConcepto(ctx.regla.empresa, ref.slice(2));
	return 0;
}
/**
* Evalúa un solo paso dado el acumulador `acc` del paso anterior.
* El primer paso recibe `acc` indefinido (parte de su base).
*/
function evaluarPaso(paso, acc, valorEfectivo, ctx) {
	const r = ctx.regla;
	const n = paso.n ?? r.n ?? ctx.gn;
	const v = valorEfectivo != null ? valorEfectivo : paso.valor != null ? paso.valor : 0;
	const sg = paso.invertir ? -1 : 1;
	switch (paso.op) {
		case "formula_venta":
			if (ctx.escenario === "CAUSADO") return r.acum;
			return formulaVenta(r.acum, r.serie, ctx.param, n);
		case "promedio": return sg * prom(r.serie, n);
		case "mediana": return sg * mediana(r.serie, n);
		case "ultimo": return sg * ultimo(r.serie);
		case "presupuesto": return sg * (r.presupuesto ?? 0);
		case "valor_fijo": return sg * v;
		case "ratio_venta": {
			const sumaVenta = sumaN(ctx.serieVenta?.(r.empresa) ?? [], n);
			if (sumaVenta === 0) return 0;
			return sg * (sumaN(r.serie, n) / sumaVenta) * (ctx.venta[r.empresa] || 0);
		}
		case "derivada": return -ctx.cargoFijoDemas(r.empresa);
		case "componentes": return acc ?? 0;
		case "porcentaje":
		case "multiplicar": return sg * (v * (acc !== void 0 ? acc : resolverBaseRef(paso.base, ctx)));
		case "sumar": return sg * ((acc !== void 0 ? acc : resolverBaseRef(paso.base, ctx)) + v);
		case "restar": return sg * ((acc !== void 0 ? acc : resolverBaseRef(paso.base, ctx)) - v);
		default: return acc ?? 0;
	}
}
/**
* Evalúa un método v2 completo: fold de izquierda a derecha sobre sus pasos.
*
* TRAMPA CP-18: `regla.valor` sobrescribe el valor del paso SOLO si el método
* tiene un único paso. Con varios pasos, cada paso conserva su propio valor.
*/
function evaluarMetodoV2(m, ctx) {
	const unSoloPaso = m.pasos.length === 1;
	let acc;
	for (let i = 0; i < m.pasos.length; i++) {
		const paso = m.pasos[i];
		const valorEfectivo = unSoloPaso ? ctx.regla.valor != null ? ctx.regla.valor : paso.valor : paso.valor;
		acc = evaluarPaso(paso, acc, valorEfectivo, ctx);
	}
	return acc ?? 0;
}
/**
* Calcula el monto USD de cada regla, resolviendo por TURNOS 1..5 (§C).
*
* §C · Foto por turno (la sutileza que se pierde al refactorizar): tras cada
* turno se recalculan los agregados, pero un filtro de SOLO GRUPO (bases `g:*`
* y `semineto`) usa la FOTO DEL TURNO ANTERIOR. Así el resultado NO depende del
* orden de las reglas dentro de un turno (confluencia, 12.4/12.5).
*
* Cómo se garantiza aquí: `grupo` y `agg` solo se reconstruyen en
* `recalcular()`, que se invoca UNA vez al inicio y UNA vez DESPUÉS de cada
* turno completo — nunca a mitad de turno. Durante un turno `grupo`/`agg`
* quedan congelados en la foto del turno anterior, que es exactamente lo que
* leen las bases de solo grupo. Si la base se evaluara en vivo, el resultado
* cambiaría según el orden en que se recorran las reglas.
*
* Una base sólo puede leer lo que se calculó en turnos anteriores: esa es la
* regla que impide la referencia circular. El turno de cada método se deduce de
* sus bases (§C): fórmula de venta=1; historia/fijos/presupuesto=2; sobre la
* venta=3; derivada y fórmulas sobre otras reglas=4; sobre el Semi Neto=5.
*
* Internamente expresa cada `Metodo` v1 como `MetodoV2` de un paso y evalúa con
* el fold de pasos (CP-18). La aritmética es idéntica a la v1 (oráculo de 190).
*/
function calcular({ reglas: R, metodos: M, params, empresas, gn, escenario = "PROYECCION", diaDelCorte, diasDelMes }) {
	const val = new Array(R.length).fill(0);
	const hecho = new Array(R.length).fill(false);
	const venta = {};
	const participa = (r) => {
		const e = r.escenarios ?? "AMBOS";
		return e === "AMBOS" || e === escenario;
	};
	const pasadas = [...new Set(Object.values(M).map((m) => m.orden))].sort((a, b) => a - b);
	let grupo = {};
	let agg = {};
	const recalcular = () => {
		grupo = {};
		agg = {};
		for (const e of empresas) {
			const s = {
				VENTAS: 0,
				GOP: 0,
				GANOP: 0,
				SEMI: 0
			};
			R.forEach((r, i) => {
				if (hecho[i] && r.empresa === e) s[r.grupo] += val[i];
			});
			grupo[e] = s;
			const rb = -s.VENTAS;
			const gop = rb - s.GOP;
			agg[e] = {
				rb,
				go: s.GOP,
				gop,
				sn: gop - s.GANOP,
				ing: -(venta[e] || 0)
			};
		}
	};
	const refConcepto = (empresa, concepto) => {
		const j = R.findIndex((x) => x.empresa === empresa && x.concepto === concepto);
		return j >= 0 && hecho[j] ? val[j] : 0;
	};
	const cargoFijoDemas = (empresa) => {
		let cf = 0;
		R.forEach((x, j) => {
			if (x.concepto === "Cargo Fijo" && x.empresa !== empresa && hecho[j]) cf += val[j];
		});
		return cf;
	};
	const serieVenta = (empresa) => R.find((x) => x.empresa === empresa && x.concepto === "Ventas")?.serie ?? [];
	R.forEach((r, i) => {
		if (!participa(r)) hecho[i] = true;
	});
	recalcular();
	for (const p of pasadas) {
		R.forEach((r, i) => {
			const m = M[r.metodo];
			if (!m || m.orden !== p || hecho[i]) return;
			let res = evaluarMetodoV2(metodoV1aV2(m), {
				regla: r,
				param: params[r.empresa],
				gn,
				escenario,
				venta,
				agg,
				grupo,
				refConcepto,
				cargoFijoDemas,
				serieVenta
			});
			if (escenario === "CAUSADO") {
				const esVentaODerivada = m.op === "formula_venta" || m.op === "derivada";
				res = llevarACausado(res, r.causado ?? "igual", params[r.empresa], {
					esVentaODerivada,
					diaDelCorte,
					diasDelMes
				});
			}
			val[i] = res;
			hecho[i] = true;
			if (r.concepto === "Ventas" || m.op === "derivada") venta[r.empresa] = res;
		});
		recalcular();
	}
	return {
		val,
		venta,
		agg,
		hecho
	};
}
/**
* Corre los DOS escenarios del §H (CP-01) sobre el mismo juego de reglas.
*
* No duplica lógica: invoca `calcular()` una vez por escenario. El resultado
* `proyeccion` es idéntico al de `calcular()` sin `escenario` (retrocompat), y
* `causado` cambia la base de venta al acumulado real al corte aplicando el §E.
*
* _Requirements: 16.1, 16.2_
*/
function calcularEscenarios(opts) {
	return {
		proyeccion: calcular({
			...opts,
			escenario: "PROYECCION"
		}),
		causado: calcular({
			...opts,
			escenario: "CAUSADO"
		})
	};
}
//#endregion
//#region src/pages/proyeccion-gyp/salida.ts
/** Empresas cuya `Tasa_Mensual` SÍ se puebla en la tabla final (CP-05). */
const EMPRESAS_CON_TASA = /* @__PURE__ */ new Set(["Cofersa", "Mundial"]);
/**
* ¿Esta empresa lleva `Tasa_Mensual` en la tabla final? Solo Cofersa y Mundial;
* las venezolanas la dejan NULL porque el mayor ya trae su local.
*/
function llevaTasaMensual(empresa) {
	return EMPRESAS_CON_TASA.has(empresa);
}
/**
* `FECHA` = día 1 del periodo, en formato `aaaa-mm-01` (CP-04). El periodo llega
* como `aaaa-mm` o `aaaa-mm-dd`; en ambos casos la fecha de salida se fija al día 1.
*/
function fechaDia1(periodo) {
	const [anio, mes] = periodo.split("-");
	return `${anio}-${mes}-01`;
}
"FECHA;Ajuste;Vista;Combinada;Pais;Empresa;Tasa_Mensual;Ajuste_USD;Monto_Local;Monto_USD;CENTRO_COSTO;CUENTA_CONTABLE;Proyeccion".split(";");
/**
* Construye las `FilaResultado` de los DOS escenarios (CP-01/CP-49): una fila por
* regla, `proyeccion.val[i]` para el escenario 1 (Proyectado, `proyeccion=1`) y
* `causado.val[i]` para el escenario 2 (Causado, `proyeccion=2`), alineados por
* índice con `reglas`. `Monto_Local = Monto_USD × tasa` de la empresa, `FECHA` =
* día 1 (CP-04), `Vista='GYP'`, `Ajuste`/`Ajuste_USD`=0, país del mapa propio
* (CP-52), `Tasa_Mensual` solo en Cofersa/Mundial con la tasa del mes (CP-05).
*
* FUENTE ÚNICA: la usan tanto la publicación manual (`page.tsx`) como la corrida
* programada server-side (`supabase/functions/_shared/motor.ts`), para que ambas
* produzcan EXACTAMENTE las mismas filas. La fusión por Combinada, la validación
* de catálogo y el DELETE+INSERT por escenario los hace `publicar-proyeccion`.
*/
function construirFilasEscenarios(periodo, insumos) {
	const { reglas, metodos, params, empresas, gn, diaDelCorte, diasDelMes } = insumos;
	const escenarios = calcularEscenarios({
		reglas,
		metodos,
		params,
		empresas: [...empresas],
		gn,
		diaDelCorte,
		diasDelMes
	});
	const fecha = fechaDia1(periodo);
	const filaDe = (r, monto, escenario) => ({
		periodo,
		fecha,
		vista: "GYP",
		combinada: r.combinada,
		pais: r.pais || PAIS[r.empresa] || r.empresa,
		empresa: r.empresa,
		tasa_mensual: llevaTasaMensual(r.empresa) ? r.tasaMensual ?? params[r.empresa]?.tasa ?? null : null,
		ajuste: 0,
		ajuste_usd: 0,
		monto_local: monto * (params[r.empresa]?.tasa || 0),
		monto_usd: monto,
		centro_costo: r.cc,
		cuenta_contable: r.cuenta,
		proyeccion: escenario
	});
	return [...reglas.map((r, i) => filaDe(r, escenarios.proyeccion.val[i], 1)), ...reglas.map((r, i) => filaDe(r, escenarios.causado.val[i], 2))];
}
//#endregion
//#region src/pages/proyeccion-gyp/seed.ts
const EMPRESAS = [
	"Beval",
	"Febeca",
	"Sillaca",
	"Cofersa",
	"Mundial",
	"Prisma"
];
/**
* Biblioteca de métodos de fábrica (Parte II §D de 12-cambios-para-produccion).
*
* Cada método trae su operación, valor por defecto, turno (`orden`) y causado por
* defecto del §D. El promedio por defecto (N) es 9 meses; vive en el motor (`gn`)
* y no se guarda aquí, por lo que no aparece en estos registros.
*
* Los cuatro métodos nuevos respecto a la v1 —`m_mediana`, `m_ultimo`,
* `m_ratio_venta`, `m_ppto`— se agregaron con la parametrización por backtest de
* octubre 2026. Son solo biblioteca: las 95 REGLAS_SEED siguen usando los mismos
* métodos que la v1, así que estos nuevos métodos NO mueven los 190 casos. La
* reasignación de reglas a estos métodos es la parametrización de octubre (otra
* fase, tarea 13.1).
*
* Restricciones del §D:
*   - `m_pct_semineto` solo aplica al grupo Impuesto (ISLR).
*   - `m_derivada` solo aplica a la Colocación de Prisma.
*
* El tipo `Metodo` v1 (op/base/valor/invertir/orden/fijo) se conserva: el motor
* expresa cada método como un `MetodoV2` de un paso y evalúa con el fold de pasos.
* Las operaciones nuevas (`mediana`, `ultimo`, `ratio_venta`, `presupuesto`) ya se
* evalúan en `evaluarPaso` del motor v2.
*/
const METODOS_BASE = {
	m_venta: {
		id: "m_venta",
		nombre: "Fórmula de venta",
		op: "formula_venta",
		base: "ninguna",
		valor: null,
		invertir: false,
		orden: 1,
		fijo: true
	},
	m_promedio: {
		id: "m_promedio",
		nombre: "Promedio histórico",
		op: "promedio",
		base: "ninguna",
		valor: null,
		invertir: false,
		orden: 2,
		fijo: true
	},
	m_mediana: {
		id: "m_mediana",
		nombre: "Mediana histórica",
		op: "mediana",
		base: "ninguna",
		valor: null,
		invertir: false,
		orden: 2,
		fijo: true
	},
	m_ultimo: {
		id: "m_ultimo",
		nombre: "Último mes cerrado",
		op: "ultimo",
		base: "ninguna",
		valor: null,
		invertir: false,
		orden: 2,
		fijo: true
	},
	m_ppto: {
		id: "m_ppto",
		nombre: "Presupuesto del mes",
		op: "presupuesto",
		base: "ninguna",
		valor: null,
		invertir: false,
		orden: 2,
		fijo: true
	},
	m_fijo: {
		id: "m_fijo",
		nombre: "Monto fijo",
		op: "valor_fijo",
		base: "ninguna",
		valor: 0,
		invertir: false,
		orden: 2,
		fijo: true
	},
	m_pct_venta: {
		id: "m_pct_venta",
		nombre: "% sobre venta",
		op: "porcentaje",
		base: "venta",
		valor: .01,
		invertir: true,
		orden: 3,
		fijo: true
	},
	m_ratio_venta: {
		id: "m_ratio_venta",
		nombre: "Proporción histórica de la venta",
		op: "ratio_venta",
		base: "venta",
		valor: null,
		invertir: false,
		orden: 3,
		fijo: true
	},
	m_derivada: {
		id: "m_derivada",
		nombre: "Derivada (Cargo Fijo)",
		op: "derivada",
		base: "ninguna",
		valor: null,
		invertir: false,
		orden: 4,
		fijo: true
	},
	m_pct_semineto: {
		id: "m_pct_semineto",
		nombre: "% sobre Semi Neto",
		op: "porcentaje",
		base: "semineto",
		valor: .009,
		invertir: false,
		orden: 5,
		fijo: true
	}
};
//#endregion
//#region supabase/functions/_shared/cargarInsumos.ts
/**
* Lee de Supabase los insumos del motor para un periodo y los ensambla igual que
* el navegador. Lanza si faltan reglas o parámetros (no se publica con datos
* incompletos).
*/
async function cargarInsumos(db, periodo, gn = 9) {
	const { data: pr, error: eParam } = await db.from("proyeccion_parametro").select("periodo,empresa,dias_habiles_mes,dias_transcurridos,factor_correccion,tasa_local,corte").eq("periodo", periodo);
	if (eParam) throw new Error("No se pudieron leer los parámetros: " + eParam.message);
	const params = {};
	let corte = null;
	for (const row of pr ?? []) {
		if (!EMPRESAS.includes(row.empresa)) continue;
		params[row.empresa] = {
			empresa: row.empresa,
			dias: row.dias_habiles_mes,
			trans: row.dias_transcurridos,
			factor: row.factor_correccion,
			tasa: row.tasa_local ?? 0
		};
		if (row.corte && (!corte || row.corte > corte)) corte = row.corte;
	}
	if (Object.keys(params).length === 0) throw new Error(`sin parámetros para ${periodo}: no se publica con datos incompletos.`);
	const metodos = {};
	const { data: mr } = await db.from("proyeccion_metodo").select("*").eq("activo", true);
	if (mr && mr.length) for (const row of mr) metodos[row.id] = {
		id: row.id,
		nombre: row.nombre,
		op: row.operacion,
		base: row.base,
		valor: row.valor,
		invertir: row.invertir,
		orden: row.turno,
		fijo: row.de_fabrica
	};
	else for (const m of Object.values(METODOS_BASE)) metodos[m.id] = { ...m };
	const { data: rr, error: eRegla } = await db.from("proyeccion_regla").select("*").eq("periodo", periodo).eq("activa", true);
	if (eRegla) throw new Error("No se pudieron leer las reglas: " + eRegla.message);
	const reglasBase = (rr ?? []).filter((r) => !r.eliminada);
	if (reglasBase.length === 0) throw new Error(`sin reglas activas para ${periodo}: no se publica con datos incompletos.`);
	const { data: hr } = await db.from("gyp_historico_mensual").select("periodo,empresa,concepto,monto_usd,es_venta");
	const series = {};
	const historico = hr ?? [];
	if (historico.length) {
		const prevPeriodos = [...new Set(historico.map((h) => h.periodo))].sort().filter((p) => p < periodo);
		for (const h of historico) {
			const key = h.empresa + "|" + h.concepto;
			if (!series[key]) series[key] = {
				a: 0,
				s: new Array(prevPeriodos.length).fill(null)
			};
			if (h.periodo === periodo) series[key].a += h.monto_usd;
			else {
				const idx = prevPeriodos.indexOf(h.periodo);
				if (idx >= 0) series[key].s[idx] = (series[key].s[idx] ?? 0) + h.monto_usd;
			}
		}
	}
	const { data: pp } = await db.from("gyp_historico_cuenta").select("empresa,concepto,presupuesto").eq("periodo", periodo);
	const ppto = /* @__PURE__ */ new Map();
	for (const f of pp ?? []) {
		const key = f.empresa + "|" + f.concepto;
		ppto.set(key, (ppto.get(key) ?? 0) + (Number(f.presupuesto) || 0));
	}
	return {
		reglas: reglasBase.map((r, i) => {
			const sc = series[r.empresa + "|" + r.concepto] || {
				a: 0,
				s: []
			};
			return {
				key: "r" + i,
				empresa: r.empresa,
				concepto: r.concepto,
				grupo: r.grupo_pl,
				metodo: r.metodo,
				valor: r.valor,
				n: r.n ?? null,
				nombre: r.nombre ?? null,
				detalle: r.detalle ?? null,
				causado: r.causado,
				escenarios: r.escenarios,
				nivel: r.nivel,
				combinada: r.combinada,
				cc: r.centro_costo,
				cuenta: r.cuenta_contable,
				pais: PAIS[r.empresa] || r.empresa,
				tasaMensual: null,
				serie: (sc.s || []).map((x) => x == null ? NaN : x),
				acum: sc.a || 0,
				nueva: false,
				presupuesto: ppto.get(r.empresa + "|" + r.concepto) ?? null
			};
		}),
		metodos,
		params,
		empresas: EMPRESAS,
		gn,
		corte
	};
}
//#endregion
//#region supabase/functions/corrida-programada/index.ts
const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS"
};
/**
* Inserta una fila de bitácora y devuelve su id, para luego cerrarla con
* `cerrarCorrida`. `origen` es siempre 'programada' en esta función.
*/
async function abrirCorrida(db, periodo, paso, estado, extra = {}) {
	const { data, error } = await db.from("proyeccion_corrida").insert({
		periodo,
		origen: "programada",
		paso,
		estado,
		filas: extra.filas ?? null,
		corte: extra.corte ?? null,
		mensaje: extra.mensaje ?? null,
		lanzada_por: LANZADA_POR,
		fin: estado === "en_curso" ? null : (/* @__PURE__ */ new Date()).toISOString()
	}).select("id").single();
	if (error) {
		console.error("proyeccion_corrida insert falló:", error.message);
		return null;
	}
	return data.id;
}
/** Cierra una corrida `en_curso` previamente abierta con su estado terminal. */
async function cerrarCorrida(db, id, estado, extra = {}) {
	if (id == null) return;
	const patch = {
		estado,
		fin: (/* @__PURE__ */ new Date()).toISOString()
	};
	if (extra.mensaje !== void 0) patch.mensaje = extra.mensaje;
	if (extra.filas !== void 0) patch.filas = extra.filas;
	if (extra.corte !== void 0) patch.corte = extra.corte;
	const { error } = await db.from("proyeccion_corrida").update(patch).eq("id", id);
	if (error) console.error("proyeccion_corrida update falló:", error.message);
}
/**
* Devuelve 'aaaa-mm' del mes vigente EN LA ZONA de la config (Caracas por
* defecto). La zona viaja con el dato: se usa Intl para proyectar "ahora" a la
* zona, en vez de restar −4 a mano (R-27.2). Así el mes de trabajo cambia a la
* medianoche de Caracas, no a la de UTC.
*/
function periodoVigente(zona) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: zona,
		year: "numeric",
		month: "2-digit"
	}).format(/* @__PURE__ */ new Date()).slice(0, 7);
}
/** Quién lanzó la corrida, para la bitácora. Se fija por petición en el handler. */
let LANZADA_POR = "pg_cron";
/** Una corrida `en_curso` más vieja que esto se da por caída y no bloquea. */
const CORRIDA_COLGADA_MS = 1800 * 1e3;
/** Fecha y hora "de pared" de un instante en la zona dada. */
function partesEnZona(instante, zona) {
	const f = new Intl.DateTimeFormat("en-CA", {
		timeZone: zona,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23"
	});
	const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, x.value]));
	return {
		fecha: `${p.year}-${p.month}-${p.day}`,
		anio: +p.year,
		mes: +p.month,
		dia: +p.day,
		hora: +p.hour,
		minuto: +p.minute,
		segundo: +p.second
	};
}
/**
* Instante UTC que corresponde a `fecha` + `hora` (HH:MM) de pared en `zona`.
* Se calcula el desfase de la zona con Intl en vez de escribir −4 a mano (R-27.2).
*/
function instanteDeLocal(fecha, hora, zona) {
	const [a, m, d] = fecha.split("-").map(Number);
	const [hh, mm] = hora.split(":").map(Number);
	const supuesto = Date.UTC(a, m - 1, d, hh, mm, 0);
	const p = partesEnZona(new Date(supuesto), zona);
	const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
	return new Date(supuesto - (comoUtc - supuesto));
}
/** Día ISO (1 = lunes … 7 = domingo) de una fecha 'aaaa-mm-dd'. */
function diaIso(fecha) {
	const [a, m, d] = fecha.split("-").map(Number);
	return (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7 + 1;
}
/**
* Decide si la corrida programada toca ahora: hoy (en la zona) es un día de la
* frecuencia, ya pasó `hora_local` y no hubo corrida programada desde entonces.
* Devuelve el instante programado de hoy para la bitácora.
*/
async function tocaAhora(db, prog, zona) {
	const ahora = /* @__PURE__ */ new Date();
	const hoy = partesEnZona(ahora, zona).fecha;
	const iso = diaIso(hoy);
	if (!(prog.frecuencia === "habiles" ? iso >= 1 && iso <= 5 : prog.frecuencia === "semanal" ? iso === (prog.dia_semana ?? 1) : true)) return {
		toca: false,
		motivo: `hoy (${hoy}) no toca según la frecuencia ${prog.frecuencia}.`
	};
	const programada = instanteDeLocal(hoy, prog.hora_local.slice(0, 5), zona);
	if (ahora < programada) return {
		toca: false,
		motivo: `aún no son las ${prog.hora_local.slice(0, 5)} en ${zona}.`
	};
	const { data, error } = await db.from("proyeccion_corrida").select("id").eq("origen", "programada").gte("inicio", programada.toISOString()).limit(1);
	if (error) throw new Error(`No se pudo leer la bitácora: ${error.message}`);
	if (data && data.length > 0) return {
		toca: false,
		motivo: `ya corrió hoy después de las ${prog.hora_local.slice(0, 5)}.`
	};
	return {
		toca: true,
		motivo: `programada ${hoy} ${prog.hora_local.slice(0, 5)} (${zona}).`
	};
}
/**
* Cuántas filas dejó Fabric en `gyp_historico_mensual` para el periodo. La
* corrida NO consulta Fabric: recalcula con lo último que Fabric escribió.
*/
async function filasHistoricoDelMes(db, periodo) {
	const { count, error } = await db.from("gyp_historico_mensual").select("periodo", {
		count: "exact",
		head: true
	}).eq("periodo", periodo);
	if (error) throw new Error(`No se pudo leer gyp_historico_mensual: ${error.message}`);
	return count ?? 0;
}
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
async function datosFrescos(db, periodo) {
	const { data: params, error: eParam } = await db.from("proyeccion_parametro").select("corte").eq("periodo", periodo).not("corte", "is", null);
	if (eParam) throw eParam;
	const cortes = (params ?? []).map((r) => r.corte).filter((c) => !!c).sort();
	const corteExtraccion = cortes.length ? cortes[cortes.length - 1] : null;
	if (!corteExtraccion) return {
		frescos: false,
		corteExtraccion: null,
		motivo: "la extracción del mes no tiene corte (Fabric no ha escrito datos)."
	};
	const { data: ultima, error: eCorr } = await db.from("proyeccion_corrida").select("corte").eq("periodo", periodo).eq("paso", "publicacion").eq("estado", "ok").order("inicio", { ascending: false }).limit(1);
	if (eCorr) throw eCorr;
	const cortePublicado = ultima?.[0]?.corte ?? null;
	if (cortePublicado && corteExtraccion <= cortePublicado) return {
		frescos: false,
		corteExtraccion,
		motivo: `el corte no avanzó desde la última publicación (publicado ${cortePublicado}, extracción ${corteExtraccion}).`
	};
	return {
		frescos: true,
		corteExtraccion
	};
}
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
function checklistMinimo(filas, periodo, dimCuenta) {
	const items = [];
	const dia1 = `${periodo.slice(0, 7)}-01`;
	const fechasMalas = filas.filter((f) => String(f.fecha).slice(0, 10) !== dia1);
	items.push({
		nombre: "FECHA = día 1 del periodo",
		bloqueante: true,
		ok: fechasMalas.length === 0,
		detalle: fechasMalas.length ? `${fechasMalas.length} fila(s) con FECHA distinta de ${dia1}.` : void 0
	});
	const sinPais = filas.filter((f) => !f.pais || String(f.pais).trim() === "");
	items.push({
		nombre: "Pais lleno",
		bloqueante: true,
		ok: sinPais.length === 0,
		detalle: sinPais.length ? `${sinPais.length} fila(s) sin país.` : void 0
	});
	const conTasa = /* @__PURE__ */ new Set(["Cofersa", "Mundial"]);
	const tasaMala = filas.filter((f) => {
		return conTasa.has(f.empresa) !== (f.tasa_mensual != null);
	});
	items.push({
		nombre: "Tasa_Mensual solo Cofersa/Mundial",
		bloqueante: true,
		ok: tasaMala.length === 0,
		detalle: tasaMala.length ? (() => {
			const faltan = tasaMala.filter((f) => conTasa.has(f.empresa));
			const sobran = tasaMala.length - faltan.length;
			const partes = [];
			if (faltan.length) {
				const emps = [...new Set(faltan.map((f) => f.empresa))].join(", ");
				partes.push(`${faltan.length} fila(s) de ${emps} sin Tasa_Mensual`);
			}
			if (sobran) partes.push(`${sobran} fila(s) venezolanas con Tasa_Mensual`);
			return partes.join("; ") + ".";
		})() : void 0
	});
	const porEscenario = /* @__PURE__ */ new Map();
	const repetidas = [];
	for (const f of filas) {
		const esc = String(f.proyeccion);
		if (!porEscenario.has(esc)) porEscenario.set(esc, /* @__PURE__ */ new Set());
		const vistas = porEscenario.get(esc);
		if (vistas.has(f.combinada)) repetidas.push(`${esc}:${f.combinada}`);
		else vistas.add(f.combinada);
	}
	items.push({
		nombre: "Sin Combinada repetida por escenario",
		bloqueante: true,
		ok: repetidas.length === 0,
		detalle: repetidas.length ? `${repetidas.length} repetición(es): ${repetidas.slice(0, 5).join(", ")}…` : void 0
	});
	if (dimCuenta) {
		const huerfanas = [...new Set(filas.map((f) => f.combinada).filter((c) => !dimCuenta.has(c)))];
		items.push({
			nombre: "Combinada ⊂ dim_cuenta",
			bloqueante: true,
			ok: huerfanas.length === 0,
			detalle: huerfanas.length ? `${huerfanas.length} Combinada(s) huérfana(s): ${huerfanas.slice(0, 5).join(", ")}…` : void 0
		});
	}
	const tieneEsc1 = filas.some((f) => Number(f.proyeccion) === 1);
	const tieneEsc2 = filas.some((f) => Number(f.proyeccion) === 2);
	items.push({
		nombre: "Los dos escenarios presentes",
		bloqueante: true,
		ok: tieneEsc1 && tieneEsc2,
		detalle: tieneEsc1 && tieneEsc2 ? void 0 : `falta el escenario ${!tieneEsc1 ? "1 (Proyectado)" : "2 (Causado)"}.`
	});
	return items;
}
/**
* Invoca la Edge Function `publicar-proyeccion` (ya existe) con las filas de los
* DOS escenarios. Esa función hace el filtro por escenario (CP-49), la fusión por
* Combinada (CP-06), la validación contra dim_cuenta (CP-07) y el `DELETE`+`INSERT`
* idempotente por `(periodo, escenario)` vía la RPC transaccional
* `publicar_proyeccion` (CP-02/CP-03). No se reimplementa nada de eso aquí.
*/
async function publicar(supabaseUrl, serviceKey, periodo, filas, dimCuenta) {
	const resp = await fetch(`${supabaseUrl}/functions/v1/publicar-proyeccion`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${serviceKey}`,
			apikey: serviceKey
		},
		body: JSON.stringify({
			periodo,
			filas,
			dimCuenta
		})
	});
	const cuerpo = await resp.json().catch(() => null);
	if (!resp.ok || !cuerpo || cuerpo.ok !== true) return {
		ok: false,
		error: (cuerpo && (cuerpo.error || cuerpo.mensaje)) ?? `publicar-proyeccion respondió ${resp.status}`,
		cuerpo
	};
	return {
		ok: true,
		publicado: cuerpo.publicado,
		cuerpo
	};
}
serve(async (req) => {
	if (req.method === "OPTIONS") return new Response(null, {
		headers: corsHeaders,
		status: 204
	});
	const log = [];
	const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
	const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
	const db = createClient(supabaseUrl, serviceKey, { auth: {
		autoRefreshToken: false,
		persistSession: false
	} });
	try {
		const body = await req.json().catch(() => ({}));
		const { data: progRow, error: eProg } = await db.from("proyeccion_programacion").select("id, activa, frecuencia, dia_semana, hora_local, zona, exige_datos_frescos, periodo").eq("id", 1).single();
		if (eProg) throw new Error(`No se pudo leer proyeccion_programacion: ${eProg.message}`);
		const prog = progRow;
		const zona = prog.zona || "America/Caracas";
		const manual = body.manual === true;
		LANZADA_POR = manual ? "manual" : "pg_cron";
		if (!prog.activa && !manual) {
			log.push("programación pausada (activa=false): no se ejecuta.");
			return json({
				ok: true,
				ejecutada: false,
				motivo: "pausada",
				log
			});
		}
		if (!manual) {
			const t = await tocaAhora(db, prog, zona);
			log.push(t.motivo);
			if (!t.toca) return json({
				ok: true,
				ejecutada: false,
				motivo: "fuera_de_horario",
				log
			});
		}
		const periodo = typeof body.periodo === "string" && body.periodo || prog.periodo || periodoVigente(zona);
		log.push(`periodo de trabajo: ${periodo} (zona ${zona})`);
		const limiteColgada = (/* @__PURE__ */ new Date(Date.now() - CORRIDA_COLGADA_MS)).toISOString();
		await db.from("proyeccion_corrida").update({
			estado: "error",
			fin: (/* @__PURE__ */ new Date()).toISOString(),
			mensaje: "quedó en curso más de 30 min; se da por caída."
		}).eq("periodo", periodo).eq("estado", "en_curso").lt("inicio", limiteColgada);
		const { data: enCurso, error: eCurso } = await db.from("proyeccion_corrida").select("id, paso, inicio").eq("periodo", periodo).eq("estado", "en_curso").limit(1);
		if (eCurso) throw new Error(`No se pudo comprobar solapamiento: ${eCurso.message}`);
		if (enCurso && enCurso.length > 0) {
			const msg = "la corrida anterior sigue en curso; esta se omite.";
			log.push(msg);
			await abrirCorrida(db, periodo, "calculo", "omitida", { mensaje: msg });
			return json({
				ok: true,
				ejecutada: false,
				motivo: "solapamiento",
				periodo,
				log
			});
		}
		const filasMes = await filasHistoricoDelMes(db, periodo);
		if (filasMes === 0) {
			const msg = `gyp_historico_mensual no tiene datos de ${periodo}: Fabric aún no escribió el mes. Se conserva lo publicado.`;
			log.push(msg);
			await abrirCorrida(db, periodo, "calculo", "omitida", { mensaje: msg });
			return json({
				ok: true,
				ejecutada: false,
				motivo: "sin_datos",
				periodo,
				log
			});
		}
		log.push(`datos de Fabric en gyp_historico_mensual: ${filasMes} filas de ${periodo}.`);
		const forzar = body.forzar === true;
		let corteExtraccion = null;
		if (prog.exige_datos_frescos && !forzar) {
			const f = await datosFrescos(db, periodo);
			corteExtraccion = f.corteExtraccion;
			if (!f.frescos) {
				const msg = `datos viejos: ${f.motivo} Se conserva lo publicado.`;
				log.push(msg);
				await abrirCorrida(db, periodo, "calculo", "omitida", {
					mensaje: msg,
					corte: f.corteExtraccion
				});
				return json({
					ok: true,
					ejecutada: false,
					motivo: "datos_viejos",
					periodo,
					log
				});
			}
			log.push(`datos frescos: corte de extracción ${corteExtraccion}.`);
		} else {
			log.push(forzar ? "guardia de datos frescos saltada por 'forzar'." : "guardia de datos frescos desactivada en la config.");
			const { data: params } = await db.from("proyeccion_parametro").select("corte").eq("periodo", periodo).not("corte", "is", null);
			const cortes = (params ?? []).map((r) => r.corte).filter((c) => !!c).sort();
			corteExtraccion = cortes.length ? cortes[cortes.length - 1] : null;
		}
		const idCalculo = await abrirCorrida(db, periodo, "calculo", "en_curso", { corte: corteExtraccion });
		const dimCuenta = Array.isArray(body.dimCuenta) ? body.dimCuenta.map(String) : void 0;
		let filas = Array.isArray(body.filas) ? body.filas : [];
		try {
			if (filas.length === 0) {
				const insumos = await cargarInsumos(db, periodo);
				if (insumos.corte && !corteExtraccion) corteExtraccion = insumos.corte;
				filas = construirFilasEscenarios(periodo, insumos);
				if (filas.length === 0) throw new Error("el motor no produjo filas (sin reglas activas para el periodo).");
				log.push(`recálculo server-side ok: ${filas.length} filas de los dos escenarios.`);
			} else log.push(`filas recibidas en el body: ${filas.length} (no se recalcula).`);
		} catch (errCalc) {
			const msg = "recálculo falló: " + String(errCalc instanceof Error ? errCalc.message : errCalc);
			log.push(msg);
			await cerrarCorrida(db, idCalculo, "error", {
				mensaje: msg,
				filas: 0
			});
			return json({
				ok: false,
				ejecutada: false,
				motivo: "calculo",
				periodo,
				log
			}, 200);
		}
		await cerrarCorrida(db, idCalculo, "ok", {
			filas: filas.length,
			corte: corteExtraccion
		});
		let catalogo = null;
		if (dimCuenta) catalogo = new Set(dimCuenta);
		else {
			const { data: dc } = await db.from("dim_cuenta").select("combinada");
			if (dc && dc.length) catalogo = new Set(dc.map((r) => r.combinada));
		}
		const items = checklistMinimo(filas, periodo, catalogo);
		const fallos = items.filter((i) => i.bloqueante && !i.ok);
		if (fallos.length > 0) {
			const msg = "checklist bloqueante (CP-44) falló: " + fallos.map((f) => `${f.nombre}${f.detalle ? ` — ${f.detalle}` : ""}`).join("; ");
			log.push(msg);
			await abrirCorrida(db, periodo, "publicacion", "error", {
				mensaje: msg,
				corte: corteExtraccion
			});
			return json({
				ok: false,
				ejecutada: false,
				motivo: "checklist",
				periodo,
				fallos,
				log
			}, 200);
		}
		log.push(`checklist CP-44 (mínimo): ${items.length} ítems ok.`);
		const idPub = await abrirCorrida(db, periodo, "publicacion", "en_curso", { corte: corteExtraccion });
		const res = await publicar(supabaseUrl, serviceKey, periodo, filas, dimCuenta);
		if (!res.ok) {
			const msg = `publicación falló: ${res.error}`;
			log.push(msg);
			await cerrarCorrida(db, idPub, "error", {
				mensaje: msg,
				corte: corteExtraccion
			});
			return json({
				ok: false,
				ejecutada: false,
				motivo: "publicacion",
				periodo,
				detalle: res.cuerpo,
				log
			}, 200);
		}
		await cerrarCorrida(db, idPub, "ok", {
			filas: Object.values(res.publicado ?? {}).reduce((a, b) => a + b, 0),
			corte: corteExtraccion
		});
		log.push(`publicación ok: ${JSON.stringify(res.publicado)} filas por escenario.`);
		return json({
			ok: true,
			ejecutada: true,
			periodo,
			corte: corteExtraccion,
			publicado: res.publicado,
			log
		});
	} catch (err) {
		const msg = String(err instanceof Error ? err.message : err);
		log.push(`error inesperado: ${msg}`);
		return json({
			ok: false,
			error: msg,
			log
		}, 500);
	}
});
/** Respuesta JSON con los headers de CORS. */
function json(payload, status = 200) {
	return new Response(JSON.stringify(payload, null, 2), {
		status,
		headers: {
			...corsHeaders,
			"Content-Type": "application/json"
		}
	});
}
//#endregion
