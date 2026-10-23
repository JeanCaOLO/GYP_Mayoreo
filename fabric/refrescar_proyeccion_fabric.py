# -*- coding: utf-8 -*-
"""
Extracción diaria de Fabric → Supabase  (opción B del documento 07).

Este NOTEBOOK corre DENTRO de Microsoft Fabric, en su planificador. Lee Gold y
Silver con Spark (nativo, sin credenciales ni puerto 1433: el notebook ya está
dentro del workspace) y empuja el resultado a Supabase, que es lo único que el
aplicativo web lee.

Alimenta estas tablas de Supabase (ver src/pages/proyeccion-gyp/schema.sql):
  - gyp_historico_mensual : acumulado del mes + serie mensual, por empresa/concepto
  - proyeccion_parametro  : días hábiles, transcurridos, factor, tasa y corte
  - gyp_historico_cuenta  : detalle por cuenta (capas, acumulado, presupuesto, 12 meses)  [CP-11]
  - dim_cuenta            : catálogo de cuentas con sus capas                              [CP-11]
  - proyeccion_alerta     : cuentas con movimiento que el catálogo GyP no reconoce         [CP-15]
  - proyeccion_corrida    : bitácora de esta corrida de extracción                         [CP-14]

El aplicativo NO se conecta a Fabric. Lee estas tablas de Supabase y, si están
vacías, cae a su foto embebida. Por eso el sello de la pantalla se pone verde
("Fabric · …") recién cuando este notebook ha corrido con éxito.

Lo que NO se refresca aquí (documento 07 §5):
  - el factor de corrección lo fija control; aquí va un valor por defecto que
    NO se sobreescribe si control ya lo cambió en la base (ver UPSERT abajo).
  - el catálogo de cuentas y las 95 reglas: viven en el aplicativo (seed/schema).

────────────────────────────────────────────────────────────────────────────
SEPARACIÓN DE RESPONSABILIDADES — ESTE NOTEBOOK vs LOS BOTONES DEL APLICATIVO
(documento 12, CP-14 y CP-56)

  Este notebook SOLO hace la EXTRACCIÓN (Fabric → Supabase) y registra SU propia
  corrida en proyeccion_corrida con paso='extraccion'. El `origen` se decide por
  cómo se invoca: por el planificador de Fabric → 'programada'; corrido a mano →
  'manual' (ver ORIGEN abajo).

  Los BOTONES del aplicativo son cosa del FRONTEND, no de este notebook:
    - "Actualizar"  → relee de Supabase la última extracción publicada por Fabric;
                      NO ejecuta nada en Fabric (función refrescarDesdeFabric en
                      src/pages/proyeccion-gyp/data.ts).
    - "Publicar la tabla final ahora" → recalcula los dos escenarios y escribe
                      proyeccion_resultado (función publicarViaEdge en data.ts,
                      Edge Function publicar-proyeccion). Registra su corrida con
                      origen='manual', paso='calculo'/'publicacion'.

  El aplicativo NO dispara la extracción de Fabric: por eso NO hay botón "traer
  datos de Fabric". El notebook corre por su cuenta (CP-56). Este archivo solo
  registra su paso='extraccion'; los pasos 'calculo' y 'publicacion' los escribe
  el frontend / la Edge Function.
────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────
QUÉ AGREGAR EN FABRIC (ver README.md de esta carpeta para el detalle):
  1. Un Lakehouse/Warehouse adjunto que exponga Gold y Silver (para spark.sql).
  2. Dos secretos, por Key Vault vinculado o como variables del notebook:
       SUPABASE_URL          https://laiiyfjxfvilupiccosf.supabase.co
       SUPABASE_SERVICE_KEY  service_role key de Supabase (NO la anon)
  3. (opcional) PERIODO='aaaa-mm', MESES='2', UMBRAL='0.25', ORIGEN='programada'
────────────────────────────────────────────────────────────────────────────
"""
import os
import sys
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

# Mapa de países propio (CP-52). En el origen `pais` viene NULL en Beval,
# Sillaca y Cofersa; este mapa es la única fuente fiable para la columna Pais.
PAIS = {
    'Beval': 'Venezuela', 'Febeca': 'Venezuela', 'Sillaca': 'Venezuela',
    'Prisma': 'Venezuela', 'Cofersa': 'Costa Rica', 'Mundial': 'Colombia',
}

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

