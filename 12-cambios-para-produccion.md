# 12 · Paquete de cambios para el aplicativo de Proyección GyP

**Para:** la persona que mantiene el aplicativo de Proyección GyP en producción.
**Fecha:** 22-oct-2026.

**Origen:** la última versión del artefacto *Proyección GyP Mayoreo RM*, documentada
en `Proyeccion_GyP_Mayoreo_documentacion.md`, más el paquete
`Proyeccion_GyP_Aplicativo_v2` (prototipo, código y documentación del 21-oct-2026).

Este documento es la lista **completa** de lo que hay que pasar al aplicativo:

- **Parte I** — los cambios, numerados `CP-01` … `CP-55`, con qué hacer y por qué.
- **Parte II** — la especificación de referencia del motor: las fórmulas y reglas
  de agregación que tienen que replicarse **idénticas**, o los números no cuadran.
- **Parte III** — verificación y pendientes.

La Parte II no es «documentación de contexto»: es la parte que, si se reimplementa
de memoria, produce un P&L que parece razonable y está mal.

---

# Parte I · Los cambios

## 1. Resumen

| # | Cambio | Bloque | Prioridad |
|---|---|---|---|
| CP-01 | La tabla final lleva los dos escenarios (append) | Salida | **Crítica** |
| CP-02 | Columna `escenario` y clave única en `proyeccion_resultado` | Salida | **Crítica** |
| CP-03 | Escritura idempotente en una transacción | Salida | **Crítica** |
| CP-04 | `FECHA` = día 1 del periodo | Salida | **Crítica** |
| CP-05 | `Tasa_Mensual` solo para Cofersa y Mundial | Salida | **Crítica** |
| CP-06 | Fusionar reglas que caen en la misma cuenta antes del insert | Salida | Alta |
| CP-07 | Validar `Combinada` contra el catálogo antes de publicar | Salida | Alta |
| CP-52 | Mapa de países propio: `pais` llega NULL del origen | Salida | **Crítica** |
| CP-08 | Suma corregida: `COALESCE`, `Vista='GYP'`, fuera `9.5.*` | Datos | Alta |
| CP-09 | Serie de los 12 meses anteriores | Datos | Alta |
| CP-10 | El presupuesto del periodo viaja con la extracción | Datos | Alta |
| CP-11 | Detalle por cuenta: `gyp_historico_cuenta` + `dim_cuenta` | Datos | Alta |
| CP-12 | Extracción de dos meses (en curso y anterior) | Datos | Media |
| CP-13 | Mes terminado: el corte salta al último día | Datos | Media |
| CP-14 | Actualización manual: los botones se quedan | Datos | Alta |
| CP-56 | Actualización programada, configurable en hora de Caracas | Datos | Alta |
| CP-15 | Tabla de alertas producida por la extracción | Datos | Media |
| CP-42 | Cargar la parametrización de octubre | Datos | **Crítica** |
| CP-16 | Bases por capas del catálogo, con incluir y excluir | Motor | Alta |
| CP-17 | Origen real con medida elegible | Motor | Alta |
| CP-18 | Métodos compuestos y métodos de fábrica nuevos | Motor | Alta |
| CP-19 | Cuatro modos de causado por regla | Motor | **Crítica** |
| CP-20 | Destino por capas y reparto entre cuentas | Motor | Alta |
| CP-21 | Reglas por cuenta en lote; el concepto calcula el resto | Motor | Alta |
| CP-22 | Reglas adicionales que se suman a un concepto | Motor | Media |
| CP-49 | Campo `escenarios`: solo proyectado, solo causado o ambos | Motor | Alta |
| CP-51 | Detectar dependencias circulares al guardar | Motor | Alta |
| CP-23 | Proyectado y causado lado a lado | Interfaz | Alta |
| CP-24 | Reglas como único lugar de trabajo | Interfaz | Alta |
| CP-25 | Cada opción muestra su número y su error | Interfaz | Alta |
| CP-26 | El impacto se ve antes de guardar | Interfaz | Media |
| CP-27 | Lo técnico, agrupado en «Avanzado» | Interfaz | Media |
| CP-28 | «Mis fórmulas»: fórmulas por piezas | Interfaz | Media |
| CP-29 | Nombre y detalle por regla | Interfaz | Media |
| CP-30 | «+ Agregar regla» con tres caminos | Interfaz | Media |
| CP-31 | Eliminar con deshacer y restaurar | Interfaz | Media |
| CP-32 | Nombres de Fabric en pantalla, claves heredadas por dentro | Interfaz | Alta |
| CP-33 | Mes de trabajo, con su estado, y factor guardado por mes | Interfaz | Alta |
| CP-34 | Pestaña Alertas, con CSV y plantilla del catálogo | Interfaz | Media |
| CP-53 | Plantilla del catálogo: 18 columnas y exclusiones | Interfaz | Media |
| CP-35 | «¿Por qué este número?» | Interfaz | Baja |
| CP-36 | Ruido retirado de la interfaz | Interfaz | Baja |
| CP-45 | Pestaña Comparar | Interfaz | Alta |
| CP-46 | Cabecera: KPIs siempre visibles y sello de frescura | Interfaz | Alta |
| CP-47 | Prueba contable de la Renta Bruta | Interfaz | **Crítica** |
| CP-48 | Reglas: agrupación por bloque y etiquetas de fila | Interfaz | Media |
| CP-50 | Las ocho validaciones en pantalla | Interfaz | Alta |
| CP-55 | Descargas desde el navegador (CSV y XLSX) | Interfaz | Media |
| CP-37 | Parametrización y reglas compartidas en Supabase | Persistencia | **Crítica** |
| CP-38 | Bloqueo optimista con `rev` y `wid` | Persistencia | Alta |
| CP-39 | Copiar los datos de solo lectura antes de modificarlos | Persistencia | Alta |
| CP-40 | Registrar quién hizo cada cambio | Persistencia | Media |
| CP-41 | «Volver a las reglas de partida» | Persistencia | Baja |
| CP-54 | Suscripción en tiempo real a los cambios | Persistencia | Alta |
| CP-43 | La prueba de 190 casos corre en el despliegue | Verificación | **Crítica** |
| CP-44 | Checklist antes de publicar | Verificación | Alta |

---

## 2. Cómo está conectado

```
Aplicativo ──escribe──▶ Supabase: proyeccion_resultado
                             │
Fabric (notebook) ─escribe──▶ Supabase: histórico, catálogo, presupuesto, alertas
                             │
                   Supabase: v_proyeccion_final   ← la tabla final
                             │
                   copyjob ──▶ Fabric: Bronze.supabase.brz_v_proyeccion_final
                             │
                   Power BI: F_Mayor (los escenarios en una sola tabla)
```

El aplicativo **no consulta Fabric**: el firewall de Fabric no acepta la IP de
Supabase. Fabric empuja a Supabase y el aplicativo lee de Supabase. Ese camino ya
está resuelto.

Fuentes en Fabric / Gold: `gld_mayor_mayoreo_agrupado_v2`,
`catalogo_gyp_general_v2`, `presupuesto_gyp_v2`, `Dim_SubClasificacion`.

---

## 3. Dónde vive cada cosa

El prototipo guarda en la base del artefacto; producción guarda en Supabase.

| Documento del prototipo | Qué guarda | En Supabase |
|---|---|---|
| `datos/<aaaa-mm>` | extracción del mes: series, acumulados, empresas, presupuesto, corte | `gyp_historico_mensual` |
| `datos/meses` | índice de meses disponibles con su corte | `SELECT DISTINCT periodo` |
| `datos/actual` | formato anterior de un solo mes, por compatibilidad | se retira |
| `cuentas/<aaaa-mm>_indice`, `_<parte>` | detalle por cuenta: capas, acumulado, presupuesto y 12 meses | `gyp_historico_cuenta` |
| `alertas/<aaaa-mm>` | revisión del catálogo y filas de plantilla | `proyeccion_alerta` |
| `config/periodo` | mes de trabajo común | `proyeccion_parametro` |
| `config/reglas` | reglas cambiadas, nuevas y eliminadas; fórmulas propias; causado por fórmula; factor por mes | `proyeccion_regla` + `proyeccion_formula` |
| `config/parametrizacion` | método por regla acordado, con su motivo | columnas de `proyeccion_regla` |
| `config/solicitud` | petición de extracción: pendiente / atendida / error | `proyeccion_corrida` (CP-14) |
| `config/programacion` | horario de extracción y última corrida | `proyeccion_programacion` (CP-56) |

