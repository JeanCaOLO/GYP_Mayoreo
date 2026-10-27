// supabase/functions/_shared/motor.ts
//
// PUENTE del motor de cálculo hacia el runtime Deno de las Edge Functions.
//
// NO duplica nada: re-exporta los módulos PUROS que viven en el frontend
// (`src/pages/proyeccion-gyp/`). Así hay UNA sola fuente de verdad —el mismo
// `engine.ts` que valida el oráculo de 190 casos y la misma
// `construirFilasEscenarios` que usa la pantalla— y la corrida programada no
// puede desincronizarse de la publicación manual.
//
// Es posible porque esos módulos son TS puro (sin JSX, sin cliente de Supabase
// del navegador ni APIs de browser) y el CLI de Supabase permite importar
// archivos fuera de `supabase/` desde una Edge Function (soportado para
// monorepos). Requiere una versión reciente del CLI (feb-2025+).
//
// La ruta sube de `_shared` → `functions` → `supabase` → raíz del proyecto.

export {
  calcular,
  calcularEscenarios,
  PAIS,
} from '../../../src/pages/proyeccion-gyp/engine.ts';

export type {
  Regla,
  Metodo,
  Parametro,
  ResultadoCalculo,
  ResultadoEscenarios,
  CalcularOpts,
} from '../../../src/pages/proyeccion-gyp/engine.ts';

// Fuente ÚNICA de la construcción de filas de los dos escenarios: la misma que
// usa `page.tsx` al publicar a mano. `InsumosPublicacion` se re-exporta como
// `InsumosMotor` por compatibilidad con `cargarInsumos.ts`.
export {
  construirFilasEscenarios,
} from '../../../src/pages/proyeccion-gyp/salida.ts';

export type {
  FilaResultado,
  InsumosPublicacion as InsumosMotor,
} from '../../../src/pages/proyeccion-gyp/salida.ts';

// Constantes de fábrica (puras, no son datos de prueba del periodo): las seis
// empresas del P&L y la biblioteca de métodos de fábrica del §D. Sirven de
// respaldo server-side si la tabla `proyeccion_metodo` viniera vacía. Las REGLAS,
// SERIES y PARÁMETROS de la semilla NO se importan: en una corrida desatendida no
// se publican cifras de prueba, solo datos reales de Supabase.
export { EMPRESAS, METODOS_BASE } from '../../../src/pages/proyeccion-gyp/seed.ts';