# Implementation Plan: Proyección GyP Producción

## Overview

Reescritura completa del módulo de Proyección GyP en producción, organizada por las siete fases del orden de ejecución obligatorio del diseño: primero la base de datos, luego el motor, los datos, la interfaz, la extracción/operación, la programación y la verificación. El motor es un refactor con oráculo: la prueba de 190 casos (CP-43, Property 15) actúa como compuerta de calidad al cierre de cada fase y ninguna fase avanza si rompe cualquiera de los 190 casos.

La Fase 1 es CRÍTICA y de máxima prioridad (migración de base de datos + capa de salida con los dos escenarios, idempotencia y contrato de 13 columnas); sus tareas van sin marca opcional. Las fases 2-7 conservan el orden de dependencias; sus sub-tareas de prueba van marcadas con `*` (opcionales) según el patrón del workflow, mientras que la implementación de cada fase es requerida.

Archivos a **reescribir**: `schema.sql`, `engine.ts`, `data.ts`, `page.tsx`, `seed.ts`, `series.ts`, `fabric/refrescar_proyeccion_fabric.py`. Archivos **nuevos**: `salida.ts`, `capas.ts`, `causado.ts`, `destino.ts`, `wape.ts`, `checklist.ts`, `engine.test.ts`, `components/*.tsx`, dos Edge Functions (`publicar-proyeccion`, `corrida-programada`) y la migración versionada.

## Tasks

### Fase 1 — Bloque Salida (CRÍTICA)

- [x] 1. Migración de base de datos (§4) — primer paso, sin dependencias
  - [x] 1.1 Reescribir `src/pages/proyeccion-gyp/schema.sql` como migración idempotente del §4
    - `ALTER TABLE proyeccion_resultado ADD COLUMN IF NOT EXISTS escenario smallint NOT NULL DEFAULT 1`
    - `CREATE UNIQUE INDEX IF NOT EXISTS ux_proy_resultado ON proyeccion_resultado (periodo, escenario, combinada)`
    - 14 columnas nuevas de `proyeccion_regla` con `ADD COLUMN IF NOT EXISTS` y defaults (`causado='igual'`, `escenarios='AMBOS'`, `nivel='concepto'`, `eliminada=false`, `rev=0`)
    - Tablas nuevas `proyeccion_formula`, `gyp_historico_cuenta`, `dim_cuenta`, `proyeccion_alerta`, `proyeccion_programacion` (fila única id=1), `proyeccion_corrida` con índice `ix_corrida (periodo, inicio DESC)`, tipos exactos del §4
    - Todo en una transacción; `IF NOT EXISTS` para preservar datos existentes
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 Crear el espejo versionado `supabase/migrations/NNNN_proyeccion_produccion.sql`
    - Copia versionada de `schema.sql` para despliegue reproducible en Supabase
    - _Requirements: 1.5_

  - [ ]* 1.3 Smoke test de la migración aplicada
    - Verificar que las columnas e índices quedan presentes tras aplicar la migración
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Capa de salida pura — `src/pages/proyeccion-gyp/salida.ts` (nuevo)
  - [x] 2.1 Implementar el contrato de las 13 columnas y las transformaciones CP-04/05/52
    - `aFilaFinal(regla, destino)`: `FECHA` = día 1 del periodo; `Vista='GYP'`; `Ajuste=0`; `Ajuste_USD=0`
    - `Pais` desde el mapa propio (Venezuela: Beval/Febeca/Sillaca/Prisma; Costa Rica: Cofersa; Colombia: Mundial)
    - `Tasa_Mensual` solo Cofersa/Mundial, NULL para venezolanas; `Monto_Local = Monto_USD × tasa`
    - Emitir las 13 columnas en orden exacto `FECHA;Ajuste;Vista;Combinada;Pais;Empresa;Tasa_Mensual;Ajuste_USD;Monto_Local;Monto_USD;CENTRO_COSTO;CUENTA_CONTABLE;Proyeccion` con separador `;`
    - Una fila por cuenta de destino (regla repartida → varias filas)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7, 4.8_

  - [x] 2.2 Implementar fusión por Combinada y validación contra catálogo
    - `fusionarPorCombinada(filas)`: suma `Monto_USD` de reglas que resuelven a la misma Combinada dentro de un escenario, una sola fila por Combinada
    - `validarContraCatalogo(filas, dimCuenta)`: devuelve llaves huérfanas; la publicación se detiene y las reporta
    - _Requirements: 4.5, 4.6_

  - [ ]* 2.3 Property test del contrato de la tabla final
    - **Feature: proyeccion-gyp-produccion, Property 11: El contrato de la tabla final se cumple en toda fila**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.7**

  - [ ]* 2.4 Property test de la fusión por Combinada
    - **Feature: proyeccion-gyp-produccion, Property 10: La fusión por Combinada elimina duplicados sumando**
    - **Validates: Requirements 4.5, 4.8**

  - [ ]* 2.5 Property test de la señalización de llaves huérfanas
    - **Feature: proyeccion-gyp-produccion, Property 12: Toda Combinada huérfana se señala antes de publicar**
    - **Validates: Requirements 4.6, 29.1**

