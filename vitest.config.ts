import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Configuración mínima de Vitest para el oráculo del motor y los property tests
// (fast-check) del módulo de Proyección GyP. No carga el plugin de React ni el
// auto-import de Vite: la suite del motor prueba funciones puras de TypeScript.
// Se mantiene el alias `@` por si algún test importa utilidades de `src`.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
