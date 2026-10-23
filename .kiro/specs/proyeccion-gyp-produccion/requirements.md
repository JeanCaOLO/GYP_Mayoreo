# Requirements Document

## Introduction

Este documento especifica la reescritura completa del módulo de Proyección GyP en producción (React 19 + TypeScript + Vite + Tailwind + Supabase; Edge Functions en Deno; módulo en `src/pages/proyeccion-gyp/`). No es un desarrollo nuevo (greenfield): el módulo ya existe y funciona en producción, y esta reescritura debe reproducir sus números de forma idéntica mientras incorpora el paquete completo de 55 cambios CP-01…CP-56 descritos en `12-cambios-para-produccion.md`.

El alcance abarca las siete fases del orden sugerido del paquete, reescribiendo los bloques Salida, Datos, Motor, Interfaz, Persistencia y Verificación. El trabajo se ejecuta en secuencia: primero la base de datos (todo el esquema propuesto del §4), luego el motor, los datos, la interfaz y la operación. La prueba de 190 casos (CP-43) actúa como compuerta de calidad en cada fase.

### Restricciones no negociables (aplican a todo el documento)

- **R-NN-1**: THE Motor_Proyeccion SHALL replicar de forma idéntica las fórmulas y reglas de agregación de la Parte II §A–§H del paquete, incluida la agregación del P&L (§A), la fórmula de venta `m_venta` (§B), los turnos de cálculo (§C), los métodos de fábrica (§D), los modos de causado (§E), destino y reparto (§F), la recomendación WAPE (§G) y los dos escenarios (§H).
- **R-NN-2**: THE Motor_Proyeccion SHALL calcular el grupo SEMI (ISLR) y mostrarlo aparte, sin restarlo en el cálculo del Semi_Neto.
- **R-NN-3**: THE Motor_Proyeccion SHALL usar montos en signo crudo, con ingresos negativos y gastos positivos.
- **R-NN-4**: THE Modulo_Proyeccion SHALL conservar las claves internas heredadas `Personal Fijo`, `Logistico`, `Depreciacion` y `Colocacion` sin renombrarlas, mostrando en pantalla los nombres de `Dim_SubClasificacion` (Personal, Logístico, Depreciación, Colocación) (CP-32).
- **R-NN-5**: THE Modulo_Proyeccion SHALL mantener las credenciales de Supabase únicamente en el backend o en el Key Vault, y NO SHALL incluirlas en el repositorio, el navegador ni los registros.

## Glossary

- **Modulo_Proyeccion**: El módulo completo de Proyección GyP en producción (frontend React y backend Supabase/Deno) ubicado en `src/pages/proyeccion-gyp/`.
- **Motor_Proyeccion**: La función pura de cálculo del módulo (`engine.ts`) que produce los dos escenarios a partir de datos, reglas y parámetros.
- **Capa_Datos**: El componente de acceso a datos del módulo (`data.ts`) que lee de Supabase y prepara datos para el motor.
- **Interfaz_Proyeccion**: La interfaz de usuario del módulo (`page.tsx`) con sus siete pestañas.
- **Base_Datos**: La base de datos Supabase donde residen las tablas del módulo.
- **Fabric**: El notebook de Microsoft Fabric que empuja histórico, catálogo, presupuesto, detalle por cuenta y alertas a Supabase; corre con su propia programación.
- **Suite_Verificacion**: La prueba automática de 190 casos (95 conceptos × 2 escenarios) definida en CP-43 (`seed.ts` con `CIFRAS_VALIDADAS`).
- **Tabla_Final**: La tabla `proyeccion_resultado` y la vista `v_proyeccion_final` que lee Power BI.
- **Combinada**: Llave compuesta por cuenta contable + centro de costo + empresa.
- **Escenario_Proyectado**: El escenario de proyección al cierre (`Proyeccion = 1`).
- **Escenario_Causado**: El escenario de causado al corte (`Proyeccion = 2`).
- **Semi_Neto**: Ganancia Operativa − (Otros egresos + Intereses + Depreciación).
- **Renta_Bruta**: Margen = −(Ventas + Costo + Ingresos Mercantiles + Fletes Recuperados + Merma).
- **Corte**: Última fecha con registros en la extracción.
- **Factor**: Multiplicador del ritmo de venta en los últimos 5 días hábiles, editable por empresa y por mes.
- **Detalle_Cuenta**: Cada cuenta del catálogo con sus capas y su serie (`gyp_historico_cuenta` + `dim_cuenta`).
- **Regla_Partida**: Regla original validada por control, punto de partida compartido.
- **Parametrizacion**: Método acordado por regla, compartido, aplicado por debajo de los cambios de usuario.
- **Six_Empresas**: Las seis empresas Febeca, Sillaca, Beval, Prisma, Mundial y Cofersa.

## Requirements

### Fase 1 — Bloque Salida (CRÍTICA)

### Requirement 1: Esquema de base de datos completo

**User Story:** Como persona que mantiene el aplicativo, quiero aplicar primero todo el esquema propuesto en base de datos, para que el resto de la reescritura disponga de las columnas y tablas necesarias antes de tocar el motor, los datos o la interfaz.

