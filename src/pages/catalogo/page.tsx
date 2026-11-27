import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { CatalogoItem } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmModal } from '@/components/base/ConfirmModal';
import { Modal } from '@/components/base/Modal';
import { ProgressModal } from '@/components/base/ProgressModal';
import { CatalogoModal } from '@/pages/catalogo/components/CatalogoModal';
import ImportPreviewModal from '@/pages/catalogo/components/ImportPreviewModal';
import type { ImportPreviewRow } from '@/pages/catalogo/components/ImportPreviewModal';
import { useUbicaciones } from '@/hooks/useUbicaciones';
import { usePermissions } from '@/hooks/usePermissions';
import {
  calcularCambiosFila,
  crearLector,
  crearResolvedor,
  detectarColisiones,
  enParalelo,
  llaveCatalogo,
  parsearFilaImportacion,
  type Entidad,
  type FilaExcel,
  type Resolvedores,
} from '@/pages/catalogo/masivo';

const PAGE_SIZE = 50;
const TAM_PAGINA_BD = 1000;

/**
 * Lee una tabla completa paginando con `.range()`. El catálogo ya pasa de
 * 8.800 filas: un `.limit()` fijo o el tope de filas de la API lo cortan en
 * silencio. Siempre ordena también por `id` para que las páginas no se
 * solapen (la cuenta se repite por compañía y centro de costo).
 */
async function traerTodo<T>(tabla: string, columnas: string, orden: string[] = []): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += TAM_PAGINA_BD) {
    let q = supabase.from(tabla).select(columnas);
    for (const o of [...orden, 'id']) q = q.order(o, { ascending: true });
    const { data, error } = await q.range(desde, desde + TAM_PAGINA_BD - 1);
    if (error) throw error;
    const pagina = (data ?? []) as T[];
    out.push(...pagina);
    if (pagina.length < TAM_PAGINA_BD) break;
  }
  return out;
}

/** Organizaciones, países, compañías y centros de costo frescos de la base. */
async function traerResolvedores(): Promise<{ resolvedores: Resolvedores; nombres: Map<string, string> }> {
  const [orgs, paises, companias, centros] = await Promise.all([
    traerTodo<Entidad>('organizaciones', 'id,nombre,codigo'),
    traerTodo<Entidad>('paises', 'id,nombre,codigo'),
    traerTodo<Entidad>('companias', 'id,nombre,codigo'),
    traerTodo<Entidad>('centros_costos', 'id,nombre,codigo'),
  ]);
  const nombres = new Map<string, string>();
  for (const e of [...orgs, ...paises, ...companias, ...centros]) nombres.set(e.id, e.nombre);
  return {
    resolvedores: {
      organizacion: crearResolvedor(orgs),
      pais: crearResolvedor(paises),
      compania: crearResolvedor(companias),
      centroCosto: crearResolvedor(centros),
    },
    nombres,
  };
}

/** Inserta el historial en lotes; si falla, no detiene la operación. */
async function registrarHistorial(filas: Record<string, unknown>[]) {
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await supabase.from('catalogo_gyp_historico').insert(filas.slice(i, i + 500));
    if (error) console.warn('No se pudo registrar el historial:', error.message);
  }
}

const UBICACION_CAMPOS = new Set(['organizacion_id', 'pais_id', 'compania_id', 'centro_costo_id']);

interface ResultadoMasivo {
  titulo: string;
  resumen: string[];
  errores: string[];
}

