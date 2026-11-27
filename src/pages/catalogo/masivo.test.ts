import { describe, expect, it } from 'vitest';
import {
  calcularCambiosFila,
  crearLector,
  crearResolvedor,
  detectarColisiones,
  enParalelo,
  llaveCatalogo,
  parsearConversion,
  parsearFilaImportacion,
  type Resolvedores,
} from './masivo';

// Centros de costo con los casos reales que rompían el emparejamiento:
// un nombre que es el código de otro centro y un nombre contenido en otro.
const CENTROS = [
  { id: 'cc-gerencia', nombre: 'Administracion Comercial (Gerencia)', codigo: '99.01.080.05' },
  { id: 'cc-99', nombre: '99.01.080.05', codigo: '99.01.080.05' },
  { id: 'cc-0', nombre: '0-00-00', codigo: '0-00-00' },
  { id: 'cc-0b', nombre: '10-0-00-00', codigo: '10-0-00-00' },
  { id: 'cc-a', nombre: '01.01.00001', codigo: '01.01.00001' },
];

const resolvedores: Resolvedores = {
  organizacion: crearResolvedor([{ id: 'org-1', nombre: 'Mayoreo', codigo: 'MAYOREO' }]),
  pais: crearResolvedor([
    { id: 'p-ve', nombre: 'Venezuela', codigo: 'VNZ' },
    { id: 'p-co', nombre: 'Colombia', codigo: 'COL' },
  ]),
  compania: crearResolvedor([
    { id: 'c-beval', nombre: 'BEVAL', codigo: 'BEVAL' },
    { id: 'c-febeca', nombre: 'FEBECA', codigo: 'FEBECA' },
  ]),
  centroCosto: crearResolvedor(CENTROS),
};

const ENCABEZADOS_EXPORT = [
  'ID', 'Linea', 'Grupo', 'Cuenta', 'Descripcion', 'Saldo Normal', 'Comercializadora', 'Balance_GyP',
  'Clasificacion', 'Clasificacion 1', 'Clasificacion 2', 'Clasificacion Combinado 1',
  'Clasificacion Combinado 2', 'Clasificacion Combinado 3', 'Orden Clasificacion', 'Conversion', 'Activa',
  'Organizacion', 'Pais', 'Compania', 'Centro Costo',
];

const ACTUAL = {
  id: 'fila-1',
  linea: 7,
  grupo: 7,
  cuenta: '7.1.1.01.1.001',
  descripcion: 'Sueldos',
  saldo_normal: 'Deudor',
  comercializadora: null,
  balance_gyp: 'GYP',
  clasificacion: 'Gastos',
  clasificacion_1: null,
  clasificacion_2: null,
  clasificacion_combinado_1: null,
  clasificacion_combinado_2: null,
  clasificacion_combinado_3: null,
  orden_clasificacion: 1,
  conversion: false,
  activa: true,
  organizacion_id: 'org-1',
  pais_id: 'p-ve',
  compania_id: 'c-beval',
  centro_costo_id: 'cc-99',
};

/** La fila tal como la escribe «Exportar Catálogo». */
const filaExportada = (): Record<string, unknown> => ({
  ID: 'fila-1', Linea: 7, Grupo: 7, Cuenta: '7.1.1.01.1.001', Descripcion: 'Sueldos',
  'Saldo Normal': 'Deudor', Comercializadora: '', Balance_GyP: 'GYP', Clasificacion: 'Gastos',
  'Clasificacion 1': '', 'Clasificacion 2': '', 'Clasificacion Combinado 1': '',
  'Clasificacion Combinado 2': '', 'Clasificacion Combinado 3': '', 'Orden Clasificacion': 1,
  Conversion: 'No', Activa: 'SI', Organizacion: 'Mayoreo', Pais: 'Venezuela', Compania: 'BEVAL',
  'Centro Costo': '99.01.080.05',
});

describe('crearResolvedor', () => {
  const cc = resolvedores.centroCosto;

  it('prefiere el nombre exacto sobre el código de otro centro', () => {
    // Antes: «99.01.080.05» devolvía el primer centro cuyo nombre O código
    // coincidiera, y podía ser «Administracion Comercial (Gerencia)».
    expect(cc('99.01.080.05')).toEqual({ estado: 'ok', id: 'cc-99' });
  });

  it('no hace coincidencias parciales', () => {
    expect(cc('0-00')).toEqual({ estado: 'no_encontrado', texto: '0-00' });
    expect(cc('01.01.0000')).toEqual({ estado: 'no_encontrado', texto: '01.01.0000' });
  });

  it('ignora mayúsculas, tildes y espacios de sobra', () => {
    expect(cc('  administración   comercial (gerencia) ')).toEqual({ estado: 'ok', id: 'cc-gerencia' });
  });

  it('busca por código cuando ningún nombre coincide', () => {
    expect(resolvedores.pais('col')).toEqual({ estado: 'ok', id: 'p-co' });
  });

  it('marca como ambiguo un código repetido sin nombre que coincida', () => {
    const r = crearResolvedor([
      { id: 'a', nombre: 'Uno', codigo: 'X1' },
      { id: 'b', nombre: 'Dos', codigo: 'X1' },
    ]);
    expect(r('X1').estado).toBe('ambiguo');
  });

  it('celda vacía = vacío', () => {
    expect(cc('')).toEqual({ estado: 'vacio' });
    expect(cc(undefined)).toEqual({ estado: 'vacio' });
  });
});