#### Acceptance Criteria

1. THE Base_Datos SHALL contener la columna `escenario smallint NOT NULL DEFAULT 1` en `proyeccion_resultado`.
2. THE Base_Datos SHALL contener el índice único `ux_proy_resultado` sobre `proyeccion_resultado (periodo, escenario, combinada)`.
3. THE Base_Datos SHALL contener en `proyeccion_regla` las columnas `nombre`, `detalle`, `causado` (default `igual`), `escenarios` (default `AMBOS`), `nivel` (default `concepto`), `n`, `destino` (jsonb), `formula_id`, `eliminada` (default false), `rev` (default 0), `wid`, `actualizado` y `actualizado_por`.
4. THE Base_Datos SHALL contener las tablas `proyeccion_formula`, `gyp_historico_cuenta`, `dim_cuenta`, `proyeccion_alerta`, `proyeccion_programacion` y `proyeccion_corrida` con las columnas y tipos definidos en el §4 del paquete.
5. WHERE el esquema se aplica contra una base en producción con datos existentes, THE Modulo_Proyeccion SHALL ejecutar las sentencias `ALTER TABLE`/`CREATE TABLE` del §4 antes de modificar `engine.ts`, `data.ts` o `page.tsx`.

### Requirement 2: Publicación de los dos escenarios en la tabla final

**User Story:** Como analista de control, quiero que la tabla final lleve los dos escenarios en append, para que el Causado deje de cargarse a mano en Power BI. (Cubre CP-01, CP-49)

#### Acceptance Criteria

1. WHEN el Modulo_Proyeccion publica un periodo, THE Modulo_Proyeccion SHALL recorrer los escenarios `['PROYECCION','CAUSADO']` y escribir ambos como append en `proyeccion_resultado`, con `Proyeccion = 1` para el proyectado al cierre y `Proyeccion = 2` para el causado al corte.
2. WHERE una regla declara el campo `escenarios = 'CAUSADO'`, THE Modulo_Proyeccion SHALL excluir esa regla de las filas con `Proyeccion = 1`.
3. WHERE una regla declara el campo `escenarios = 'PROYECCION'`, THE Modulo_Proyeccion SHALL excluir esa regla de las filas con `Proyeccion = 2`.
4. WHERE una regla declara el campo `escenarios = 'AMBOS'`, THE Modulo_Proyeccion SHALL incluir esa regla en los dos escenarios.

### Requirement 3: Clave única por escenario y escritura idempotente

**User Story:** Como analista de control, quiero que cada publicación sea idempotente y que el causado no pise la proyección, para que el P&L no sume filas duplicadas ni mezcladas. (Cubre CP-02, CP-03)

#### Acceptance Criteria

1. THE Modulo_Proyeccion SHALL deduplicar las filas de `proyeccion_resultado` por la llave `(periodo, escenario, combinada)`.
2. WHEN el Modulo_Proyeccion publica un periodo y escenario, THE Modulo_Proyeccion SHALL ejecutar `DELETE` de ese `(periodo, escenario)` seguido de `INSERT`, dentro de una única transacción.
3. WHEN el Modulo_Proyeccion publica el mismo mes dos veces, THE Modulo_Proyeccion SHALL dejar el mismo número de filas que una sola publicación, reemplazando las anteriores en lugar de acumularlas.

### Requirement 4: Contrato de la tabla final (FECHA, tasa, país, fusión, validación)

**User Story:** Como analista de control, quiero que las columnas de la tabla final cumplan el contrato exacto, para que `F_Mayor` en Power BI no se rompa en silencio. (Cubre CP-04, CP-05, CP-06, CP-07, CP-52)

#### Acceptance Criteria

1. THE Modulo_Proyeccion SHALL fijar la columna `FECHA` al día 1 del periodo en todas las filas de la tabla final.
2. THE Modulo_Proyeccion SHALL poblar `Tasa_Mensual` únicamente para Cofersa y Mundial con la tabla de tasas que empuja Fabric, y dejarla NULL para las empresas venezolanas.
3. THE Modulo_Proyeccion SHALL calcular `Monto_Local` como `Monto_USD × tasa local`.
4. THE Modulo_Proyeccion SHALL poblar la columna `Pais` desde un mapa de países propio del aplicativo, asignando Venezuela a Beval, Febeca, Sillaca y Prisma, Costa Rica a Cofersa y Colombia a Mundial.
5. WHEN dos o más reglas resuelven a la misma Combinada, THE Modulo_Proyeccion SHALL fusionarlas sumándolas en una sola fila antes del insert.
6. WHEN el Modulo_Proyeccion va a publicar, IF una Combinada no existe en `dim_cuenta`, THEN THE Modulo_Proyeccion SHALL señalar la llave huérfana y reportarla antes de publicar.
7. THE Modulo_Proyeccion SHALL emitir las trece columnas de la tabla final en el orden exacto `FECHA;Ajuste;Vista;Combinada;Pais;Empresa;Tasa_Mensual;Ajuste_USD;Monto_Local;Monto_USD;CENTRO_COSTO;CUENTA_CONTABLE;Proyeccion`, con separador `;`, `Ajuste = 0`, `Ajuste_USD = 0` y `Vista = 'GYP'`.
8. THE Modulo_Proyeccion SHALL emitir una fila por cuenta de destino, de modo que una regla repartida aporte varias filas.

