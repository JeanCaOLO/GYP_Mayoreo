# -*- coding: utf-8 -*-
"""Puebla en QA las dos tablas que faltan: gyp_historico_cuenta y dim_cuenta.

POR QUE EXISTE: el notebook de productivo solo refleja gyp_historico_mensual y
proyeccion_parametro. El detalle por cuenta y el catalogo los escribe
`fabric/refrescar_proyeccion_fabric.py`, que necesita correr DENTRO de Fabric
(usa Spark). Este script hace lo mismo desde fuera: lee Gold por el endpoint SQL
en SOLO LECTURA y escribe en QA.

NO INVENTA LOGICA: el SQL es el del script, copiado tal cual, incluidas las
condiciones de vista, la exclusion de 9.5.* y la suma con COALESCE en las dos
patas (CP-08).

ESCRIBE UNICAMENTE EN QA. La URL va fija y se comprueba antes de cada escritura.
"""
import json
import os
import sys
import urllib.request
import urllib.error

sys.path.insert(0, r'C:/Users/uSer/Documents/Eric/Reportes OLO/GYP Fabric Productivo/Agent GYP Fabric/herramientas')
import fabric  # noqa: E402

# La clave NUNCA va escrita aqui: este repositorio es PUBLICO. Se pasa por
# entorno antes de ejecutar:
#   $env:QA_SUPABASE_URL = 'https://<ref-de-qa>.supabase.co'
#   $env:QA_SUPABASE_KEY = '<service_role de QA>'
QA_URL = (os.environ.get('QA_SUPABASE_URL') or '').strip().rstrip('/')
QA_KEY = (os.environ.get('QA_SUPABASE_KEY') or '').strip()
if not QA_URL or not QA_KEY:
    raise SystemExit(
        'Faltan QA_SUPABASE_URL y QA_SUPABASE_KEY en el entorno. '
        'La clave no se escribe en el repositorio.')
PERIODO = '2026-10'
INI, FIN = '2026-10-01', '2026-11-01'
SERIE_INI = '2025-10-01'          # 12 meses atras, como el script

PROD = 'laiiyfjxfvilupiccosf'     # jamas se escribe aqui
if PROD in QA_URL:
    raise SystemExit('QA_SUPABASE_URL apunta a PRODUCTIVO. Abortado.')

EMP = ['Beval', 'Febeca', 'Sillaca', 'Cofersa', 'Mundial', 'Prisma']
SLOT = ("CASE WHEN c.Dim_SubClasificacion='Margen' THEN 'Margen-'+c.SubGrupo "
        "ELSE c.Dim_SubClasificacion END")
SUMA = "SUM(COALESCE(g.Monto_USD,0) + COALESCE(g.Ajuste_USD,0))"
GYP = "g.Vista = 'GYP'"
NO95 = "g.CUENTA_CONTABLE NOT LIKE '9.5.%'"
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
PAIS = {'Beval': 'Venezuela', 'Febeca': 'Venezuela', 'Sillaca': 'Venezuela',
        'Prisma': 'Venezuela', 'Cofersa': 'Costa Rica', 'Mundial': 'Colombia'}


def num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


_pool = {}


def consultar(sql, db='Gold'):
    if db not in _pool:
        _pool[db] = fabric.conectar(db)
    cur = _pool[db].cursor()
    cur.execute(sql)
    cols = [d[0] for d in cur.description]
    filas = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close()
    return filas


def _post(tabla, filas, on_conflict):
    """UPSERT por lotes contra PostgREST. Falla ruidosamente."""
    if not filas:
        print('    %s: nada que escribir' % tabla)
        return 0
    if PROD in QA_URL:
        raise SystemExit('destino es productivo; abortado')
    url = '%s/rest/v1/%s?on_conflict=%s' % (QA_URL, tabla, on_conflict)
    headers = {
        'apikey': QA_KEY,
        'Authorization': 'Bearer ' + QA_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
    }
    escritas = 0
    for i in range(0, len(filas), 500):
        lote = filas[i:i + 500]
        req = urllib.request.Request(
            url, data=json.dumps(lote).encode('utf-8'),
            headers=headers, method='POST')
        try:
            urllib.request.urlopen(req, timeout=120).read()
        except urllib.error.HTTPError as e:
            raise SystemExit('Error escribiendo %s: HTTP %s %s'
                             % (tabla, e.code, e.read().decode('utf-8')[:400]))
        escritas += len(lote)
        print('    %s: %d/%d' % (tabla, escritas, len(filas)))
    return escritas


print('=' * 68)
print('  POBLANDO QA: %s' % QA_URL)
print('  periodo %s | lectura de Fabric en SOLO LECTURA' % PERIODO)
print('=' * 68)