describe('calcularCambiosFila (actualización masiva)', () => {
  const lector = crearLector(ENCABEZADOS_EXPORT);

  it('un export sin tocar no genera cambios', () => {
    expect(calcularCambiosFila(filaExportada(), ACTUAL, lector, resolvedores)).toEqual({ cambios: {}, errores: [] });
  });

  it('cambia el centro de costo', () => {
    const fila = { ...filaExportada(), 'Centro Costo': '01.01.00001' };
    expect(calcularCambiosFila(fila, ACTUAL, lector, resolvedores)).toEqual({
      cambios: { centro_costo_id: 'cc-a' },
      errores: [],
    });
  });

  it('una celda de ubicación vacía NO borra la ubicación', () => {
    const fila = { ...filaExportada(), 'Centro Costo': '', Compania: '' };
    expect(calcularCambiosFila(fila, ACTUAL, lector, resolvedores).cambios).toEqual({});
  });

  it('un archivo con solo ID y Conversión cambia solo la conversión', () => {
    const lectorCorto = crearLector(['ID', 'Conversión']);
    const r = calcularCambiosFila({ ID: 'fila-1', 'Conversión': 'Sí' }, ACTUAL, lectorCorto, resolvedores);
    expect(r).toEqual({ cambios: { conversion: true }, errores: [] });
  });

  it('acepta encabezados alternativos del centro de costo', () => {
    for (const h of ['CC', 'Centro de Costo', 'centro_costo', 'CENTRO COSTO']) {
      const l = crearLector(['ID', h]);
      const r = calcularCambiosFila({ ID: 'fila-1', [h]: '0-00-00' }, ACTUAL, l, resolvedores);
      expect(r.cambios).toEqual({ centro_costo_id: 'cc-0' });
    }
  });

  it('un centro de costo inexistente deja la fila sin tocar y lo informa', () => {
    const fila = { ...filaExportada(), 'Centro Costo': 'NO EXISTE', Descripcion: 'Otra' };
    const r = calcularCambiosFila(fila, ACTUAL, lector, resolvedores);
    expect(r.cambios).toEqual({});
    expect(r.errores).toEqual(['Centro de costo "NO EXISTE" no existe']);
  });

  it('Conversión distinta de Si/No deja la fila sin tocar', () => {
    const r = calcularCambiosFila({ ...filaExportada(), Conversion: 'Tal vez' }, ACTUAL, lector, resolvedores);
    expect(r.cambios).toEqual({});
    expect(r.errores[0]).toMatch(/Conversión/);
  });

  it('detecta cambios de texto, número y estado', () => {
    const fila = { ...filaExportada(), Descripcion: 'Sueldos y salarios', Linea: '8', Activa: 'NO' };
    expect(calcularCambiosFila(fila, ACTUAL, lector, resolvedores).cambios).toEqual({
      descripcion: 'Sueldos y salarios',
      linea: 8,
      activa: false,
    });
  });
});

describe('detectarColisiones', () => {
  const actuales = new Map<string, Record<string, unknown>>([
    ['a', { id: 'a', cuenta: '7.1', compania_id: 'c1', centro_costo_id: 'cc1' }],
    ['b', { id: 'b', cuenta: '7.1', compania_id: 'c1', centro_costo_id: 'cc2' }],
  ]);

  it('avisa si el nuevo centro de costo ya tiene esa cuenta', () => {
    const col = detectarColisiones([{ id: 'a', cambios: { centro_costo_id: 'cc2' } }], actuales);
    expect([...col.keys()]).toEqual(['a']);
  });

  it('permite intercambiar centros de costo entre dos filas', () => {
    const col = detectarColisiones(
      [
        { id: 'a', cambios: { centro_costo_id: 'cc2' } },
        { id: 'b', cambios: { centro_costo_id: 'cc1' } },
      ],
      actuales,
    );
    expect(col.size).toBe(0);
  });
});

describe('parsearFilaImportacion (carga masiva)', () => {
  const lector = crearLector(ENCABEZADOS_EXPORT.filter((h) => h !== 'ID'));

  it('arma el registro con las ubicaciones resueltas', () => {
    const p = parsearFilaImportacion(filaExportada(), lector, resolvedores)!;
    expect(p.errores).toEqual([]);
    expect(p.registro).toMatchObject({
      cuenta: '7.1.1.01.1.001',
      conversion: false,
      organizacion_id: 'org-1',
      pais_id: 'p-ve',
      compania_id: 'c-beval',
      centro_costo_id: 'cc-99',
    });
    expect(llaveCatalogo(p.registro)).toBe(llaveCatalogo(ACTUAL));
  });

  it('omite filas sin cuenta o descripción', () => {
    expect(parsearFilaImportacion({ ...filaExportada(), Cuenta: '' }, lector, resolvedores)).toBeNull();
  });

  it('exige compañía y centro de costo existentes', () => {
    const p = parsearFilaImportacion(
      { ...filaExportada(), Compania: '', 'Centro Costo': 'Cofersa Central' },
      lector,
      resolvedores,
    )!;
    expect(p.errores).toEqual(['Centro de costo "Cofersa Central" no existe', 'Falta la compañía']);
  });
});

describe('utilidades', () => {
  it('parsearConversion solo acepta Si / No', () => {
    expect(parsearConversion('SÍ')).toBe(true);
    expect(parsearConversion(' no ')).toBe(false);
    expect(parsearConversion('')).toBeUndefined();
    expect(parsearConversion('x')).toBeNull();
  });

  it('enParalelo procesa todo respetando el límite', async () => {
    let activos = 0;
    let maximo = 0;
    const hechos: number[] = [];
    await enParalelo([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      activos++;
      maximo = Math.max(maximo, activos);
      await new Promise((r) => setTimeout(r, 1));
      hechos.push(n);
      activos--;
    });
    expect(hechos.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(maximo).toBeLessThanOrEqual(3);
  });
});