### Fase 2 — Datos y parametrización en Supabase

### Requirement 5: Detalle por cuenta y catálogo dimensional

**User Story:** Como analista, quiero el detalle por cuenta y el catálogo en Supabase, para que las bases por capas, el reparto, las reglas por cuenta, el backtest y las alertas funcionen. (Cubre CP-11)

#### Acceptance Criteria

1. THE Capa_Datos SHALL leer el detalle por cuenta desde `gyp_historico_cuenta` (capas, acumulado, presupuesto y 12 meses) y el catálogo desde `dim_cuenta`.
2. THE Capa_Datos SHALL cuadrar automáticamente el detalle por cuenta contra el resumen del periodo.
3. IF el Detalle_Cuenta no está cargado para el periodo, THEN THE Motor_Proyeccion SHALL limitar las bases por capas a empresa, grupo y concepto.

### Requirement 6: Parametrización compartida en Supabase

**User Story:** Como equipo, quiero que las reglas y la parametrización se guarden en Supabase, para que lo que cambia una persona lo vean todos. (Cubre CP-37)

#### Acceptance Criteria

1. THE Modulo_Proyeccion SHALL guardar en Supabase las reglas cambiadas, nuevas y eliminadas, las fórmulas propias, el causado por fórmula, las reglas de partida y el factor de cada mes, según el mapeo del §3.
2. WHEN una persona guarda un cambio, THE Modulo_Proyeccion SHALL hacerlo visible a las demás personas que trabajan el mismo mes.

### Requirement 7: Suscripción en tiempo real

**User Story:** Como analista, quiero que la página reciba los cambios en tiempo real, para que dos personas no se pisen sin enterarse. (Cubre CP-54)

#### Acceptance Criteria

1. THE Interfaz_Proyeccion SHALL suscribirse mediante Supabase Realtime a las tablas de mes, reglas, extracción, alertas y estado de la solicitud.
2. WHEN llega un cambio por la suscripción, THE Interfaz_Proyeccion SHALL aplicarlo automáticamente y mostrar un toast describiendo el cambio.

### Requirement 8: Carga de la parametrización de octubre

**User Story:** Como analista de control, quiero cargar la parametrización de octubre como punto de partida compartido, para que las 69 reglas recalibradas apliquen por debajo de los cambios de usuario. (Cubre CP-42)

#### Acceptance Criteria

1. THE Modulo_Proyeccion SHALL cargar `prototipo/datos/parametrizacion_2026-10.json` en `proyeccion_regla` según el criterio de `07-parametrizacion-oct-2026.md`.
2. THE Modulo_Proyeccion SHALL aplicar la parametrización por debajo de los cambios de usuario, sin pisar los cambios de usuario.
3. THE Modulo_Proyeccion SHALL conservar Venta, Costo de Ventas, Fletes Recuperados y la Colocación de Prisma con su fórmula de venta sobre su propio acumulado, sin modificarlas por la parametrización.

### Fase 3 — Bloque Motor v2 (Parte II completa)

### Requirement 9: Bases por capas del catálogo

**User Story:** Como analista, quiero componer la base de un paso filtrando por capas del catálogo, para que las bases reflejen la selección real de cuentas. (Cubre CP-16)

#### Acceptance Criteria

1. THE Motor_Proyeccion SHALL permitir filtrar la base de un paso por Empresa, Sección, Línea, Detalle, Concepto, Cuenta, Prefijo de cuenta, Descripción contiene, Centro de costo, Prefijo de centro, Cuenta + centro y Grupo del P&L.
2. WHEN una misma capa tiene varios valores, THE Motor_Proyeccion SHALL sumar esos valores.
3. WHEN la base combina capas distintas, THE Motor_Proyeccion SHALL cruzar las capas distintas.
4. WHERE una capa está marcada como exclusión, THE Motor_Proyeccion SHALL excluir sus valores en vez de incluirlos.

### Requirement 10: Origen real con medida elegible

**User Story:** Como analista, quiero elegir el origen y la medida de un paso, para que cada regla tome su dato de la fuente correcta. (Cubre CP-17)

#### Acceptance Criteria

1. THE Motor_Proyeccion SHALL permitir como origen de un paso: Real (Fabric), Presupuesto u Otra regla ya calculada.
2. WHERE el origen es Real, THE Motor_Proyeccion SHALL permitir como medida: promedio, mediana o suma de N meses cerrados; un mes cerrado; el mismo mes del año anterior; el mes en curso al corte; el mes en curso extrapolado a días hábiles; el acumulado del año cerrado; o el acumulado del año al corte.
3. THE Motor_Proyeccion SHALL leer como "Otra regla ya calculada" los pasos que en la v1 figuraban como "Real" pero tomaban lo ya calculado por otras reglas, sin cambiar las cifras validadas.