- [x] 3. Edge Function de publicación — `supabase/functions/publicar-proyeccion/index.ts` (nuevo)
  - [x] 3.1 Implementar la publicación idempotente transaccional de los dos escenarios
    - Recorrer `['PROYECCION','CAUSADO']`; filtrar reglas por su campo `escenarios` (AMBOS/PROYECCION/CAUSADO)
    - `Proyeccion = 1` para proyectado al cierre, `Proyeccion = 2` para causado al corte
    - Por escenario: `DELETE FROM proyeccion_resultado WHERE periodo=$1 AND escenario=$2` + `INSERT`, en una única transacción (`createClient` de servicio; credenciales fuera del navegador, R-NN-5)
    - Deduplicar por `(periodo, escenario, combinada)`; republicar reemplaza en vez de acumular
    - Invocar `salida.ts` (fusión y validación de catálogo) antes del insert
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3_

  - [x] 3.2 Actualizar `v_proyeccion_final` para el append de los dos escenarios
    - La vista que lee Power BI expone ambos escenarios en append (`Proyeccion = 1 | 2`)
    - _Requirements: 2.1_

  - [ ]* 3.3 Property test de idempotencia de la publicación
    - **Feature: proyeccion-gyp-produccion, Property 8: La publicación es idempotente por escenario**
    - **Validates: Requirements 3.1, 3.2, 3.3, 27.4**

  - [ ]* 3.4 Property test de reglas por escenario
    - **Feature: proyeccion-gyp-produccion, Property 9: Cada escenario lleva solo las reglas que le corresponden**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

- [x] 4. Compuerta Fase 1 — Verificar que los 190 casos siguen igual
  - Ejecutar la prueba de 190 casos (CP-43) tras la migración y la capa de salida; ninguna fase avanza si se mueve algún caso. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 28.3_

### Fase 2 — Bloque Motor v2 (Parte II completa)

