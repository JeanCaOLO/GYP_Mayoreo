# -*- coding: utf-8 -*-
"""
Extracción diaria de Fabric → Supabase  (opción B del documento 07).

Este NOTEBOOK corre DENTRO de Microsoft Fabric, en su planificador. Lee Gold y
Silver con Spark (nativo, sin credenciales ni puerto 1433: el notebook ya está
dentro del workspace) y empuja el resultado a Supabase, que es lo único que el
aplicativo web lee.

Alimenta dos tablas de Supabase (ver src/pages/proyeccion-gyp/schema.sql):
  - gyp_historico_mensual : acumulado del mes + serie mensual, por empresa/concepto
  - proyeccion_parametro  : días hábiles, transcurridos, factor, tasa y corte

El aplicativo NO se conecta a Fabric. Lee estas tablas de Supabase y, si están
vacías, cae a su foto embebida. Por eso el sello de la pantalla se pone verde
("Fabric · …") recién cuando este notebook ha corrido con éxito.

Lo que NO se refresca aquí (documento 07 §5):
  - el factor de corrección lo fija control; aquí va un valor por defecto que
    NO se sobreescribe si control ya lo cambió en la base (ver UPSERT abajo).
  - el catálogo de cuentas y las 95 reglas: viven en el aplicativo (seed/schema).

────────────────────────────────────────────────────────────────────────────
QUÉ AGREGAR EN FABRIC (ver README.md de esta carpeta para el detalle):
  1. Un Lakehouse/Warehouse adjunto que exponga Gold y Silver (para spark.sql).
  2. Dos secretos, por Key Vault vinculado o como variables del notebook:
       SUPABASE_URL          https://laiiyfjxfvilupiccosf.supabase.co
       SUPABASE_SERVICE_KEY  service_role key de Supabase (NO la anon)
  3. (opcional) PERIODO='aaaa-mm' y UMBRAL=0.25
────────────────────────────────────────────────────────────────────────────
"""
import os
import json
import datetime
import urllib.request
import urllib.error
import urllib.parse

# ── En un notebook de Fabric, la sesión de Spark ya existe. Fuera de Fabric,
#    el acceso falla y el script lo dice con claridad en vez de romper feo. ──
try:
    spark  # noqa: F821  (lo provee el runtime de Fabric)
except NameError:  # pragma: no cover
    raise SystemExit(
        "Este script está pensado para correr como notebook dentro de Fabric "
        "(necesita la sesión de Spark)."
    )

# ─────────────────────────────────────────────────────────────────────────────
# Constantes del dominio (documento 07)
# ─────────────────────────────────────────────────────────────────────────────

EMP = ['Beval', 'Febeca', 'Sillaca', 'Cofersa', 'Mundial', 'Prisma']

# Bandera de día laboral que le toca a cada empresa en Gold.SIM.rolling.
# Venezuela trabaja sábado, por eso cada país lleva su propia bandera.
BANDERA = {
    'Beval': 'EsLaboralFE', 'Febeca': 'EsLaboralFE', 'Sillaca': 'EsLaboralFE',
    'Prisma': 'EsLaboralFE', 'Cofersa': 'EslaboralCR', 'Mundial': 'EslaboralCO',
}

# Factor de corrección POR DEFECTO. Lo fija control; este valor solo se usa para
# una fila nueva. Si control ya lo cambió en Supabase, el UPSERT NO lo pisa.
FACTOR_DEFECTO = {
    'Beval': 1.40, 'Febeca': 1.32, 'Sillaca': 1.47,
    'Cofersa': 1.00, 'Mundial': 1.19, 'Prisma': 1.00,
}

# El desdoble de Margen no es cosmético (documento 07 §3): Margen-Venta es la
# venta y Margen-Costo el costo, y alimentan reglas distintas.
SLOT = ("CASE WHEN c.Dim_SubClasificacion='Margen' THEN 'Margen-'+c.SubGrupo "
        "ELSE c.Dim_SubClasificacion END")

# Nombre del slot de Fabric → concepto que usa el aplicativo.
CONCEPTO = {
    'Margen-Venta': 'Ventas', 'Margen-Costo': 'Costo de Ventas',
    'Colocación': 'Colocacion', 'Ingresos Mercantiles': 'Ingresos Mercantiles',
    'Fletes Recuperados': 'Fletes Recuperados', 'Merma': 'Merma',
    'Personal': 'Personal Fijo', 'Gastos Varios': 'Gastos Varios',
    'Alquileres': 'Alquileres', 'Cargo Fijo': 'Cargo Fijo', 'Tributos': 'Tributos',
    'Incobrables': 'Incobrables', 'Fletes': 'Fletes', 'Logístico': 'Logistico',
    'IVA Atrapado': 'IVA Atrapado', 'Otros egresos': 'Otros egresos',
    'Intereses': 'Intereses', 'Depreciación': 'Depreciacion', 'ISLR': 'ISLR',
}