### Requirement 11: Métodos compuestos y métodos de fábrica

**User Story:** Como analista, quiero métodos compuestos de pasos y los métodos de fábrica del §D, para que las fórmulas se construyan por piezas y coincidan con la referencia. (Cubre CP-18)

#### Acceptance Criteria

1. THE Motor_Proyeccion SHALL evaluar un método como una secuencia de `pasos` donde el primero parte de su base y cada siguiente opera sobre el resultado del anterior, sin precedencia ni paréntesis.
2. THE Motor_Proyeccion SHALL soportar las operaciones `formula_venta`, `promedio`, `mediana`, `ultimo`, `ratio_venta`, `porcentaje`, `presupuesto`, `valor_fijo`, `multiplicar`, `sumar`, `restar`, `componentes` y `derivada`.
3. THE Motor_Proyeccion SHALL implementar los métodos de fábrica `m_venta`, `m_promedio`, `m_mediana`, `m_ultimo`, `m_ppto`, `m_fijo`, `m_pct_venta`, `m_ratio_venta`, `m_derivada` y `m_pct_semineto` con su operación, valor por defecto, turno y causado por defecto de la Parte II §D, con N por defecto = 9 meses.
4. THE Motor_Proyeccion SHALL aplicar `m_pct_semineto` solo al grupo Impuesto y `m_derivada` solo a la Colocación de Prisma.
5. WHEN el método tiene un solo paso, THE Motor_Proyeccion SHALL permitir que el `valor` de la regla sobrescriba el del paso; WHEN el método tiene varios pasos, THE Motor_Proyeccion SHALL NO sobrescribir todos los pasos con ese `valor`.

### Requirement 12: Fórmula de venta y turnos de cálculo

**User Story:** Como analista de control, quiero que la fórmula de venta y los turnos se calculen exactamente como el §B y §C, para que el orden de las reglas no altere el resultado. (Cubre Parte II §B, §C)

#### Acceptance Criteria

1. THE Motor_Proyeccion SHALL calcular la proyección de venta como `acumulado + ritmo × max(restantes − 5, 0) + ritmo × factor × min(restantes, 5)`, con `ritmo = acumulado ÷ días transcurridos` y `restantes = días hábiles del mes − transcurridos`, y el causado como el acumulado.
2. IF no hay acumulado, THEN THE Motor_Proyeccion SHALL usar el promedio histórico.
3. THE Motor_Proyeccion SHALL contar Venezuela trabajando sábados y el resto de lunes a viernes para los días hábiles.
4. THE Motor_Proyeccion SHALL ejecutar los cálculos en los turnos 1 a 5 del §C, recalculando los agregados tras cada turno.
5. WHEN un filtro es de solo grupo, THE Motor_Proyeccion SHALL usar la foto del turno anterior, de modo que el resultado no dependa del orden de las reglas dentro de un turno.

### Requirement 13: Cuatro modos de causado

**User Story:** Como analista de control, quiero cuatro modos de causado por regla, para que el causado deje de comparar una venta parcial contra un mes entero de gastos. (Cubre CP-19, Parte II §E)

#### Acceptance Criteria

1. THE Motor_Proyeccion SHALL soportar los modos de causado `igual`, `habiles`, `calendario` y `real`, con el cálculo del §E (igual = mismo valor; habiles = resultado × transcurridos ÷ días hábiles; calendario = resultado × día del corte ÷ días del mes; real = lo asentado al corte en las cuentas de la regla o su destino).
2. THE Motor_Proyeccion SHALL usar `igual` como modo de causado por defecto.
3. THE Motor_Proyeccion SHALL NO aplicar modo de causado a la fórmula de venta ni a la derivada.

### Requirement 14: Destino por capas y reparto entre cuentas

**User Story:** Como analista, quiero repartir el monto de una regla entre varias cuentas de destino, para que el gasto caiga donde corresponde. (Cubre CP-20, Parte II §F)

#### Acceptance Criteria

1. IF una regla no tiene destino, THEN THE Motor_Proyeccion SHALL asignar todo el monto a la Combinada de la regla.
2. WHERE una regla tiene destino con varias cuentas, THE Motor_Proyeccion SHALL repartir el monto según su historia (promedio de N meses), según su presupuesto o en partes iguales, de modo que la suma del reparto dé el monto de la regla.
3. THE Motor_Proyeccion SHALL repartir con el signo dominante, sin asignar una parte negativa a una cuenta con reversos.
4. IF no hay historia ni presupuesto para repartir, THEN THE Motor_Proyeccion SHALL repartir en partes iguales y emitir un aviso.

### Requirement 15: Reglas por cuenta y "el resto", y reglas adicionales

**User Story:** Como analista, quiero reglas de una sola cuenta y reglas adicionales sumables, para estimar cuentas por separado sin duplicar gasto. (Cubre CP-21, CP-22)

#### Acceptance Criteria