- [x] 5. Motor v2 — reescritura de `src/pages/proyeccion-gyp/engine.ts`
  - [x] 5.1 Implementar el modelo de pasos compuestos y las nuevas operaciones (CP-18, §D)
    - `MetodoV2` como secuencia de `pasos` (fold izquierda a derecha, sin precedencia ni paréntesis)
    - Operaciones `formula_venta`, `promedio`, `mediana`, `ultimo`, `ratio_venta`, `porcentaje`, `presupuesto`, `valor_fijo`, `multiplicar`, `sumar`, `restar`, `componentes`, `derivada`
    - Trampa CP-18: `regla.valor` sobrescribe el paso solo en métodos de un único paso
    - Reglas de partida expresadas como métodos de un paso equivalentes a las 8 operaciones v1 (aritmética idéntica al céntimo)
    - _Requirements: 11.1, 11.2, 11.5, 10.1, 10.2, 10.3_

  - [x] 5.2 Implementar la fórmula de venta y los turnos de cálculo (§B, §C)
    - `m_venta`: `acumulado + ritmo × max(restantes−5,0) + ritmo × factor × min(restantes,5)`, `ritmo = acumulado ÷ transcurridos`, `restantes = días hábiles − transcurridos`; causado = acumulado; sin acumulado → promedio histórico
    - Días hábiles: Venezuela trabaja sábados; el resto lunes a viernes
    - Turnos 1..5 con `recalcular()` tras cada pasada; foto del turno anterior congelada para filtros de solo grupo (confluencia)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 5.3 Implementar los dos escenarios y la detección de ciclos (§H, CP-49, CP-51)
    - Motor corre dos veces cambiando la base de venta (extrapolada en Proyectado, acumulada al corte en Causado), aplicando §E a cada método
    - Cada regla declara `escenarios` AMBOS/PROYECCION/CAUSADO
    - Detección de ciclos al guardar (no al calcular): grafo concepto→concepto por bases `otra_regla`, DFS con back-edge, bloquea y nombra el ciclo
    - _Requirements: 16.1, 16.2, 16.3_

  - [ ]* 5.4 Property test de la fórmula de venta
    - **Feature: proyeccion-gyp-produccion, Property 1: La fórmula de venta es exacta**
    - **Validates: Requirements 12.1, 12.2, 16.1**

  - [ ]* 5.5 Property test de confluencia por turnos
    - **Feature: proyeccion-gyp-produccion, Property 3: El cálculo es confluente dentro de un turno (foto por turno)**
    - **Validates: Requirements 12.4, 12.5**

  - [ ]* 5.6 Property test de sobrescritura de valor en métodos de un paso
    - **Feature: proyeccion-gyp-produccion, Property 4: El valor de la regla solo sobrescribe métodos de un paso**
    - **Validates: Requirements 11.1, 11.5**

  - [ ]* 5.7 Property test de detección de ciclos
    - **Feature: proyeccion-gyp-produccion, Property 13: Los ciclos de dependencia se bloquean al guardar**
    - **Validates: Requirements 16.3, 23.2**

- [x] 6. Bases por capas del catálogo — `src/pages/proyeccion-gyp/capas.ts` (nuevo)
  - [x] 6.1 Implementar la resolución de bases por capas y el origen con medida (CP-16, CP-17)
    - Capas: Empresa, Sección, Línea, Detalle, Concepto, Cuenta, Prefijo de cuenta, Descripción contiene, Centro de costo, Prefijo de centro, Cuenta+centro, Grupo del P&L
    - Varios valores de una capa → unión (suma); capas distintas → intersección (cruce); capa `excluir` → resta
    - Orígenes Real/Presupuesto/Otra regla; medidas Real del CP-17; migrar pasos v1 "Real" que leían otras reglas a `origen:'otra_regla'` sin cambiar cifras
    - Sin `gyp_historico_cuenta` cargado, limitar bases a empresa, grupo y concepto
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3, 5.3_

  - [ ]* 6.2 Property test del álgebra de conjuntos de las capas
    - **Feature: proyeccion-gyp-produccion, Property 5: Las bases por capas cumplen el álgebra de conjuntos**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

- [x] 7. Modos de causado — `src/pages/proyeccion-gyp/causado.ts` (nuevo)
  - [x] 7.1 Implementar los cuatro modos de causado (§E, CP-19)
    - `igual` = mismo valor; `habiles` = resultado × transcurridos ÷ días hábiles; `calendario` = resultado × día del corte ÷ días del mes; `real` = lo asentado al corte en las cuentas de la regla o su destino
    - Default `igual`; no aplica a fórmula de venta ni a la derivada
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ]* 7.2 Property test de los modos de causado
    - **Feature: proyeccion-gyp-produccion, Property 2: Los modos de causado cumplen el §E**
    - **Validates: Requirements 13.1, 13.2, 13.3**