Las partes y el índice del detalle por cuenta existen solo porque la base del
artefacto limita el tamaño por documento. En Supabase es una tabla con un `WHERE`.

El artefacto usa dos capacidades: **`db`** (base compartida) y **`downloads`**
(generar archivos en el navegador). En producción son la base de datos y las
descargas de CSV y XLSX (CP-55).

---

## 4. Esquema propuesto

Propuesta: importan las columnas, no los nombres.

```sql
-- Salida. Lo que lee Power BI.
ALTER TABLE proyeccion_resultado ADD COLUMN escenario smallint NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX ux_proy_resultado
  ON proyeccion_resultado (periodo, escenario, combinada);

-- Reglas.
ALTER TABLE proyeccion_regla
  ADD COLUMN nombre      text,
  ADD COLUMN detalle     text,
  ADD COLUMN causado     text    NOT NULL DEFAULT 'igual',   -- igual|habiles|calendario|real
  ADD COLUMN escenarios  text    NOT NULL DEFAULT 'AMBOS',   -- AMBOS|PROYECCION|CAUSADO
  ADD COLUMN nivel       text    NOT NULL DEFAULT 'concepto',-- concepto|cuenta
  ADD COLUMN n           smallint,                           -- meses a mirar
  ADD COLUMN destino     jsonb,                              -- capas + reparto
  ADD COLUMN formula_id  bigint REFERENCES proyeccion_formula(id),
  ADD COLUMN eliminada   boolean NOT NULL DEFAULT false,
  ADD COLUMN rev         integer NOT NULL DEFAULT 0,
  ADD COLUMN wid         text,
  ADD COLUMN actualizado timestamptz,
  ADD COLUMN actualizado_por text;

-- Métodos y fórmulas propias.
CREATE TABLE proyeccion_formula (
  id         bigserial PRIMARY KEY,
  nombre     text    NOT NULL,
  pasos      jsonb   NOT NULL,     -- las piezas
  orden      smallint NOT NULL DEFAULT 1,   -- turno; se deduce de las bases
  invertir   boolean NOT NULL DEFAULT false,
  causado    text    NOT NULL DEFAULT 'igual',
  de_fabrica boolean NOT NULL DEFAULT false,
  rev        integer NOT NULL DEFAULT 0
);

-- Lo que empuja Fabric.
CREATE TABLE gyp_historico_cuenta (
  periodo text, empresa text, combinada text,
  cuenta text, centro_costo text, concepto text,
  acumulado numeric, presupuesto numeric,
  meses jsonb,                       -- los 12 meses anteriores
  PRIMARY KEY (periodo, combinada)
);

CREATE TABLE dim_cuenta (
  combinada text PRIMARY KEY,
  empresa text, pais text, cuenta text, centro_costo text,
  descripcion text, seccion text, linea text, detalle text, concepto text
);

CREATE TABLE proyeccion_alerta (
  periodo text, combinada text,
  accion text,                       -- crear|corregir|clasificar
  sugerencia text,
  movimiento_mes numeric, movimiento_12m numeric, ultimo_mes numeric,
  PRIMARY KEY (periodo, combinada)
);

-- Parámetros por empresa y mes.
-- dias_habiles, transcurridos, factor, tasa_local. El factor es editable
-- y se guarda POR MES (CP-33).

-- Actualización programada (CP-56).
CREATE TABLE proyeccion_programacion (
  id          smallint PRIMARY KEY DEFAULT 1,
  activa      boolean NOT NULL DEFAULT false,
  frecuencia  text    NOT NULL,          -- diaria|habiles|semanal
  dia_semana  smallint,                  -- 1..7, solo si frecuencia = 'semanal'
  hora_local  time    NOT NULL,          -- HORA DE PUBLICACION, EN CARACAS
  zona        text    NOT NULL DEFAULT 'America/Caracas',
  exige_datos_frescos boolean NOT NULL DEFAULT true,  -- no publica con datos viejos
  periodo     text,                      -- null = el mes de trabajo vigente
  rev         integer NOT NULL DEFAULT 0,
  actualizado_por text
);

-- Bitácora de cada corrida, programada o manual (CP-14 y CP-56).
CREATE TABLE proyeccion_corrida (
  id          bigserial PRIMARY KEY,
  periodo     text    NOT NULL,
  origen      text    NOT NULL,          -- programada|manual
  paso        text    NOT NULL,          -- extraccion|calculo|publicacion
  estado      text    NOT NULL,          -- en_curso|ok|error|omitida
  inicio      timestamptz NOT NULL DEFAULT now(),
  fin         timestamptz,
  filas       integer,
  corte       date,                      -- hasta qué día traía datos la extracción
  mensaje     text,
  lanzada_por text
);
CREATE INDEX ix_corrida ON proyeccion_corrida (periodo, inicio DESC);
```

---

## 5. Bloque Salida

### CP-01 · La tabla final lleva los dos escenarios

**Es el cambio que manda este paquete.** Hoy el prototipo emite **un escenario a
la vez**, el que esté seleccionado en pantalla:

```js
window.__csv = () => [...]
  .concat(SAL.map(({r, f}) => [fIso, 0, 'GYP', f.comb, ..., ESC_NUM[esc()]].join(';')))
//                                                        ^^^^^^^^^^^^^^
//                                                        1 ó 2, nunca los dos
```

Y así está en producción. Consultado contra Fabric el 22-oct:

| Proyeccion | periodo | filas | llaves | USD | calculado |
|---|---|---|---|---|---|
| 1 | 2026-10 | 95 | 95 | −1.052.066,67 | 2026-10-20 11:51 |

Falta el escenario 2 entero.

**Qué se necesita:** `v_proyeccion_final` devuelve el **append de los dos
escenarios**, distinguidos por la columna `Proyeccion`:

- `Proyeccion = 1` → Proyectado al cierre
- `Proyeccion = 2` → Causado al corte

Para 2026-10, ~190 filas en lugar de 95. El modelo de Power BI ya está preparado:
filtra por `Proyeccion` y arma cada escenario con la historia real más el mes que
ese escenario reemplaza. Mientras falte, el Causado del reporte va a mano.

Publicar recorre `['PROYECCION','CAUSADO']` en vez de usar el escenario de
pantalla. Ojo con CP-49: una regla puede declarar que solo cuenta en uno de los
dos.

### CP-02 · Columna `escenario` y clave única

Hoy el deduplicado es por `(periodo, combinada)`: si entra el causado, pisa a la
proyección. La clave pasa a `(periodo, escenario, combinada)`, con índice único.

### CP-03 · Escritura idempotente

Publicar dos veces el mismo mes deja filas duplicadas o mezcladas con la corrida
anterior, y el P&L las suma. En Power BI eso no da error: da un número mal.

```sql
BEGIN;
DELETE FROM proyeccion_resultado WHERE periodo = $1 AND escenario = $2;
INSERT INTO proyeccion_resultado (...) VALUES ...;
COMMIT;
```

### CP-04 · `FECHA` = día 1 del periodo

El mayor de oro es 100 % día 1 (123.902 de 123.902 filas). Una fecha intermedia
desalinea el mes en curso. La v2 ya lo corrigió en el extractor —antes estaba fija
en 01/10/2026—; hay que asegurarlo también en la salida del aplicativo.

### CP-05 · `Tasa_Mensual` solo para Cofersa y Mundial

Hoy viene NULL para todas. En las venezolanas **debe seguir siendo NULL**: el
mayor ya trae el local. Para Cofersa y Mundial hay que poblarla con la tabla de
tasas que Fabric empuja, porque `Monto_Local = Monto_USD × tasa`.