1. WHERE una regla es de una sola cuenta, THE Motor_Proyeccion SHALL usar la historia y el acumulado de esa cuenta, y calcular el concepto sobre el resto de sus cuentas restando acumulado y serie redondeado a céntimos.
2. IF el método del concepto no usa su historia y existe una regla por cuenta, THEN THE Modulo_Proyeccion SHALL avisar de posible doble conteo.
3. THE Motor_Proyeccion SHALL limitar a 300 reglas la creación en lote por cuenta.
4. WHEN se agrega una regla adicional a un concepto, THE Motor_Proyeccion SHALL sumarla a la regla del concepto.
5. WHERE una regla es adicional, THE Interfaz_Proyeccion SHALL ocultar el acierto y la recomendación, y WHERE la regla adicional tiene nombre, THE Interfaz_Proyeccion SHALL omitir el aviso de doble conteo.

### Requirement 16: Escenarios por regla y dependencias circulares

**User Story:** Como analista de control, quiero declarar el escenario de cada regla y bloquear ciclos, para servir los dos escenarios con un solo juego de reglas sin cálculos que se repitan. (Cubre CP-49, CP-51, Parte II §H)

#### Acceptance Criteria

1. THE Motor_Proyeccion SHALL correr dos veces, cambiando la base de venta (extrapolada en Escenario_Proyectado, acumulada al corte en Escenario_Causado) y aplicando el §E a cada método.
2. THE Modulo_Proyeccion SHALL permitir que cada regla declare `escenarios` como AMBOS (por defecto), solo PROYECCION o solo CAUSADO, mostrándolo como etiqueta `solo proyectado` / `solo causado`.
3. WHEN una persona guarda reglas cuyas bases forman un ciclo entre conceptos, THE Modulo_Proyeccion SHALL detectar el ciclo al guardar, bloquear el guardado y nombrar el ciclo.

### Fase 4 — Bloque Interfaz (7 pestañas)

### Requirement 17: Estructura de pestañas y cabecera con KPIs y sello de frescura

**User Story:** Como analista, quiero siete pestañas, KPIs siempre visibles y un sello de frescura, para distinguir un número de hoy de uno de hace dos semanas. (Cubre CP-46, estructura de 7 pestañas, CP-36)

#### Acceptance Criteria

1. THE Interfaz_Proyeccion SHALL presentar siete pestañas: 1 Parámetros, 2 Reglas, 3 Resultado, 4 Tabla de salida, 5 Comparar, 6 Alertas (con contador) y 7 Mis fórmulas, con los avisos como toast de 7 segundos.
2. THE Interfaz_Proyeccion SHALL mostrar una franja de KPIs fija e independiente de cualquier selector con Ingresos, Renta Bruta, Gastos Operativos, Ganancia Operativa y Semi Neto sumando las Six_Empresas, con el proyectado arriba y el causado debajo.
3. THE Interfaz_Proyeccion SHALL mostrar un sello de frescura de tres estados: verde `Fabric · <fecha> · datos al <corte>`, ámbar cuando usa copia de respaldo o base sin extracción, y rojo cuando no hay datos del mes o no se pudo leer la base.
4. THE Interfaz_Proyeccion SHALL omitir el ruido retirado en CP-36 (selector global "Promedio por defecto", selector de método por fila, alertas de signo coincidente, "Solo las que cambié", marcas "calibrada"/"cambiada", "Más opciones" en Parámetros, columna "vs. validado 7-oct" y botón "Comprobar el motor").

### Requirement 18: Pestaña Reglas como único lugar de trabajo

**User Story:** Como analista, quiero trabajar las reglas desde un panel con opciones de estimación, impacto y avanzado, para estimar sin editar la tabla directamente. (Cubre CP-23, CP-24, CP-25, CP-26, CP-27, CP-29, CP-30, CP-31, CP-48)

#### Acceptance Criteria

1. THE Interfaz_Proyeccion SHALL mostrar el proyectado y el causado lado a lado en la cabecera y en la tabla de reglas, sin selector global de escenario.
2. WHEN una persona pulsa una fila de regla, THE Interfaz_Proyeccion SHALL abrir un panel con: nombre y detalle opcionales; tarjetas de estimación con su número y error (CP-25); parámetros según la opción; el bloque "Así quedaría" con proyectado, causado y Semi Neto de la empresa y su diferencia frente a hoy (CP-26); el bloque "Avanzado" (causado, escenario, otra fórmula, fórmula propia, destino y reparto); y botones Guardar, Cancelar, "+ Otra regla para el concepto", Eliminar y "Volver a como estaba".
3. THE Interfaz_Proyeccion SHALL mostrar junto a cada opción cuánto daría y su error WAPE de los últimos 6 meses cerrados, con semáforo verde ≤ 10 %, ámbar ≤ 25 % y rojo > 25 %, calculado según la Parte II §G.
4. THE Interfaz_Proyeccion SHALL ofrecer "+ Agregar regla" con tres caminos: agregar una regla que se suma al concepto, repartir un monto entre cuentas y estimar cada cuenta por separado.
5. WHEN una persona elimina una regla, THE Interfaz_Proyeccion SHALL ofrecer "Deshacer" en el aviso, listar las eliminadas al pie con botón restaurar, y THE Modulo_Proyeccion SHALL usar borrado lógico (`eliminada`) sin `DELETE`.
6. THE Interfaz_Proyeccion SHALL agrupar las reglas por empresa y por bloque del P&L (Venta y margen; Gastos operativos; Otros, intereses y depreciación; Impuesto) con las etiquetas de fila `cuenta`, `nueva`, `sin N ctas`, `sin detalle`, `solo proyectado` y `solo causado`.

