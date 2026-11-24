-- ============================================================================
-- Catálogo GYP: campo «Conversión» (Sí / No)
-- ----------------------------------------------------------------------------
-- Indica si a la cuenta le aplica la conversión. Solo admite dos valores:
-- true = «Sí», false = «No». En pantalla, exportación, plantilla, carga masiva
-- y actualización masiva se muestra y se lee como «Si» / «No».
--
-- Las cuentas existentes quedan en «No» (default false).
--
-- IDEMPOTENTE: se puede correr más de una vez.
-- ============================================================================

alter table public.catalogo_gyp
  add column if not exists conversion boolean not null default false;

comment on column public.catalogo_gyp.conversion is
  'Conversión: true = Sí aplica, false = No aplica.';

-- PostgREST: recargar el esquema para que la API vea la columna nueva.
notify pgrst, 'reload schema';