- [x] 8. Destino y reparto — `src/pages/proyeccion-gyp/destino.ts` (nuevo)
  - [x] 8.1 Implementar el reparto entre cuentas de destino (§F, CP-20)
    - Sin destino → todo a la Combinada de la regla
    - Con varias cuentas: reparto por historia (promedio N), por presupuesto o partes iguales; la suma del reparto da el monto de la regla
    - Reparto con signo dominante (sin parte negativa a cuenta con reversos); sin historia ni presupuesto → partes iguales con aviso
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 8.2 Implementar reglas por cuenta y "el resto" (CP-21)
    - Regla de nivel `cuenta` usa historia y acumulado de esa cuenta; concepto sobre el resto restando acumulado y serie redondeado a céntimos
    - Aviso de doble conteo si el método del concepto no usa su historia; máximo 300 reglas en lote; regla adicional se suma al concepto
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ]* 8.3 Property test de conservación del reparto
    - **Feature: proyeccion-gyp-produccion, Property 6: El reparto conserva el monto con signo dominante**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4**

  - [ ]* 8.4 Property test de regla por cuenta más el resto
    - **Feature: proyeccion-gyp-produccion, Property 7: Regla por cuenta más el resto cuadra con el concepto**
    - **Validates: Requirements 15.1, 29.1**

- [x] 9. Métodos de fábrica y semilla — reescritura de `src/pages/proyeccion-gyp/seed.ts` y `series.ts`
  - [x] 9.1 Implementar los métodos de fábrica del §D
    - `m_venta`, `m_promedio`, `m_mediana`, `m_ultimo`, `m_ppto`, `m_fijo`, `m_pct_venta`, `m_ratio_venta`, `m_derivada`, `m_pct_semineto` con operación, valor por defecto, turno y causado del §D; N por defecto = 9
    - `m_pct_semineto` solo al grupo Impuesto; `m_derivada` solo a la Colocación de Prisma
    - Reescribir `series.ts` dejando la foto del 7-oct solo como fallback embebido de la Suite_Verificacion
    - _Requirements: 11.3, 11.4_

- [x] 10. Oráculo de 190 casos — `src/pages/proyeccion-gyp/engine.test.ts` (nuevo)
  - [x] 10.1 Implementar la suite de 190 casos como oráculo del motor
    - Recalcular los 190 resultados (95 conceptos × 2 escenarios) sobre la foto del 7-oct con reglas de partida, sin parametrización ni cambios de usuario, comparar con `CIFRAS_VALIDADAS` a ±0,01 USD
    - Correr antes y después de cada cambio del motor (refactor con oráculo)
    - _Requirements: 28.1, 28.3_

- [x] 11. Compuerta Fase 2 — Ensure all tests pass, ask the user if questions arise.
  - El motor v2 debe pasar los 190 casos antes de avanzar a la Fase 3.
  - _Requirements: 28.3_

### Fase 3 — Datos y parametrización en Supabase

- [x] 12. Capa de datos — reescritura de `src/pages/proyeccion-gyp/data.ts`
  - [x] 12.1 Implementar la lectura nueva (detalle por cuenta, catálogo, alertas, presupuesto, tasas)
    - Leer `gyp_historico_cuenta` (capas, acumulado, presupuesto, 12 meses), `dim_cuenta`, `proyeccion_alerta`, presupuesto del periodo y tabla de tasas
    - Cuadre automático del detalle por cuenta contra el resumen del periodo
    - _Requirements: 5.1, 5.2_

  - [x] 12.2 Implementar concurrencia, autor, borrado lógico y realtime
    - Bloqueo optimista CP-38: `UPDATE ... rev = rev + 1 WHERE id=$1 AND rev=$2`; 0 filas → recargar y avisar; `wid` ignora el eco propio
    - Copiar antes de modificar datos inmutables (CP-39); grabar `actualizado_por` + `actualizado` (CP-40)
    - Borrado lógico `eliminada` sin `DELETE` (CP-31); "Volver a las reglas de partida" con confirmación doble (CP-41)
    - Realtime CP-54: suscripción a mes, reglas, extracción, alertas y estado de solicitud; cada cambio se aplica y dispara toast
    - _Requirements: 7.1, 7.2, 26.1, 26.2, 26.3, 26.4_

  - [x] 12.3 Implementar la persistencia compartida en Supabase (CP-37)
    - Guardar reglas cambiadas/nuevas/eliminadas, fórmulas propias, causado por fórmula, reglas de partida y factor por mes según el mapeo del §3
    - Un cambio guardado se hace visible a las demás personas del mismo mes
    - Delegar la publicación transaccional a la Edge Function `publicar-proyeccion`
    - _Requirements: 6.1, 6.2_

  - [ ]* 12.4 Property test del bloqueo optimista
    - **Feature: proyeccion-gyp-produccion, Property 16: El bloqueo optimista no pisa cambios concurrentes**
    - **Validates: Requirements 26.1**

  - [ ]* 12.5 Integration test de persistencia compartida y realtime
    - Escenarios 1-3 personas: guardar propaga y el eco propio se ignora
    - _Requirements: 6.2, 7.2, 26.1_

