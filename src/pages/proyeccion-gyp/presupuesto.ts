/**
 * El presupuesto del periodo, leído de donde lo carga el usuario.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * El presupuesto llegaba por `gyp_historico_cuenta.presupuesto`, que rellena el
 * notebook de Fabric cruzando `presupuesto_gyp_v2` contra el mayor **por
 * `Combinada`**. Ese cruce no puede funcionar: el presupuesto NO tiene
 * dimensión de centro de costo —se hace por cuenta y empresa— y rellena ese
 * hueco de la llave con el código de «sin centro de costo»
 * (`00.00.000.00`, `0-00-00`), mientras el mayor lleva el centro de costo real.
 *
 * Medido contra Gold, octubre 2026, las seis empresas:
 *
 *     casan        3 de 90 llaves    +278.501 USD
 *     NO casan    87 de 90 llaves    −870.162 USD
 *
 * Las tres que casaban son las de IVA Atrapado, que en el mayor tampoco tienen
 * centro de costo. Por eso la pantalla mostraba 0 en 17 de los 18 conceptos, y
 * el poco presupuesto que entraba iba con el signo contrario al total.
 *
 * Y el `ppto.get(comb, 0.0)` del notebook **no distingue «presupuesto de cero»
 * de «no encontré la llave»**: las dos cosas se escriben igual. De ahí que el
 * fallo no diera ningún síntoma.
 *
 * LA SALIDA: leer el presupuesto de `presupuestos_lineas` —la tabla del módulo
 * Presupuestos de esta misma aplicación, que es donde el usuario lo carga— y
 * agregarlo por **cuenta contable + empresa**, que es el grano al que el
 * presupuesto realmente existe. El viaje a Fabric y de vuelta no aportaba nada:
 * los totales de las dos tablas son el mismo número (−591.661 USD en octubre).
 *
 * Ganancia adicional: lo que Control carga se ve al instante, sin esperar a que
 * corra el notebook.
 *
 * FUENTE OFICIAL (confirmado por Control el 2026-11-02): `presupuestos_lineas`
 * es la única entrada del presupuesto. Nadie lo carga directamente en Gold, así
 * que leer de aquí no deja fuera ninguna vía de carga. Si algún día alguien
 * empieza a cargarlo en Gold, este módulo deja de verlo — y esa es la razón de
 * dejar la confirmación escrita y fechada.
 */

/** Una línea de `presupuestos_lineas`, ya resuelto el nombre de la empresa. */
export interface LineaPresupuesto {
  empresa: string;
  cuenta: string;
  montoUsd: number;
}

/** El presupuesto del periodo, agregado por empresa y concepto. */
export interface PresupuestoConcepto {
  empresa: string;
  concepto: string;
  presupuesto: number;
}

/** Lo que el reparto no pudo clasificar, para avisar en vez de perderlo. */
export interface CuentaSinConcepto {
  empresa: string;
  cuenta: string;
  monto: number;
}

export interface RepartoPresupuesto {
  porConcepto: PresupuestoConcepto[];
  sinConcepto: CuentaSinConcepto[];
}

/**
 * Los nombres de empresa de `companias` no son los del resto del módulo.
 *
 * «MUNDIAL DE PARTES» es el caso que importa: en todo lo demás del aplicativo
 * esa empresa se llama «Mundial». Sin esta traducción su presupuesto se agrega
 * bajo una empresa que no existe para el motor y desaparece sin error.
 */
export const EMPRESA_PRESUPUESTO: Record<string, string> = {
  BEVAL: 'Beval',
  FEBECA: 'Febeca',
  SILLACA: 'Sillaca',
  COFERSA: 'Cofersa',
  PRISMA: 'Prisma',
  'MUNDIAL DE PARTES': 'Mundial',
};

/**
 * Traduce el nombre de `companias` al que usa el módulo.
 *
 * Si no está en la tabla se devuelve tal cual en vez de descartarlo: una empresa
 * nueva debe aparecer —aunque sea con un nombre raro— y no evaporarse.
 */
export function normalizarEmpresa(nombre: string | null | undefined): string {
  const n = (nombre ?? '').trim();
  return EMPRESA_PRESUPUESTO[n.toUpperCase()] ?? n;
}

/** Clave estable empresa|cuenta. */
export function claveCuenta(empresa: string, cuenta: string): string {
  return empresa.trim() + '|' + cuenta.trim();
}

/**
 * Suma las líneas del periodo por empresa y cuenta.
 *
 * SE SUMA, no se toma la primera: en octubre 2026 hay 181 líneas para 95 pares
 * (empresa, cuenta) —76 pares repetidos, alguno hasta cuatro veces—. Quedarse
 * con una sola perdería el resto en silencio.
 */
