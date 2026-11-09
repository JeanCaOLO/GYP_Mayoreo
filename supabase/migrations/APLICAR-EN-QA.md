# Cómo aplicar las migraciones en QA

Orden pensado para que cada paso se pueda comprobar antes del siguiente. Se pega
en el **editor SQL de Supabase** del proyecto de QA.

> **Antes de empezar:** confirmá arriba del editor que el proyecto es el de QA.
> Las tablas se llaman igual en los dos y un `commit` en el equivocado no se
> deshace.

---

## Paso 0 · Los dos secretos del Vault

El job del cron saca de aquí **la clave y la URL**. Sin ellos no funciona, y lo
dice con un error claro en vez de llamar al proyecto equivocado.

```sql
-- La service_role de QA (Project Settings → API).
select vault.create_secret('<SERVICE_ROLE_DE_QA>', 'gyp_cron_key');

-- La URL de ESTE proyecto, no la de productivo.
select vault.create_secret('https://lhswzvjeuegmnonbemza.supabase.co',
                           'gyp_functions_url');
```

Comprobación:

```sql
select name from vault.secrets where name in ('gyp_cron_key','gyp_functions_url');
-- deben salir las dos
```

---

## Paso 1 · `proyeccion_config` — el mes de trabajo (P1)

Archivo: **`20261030130000_mes_de_trabajo.sql`**

Mientras no exista esta tabla, elegir un mes vale solo para esa pantalla y se
pierde al recargar. La aplicación lo dice en vez de prometer que se guardó.

```sql
select * from proyeccion_config;
-- una fila, id = 1, con el periodo más reciente de gyp_historico_mensual
```

---

## Paso 2 · El cron (CP-56)

Archivo: **`20261028120000_cron_corrida_programada.sql`**

Ya lleva la URL del Vault, no escrita a mano. Depende del paso 0.

```sql
select jobname, schedule, active from cron.job
 where jobname = 'corrida-programada-gyp';

-- Tras unos minutos, qué pasó de verdad:
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname='corrida-programada-gyp')
 order by start_time desc limit 5;

select paso, estado, origen, inicio, mensaje
  from proyeccion_corrida order by inicio desc limit 10;
```

**Cómo leerlo:** si no aparece ninguna fila con `origen='programada'`, el cron no
llegó a invocar la función — mirá `net._http_response` para ver el código HTTP.
Si aparecen con estado `omitida`, el mensaje dice qué guarda la detuvo.

---

## Paso 3 · Publicación atómica (D8)

Archivo: **`20261030140000_publicar_dos_escenarios.sql`**

Hoy la Edge Function llama a la RPC una vez por escenario: si falla el segundo,
la tabla final queda con uno nuevo y otro viejo. Esta RPC escribe los dos en una
sola transacción.

```sql
select routine_name from information_schema.routines
 where routine_name = 'publicar_proyeccion_dos_escenarios';
```

---

## Paso 4 · Parametrización de octubre (C12) — **mueve las cifras**

Archivo: **`20261030120000_parametrizacion_oct_2026.sql`**

Este es distinto de los demás: **cambia el P&L a propósito.** Son los 69 ajustes
del documento `07-parametrizacion-oct-2026.md`, transcritos automáticamente y
contrastados contra el resumen que el propio documento declara.

El archivo **termina en `rollback;`** con el `commit;` comentado. Eso es
deliberado: así la primera corrida te enseña los recuentos sin cambiar nada.

**Cómo hacerlo:**

1. Pegalo tal cual y ejecutalo. Mirá los dos `select` del final.
2. Comprobá que los recuentos de método son los del documento:

   | método | esperado |
   |---|---:|
   | `m_mediana` | 29 |
   | `m_ultimo` | 14 |
   | `m_ratio_venta` | 11 |
   | `m_pct_venta` | 9 |
   | `m_promedio` | 6 |

3. Si cuadran, cambiá el final: comentá `rollback;` y descomentá `commit;`.
4. Abrí la aplicación y comprobá el Semi Neto proyectado.

### APLICADO EN QA EL 2026-10-30 — y qué pasó con las cifras

Los recuentos de método **cuadraron exactos**: la migración asigna 29 mediana,
14 último, 11 proporción de la venta, 9 % sobre venta y 6 promedio = 69 cambios,
idéntico a lo que declara el documento. (Ojo: el documento cuenta *cambios*, no
totales finales. Tras aplicar, `m_pct_venta` queda en 20 = 9 cambiadas + 11 que
ya lo eran y no se tocan.)

El **Semi Neto no cuadró**, y el punto de partida tampoco:

| Semi Neto | documento antes | **QA antes** | documento después | **QA después** |
|---|---:|---:|---:|---:|
| Proyectado | 1.188.929 | **514.930** | 486.541 | **733.124** |
| Causado | −888.523 | **330.497** | 211.168 | **626.306** |

La columna «QA antes» se midió restaurando las reglas desde `respaldo_regla_pre_c12`
y recalculando, para poder comparar como corresponde.

**Lectura:** el documento se calculó sobre un conjunto de datos distinto al que
tiene QA hoy. No es que la migración haga algo diferente de lo que dice: lo que
no coincide es la base. Además la dirección difiere — en el documento el
proyectado BAJA y el causado cambia de signo; en QA los dos SUBEN.

**Esto hay que resolverlo con Control antes de pensar en productivo.** La
pregunta no es si la migración está bien transcrita (lo está), sino de qué
extracción salieron las cifras del documento y por qué QA parte de otro número.

Respaldos en QA para volver atrás en cualquier momento:
`respaldo_regla_pre_c12` (estado original) y `respaldo_regla_post_c12` (aplicado).

---

## Después de aplicar todo

En el repositorio hay que regenerar el oráculo, porque las cifras cambiaron a
propósito:

```powershell
npx vitest run src/pages/proyeccion-gyp/engine.test.ts -u
```

**Revisá el diff del snapshot antes de commitearlo.** Que cambie es lo esperado;
*cuánto* cambia es lo que hay que mirar.

---

## Qué NO hace esta guía

No toca productivo. Ninguna de estas migraciones debería aplicarse allí hasta que
QA lleve unos días dando cifras que control reconozca.
