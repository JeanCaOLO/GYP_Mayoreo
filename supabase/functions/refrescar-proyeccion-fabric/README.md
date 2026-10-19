# refrescar-proyeccion-fabric (opción A)

El aplicativo consulta Fabric **directamente** y escribe en Supabase. El frontend
llama a esta Edge Function por HTTPS; la credencial de Fabric vive en el servidor,
nunca en el navegador (documento 07 §2).

```
Frontend "Actualizar"
  │ supabase.functions.invoke('refrescar-proyeccion-fabric')
  ▼
Edge Function  ──TDS/1433 + token Entra ID──►  Fabric (Gold / Silver)
  │  5 consultas + corte + guardas (doc 07)
  ▼
Supabase: gyp_historico_mensual + proyeccion_parametro
  │
  ▼
Frontend recarga  →  sello verde "Fabric · …"
```

## Requisitos previos (no se pueden rodear desde el código)

1. **El admin del tenant debe permitir que los service principals usen las APIs
   de Fabric** (documento 07 §2). Sin esto, el token autentica pero las consultas
   fallan o la conexión se rechaza.
2. **Un service principal de Entra ID** con acceso **solo lectura** al workspace
   de Fabric. Necesitas: tenant id, client id, client secret.
3. **Salida TCP 1433 permitida.** Las Edge Functions de Supabase corren en Deno
   Deploy; la conexión saliente a `...datawarehouse.fabric.microsoft.com:1433`
   debe estar permitida por el firewall de Fabric (Service Tags de Power BI/SQL).

## Secretos (nunca en el repositorio)

```bash
supabase secrets set FABRIC_SERVER="5ndpf2bedd7uncw5vciq7nfneu-czovmwnh2ilermdvyuq7wxb76a.datawarehouse.fabric.microsoft.com"
supabase secrets set FABRIC_TENANT_ID="<tenant-id>"
supabase secrets set FABRIC_CLIENT_ID="<app-id del service principal>"
supabase secrets set FABRIC_CLIENT_SECRET="<secret>"
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase automáticamente.

## Desplegar

```bash
supabase functions deploy refrescar-proyeccion-fabric
```

## Probar

```bash
curl -i -X POST \
  "https://<proyecto>.supabase.co/functions/v1/refrescar-proyeccion-fabric" \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"periodo":"2026-10"}'
```

Respuestas:
- `200 {ok:true, escrito:true, corte, conceptos, log}` → escribió en Supabase.
- `409 {ok:false, escrito:false, errores}` → una guarda frenó la escritura
  (p. ej. el corte no avanzó). No es un fallo: conserva los datos buenos (07 §7).
- `500 {ok:false, error}` → error de conexión/consulta. Revisa `log`.

Desde la app: botón **Actualizar** en la página de Proyección. Llama a la función
y luego recarga; el sello pasa a verde si quedó todo.

## Qué hace y qué NO hace

Hace: las 5 consultas del documento 07 (acumulado, serie, corte contra Silver,
días hábiles con DISTINCT, tasa), aplica las guardas §7 y escribe historia y
parámetros. No pisa el `factor_correccion` que fija control.

No hace: no calcula la proyección ni escribe `proyeccion_resultado` /
`v_proyeccion_final`. Eso sigue siendo el botón **Publicar a la base** del
aplicativo.

## Ajustes probables en la primera corrida

- **Nombres de tabla.** Las consultas usan `Gold.dbo.gld_mayor_mayoreo_agrupado_v2`,
  `Gold.dbo.catalogo_gyp_general_v2`, `Gold.SIM.rolling` y
  `Silver.dbo.slv_mayor_mayoreo_consolidado_v2`. Si tu endpoint los expone con
  otra base/esquema, ajústalos en `index.ts`.
- **Autenticación del driver.** Usa `mssql@11` con
  `authentication: { type: "azure-active-directory-access-token" }`. Si la
  versión del driver en el runtime no soporta ese tipo, revisa la nota de abajo.

> NOTA: no fue posible probar la conexión TDS real a Fabric desde el entorno de
> desarrollo. El código sigue el patrón documentado de `mssql` con token de
> Entra ID, pero la primera corrida puede requerir ajuste de versión del driver
> o del tipo de autenticación. El `log` de la respuesta ayuda a diagnosticar.