- [x] 13. Parametrización de octubre
  - [x] 13.1 Implementar la carga de la parametrización de octubre (CP-42)
    - Cargar `prototipo/datos/parametrizacion_2026-10.json` en `proyeccion_regla` según `07-parametrizacion-oct-2026.md`
    - Aplicar por debajo de los cambios de usuario, sin pisarlos
    - Conservar Venta, Costo de Ventas, Fletes Recuperados y la Colocación de Prisma con su fórmula de venta sobre su propio acumulado
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 13.2 Unit test del mapeo de parametrización de octubre
    - Verificar que las reglas protegidas no se modifican y que el resto aplica por debajo del usuario
    - _Requirements: 8.2, 8.3_

- [x] 14. Compuerta Fase 3 — Ensure all tests pass, ask the user if questions arise.
  - La capa de datos debe pasar los 190 casos antes de avanzar a la Fase 4.
  - _Requirements: 28.3_

### Fase 4 — Bloque Interfaz (7 pestañas)

- [x] 15. Recomendación / backtest — `src/pages/proyeccion-gyp/wape.ts` (nuevo)
  - [x] 15.1 Implementar el backtest WAPE del §G
    - Pronosticar los últimos 6 meses cerrados con solo la historia anterior: `error = Σ|pronóstico − real| ÷ Σ|real|`
    - Lo que depende de la venta se prueba dos veces (venta real y venta mal proyectada = promedio 3 meses) y se promedia
    - Recomendada = menor error; a <1 punto se prefiere la mediana; semáforo verde ≤10 %, ámbar ≤25 %, rojo >25 %
    - _Requirements: 18.3_

  - [ ]* 15.2 Unit test de casos borde del backtest §G
    - Series cortas, reales en cero y empates por <1 punto hacia la mediana
    - _Requirements: 18.3_

