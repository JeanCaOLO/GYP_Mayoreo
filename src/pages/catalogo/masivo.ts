/**
 * Lógica pura de la carga masiva y la actualización masiva del Catálogo GYP.
 *
 * El catálogo guarda una fila por cuenta × compañía × centro de costo, y la
 * base no tiene ninguna restricción única además del `id`. Por eso la llave
 * (cuenta, compañía, centro de costo) se valida aquí: si no, una carga repetida
 * duplica filas y un cambio de centro de costo puede chocar con otra fila.
 *
 * Las ubicaciones (organización, país, compañía, centro de costo) se resuelven
 * por coincidencia EXACTA: primero por nombre y, si no hay, por código. No hay
 * coincidencia parcial: con nombres como «01.01.00001» o «0-00-00» una
 * coincidencia parcial asigna en silencio otro centro de costo.
 */

// ---------------------------------------------------------------------------
// Texto y encabezados
// ---------------------------------------------------------------------------

/** Minúsculas, sin tildes y con los espacios colapsados. */
export const normalizarTexto = (v: unknown): string =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Igual que `normalizarTexto`, pero además quita espacios, guiones, «_» y «/». */
export const normalizarEncabezado = (h: unknown): string =>
  normalizarTexto(h).replace(/[\s\-_/]+/g, '');

/** Variantes aceptadas para cada columna del Excel. */
export const COLUMNAS = {
  id: ['ID', 'Id'],
  linea: ['Linea', 'Línea', 'Line'],
  grupo: ['Grupo', 'Group'],
  cuenta: ['Cuenta', 'Codigo', 'Code'],
  descripcion: ['Descripcion', 'Descripción', 'Desc', 'Nombre'],
  saldoNormal: ['Saldo Normal', 'Saldo'],
  comercializadora: ['Comercializadora', 'Comercial'],
  balanceGyp: ['Balance_GyP', 'Balance / GyP', 'Balance GyP', 'Balance'],
  clasificacion: ['Clasificacion', 'Clasificación', 'Clase', 'Categoria'],
  clasificacion1: ['Clasificacion 1', 'Clasificación 1', 'Sub Clasificacion', 'Subclasificacion'],
  clasificacion2: ['Clasificacion 2', 'Clasificación 2', 'Sub Clasificacion 2', 'Subclasificacion 2'],
  combinado1: ['Clasificacion Combinado 1', 'Clasificación Combinado 1'],
  combinado2: ['Clasificacion Combinado 2', 'Clasificación Combinado 2'],
  combinado3: ['Clasificacion Combinado 3', 'Clasificación Combinado 3'],
  orden: ['Orden Clasificacion', 'Orden Clasificación', 'Orden', 'Order'],
  conversion: ['Conversion', 'Conversión'],
  activa: ['Activa', 'Estado'],
  organizacion: ['Organizacion', 'Organización', 'Org'],
  pais: ['Pais', 'País', 'Country'],
  compania: ['Compania', 'Compañia', 'Compañía', 'Cia', 'Company'],
  centroCosto: ['Centro Costo', 'Centro de Costo', 'Centro Costos', 'Centro de Costos', 'CC', 'Cost Center'],
} as const;

export type Columna = keyof typeof COLUMNAS;
export type FilaExcel = Record<string, unknown>;

/**
 * Lector de celdas tolerante a tildes, mayúsculas y separadores en el
 * encabezado. Devuelve `undefined` si la columna no existe o la celda está
 * vacía.
 */
export function crearLector(encabezados: string[]) {
  const mapa = new Map<string, string>();
  for (const h of encabezados) {
    const n = normalizarEncabezado(h);
    if (n && !mapa.has(n)) mapa.set(n, h);
  }
  const tiene = (col: Columna) => COLUMNAS[col].some((v) => mapa.has(normalizarEncabezado(v)));
  const leer = (fila: FilaExcel, col: Columna): unknown => {
    for (const v of COLUMNAS[col]) {
      const original = mapa.get(normalizarEncabezado(v));
      if (original === undefined) continue;
      const valor = fila[original];
      if (valor === undefined || valor === null) continue;
      if (typeof valor === 'string' && valor.trim() === '') continue;
      return valor;
    }
    return undefined;
  };
  return { leer, tiene };
}

export type Lector = ReturnType<typeof crearLector>;