# CP-08: la suma corregida FILTRA solo Vista='GYP' y EXCLUYE las cuentas de
# proyección 9.5.* . Estas dos piezas de SQL se reutilizan en todas las lecturas
# del mayor (acumulado, serie, tasa, detalle por cuenta y alertas).
#   - COND_GYP     : filtra Vista='GYP' (la columna vive en el mayor de oro).
#   - COND_NO_95   : excluye las cuentas que empiezan por '9.5.' (proyección).
# El modo `validado` (sin estos filtros) solo se usa para el chequeo de octubre.
COND_GYP = "g.Vista = 'GYP'"
COND_NO_95 = "g.CUENTA_CONTABLE NOT LIKE '9.5.%'"
# Suma corregida CP-08: COALESCE en las DOS patas; sin COALESCE, una fila con
# Monto_USD nulo desaparecía sin avisar.
SUMA_USD = "SUM(COALESCE(g.Monto_USD,0) + COALESCE(g.Ajuste_USD,0))"
# Suma del modo `validado` (la original), para el contraste de CP-08.
SUMA_USD_VALIDADO = "SUM(g.Monto_USD + COALESCE(g.Ajuste_USD,0))"

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


def _arg(nombre):
    """Lee un argumento del entorno o de --nombre=valor en la línea de comandos.

    En Fabric estos llegan como variables del notebook; corrido a mano admite
    --periodo, --meses y --origen (CP-12).
    """
    env = (os.environ.get(nombre.upper()) or '').strip()
    if env:
        return env
    pref = '--%s=' % nombre.lower()
    for a in sys.argv[1:]:
        if a.startswith(pref):
            return a[len(pref):].strip()
    return ''


# .strip(): protege contra saltos de línea o espacios que se cuelan al pegar.
SUPABASE_URL = (_secreto('SUPABASE_URL') or '').strip().rstrip('/')
SUPABASE_SERVICE_KEY = (_secreto('SUPABASE_SERVICE_KEY') or '').strip()
PERIODO = _arg('periodo')
UMBRAL = float((_arg('umbral') or '0.25'))

# CP-12: sin argumentos saca el mes en curso Y el anterior (2 meses) con una
# sola conexión; --meses N para más, --periodo para uno concreto.
MESES = int(_arg('meses') or '2')
if MESES < 1:
    MESES = 1

# CP-14: el origen de la corrida depende de cómo se invoca. El planificador de
# Fabric puede pasar ORIGEN='programada'; corrido a mano queda 'manual'.
ORIGEN = (_arg('origen') or 'manual').strip().lower()
if ORIGEN not in ('programada', 'manual'):
    ORIGEN = 'manual'
# Quién lanzó la corrida (para la bitácora). En Fabric suele venir en el entorno.
LANZADA_POR = (_arg('lanzada_por') or os.environ.get('USER')
               or os.environ.get('USERNAME') or 'fabric').strip()

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise SystemExit(
        "Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY. Configúralos en el Key Vault "
        "vinculado al workspace de Fabric, o como variables de entorno del notebook."
    )

hoy = datetime.date.today()


def _periodos_a_procesar():
    """Devuelve la lista de periodos 'aaaa-mm' a extraer.

    - Con --periodo: solo ese (CP-12).
    - Sin argumentos: el mes en curso y los MESES-1 anteriores (CP-12), del más
      reciente al más antiguo.
    """
    if PERIODO:
        return [PERIODO]
    out = []
    a, m = hoy.year, hoy.month
    for _ in range(MESES):
        out.append('%04d-%02d' % (a, m))
        m -= 1
        if m == 0:
            a, m = a - 1, 12
    return out


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


# ─────────────────────────────────────────────────────────────────────────────
# Escritura a Supabase (REST / PostgREST)
# ─────────────────────────────────────────────────────────────────────────────

def corte_publicado(periodo_):
    """Lee el corte que ya está en Supabase para el periodo, si existe."""
    url = ("%s/rest/v1/proyeccion_parametro?periodo=eq.%s&select=corte&limit=1"
           % (SUPABASE_URL, periodo_))
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


def _delete(tabla, filtro):
    """DELETE por filtro PostgREST (ej. 'periodo=eq.2026-10'). Reemplaza el
    detalle/alertas del periodo antes de reinsertar, para no acumular restos de
    corridas anteriores."""
    url = "%s/rest/v1/%s?%s" % (SUPABASE_URL, tabla, filtro)
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal',
    }
    req = urllib.request.Request(url, headers=headers, method='DELETE')
    try:
        urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        raise SystemExit('Error borrando %s: HTTP %s %s'
                         % (tabla, e.code, e.read().decode('utf-8', 'replace')))


