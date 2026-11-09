# Cómo aplicar en PRODUCTIVO (laiiyfjxfvilupiccosf) — 2026-11-09

Merge de los cambios de Eric (QA) con lo que ya corría en productivo. Todo en el
**SQL Editor** del proyecto **laiiyfjxfvilupiccosf**: confirmá arriba que es
productivo. Cada archivo se pega **completo** y se ejecuta una sola vez.

> **NO correr** `20261028120000_cron_corrida_programada.sql` ni
> `PEGAR-EN-QA-pasos-0-a-3.sql`: son de QA y reemplazarían el cron que hoy
> funciona por uno sin bitácora.

| # | Qué | Dónde | ¿Mueve cifras? |
|---|---|---|---|
| 1 | Secreto `gyp_functions_url` | SQL Editor | No |
| 2 | `20261109120000_disparador_url_vault.sql` | SQL Editor | No |
| 3 | `20261030130000_mes_de_trabajo.sql` | SQL Editor | No |
| 4 | `20261030140000_publicar_dos_escenarios.sql` | SQL Editor | No |
| 5 | `20261030150000_clonar_reglas.sql` | SQL Editor | No |
| 6 | Edge Function `publicar-proyeccion` | Dashboard → Edge Functions | No |
| 7 | Edge Function `corrida-programada` (bundle) | Dashboard → Edge Functions | No |
| 8 | Edge Function `refrescar-proyeccion-fabric` | Dashboard → Edge Functions | No |
| 9 | `20261030160000_parametrizacion_oct_2026.sql` | SQL Editor | **Sí** |
| 10 | Frontend (`out/`) | donde se publique la app | — |

## 1 · Secreto de la URL

```sql
select vault.create_secret('https://laiiyfjxfvilupiccosf.supabase.co', 'gyp_functions_url');
```

`gyp_cron_key` ya existe: no se toca.

## 2 a 5 · Migraciones sin cifras

Pegar cada archivo tal cual, en ese orden. El 3 crea `proyeccion_config` con el
mes ya guardado (2026-10), no con el del calendario.

## 6 a 8 · Edge Functions

- `publicar-proyeccion` → pegar `supabase/functions/publicar-proyeccion/index.ts`.
- `corrida-programada` → pegar `supabase/dashboard/corrida-programada.ts` (bundle,
  ya incluye `_shared`). Regenerar con `npm run bundle:corrida` si cambia algo.
- `refrescar-proyeccion-fabric` → pegar `supabase/functions/refrescar-proyeccion-fabric/index.ts`.

Mantener la config que ya tengan (verify_jwt, secretos).

## 9 · Parametrización de octubre (C12) — mueve el P&L

Pegar completo. Guarda respaldo en `respaldo_regla_pre_c12`, aplica las 95
reglas y **verifica el estado final**; si no cuadra, lanza error y no cambia
nada. Lo esperado al final:

| método | total |
|---|---:|
| m_mediana | 29 |
| m_pct_venta | 20 |
| m_ultimo | 14 |
| m_venta | 13 |
| m_ratio_venta | 11 |
| m_promedio | 6 |
| m_derivada / m_pct_semineto | 1 / 1 |

Productivo ya tenía reglas editadas: los «29/14/11/9/6 cambios» del documento
no aplican aquí, pero el estado final es el mismo del documento. La query para
volver atrás está en el encabezado del archivo.

## Comprobaciones (las hace Claude con la anon key)

- `proyeccion_config` → una fila, `periodo_trabajo = 2026-10`.
- `proyeccion_tick` → ticks nuevos sin «Falta el secreto…».
- `/rest/v1/` lista `rpc/publicar_proyeccion_dos_escenarios` y `rpc/clonar_reglas`.
- `proyeccion_regla?periodo=eq.2026-10` → totales de la tabla del paso 9.