Valores de la extracción del 8-oct, como referencia de magnitud: Cofersa
452,1257 · Mundial 3.126,7800.

### CP-06 · Fusionar las reglas que caen en la misma cuenta

Con `destino`/reparto, dos reglas pueden ir a la misma Combinada. Salen **sumadas
en una fila**. Esa fusión tiene que ocurrir **antes** del insert, o el índice único
de CP-02 la rechaza.

### CP-07 · Validar `Combinada` contra el catálogo

Una llave huérfana **no da error**: la fila desaparece del reporte, sin aviso. El
aplicativo debe validarla contra `dim_cuenta` antes de publicar y mostrarlo. Es la
contrapartida de la pestaña Alertas (CP-34).

### CP-52 · Mapa de países propio

En los datos de origen el campo `pais` viene **`NULL` en Beval, Sillaca y
Cofersa**. La página usa su propio mapa para llenar la columna `Pais` de la tabla
de salida. **Ese mapa tiene que viajar al aplicativo**; si se confía en el origen,
tres de las seis empresas salen con el país vacío.

| Empresa | País |
|---|---|
| Beval, Febeca, Sillaca, Prisma | Venezuela |
| Cofersa | Costa Rica |
| Mundial | Colombia |

### Contrato de la tabla final

Trece columnas con estos nombres y tipos exactos. Cambiar uno rompe `F_Mayor` en
silencio. Contrato completo en `08-tabla-final-proyeccion.md`.

| Columna | Contenido |
|---|---|
| `FECHA` | día 1 del periodo (01/10/2026), como consolida Gold |
| `Ajuste` | 0 |
| `Vista` | `GYP` |
| `Combinada` | cuenta + centro de costo + empresa |
| `Pais` | del mapa de CP-52 |
| `Empresa` | Febeca, Sillaca, Beval, Prisma, Mundial, Cofersa |
| `Tasa_Mensual` | solo Cofersa y Mundial; NULL en las venezolanas |
| `Ajuste_USD` | 0 |
| `Monto_Local` | `Monto_USD × tasa local` |
| `Monto_USD` | resultado de la regla, o su parte del reparto |
| `CENTRO_COSTO` | destino |
| `CUENTA_CONTABLE` | destino |
| `Proyeccion` | 1 = Proyectado al cierre, 2 = Causado al corte |

Orden exacto del CSV, separador `;`:

```
FECHA;Ajuste;Vista;Combinada;Pais;Empresa;Tasa_Mensual;Ajuste_USD;Monto_Local;Monto_USD;CENTRO_COSTO;CUENTA_CONTABLE;Proyeccion
```

Una fila **por cuenta de destino**: una regla repartida aporta varias.

---

## 6. Bloque Datos y extracción

### CP-08 · La suma corregida

En la v1, `SUM(Monto_USD + ISNULL(Ajuste_USD,0))` perdía sin avisar las filas con
`Monto_USD` nulo. El modo `corregido` pone `COALESCE` en las dos patas, filtra
solo `Vista = 'GYP'` y excluye las cuentas `9.5.*` de proyección. Es la consulta
que debe quedar. El modo `validado` reproduce la original: con los datos de
octubre los dos dan lo mismo, y el script lo comprueba en cada corrida.

### CP-09 · Serie de los 12 meses anteriores

Antes la serie iba de enero al mes anterior, así que en enero no había historia y
los promedios daban cero. Ahora son siempre los 12 meses anteriores.

### CP-10 · El presupuesto viaja con la extracción

El presupuesto del periodo (`presupuesto_gyp_v2`) deja de estar copiado dentro de
la página. Lo necesitan el método «Lo presupuestado» (CP-18), el reparto por
presupuesto (CP-20) y la pestaña Comparar (CP-45).

### CP-11 · Detalle por cuenta

Las cuentas del catálogo con sus capas, acumulado, presupuesto y 12 meses, con
cuadre automático contra el resumen. Son `gyp_historico_cuenta` y `dim_cuenta`, y
las produce el notebook de Fabric: **no existen todavía**. Avisa cuándo las
necesitas y se agregan al notebook que ya escribe a Supabase.

Sin ellas no funcionan: las bases por capas (CP-16) —que quedan limitadas a
empresa, grupo y concepto—, las reglas por cuenta (CP-21), el reparto (CP-20), el
backtest en pantalla (CP-25) y las alertas (CP-15).

### CP-12 · Extracción de dos meses

Sin argumentos, el extractor saca el mes en curso y el anterior con una sola
conexión; `--meses N` para más, `--periodo` para uno. Así el 2 de noviembre se
sigue trabajando octubre hasta el cierre.

### CP-13 · Mes terminado

El extractor pone el corte en el último día del mes si los registros ya llegan al
último día hábil. En un mes completo, proyectado y causado coinciden.

### CP-14 · Actualización manual: los botones se quedan

Hoy «Pedir extracción» solo deja anotada la petición en `config/solicitud`, y la
atiende una persona corriendo el script a mano.

En producción **los botones se quedan, pero dejan de ser una nota y pasan a
ejecutar**:

| Botón | Qué hace |
|---|---|
| **Actualizar** | vuelve a leer de Supabase la última extracción publicada por Fabric (no ejecuta nada) |
| **Publicar la tabla final ahora** | recalcula los dos escenarios y escribe `proyeccion_resultado` |

El aplicativo **no dispara la extracción**: esa la corre Fabric por su cuenta
(ver CP-56). Por eso no hay botón de «traer datos de Fabric»; lo que sí hay es el
sello que dice de cuándo son los datos que tiene a la mano (CP-46).

Cada pulsación deja una fila en `proyeccion_corrida` con `origen = 'manual'`, quién
la lanzó y en qué acabó. Eso es lo que alimenta el sello de frescura (CP-46).

Lo manual sigue haciendo falta aunque haya programación: un cierre, una corrección
de última hora o un mes que se reabre no esperan al horario.

### CP-56 · Actualización programada, en hora de Caracas

**Es el cambio que faltó de la última versión.** Hoy toda la cadena se dispara a
mano. Tiene que poder programarse.

En el prototipo esto existía a medias: un panel de programación
(`config/programacion`) **oculto por defecto**, que solo dejaba anotado el horario
para que una persona con acceso a Fabric supiera cuándo correr el script. No
ejecutaba nada.

> **Corrijo lo que recomendé antes.** En la versión anterior de este documento
> propuse retirar ese panel y dejar la programación del lado de Fabric. Se
> descarta: la programación se configura **desde el aplicativo**, porque quien
> decide a qué hora se recalcula es quien usa el aplicativo, no quien administra
> Fabric.

#### Dónde va

En **Parámetros**, **abajo y a primera vista** — no detrás de «Más opciones» ni de
ningún desplegable. Es lo segundo que mira quien entra: arriba sobre qué mes
trabaja, abajo cuándo se actualiza solo.

#### Qué se configura

| Campo | Valores |
|---|---|
| Estado | activa / pausada |
| Frecuencia | todos los días · solo días hábiles · semanal (con día) |
| Hora de publicación | **en hora de Caracas** |
| Mes | el mes de trabajo vigente (por defecto) o uno fijo |
| No publicar con datos viejos | sí (recomendado) / no |

Y debajo, en modo lectura, dos cosas distintas que no hay que confundir:

- **Datos de Fabric:** «última extracción 22 oct 6:10 a. m. · registros hasta el
  21 oct». Es informativo: lo trae Fabric, el aplicativo no lo controla.
- **Publicación:** la última —cuándo, cuánto tardó, cuántas filas— y la próxima,
  escrita en claro: «Próxima: mañana 23 oct, 7:30 a. m. (Caracas)».

#### Qué ejecuta, y qué no

**El notebook de Fabric corre por su cuenta, con su propia programación.** El
aplicativo no lo dispara ni lo espera: cuando le toca publicar, los datos nuevos ya
están en Supabase.

Lo que programa el aplicativo son los dos últimos pasos de la cadena:

```
   (Fabric, programado aparte)
1. Extracción      Fabric ──▶ Supabase: histórico, detalle por cuenta,
                             presupuesto, alertas

   (el aplicativo, CP-56)
2. Recálculo       los dos escenarios con las reglas y la parametrización
                   vigentes
3. Publicación     proyeccion_resultado ──▶ v_proyeccion_final
                             │
                             └──▶ el copyjob lo lleva a Fabric y al reporte
```

Los pasos 2 y 3 se registran por separado en `proyeccion_corrida`. **El 3 no corre
si el 2 no terminó**: ante un fallo se conserva lo publicado la vez anterior, que
es correcto aunque esté viejo. Publicar a medias es peor que no publicar, porque el
reporte no distingue una cosa de la otra.

#### Poner la hora detrás de la de Fabric

Como los dos horarios son independientes, el de publicación tiene que quedar **con
margen por detrás** del notebook de Fabric. Dos cosas lo sostienen:

1. **La pantalla muestra a qué hora llegó la última extracción**, así que la hora
   se elige mirando un dato real, no de memoria.
2. **El guardia de datos frescos** (abajo). Es lo que evita que un retraso del
   notebook se convierta en una publicación con los números de ayer.

Si el notebook de Fabric cambia de hora, aquí no hay que tocar nada: a lo sumo la
corrida de ese día se omite y lo dice.

#### La hora de Caracas, en concreto

- **Venezuela es UTC−04:00 y no tiene horario de verano.** No hay cambio de hora
  que ajustar, pero la zona sí hay que guardarla: `America/Caracas`, no un desfase
  fijo de −4 escrito a mano.
- La hora se **guarda y se muestra** en hora local de Caracas. Lo que se almacene
  internamente en UTC es asunto del backend; en pantalla nunca aparece UTC.
- Si el planificador trabaja en UTC —como suelen hacer Fabric y `pg_cron`—, la
  conversión la hace el backend, no el usuario: **06:45 Caracas = 10:45 UTC**.
- Todas las marcas de tiempo de la bitácora van en `timestamptz` y se muestran en
  Caracas.

> Esto ya mordió en este proyecto: un horario de Fabric leído como hora local
> cuando era de Tenerife. La zona tiene que viajar con el dato.

#### Quién lo ejecuta

Un trabajo **del lado del servidor** —`pg_cron`, una función programada de
Supabase o el cron del backend—, nunca el navegador: nadie garantiza que la página
esté abierta a las 6:45.

#### Reglas de la corrida programada

1. **Publica los dos escenarios** (CP-01). Una corrida programada que publique solo
   uno deja el Causado congelado sin que nadie lo note.
2. **Es idempotente** (CP-03): se repite todos los días sobre el mismo mes, así que
   `DELETE`+`INSERT` por `(periodo, escenario)` en una transacción. Sin esto, la
   automatización multiplica las filas en lugar de reemplazarlas.
3. **Corre el checklist antes de publicar** (CP-44). Si falla, **no publica**:
   registra el error y avisa. Nadie está mirando a esa hora, que es justo el motivo
   por el que la validación importa más aquí que en una publicación manual.
4. **No publica con datos viejos.** Antes de calcular, comprueba la extracción del
   mes de trabajo: si no es del día, o su corte no avanzó desde la última
   publicación, la corrida se marca `omitida`, se avisa y **se deja lo que había**.
   Es el guardia que sustituye al control que tendríamos si el aplicativo
   disparara la extracción. Se puede desactivar en la configuración, pero por
   defecto va activo.
5. **Usa las reglas tal como estén guardadas** en ese momento. Si alguien está a
   medias de parametrizar, se publica lo guardado, no el borrador.
6. **No se solapa consigo misma**: si la corrida anterior sigue en curso, la nueva
   se marca `omitida`.

#### Reparto de responsabilidades (decidido)

| | Quién | Cómo se programa |
|---|---|---|
| Extracción Fabric → Supabase | **el notebook de Fabric** | aparte, en Fabric; el aplicativo no la dispara |
| Recálculo de los dos escenarios | **el aplicativo** | CP-56 |
| Publicación de la tabla final | **el aplicativo** | CP-56 |
| Copyjob Supabase → Bronze y refresco del modelo | Fabric | aparte |

Por eso el campo de la interfaz se rotula **«hora de publicación»** y no «hora de
actualización»: el aplicativo no decide cuándo llegan los datos, decide cuándo los
convierte en la tabla final.

#### Para qué sirve, en una línea

Que el reporte de Power BI amanezca con los números del día sin que nadie tenga que
entrar a publicarlos.

### CP-15 · Tabla de alertas

Las calcula la extracción, no el aplicativo, cruzando por `Combinada`
`gld_mayor_mayoreo_agrupado_v2` (Vista GYP, sin cuentas `9.5.*`) contra
`catalogo_gyp_general_v2`. El notebook escribe `proyeccion_alerta` y el aplicativo
la muestra (CP-34).

### CP-42 · Cargar la parametrización de octubre

69 de las 95 reglas cambiaron de método o de porcentaje. Es **carga de datos**, no
código: cargar `prototipo/datos/parametrizacion_2026-10.json` en
`proyeccion_regla`. El criterio está en `07-parametrizacion-oct-2026.md`:

- **Personal de Beval, Febeca y Sillaca** pasa a proporción de la venta: ~70 % del
  gasto comercial son incentivos ligados a la venta, según el portal de personal.
- **12 porcentajes sobre venta** actualizados a lo real de ene–sep 2026 — los
  Alquileres de Beval estaban al 1 % y lo real es 0,137 %.
- **Tributos y Cargo Fijo de Venezuela** siguen como % de la venta, pero se
  calibran solos con los últimos meses.
- **Otros egresos e Ingresos Mercantiles** con mediana de 12 meses: el promedio de
  9 meses de Beval arrastraba un mes atípico de −1,38 millones.
- **Venta, Costo de Ventas y Fletes Recuperados no se tocan:** siguen con la
  fórmula de venta sobre su propio acumulado. Tampoco la Colocación de Prisma.

Métodos resultantes: mediana 29, último mes 14, proporción de la venta 11, % sobre
venta 9, promedio 6; las otras 26 son ventas, costo, fletes, derivadas o quedaron
igual.

La parametrización se aplica **por debajo** de los cambios de usuario: es el punto
de partida compartido, no una capa que los pise.

---

## 7. Bloque Motor

Las fórmulas están en la **Parte II**. Aquí va qué hay que portar.

### CP-16 · Bases por capas del catálogo

La base de un paso puede filtrarse por: **Empresa, Sección, Línea, Detalle,
Concepto, Cuenta, Prefijo de cuenta, Descripción contiene, Centro de costo,
Prefijo de centro, Cuenta + centro y Grupo del P&L**.

- Varios valores de una misma capa **se suman**.
- Capas distintas **se cruzan**.
- Una capa puede **excluir** en vez de incluir.
- Sin el detalle por cuenta cargado, solo se evalúan empresa, grupo y concepto.

En la v1, cuenta y centro de costo aparecían en pantalla pero sumaban 0.

### CP-17 · Origen real con medida elegible

**Origen:** Real (Fabric), Presupuesto u **Otra regla ya calculada**.

**Medida** (solo con origen Real): promedio, mediana o suma de N meses cerrados;
un mes cerrado; el mismo mes del año anterior; el mes en curso al corte; el mes en
curso extrapolado a días hábiles; el acumulado del año cerrado; el acumulado del
año al corte.

En la v1, «Real» era en realidad lo ya calculado por otras reglas; esos pasos se
leen ahora como «Otra regla ya calculada». Es una corrección de nombre, no de
número: **por eso las cifras validadas no cambian.** Conviene migrarlo con ese
texto para no alarmar a control.

### CP-18 · Métodos compuestos y métodos de fábrica

Un método es una secuencia de `pasos`; el primero parte de su base y cada
siguiente opera sobre el resultado del anterior, **sin precedencia ni paréntesis**.
Operaciones: `formula_venta`, `promedio`, `mediana`, `ultimo`, `ratio_venta`,
`porcentaje`, `presupuesto`, `valor_fijo`, `multiplicar`, `sumar`, `restar`,
`componentes`, `derivada`. Opciones técnicas por método: turno, invertir signo y
causado por defecto.