# Conceptos que son venta (es_venta=true en la tabla).
ES_VENTA = {'Ventas', 'Colocacion'}

# ─────────────────────────────────────────────────────────────────────────────
# Lectura de parámetros (sin exponer secretos)
# ─────────────────────────────────────────────────────────────────────────────

def _secreto(nombre):
    """Lee un secreto de Fabric si hay almacén configurado; si no, del entorno."""
    try:
        import notebookutils  # type: ignore
        # Ajusta 'proyeccion-gyp' al nombre de tu Key Vault vinculado en Fabric.
        return notebookutils.credentials.getSecret('proyeccion-gyp', nombre)
    except Exception:
        return os.environ.get(nombre)

# .strip(): protege contra saltos de línea o espacios que se cuelan al pegar.
SUPABASE_URL = (_secreto('SUPABASE_URL') or '').strip().rstrip('/')
SUPABASE_SERVICE_KEY = (_secreto('SUPABASE_SERVICE_KEY') or '').strip()
PERIODO = (os.environ.get('PERIODO') or '').strip()
UMBRAL = float((os.environ.get('UMBRAL') or '0.25').strip())

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise SystemExit(
        "Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY. Configúralos en el Key Vault "
        "vinculado al workspace de Fabric, o como variables de entorno del notebook."
    )

hoy = datetime.date.today()
periodo = PERIODO or '%04d-%02d' % (hoy.year, hoy.month)
anio, mes = int(periodo[:4]), int(periodo[5:7])
ini = '%04d-%02d-01' % (anio, mes)
fin = '%04d-%02d-01' % (anio + (mes == 12), mes % 12 + 1)
inicio_anio = '%04d-01-01' % anio

print('Periodo %s  (%s a %s)' % (periodo, ini, fin))


# ─────────────────────────────────────────────────────────────────────────────
# Consultas a Gold / Silver vía Spark (nativo dentro de Fabric)
# ─────────────────────────────────────────────────────────────────────────────

def consultar(sql):
    """Ejecuta SQL contra el lakehouse/warehouse y devuelve filas como dicts."""
    return [row.asDict() for row in spark.sql(sql).collect()]  # noqa: F821


def num(v):
    if v is None:
        return 0.0
    s = str(v).strip()
    return 0.0 if s in ('', 'NULL', 'None') else float(s)


# --- 1. Acumulado del mes por empresa y concepto ---
#     Ajuste_USD NO es opcional: hay conceptos que viajan enteros ahí (documento 07 §3.1).
acum = {}
for f in consultar("""
SELECT c.Empresa AS emp, {s} AS slot,
       SUM(g.Monto_USD + COALESCE(g.Ajuste_USD,0)) AS usd
FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
WHERE g.FECHA >= '{i}' AND g.FECHA < '{f}'
GROUP BY c.Empresa, {s}
""".format(s=SLOT, i=ini, f=fin)):
    if f['slot'] in CONCEPTO:
        acum[(f['emp'], CONCEPTO[f['slot']])] = round(num(f['usd']), 2)
print('  acumulado del mes: %d conceptos' % len(acum))

# --- 2. Serie mensual del año hasta el mes anterior ---
serie = {}
for f in consultar("""
SELECT c.Empresa AS emp, {s} AS slot, DATE_FORMAT(g.FECHA,'yyyy-MM') AS mes,
       SUM(g.Monto_USD + COALESCE(g.Ajuste_USD,0)) AS usd
FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
WHERE c.Empresa IN ('Beval','Febeca','Sillaca','Cofersa','Mundial','Prisma')
  AND g.FECHA >= '{a}' AND g.FECHA < '{i}'
GROUP BY c.Empresa, {s}, DATE_FORMAT(g.FECHA,'yyyy-MM')
""".format(s=SLOT, a=inicio_anio, i=ini)):
    if f['slot'] in CONCEPTO:
        serie.setdefault((f['emp'], CONCEPTO[f['slot']]), {})[f['mes']] = round(num(f['usd']), 2)
meses = ['%04d-%02d' % (anio, m) for m in range(1, mes)]
print('  serie histórica : %d meses, %d conceptos' % (len(meses), len(serie)))