# ── 1 · Acumulado del mes por Combinada (SQL del script, tal cual) ──
det_acum, det_info = {}, {}
for f in consultar("""
SELECT g.Combinada AS comb, c.Empresa AS emp,
       g.CUENTA_CONTABLE AS cuenta, g.CENTRO_COSTO AS centro,
       {s} AS slot, {suma} AS usd
FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
WHERE g.FECHA >= '{i}' AND g.FECHA < '{f}' AND {gyp} AND {no95}
GROUP BY g.Combinada, c.Empresa, g.CUENTA_CONTABLE, g.CENTRO_COSTO, {s}
""".format(s=SLOT, suma=SUMA, i=INI, f=FIN, gyp=GYP, no95=NO95)):
    comb = f['comb']
    det_acum[comb] = round(det_acum.get(comb, 0.0) + num(f['usd']), 2)
    det_info[comb] = {
        'empresa': f['emp'], 'cuenta': f['cuenta'],
        'centro_costo': f['centro'],
        'concepto': CONCEPTO.get(f['slot'], f['slot']),
    }
print('  acumulado del mes : %d combinadas' % len(det_acum))

# ── 2 · Los 12 meses anteriores ──
det_meses = {}
for f in consultar("""
SELECT g.Combinada AS comb, FORMAT(g.FECHA,'yyyy-MM') AS mes, {suma} AS usd
FROM Gold.dbo.gld_mayor_mayoreo_agrupado_v2 g
JOIN Gold.dbo.catalogo_gyp_general_v2 c ON c.Combinada = g.Combinada
WHERE g.FECHA >= '{a}' AND g.FECHA < '{i}' AND {gyp} AND {no95}
GROUP BY g.Combinada, FORMAT(g.FECHA,'yyyy-MM')
""".format(suma=SUMA, a=SERIE_INI, i=INI, gyp=GYP, no95=NO95)):
    det_meses.setdefault(f['comb'], {})[f['mes']] = round(num(f['usd']), 2)
print('  serie 12 meses    : %d combinadas' % len(det_meses))

# ── 3 · Presupuesto (con el arreglo de C6: p.Fecha, y Olo fuera) ──
ppto = {}
for f in consultar("""
SELECT p.Combinada AS comb, SUM(COALESCE(p.Monto_USD,0)) AS usd
FROM Gold.dbo.presupuesto_gyp_v2 p
WHERE p.Fecha >= '{i}' AND p.Fecha < '{f}'
  AND p.Empresa IN ('Beval','Febeca','Sillaca','Cofersa','Mundial','Prisma')
GROUP BY p.Combinada
""".format(i=INI, f=FIN)):
    ppto[f['comb']] = round(num(f['usd']), 2)
print('  presupuesto       : %d cuentas' % len(ppto))

meses12 = sorted(set(m for d in det_meses.values() for m in d))[-12:]
detalle = []
for comb in sorted(set(det_acum) | set(det_meses)):
    info = det_info.get(comb, {})
    if not info.get('empresa'):
        continue
    detalle.append({
        'periodo': PERIODO,
        'empresa': info['empresa'],
        'combinada': comb,
        'cuenta': info.get('cuenta', ''),
        'centro_costo': info.get('centro_costo', ''),
        'concepto': info.get('concepto', ''),
        'acumulado': det_acum.get(comb, 0.0),
        'presupuesto': ppto.get(comb, 0.0),
        'meses': {m: det_meses.get(comb, {}).get(m, 0.0) for m in meses12},
    })
print('  detalle a escribir: %d filas' % len(detalle))

# ── 4 · Catalogo dim_cuenta ──
dim = []
for f in consultar("""
SELECT c.Combinada AS comb, c.Empresa AS emp, c.Cuenta AS cuenta,
       c.Centro_Costo AS centro, c.Descripcion AS descripcion,
       c.Clasificacion AS seccion, c.SubClasificacion AS linea,
       c.SubGrupo AS detalle, {s} AS slot
FROM Gold.dbo.catalogo_gyp_general_v2 c
WHERE c.Empresa IN ('Beval','Febeca','Sillaca','Cofersa','Mundial','Prisma')
""".format(s=SLOT)):
    emp = f['emp']
    dim.append({
        'combinada': f['comb'], 'empresa': emp, 'pais': PAIS.get(emp, ''),
        'cuenta': f['cuenta'], 'centro_costo': f['centro'],
        'descripcion': f.get('descripcion') or '',
        'seccion': f.get('seccion') or '', 'linea': f.get('linea') or '',
        'detalle': f.get('detalle') or '',
        'concepto': CONCEPTO.get(f['slot'], f['slot'] or ''),
    })
print('  catalogo a escribir: %d filas' % len(dim))

print()
print('  --- escribiendo en QA ---')
_post('gyp_historico_cuenta', detalle, 'periodo,combinada')
_post('dim_cuenta', dim, 'combinada')
print()
print('  OK - QA poblado')