- [x] 16. Interfaz de 7 pestañas — reescritura de `src/pages/proyeccion-gyp/page.tsx` y componentes nuevos
  - [x] 16.1 Implementar la estructura de 7 pestañas, cabecera de KPIs y sello de frescura
    - Pestañas 1 Parámetros · 2 Reglas · 3 Resultado · 4 Tabla de salida · 5 Comparar · 6 Alertas (contador) · 7 Mis fórmulas; avisos como toast de 7 s
    - Franja de KPIs fija e independiente de selectores (Ingresos, Renta Bruta, Gastos Op., Ganancia Op., Semi Neto de las Six_Empresas, proyectado arriba / causado debajo)
    - Sello de frescura de tres estados (verde Fabric·fecha·corte; ámbar respaldo; rojo sin datos); omitir el ruido retirado de CP-36
    - Crear componentes en `src/pages/proyeccion-gyp/components/`
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [x] 16.2 Implementar la pestaña Reglas con panel de estimación, "Así quedaría" y validaciones
    - Proyectado y causado lado a lado sin selector global; panel por regla con tarjetas de estimación (número y error WAPE), parámetros, "Así quedaría" (diferencia frente a hoy), bloque Avanzado (causado, escenario, otra fórmula, fórmula propia, destino/reparto) y botones
    - Semáforo WAPE de 6 meses (verde ≤10 %, ámbar ≤25 %, rojo >25 %); "+ Agregar regla" con tres caminos; "Deshacer"/restaurar con borrado lógico
    - Agrupar por empresa y bloque del P&L con etiquetas de fila (`cuenta`, `nueva`, `sin N ctas`, `sin detalle`, `solo proyectado`, `solo causado`)
    - Bloque plegable "N cosas por revisar" con las 8 validaciones de CP-50; solo la octava (errores al guardar, incl. ciclos CP-51) bloquea
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 23.1, 23.2_

  - [x] 16.3 Implementar la pestaña Mis fórmulas
    - Listar fórmulas propias con su frase "en palabras" y las reglas que las usan; editar/eliminar/"+ Nueva fórmula"
    - Componer por piezas (suma con signo y %); probar sobre cualquier regla antes de guardar
    - Editar de fábrica crea copia; editar una usada por otras pregunta si se cambia en todas
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [x] 16.4 Implementar la pestaña Parámetros y mes de trabajo
    - Tarjetas por mes con estado; al elegir mes se fija para todos y se limpia detalle/repartos/presupuesto del mes anterior (conceptos sin movimiento en cero)
    - Factor guardado por mes; tabla de venta por empresa (días hábiles, transcurridos, factor, tasa editables; venta al corte y proyectada calculadas) en orden mes → venta → programación
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [x] 16.5 Implementar la pestaña Alertas y la plantilla del catálogo
    - Tres tarjetas resumen por acción (crear/corregir/clasificar), filtros por empresa/acción/búsqueda, referencia sugerida y movimientos (mes, 12 meses, último mes)
    - No listar cuentas de balance marcadas GYP; contador en la pestaña y aviso desde Reglas
    - Plantilla: copiar filas (sin encabezado, tabulador) y descargar `Plantilla_Catalogo_GYP_<periodo>.xlsx` en el navegador con las 18 columnas (Linea, Grupo, Saldo Normal, Comercializadora y Orden Clasificacion vacías)
    - _Requirements: 21.1, 21.2, 21.3_

  - [x] 16.6 Implementar las pestañas Resultado, Comparar y Tabla de salida con la prueba contable
    - Comparar por empresa/concepto (Proyectado, Causado, Presupuesto, Proy. vs Ppto, Causado/Proy., conceptos desplegables, total al pie)
    - Resultado con P&L + prueba contable `Renta Bruta = Margen + Ingresos Mercantiles + Fletes Recuperados − Merma` para las Six_Empresas; si no cuadra, no se publica
    - Copiar CSV de la tabla de salida, copiar filas de Alertas y generar `.xlsx` en el navegador; traza "¿Por qué este número?" paso a paso por escenario
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5_

  - [ ]* 16.7 Property test de la prueba contable de la Renta Bruta
    - **Feature: proyeccion-gyp-produccion, Property 14: La prueba contable de la Renta Bruta gobierna la publicación**
    - **Validates: Requirements 22.2, 22.3, 29.1**

  - [ ]* 16.8 Unit test de la estructura de pestañas y etiquetas de fila
    - 7 pestañas, KPIs fijos, estados del sello de frescura y etiquetas de fila
    - _Requirements: 17.1, 17.2, 17.3, 18.6_

- [x] 17. Compuerta Fase 4 — Ensure all tests pass, ask the user if questions arise.
  - La interfaz debe pasar los 190 casos antes de avanzar a la Fase 5.
  - _Requirements: 28.3_

### Fase 5 — Datos, extracción, concurrencia y operación