### Requirement 19: Pestaña Mis fórmulas

**User Story:** Como analista, quiero una biblioteca de fórmulas propias por piezas, para armar y reutilizar fórmulas probándolas antes de guardar. (Cubre CP-28)

#### Acceptance Criteria

1. THE Interfaz_Proyeccion SHALL listar las fórmulas propias con su frase "en palabras" y las reglas que las usan, con editar, eliminar y "+ Nueva fórmula".
2. THE Interfaz_Proyeccion SHALL componer una fórmula como una suma de piezas con signo y %, incluyendo monto fijo, % de la venta del mes, lo típico de unas cuentas, lo que va del mes llevado al cierre, el presupuesto de unas cuentas y un % de lo que calculan otras reglas.
3. WHEN una persona crea o edita una fórmula, THE Interfaz_Proyeccion SHALL permitir probarla sobre cualquier regla mostrando su impacto antes de guardar.
4. WHEN una persona edita una fórmula de fábrica, THE Interfaz_Proyeccion SHALL crear una copia y conservar la original; WHEN una persona edita desde una regla una fórmula usada por otras, THE Interfaz_Proyeccion SHALL preguntar si se cambia en todas.

### Requirement 20: Pestaña Parámetros y mes de trabajo

**User Story:** Como analista, quiero elegir el mes de trabajo, editar la venta por empresa y ver la programación, para fijar el contexto común del cálculo. (Cubre CP-33)

#### Acceptance Criteria

1. THE Interfaz_Proyeccion SHALL mostrar tarjetas por mes disponible con su estado (mes completo, terminó, en curso, sin datos).
2. WHEN una persona elige un mes, THE Modulo_Proyeccion SHALL fijarlo para todos y limpiar el detalle por cuenta, los repartos y el presupuesto del mes anterior, dejando en cero los conceptos sin movimiento.
3. THE Modulo_Proyeccion SHALL guardar el Factor por mes.
4. THE Interfaz_Proyeccion SHALL mostrar la tabla de venta por empresa con días hábiles, transcurridos, factor y tasa editables, y la venta al corte y proyectada calculadas, en el orden: sobre qué mes trabajas, la venta del mes, cuándo se actualiza solo.

### Requirement 21: Pestañas Alertas y plantilla del catálogo

**User Story:** Como analista, quiero ver las cuentas con movimiento fuera del catálogo y generar la plantilla del portal, para corregir el catálogo antes de que falten importes en el GyP. (Cubre CP-34, CP-53)

#### Acceptance Criteria

1. THE Interfaz_Proyeccion SHALL mostrar las cuentas con movimiento que el catálogo no reconoce, en tres tarjetas resumen por acción (crear, corregir, clasificar), con filtros por empresa, acción y búsqueda, la referencia sugerida y los movimientos del mes, de 12 meses y del último mes.
2. THE Interfaz_Proyeccion SHALL NO listar las cuentas de balance (activo, pasivo, patrimonio) marcadas como GYP, y SHALL mostrar un contador en la pestaña y avisar desde Reglas cuando hay alertas.
3. WHEN una persona pide la plantilla, THE Interfaz_Proyeccion SHALL ofrecer copiar filas (sin encabezado, separadas por tabulador) y descargar `Plantilla_Catalogo_GYP_<periodo>.xlsx` generado en el navegador con las 18 columnas del portal, dejando vacías Linea, Grupo, Saldo Normal, Comercializadora y Orden Clasificacion.

### Requirement 22: Pestañas Resultado, Comparar y Tabla de salida con prueba contable

**User Story:** Como analista de control, quiero ver el P&L, la comparación por concepto y la prueba contable de la Renta Bruta, para detectar un concepto que se va de rango antes del cierre. (Cubre CP-45, CP-47, CP-55, CP-35)

#### Acceptance Criteria

1. THE Interfaz_Proyeccion SHALL mostrar en Comparar, por empresa y concepto: Proyectado al cierre, Causado al corte, Presupuesto, Proy. vs Ppto y Causado / Proy., con los conceptos de varias reglas desplegables y el total de la empresa al pie.
2. THE Interfaz_Proyeccion SHALL mostrar en Resultado, debajo del P&L, la prueba contable `Renta Bruta = Margen + Ingresos Mercantiles + Fletes Recuperados − Merma` para las Six_Empresas.
3. IF la prueba contable de la Renta Bruta no cuadra, THEN THE Modulo_Proyeccion SHALL NO publicar el resultado.
4. THE Interfaz_Proyeccion SHALL permitir copiar el CSV de la tabla de salida, copiar las filas de Alertas y generar el `.xlsx` de la plantilla en el navegador.
5. WHEN una persona pulsa cualquier cifra de Reglas, THE Interfaz_Proyeccion SHALL mostrar la traza paso a paso del número para ese escenario (acumulado, ritmo diario, días, serie usada, proporción sobre venta, aporte de cada pieza, base de cada paso, ajuste al causado, resultado en USD y destino o reparto).