# --- 3. El corte: hasta qué día hay datos REALMENTE cargados (documento 07 §4) ---
#     MAX(FECHA) no sirve: hay asientos sueltos con fecha futura. Se toma el
#     último día cuyo volumen llega a una fracción del día típico del mes.
dias_vol = consultar("""
SELECT CAST(FECHA AS DATE) AS f, COUNT(*) AS n
FROM Silver.dbo.slv_mayor_mayoreo_consolidado_v2
WHERE FECHA >= '{i}' AND FECHA < '{f}'
GROUP BY CAST(FECHA AS DATE) ORDER BY f
""".format(i=ini, f=fin))
pares = sorted(((str(x['f']), int(x['n'])) for x in dias_vol if int(x['n']) > 0),
               key=lambda t: t[0])
corte = ini
if pares:
    vols = sorted(n for _, n in pares)
    tipico = vols[len(vols) // 2]
    minimo = tipico * UMBRAL
    completos = [f for f, n in pares if n >= minimo]
    if completos:
        corte = max(completos)
    flojos = [(f, n) for f, n in pares if n < minimo and f > corte]
    print('  día típico: %d filas; se exige al menos %.0f (%.0f%%)'
          % (tipico, minimo, UMBRAL * 100))
    if flojos:
        print('  se descartan por venir a medias: '
              + ', '.join('%s (%d filas)' % t for t in flojos))
print('  datos completos hasta: %s' % corte)

# --- 4. Días hábiles del mes y transcurridos (DISTINCT obligatorio, doc 07 §3.4) ---
dias = {}
for emp in EMP:
    b = BANDERA[emp]
    r = consultar("""
SELECT COUNT(DISTINCT CASE WHEN {b}=1 THEN Date END) AS mes,
       COUNT(DISTINCT CASE WHEN {b}=1 AND Date <= '{c}' THEN Date END) AS trans
FROM Gold.SIM.rolling WHERE Date >= '{i}' AND Date < '{f}'
""".format(b=b, c=corte, i=ini, f=fin))[0]
    dias[emp] = (int(r['mes'] or 0), int(r['trans'] or 0))
print('  días hábiles    : ' + ', '.join('%s %d/%d' % (e, dias[e][1], dias[e][0]) for e in EMP))

# --- 5. Tasa del mes (documento 07 §3.5) ---
tasa = {}
for f in consultar("""
SELECT c.Empresa AS emp,
       MAX(g.Tasa_Mensual) AS declarada,
       SUM(g.Monto_Local + COALESCE(g.Ajuste,0))
         / NULLIF(SUM(g.Monto_USD + COALESCE(g.Ajuste_USD,0)),0) AS implicita
FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
WHERE c.SubGrupo = 'Venta' AND g.FECHA >= '{i}' AND g.FECHA < '{f}'
GROUP BY c.Empresa
""".format(i=ini, f=fin)):
    # Declarada si existe y no es cero; si no, implícita. Venezuela siempre cae a implícita.
    tasa[f['emp']] = round(num(f['declarada']) or num(f['implicita']), 4)
# Prisma suele quedarse sin ninguna: promedio de Beval, Febeca y Sillaca.
ve = [tasa[e] for e in ('Beval', 'Febeca', 'Sillaca') if tasa.get(e)]
if ve and not tasa.get('Prisma'):
    tasa['Prisma'] = round(sum(ve) / len(ve), 4)
print('  tasas           : ' + ', '.join('%s %.2f' % (e, tasa.get(e, 0)) for e in EMP))


# ─────────────────────────────────────────────────────────────────────────────
# Escritura a Supabase (REST / PostgREST)
# ─────────────────────────────────────────────────────────────────────────────

def corte_publicado():
    """Lee el corte que ya está en Supabase para el periodo, si existe."""
    url = ("%s/rest/v1/proyeccion_parametro?periodo=eq.%s&select=corte&limit=1"
           % (SUPABASE_URL, periodo))
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            filas = json.loads(resp.read().decode('utf-8'))
        return filas[0]['corte'] if filas and filas[0].get('corte') else None
    except Exception as e:
        print('  (no se pudo leer el corte publicado: %s)' % e)
        return None


def _post(tabla, filas, on_conflict, ignore_duplicates=False):
    """UPSERT (o INSERT-if-absent) por lotes contra PostgREST.

    ignore_duplicates=True -> 'resolution=ignore-duplicates': inserta solo las
    filas cuya llave no existe y deja intactas las existentes. Se usa para no
    pisar el factor_correccion que fijó control (documento 07 §5).
    """
    if not filas:
        return
    url = ("%s/rest/v1/%s?on_conflict=%s" % (SUPABASE_URL, tabla, on_conflict))
    resol = 'ignore-duplicates' if ignore_duplicates else 'merge-duplicates'
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=%s,return=minimal' % resol,
    }
    for i in range(0, len(filas), 500):
        lote = filas[i:i + 500]
        body = json.dumps(lote, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(url, data=body, headers=headers, method='POST')
        try:
            urllib.request.urlopen(req, timeout=60).read()
        except urllib.error.HTTPError as e:
            raise SystemExit('Error escribiendo %s: HTTP %s %s'
                             % (tabla, e.code, e.read().decode('utf-8', 'replace')))


def _patch(tabla, periodo_, empresa_, cambios):
    """UPDATE de columnas puntuales de una fila ya existente (no toca factor)."""
    url = ("%s/rest/v1/%s?periodo=eq.%s&empresa=eq.%s"
           % (SUPABASE_URL, tabla, periodo_, urllib.parse.quote(empresa_)))
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    }
    body = json.dumps(cambios, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers=headers, method='PATCH')
    try:
        urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        raise SystemExit('Error actualizando %s: HTTP %s %s'
                         % (tabla, e.code, e.read().decode('utf-8', 'replace')))