export default function CatalogoPage() {
  const [items, setItems] = useState<CatalogoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filtroClasificacion, setFiltroClasificacion] = useState('');
  const [filtroClasificacion1, setFiltroClasificacion1] = useState('');
  const [filtroClasificacion2, setFiltroClasificacion2] = useState('');
  const [filtroComercializadora, setFiltroComercializadora] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'all' | 'active' | 'inactive'>('all');
  const [filtroOrganizacion, setFiltroOrganizacion] = useState('');
  const [filtroPais, setFiltroPais] = useState('');
  const [filtroCompania, setFiltroCompania] = useState('');
  const [filtroCentroCosto, setFiltroCentroCosto] = useState('');
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogoItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CatalogoItem | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<ImportPreviewRow[]>([]);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewStats, setPreviewStats] = useState({
    total: 0,
    skipped: 0,
    invalidNumbers: 0,
    missingUbicacion: 0,
    paisCount: 0,
    orgCount: 0,
    ccCount: 0,
    duplicates: 0,
    invalidConversion: 0,
    existentes: 0,
  });
  const [toInsert, setToInsert] = useState<Record<string, unknown>[]>([]);
  const [resultadoMasivo, setResultadoMasivo] = useState<ResultadoMasivo | null>(null);
  const [searchResults, setSearchResults] = useState<CatalogoItem[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isAdmin, user } = useAuth();
  const { addToast } = useToast();
  const { organizaciones, paises, companias, centrosCostos, organizacionesMap, paisesMap, companiasMap, centrosCostosMap } = useUbicaciones();
  const { isSuperAdmin, userScope, canEdit, canDelete } = usePermissions();
  const canWrite = canEdit;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await traerTodo<CatalogoItem>('catalogo_gyp', '*', ['cuenta']);
      setItems(data);
    } catch (err) {
      console.error('Error al cargar catálogo:', err);
      const msg = (err as Error).message;
      setError(msg);
      addToast('error', `Error al cargar catálogo: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const clasificaciones = useMemo(() => [...new Set(items.map((i) => i.clasificacion).filter(Boolean))].sort(), [items]);
  const clasificaciones1 = useMemo(() => [...new Set(items.map((i) => i.clasificacion_1).filter(Boolean))].sort(), [items]);
  const clasificaciones2 = useMemo(() => [...new Set(items.map((i) => i.clasificacion_2).filter(Boolean))].sort(), [items]);
  const comercializadoras = useMemo(() => [...new Set(items.map((i) => i.comercializadora).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        !search ||
        item.cuenta.toLowerCase().includes(search.toLowerCase()) ||
        item.descripcion.toLowerCase().includes(search.toLowerCase()) ||
        (item.clasificacion && item.clasificacion.toLowerCase().includes(search.toLowerCase()));
      const matchesClas = !filtroClasificacion || item.clasificacion === filtroClasificacion;
      const matchesClas1 = !filtroClasificacion1 || item.clasificacion_1 === filtroClasificacion1;
      const matchesClas2 = !filtroClasificacion2 || item.clasificacion_2 === filtroClasificacion2;
      const matchesCom = !filtroComercializadora || item.comercializadora === filtroComercializadora;
      const matchesEstado =
        filtroEstado === 'all' ||
        (filtroEstado === 'active' && item.activa) ||
        (filtroEstado === 'inactive' && !item.activa);
      const matchesOrganizacion = !filtroOrganizacion || item.organizacion_id === filtroOrganizacion;
      const matchesPais = !filtroPais || item.pais_id === filtroPais;
      const matchesCompania = !filtroCompania || item.compania_id === filtroCompania;
      const matchesCentroCosto = !filtroCentroCosto || item.centro_costo_id === filtroCentroCosto;
      return matchesSearch && matchesClas && matchesClas1 && matchesClas2 && matchesCom && matchesEstado && matchesOrganizacion && matchesPais && matchesCompania && matchesCentroCosto;
    });
  }, [items, search, filtroClasificacion, filtroClasificacion1, filtroClasificacion2, filtroComercializadora, filtroEstado, filtroOrganizacion, filtroPais, filtroCompania, filtroCentroCosto]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const stats = {
    total: items.length,
    activas: items.filter((i) => i.activa).length,
    inactivas: items.filter((i) => !i.activa).length,
  };

  // --- EXPORTAR CATÁLOGO COMPLETO ---
  const handleExportCatalogo = async () => {
    try {
      setImportProgress('Exportando...');
      const xlsx = await import('xlsx');

      // Traer datos (paginado) y ubicaciones en paralelo
      const [data, { nombres }] = await Promise.all([
        traerTodo<Record<string, unknown>>('catalogo_gyp', '*', ['cuenta']),
        traerResolvedores(),
      ]);
      if (data.length === 0) {
        addToast('warning', 'No hay registros en el catálogo para exportar.');
        setImportProgress(null);
        return;
      }

      // ID → nombre (el mismo nombre que la actualización masiva sabe leer)
      const nombre = (id: unknown) => (id ? nombres.get(String(id)) || '' : '');

      const headers = [
        'ID', 'Linea', 'Grupo', 'Cuenta', 'Descripcion', 'Saldo Normal',
        'Comercializadora', 'Balance_GyP', 'Clasificacion', 'Clasificacion 1',
        'Clasificacion 2', 'Clasificacion Combinado 1', 'Clasificacion Combinado 2', 'Clasificacion Combinado 3', 'Orden Clasificacion', 'Conversion', 'Activa',
        'Organizacion', 'Pais', 'Compania', 'Centro Costo',
      ];

      const rows = data.map((item) => [
        item.id,
        item.linea ?? '',
        item.grupo ?? '',
        item.cuenta ?? '',
        item.descripcion ?? '',
        item.saldo_normal ?? '',
        item.comercializadora ?? '',
        item.balance_gyp ?? '',
        item.clasificacion ?? '',
        item.clasificacion_1 ?? '',
        item.clasificacion_2 ?? '',
        item.clasificacion_combinado_1 ?? '',
        item.clasificacion_combinado_2 ?? '',
        item.clasificacion_combinado_3 ?? '',
        item.orden_clasificacion ?? '',
        item.conversion ? 'Si' : 'No',
        item.activa ? 'SI' : 'NO',
        nombre(item.organizacion_id),
        nombre(item.pais_id),
        nombre(item.compania_id),
        nombre(item.centro_costo_id),
      ]);

      const ws = xlsx.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = headers.map(() => ({ wch: 22 }));
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Catalogo GYP');
      const wbout = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Catalogo_GYP_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast('success', `${data.length} registros exportados`);
    } catch (err) {
      addToast('error', 'Error al exportar: ' + (err as Error).message);
    } finally {
      setImportProgress(null);
    }
  };

  // --- ACTUALIZACIÓN MASIVA ---
  // Identifica cada fila por la columna ID (la que trae «Exportar Catálogo»).
  // Celda vacía o columna ausente = sin cambio. Una fila con algún valor no
  // válido (ubicación inexistente, Conversión distinta de Si/No…) no se toca y
  // se informa en el resumen con su número de fila.
  const handleMassUpdate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setImportProgress('Leyendo archivo para actualizar...');
    try {
      const xlsx = await import('xlsx');
      const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = xlsx.utils.sheet_to_json(sheet, { defval: '' }) as FilaExcel[];

      if (json.length === 0) {
        addToast('warning', 'El archivo está vacío.');
        return;
      }

      const lector = crearLector(Object.keys(json[0]));
      if (!lector.tiene('id')) {
        addToast('error', 'El archivo debe tener la columna "ID" para identificar los registros. Usá "Exportar Catálogo" para obtener el archivo con IDs.');
        return;
      }

      setImportProgress('Comparando con datos actuales...');
      const [actualesArr, { resolvedores, nombres }] = await Promise.all([
        traerTodo<Record<string, unknown>>('catalogo_gyp', '*'),
        traerResolvedores(),
      ]);
      const actuales = new Map(actualesArr.map((r) => [String(r.id), r]));

      const errores: string[] = [];
      const vistos = new Set<string>();
      let sinId = 0;
      let sinCambios = 0;
      const candidatas: { id: string; fila: number; cambios: Record<string, unknown> }[] = [];

      json.forEach((row, i) => {
        const fila = i + 2; // fila 1 = encabezados
        const id = String(lector.leer(row, 'id') ?? '').trim();
        if (!id) { sinId++; return; }
        const actual = actuales.get(id);
        if (!actual) { errores.push(`Fila ${fila}: el ID ${id} no existe en el catálogo`); return; }
        if (vistos.has(id)) { errores.push(`Fila ${fila}: el ID está repetido en el archivo`); return; }
        vistos.add(id);

        const r = calcularCambiosFila(row, actual, lector, resolvedores);
        if (r.errores.length > 0) {
          errores.push(`Fila ${fila} (${String(actual.cuenta)}): ${r.errores.join('; ')}`);
        } else if (Object.keys(r.cambios).length === 0) {
          sinCambios++;
        } else {
          candidatas.push({ id, fila, cambios: r.cambios });
        }
      });

      // La base no impide duplicados: se revisa aquí que ningún cambio de
      // cuenta / compañía / centro de costo choque con otra fila.
      const colisiones = detectarColisiones(candidatas, actuales);
      const aplicar = candidatas.filter((c) => {
        const motivo = colisiones.get(c.id);
        if (motivo) errores.push(`Fila ${c.fila}: ${motivo}`);
        return !motivo;
      });

      let actualizadas = 0;
      const historial: Record<string, unknown>[] = [];
      if (aplicar.length > 0) {
        setImportProgress(`Actualizando 0 de ${aplicar.length}...`);
        const valorLegible = (campo: string, v: unknown) =>
          UBICACION_CAMPOS.has(campo) ? (v ? nombres.get(String(v)) ?? String(v) : '-') : String(v ?? '-');

        await enParalelo(
          aplicar,
          8,
          async (c) => {
            // `.select` para saber si la fila se actualizó de verdad: si una
            // política de la base lo impide, Supabase no devuelve error.
            const { data, error } = await supabase
              .from('catalogo_gyp')
              .update(c.cambios)
              .eq('id', c.id)
              .select('id');
            if (error) {
              errores.push(`Fila ${c.fila}: ${error.message}`);
              return;
            }
            if (!data || data.length === 0) {
              errores.push(`Fila ${c.fila}: la base no actualizó la fila (revisá permisos)`);
              return;
            }
            actualizadas++;
            const actual = actuales.get(c.id)!;
            const cuenta = String(c.cambios.cuenta ?? actual.cuenta);
            historial.push({
              catalogo_id: c.id,
              cuenta,
              descripcion: String(c.cambios.descripcion ?? actual.descripcion ?? ''),
              accion: 'actualizacion',
              cambios: Object.entries(c.cambios)
                .map(([campo, v]) => `${campo}: '${valorLegible(campo, actual[campo])}' → '${valorLegible(campo, v)}'`)
                .join('; '),
              resumen: `Cuenta ${cuenta} actualizada (actualización masiva)`,
            });
          },
          (hechos) => {
            if (hechos % 25 === 0 || hechos === aplicar.length) {
              setImportProgress(`Actualizando ${hechos} de ${aplicar.length}...`);
            }
          },
        );
        await registrarHistorial(historial);
      }

      errores.sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
      const resumen = [
        `${actualizadas} filas actualizadas`,
        `${sinCambios} sin cambios`,
        ...(sinId > 0 ? [`${sinId} filas sin ID (omitidas)`] : []),
        ...(errores.length > 0 ? [`${errores.length} filas no se actualizaron (ver detalle)`] : []),
      ];
      if (errores.length > 0) {
        setResultadoMasivo({ titulo: 'Resultado de la actualización masiva', resumen, errores });
      } else {
        addToast(actualizadas > 0 ? 'success' : 'info', resumen.join(', '));
      }
      if (actualizadas > 0) fetchData();
    } catch (err) {
      addToast('error', 'Error al actualizar: ' + (err as Error).message);
    } finally {
      setImportProgress(null);
      input.value = '';
    }
  };

  // --- DESCARGAR PLANTILLA ---
  const handleDownloadTemplate = async () => {
    try {
      const xlsx = await import('xlsx');
      const headers = [
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
        'Conversion',
        'Organizacion',
        'Pais',
        'Compania',
        'Centro Costo',
      ];
      // Fila de ejemplo realista para que el usuario vea el formato
      const ejemplo = [
        7,
        7,
        '7.1.1.01.1.001',
        'Descripción de la cuenta contable',
        'Deudor',
        'OLO',
        'GYP',
        'Gastos Operativos',
        'Gastos Varios',
        'Otros Gastos',
        '',
        '',
        '',
        1,
        'No',
        // Ubicaciones reales del sistema para que el ejemplo sea válido.
        organizaciones[0]?.nombre ?? '',
        paises.find((p) => p.id === companias[0]?.pais_id)?.nombre ?? paises[0]?.nombre ?? '',
        companias[0]?.nombre ?? '',
        centrosCostos[0]?.nombre ?? '',
      ];
      const ws = xlsx.utils.aoa_to_sheet([headers, ejemplo]);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Catalogo GYP');
      const instrucciones = xlsx.utils.aoa_to_sheet([
        ['Columna', 'Valores permitidos'],
        ['Cuenta, Descripcion', 'Obligatorias. Una fila sin ellas se omite.'],
        ['Compania, Centro Costo', 'Obligatorias. Nombre o código exacto, como aparece en Configuración.'],
        ['Organizacion, Pais', 'Opcionales. Si se llenan, deben existir con ese nombre o código exacto.'],
        ['Conversion', 'Si o No. Si se deja vacía se carga como No.'],
        ['Carga masiva', 'Solo crea cuentas nuevas: si ya existe la misma cuenta en esa compañía y centro de costo, la fila no se carga.'],
        ['Actualizar Masivo', 'Use el archivo de «Exportar Catálogo» (columna ID). Celda vacía = sin cambio.'],
      ]);
      instrucciones['!cols'] = [{ wch: 24 }, { wch: 100 }];
      xlsx.utils.book_append_sheet(wb, instrucciones, 'Instrucciones');
      const wbout = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Plantilla_Catalogo_GYP.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast('error', 'Error al generar plantilla: ' + (err as Error).message);
    }
  };

  // --- CARGADOR DE EXCEL (carga masiva) ---
  // Solo crea cuentas nuevas. La llave es cuenta × compañía × centro de costo:
  // si ya existe en el catálogo (o se repite en el archivo) la fila no se
  // inserta, porque la base no tiene restricción única y quedaría duplicada.
  // Para cambiar filas existentes está «Actualizar Masivo».
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setImportProgress('Leyendo archivo...');
    try {
      const xlsx = await import('xlsx');
      const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      // Encabezados exactos de la primera fila
      const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
      const headerRow: string[] = [];
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = sheet[xlsx.utils.encode_cell({ r: range.s.r, c: C })];
        headerRow.push(cell ? String(cell.v ?? '') : '');
      }
      const rawHeaders = headerRow.filter((h) => h.trim() !== '');
      setPreviewHeaders(rawHeaders);

      const json = xlsx.utils.sheet_to_json(sheet, { defval: '' }) as FilaExcel[];
      if (json.length === 0) {
        addToast('warning', 'El archivo está vacío o no tiene datos.');
        return;
      }

      const lector = crearLector(rawHeaders);
      if (!lector.tiene('cuenta')) {
        addToast('warning', `No se encontró la columna 'Cuenta'. Encabezados: ${rawHeaders.join(', ')}`);
        return;
      }

      setImportProgress('Cargando catálogos...');
      const [{ resolvedores }, existentesArr] = await Promise.all([
        traerResolvedores(),
        traerTodo<Record<string, unknown>>('catalogo_gyp', 'id,cuenta,compania_id,centro_costo_id'),
      ]);
      const llavesExistentes = new Set(existentesArr.map(llaveCatalogo));

      let skipped = 0;
      let invalidNumbers = 0;
      let missingUbicacion = 0;
      let paisCount = 0;
      let orgCount = 0;
      let ccCount = 0;
      let duplicates = 0;
      let invalidConversion = 0;
      let existentes = 0;
      const parsed: ImportPreviewRow[] = [];
      const batchToInsert: Record<string, unknown>[] = [];
      const llavesArchivo = new Set<string>();

      for (const row of json) {
        const p = parsearFilaImportacion(row, lector, resolvedores);
        if (!p) {
          skipped++;
          continue;
        }
        const { registro, ubicaciones } = p;
        const errores = [...p.errores];

        if (ubicaciones.pais.id) paisCount++;
        if (ubicaciones.organizacion.id) orgCount++;
        if (ubicaciones.centroCosto.id) ccCount++;
        if (Object.values(ubicaciones).some((u) => u.texto && !u.id)) missingUbicacion++;
        if (p.avisos.length > 0) invalidNumbers++;
        if (p.conversion === null) invalidConversion++;

        if (errores.length === 0) {
          const llave = llaveCatalogo(registro);
          if (llavesExistentes.has(llave)) {
            existentes++;
            errores.push('Ya existe en el catálogo (usá Actualizar Masivo para cambiarla)');
          } else if (llavesArchivo.has(llave)) {
            duplicates++;
            errores.push('Repetida en el archivo (misma cuenta, compañía y centro de costo)');
          } else {
            llavesArchivo.add(llave);
          }
        }

        const valido = errores.length === 0;
        if (valido) batchToInsert.push(registro);

        parsed.push({
          cuenta: String(registro.cuenta),
          descripcion: String(registro.descripcion),
          clasificacion: String(registro.clasificacion ?? ''),
          clasificacion_1: String(registro.clasificacion_1 ?? ''),
          clasificacion_2: String(registro.clasificacion_2 ?? ''),
          linea: registro.linea as number | null,
          grupo: registro.grupo as number | null,
          saldo_normal: String(registro.saldo_normal ?? ''),
          comercializadora: String(registro.comercializadora ?? ''),
          balance_gyp: String(registro.balance_gyp ?? ''),
          orden_clasificacion: registro.orden_clasificacion as number | null,
          conversion: p.conversion,
          pais_nombre: ubicaciones.pais.texto,
          pais_id: ubicaciones.pais.id,
          org_nombre: ubicaciones.organizacion.texto,
          org_id: ubicaciones.organizacion.id,
          cia_nombre: ubicaciones.compania.texto,
          cia_id: ubicaciones.compania.id,
          cc_nombre: ubicaciones.centroCosto.texto,
          cc_id: ubicaciones.centroCosto.id,
          valido,
          error: valido ? (p.avisos.length > 0 ? p.avisos.join('; ') : null) : errores.join('; '),
        });
      }

      // Primero las filas con problema, para que se vean en la vista previa.
      parsed.sort((a, b) => Number(a.valido) - Number(b.valido));

      setPreviewData(parsed);
      setPreviewStats({
        total: json.length,
        skipped,
        invalidNumbers,
        missingUbicacion,
        paisCount,
        orgCount,
        ccCount,
        duplicates,
        invalidConversion,
        existentes,
      });
      setToInsert(batchToInsert);
      setPreviewOpen(true);
    } catch (err) {
      addToast('error', 'Error al importar: ' + (err as Error).message);
    } finally {
      setImportProgress(null);
      input.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (toInsert.length === 0) {
      addToast('warning', 'No hay registros para importar.');
      return;
    }
    setImportProgress('Importando...');
    try {
      const BATCH_SIZE = 200;
      const creadas: { id: string; cuenta: string; descripcion: string }[] = [];
      const errores: string[] = [];

      const insertar = (filas: Record<string, unknown>[]) =>
        supabase.from('catalogo_gyp').insert(filas).select('id,cuenta,descripcion');

      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        setImportProgress(`Importando ${Math.min(i + batch.length, toInsert.length)} de ${toInsert.length} registros...`);
        const { data, error } = await insertar(batch);
        if (!error) {
          creadas.push(...((data ?? []) as typeof creadas));
          continue;
        }
        // Un lote falla entero si una sola fila falla: se reintenta fila por
        // fila para guardar las buenas y decir cuál falló.
        for (const fila of batch) {
          const r = await insertar([fila]);
          if (r.error) errores.push(`Cuenta ${String(fila.cuenta)}: ${r.error.message}`);
          else creadas.push(...((r.data ?? []) as typeof creadas));
        }
      }

      await registrarHistorial(
        creadas.map((c) => ({
          catalogo_id: c.id,
          cuenta: c.cuenta,
          descripcion: c.descripcion,
          accion: 'creacion',
          resumen: `Cuenta ${c.cuenta} creada (carga masiva)`,
        })),
      );

      if (errores.length > 0) {
        setResultadoMasivo({
          titulo: 'Resultado de la carga masiva',
          resumen: [`${creadas.length} cuentas creadas`, `${errores.length} fallaron (ver detalle)`],
          errores,
        });
      } else {
        addToast('success', `${creadas.length} cuentas creadas`);
      }
      setPreviewOpen(false);
      setPreviewData([]);
      setToInsert([]);
      fetchData();
    } catch (err) {
      addToast('error', 'Error al importar: ' + (err as Error).message);
    } finally {
      setImportProgress(null);
    }
  };

  const handleSave = async (formData: Record<string, unknown>) => {
    try {
      if (editing) {
        const { error } = await supabase.from('catalogo_gyp').update(formData).eq('id', editing.id);
        if (error) throw error;

        // Log historial: actualización
        const cambiosList: string[] = [];
        const campos = ['linea', 'grupo', 'cuenta', 'descripcion', 'saldo_normal', 'comercializadora', 'balance_gyp', 'clasificacion', 'clasificacion_1', 'clasificacion_2', 'orden_clasificacion', 'conversion'];
        campos.forEach((campo) => {
          const oldVal = (editing as unknown as Record<string, unknown>)[campo];
          const newVal = formData[campo];
          if (String(oldVal ?? '') !== String(newVal ?? '')) {
            cambiosList.push(`${campo}: '${oldVal ?? '-'}' → '${newVal ?? '-'}'`);
          }
        });
        if (cambiosList.length === 0) cambiosList.push('Sin cambios detectados');

        await supabase.from('catalogo_gyp_historico').insert({
          catalogo_id: editing.id,
          cuenta: String(formData.cuenta || editing.cuenta),
          descripcion: String(formData.descripcion || editing.descripcion),
          accion: 'actualizacion',
          cambios: cambiosList.join('; '),
          resumen: `Cuenta ${formData.cuenta || editing.cuenta} actualizada`,
        });

        addToast('success', 'Cuenta actualizada');
      } else {
        const { data: inserted, error } = await supabase.from('catalogo_gyp').insert(formData).select('id').single();
        if (error) throw error;

        // Log historial: creación
        if (inserted) {
          await supabase.from('catalogo_gyp_historico').insert({
            catalogo_id: inserted.id,
            cuenta: String(formData.cuenta || ''),
            descripcion: String(formData.descripcion || ''),
            accion: 'creacion',
            resumen: `Cuenta ${formData.cuenta} creada`,
          });
        }

        addToast('success', 'Cuenta creada');
      }
      setModalOpen(false);
      setEditing(null);
      fetchData();
    } catch (err) {
      addToast('error', 'Error: ' + (err as Error).message);
    }
  };

  const handleDelete = async (item: CatalogoItem) => {
    try {
      // Log historial: eliminación (antes de borrar para que sobreviva)
      await supabase.from('catalogo_gyp_historico').insert({
        catalogo_id: item.id,
        cuenta: item.cuenta,
        descripcion: item.descripcion,
        accion: 'eliminacion',
        resumen: `Cuenta ${item.cuenta} eliminada`,
      });

      const { error } = await supabase.from('catalogo_gyp').delete().eq('id', item.id);
      if (error) throw error;
      addToast('success', 'Cuenta eliminada');
      setConfirmDelete(null);
      fetchData();
    } catch (err) {
      addToast('error', 'Error: ' + (err as Error).message);
    }
  };

  const toggleActiva = async (item: CatalogoItem) => {
    try {
      const nuevoEstado = !item.activa;
      const { error } = await supabase.from('catalogo_gyp').update({ activa: nuevoEstado }).eq('id', item.id);
      if (error) throw error;

      // Log historial: cambio de estado
      await supabase.from('catalogo_gyp_historico').insert({
        catalogo_id: item.id,
        cuenta: item.cuenta,
        descripcion: item.descripcion,
        accion: 'actualizacion',
        cambios: `activa: '${item.activa}' → '${nuevoEstado}'`,
        resumen: `Cuenta ${item.cuenta} ${nuevoEstado ? 'activada' : 'desactivada'}`,
      });

      addToast('success', `Cuenta ${nuevoEstado ? 'activada' : 'desactivada'}`);
      fetchData();
    } catch (err) {
      addToast('error', 'Error: ' + (err as Error).message);
    }
  };

  const scopeCompaniaId = userScope?.compania_id ?? null;
  const scopePaisId = userScope?.pais_id ?? null;
  const scopeOrgId = userScope?.organizacion_id ?? null;

  useEffect(() => {
    // Cancelar debounce anterior
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    // Si no hay búsqueda, limpiar resultados
    if (!search || !search.trim()) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const term = search.trim();
        const { data, error } = await supabase
          .from('catalogo_gyp')
          .select('*')
          .or(`cuenta.ilike.%${term}%,descripcion.ilike.%${term}%,clasificacion.ilike.%${term}%`)
          .order('cuenta', { ascending: true })
          .limit(500);
        if (error) {
          console.error('Search error:', error);
          setSearchResults([]);
        } else {
          setSearchResults(data || []);
        }
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Catálogo GYP</h1>
          <p className="text-sm text-slate-500">Gestión de cuentas contables</p>
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <>
              <button
                onClick={handleExportCatalogo}
                className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-5 py-3 text-sm font-semibold text-sky-700 hover:bg-sky-100 active:scale-95 transition-all whitespace-nowrap cursor-pointer"
              >
                <i className="ri-file-excel-2-line w-5 h-5 flex items-center justify-center"></i>
                Exportar Catálogo
              </button>
              <label className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-5 py-3 text-sm font-semibold text-violet-700 hover:bg-violet-100 active:scale-95 cursor-pointer transition-all whitespace-nowrap">
                <i className="ri-refresh-line w-5 h-5 flex items-center justify-center"></i>
                Actualizar Masivo
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleMassUpdate}
                  disabled={!!importProgress}
                />
              </label>
              <button
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 active:scale-95 transition-all whitespace-nowrap cursor-pointer"
              >
                <i className="ri-download-line w-5 h-5 flex items-center justify-center"></i>
                Descargar Plantilla
              </button>
              <label className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-3 text-sm font-semibold text-white hover:bg-amber-600 active:scale-95 cursor-pointer transition-all whitespace-nowrap">
                <i className="ri-file-upload-line w-5 h-5 flex items-center justify-center"></i>
                {importProgress || 'Importar Excel'}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleImportExcel}
                  disabled={!!importProgress}
                />
              </label>
              <button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900 active:scale-95 transition-all whitespace-nowrap cursor-pointer"
              >
                <i className="ri-add-line w-5 h-5 flex items-center justify-center"></i>
                Nueva Cuenta
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl bg-white p-4 border border-slate-200">
          <p className="text-sm text-slate-500">Total Cuentas</p>
          <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
        </div>
        <div className="rounded-xl bg-white p-4 border border-slate-200">
          <p className="text-sm text-slate-500">Activas</p>
          <p className="text-2xl font-bold text-emerald-600">{stats.activas}</p>
        </div>
        <div className="rounded-xl bg-white p-4 border border-slate-200">
          <p className="text-sm text-slate-500">Inactivas</p>
          <p className="text-2xl font-bold text-slate-500">{stats.inactivas}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-xl bg-white p-4 border border-slate-200 space-y-4">
        <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 flex items-center justify-center"></i>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Buscar por cuenta, descripción o clasificación en todo el catálogo..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <select
            value={filtroClasificacion}
            onChange={(e) => {
              setFiltroClasificacion(e.target.value);
              setPage(0);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 min-w-[160px]"
          >
            <option value="">Todas las clasificaciones</option>
            {clasificaciones.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filtroClasificacion1}
            onChange={(e) => {
              setFiltroClasificacion1(e.target.value);
              setPage(0);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 min-w-[160px]"
          >
            <option value="">Todas las sub-clasificaciones</option>
            {clasificaciones1.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filtroClasificacion2}
            onChange={(e) => {
              setFiltroClasificacion2(e.target.value);
              setPage(0);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 min-w-[160px]"
          >
            <option value="">Todas las clasificaciones 2</option>
            {clasificaciones2.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filtroComercializadora}
            onChange={(e) => {
              setFiltroComercializadora(e.target.value);
              setPage(0);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 min-w-[160px]"
          >
            <option value="">Todas las comercializadoras</option>
            {comercializadoras.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filtroEstado}
            onChange={(e) => {
              setFiltroEstado(e.target.value as typeof filtroEstado);
              setPage(0);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 min-w-[140px]"
          >
            <option value="all">Todos los estados</option>
            <option value="active">Activas</option>
            <option value="inactive">Inactivas</option>
          </select>
          <select
            value={filtroOrganizacion}
            onChange={(e) => { setFiltroOrganizacion(e.target.value); setPage(0); }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 min-w-[140px]"
          >
            <option value="">Todas las organizaciones</option>
            {organizaciones.map((o) => (
              <option key={o.id} value={o.id}>{o.nombre}</option>
            ))}
          </select>
          <select
            value={filtroPais}
            onChange={(e) => { setFiltroPais(e.target.value); setPage(0); }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 min-w-[160px]"
          >
            <option value="">Todos los países</option>
            {paises.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} ({p.codigo})</option>
            ))}
          </select>
          <select
            value={filtroCompania}
            onChange={(e) => { setFiltroCompania(e.target.value); setPage(0); }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 min-w-[140px]"
          >
            <option value="">Todas las compañías</option>
            {companias.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <select
            value={filtroCentroCosto}
            onChange={(e) => { setFiltroCentroCosto(e.target.value); setPage(0); }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 min-w-[160px]"
          >
            <option value="">Todos los centros de costo</option>
            {centrosCostos.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>

        {/* Indicador de resultados de búsqueda */}
        {search && search.trim() && searchResults !== null && !searchLoading && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">
              <strong className="text-slate-900">{searchResults.length}</strong> resultado{searchResults.length !== 1 ? 's' : ''} para "<span className="text-slate-700">{search}</span>"
            </span>
            <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Búsqueda completa en BD</span>
            <button
              onClick={() => setSearch('')}
              className="text-xs text-slate-400 hover:text-slate-600 underline ml-auto"
            >
              Limpiar
            </button>
          </div>
        )}

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Línea</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Grupo</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Cuenta</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Descripción</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Saldo Normal</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Comercializadora</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Balance / GYP</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Clasificación</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Clasificación 1</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Clasificación 2</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Clasif. Comb. 1</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Clasif. Comb. 2</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Clasif. Comb. 3</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Orden</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Conversión</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Org.</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">País</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Cía.</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">CC</th>
                <th className="py-3 pr-4 font-medium whitespace-nowrap">Estado</th>
                {canWrite && <th className="py-3 pr-4 font-medium whitespace-nowrap">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {Array.from({ length: canWrite ? 21 : 20 }).map((_, j) => (
                      <td key={j} className="py-3 pr-4">
                        <div className="h-4 bg-slate-200 rounded animate-pulse w-20"></div>
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={canWrite ? 21 : 20} className="py-12">
                    <div className="flex flex-col items-center text-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                        <i className="ri-error-warning-line text-red-500 text-xl"></i>
                      </div>
                      <p className="text-sm font-medium text-slate-700">No se pudo cargar el catálogo</p>
                      <p className="text-xs text-slate-500 max-w-xs">{error}</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => fetchData()}
                          className="rounded-lg px-4 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                        >
                          Reintentar
                        </button>
                      </div>
                      {!user && (
                        <p className="text-xs text-slate-400 mt-1">
                          ¿No hay sesión activa?{' '}
                          <a href="/login" className="text-emerald-600 hover:underline">
                            Ir al login
                          </a>
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ) : searchLoading ? (
                <tr>
                  <td colSpan={canWrite ? 21 : 20} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-sm text-slate-500">Buscando en todo el catálogo...</p>
                    </div>
                  </td>
                </tr>
              ) : search && search.trim() && searchResults !== null && searchResults.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 21 : 20} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                        <i className="ri-search-line text-amber-500 text-xl"></i>
                      </div>
                      <p className="text-sm font-medium text-slate-700">Sin resultados para "{search}"</p>
                      <p className="text-xs text-slate-500">Intentá con otro término o revisá que la cuenta exista en la base</p>
                      <button
                        onClick={() => setSearch('')}
                        className="rounded-lg px-4 py-2 text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                      >
                        Limpiar búsqueda
                      </button>
                    </div>
                  </td>
                </tr>
              ) : search && search.trim() && searchResults !== null ? (
                searchResults.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 pr-4 text-slate-900 whitespace-nowrap">{item.linea ?? '-'}</td>
                    <td className="py-3 pr-4 text-slate-900 whitespace-nowrap">{item.grupo ?? '-'}</td>
                    <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">{item.cuenta}</td>
                    <td className="py-3 pr-4 text-slate-700 min-w-[200px]">{item.descripcion}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.saldo_normal || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.comercializadora || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.balance_gyp || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_1 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_2 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_combinado_1 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_combinado_2 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_combinado_3 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.orden_clasificacion ?? '-'}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.conversion ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
                        {item.conversion ? 'Si' : 'No'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap text-xs">
                      {organizacionesMap.get(item.organizacion_id || '') || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap text-xs">
                      {paisesMap.get(item.pais_id || '') || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap text-xs">
                      {companiasMap.get(item.compania_id || '') || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap text-xs">
                      {centrosCostosMap.get(item.centro_costo_id || '') || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <button
                        onClick={() => toggleActiva(item)}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                          item.activa
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title={item.activa ? 'Haz clic para desactivar' : 'Haz clic para activar'}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${item.activa ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                        {item.activa ? 'Activa' : 'Inactiva'}
                      </button>
                    </td>
                    {canWrite && (
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditing(item);
                              setModalOpen(true);
                            }}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            title="Editar"
                          >
                            <i className="ri-edit-line"></i>
                          </button>
                          <button
                            onClick={() => setConfirmDelete(item)}
                            className="rounded-md p-1.5 text-red-500 hover:bg-red-50"
                            title="Eliminar"
                          >
                            <i className="ri-delete-bin-line"></i>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 21 : 20} className="py-8 text-center text-slate-400">
                    No se encontraron resultados
                  </td>
                </tr>
              ) : (
                paginated.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 pr-4 text-slate-900 whitespace-nowrap">{item.linea ?? '-'}</td>
                    <td className="py-3 pr-4 text-slate-900 whitespace-nowrap">{item.grupo ?? '-'}</td>
                    <td className="py-3 pr-4 font-medium text-slate-900 whitespace-nowrap">{item.cuenta}</td>
                    <td className="py-3 pr-4 text-slate-700 min-w-[200px]">{item.descripcion}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.saldo_normal || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.comercializadora || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.balance_gyp || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_1 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_2 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_combinado_1 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_combinado_2 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.clasificacion_combinado_3 || '-'}</td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{item.orden_clasificacion ?? '-'}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.conversion ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
                        {item.conversion ? 'Si' : 'No'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap text-xs">
                      {organizacionesMap.get(item.organizacion_id || '') || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap text-xs">
                      {paisesMap.get(item.pais_id || '') || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap text-xs">
                      {companiasMap.get(item.compania_id || '') || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 whitespace-nowrap text-xs">
                      {centrosCostosMap.get(item.centro_costo_id || '') || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <button
                        onClick={() => toggleActiva(item)}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                          item.activa
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title={item.activa ? 'Haz clic para desactivar' : 'Haz clic para activar'}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${item.activa ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                        {item.activa ? 'Activa' : 'Inactiva'}
                      </button>
                    </td>
                    {canWrite && (
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditing(item);
                              setModalOpen(true);
                            }}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            title="Editar"
                          >
                            <i className="ri-edit-line"></i>
                          </button>
                          <button
                            onClick={() => setConfirmDelete(item)}
                            className="rounded-md p-1.5 text-red-500 hover:bg-red-50"
                            title="Eliminar"
                          >
                            <i className="ri-delete-bin-line"></i>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {!search && !search.trim() && totalPages > 1 && (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-slate-500">
              Mostrando {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, filtered.length)} de {filtered.length}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="flex items-center px-2 text-sm text-slate-500">
                Página {page + 1} de {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      <CatalogoModal
        isOpen={modalOpen}
        item={editing}
        organizaciones={organizaciones}
        paises={paises}
        companias={companias}
        centrosCostos={centrosCostos}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title="Eliminar Cuenta"
        message={`¿Eliminar la cuenta "${confirmDelete?.cuenta}" - ${confirmDelete?.descripcion}? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
      />

      <ImportPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onConfirm={handleConfirmImport}
        headers={previewHeaders}
        data={previewData}
        total={previewStats.total}
        skipped={previewStats.skipped}
        invalidNumbers={previewStats.invalidNumbers}
        missingUbicacion={previewStats.missingUbicacion}
        paisCount={previewStats.paisCount}
        orgCount={previewStats.orgCount}
        ccCount={previewStats.ccCount}
        duplicates={previewStats.duplicates}
        invalidConversion={previewStats.invalidConversion}
        existentes={previewStats.existentes}
        loading={!!importProgress}
        paises={paises}
        companias={companias}
        centrosCostos={centrosCostos}
      />

      <Modal
        isOpen={!!resultadoMasivo}
        onClose={() => setResultadoMasivo(null)}
        title={resultadoMasivo?.titulo ?? ''}
        size="xl"
      >
        {resultadoMasivo && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {resultadoMasivo.resumen.map((r) => (
                <span key={r} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700">
                  {r}
                </span>
              ))}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">
                Filas que no se aplicaron ({resultadoMasivo.errores.length}). Corregilas en el Excel y volvé a subirlo:
              </p>
              <ul className="max-h-[50vh] overflow-y-auto rounded-lg border border-red-100 bg-red-50 divide-y divide-red-100 text-sm text-red-800">
                {resultadoMasivo.errores.map((err, i) => (
                  <li key={i} className="px-3 py-1.5">{err}</li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setResultadoMasivo(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium bg-slate-800 text-white hover:bg-slate-900"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ProgressModal
        isOpen={!!importProgress}
        title="Procesando"
        message={importProgress || 'Trabajando...'}
      />
    </div>
  );
}