### Requirement 23: Las ocho validaciones en pantalla

**User Story:** Como analista, quiero un bloque de validaciones en Reglas, para revisar doble conteo, repartos, signos y dependencias antes de publicar. (Cubre CP-50)

#### Acceptance Criteria

1. THE Interfaz_Proyeccion SHALL reunir en un aviso plegable "N cosas por revisar" las ocho validaciones de CP-50 (doble conteo a la misma cuenta sin nombre; avisos de reparto; conceptos con regla por cuenta cuyo método no usa historia; reglas por cuenta sin detalle cargado; empresas sin regla de ingreso; resultados con signo contrario a su historia fuera de Ventas; cuentas fuera del catálogo; errores al guardar fórmulas).
2. THE Interfaz_Proyeccion SHALL NO bloquear el trabajo con ninguna validación salvo la octava (errores al guardar fórmulas, incluidas las dependencias circulares de CP-51).

### Fase 5 — Datos, extracción, concurrencia y operación

### Requirement 24: Extracción corregida, serie y presupuesto

**User Story:** Como analista, quiero la suma corregida, la serie de 12 meses y el presupuesto con la extracción, para que no se pierdan filas ni falten datos en enero. (Cubre CP-08, CP-09, CP-10)

#### Acceptance Criteria

1. THE Capa_Datos SHALL calcular la suma en modo corregido aplicando `COALESCE` a `Monto_USD` y `Ajuste_USD`, filtrando solo `Vista = 'GYP'` y excluyendo las cuentas `9.5.*` de proyección.
2. THE Capa_Datos SHALL comprobar en cada corrida que el modo corregido y el modo validado coinciden con los datos de octubre.
3. THE Capa_Datos SHALL proveer siempre la serie de los 12 meses anteriores al periodo.
4. THE Capa_Datos SHALL traer el presupuesto del periodo (`presupuesto_gyp_v2`) con la extracción, disponible para "Lo presupuestado", el reparto por presupuesto y la pestaña Comparar.

### Requirement 25: Extracción de dos meses, mes terminado, alertas y botones manuales

**User Story:** Como persona que opera el aplicativo, quiero botones que ejecuten y una extracción que cubra el mes en curso y el anterior, para seguir trabajando octubre después del cierre sin disparar Fabric. (Cubre CP-12, CP-13, CP-14, CP-15)

#### Acceptance Criteria

1. WHEN la extracción corre sin argumentos, THE Capa_Datos SHALL sacar el mes en curso y el anterior con una sola conexión, admitiendo `--meses N` y `--periodo`.
2. WHEN los registros ya llegan al último día hábil, THE Capa_Datos SHALL fijar el corte en el último día del mes.
3. WHEN una persona pulsa "Actualizar", THE Modulo_Proyeccion SHALL releer de Supabase la última extracción publicada por Fabric sin ejecutar nada más.
4. WHEN una persona pulsa "Publicar la tabla final ahora", THE Modulo_Proyeccion SHALL recalcular los dos escenarios y escribir `proyeccion_resultado`.
5. WHEN una persona pulsa cualquiera de esos botones, THE Modulo_Proyeccion SHALL registrar una fila en `proyeccion_corrida` con `origen = 'manual'`, quién la lanzó y su estado final.
6. THE Modulo_Proyeccion SHALL NO disparar la extracción de Fabric desde el aplicativo.
7. THE Capa_Datos SHALL mostrar la tabla de alertas producida por la extracción (`proyeccion_alerta`), calculada por el notebook de Fabric.

### Requirement 26: Concurrencia y operación

**User Story:** Como equipo, quiero bloqueo optimista, copia de datos de solo lectura, trazabilidad de autor y reinicio de reglas, para que los cambios concurrentes no se pisen ni se pierdan. (Cubre CP-38, CP-39, CP-40, CP-41)

#### Acceptance Criteria

1. WHEN el Modulo_Proyeccion guarda una regla con `UPDATE ... rev = rev + 1 WHERE id = $1 AND rev = $2` y afecta 0 filas, THE Modulo_Proyeccion SHALL recargar y avisar en vez de guardar encima, ignorando el eco propio por `wid`.
2. WHEN el Modulo_Proyeccion recibe datos de solo lectura o inmutables de la base, THE Modulo_Proyeccion SHALL copiarlos antes de modificarlos.
3. THE Modulo_Proyeccion SHALL registrar en cada cambio el usuario autenticado además de la fecha y la hora.
4. WHEN una persona usa "Volver a las reglas de partida", THE Modulo_Proyeccion SHALL pedir confirmación doble antes de borrar cambios, reglas nuevas, fórmulas propias y factores para todos.

### Fase 6 — Actualización programada

### Requirement 27: Actualización programada en hora de Caracas

**User Story:** Como analista de control, quiero programar la publicación en hora de Caracas, para que el reporte amanezca con los números del día sin que nadie entre a publicarlos. (Cubre CP-56)