La tabla completa de métodos de fábrica, con turno y valor por defecto, está en
**Parte II §D**. Nuevos respecto a la v1: `m_mediana`, `m_ultimo`, `m_ratio_venta`
y `m_ppto`.

> **Trampa.** El `valor` de la regla solo debe sobrescribir el del paso en métodos
> de **un solo paso**. Si se aplica a todos, los métodos de varios pasos salen
> todos iguales.

### CP-19 · Cuatro modos de causado

La v1 decía que el causado usa los mismos métodos y solo cambia la venta. La v2
define **cómo se causa cada regla**: `igual`, `habiles`, `calendario`, `real`. Las
fórmulas están en **Parte II §E**.

Esto explica el salto de `07 §2`: el Semi Neto causado al 19-oct pasa de −888.523
a 211.168. La v1 comparaba la venta del día 19 contra un mes entero de gastos.

El valor por defecto es `igual`. El causado se ajusta solo según la opción de
estimación elegida (CP-24), y es editable en «Avanzado».

### CP-20 · Destino por capas y reparto

Sin destino, todo va a la Combinada de la regla. Con destino, si entran varias
cuentas el monto se reparte **según su historia** (promedio de N meses), **según su
presupuesto** o **en partes iguales**. Detalles en **Parte II §F**.

### CP-21 · Reglas por cuenta y «el resto»

Una regla de una sola cuenta usa la historia y el acumulado **de esa cuenta**. Su
concepto pasa entonces a calcular sobre el **resto** de sus cuentas: se restan
acumulado y serie, redondeado a céntimos.

Esto **solo funciona si el método del concepto usa su historia** (promedio,
mediana, último, proporción de venta, fórmula de venta). Si no, hay que avisar de
doble conteo (CP-50). Máximo 300 reglas al crear en lote.

Si se migra mal, se duplica gasto en el P&L y nada avisa.

### CP-22 · Reglas adicionales

«+ Otra regla para el concepto» agrega una que **se suma** a la del concepto — un
bono, un gasto puntual. En una regla adicional no se muestran el acierto ni la
recomendación, porque el histórico lo usa la principal; y si tiene nombre, no
aparece el aviso de doble conteo.

### CP-49 · Campo `escenarios`

Cada regla declara a qué escenario aplica: **AMBOS** (por defecto), solo
PROYECCION o solo CAUSADO. En la tabla aparece como etiqueta `solo proyectado` /
`solo causado`.

Es lo que permite que **un solo juego de reglas** sirva para los dos escenarios sin
duplicarlas. Afecta directamente a CP-01: una regla `solo causado` no debe aparecer
con `Proyeccion = 1`.

### CP-51 · Dependencias circulares

Un método cuya base es «otra regla ya calculada» forma un grafo entre conceptos. Un
ciclo deja el cálculo dando vueltas o devolviendo ceros que **se suman al P&L sin
que nadie lo note**. Se detecta **al guardar** —no al calcular— y se bloquea el
guardado, nombrando el ciclo.

---

## 8. Bloque Interfaz

Siete pestañas: **1 Parámetros · 2 Reglas · 3 Resultado · 4 Tabla de salida ·
5 Comparar · 6 Alertas (con contador) · 7 Mis fórmulas**. Los avisos van como
toast de 7 s.

### CP-46 · Cabecera: KPIs siempre visibles y sello de frescura

**Franja de KPIs**, fija y **sin depender de ningún selector**: Ingresos, Renta
Bruta, Gastos Operativos, Ganancia Operativa y Semi Neto, **sumando las seis
empresas**. Arriba el proyectado al cierre, debajo el causado al corte.

**Sello de frescura**, un punto de color:

| Color | Texto | Significa |
|---|---|---|
| verde | `Fabric · <fecha> · datos al <corte>` | datos leídos de la base |
| ámbar | `Foto embebida…` / `Base sin extracción todavía` | usando la copia de respaldo |
| rojo | `Sin extracción de <mes>` / `No se pudo leer la base` | no hay datos del mes |

Más el título con el mes de trabajo («Mes de trabajo: octubre 2026 · datos al
7 oct · N reglas») y el estado de la última extracción.

**Por qué importa:** sin el sello, nadie distingue un número calculado con datos
de hoy de uno calculado con una foto de hace dos semanas. En producción el ámbar
cambia de sentido —ya no hay foto embebida— pero el rojo y el verde siguen igual.

### CP-23 · Proyectado y causado lado a lado

En la cabecera y en la tabla de reglas. Se quita el selector global de escenario;
solo Resultado y Tabla de salida tienen el suyo. Encaja con CP-01.

### CP-24 · Reglas, único lugar de trabajo

La tabla ya no se edita. Cada fila dice en una frase cómo se estima («Lo típico de
6 meses», «0,5 % de la venta») más cómo se causa, y se cambia pulsando la fila.

**El panel de una regla**, en orden:

1. Nombre y detalle opcionales.
2. **¿Cómo quieres estimar el mes?** — tarjetas con cada opción, el número que
   daría y su error (CP-25). Una marcada **recomendada**, la vigente **actual**.
3. Según la opción: cuántos meses mirar (3, 6, 9 o 12, cada uno con su error), el
   % o el monto, o el armador de fórmula.
4. **Así quedaría** — proyectado, causado y Semi Neto de la empresa, con la
   diferencia frente a hoy (CP-26).
5. **Avanzado** — cómo se causa; en qué escenario cuenta; elegir otra fórmula;
   crear fórmula propia; a qué cuentas va y cómo se reparte.
6. Botones: Guardar · Cancelar · **+ Otra regla para el concepto** · Eliminar
   regla · Volver a como estaba.

Las once opciones de estimación, con su método y su causado por defecto, están en
**Parte II §D**.

### CP-25 · Cada opción muestra su número y su error

Junto a cada opción, cuánto daría y cuánto se habría equivocado en los **últimos
6 meses cerrados**, con semáforo: **verde ≤ 10 %, ámbar ≤ 25 %, rojo > 25 %**. El
método de cálculo y las reglas de desempate están en **Parte II §G**.

> Esto obliga a tener los 12 meses cargados en el cliente para recalcular al
> vuelo. Es la razón práctica por la que CP-11 deja de ser opcional.

### CP-26 · El impacto antes de guardar

Proyectado, causado y Semi Neto (proyectado y causado) de la empresa, contra lo
que hay hoy.

### CP-27 · «Avanzado»

Ahí quedan el causado, el escenario, elegir otra fórmula, el destino y eliminar.
En «Ajustes técnicos» del método: signo, turno y causado por defecto. El turno se
deduce de las bases.

### CP-28 · «Mis fórmulas»

Biblioteca de fórmulas propias con su frase «en palabras» y **las reglas que la
usan**; editar, eliminar y «+ Nueva fórmula», que se prueba sobre cualquier regla
antes de guardar mostrando su impacto.

Una fórmula es una **suma de piezas** con signo y %: un monto fijo · un % de la
venta del mes · lo típico de unas cuentas · lo que va del mes llevado al cierre ·
el presupuesto de unas cuentas · un % de lo que calculan otras reglas. «De qué
cuentas»: este concepto, otros conceptos, o las cuentas de un prefijo.

Cuatro plantillas: *Monto fijo + % de la venta*, *Presupuesto ajustado* (+5 %),
*Lo típico + un extra*, *% de otros gastos*.

Un desplegable guarda las **opciones de fábrica y las fórmulas del editor
anterior**; editar una de fábrica **crea una copia** y deja la original para
comparar. Si una fórmula se edita desde una regla y la usan otras, se pregunta si
se cambia en todas.

En el Causado, las piezas de venta y de otras reglas ya vienen al corte, «lo que va
del mes» es lo registrado, y el resto se causa como diga la regla.

### CP-29 · Nombre y detalle por regla

A qué corresponde y quién lo pidió. Se ven en la tabla, bajo el concepto.

### CP-30 · «+ Agregar regla» con tres caminos