/**
 * Columna «Conversión»: solo «Si» o «No» (sin importar mayúsculas ni tildes).
 * undefined = celda vacía · null = valor no permitido.
 */
export const parsearConversion = (raw: unknown): boolean | null | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const s = normalizarTexto(raw);
  if (s === '') return undefined;
  if (s === 'si') return true;
  if (s === 'no') return false;
  return null;
};

/** Número de una celda. undefined = vacía · NaN = no numérica. */
export const parsearNumero = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  return Number(raw);
};

// ---------------------------------------------------------------------------
// Ubicaciones
// ---------------------------------------------------------------------------

export interface Entidad {
  id: string;
  nombre: string;
  codigo?: string | null;
}

export type Resolucion =
  | { estado: 'vacio' }
  | { estado: 'ok'; id: string }
  | { estado: 'no_encontrado'; texto: string }
  | { estado: 'ambiguo'; texto: string };

/**
 * Resuelve el texto de una celda a un id. Exacto por nombre; si ningún nombre
 * coincide, exacto por código. Si coincide con más de una entidad, es ambiguo.
 */
export function crearResolvedor(entidades: Entidad[]) {
  const porNombre = new Map<string, Set<string>>();
  const porCodigo = new Map<string, Set<string>>();
  const agregar = (m: Map<string, Set<string>>, k: string, id: string) => {
    if (!k) return;
    const s = m.get(k) ?? new Set<string>();
    s.add(id);
    m.set(k, s);
  };
  for (const e of entidades) {
    agregar(porNombre, normalizarTexto(e.nombre), e.id);
    agregar(porCodigo, normalizarTexto(e.codigo), e.id);
  }
  return (raw: unknown): Resolucion => {
    const texto = String(raw ?? '').trim();
    const k = normalizarTexto(texto);
    if (!k) return { estado: 'vacio' };
    const ids = porNombre.get(k) ?? porCodigo.get(k);
    if (!ids) return { estado: 'no_encontrado', texto };
    if (ids.size > 1) return { estado: 'ambiguo', texto };
    return { estado: 'ok', id: [...ids][0] };
  };
}

export type Resolvedor = ReturnType<typeof crearResolvedor>;

export interface Resolvedores {
  organizacion: Resolvedor;
  pais: Resolvedor;
  compania: Resolvedor;
  centroCosto: Resolvedor;
}

const UBICACIONES = [
  { col: 'organizacion', campo: 'organizacion_id', etiqueta: 'Organización' },
  { col: 'pais', campo: 'pais_id', etiqueta: 'País' },
  { col: 'compania', campo: 'compania_id', etiqueta: 'Compañía' },
  { col: 'centroCosto', campo: 'centro_costo_id', etiqueta: 'Centro de costo' },
] as const;

const mensajeUbicacion = (etiqueta: string, r: Resolucion): string | null => {
  if (r.estado === 'no_encontrado') return `${etiqueta} "${r.texto}" no existe`;
  if (r.estado === 'ambiguo') return `${etiqueta} "${r.texto}" coincide con varios registros`;
  return null;
};

// ---------------------------------------------------------------------------
// Llave del catálogo
// ---------------------------------------------------------------------------

/** Llave de negocio de una fila: cuenta × compañía × centro de costo. */
export const llaveCatalogo = (r: {
  cuenta?: unknown;
  compania_id?: unknown;
  centro_costo_id?: unknown;
}): string =>
  [normalizarTexto(r.cuenta), String(r.compania_id ?? ''), String(r.centro_costo_id ?? '')].join('|');

// ---------------------------------------------------------------------------
// Actualización masiva
// ---------------------------------------------------------------------------

type TipoCampo = 'texto' | 'numero' | 'booleano';