export function agregarPorCuenta(lineas: LineaPresupuesto[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lineas) {
    const k = claveCuenta(l.empresa, l.cuenta);
    const monto = Number.isFinite(l.montoUsd) ? l.montoUsd : 0;
    m.set(k, (m.get(k) ?? 0) + monto);
  }
  return m;
}

/** Fila mínima del catálogo o del detalle para resolver el concepto. */
export interface FilaConcepto {
  empresa: string | null;
  cuenta: string | null;
  concepto: string | null;
  /** Acumulado del mes, si se conoce; pondera el reparto. */
  acumulado?: number | null;
}

/**
 * Para cada (empresa, cuenta), los conceptos que esa cuenta tiene y su peso.
 *
 * Una cuenta puede caer en más de un concepto según el centro de costo: en el
 * catálogo hay 327 pares (empresa, cuenta) con dos conceptos distintos —el caso
 * típico es «Personal Fijo» contra «Logistico»—. Ninguna de las 95 cuentas
 * presupuestadas de octubre está entre ellos, pero el día que una lo esté el
 * reparto tiene que ser determinista y no quedarse con el concepto que la base
 * devuelva primero.
 *
 * El peso es el acumulado del mes en valor absoluto. En absoluto a propósito:
 * los ingresos vienen negativos y sin `abs` una cuenta con ingresos y gastos se
 * repartiría con pesos que se cancelan entre sí.
 */
export function conceptosPorCuenta(filas: FilaConcepto[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const f of filas) {
    const empresa = (f.empresa ?? '').trim();
    const cuenta = (f.cuenta ?? '').trim();
    const concepto = (f.concepto ?? '').trim();
    if (!empresa || !cuenta || !concepto) continue;
    const k = claveCuenta(empresa, cuenta);
    let suyos = m.get(k);
    if (!suyos) {
      suyos = new Map<string, number>();
      m.set(k, suyos);
    }
    const peso = Math.abs(Number(f.acumulado ?? 0)) || 0;
    suyos.set(concepto, (suyos.get(concepto) ?? 0) + peso);
  }
  return m;
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Reparte el presupuesto de cada cuenta entre sus conceptos.
 *
 * Con un solo concepto —el caso de las 95 cuentas de octubre— va entero ahí.
 * Con varios se reparte en proporción al acumulado del mes; si ninguno tiene
 * movimiento, en partes iguales. En los tres casos la suma repartida es la del
 * presupuesto: no se crea ni se pierde ni un dólar.
 *
 * Lo que no encuentra concepto NO se descarta en silencio: sale en
 * `sinConcepto` para que la pantalla lo pueda avisar. Un presupuesto que
 * desaparece sin rastro es exactamente el fallo que este archivo corrige.
 */
export function repartirEnConceptos(
  porCuenta: Map<string, number>,
  conceptos: Map<string, Map<string, number>>,
): RepartoPresupuesto {
  const acum = new Map<string, PresupuestoConcepto>();
  const sinConcepto: CuentaSinConcepto[] = [];

  const sumar = (empresa: string, concepto: string, monto: number) => {
    const k = empresa + '|' + concepto;
    const prev = acum.get(k);
    if (prev) prev.presupuesto += monto;
    else acum.set(k, { empresa, concepto, presupuesto: monto });
  };

  for (const [clave, monto] of porCuenta) {
    const corte = clave.indexOf('|');
    const empresa = clave.slice(0, corte);
    const cuenta = clave.slice(corte + 1);
    const suyos = conceptos.get(clave);

    if (!suyos || suyos.size === 0) {
      sinConcepto.push({ empresa, cuenta, monto });
      continue;
    }

    const pesos = Array.from(suyos.entries());
    if (pesos.length === 1) {
      sumar(empresa, pesos[0][0], monto);
      continue;
    }

    const total = pesos.reduce((s, par) => s + par[1], 0);
    // El último concepto se lleva el residuo para que la suma de las partes sea
    // exactamente el monto, sin derrape de redondeo.
    let repartido = 0;
    pesos.forEach((par, i) => {
      const ultimo = i === pesos.length - 1;
      const parte = ultimo
        ? redondear(monto - repartido)
        : redondear(total > 0 ? (monto * par[1]) / total : monto / pesos.length);
      repartido += parte;
      sumar(empresa, par[0], parte);
    });
  }

  const porConcepto = Array.from(acum.values()).map((p) => ({
    empresa: p.empresa,
    concepto: p.concepto,
    presupuesto: redondear(p.presupuesto),
  }));
  return { porConcepto, sinConcepto };
}