- **Agregar una regla** — empresa, concepto, cuenta, nombre y detalle. Arranca en
  monto fijo 0 y se abre para elegir cómo se estima. Se **suma** al concepto.
- **Repartir un monto entre cuentas** — un monto del mes repartido en partes
  iguales, por historia de 6 meses o por presupuesto. Se causa por días del mes.
- **Estimar cada cuenta por separado** — una regla por cuenta (lo típico de 6
  meses, el promedio, igual que el mes pasado o monto fijo; máximo 300).

En los dos últimos las cuentas se eligen en una lista simple con buscador, no con
las capas.

### CP-31 · Eliminar con deshacer

Un solo clic, con «Deshacer» en el aviso. Las eliminadas se listan al pie con
botón **restaurar**. En Supabase, borrado lógico (`eliminada boolean`), nunca
`DELETE`.

### CP-32 · Nombres de Fabric en pantalla

La página muestra los conceptos con el nombre de `Dim_SubClasificacion` pero por
dentro mantiene la clave heredada de las premisas:

| En pantalla | Clave interna |
|---|---|
| Personal | `Personal Fijo` |
| Logístico | `Logistico` |
| Depreciación | `Depreciacion` |
| Colocación | `Colocacion` |

**Conservar esa separación.** Renombrar las claves es la forma más rápida de
romper la parametrización y los 190 casos validados.

### CP-33 · Mes de trabajo

Tarjetas con cada mes disponible, cada una con su estado:

- «mes completo · datos al 31 oct»
- «terminó · datos solo hasta el …» → hay que pedir extracción nueva
- «en curso · datos al 7 oct (6 de 26 días hábiles)»
- «todavía sin datos»

Elegir un mes lo fija **para todos**. De ahí salen el proyectado, el causado, las
reglas, la comparación y la `FECHA` de la tabla de salida. Al cambiar de mes se
limpian el detalle por cuenta, los repartos y el presupuesto del anterior, y los
conceptos sin movimiento quedan en cero. **El factor se guarda por mes.**

En Parámetros va además la tabla de venta por empresa, con días hábiles,
transcurridos, factor y tasa editables, y la venta al corte y proyectada
calculadas. Y **abajo, a primera vista, la actualización programada** (CP-56).

El orden de la pestaña queda: sobre qué mes trabajas · la venta del mes · cuándo se
actualiza solo.

### CP-34 · Pestaña Alertas

Cuentas con movimiento en el mayor que el catálogo GyP no reconoce. **Mientras no
se arreglen, su importe no entra al GyP ni a la proyección.**

Tres tarjetas resumen, una por acción:

| Acción | Cuándo |
|---|---|
| **Crear en el catálogo** | la cuenta no está |
| **Corregir la Combinada** | el centro o las mayúsculas no coinciden |
| **Clasificar** | sin sección, sin subclasificación, o con una que la proyección no usa |

Filtros por empresa, acción y búsqueda. De cada cuenta: la referencia sugerida —la
misma cuenta en otro centro u otra empresa—, el movimiento del mes, el de 12 meses
y el último mes. **No lista las cuentas de balance** (activo, pasivo, patrimonio)
marcadas como GYP. Reglas avisa cuando hay alertas, y la pestaña lleva contador.

### CP-53 · Plantilla del catálogo

Dos salidas:

- **Copiar filas** — las cuentas por crear, sin encabezado, separadas por
  tabulador, para pegar en la fila 2 de la plantilla.
- **Descargar plantilla (.xlsx)** — `Plantilla_Catalogo_GYP_<periodo>.xlsx`,
  generada en el navegador, con las **18 columnas del portal**: Linea, Grupo,
  Cuenta, Descripcion, Saldo Normal, Comercializadora, Balance_GyP, Clasificacion,
  Clasificacion 1, Clasificacion 2, Clasificacion Combinado 1, 2 y 3, Orden
  Clasificacion, Organizacion, Pais, Compania, Centro Costo.

**Linea, Grupo, Saldo Normal, Comercializadora y Orden Clasificacion van vacías**,
igual que en el catálogo del portal. La extracción escribe además
`plantilla_catalogo_<periodo>.xlsx`.

### CP-45 · Pestaña Comparar

Por empresa y concepto: **Proyectado al cierre · Causado al corte · Presupuesto ·
Proy. vs Ppto · Causado / Proy.**

La última columna es la que más se usa: qué proporción del mes ya está causada —a
mitad de mes debería rondar la mitad—. Los conceptos con varias reglas se
despliegan para ver cada una. Al pie, el total de la empresa y «N de M días
hábiles transcurridos · X % del mes».

Esta pestaña no estaba en la lista anterior de cambios y es la que usa control para
detectar un concepto que se va de rango antes del cierre.

### CP-47 · Prueba contable de la Renta Bruta

En Resultado, debajo del P&L, una comprobación de que en las seis empresas:

```
Renta Bruta = Margen + Ingresos Mercantiles + Fletes Recuperados − Merma
```

**Es la identidad que el proyecto entero vigila.** Si no cuadra, el resultado no se
publica. (Ventas no es la suma de sus hijos, y eso es correcto: son dos caminos de
filtro distintos. Lo que debe cuadrar es esta identidad.)

Debajo va también el aviso técnico de los 190 casos (CP-43).

### CP-48 · Reglas: agrupación y etiquetas

Una fila por regla, agrupadas **por empresa y por bloque del P&L**: Venta y margen
· Gastos operativos · Otros, intereses y depreciación · Impuesto. Columnas:
Concepto · Cómo se estima · Proyectado al cierre · Causado al corte · acciones.
Filtro por empresa.

Etiquetas por fila, cada una con su significado:

| Etiqueta | Significa |
|---|---|
| `cuenta` | regla de una sola cuenta |
| `nueva` | creada por un usuario |
| `sin N ctas` | el concepto excluye N cuentas que tienen regla propia |
| `sin detalle` | falta el detalle por cuenta: la regla vale 0 |
| `solo proyectado` / `solo causado` | CP-49 |

### CP-50 · Las ocho validaciones

Bloque «N cosas por revisar» en Reglas:

1. Dos o más reglas que van a la **misma cuenta** sin nombre que lo justifique
   (posible doble conteo).
2. Avisos de reparto: sin historia, sin cuentas que cumplan las capas, detalle no
   cargado.
3. Conceptos con cuentas de regla propia **cuyo método no usa la historia** (doble
   conteo, ver CP-21).
4. Reglas por cuenta **sin detalle por cuenta cargado** (valen 0).
5. Empresas **sin regla de ingreso** → venta proyectada cero.
6. Resultados con **signo contrario a su historia**, fuera del grupo Ventas.
7. Cuentas con movimiento fuera del catálogo → remite a Alertas.
8. Al guardar fórmulas: capas sin valores, piezas sin conceptos o prefijo, fórmula
   sin piezas y **dependencias circulares** (CP-51).

Ninguna bloquea el trabajo salvo la 8; todas se juntan en un aviso plegable.

### CP-35 · «¿Por qué este número?»

Al pulsar cualquier cifra de Reglas, la traza paso a paso para ese escenario:
acumulado, ritmo diario, días normales y días finales con factor; la serie usada;
la proporción sobre la venta; el aporte de cada pieza; la base de cada paso
(cuántas cuentas, conceptos o reglas entran); el ajuste al causado; el resultado en
USD; y a qué cuenta, centro y Combinada va, o el reparto entre cuentas.

### CP-55 · Descargas desde el navegador

Copiar CSV de la tabla de salida, copiar filas de Alertas y generar el .xlsx de la
plantilla. En el artefacto es la capacidad `downloads`; en producción, descargas
normales. El .xlsx se genera **en el navegador**, no en el servidor.

### CP-36 · Ruido retirado

No reintroducir: el selector global «Promedio por defecto», el selector de método
por fila, las alertas de signo cuando el signo coincide con la historia, «Solo las
que cambié» y las marcas «calibrada» y «cambiada». En Parámetros, una sola tabla
—se quitó «Más opciones»—. La columna «vs. validado 7-oct» y el botón «Comprobar el
motor» se quitaron: la prueba corre sola por dentro y solo avisa si falla.