- [x] 18. Notebook de extracción — reescritura de `fabric/refrescar_proyeccion_fabric.py`
  - [x] 18.1 Implementar la suma corregida, serie de 12 meses y presupuesto (CP-08, CP-09, CP-10)
    - Suma corregida `COALESCE(Monto_USD,0) + COALESCE(Ajuste_USD,0)`, filtra `Vista='GYP'`, excluye `9.5.*`; comprobar corregido == validado con datos de octubre
    - Serie siempre de los 12 meses anteriores; `presupuesto_gyp_v2` viaja con la extracción
    - _Requirements: 24.1, 24.2, 24.3, 24.4_

  - [x] 18.2 Implementar el detalle por cuenta, dos meses, mes terminado y alertas (CP-11, CP-12, CP-13, CP-15)
    - Escribir `gyp_historico_cuenta` y `dim_cuenta` (capas, acumulado, presupuesto, 12 meses) con cuadre contra el resumen
    - Sin argumentos saca mes en curso + anterior; `--meses N`, `--periodo`; corte al último día si los registros llegan al último día hábil
    - Cruzar el mayor (Vista GYP, sin `9.5.*`) contra el catálogo y escribir `proyeccion_alerta`; no listar cuentas de balance
    - _Requirements: 5.1, 24.3, 25.1, 25.2, 25.7_

  - [x] 18.3 Implementar los botones manuales y el registro de corridas (CP-14)
    - "Actualizar" relee de Supabase la última extracción publicada por Fabric sin ejecutar nada más
    - "Publicar la tabla final ahora" recalcula los dos escenarios y escribe `proyeccion_resultado`
    - Cada pulsación registra una fila `proyeccion_corrida` con `origen='manual'`, quién la lanzó y su estado; el aplicativo no dispara la extracción de Fabric
    - _Requirements: 25.3, 25.4, 25.5, 25.6_

  - [ ]* 18.4 Property test de la suma corregida
    - **Feature: proyeccion-gyp-produccion, Property 17: La suma corregida no pierde filas y coincide con la validada**
    - **Validates: Requirements 24.1, 24.2**

- [x] 19. Compuerta Fase 5 — Ensure all tests pass, ask the user if questions arise.
  - La extracción y la concurrencia deben pasar los 190 casos antes de avanzar a la Fase 6.
  - _Requirements: 28.3_

### Fase 6 — Actualización programada

- [x] 20. Corrida programada — `supabase/functions/corrida-programada/index.ts` (nuevo) + pg_cron
  - [x] 20.1 Implementar la Edge Function de corrida programada con guardias y hora de Caracas (CP-56)
    - Disparada por `pg_cron` a `hora_local` convertida a UTC en el backend; zona `America/Caracas` viaja con el dato; pantalla nunca muestra UTC
    - No solapar consigo misma (corrida en_curso → `omitida`); guardia de datos frescos (datos viejos y `exige_datos_frescos` → `omitida`, conserva lo publicado)
    - Paso `calculo` (recálculo 2 escenarios) y paso `publicacion` separados en `proyeccion_corrida`; publicación no corre si el recálculo no terminó
    - Publicación idempotente `DELETE`+`INSERT` por `(periodo, escenario)` en transacción usando reglas tal como estén guardadas; checklist CP-44 bloqueante → no publica, registra error y avisa
    - Configurar el job de `pg_cron` que invoca la función
    - _Requirements: 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.8_

  - [x] 20.2 Implementar la UI de programación en Parámetros (CP-56)
    - Configuración abajo y a primera vista: estado (activa/pausada), frecuencia (diaria/hábiles/semanal con día), hora de publicación en hora de Caracas, mes (vigente por defecto o fijo) y "no publicar con datos viejos" (sí por defecto)
    - Lectura en pantalla: datos de Fabric (última extracción y corte) y publicación (última y próxima, en claro, hora de Caracas)
    - _Requirements: 27.1, 27.9_

  - [ ]* 20.3 Integration test de la corrida programada
    - Datos viejos → omitida; solapamiento → omitida; frescos → publica ambos escenarios; checklist bloqueante → no publica
    - _Requirements: 27.4, 27.5, 27.6, 27.7_

- [x] 21. Compuerta Fase 6 — Ensure all tests pass, ask the user if questions arise.
  - La programación debe pasar los 190 casos antes de avanzar a la Fase 7.
  - _Requirements: 28.3_

### Fase 7 — Verificación permanente