#### Acceptance Criteria

1. THE Interfaz_Proyeccion SHALL mostrar en Parámetros, abajo y a primera vista, la configuración de actualización programada con estado (activa/pausada), frecuencia (todos los días, solo días hábiles, semanal con día), hora de publicación en hora de Caracas, mes (vigente por defecto o uno fijo) y "no publicar con datos viejos" (sí por defecto).
2. THE Modulo_Proyeccion SHALL guardar la zona `America/Caracas` con el dato, mostrar y guardar la hora en hora local de Caracas, nunca mostrar UTC en pantalla, y hacer la conversión a UTC en el backend.
3. THE Modulo_Proyeccion SHALL ejecutar la corrida programada en un trabajo del lado del servidor (pg_cron, función programada de Supabase o cron del backend), nunca en el navegador.
4. WHEN la corrida programada se ejecuta, THE Modulo_Proyeccion SHALL publicar los dos escenarios de forma idempotente (`DELETE`+`INSERT` por `(periodo, escenario)` en una transacción) usando las reglas tal como estén guardadas.
5. WHEN la corrida programada va a publicar, IF el checklist de CP-44 falla, THEN THE Modulo_Proyeccion SHALL NO publicar, registrar el error y avisar.
6. IF la extracción del mes de trabajo no es del día o su corte no avanzó desde la última publicación, THEN THE Modulo_Proyeccion SHALL marcar la corrida `omitida`, avisar y conservar lo publicado, salvo que el guardia de datos frescos esté desactivado.
7. IF la corrida anterior sigue en curso, THEN THE Modulo_Proyeccion SHALL marcar la nueva corrida `omitida`.
8. THE Modulo_Proyeccion SHALL registrar por separado el recálculo y la publicación en `proyeccion_corrida`, y NO ejecutar la publicación si el recálculo no terminó.
9. THE Interfaz_Proyeccion SHALL mostrar en modo lectura los datos de Fabric (última extracción y corte) y la publicación (última y próxima, escrita en claro en hora de Caracas).

### Fase 7 — Verificación permanente

### Requirement 28: Prueba de 190 casos como compuerta

**User Story:** Como analista de control, quiero que la prueba de 190 casos corra en el despliegue y en cada fase, para distinguir "el motor sigue bien" de "los números cambiaron y nadie sabe por qué". (Cubre CP-43)

#### Acceptance Criteria

1. WHEN la página abre, THE Suite_Verificacion SHALL recalcular los 190 resultados (95 conceptos × 2 escenarios) sobre la foto del 7-oct con las reglas originales, sin parametrización ni cambios de usuario, y compararlos con las cifras validadas con tolerancia ±0,01 USD.
2. IF alguno de los 190 casos se mueve, THEN THE Interfaz_Proyeccion SHALL mostrar en Resultado "Aviso técnico: N de 190 casos de prueba del motor se movieron" y registrar en consola `[motor] X de 190 casos coinciden`.
3. WHEN se entrega cualquiera de las siete fases, THE Suite_Verificacion SHALL actuar como compuerta, de modo que una fase que rompa cualquiera de los 190 casos no avanza.
4. THE Suite_Verificacion SHALL reproducir, con las reglas de partida y la foto del 7-oct, los totales de control Proyectado al cierre (Ingresos 18.362.245, Renta Bruta 5.530.385, Gastos Op. 4.691.354, Gcia. Operativa 839.031, Semi Neto 1.116.184) y Causado al corte (Ingresos 4.039.387, Renta Bruta 1.365.495, Gastos Op. 4.045.551, Gcia. Operativa −2.680.056, Semi Neto −2.402.903).
5. THE Suite_Verificacion SHALL reproducir, con la parametrización de octubre y datos al 19-oct, el Semi Neto Proyectado al cierre de 486.541 y el Causado al corte de 211.168; y con las reglas originales al 19-oct, el Semi Neto Proyectado al cierre de 1.188.929 y el Causado al corte de −888.523.

### Requirement 29: Checklist antes de publicar

**User Story:** Como analista de control, quiero un checklist automático antes de publicar, para que un número distinto del real no se descubra tarde. (Cubre CP-44)

#### Acceptance Criteria

1. WHEN el Modulo_Proyeccion va a publicar, THE Modulo_Proyeccion SHALL correr y mostrar en pantalla el checklist: prueba contable de la Renta Bruta cuadra en las Six_Empresas; cada escenario lleva las llaves que le corresponden según CP-49; toda Combinada existe en `dim_cuenta`; `FECHA` = día 1 en todas las filas; `Pais` lleno en las Six_Empresas; `Tasa_Mensual` no nula para Cofersa y Mundial y nula para el resto; ninguna Combinada repetida dentro de un escenario; la suma de las reglas por cuenta más el resto cuadra con el concepto.
2. WHEN el total en USD por empresa varía mucho respecto al mes anterior, THE Modulo_Proyeccion SHALL avisar sin bloquear la publicación.
3. IF una comprobación bloqueante del checklist falla, THEN THE Modulo_Proyeccion SHALL NO publicar.