---

## 9. Bloque Persistencia y concurrencia

### CP-37 · Reglas y parametrización compartidas

Lo que cambia una persona lo ven todos. Se comparten las reglas cambiadas, nuevas
y eliminadas, las fórmulas propias, el causado por fórmula, las reglas de partida y
el factor de cada mes. Mapeo a Supabase en §3.

### CP-54 · Suscripción en tiempo real

La página se **suscribe** a todos esos documentos: cualquier cambio —mes, reglas,
extracción nueva, alertas, estado de la solicitud— se aplica solo y se avisa con un
toast («Llegó una extracción nueva… registros hasta el …»). En Supabase es
Realtime sobre esas tablas.

Sin esto, dos personas trabajando el mismo mes se pisan sin enterarse, y CP-38 pasa
de red de seguridad a mecanismo principal.

### CP-38 · Bloqueo optimista

Una versión atrasada llegando tarde deshacía el último cambio —por ejemplo un
eliminar—. Por eso existen `rev` y `wid`: se ignoran el eco propio y las fotos
viejas.

```sql
UPDATE proyeccion_regla SET ..., rev = rev + 1
 WHERE id = $1 AND rev = $2;     -- 0 filas => alguien se adelantó
```

Con 0 filas, recargar y avisar en vez de guardar encima.

### CP-39 · Copiar antes de modificar

Eliminar reglas no funcionaba en los navegadores que ya habían abierto la página:
la base entrega los documentos **congelados**, de solo lectura, y la página los
modificaba directo, así que el cambio fallaba **sin avisar**. Cada lectura se copia
antes de usarla. Si en producción el estado llega inmutable, el mismo cuidado.

### CP-40 · Quién hizo cada cambio

Hoy cada cambio guarda la fecha y la hora (`en`), y el panel la muestra; falta el
usuario. En producción hay autenticación, así que es barato.

### CP-41 · «Volver a las reglas de partida»

Antes «Deshacer mis cambios». Borra cambios, reglas nuevas, fórmulas propias y
factores **para todos**, así que pide confirmación doble.

---

# Parte II · Especificación de referencia del motor

Esto tiene que quedar **idéntico**. Son las reglas que producen los 190 casos
validados por control.

## §A · Agregación del P&L y signo

Montos en **signo crudo**: **ingresos negativos, gastos positivos**. Por empresa:

```
Renta Bruta (rb)         = −Σ grupo VENTAS
Gastos Operativos (go)   =  Σ grupo GOP
Ganancia Operativa (gop) = rb − go
Semi Neto (sn)           = gop − Σ grupo GANOP
Ingresos (ing)           = −venta de la empresa
```

`ing` es la suma de las reglas de Ventas de la empresa, o la derivada en el caso de
Prisma (Colocación).

> **El grupo SEMI (ISLR) se calcula pero NO resta en el Semi Neto.** Se muestra
> aparte. Restarlo es el error más fácil de cometer al reimplementar, y produce un
> Semi Neto plausible pero distinto del oficial.

Bloques del P&L para agrupar en pantalla: Venta y margen · Gastos operativos ·
Otros, intereses y depreciación · Impuesto (ISLR).

## §B · Fórmula de venta (`m_venta`)

```
ritmo       = acumulado ÷ días transcurridos
restantes   = días hábiles del mes − transcurridos

Proyección  = acumulado
            + ritmo × max(restantes − 5, 0)
            + ritmo × factor × min(restantes, 5)

Causado     = acumulado
```

- El **factor** multiplica el ritmo de los **últimos 5 días hábiles** (cierre de
  mes) y es editable por empresa y por mes.
- Si no hay acumulado, usa el promedio histórico.
- `min(restantes, 5)` evita que con menos de 5 días hábiles los días normales
  salgan negativos. **Sin ese tope, el último tramo del mes da resultados
  absurdos.**

Días hábiles: Venezuela trabaja sábados; el resto, lunes a viernes. Los días vienen
de Fabric y solo se cambian a mano si hace falta.

## §C · Turnos de cálculo

| Turno | Cuándo | Métodos típicos |
|---|---|---|
| 1 | primero de todo | fórmula de venta |
| 2 | con la historia y los montos fijos | promedio, mediana, último mes, monto fijo, presupuesto |
| 3 | con la venta proyectada | % sobre venta, proporción de la venta |
| 4 | con los totales por grupo del P&L | derivada (Cargo Fijo), fórmulas sobre otras reglas |
| 5 | al final, con el Semi Neto | % sobre Semi Neto |

Tras cada turno se recalculan los agregados. **Un filtro de solo grupo usa la foto
del turno anterior**, para que el resultado no dependa del orden de las reglas
dentro de un turno. El turno de una fórmula se deduce de sus bases.

> Esta regla de la foto por turno es sutil y se pierde al refactorizar: si la base
> se evalúa en vivo, el resultado cambia según el orden en que se recorran las
> reglas.

## §D · Métodos de fábrica

| Clave | Nombre | Operación | Valor por defecto | Turno | Causado por defecto |
|---|---|---|---|---|---|
| `m_venta` | Fórmula de venta | formula_venta | — | 1 | lo registrado |
| `m_promedio` | Promedio histórico | promedio de N meses con movimiento | — | 2 | por días del mes |
| `m_mediana` | Mediana histórica | mediana de N meses | — | 2 | por días del mes |
| `m_ultimo` | Último mes cerrado | último mes con dato | — | 2 | por días del mes |
| `m_ppto` | Presupuesto del mes | presupuesto | — | 2 | por días del mes |
| `m_fijo` | Monto fijo | valor_fijo | 0 | 2 | por días del mes |
| `m_pct_venta` | % sobre venta | −valor × venta | 1 % | 3 | igual |
| `m_ratio_venta` | Proporción histórica de la venta | (Σ concepto ÷ Σ venta de N meses) × venta del mes | — | 3 | igual (sobre la venta del corte) |
| `m_derivada` | Derivada (Cargo Fijo) | −Σ Cargo Fijo de las demás empresas | — | 4 | sale de otras reglas |
| `m_pct_semineto` | % sobre Semi Neto | valor × Semi Neto | 0,9 % | 5 | igual |

**N por defecto = 9 meses.** `m_mediana`, `m_ultimo`, `m_ratio_venta` y `m_ppto`
se agregaron con la parametrización por backtest de octubre 2026.

`m_pct_semineto` solo aplica al grupo Impuesto; `m_derivada`, solo a la Colocación
de Prisma.

En pantalla estas diez se presentan como once opciones en lenguaje llano: *Lo
típico* (mediana) · *El promedio* · *Igual que el mes pasado* · *Según la venta*
(proporción) · *Un % de la venta* · *Como va el mes* (fórmula de venta) · *Lo
presupuestado* · *Un monto fijo* · *Un % del Semi Neto* · *Del Cargo Fijo del
grupo* · *Armar mi fórmula*.

## §E · Llevar al causado

| Modo | Cálculo |
|---|---|
| `igual` — igual que en Proyección | mismo valor |
| `habiles` — prorrateo por días hábiles | resultado × transcurridos ÷ días hábiles de la empresa |
| `calendario` — prorrateo por días calendario | resultado × día del corte ÷ días del mes |
| `real` — lo real al corte | lo asentado al corte en las cuentas de la regla o de su destino |

**No aplica** a la fórmula de venta —que ya usa el acumulado— ni a la derivada, que
sale de otras reglas.

## §F · Destino y reparto

Sin destino, todo va a la Combinada de la regla. Con destino —capas sobre las
cuentas de la empresa—, si entran varias cuentas el monto se reparte:

- **según su historia** (promedio de N meses),
- **según su presupuesto**,
- o **en partes iguales**.

La suma siempre da el monto de la regla. Dos detalles:

- Se reparte **con el signo dominante**: una cuenta con reversos no se lleva una
  parte negativa.
- Si no hay historia ni presupuesto, se reparte en partes iguales **con aviso**.

