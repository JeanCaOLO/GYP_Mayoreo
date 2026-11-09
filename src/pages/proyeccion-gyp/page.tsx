import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  calcularEscenarios,
  PAIS,
  type Metodo,
  type Regla,
  type AgregadoEmpresa,
} from './engine';
import { CIFRAS_VALIDADAS, EMPRESAS } from './seed';
import {
  construirFilasEscenarios,
  datosDelCorte,
  fusionarPorCombinada,
} from './salida';
import { checklistPublicacion } from './checklist';
import { desglosarRentaBrutaTodas } from './components/pruebaContable';
import { aplicarHistoriaPorCuenta, type HistoriaDeCuenta } from './destino';
import {
  construirDesdeSemilla,
  cargarDesdeSupabase,
  cargarDatosDetalle,
  cargarMesesConDatos,
  cargarMesesPreparados,
  type MesPreparado,
  clonarReglas,
  cargarFormulasComoMetodos,
  leerMesDeTrabajo,
  guardarMesDeTrabajo,
  guardarParametroMes,
  suscribirCambios,
  ensamblarReglas,
  publicarViaEdge,
  refrescarDesdeFabric,
  guardarFactorMes,
  guardarMetodo,
  actualizarRegla,
  crearRegla,
  eliminarRegla as eliminarReglaDb,
  restaurarRegla as restaurarReglaDb,
  type CambiosRegla,
  cargarProgramacion,
  guardarProgramacion,
  cargarUltimaPublicacion,
  PROGRAMACION_DEFAULT,
  type ProyeccionData,
  type ReglaBase,
  type FilaResultado,
  type PresupuestoFila,
  type Alerta,
  motivoError,
  type Programacion,
  type CambiosProgramacion,
  type Corrida,
} from './data';
import { mesesSeleccionables, hoyISO } from './meses';
import SelloFrescura from './components/SelloFrescura';
import KpiHeader from './components/KpiHeader';
import PestanaParametros, {
  estadoDelPeriodo,
  type EstadoMes,
} from './components/PestanaParametros';
import PestanaReglas, { type Override, type NuevaRegla } from './components/PestanaReglas';
import PestanaResultado from './components/PestanaResultado';
import PestanaTablaSalida from './components/PestanaTablaSalida';
import PestanaComparar from './components/PestanaComparar';
import PestanaAlertas from './components/PestanaAlertas';
import PestanaMisFormulas from './components/PestanaMisFormulas';
import TrazaModal from './components/TrazaModal';
import type { Traza } from './components/traza';
import type { FilaHistoricoCuenta, FilaDimCuenta } from './capas';

// ─────────────────────────────────────────────────────────────────────────────
// Formato y constantes de pestañas
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined, d = 0): string =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Las siete pestañas del módulo (CP-46, Requirement 17.1). */
type TabId = 'parametros' | 'reglas' | 'resultado' | 'salida' | 'comparar' | 'alertas' | 'formulas';
const TABS: { id: TabId; n: number; label: string }[] = [
  { id: 'parametros', n: 1, label: 'Parámetros' },
  { id: 'reglas', n: 2, label: 'Reglas' },
  { id: 'resultado', n: 3, label: 'Resultado' },
  { id: 'salida', n: 4, label: 'Tabla de salida' },
  { id: 'comparar', n: 5, label: 'Comparar' },
  { id: 'alertas', n: 6, label: 'Alertas' },
  { id: 'formulas', n: 7, label: 'Mis fórmulas' },
];