/** Campos que la actualización masiva compara y puede cambiar. */
export const CAMPOS_ACTUALIZABLES: { col: Columna; campo: string; tipo: TipoCampo }[] = [
  { col: 'linea', campo: 'linea', tipo: 'numero' },
  { col: 'grupo', campo: 'grupo', tipo: 'numero' },
  { col: 'cuenta', campo: 'cuenta', tipo: 'texto' },
  { col: 'descripcion', campo: 'descripcion', tipo: 'texto' },
  { col: 'saldoNormal', campo: 'saldo_normal', tipo: 'texto' },
  { col: 'comercializadora', campo: 'comercializadora', tipo: 'texto' },
  { col: 'balanceGyp', campo: 'balance_gyp', tipo: 'texto' },
  { col: 'clasificacion', campo: 'clasificacion', tipo: 'texto' },
  { col: 'clasificacion1', campo: 'clasificacion_1', tipo: 'texto' },
  { col: 'clasificacion2', campo: 'clasificacion_2', tipo: 'texto' },
  { col: 'combinado1', campo: 'clasificacion_combinado_1', tipo: 'texto' },
  { col: 'combinado2', campo: 'clasificacion_combinado_2', tipo: 'texto' },
  { col: 'combinado3', campo: 'clasificacion_combinado_3', tipo: 'texto' },
  { col: 'orden', campo: 'orden_clasificacion', tipo: 'numero' },
  { col: 'activa', campo: 'activa', tipo: 'booleano' },
];

const parsearActiva = (raw: unknown): boolean | null => {
  const s = normalizarTexto(raw);
  if (['si', 'true', '1', 'yes', 'activa', 'activo'].includes(s)) return true;
  if (['no', 'false', '0', 'inactiva', 'inactivo'].includes(s)) return false;
  return null;
};

export interface ResultadoFilaActualizacion {
  cambios: Record<string, unknown>;
  /** Si hay errores, la fila no se actualiza (ni parcialmente). */
  errores: string[];
}

/**
 * Compara una fila del Excel con el registro actual y devuelve solo lo que
 * cambia. Una celda vacía o una columna ausente significa «sin cambio»
 * (también en las ubicaciones: antes una celda vacía borraba la ubicación).
 */
export function calcularCambiosFila(
  fila: FilaExcel,
  actual: Record<string, unknown>,
  lector: Lector,
  resolvedores: Resolvedores,
): ResultadoFilaActualizacion {
  const cambios: Record<string, unknown> = {};
  const errores: string[] = [];

  for (const { col, campo, tipo } of CAMPOS_ACTUALIZABLES) {
    const raw = lector.leer(fila, col);
    if (raw === undefined) continue;
    const viejo = actual[campo];

    if (tipo === 'numero') {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        errores.push(`${COLUMNAS[col][0]} "${String(raw)}" no es un número`);
        continue;
      }
      if (viejo === null || viejo === undefined || Number(viejo) !== n) cambios[campo] = n;
    } else if (tipo === 'booleano') {
      const b = parsearActiva(raw);
      if (b === null) {
        errores.push(`${COLUMNAS[col][0]} "${String(raw)}" no válido (Si o No)`);
        continue;
      }
      if (Boolean(viejo) !== b) cambios[campo] = b;
    } else {
      const s = String(raw).trim();
      if (String(viejo ?? '').trim() !== s) cambios[campo] = s;
    }
  }

  const conversion = parsearConversion(lector.leer(fila, 'conversion'));
  if (conversion === null) {
    errores.push(`Conversión "${String(lector.leer(fila, 'conversion'))}" no válida (solo Si o No)`);
  } else if (conversion !== undefined && Boolean(actual.conversion) !== conversion) {
    cambios.conversion = conversion;
  }

  for (const u of UBICACIONES) {
    const r = resolvedores[u.col](lector.leer(fila, u.col));
    const msg = mensajeUbicacion(u.etiqueta, r);
    if (msg) {
      errores.push(msg);
    } else if (r.estado === 'ok' && String(actual[u.campo] ?? '') !== r.id) {
      cambios[u.campo] = r.id;
    }
  }

  return { cambios: errores.length ? {} : cambios, errores };
}

/**
 * Revisa que, tras aplicar los cambios, ninguna fila quede con la misma
 * cuenta × compañía × centro de costo que otra. Devuelve id → motivo.
 */
export function detectarColisiones(
  actualizaciones: { id: string; cambios: Record<string, unknown> }[],
  actuales: Map<string, Record<string, unknown>>,
): Map<string, string> {
  const final = new Map<string, Record<string, unknown>>();
  for (const [id, fila] of actuales) final.set(id, fila);
  for (const a of actualizaciones) {
    const base = actuales.get(a.id);
    if (base) final.set(a.id, { ...base, ...a.cambios });
  }
  const porLlave = new Map<string, string[]>();
  for (const [id, fila] of final) {
    const k = llaveCatalogo(fila);
    const ids = porLlave.get(k);
    if (ids) ids.push(id);
    else porLlave.set(k, [id]);
  }
  const colisiones = new Map<string, string>();
  const tocadas = new Set(actualizaciones.map((a) => a.id));
  for (const ids of porLlave.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      if (!tocadas.has(id)) continue;
      const fila = final.get(id)!;
      colisiones.set(
        id,
        `Ya existe otra fila con la cuenta ${String(fila.cuenta)} en esa compañía y centro de costo`,
      );
    }
  }
  return colisiones;
}