- [x] 22. Checklist antes de publicar — `src/pages/proyeccion-gyp/checklist.ts` (nuevo)
  - [x] 22.1 Implementar el checklist de publicación (CP-44)
    - Correr y mostrar en pantalla: (1) prueba contable Renta Bruta cuadra en las 6 empresas; (2) cada escenario lleva sus llaves según CP-49; (3) toda Combinada existe en `dim_cuenta`; (4) FECHA=día 1; (5) Pais lleno; (6) Tasa_Mensual no nula solo Cofersa/Mundial; (7) ninguna Combinada repetida por escenario; (8) suma reglas por cuenta + resto = concepto
    - Aviso sin bloqueo cuando el total USD por empresa varía mucho respecto al mes anterior; un fallo bloqueante → no publica
    - _Requirements: 29.1, 29.2, 29.3_

  - [ ]* 22.2 Unit test del checklist bloqueante vs de aviso
    - Un fallo bloqueante detiene el insert; el aviso de variación no bloquea
    - _Requirements: 29.2, 29.3_

- [x] 23. Suite de 190 casos como compuerta permanente — `src/pages/proyeccion-gyp/engine.test.ts`
  - [x] 23.1 Ampliar la suite con los snapshots de control y el aviso en pantalla
    - Reproducir totales de control Proyectado y Causado de partida (7-oct) y los Semi Neto del 19-oct (reglas originales y parametrización oct-2026)
    - Al abrir la página y en CI: aviso "N de 190 casos de prueba del motor se movieron" y consola `[motor] X de 190 casos coinciden`
    - _Requirements: 28.1, 28.2, 28.4, 28.5_

  - [ ]* 23.2 Property test del oráculo de los 190 casos
    - **Feature: proyeccion-gyp-produccion, Property 15: El oráculo de los 190 casos se reproduce al céntimo**
    - **Validates: Requirements 28.1, 28.3, 28.4, 28.5**

- [x] 24. Compuerta final — Ensure all tests pass, ask the user if questions arise.
  - Los 190 casos y todas las propiedades deben pasar antes de dar por cerrada la reescritura.
  - _Requirements: 28.3_

## Notes

- Las tareas marcadas con `*` son opcionales (pruebas) y pueden omitirse para un MVP más rápido; la implementación de cada fase es requerida.
- La Fase 1 es CRÍTICA: sus tareas de implementación (1.x, 2.x, 3.x) no se marcan opcionales. La primera tarea (1.1 migración de BD) no depende de ninguna otra.
- La compuerta de 190 casos (CP-43, Property 15) debe pasar al cierre de cada fase antes de avanzar; los pasos de compuerta (4, 11, 14, 17, 19, 21, 24) lo materializan.
- Cada tarea referencia los requisitos (Requirements X.Y) y, donde aplica, la propiedad de corrección (Property N) con la etiqueta `Feature: proyeccion-gyp-produccion`.
- Los property tests usan Vitest + fast-check en modo `--run` (no watch), con mínimo 100 iteraciones.
- El motor es un refactor con oráculo: `engine.test.ts` valida al céntimo antes y después de cada cambio.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2"] },
    { "id": 4, "tasks": ["2.4", "2.5", "3.1"] },
    { "id": 5, "tasks": ["3.3", "3.4", "6.1", "7.1", "8.1"] },
    { "id": 6, "tasks": ["5.1", "6.2", "7.2", "8.2"] },
    { "id": 7, "tasks": ["5.2", "5.3", "8.3", "8.4", "9.1"] },
    { "id": 8, "tasks": ["5.4", "5.5", "5.6", "5.7", "10.1"] },
    { "id": 9, "tasks": ["12.1", "13.1"] },
    { "id": 10, "tasks": ["12.2", "12.3", "13.2"] },
    { "id": 11, "tasks": ["12.4", "12.5", "15.1"] },
    { "id": 12, "tasks": ["15.2", "16.1"] },
    { "id": 13, "tasks": ["16.2", "16.3", "16.4", "16.5", "16.6"] },
    { "id": 14, "tasks": ["16.7", "16.8", "18.1"] },
    { "id": 15, "tasks": ["18.2", "18.3"] },
    { "id": 16, "tasks": ["18.4", "20.1"] },
    { "id": 17, "tasks": ["20.2", "20.3", "22.1"] },
    { "id": 18, "tasks": ["22.2", "23.1"] },
    { "id": 19, "tasks": ["23.2"] }
  ]
}
```