## §G · Recomendación y prueba de acierto

Para cada opción se pronostica cada uno de los **últimos 6 meses cerrados** usando
solo la historia anterior a ese mes:

```
error = Σ |pronóstico − real| ÷ Σ |real|          (WAPE)
```

- Lo que depende de la venta se prueba **dos veces** —con la venta real y con una
  venta mal proyectada (promedio de 3 meses)— y se **promedian**. Así una opción no
  gana apoyándose en un acierto de la venta que no vamos a tener.
- La **recomendada** es la de menor error entre lo típico, el promedio, según la
  venta (con 3, 6, 9 y 12 meses) e igual que el mes pasado.
- A **menos de 1 punto** de diferencia se prefiere **lo típico** (la mediana), que
  resiste mejor un mes atípico.
- Si la opción actual acierta casi igual, se recomienda **quedarse**.
- **Excepciones:** Ventas, Costo de Ventas y Fletes Recuperados → «Como va el mes».
  Colocación → derivada.
- **Otros egresos, Ingresos Mercantiles e Intereses:** si la mejor opción se
  equivoca más de ±50 %, se sugiere revisarlos a mano en cada cierre.
- En reglas adicionales de un concepto que ya tiene la suya, **no se muestra
  acierto**.

Semáforo: verde ≤ 10 %, ámbar ≤ 25 %, rojo > 25 %.

## §H · Los dos escenarios

- **PROYECCIÓN** (Proyectado al cierre): la venta se extrapola con §B.
- **CAUSADO** (Causado al corte): la venta es la acumulada real al corte, sin
  proyectar.

Todo lo demás es igual en ambos; **por eso no se duplican reglas**. Cada regla
declara a cuál aplica (`AMBOS` por defecto, CP-49) y el motor corre dos veces,
cambiando la base de venta y aplicando §E a cada método.

---

# Parte III · Verificación y pendientes

## CP-43 · La prueba de 190 casos

Al abrir, la página recalcula los **190 resultados** (95 conceptos × 2 escenarios)
sobre la foto del 7-oct, **con las reglas originales y sin la parametrización ni
los cambios de usuario**, y los compara con los valores validados por control, con
tolerancia **±0,01 USD**. Prueba el motor, no la parametrización.

Si algo se mueve, aparece en Resultado: «Aviso técnico: N de 190 casos de prueba
del motor se movieron», y en consola `[motor] X de 190 casos coinciden`.

**Esa prueba tiene que viajar al aplicativo y correr en el despliegue.** Es lo
único que distingue «el motor sigue bien» de «los números cambiaron y nadie sabe
por qué». Los 190 valores están en el Anexo E de
`Proyeccion_GyP_Mayoreo_documentacion.md`.

Totales de control, con las reglas de partida y la foto del 7-oct:

| | Ingresos | Renta Bruta | Gastos Op. | Gcia. Operativa | Semi Neto |
|---|---:|---:|---:|---:|---:|
| Proyectado al cierre | 18.362.245 | 5.530.385 | 4.691.354 | 839.031 | **1.116.184** |
| Causado al corte | 4.039.387 | 1.365.495 | 4.045.551 | −2.680.056 | **−2.402.903** |

Y con la parametrización de octubre, datos al 19-oct (15 de 26 días hábiles en
Venezuela):

| Semi Neto | Reglas originales | Parametrización oct-2026 |
|---|---|---|
| Proyectado al cierre | 1.188.929 | **486.541** |
| Causado al corte | −888.523 | **211.168** |

Si tras el porte estos números no salen iguales, algo se migró mal.

## CP-44 · Checklist antes de publicar

Que corra solo y se muestre en pantalla:

1. La **prueba contable** de la Renta Bruta cuadra en las seis empresas (CP-47).
2. Los dos escenarios tienen las llaves que les corresponden según CP-49.
3. Toda `Combinada` existe en `dim_cuenta`.
4. `FECHA` = día 1 del periodo, en todas las filas.
5. `Pais` lleno en las seis empresas (CP-52).
6. `Tasa_Mensual` no nula para Cofersa y Mundial, nula para el resto.
7. Ninguna `Combinada` repetida dentro de un mismo escenario.
8. La suma de las reglas por cuenta más el resto cuadra con el concepto (CP-21).
9. El total en USD por empresa es del orden del mes anterior: una variación grande
   se avisa, no se bloquea.

Un fallo aquí no rompe nada visible: el reporte muestra un número distinto del
real, y eso se descubre tarde.

## Lo que no es parte del porte

| Pendiente | Quién decide |
|---|---|
| **Diciembre**: Merma, Incobrables y Gastos Varios de Mundial tienen ajustes de cierre que ningún método de octubre anticipa; hace falta parametrización propia | control |
| **Otros egresos, Ingresos Mercantiles e Intereses de Prisma**: ningún método predice bien; revisión manual cada cierre | control |
| **ISLR de Cofersa** sigue negativo (0,9 % de un Semi Neto negativo); decidir si se acota a cero | control |
| **Conceptos sin regla de partida** — Prisma: Ventas, Costo de Ventas, Fletes Recuperados, Merma, Alquileres, Cargo Fijo, Fletes, Incobrables. Cofersa: Fletes Recuperados. Están en el catálogo y no entran al cálculo salvo que alguien les cree una regla | control |
| **Refresco automático** | pasa a ser trabajo del porte: CP-56 |

## Orden sugerido

| Fase | Cambios | Qué desbloquea |
|---|---|---|
| 1 | CP-01 … CP-07, CP-52 | el Causado deja de cargarse a mano en Power BI; se acaban los duplicados; el local de Cofersa y Mundial y el país quedan bien |
| 2 | CP-11, CP-37, CP-54, CP-42 | datos y parametrización en Supabase: a partir de aquí el aplicativo calcula lo que calcula el prototipo |
| 3 | Parte II completa + CP-16 … CP-22, CP-49, CP-51 | el motor v2 |
| 4 | CP-23 … CP-36, CP-45 … CP-48, CP-50, CP-53, CP-55 | la interfaz |
| 5 | CP-08 … CP-10, CP-12 … CP-15, CP-38 … CP-41 | extracción, concurrencia y operación |
| 6 | **CP-56** | la actualización deja de hacerse a mano |
| 7 | CP-43, CP-44 | verificación permanente |

La fase 1 cambia números que hoy ya se están mirando. De la 2 en adelante es
funcionalidad nueva, y conviene no empezarla hasta tener la 1 publicada y cuadrada.

**CP-56 va al final a propósito.** Automatizar una publicación que todavía duplica
filas o que publica un solo escenario multiplica el problema en vez de resolverlo:
lo hace todos los días y sin nadie mirando. Necesita CP-01, CP-03 y CP-44 ya
funcionando. Si hace falta antes, puede adelantarse con el alcance «solo traer
datos» —sin publicar—, que no toca la tabla final.

## Glosario

| Término | Significado |
|---|---|
| GyP | Ganancias y Pérdidas (P&L) |
| Combinada | llave cuenta contable + centro de costo + empresa |
| Corte | última fecha con registros en la extracción |
| Causado | lo que el mes debería llevar registrado al corte |
| Proyectado | estimación del mes completo al cierre |
| Renta Bruta | margen: −(Ventas + Costo + Ingresos Mercantiles + Fletes Recuperados + Merma) |
| Semi Neto | Ganancia Operativa − (Otros egresos + Intereses + Depreciación) |
| Colocación | ingreso de Prisma, derivado del Cargo Fijo que pagan las demás empresas |
| Factor | multiplicador del ritmo de venta en los últimos 5 días hábiles |
| Detalle por cuenta | cada cuenta del catálogo con sus capas y su serie |
| Regla de partida | regla original validada por control |
| Parametrización | método acordado por regla, compartido, por debajo de los cambios de usuario |

## Contenido confidencial

El paquete trae cifras reales del estado de resultados de las seis empresas, el
catálogo contable completo y la historia mensual. Tratarlo como información
financiera interna. Las credenciales de Supabase van en el backend o en el Key
Vault, nunca en el repositorio, el navegador o los registros.