# ─────────────────────────────────────────────────────────────────────────────
# Bitácora de corridas (CP-14). Registra SOLO el paso 'extraccion' de ESTE
# notebook. Los pasos 'calculo' y 'publicacion' los escribe el frontend / la
# Edge Function (ver la nota de separación de responsabilidades arriba).
# ─────────────────────────────────────────────────────────────────────────────

def corrida_abrir(periodo_):
    """Inserta una fila en_curso y devuelve su id (para cerrarla al final)."""
    fila = {
        'periodo': periodo_,
        'origen': ORIGEN,                 # programada | manual (CP-14)
        'paso': 'extraccion',             # este notebook SOLO extrae
        'estado': 'en_curso',
        'inicio': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'lanzada_por': LANZADA_POR,
    }
    url = "%s/rest/v1/proyeccion_corrida" % SUPABASE_URL
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',    # devuelve el id generado
    }
    body = json.dumps([fila], ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            out = json.loads(resp.read().decode('utf-8'))
        return out[0]['id'] if out else None
    except Exception as e:
        # La bitácora no debe tumbar la extracción: se avisa y se sigue sin id.
        print('  (no se pudo abrir la corrida en bitácora: %s)' % e)
        return None


def corrida_cerrar(corrida_id, estado, filas=None, corte=None, mensaje=None):
    """Cierra la fila de bitácora con ok|error|omitida, el corte y las filas."""
    if corrida_id is None:
        return
    cambios = {
        'estado': estado,
        'fin': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if filas is not None:
        cambios['filas'] = int(filas)
    if corte is not None:
        cambios['corte'] = corte
    if mensaje is not None:
        cambios['mensaje'] = mensaje[:2000]
    url = "%s/rest/v1/proyeccion_corrida?id=eq.%s" % (SUPABASE_URL, corrida_id)
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    }
    body = json.dumps(cambios, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers=headers, method='PATCH')
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:
        print('  (no se pudo cerrar la corrida en bitácora: %s)' % e)


# ─────────────────────────────────────────────────────────────────────────────
# Extracción de UN periodo. Devuelve el corte y el total de filas escritas.
# Toda la lógica del notebook anterior se conserva; se amplía con CP-08..CP-15.
# ─────────────────────────────────────────────────────────────────────────────

def extraer_periodo(periodo_):
    anio, mes = int(periodo_[:4]), int(periodo_[5:7])
    ini = '%04d-%02d-01' % (anio, mes)
    fin = '%04d-%02d-01' % (anio + (mes == 12), mes % 12 + 1)
    # CP-09: la serie histórica son SIEMPRE los 12 meses anteriores al periodo
    # (no de enero al mes anterior). Así en enero hay historia y los promedios
    # no dan cero.
    y12, m12 = anio, mes - 12
    while m12 <= 0:
        y12, m12 = y12 - 1, m12 + 12
    serie_ini = '%04d-%02d-01' % (y12, m12)   # primer día del mes 12 atrás
    # Los 12 periodos anteriores, en orden ascendente.
    meses12 = []
    ya, ym = y12, m12
    for _ in range(12):
        meses12.append('%04d-%02d' % (ya, ym))
        ym += 1
        if ym == 13:
            ya, ym = ya + 1, 1

    print('\n══ Periodo %s  (%s a %s) · serie desde %s ══'
          % (periodo_, ini, fin, serie_ini))

    # --- 1. Acumulado del mes por empresa y concepto (CP-08) ---
    #     Suma corregida: COALESCE en las dos patas, Vista='GYP', sin 9.5.*
    acum = {}
    for f in consultar("""
    SELECT c.Empresa AS emp, {s} AS slot, {suma} AS usd
    FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
    JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
    WHERE g.FECHA >= '{i}' AND g.FECHA < '{f}'
      AND {gyp} AND {no95}
    GROUP BY c.Empresa, {s}
    """.format(s=SLOT, suma=SUMA_USD, i=ini, f=fin, gyp=COND_GYP, no95=COND_NO_95)):
        if f['slot'] in CONCEPTO:
            acum[(f['emp'], CONCEPTO[f['slot']])] = round(num(f['usd']), 2)
    print('  acumulado del mes: %d conceptos' % len(acum))

    # --- 1b. CP-08: comprobar que el modo corregido y el validado coinciden ---
    #     El modo `validado` reproduce la consulta original (sin filtros). Con
    #     los datos de octubre ambos deben dar lo mismo; si difieren, se avisa.
    acum_val = {}
    for f in consultar("""
    SELECT c.Empresa AS emp, {s} AS slot, {suma} AS usd
    FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
    JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
    WHERE g.FECHA >= '{i}' AND g.FECHA < '{f}'
    GROUP BY c.Empresa, {s}
    """.format(s=SLOT, suma=SUMA_USD_VALIDADO, i=ini, f=fin)):
        if f['slot'] in CONCEPTO:
            acum_val[(f['emp'], CONCEPTO[f['slot']])] = round(num(f['usd']), 2)
    difs = []
    for k in set(acum) | set(acum_val):
        a, b = acum.get(k, 0.0), acum_val.get(k, 0.0)
        if abs(a - b) > 0.01:
            difs.append((k, a, b))
    if difs:
        print('  *** CP-08: corregido y validado DIFIEREN en %d conceptos:' % len(difs))
        for (k, a, b) in difs[:20]:
            print('      %s/%s  corregido=%.2f  validado=%.2f' % (k[0], k[1], a, b))
        print('      (esperado solo si hay cuentas 9.5.* o Vista<>GYP en el mes)')
    else:
        print('  CP-08: corregido == validado (coinciden con los datos del mes).')

    # --- 2. Serie mensual: los 12 meses anteriores (CP-09) ---
    serie = {}
    for f in consultar("""
    SELECT c.Empresa AS emp, {s} AS slot, DATE_FORMAT(g.FECHA,'yyyy-MM') AS mes,
           {suma} AS usd
    FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
    JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
    WHERE c.Empresa IN ('Beval','Febeca','Sillaca','Cofersa','Mundial','Prisma')
      AND g.FECHA >= '{a}' AND g.FECHA < '{i}'
      AND {gyp} AND {no95}
    GROUP BY c.Empresa, {s}, DATE_FORMAT(g.FECHA,'yyyy-MM')
    """.format(s=SLOT, suma=SUMA_USD, a=serie_ini, i=ini,
               gyp=COND_GYP, no95=COND_NO_95)):
        if f['slot'] in CONCEPTO:
            serie.setdefault((f['emp'], CONCEPTO[f['slot']]), {})[f['mes']] = round(num(f['usd']), 2)
    print('  serie histórica : 12 meses previos, %d conceptos' % len(serie))

    # --- 3. El corte: hasta qué día hay datos REALMENTE cargados (doc 07 §4) ---
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

    # --- 3b. CP-13 · mes terminado: si los registros ya llegan al último día
    #     hábil del mes, el corte salta al último día del mes. En un mes completo
    #     proyectado y causado coinciden. Se compara el corte contra el último
    #     día hábil de Venezuela (la bandera con más días: trabaja sábados).
    ultimo_dia_mes = (datetime.date(anio + (mes == 12), mes % 12 + 1, 1)
                      - datetime.timedelta(days=1))
    uh = consultar("""
    SELECT MAX(Date) AS ultimo
    FROM Gold.SIM.rolling
    WHERE Date >= '{i}' AND Date < '{f}' AND EsLaboralFE = 1
    """.format(i=ini, f=fin))
    ultimo_habil = str(uh[0]['ultimo']) if uh and uh[0].get('ultimo') else None
    if ultimo_habil and corte >= ultimo_habil[:10]:
        corte = ultimo_dia_mes.isoformat()
        print('  CP-13: los datos llegan al último día hábil (%s); '
              'corte al último día del mes: %s' % (ultimo_habil[:10], corte))
    print('  datos completos hasta: %s' % corte)

    # --- 4. Días hábiles del mes y transcurridos (DISTINCT, doc 07 §3.4) ---
    dias = {}
    for emp in EMP:
        b = BANDERA[emp]
        r = consultar("""
    SELECT COUNT(DISTINCT CASE WHEN {b}=1 THEN Date END) AS mes,
           COUNT(DISTINCT CASE WHEN {b}=1 AND Date <= '{c}' THEN Date END) AS trans
    FROM Gold.SIM.rolling WHERE Date >= '{i}' AND Date < '{f}'
    """.format(b=b, c=corte, i=ini, f=fin))[0]
        dias[emp] = (int(r['mes'] or 0), int(r['trans'] or 0))
    print('  días hábiles    : '
          + ', '.join('%s %d/%d' % (e, dias[e][1], dias[e][0]) for e in EMP))

    # --- 5. Tasa del mes (documento 07 §3.5) ---
    tasa = {}
    for f in consultar("""
    SELECT c.Empresa AS emp,
           MAX(g.Tasa_Mensual) AS declarada,
           SUM(COALESCE(g.Monto_Local,0) + COALESCE(g.Ajuste,0))
             / NULLIF({suma},0) AS implicita
    FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
    JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
    WHERE c.SubGrupo = 'Venta' AND g.FECHA >= '{i}' AND g.FECHA < '{f}'
      AND {gyp} AND {no95}
    GROUP BY c.Empresa
    """.format(suma=SUMA_USD, i=ini, f=fin, gyp=COND_GYP, no95=COND_NO_95)):
        # Declarada si existe y no es cero; si no, implícita. Venezuela cae a implícita.
        tasa[f['emp']] = round(num(f['declarada']) or num(f['implicita']), 4)
    # Prisma suele quedarse sin ninguna: promedio de Beval, Febeca y Sillaca.
    ve = [tasa[e] for e in ('Beval', 'Febeca', 'Sillaca') if tasa.get(e)]
    if ve and not tasa.get('Prisma'):
        tasa['Prisma'] = round(sum(ve) / len(ve), 4)
    print('  tasas           : '
          + ', '.join('%s %.2f' % (e, tasa.get(e, 0)) for e in EMP))

    # --- 6. CP-10 · Presupuesto del periodo por cuenta (presupuesto_gyp_v2) ---
    #     Viaja con la extracción en gyp_historico_cuenta.presupuesto.
    ppto = {}   # combinada -> presupuesto USD del periodo
    try:
        for f in consultar("""
    SELECT p.Combinada AS comb, SUM(COALESCE(p.Monto_USD,0)) AS usd
    FROM Gold.dbo.presupuesto_gyp_v2 p
    WHERE p.FECHA >= '{i}' AND p.FECHA < '{f}'
    GROUP BY p.Combinada
    """.format(i=ini, f=fin)):
            ppto[f['comb']] = round(num(f['usd']), 2)
        print('  presupuesto     : %d cuentas (presupuesto_gyp_v2)' % len(ppto))
    except Exception as e:
        print('  (sin presupuesto del periodo: %s)' % e)

    # --- 7. CP-11 · Detalle por cuenta (gyp_historico_cuenta + dim_cuenta) ---
    #     Acumulado del mes por Combinada (suma corregida CP-08) y los 12 meses
    #     anteriores. El catálogo (dim_cuenta) sale del propio catálogo de Gold.
    det_acum = {}     # combinada -> acumulado del mes
    det_info = {}     # combinada -> dict con empresa, cuenta, centro, concepto
    for f in consultar("""
    SELECT g.Combinada AS comb, c.Empresa AS emp,
           g.CUENTA_CONTABLE AS cuenta, g.CENTRO_COSTO AS centro,
           {s} AS slot, {suma} AS usd
    FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
    JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
    WHERE g.FECHA >= '{i}' AND g.FECHA < '{f}'
      AND {gyp} AND {no95}
    GROUP BY g.Combinada, c.Empresa, g.CUENTA_CONTABLE, g.CENTRO_COSTO, {s}
    """.format(s=SLOT, suma=SUMA_USD, i=ini, f=fin, gyp=COND_GYP, no95=COND_NO_95)):
        comb = f['comb']
        concepto = CONCEPTO.get(f['slot'], f['slot'])
        det_acum[comb] = round(det_acum.get(comb, 0.0) + num(f['usd']), 2)
        det_info[comb] = {
            'empresa': f['emp'], 'cuenta': f['cuenta'],
            'centro_costo': f['centro'], 'concepto': concepto,
        }
    # Los 12 meses anteriores por Combinada (para el backtest del cliente, CP-25).
    det_meses = {}    # combinada -> {mes: usd}
    for f in consultar("""
    SELECT g.Combinada AS comb, DATE_FORMAT(g.FECHA,'yyyy-MM') AS mes, {suma} AS usd
    FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
    JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
    WHERE g.FECHA >= '{a}' AND g.FECHA < '{i}'
      AND {gyp} AND {no95}
    GROUP BY g.Combinada, DATE_FORMAT(g.FECHA,'yyyy-MM')
    """.format(suma=SUMA_USD, a=serie_ini, i=ini, gyp=COND_GYP, no95=COND_NO_95)):
        det_meses.setdefault(f['comb'], {})[f['mes']] = round(num(f['usd']), 2)

    detalle = []
    for comb in sorted(set(det_acum) | set(det_meses)):
        info = det_info.get(comb, {})
        meses_json = {m: det_meses.get(comb, {}).get(m, 0.0) for m in meses12}
        detalle.append({
            'periodo': periodo_,
            'empresa': info.get('empresa', ''),
            'combinada': comb,
            'cuenta': info.get('cuenta', ''),
            'centro_costo': info.get('centro_costo', ''),
            'concepto': info.get('concepto', ''),
            'acumulado': det_acum.get(comb, 0.0),
            'presupuesto': ppto.get(comb, 0.0),
            'meses': meses_json,
        })
    print('  detalle x cuenta: %d cuentas (gyp_historico_cuenta)' % len(detalle))

    # Catálogo dim_cuenta desde el catálogo de Gold. El país sale del mapa propio
    # (CP-52): el campo pais del origen viene NULL en varias empresas.
    dim = []
    for f in consultar("""
    SELECT c.Combinada AS comb, c.Empresa AS emp,
           c.CUENTA_CONTABLE AS cuenta, c.CENTRO_COSTO AS centro,
           c.Descripcion AS descripcion, c.Seccion AS seccion,
           c.Linea AS linea, c.Detalle AS detalle,
           {s} AS slot
    FROM Gold.dbo.catalogo_gyp_general_v2 c
    WHERE c.Empresa IN ('Beval','Febeca','Sillaca','Cofersa','Mundial','Prisma')
    """.format(s=SLOT)):
        emp = f['emp']
        dim.append({
            'combinada': f['comb'],
            'empresa': emp,
            'pais': PAIS.get(emp, ''),
            'cuenta': f['cuenta'],
            'centro_costo': f['centro'],
            'descripcion': f.get('descripcion') or '',
            'seccion': f.get('seccion') or '',
            'linea': f.get('linea') or '',
            'detalle': f.get('detalle') or '',
            'concepto': CONCEPTO.get(f['slot'], f['slot'] or ''),
        })
    print('  catálogo        : %d cuentas (dim_cuenta)' % len(dim))

    # Cuadre del detalle por cuenta contra el resumen (CP-11). La suma del
    # acumulado por cuenta debe igualar la suma del acumulado por concepto.
    tot_det = round(sum(d['acumulado'] for d in detalle), 2)
    tot_res = round(sum(acum.values()), 2)
    if abs(tot_det - tot_res) > 0.5:
        print('  *** CP-11: el detalle por cuenta NO cuadra con el resumen '
              '(detalle=%.2f, resumen=%.2f, dif=%.2f)'
              % (tot_det, tot_res, tot_det - tot_res))
    else:
        print('  CP-11: detalle por cuenta cuadra con el resumen (%.2f)' % tot_det)

    # --- 8. CP-15 · Alertas: cuentas con movimiento en el mayor que el catálogo
    #     GyP no reconoce. Se cruza por Combinada el mayor (Vista GYP, sin 9.5.*)
    #     contra catalogo_gyp_general_v2. No se listan cuentas de balance.
    alertas = _calcular_alertas(periodo_, ini, fin, serie_ini)
    print('  alertas         : %d cuentas por revisar (proyeccion_alerta)' % len(alertas))

    # ─────────────────────────────────────────────────────────────────────────
    # GUARDAS antes de escribir (documento 07 §7). Si alguna falla, NO se escribe
    # este periodo (se avisa y se omite, sin tumbar los demás).
    # ─────────────────────────────────────────────────────────────────────────
    errores = []
    # Guarda 3: al menos un día completo.
    if all(dias[e][1] < 1 for e in EMP):
        errores.append('ningún día transcurrido tiene datos completos (trans=0 en todas).')
    # Guarda 1: la extracción trajo algo.
    if not acum and not serie:
        errores.append('la extracción no devolvió ningún concepto.')
    # Guarda 2: el corte avanzó respecto al publicado (la que más duele, §7).
    prev = corte_publicado(periodo_)
    if prev and corte <= prev:
        errores.append('el corte NO avanzó (publicado %s, nuevo %s). '
                       'Suele ser la ingesta parada; se conservan los datos buenos.'
                       % (prev, corte))
    if errores:
        print('  *** NO SE ESCRIBE este periodo. Guardas no superadas:')
        for e in errores:
            print('      - ' + e)
        raise GuardaNoSuperada('; '.join(errores), corte)

    # ─────────────────────────────────────────────────────────────────────────
    # Escritura a Supabase. Primero los datos, después el sello (doc 07 §6).
    # ─────────────────────────────────────────────────────────────────────────
    filas_escritas = 0

    # 1) Historia mensual: una fila por (periodo, empresa, concepto).
    hist = []
    todas = set(acum) | set(serie)
    for (emp, con) in sorted(todas):
        es_v = con in ES_VENTA
        hist.append({
            'periodo': periodo_, 'empresa': emp, 'concepto': con,
            'dim_subclasificacion': con, 'subgrupo': '',
            'monto_usd': acum.get((emp, con), 0.0), 'es_venta': es_v,
        })
        for m, v in serie.get((emp, con), {}).items():
            hist.append({
                'periodo': m, 'empresa': emp, 'concepto': con,
                'dim_subclasificacion': con, 'subgrupo': '',
                'monto_usd': v, 'es_venta': es_v,
            })
    _post('gyp_historico_mensual', hist,
          'periodo,empresa,dim_subclasificacion,subgrupo')
    filas_escritas += len(hist)
    print('  escritas %d filas en gyp_historico_mensual' % len(hist))

    # 2) Detalle por cuenta (CP-11). Se reemplaza el periodo para no acumular
    #    restos; dim_cuenta se hace upsert por su PK.
    if detalle:
        _delete('gyp_historico_cuenta', 'periodo=eq.%s' % periodo_)
        _post('gyp_historico_cuenta', detalle, 'periodo,combinada')
        filas_escritas += len(detalle)
        print('  escritas %d filas en gyp_historico_cuenta' % len(detalle))
    if dim:
        _post('dim_cuenta', dim, 'combinada')
        print('  escritas %d filas en dim_cuenta' % len(dim))

    # 3) Alertas del catálogo (CP-15). Reemplazo del periodo.
    _delete('proyeccion_alerta', 'periodo=eq.%s' % periodo_)
    if alertas:
        _post('proyeccion_alerta', alertas, 'periodo,combinada')
        filas_escritas += len(alertas)
        print('  escritas %d filas en proyeccion_alerta' % len(alertas))

    # 4) Parámetros por empresa, en dos pasos para NO pisar el factor_correccion
    #    que fija control (documento 07 §5).
    semilla = [{
        'periodo': periodo_, 'empresa': e,
        'dias_habiles_mes': dias[e][0], 'dias_transcurridos': dias[e][1],
        'tasa_local': tasa.get(e, 0.0), 'corte': corte,
        'factor_correccion': FACTOR_DEFECTO[e],
    } for e in EMP]
    _post('proyeccion_parametro', semilla, 'periodo,empresa', ignore_duplicates=True)
    for e in EMP:
        _patch('proyeccion_parametro', periodo_, e, {
            'dias_habiles_mes': dias[e][0], 'dias_transcurridos': dias[e][1],
            'tasa_local': tasa.get(e, 0.0), 'corte': corte,
            'updated_at': datetime.datetime.now().isoformat(),
        })
    print('  actualizadas %d filas en proyeccion_parametro (factor intacto)' % len(EMP))

    return corte, filas_escritas


def _calcular_alertas(periodo_, ini, fin, serie_ini):
    """CP-15 · Cruza el mayor (Vista GYP, sin 9.5.*) contra el catálogo y
    devuelve las cuentas por revisar. No lista cuentas de balance (activo,
    pasivo, patrimonio) marcadas GYP.

    accion:
      - 'crear'     : la Combinada tiene movimiento y NO está en el catálogo.
      - 'clasificar': está en el catálogo pero sin sección/subclasificación o
                      con una que la proyección no usa (slot fuera de CONCEPTO).
    (La acción 'corregir' —centro o mayúsculas que no cuadran— requiere un
    emparejamiento difuso que no hace el notebook; el aplicativo la deriva.)
    """
    alertas = []
    try:
        for filas in consultar("""
    SELECT g.Combinada AS comb,
           SUM(CASE WHEN g.FECHA >= '{i}' AND g.FECHA < '{f}'
                    THEN COALESCE(g.Monto_USD,0) + COALESCE(g.Ajuste_USD,0)
                    ELSE 0 END) AS mov_mes,
           SUM(CASE WHEN g.FECHA >= '{a}' AND g.FECHA < '{f}'
                    THEN COALESCE(g.Monto_USD,0) + COALESCE(g.Ajuste_USD,0)
                    ELSE 0 END) AS mov_12m,
           MAX(CASE WHEN g.FECHA >= '{i}' AND g.FECHA < '{f}'
                    THEN DATE_FORMAT(g.FECHA,'yyyy-MM') END) AS ult_mes,
           MAX(c.Combinada) AS cat_comb,
           MAX(c.Seccion) AS seccion,
           MAX({s}) AS slot
    FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
    LEFT JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
    WHERE g.FECHA >= '{a}' AND g.FECHA < '{f}'
      AND {gyp} AND {no95}
      AND g.CUENTA_CONTABLE NOT LIKE '1.%'   -- activo   (balance, no GyP)
      AND g.CUENTA_CONTABLE NOT LIKE '2.%'   -- pasivo
      AND g.CUENTA_CONTABLE NOT LIKE '3.%'   -- patrimonio
      AND g.CUENTA_CONTABLE NOT LIKE '1-%'
      AND g.CUENTA_CONTABLE NOT LIKE '2-%'
      AND g.CUENTA_CONTABLE NOT LIKE '3-%'
    GROUP BY g.Combinada
    """.format(i=ini, f=fin, a=serie_ini, s=SLOT, gyp=COND_GYP, no95=COND_NO_95)):
            comb = filas['comb']
            mov_mes = round(num(filas['mov_mes']), 2)
            mov_12m = round(num(filas['mov_12m']), 2)
            # Sin movimiento en ningún lado, no es una alerta.
            if abs(mov_mes) < 0.01 and abs(mov_12m) < 0.01:
                continue
            en_catalogo = bool(filas.get('cat_comb'))
            slot = filas.get('slot')
            seccion = filas.get('seccion')
            if not en_catalogo:
                accion = 'crear'
                sugerencia = 'Cuenta con movimiento fuera del catálogo GyP.'
            elif not seccion or slot not in CONCEPTO:
                accion = 'clasificar'
                sugerencia = ('Sin sección o con una subclasificación que la '
                              'proyección no usa.')
            else:
                # En el catálogo y bien clasificada: no es alerta.
                continue
            alertas.append({
                'periodo': periodo_,
                'combinada': comb,
                'accion': accion,
                'sugerencia': sugerencia,
                'movimiento_mes': mov_mes,
                'movimiento_12m': mov_12m,
                'ultimo_mes': filas.get('ult_mes'),
            })
    except Exception as e:
        print('  (no se pudieron calcular las alertas: %s)' % e)
    return alertas


class GuardaNoSuperada(Exception):
    """Una guarda del documento 07 §7 falló: este periodo no se escribe."""
    def __init__(self, mensaje, corte):
        super().__init__(mensaje)
        self.corte = corte


# ─────────────────────────────────────────────────────────────────────────────
# Orquestación: procesa cada periodo con su propia fila de bitácora (CP-14).
# CP-12: sin argumentos, mes en curso + anterior con una sola conexión de Spark.
# ─────────────────────────────────────────────────────────────────────────────

periodos = _periodos_a_procesar()
print('Periodos a extraer (%d): %s' % (len(periodos), ', '.join(periodos)))

resumen = []
for periodo_ in periodos:
    corrida_id = corrida_abrir(periodo_)        # en_curso (CP-14)
    try:
        corte, filas = extraer_periodo(periodo_)
        corrida_cerrar(corrida_id, 'ok', filas=filas, corte=corte,
                       mensaje='Extracción completada.')
        resumen.append((periodo_, 'ok', corte, filas))
    except GuardaNoSuperada as g:
        # Guarda del §7: no es un error del notebook, es un dato insuficiente.
        corrida_cerrar(corrida_id, 'omitida', corte=g.corte, mensaje=str(g))
        resumen.append((periodo_, 'omitida', g.corte, 0))
    except Exception as e:
        corrida_cerrar(corrida_id, 'error', mensaje=str(e))
        resumen.append((periodo_, 'error', None, 0))
        print('  *** ERROR en %s: %s' % (periodo_, e))

print('\n─────────── Resumen de la corrida (%s) ───────────' % ORIGEN)
for (p, estado, corte, filas) in resumen:
    print('  %s · %s · corte %s · %s filas' % (p, estado, corte or '—', filas))
print('OK · Fabric → Supabase · generado %s'
      % datetime.datetime.now().strftime('%Y-%m-%d %H:%M'))