# ─────────────────────────────────────────────────────────────────────────────
# GUARDAS antes de escribir (documento 07 §7). Si alguna falla, NO se escribe.
# ─────────────────────────────────────────────────────────────────────────────

errores = []
# Guarda 3: al menos un día completo.
if all(dias[e][1] < 1 for e in EMP):
    errores.append('ningún día transcurrido tiene datos completos (trans=0 en todas).')
# Guarda 1: la extracción trajo algo.
if not acum and not serie:
    errores.append('la extracción no devolvió ningún concepto.')
# Guarda 2: el corte avanzó respecto al publicado (la que más duele, doc 07 §7).
prev = corte_publicado()
if prev and corte <= prev:
    errores.append('el corte NO avanzó (publicado %s, nuevo %s). '
                   'Suele ser la ingesta parada; se conservan los datos buenos.'
                   % (prev, corte))

if errores:
    print('\n*** NO SE ESCRIBE. Guardas no superadas: ***')
    for e in errores:
        print('  - ' + e)
    raise SystemExit('Extracción abortada por guardas (documento 07 §7).')


# Primero los datos, después el sello (documento 07 §6).

# 1) Historia mensual: una fila por (periodo, empresa, concepto).
#    Acumulado del mes en curso + cada punto de la serie en su mes.
hist = []
todas = set(acum) | set(serie)
for (emp, con) in sorted(todas):
    es_v = con in ES_VENTA
    # acumulado del mes en curso
    hist.append({
        'periodo': periodo, 'empresa': emp, 'concepto': con,
        'dim_subclasificacion': con, 'subgrupo': '',
        'monto_usd': acum.get((emp, con), 0.0), 'es_venta': es_v,
    })
    # serie de los meses previos (solo meses con registro)
    for m, v in serie.get((emp, con), {}).items():
        hist.append({
            'periodo': m, 'empresa': emp, 'concepto': con,
            'dim_subclasificacion': con, 'subgrupo': '',
            'monto_usd': v, 'es_venta': es_v,
        })
_post('gyp_historico_mensual', hist,
      'periodo,empresa,dim_subclasificacion,subgrupo')
print('\n  escritas %d filas en gyp_historico_mensual' % len(hist))

# 2) Parámetros por empresa, en dos pasos para NO pisar el factor_correccion
#    que fija control (documento 07 §5):
#    a) INSERT-if-absent: crea la fila con el factor por defecto SOLO si no existe.
#    b) PATCH: actualiza días, tasa y corte de cada fila, sin tocar el factor.
semilla = [{
    'periodo': periodo, 'empresa': e,
    'dias_habiles_mes': dias[e][0], 'dias_transcurridos': dias[e][1],
    'tasa_local': tasa.get(e, 0.0), 'corte': corte,
    'factor_correccion': FACTOR_DEFECTO[e],
} for e in EMP]
_post('proyeccion_parametro', semilla, 'periodo,empresa', ignore_duplicates=True)
for e in EMP:
    _patch('proyeccion_parametro', periodo, e, {
        'dias_habiles_mes': dias[e][0], 'dias_transcurridos': dias[e][1],
        'tasa_local': tasa.get(e, 0.0), 'corte': corte,
        'updated_at': datetime.datetime.now().isoformat(),
    })
print('  actualizadas %d filas en proyeccion_parametro (factor intacto)' % len(EMP))

print('\nOK · Fabric → Supabase completado · generado %s · corte %s'
      % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), corte))