// ---------------------------------------------------------------------------
// Carga masiva
// ---------------------------------------------------------------------------

export interface FilaImportada {
  /** Registro listo para insertar (solo si `errores` está vacío). */
  registro: Record<string, unknown>;
  errores: string[];
  avisos: string[];
  ubicaciones: Record<'organizacion' | 'pais' | 'compania' | 'centroCosto', { texto: string; id: string | null }>;
  conversion: boolean | null;
}

const texto = (lector: Lector, fila: FilaExcel, col: Columna) => String(lector.leer(fila, col) ?? '').trim();

/**
 * Convierte una fila del Excel en un registro nuevo del catálogo. Devuelve
 * null si la fila no tiene cuenta o descripción (se omite). Compañía y centro
 * de costo son obligatorios: todas las filas del catálogo los tienen.
 */
export function parsearFilaImportacion(
  fila: FilaExcel,
  lector: Lector,
  resolvedores: Resolvedores,
): FilaImportada | null {
  const cuenta = texto(lector, fila, 'cuenta');
  const descripcion = texto(lector, fila, 'descripcion');
  if (!cuenta || !descripcion) return null;

  const errores: string[] = [];
  const avisos: string[] = [];

  const numero = (col: Columna): number | null => {
    const n = parsearNumero(lector.leer(fila, col));
    if (n === undefined) return null;
    if (Number.isNaN(n)) {
      avisos.push(`${COLUMNAS[col][0]} "${String(lector.leer(fila, col))}" no es un número (queda vacío)`);
      return null;
    }
    return n;
  };

  const conversionRaw = lector.leer(fila, 'conversion');
  const conversion = parsearConversion(conversionRaw);
  if (conversion === null) errores.push(`Conversión "${String(conversionRaw)}" no válida (solo Si o No)`);

  const ubicaciones = {} as FilaImportada['ubicaciones'];
  const ids: Record<string, string | null> = {};
  for (const u of UBICACIONES) {
    const t = texto(lector, fila, u.col);
    const r = resolvedores[u.col](t);
    const msg = mensajeUbicacion(u.etiqueta, r);
    if (msg) errores.push(msg);
    const id = r.estado === 'ok' ? r.id : null;
    ids[u.campo] = id;
    ubicaciones[u.col] = { texto: t, id };
  }
  if (!ubicaciones.compania.texto) errores.push('Falta la compañía');
  if (!ubicaciones.centroCosto.texto) errores.push('Falta el centro de costo');

  const registro: Record<string, unknown> = {
    linea: numero('linea'),
    grupo: numero('grupo'),
    cuenta,
    descripcion,
    saldo_normal: texto(lector, fila, 'saldoNormal') || null,
    comercializadora: texto(lector, fila, 'comercializadora') || null,
    balance_gyp: texto(lector, fila, 'balanceGyp') || null,
    clasificacion: texto(lector, fila, 'clasificacion') || null,
    clasificacion_1: texto(lector, fila, 'clasificacion1') || null,
    clasificacion_2: texto(lector, fila, 'clasificacion2') || null,
    clasificacion_combinado_1: texto(lector, fila, 'combinado1') || null,
    clasificacion_combinado_2: texto(lector, fila, 'combinado2') || null,
    clasificacion_combinado_3: texto(lector, fila, 'combinado3') || null,
    orden_clasificacion: numero('orden'),
    conversion: conversion ?? false,
    activa: true,
    ...ids,
  };

  return { registro, errores, avisos, ubicaciones, conversion: conversion === null ? null : (conversion ?? false) };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Ejecuta `fn` sobre cada elemento con a lo sumo `limite` en paralelo. */
export async function enParalelo<T>(
  items: T[],
  limite: number,
  fn: (item: T, i: number) => Promise<void>,
  alAvanzar?: (hechos: number) => void,
): Promise<void> {
  let siguiente = 0;
  let hechos = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      await fn(items[i], i);
      hechos++;
      alAvanzar?.(hechos);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
}