export default function ProyeccionGypPage() {
  const { addToast } = useToast();
  const { isAdmin } = useAuth();

  const [data, setData] = useState<ProyeccionData>(() => construirDesdeSemilla());
  const [tab, setTab] = useState<TabId>('parametros');

  // Estado editable del usuario (equivalente a `est` del prototipo).
  const [gn, setGn] = useState(9);
  const [params, setParams] = useState(() => data.params);
  const [metodosUser, setMetodosUser] = useState<Record<string, Metodo>>({});
  const [metBorrados, setMetBorrados] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [nuevas, setNuevas] = useState<NuevaRegla[]>([]);
  // P1 · Meses que de verdad tienen datos extraídos, y el `rev` del mes de
  // trabajo guardado (para el bloqueo optimista al cambiarlo).
  const [mesesConDatos, setMesesConDatos] = useState<string[]>([]);
  const [mesesPreparados, setMesesPreparados] = useState<Map<string, MesPreparado>>(new Map());
  const [revMes, setRevMes] = useState(0);
  // C9 · Formulas propias convertidas a metodos (ver cargarFormulasComoMetodos).
  const [metodosFormula, setMetodosFormula] = useState<Record<string, Metodo>>({});
  const [publicando, setPublicando] = useState(false);

  // Presupuesto del periodo (para Comparar, CP-45) y traza «¿Por qué?» (CP-35).
  const [presupuesto, setPresupuesto] = useState<PresupuestoFila[]>([]);
  // Detalle por cuenta del mes: cuentas que ofrece «+ Agregar regla».
  const [detalleCuenta, setDetalleCuenta] = useState<FilaHistoricoCuenta[]>([]);
  // P12 · El catálogo, para que el checklist pueda validar las Combinadas.
  const [catalogo, setCatalogo] = useState<FilaDimCuenta[]>([]);
  // Alertas de revisión del catálogo del periodo (CP-34, pestaña Alertas).
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  // Actualización programada (CP-56, pestaña Parámetros) y última publicación.
  const [programacion, setProgramacion] = useState<Programacion>(() => ({ ...PROGRAMACION_DEFAULT }));
  const [ultimaPublicacion, setUltimaPublicacion] = useState<Corrida | null>(null);
  const [traza, setTraza] = useState<Traza | null>(null);
  // Empresas cuya prueba contable CP-47 no cuadra (gobierna la publicación).
  const [pruebaMalasCP47, setPruebaMalasCP47] = useState<string[]>([]);

  const kk = (empresa: string, concepto: string) => empresa + '|' + concepto;

  /**
   * C11 · Clave UNICA de una regla base.
   *
   * Antes se usaba `empresa|concepto`, que NO es unica: un concepto puede tener
   * su regla principal mas reglas adicionales (CP-22). Las dos compartian clave,
   * asi que editar o eliminar la adicional arrastraba a la del concepto, y al
   * reves. Ahora manda el `id` de la base; sin id (reglas de la semilla, que
   * solo viven en pantalla) se usa la posicion, que dentro de una misma carga
   * tambien es unica.
   *
   * Los componentes tratan `key` como identificador opaco: no lo parsean.
   */
  const claveDe = (r: { id?: number }, i: number) => (r.id != null ? 'b' + r.id : 'i' + i);

  // ── Métodos efectivos (fábrica + propios − borrados) ──
  const metodos = useMemo<Record<string, Metodo>>(() => {
    // C9 · Las formulas propias entran como metodos mas (`f<id>`), para que una
    // regla con `formula_id` las pueda usar. Van las ultimas, pero no colisionan
    // con nada: ningun metodo de fabrica empieza por 'f' seguido de digitos.
    const m: Record<string, Metodo> = { ...data.metodos, ...metodosUser, ...metodosFormula };
    metBorrados.forEach((k) => delete m[k]);
    return m;
  }, [data.metodos, metodosUser, metBorrados, metodosFormula]);

  // Presupuesto del mes por empresa|concepto (lo usa el método «presupuesto»).
  const pptoPorConcepto = useMemo(() => {
    const m = new Map<string, number>();
    presupuesto.forEach((p) => m.set(kk(p.empresa, p.concepto), p.presupuesto));
    return m;
  }, [presupuesto]);

  // ── Lista de reglas de trabajo (base con overrides + nuevas) ──
  const reglas = useMemo<Regla[]>(() => {
    const ensambladas = ensamblarReglas(data.reglasBase, data.series);
    const out: Regla[] = [];
    ensambladas.forEach((r, i) => {
      const clave = claveDe(data.reglasBase[i] ?? {}, i);
      const o = overrides[clave] || {};
      // Borrada en pantalla, o borrada en la base y no restaurada (CP-31).
      if (o.borrada ?? data.reglasBase[i]?.eliminada) return;
      out.push({
        ...r,
        key: clave,
        metodo: o.metodo || r.metodo,
        valor: o.valor !== undefined ? o.valor : r.valor,
        n: o.n !== undefined ? o.n : r.n,
        nombre: o.nombre !== undefined ? o.nombre : (r.nombre ?? null),
        detalle: o.detalle !== undefined ? o.detalle : (r.detalle ?? null),
        causado: o.causado ?? r.causado,
        escenarios: o.escenarios ?? r.escenarios,
        cuenta: o.cuenta ?? r.cuenta,
        cc: o.cc ?? r.cc,
        combinada: o.combinada ?? r.combinada,
        presupuesto: pptoPorConcepto.get(kk(r.empresa, r.concepto)) ?? null,
      });
    });
    nuevas.forEach((x, i) => {
      if (x.borrada) return; // P6 · borrada logicamente: fuera del calculo
      const sc = data.series[kk(x.empresa, x.concepto)] || { a: 0, s: [] };
      out.push({
        key: 'n' + i,
        empresa: x.empresa,
        concepto: x.concepto,
        grupo: x.grupo,
        metodo: x.metodo,
        valor: x.valor ?? null,
        n: x.n ?? null,
        combinada: x.combinada,
        cc: x.cc,
        cuenta: x.cuenta,
        pais: PAIS[x.empresa] || x.empresa,
        tasaMensual: x.tasaMensual,
        serie: (sc.s || []).map((v) => (v == null ? NaN : v)),
        acum: sc.a || 0,
        nueva: true,
        nombre: x.nombre ?? null,
        detalle: x.detalle ?? null,
        nivel: x.nivel,
        causado: x.causado,
        escenarios: x.escenarios,
        presupuesto: pptoPorConcepto.get(kk(x.empresa, x.concepto)) ?? null,
      });
    });

    // ── C1 · Cada cuenta con SU historia, y el concepto estima «el resto» ──
    //
    // El defecto: una regla de nivel 'cuenta' recibía `data.series[empresa|
    // concepto]`, es decir la historia del CONCEPTO ENTERO. Abrir Gastos Varios
    // de Beval en 5 cuentas con «Lo típico» daba 74.414 en CADA cuenta —el
    // concepto completo, cinco veces— y el concepto seguía estimando sus 74.414
    // encima. El Semi Neto de Beval pasaba de 45.934 a −326.135.
    //
    // La corrección es la que ya estaba diseñada en destino.ts (CP-21) y nunca
    // se conectó: cada cuenta usa su propia serie de `gyp_historico_cuenta`, y
    // el concepto estima `concepto − Σ cuentas con regla propia`, de modo que
    // «reglas por cuenta + resto» vuelve a sumar el total del concepto.
    //
    // Las reglas ADICIONALES (CP-22) no entran aquí: se suman al concepto y no
    // descuentan historia. `insumosDelRestoDeReglas` ya las distingue por nivel.
    // La lógica vive en `aplicarHistoriaPorCuenta` (destino.ts), fuera del
    // componente, para que se pueda probar sola: aquí dentro no habría forma de
    // cubrirla con un test (el proyecto no tiene montaje de componentes).
    const historia = new Map<string, HistoriaDeCuenta>();
    detalleCuenta.forEach((f) => {
      historia.set(f.combinada, {
        combinada: f.combinada,
        serie: (f.meses ?? []).map((v) => (v == null ? NaN : v)),
        acum: f.acumulado ?? 0,
      });
    });
    aplicarHistoriaPorCuenta(out, historia, (r) => metodos[r.metodo]?.op ?? 'promedio');

    return out;
  }, [data.reglasBase, data.series, overrides, nuevas, pptoPorConcepto, detalleCuenta, metodos]);

  // ── C3 · Datos del corte para el causado por días calendario (§E) ──
  //
  // Sin ellos, `llevarACausado` devuelve el proyectado SIN prorratear: Gastos
  // Varios de Beval con «Lo típico» al 7-oct causaba 85.224 en vez de
  // 85.224 × 7 ÷ 31 = 19.244. El motor ya los aceptaba; la pantalla no los
  // pasaba, así que el modo 'calendario' caía siempre a su respaldo.
  //
  // `datosDelCorte` vive en salida.ts y lo comparten esta pantalla y la corrida
  // programada: si cada una lo calculara por su lado, la publicación manual y la
  // programada acabarían dando causados distintos.
  const { diaDelCorte, diasDelMes } = useMemo(
    () => datosDelCorte(data.periodo, data.corte),
    [data.corte, data.periodo],
  );

  // ── P1 · Tarjetas de «Sobre qué mes trabajas» ──
  //
  // Una por mes CON DATOS, de la más reciente a la más antigua. Antes la lista
  // llegaba vacía y el componente caía a mostrar solo el mes vigente, con el
  // aviso «la lista completa se tomará de gyp_historico_mensual»: la promesa
  // estaba escrita en pantalla y nadie la había conectado.
  //
  // Los días hábiles y el corte solo se conocen del mes vigente (vienen de
  // `proyeccion_parametro`, que guarda un único periodo); los demás meses se
  // muestran como terminados, que es lo que son.
  const mesesParaElegir = useMemo<EstadoMes[]>(() => {
    const diasV = EMPRESAS.map((e) => params[e]?.dias).find((d) => d != null) ?? null;
    const transV = EMPRESAS.map((e) => params[e]?.trans).find((t) => t != null) ?? null;
    const conDatos = new Set(mesesConDatos);
    // Solo el mes en curso y el anterior (mas el fijado, si quedo fuera). La
    // lista NO sale de los meses con datos: `gyp_historico_mensual` guarda diez
    // meses y ofrecerlos todos invita a trabajar sobre un mes que no tiene ni
    // reglas ni tasa.
    return mesesSeleccionables(hoyISO(), data.periodo).map((m) => {
      if (m === data.periodo) {
        return estadoDelPeriodo(m, data.corte, data.fuente, diasV, transV);
      }
      // Un mes solo esta listo si tiene reglas Y parametros. Con historia pero
      // sin ellos se muestra como «todavia sin datos», que es la verdad: no se
      // puede proyectar ni publicar.
      // Un mes solo esta listo si tiene reglas Y parametros.
      const prep = mesesPreparados.get(m);
      if (!conDatos.has(m) || !prep) {
        return { periodo: m, corte: null, fase: 'sin_datos' as const };
      }
      // Con su corte real se describe igual que el mes vigente: un mes cerrado
      // sale «mes completo · datos al 30 sep». Antes se pasaba `corte: null` y
      // `fraseEstadoMes` leia eso como «todavia sin datos» aunque la fase dijera
      // lo contrario, asi que un mes preparado se veia como vacio.
      return estadoDelPeriodo(m, prep.corte, 'db', prep.diasHabiles, prep.transcurridos);
    });
  }, [mesesConDatos, mesesPreparados, data.periodo, data.corte, data.fuente, params]);

  // ── Cálculo de los DOS escenarios (§H). La cabecera de KPIs necesita ambos. ──
  const escenarios = useMemo(
    () =>
      calcularEscenarios({
        reglas,
        metodos,
        params,
        empresas: EMPRESAS,
        gn,
        diaDelCorte,
        diasDelMes,
      }),
    [reglas, metodos, params, gn, diaDelCorte, diasDelMes],
  );
  const { proyeccion, causado } = escenarios;
  const val = proyeccion.val;
  const agg = proyeccion.agg;

  // Semi Neto por empresa (proyectado y causado) para «Así quedaría» (CP-26).
  const semiNeto = useMemo(() => {
    const out: Record<string, { proy: number; caus: number }> = {};
    EMPRESAS.forEach((e) => {
      out[e] = { proy: proyeccion.agg[e]?.sn ?? 0, caus: causado.agg[e]?.sn ?? 0 };
    });
    return out;
  }, [proyeccion.agg, causado.agg]);

  // «Así quedaría» (CP-26): corre el motor completo con UNA regla cambiada según
  // el borrador del panel, sin guardar nada. Así el impacto incluye lo que
  // arrastra la regla (Renta Bruta, Semi Neto, % sobre otros conceptos).
  const simularRegla = useCallback(
    (key: string, cambios: Partial<Override>) => {
      const definidos = Object.fromEntries(
        Object.entries(cambios).filter(([, v]) => v !== undefined),
      ) as Partial<Regla>;
      const rs = reglas.map((r) => (r.key === key ? { ...r, ...definidos } : r));
      const i = rs.findIndex((r) => r.key === key);
      if (i < 0) return null;
      const esc = calcularEscenarios({
        reglas: rs,
        metodos,
        params,
        empresas: EMPRESAS,
        gn,
        diaDelCorte,
        diasDelMes,
      });
      const emp = rs[i].empresa;
      return {
        proy: esc.proyeccion.val[i] ?? 0,
        caus: esc.causado.val[i] ?? 0,
        snProy: esc.proyeccion.agg[emp]?.sn ?? 0,
        snCaus: esc.causado.agg[emp]?.sn ?? 0,
      };
    },
    [reglas, metodos, params, gn, diaDelCorte, diasDelMes],
  );

  // Reglas eliminadas (borrado lógico) para el pie con «Restaurar» (CP-31).
  const eliminadas = useMemo(() => {
    const base = ensamblarReglas(data.reglasBase, data.series);
    const borradas = new Set(Object.keys(overrides).filter((k) => overrides[k]?.borrada));
    // Las borradas en la base siguen en el pie hasta que se restauren.
    data.reglasBase.forEach((r, i) => {
      const k = claveDe(r, i);
      if (r.eliminada && overrides[k]?.borrada !== false) borradas.add(k);
    });
    // P6 · Las reglas NUEVAS borradas tambien van al pie con «Restaurar».
    const deNuevas = nuevas
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.borrada)
      .map(({ x, i }) => ({
        key: 'n' + i,
        empresa: x.empresa,
        concepto: x.concepto,
        combinada: x.combinada,
      }));

    const indiceDe = new Map<string, number>();
    data.reglasBase.forEach((r, i) => indiceDe.set(claveDe(r, i), i));
    return [...deNuevas, ...[...borradas].map((k) => {
      const i = indiceDe.get(k);
      const r = i === undefined ? undefined : base[i];
      return {
        key: k,
        empresa: r?.empresa ?? '',
        concepto: r?.concepto ?? '',
        combinada: r?.combinada ?? k,
      };
    })];
  }, [overrides, data.reglasBase, data.series, nuevas]);

  const tot = useCallback(
    (k: keyof AgregadoEmpresa) => EMPRESAS.reduce((a, e) => a + (agg[e]?.[k] || 0), 0),
    [agg],
  );

  // ── Carga desde Supabase. Si es manual, primero dispara la extracción de
  //    Fabric (Edge Function refrescar-proyeccion-fabric) y luego recarga lo que
  //    quedó en Supabase. ──
/**
   * Recarga el NUCLEO de datos de un periodo: acumulado, serie, corte y
   * parametros (tasa, dias habiles, factor).
   *
   * Existe aparte de `traer` porque `traer` saca el mes de
   * `proyeccion_config`, y al elegir un mes hay que cargar EL QUE SE ELIGIO,
   * sin esperar a que se guarde en la base ni arriesgarse a leer el anterior.
   */
  const recargarPeriodo = useCallback(
    async (periodo: string) => {
      const seed = construirDesdeSemilla();
      seed.periodo = periodo;
      try {
        const nuevo = await cargarDesdeSupabase(periodo, seed);
        setData(nuevo);
        setParams(nuevo.params);
        return nuevo;
      } catch {
        setData((d) => ({ ...d, periodo }));
        addToast('error', `No hay extraccion de ${periodo} en la base.`);
        return null;
      }
    },
    [addToast],
  );

  const traer = useCallback(
    async (manual: boolean) => {
      const seed = construirDesdeSemilla();

      // P1 · El mes de trabajo sale de la configuración COMPARTIDA, no del
      // calendario ni de la constante de la semilla. Si la tabla todavía no
      // existe, se conserva el de la semilla y la pantalla sigue funcionando.
      const guardado = await leerMesDeTrabajo();
      if (guardado) {
        seed.periodo = guardado.periodo;
        setRevMes(guardado.rev);
      }
      // Meses que de verdad tienen datos, para las tarjetas de «Sobre qué mes
      // trabajas». Degrada a lista vacía: el componente cae a mostrar solo el
      // mes vigente, que es lo que hacía antes.
      cargarMesesConDatos().then(setMesesConDatos).catch(() => setMesesConDatos([]));
      cargarMesesPreparados()
        .then(setMesesPreparados)
        .catch(() => setMesesPreparados(new Map()));
      // C9 · Las formulas propias entran como metodos mas, para que una regla
      // con `formula_id` las pueda usar. Sin esto nunca llegaban al motor.
      cargarFormulasComoMetodos().then(setMetodosFormula).catch(() => setMetodosFormula({}));

      // Paso 1 (solo manual): pedirle al backend que consulte Fabric y escriba.
      if (manual) {
        try {
          const r = await refrescarDesdeFabric(seed.periodo);
          if (!r.escrito) {
            const motivo = (r.errores && r.errores[0]) || r.error || 'guardas no superadas';
            addToast('error', `Fabric no actualizó: ${motivo}. Se conservan los últimos datos buenos.`);
          } else {
            addToast('success', `Fabric extraído: ${r.conceptos ?? '—'} conceptos, datos al ${r.corte || '—'}.`);
          }
        } catch (err) {
          addToast('error', 'No se pudo consultar Fabric: ' + (err as Error).message);
        }
      }

      // Paso 2: recargar desde Supabase (haya o no corrido Fabric).
      try {
        const nuevo = await cargarDesdeSupabase(seed.periodo, seed);
        setData(nuevo);
        setParams(nuevo.params);
        // C10: las reglas nuevas que YA se guardaron (tienen id) vuelven dentro
        // de `nuevo.reglasBase`. Si siguieran tambien en `nuevas`, cada una
        // apareceria DOS veces: en los KPIs y en lo publicado. Se conservan solo
        // las que no llegaron a persistirse, para no perder trabajo del usuario.
        setNuevas((prev) => prev.filter((x) => x.id == null));
        if (manual)
          addToast(
            'success',
            `Pantalla actualizada — datos al ${nuevo.corte || '—'}. 6 empresas y ${nuevo.reglasBase.length} reglas recalculadas.`,
          );
      } catch {
        setData((d) => ({ ...d, fuente: manual ? 'error' : d.fuente }));
        if (manual)
          addToast('error', 'No hay extracción en la base. Se mantiene la foto embebida validada.');
      }
    },
    [addToast],
  );

  useEffect(() => {
    traer(false);
  }, [traer]);

  /**
   * P9 · Cambios de otras personas, en vivo.
   *
   * `suscribirCambios` estaba escrita y documentada (CP-54) y no la llamaba
   * nadie: había que recargar la página para ver lo que otro acababa de
   * guardar. Dos personas trabajando el mismo mes se pisaban sin enterarse.
   *
   * El eco propio se ignora (`esEcoPropio`): el cambio ya se aplicó local y
   * recargar por él provocaría un parpadeo en cada tecla.
   */
  useEffect(() => {
    const cortar = suscribirCambios(data.periodo, {
      onCualquiera: (c) => {
        if (c.esEcoPropio) return;
        traer(false);
        addToast('info', 'Otra persona cambió algo de este mes: pantalla actualizada.');
      },
    });
    return cortar;
  }, [data.periodo, traer, addToast]);

  // ── Carga del detalle del periodo (presupuesto para Comparar, CP-45). Degrada
  //    en silencio si no hay detalle en la base: Comparar muestra el presupuesto
  //    como «—». ──
  useEffect(() => {
    let vivo = true;
    cargarDatosDetalle(data.periodo)
      .then((d) => {
        if (vivo) {
          setPresupuesto(d.presupuesto);
          setAlertas(d.alertas);
          setDetalleCuenta(d.historicoCuenta);
          setCatalogo(d.catalogo);
        }
      })
      .catch(() => {
        if (vivo) {
          setPresupuesto([]);
          setAlertas([]);
          setDetalleCuenta([]);
          setCatalogo([]);
        }
      });
    return () => {
      vivo = false;
    };
  }, [data.periodo]);

  // ── Actualización programada (CP-56, Req 27.1 / 27.9). Lee la configuración
  //    (`proyeccion_programacion`) y la última publicación con éxito del periodo
  //    (`proyeccion_corrida`). Degrada a los valores por defecto si la base no
  //    responde: la UI muestra pausada/07:30 Caracas y «sin publicaciones». ──
  useEffect(() => {
    let vivo = true;
    cargarProgramacion()
      .then((p) => {
        if (vivo) setProgramacion(p);
      })
      .catch(() => {
        if (vivo) setProgramacion({ ...PROGRAMACION_DEFAULT });
      });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    cargarUltimaPublicacion(data.periodo)
      .then((c) => {
        if (vivo) setUltimaPublicacion(c);
      })
      .catch(() => {
        if (vivo) setUltimaPublicacion(null);
      });
    return () => {
      vivo = false;
    };
  }, [data.periodo]);

  // ── Mutadores de reglas ──
  // Aplica un conjunto de cambios a una regla. Las reglas nuevas (`n<i>`) viven
  // en `nuevas`; el resto se sobrescribe vía `overrides`. Un campo en `undefined`
  // vuelve la regla a su estado de partida (botón «Volver a como estaba»).
  const mod = (key: string, cambios: Partial<Override>) => {
    if (/^n\d+$/.test(key)) {
      const i = +key.slice(1);
      setNuevas((prev) => prev.map((x, j) => (j === i ? { ...x, ...limpiar(cambios) } : x)));
    } else {
      setOverrides((prev) => {
        const siguiente = { ...prev[key] };
        (Object.keys(cambios) as (keyof Override)[]).forEach((campo) => {
          const v = cambios[campo];
          if (v === undefined) delete siguiente[campo];
          else (siguiente as Record<string, unknown>)[campo] = v;
        });
        return { ...prev, [key]: siguiente };
      });
    }
  };
  // Para una regla nueva, `undefined` no borra nada: solo se aplican los campos definidos.
  const limpiar = (c: Partial<Override>): Partial<NuevaRegla> => {
    const out: Record<string, unknown> = {};
    (Object.keys(c) as (keyof Override)[]).forEach((k) => {
      if (c[k] !== undefined && k !== 'borrada') out[k] = c[k];
    });
    return out as Partial<NuevaRegla>;
  };
  // ── Persistencia de reglas (CP-37/38): cada cambio se escribe en
  //    proyeccion_regla con bloqueo optimista por `rev`. Las reglas de la semilla
  //    (sin `id`) solo cambian en pantalla. ──
  const baseDe = (key: string) => data.reglasBase.find((r, i) => claveDe(r, i) === key);

  const fijarRev = (id: number, rev: number | undefined) => {
    if (rev === undefined) return;
    setData((d) => ({ ...d, reglasBase: d.reglasBase.map((r) => (r.id === id ? { ...r, rev } : r)) }));
    setNuevas((prev) => prev.map((x) => (x.id === id ? { ...x, rev } : x)));
  };

  const avisarEscritura = (r: { ok: boolean; motivo?: string; error?: unknown }, que: string) => {
    if (r.ok) return;
    if (r.motivo === 'conflicto') {
      addToast('error', `Otra persona cambió ${que} antes. Se recargaron las reglas; revisa y vuelve a guardar.`);
      traer(false);
    } else {
      addToast(
        'error',
        `No se pudo guardar ${que} en la base (${motivoError(r.error)}); el cambio queda solo en pantalla.`,
      );
    }
  };

  // `proyeccion_regla.metodo` referencia `proyeccion_metodo`: un método que aún
  // no está en la base (de la semilla o creado en pantalla) se sube antes.
  const asegurarMetodo = async (id: string | undefined) => {
    if (!id || (data.metodosEnBase ?? []).includes(id) || !metodos[id]) return;
    const r = await guardarMetodo(metodos[id]);
    if (r.ok) setData((d) => ({ ...d, metodosEnBase: [...(d.metodosEnBase ?? []), id] }));
  };

  const persistirRegla = async (id: number, rev: number, cambios: CambiosRegla, que: string) => {
    await asegurarMetodo(cambios.metodo);
    const r = await actualizarRegla(id, rev, cambios);
    avisarEscritura(r, que);
    if (r.ok) fijarRev(id, r.rev);
  };

  /** Valores efectivos (base + override) de una regla, listos para la base. */
  const efectivos = (b: ReglaBase, o: Override): CambiosRegla => ({
    metodo: o.metodo ?? b.metodo,
    valor: o.valor !== undefined ? o.valor : b.valor,
    n: o.n !== undefined ? o.n : (b.n ?? null),
    nombre: o.nombre !== undefined ? o.nombre : (b.nombre ?? null),
    detalle: o.detalle !== undefined ? o.detalle : (b.detalle ?? null),
    causado: o.causado ?? b.causado ?? 'igual',
    escenarios: o.escenarios ?? b.escenarios ?? 'AMBOS',
    combinada: o.combinada ?? b.combinada,
    centro_costo: o.cc ?? b.cc,
    cuenta_contable: o.cuenta ?? b.cuenta,
  });

  const guardarRegla = (key: string, cambios: Partial<Override>) => {
    mod(key, cambios);
    const que = 'la regla';
    if (/^n\d+$/.test(key)) {
      const x = nuevas[+key.slice(1)];
      if (x?.id != null) {
        const fusion = { ...x, ...limpiar(cambios) } as NuevaRegla;
        persistirRegla(x.id, x.rev ?? 0, efectivos(fusion, {}), que);
      }
      return;
    }
    const b = baseDe(key);
    if (b?.id == null) return;
    const o: Override = { ...overrides[key] };
    (Object.keys(cambios) as (keyof Override)[]).forEach((campo) => {
      if (cambios[campo] === undefined) delete o[campo];
      else (o as Record<string, unknown>)[campo] = cambios[campo];
    });
    persistirRegla(b.id, b.rev ?? 0, efectivos(b, o), que);
  };

  const eliminarRegla = (key: string) => {
    if (/^n\d+$/.test(key)) {
      const i = +key.slice(1);
      const x = nuevas[i];
      // P6 · Borrado LOGICO: se marca, no se quita. Asi aparece en el pie con
      // «Restaurar», igual que las de la base. Antes se perdia para siempre.
      setNuevas((prev) => prev.map((y, j) => (j === i ? { ...y, borrada: true } : y)));
      if (x?.id != null) eliminarReglaDb(x.id, x.rev ?? 0).then((r) => avisarEscritura(r, 'la regla'));
    } else {
      setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], borrada: true } }));
      const b = baseDe(key);
      if (b?.id != null)
        eliminarReglaDb(b.id, b.rev ?? 0).then((r) => {
          avisarEscritura(r, 'la regla');
          if (r.ok) fijarRev(b.id!, r.rev);
        });
    }
  };
  const restaurarRegla = (key: string) => {
    if (/^n\d+$/.test(key)) {
      const i = +key.slice(1);
      setNuevas((prev) => prev.map((y, j) => (j === i ? { ...y, borrada: false } : y)));
      return;
    }
    setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], borrada: false } }));
    const b = baseDe(key);
    if (b?.id != null)
      restaurarReglaDb(b.id, b.rev ?? 0).then((r) => {
        avisarEscritura(r, 'la regla');
        if (r.ok) fijarRev(b.id!, r.rev);
      });
  };

  /**
   * P7 · Restablecer descarta TODO el trabajo guardado y vuelve a la semilla.
   *
   * Antes lo hacía sin preguntar y el aviso decía «al estado validado por
   * control», que es engañoso: la semilla es la foto del 7-oct, no lo que esté
   * validado hoy. Alguien que leyera ese texto podía pulsarlo creyendo que
   * recuperaba algo bueno, y perdía su trabajo del mes.
   *
   * Ahora pide confirmación DOS veces —la segunda dice exactamente qué se
   * pierde— y el aviso ya no promete validación.
   */
  const restablecer = () => {
    if (!window.confirm(
      'Restablecer descarta TODAS las reglas, métodos y parámetros de esta ' +
      'pantalla y vuelve a la foto de partida. ¿Seguro?',
    )) return;
    if (!window.confirm(
      'Última comprobación: se perderá el trabajo del mes que no esté ' +
      'publicado. ¿Restablecer de todos modos?',
    )) return;

    const seed = construirDesdeSemilla();
    setData(seed);
    setParams(seed.params);
    setMetodosUser({});
    setMetBorrados([]);
    setOverrides({});
    setNuevas([]);
    setGn(9);
    addToast('info', 'Se restableció todo a la foto de partida (semilla del 7-oct).');
  };

  // La creación y el borrado de métodos vivían en la tabla editable de Reglas,
  // retirada en 16.2 (CP-24: la fila ya no se edita). El panel por regla elige
  // entre los métodos existentes; crear fórmulas propias es tarea de «Mis
  // fórmulas». `metodosUser`/`metBorrados` se conservan para superponer y
  // restablecer el juego de métodos.

  // Las reglas nuevas se crean también en la base (si hay datos de Supabase);
  // así sobreviven a la recarga y la corrida programada las usa.
  const crearNuevas = (nuevasReglas: NuevaRegla[]) => {
    setNuevas((prev) => [...prev, ...nuevasReglas]);
    if (data.fuente !== 'db') return;
    nuevasReglas.forEach(async (x) => {
      await asegurarMetodo(x.metodo);
      return crearRegla({
        periodo: data.periodo,
        empresa: x.empresa,
        concepto: x.concepto,
        grupo_pl: x.grupo,
        combinada: x.combinada,
        centro_costo: x.cc,
        cuenta_contable: x.cuenta,
        metodo: x.metodo,
        valor: x.valor ?? null,
        nombre: x.nombre ?? null,
        detalle: x.detalle ?? null,
        causado: x.causado,
        escenarios: x.escenarios,
        nivel: x.nivel,
        n: x.n ?? null,
      }).then((r) => {
        if (r.ok && r.id != null) {
          setNuevas((prev) => prev.map((y) => (y === x ? { ...y, id: r.id, rev: r.rev ?? 0 } : y)));
        } else {
          addToast(
            'error',
            `No se pudo guardar en la base la regla nueva ${x.empresa} · ${x.concepto}: ${motivoError(r.error)}. ` +
              'Queda solo en pantalla y se pierde al recargar.',
          );
        }
      });
    });
  };

  // Editar un método del sistema desde «Mis fórmulas»: se aplica de inmediato al
  // cálculo (vía `metodosUser`) y se persiste en `proyeccion_metodo`.
  const editarMetodo = (m: Metodo) => {
    setMetodosUser((prev) => ({ ...prev, [m.id]: m }));
    guardarMetodo(m).then((r) => {
      if (r.ok)
        setData((d) =>
          (d.metodosEnBase ?? []).includes(m.id)
            ? d
            : { ...d, metodosEnBase: [...(d.metodosEnBase ?? []), m.id] },
        );
      addToast(
        r.ok ? 'success' : 'error',
        r.ok
          ? `Método «${m.nombre}» guardado.`
          : `Método «${m.nombre}» aplicado en pantalla, pero no se pudo guardar en la base.`,
      );
    });
  };

  // ── Mes de trabajo (CP-33) ──
  // Elegir un mes lo fija para todos y limpia el detalle por cuenta, los repartos
  // y el presupuesto del anterior; los conceptos sin movimiento quedan en cero.
  // La recarga por `data.periodo` (useEffect del presupuesto) y `traer` repoblará
  // el detalle del nuevo mes; aquí se limpia el estado del mes previo.
  const elegirMes = useCallback(
    (nuevoPeriodo: string) => {
      if (nuevoPeriodo === data.periodo) return;
      setPresupuesto([]);
      setOverrides({});
      setNuevas([]);
      // Cambiar de mes NO era solo cambiar la etiqueta: el acumulado, la serie,
      // el corte y los parametros son POR PERIODO. Antes solo se hacia
      // `setData({...d, periodo})`, asi que la pantalla decia «mes de trabajo
      // 2026-09» mientras seguia proyectando con el acumulado de octubre: el
      // proyectado no se movia ni un dolar y el causado cambiaba un poco, solo
      // porque el prorrateo mira los dias del mes nuevo. Nada fallaba.
      setData((d) => ({ ...d, periodo: nuevoPeriodo }));
      recargarPeriodo(nuevoPeriodo);

      // P1 · Se GUARDA de verdad. Antes esto solo hacía `setData`: el aviso
      // decía «para todos» y al recargar volvía atrás. Si la tabla de
      // configuración todavía no existe, el cambio vale para esta sesión y se
      // dice claramente, en vez de prometer algo que no pasó.
      // Un mes sin reglas no se puede proyectar: saldria la pantalla vacia y
      // sin explicacion. En vez de eso se arrastran las del mes vigente, que es
      // el criterio acordado — el mes nuevo arranca con lo mismo que el anterior
      // y se cambia solo lo que haga falta.
      //
      // Es explicito y queda registrado quien lo hizo: las reglas no aparecen
      // solas. `clonar_reglas` no pisa nada, asi que repetirlo no borra ajustes.
      if (!mesesPreparados.has(nuevoPeriodo)) {
        const anterior = data.periodo;
        clonarReglas(anterior, nuevoPeriodo).then((r) => {
          if (!r.ok) {
            addToast('error', `No se pudieron arrastrar las reglas a ${nuevoPeriodo}: ${r.motivo}`);
            return;
          }
          if (r.copiadas > 0) {
            addToast('info', `${nuevoPeriodo} arranca con las ${r.copiadas} reglas de ${anterior}.`);
            // Ya tiene reglas; el corte y los dias llegan en la proxima carga.
            setMesesPreparados((p) =>
              new Map(p).set(nuevoPeriodo, {
                periodo: nuevoPeriodo, corte: null, diasHabiles: null, transcurridos: null,
              }),
            );
          }
        });
      }

      guardarMesDeTrabajo(nuevoPeriodo, revMes).then((r) => {
        if (r.ok) {
          setRevMes(r.rev ?? revMes + 1);
          addToast('info', `Mes de trabajo fijado en ${nuevoPeriodo} para todos.`);
        } else if (r.motivo === 'conflicto') {
          addToast('error', 'Otra persona cambió el mes de trabajo. Actualiza para ver el suyo.');
        } else {
          addToast('info', `Mes cambiado a ${nuevoPeriodo} solo en esta pantalla (no se pudo guardar).`);
        }
      });
    },
    [data.periodo, addToast, revMes, mesesPreparados, recargarPeriodo],
  );

  // El factor se guarda POR MES (CP-33 / CP-37). Actualiza el estado local y lo
  // persiste vía `guardarFactorMes(periodo, empresa, factor)`.
  // P2 · Guarda dias, transcurridos y tasa del mes. El factor va aparte
  // (`factorMes`): lo fija control y no debe pisarse desde aqui.
  const parametroMes = useCallback(
    (empresa: string, campos: { dias?: number; trans?: number; tasa?: number | null }) => {
      setParams((prev) => ({ ...prev, [empresa]: { ...prev[empresa], ...campos } }));
      guardarParametroMes(data.periodo, empresa, campos).then((r) => {
        if (!r.ok) addToast('error', `No se pudieron guardar los parametros de ${empresa}.`);
      });
    },
    [data.periodo, addToast],
  );

  const factorMes = useCallback(
    (empresa: string, factor: number) => {
      setParams((prev) => ({ ...prev, [empresa]: { ...prev[empresa], factor } }));
      guardarFactorMes(data.periodo, empresa, factor).then((r) => {
        if (!r.ok) addToast('error', `No se pudo guardar el factor de ${empresa} para el mes.`);
      });
    },
    [data.periodo, addToast],
  );

  // La programación se guarda con bloqueo optimista por `rev` (CP-38). Aplica el
  // cambio al estado local de inmediato (optimista) y persiste; ante conflicto
  // recarga la fila de la base y avisa, sin pisar el cambio ajeno.
  const guardarProg = useCallback(
    (cambios: CambiosProgramacion) => {
      const revActual = programacion.rev;
      setProgramacion((prev) => ({
        ...prev,
        ...(cambios.activa !== undefined && { activa: cambios.activa }),
        ...(cambios.frecuencia !== undefined && { frecuencia: cambios.frecuencia }),
        ...(cambios.diaSemana !== undefined && { diaSemana: cambios.diaSemana }),
        ...(cambios.horaLocal !== undefined && { horaLocal: cambios.horaLocal }),
        ...(cambios.exigeDatosFrescos !== undefined && { exigeDatosFrescos: cambios.exigeDatosFrescos }),
        ...(cambios.periodo !== undefined && { periodo: cambios.periodo }),
      }));
      guardarProgramacion(revActual, cambios).then((r) => {
        if (r.ok) {
          if (r.rev !== undefined) setProgramacion((prev) => ({ ...prev, rev: r.rev! }));
        } else if (r.motivo === 'conflicto') {
          addToast('error', 'Otra persona cambió la programación. Se recargó la configuración.');
          cargarProgramacion().then((p) => setProgramacion(p)).catch(() => undefined);
        } else {
          addToast('error', 'No se pudo guardar la actualización programada.');
        }
      });
    },
    [programacion.rev, addToast],
  );

  // ── Publicar resultado a Supabase ──
  // `soloCausado` ANEXA el escenario 2 a v_proyeccion_final: la Edge Function
  // reemplaza solo (periodo, escenario = 2) y deja intacto el proyectado.
  const publicar = async (soloCausado = false) => {
    // P12 · La prueba contable se calcula AQUI, no en la pestaña Resultado.
    //
    // Antes `pruebaMalasCP47` solo se llenaba cuando esa pestaña estaba montada:
    // publicar sin haberla abierto saltaba el control por completo. Un control
    // que depende de qué pestaña miraste no es un control.
    const desglosesAhora = desglosarRentaBrutaTodas(EMPRESAS, reglas, val, agg);
    const malas = desglosesAhora.filter((d) => !d.cuadra).map((d) => d.empresa);
    if (malas.length) {
      addToast(
        'error',
        `No se publica: la prueba contable de la Renta Bruta no cuadra en ${malas.join(', ')}.`,
      );
      return;
    }

    // P12 · Y el CHECKLIST de publicación (CP-44), que estaba escrito y no se
    // usaba en ningún sitio. Comprueba las llaves, el catálogo, la FECHA, el
    // país, la tasa, los duplicados y el cuadre reglas+resto sobre las filas
    // REALES que se van a publicar.
    try {
      const todas = construirFilasEscenarios(data.periodo, {
        reglas, metodos, params, empresas: EMPRESAS, gn, diaDelCorte, diasDelMes,
      });
      const chk = checklistPublicacion(
        ([1, 2] as const).map((n) => ({
          proyeccion: n,
          nombre: n === 1 ? 'Proyectado' : 'Causado',
          filas: fusionarPorCombinada(todas.filter((f) => f.proyeccion === n)),
          desgloses: desglosesAhora,
          // PENDIENTE: siempre vacio, asi que la comprobacion 8 del checklist
          // (CP-21: reglas + resto = concepto) no se evalua NUNCA y pasa
          // siempre. No es que cuadre: es que no se mira. Alimentarla con
          // `insumosDelResto` la convertiria en una validacion bloqueante
          // nueva, que es un cambio de comportamiento a decidir aparte.
          cuadres: [],
        })),
        {
          periodo: data.periodo,
          empresas: EMPRESAS,
          // El catálogo sale de dim_cuenta. Vacío = no se puede validar contra
          // él; la comprobación 3 lo dice en vez de marcar todo como huérfano.
          dimCuenta: new Set(catalogo.map((d) => d.combinada)),
        },
      );
      if (!chk.puedePublicar) {
        const fallan = chk.items.filter((i) => !i.ok && i.bloqueante).map((i) => i.titulo);
        addToast('error', `No se publica. Falla el checklist: ${fallan.join(' · ')}`);
        return;
      }
    } catch (e) {
      // D8 puede negarse a construir las filas (sin tasa o sin país). Es
      // exactamente lo que debe impedir publicar, y con su propio mensaje.
      addToast('error', `No se publica: ${(e as Error).message}`);
      return;
    }
    if (
      !window.confirm(
        soloCausado
          ? '¿Agregar el causado (Proyeccion = 2) a v_proyeccion_final para ' +
              data.periodo +
              '? Reemplaza solo el causado anterior del periodo; el proyectado publicado no se toca.'
          : '¿Publicar la proyección a la base? Reemplaza el resultado del periodo ' + data.periodo + '.',
      )
    )
      return;
    setPublicando(true);
    try {
      // CP-49 / FALLO 1: se publican los DOS escenarios (Proyeccion=1 proyectado,
      // Proyeccion=2 causado). `construirFilasEscenarios` (en salida.ts) es la
      // FUENTE ÚNICA que comparten esta publicación manual y la corrida programada
      // server-side, para que ambas produzcan EXACTAMENTE las mismas filas. La
      // Edge Function `publicar-proyeccion` recorre ambos escenarios y hace
      // DELETE+INSERT idempotente por (periodo, escenario).
      const todas: FilaResultado[] = construirFilasEscenarios(data.periodo, {
        reglas,
        metodos,
        params,
        empresas: EMPRESAS,
        gn,
        // C3: sin estos dos, lo PUBLICADO llevaba el causado sin prorratear
        // aunque la pantalla lo mostrara bien. La tabla que va a Power BI y lo
        // que se ve dejaban de coincidir.
        diaDelCorte,
        diasDelMes,
      });
      const filas = soloCausado ? todas.filter((f) => f.proyeccion === 2) : todas;
      const res = await publicarViaEdge(data.periodo, filas, undefined, soloCausado ? [2] : undefined);
      if (res.ok) {
        addToast(
          'success',
          soloCausado
            ? `Causado agregado a v_proyeccion_final: ${res.publicado?.['2'] ?? filas.length} filas con Proyeccion = 2.`
            : `Proyección publicada: ${filas.length} filas (proyectado + causado) en proyeccion_resultado.`,
        );
        if (res.aviso) addToast('info', res.aviso);
      } else if (res.motivo === 'huerfanas') {
        addToast(
          'error',
          `No se publicó: hay Combinadas fuera del catálogo (${(res.huerfanas ?? []).length}). ` +
            `Revisa el catálogo antes de publicar.`,
        );
      } else {
        addToast('error', 'No se pudo publicar: ' + (res.mensaje ?? (res.error ? String(res.error) : 'error del servidor.')));
      }
    } catch (err) {
      addToast('error', 'No se pudo publicar: ' + (err as Error).message);
    } finally {
      setPublicando(false);
    }
  };

  // ── Validaciones (se muestran en la pestaña Reglas) ──
  const avisos = useMemo(() => {
    const av: string[] = [];
    const dup: Record<string, number> = {};
    reglas.forEach((r) => {
      const k = r.empresa + '|' + r.combinada;
      dup[k] = (dup[k] || 0) + 1;
    });
    Object.keys(dup)
      .filter((k) => dup[k] > 1)
      .forEach((k) =>
        av.push(
          `Hay ${dup[k]} reglas activas sobre la cuenta ${k.split('|')[1]}. Ese monto se cuenta dos veces.`,
        ),
      );
    EMPRESAS.forEach((e) => {
      if (
        !reglas.some(
          (r) =>
            r.empresa === e &&
            (r.concepto === 'Ventas' || (metodos[r.metodo] || {}).op === 'derivada'),
        )
      )
        av.push(`${e} se quedó sin regla de ingreso: su venta proyectada es cero.`);
    });
    reglas.forEach((r, i) => {
      if (r.grupo !== 'VENTAS' && val[i] < 0 && (metodos[r.metodo] || {}).op !== 'promedio')
        av.push(
          `${r.empresa} / ${r.concepto} da un gasto negativo (${fmt(val[i])}). Revisa el signo del método.`,
        );
    });
    return av;
  }, [reglas, metodos, val]);

  // La prueba contable de la Renta Bruta (CP-47) la calcula y refina
  // PestanaResultado con la identidad exacta; nos reporta las empresas malas vía
  // `onPruebaMalas` → `pruebaMalasCP47`, que gobierna la publicación (Req 22.3).

  const metodosList = Object.values(metodos);

  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Cabecera fija: título, sello de frescura, Actualizar, KPIs y pestañas */}
      <div className="sticky top-0 z-20 -mx-4 bg-white border-b border-slate-200 px-4 pb-3 pt-2 md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Aplicativo de control
            </p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Proyección del GyP Mayoreo
            </h1>
          </div>
          <span className="ml-auto font-mono text-xs text-slate-500">
            Mes de trabajo {data.periodo} · {reglas.length} reglas · {metodosList.length} métodos
          </span>
          <div className="flex items-center gap-3">
            <SelloFrescura fuente={data.fuente} generado={data.generado} corte={data.corte} />
            <button
              onClick={() => traer(true)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Actualizar
            </button>
          </div>
        </div>

        {/* Franja de KPIs fija (proyectado arriba / causado debajo), independiente de selectores */}
        <KpiHeader aggProyeccion={proyeccion.agg} aggCausado={causado.agg} empresas={EMPRESAS} />

        {/* Pestañas */}
        <nav className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const esAlertas = t.id === 'alertas';
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                  tab === t.id
                    ? 'border-emerald-500 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="mr-1.5 font-mono text-xs text-slate-400">{t.n}</span>
                {t.label}
                {esAlertas && avisos.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">
                    {avisos.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Contenido de la pestaña activa */}
      {tab === 'parametros' && (
        <PestanaParametros
          empresas={EMPRESAS}
          params={params}
          setParams={setParams}
          reglas={reglas}
          metodos={metodos}
          val={val}
          periodo={data.periodo}
          corte={data.corte}
          fuente={data.fuente}
          onElegirMes={elegirMes}
          mesesDisponibles={mesesParaElegir}
          onFactorMes={factorMes}
          onParametroMes={parametroMes}
          programacion={programacion}
          onGuardarProgramacion={guardarProg}
          ultimaPublicacion={ultimaPublicacion}
          generado={data.generado}
        />
      )}

      {tab === 'reglas' && (
        <PestanaReglas
          empresas={EMPRESAS}
          reglas={reglas}
          metodos={metodos}
          series={data.series}
          val={val}
          valCausado={causado.val}
          semiNeto={semiNeto}
          eliminadas={eliminadas}
          onModRegla={guardarRegla}
          onCrearMetodo={editarMetodo}
          onSimular={simularRegla}
          onEliminarRegla={eliminarRegla}
          onRestaurarRegla={restaurarRegla}
          onCrearNuevas={crearNuevas}
          detalleCuenta={detalleCuenta}
          onRestablecer={restablecer}
          onTraza={setTraza}
        />
      )}

      {tab === 'resultado' && (
        <PestanaResultado
          empresas={EMPRESAS}
          agg={agg}
          aggCausado={causado.agg}
          cifrasValidadas={CIFRAS_VALIDADAS}
          tot={tot}
          reglas={reglas}
          val={val}
          metodos={metodos}
          params={params}
          onTraza={setTraza}
          onPruebaMalas={setPruebaMalasCP47}
        />
      )}

      {tab === 'salida' && (
        <PestanaTablaSalida
          reglas={reglas}
          metodos={metodos}
          empresas={EMPRESAS}
          gn={gn}
          diaDelCorte={diaDelCorte}
          diasDelMes={diasDelMes}
          val={val}
          valCausado={causado.val}
          params={params}
          periodo={data.periodo}
          isAdmin={isAdmin}
          publicando={publicando}
          onPublicar={() => publicar(false)}
          onPublicarCausado={() => publicar(true)}
        />
      )}

      {tab === 'comparar' && (
        <PestanaComparar
          empresas={EMPRESAS}
          reglas={reglas}
          valProyeccion={val}
          valCausado={causado.val}
          presupuesto={presupuesto}
          params={params}
          metodos={metodos}
          onTraza={setTraza}
        />
      )}

      {tab === 'alertas' && (
        /* P13 · El contador cuenta ALERTAS del catalogo, no avisos de reglas.
           El `|| avisos.length` hacia que, sin alertas, la pestana mostrara un
           numero que no tenia nada que ver: eran Combinadas duplicadas entre
           reglas, otra cosa distinta. */
        <PestanaAlertas
          contador={alertas.length}
          alertas={alertas}
          periodo={data.periodo}
        />
      )}

      {tab === 'formulas' && (
        <PestanaMisFormulas
          reglas={reglas}
          metodos={metodos}
          ventaPorEmpresa={proyeccion.venta}
          onAviso={addToast}
          onGuardarMetodo={editarMetodo}
        />
      )}

      {/* CP-35 · «¿Por qué este número?» — traza paso a paso de una regla. */}
      <TrazaModal traza={traza} onClose={() => setTraza(null)} />
    </div>
  );
}
