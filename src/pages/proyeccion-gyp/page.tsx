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
import { construirFilasEscenarios } from './salida';
import {
  construirDesdeSemilla,
  cargarDesdeSupabase,
  cargarDatosDetalle,
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
import SelloFrescura from './components/SelloFrescura';
import KpiHeader from './components/KpiHeader';
import PestanaParametros from './components/PestanaParametros';
import PestanaReglas, { type Override, type NuevaRegla } from './components/PestanaReglas';
import PestanaResultado from './components/PestanaResultado';
import PestanaTablaSalida from './components/PestanaTablaSalida';
import PestanaComparar from './components/PestanaComparar';
import PestanaAlertas from './components/PestanaAlertas';
import PestanaMisFormulas from './components/PestanaMisFormulas';
import TrazaModal from './components/TrazaModal';
import type { Traza } from './components/traza';
import type { FilaHistoricoCuenta } from './capas';

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
  const [publicando, setPublicando] = useState(false);

  // Presupuesto del periodo (para Comparar, CP-45) y traza «¿Por qué?» (CP-35).
  const [presupuesto, setPresupuesto] = useState<PresupuestoFila[]>([]);
  // Detalle por cuenta del mes: cuentas que ofrece «+ Agregar regla».
  const [detalleCuenta, setDetalleCuenta] = useState<FilaHistoricoCuenta[]>([]);
  // Alertas de revisión del catálogo del periodo (CP-34, pestaña Alertas).
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  // Actualización programada (CP-56, pestaña Parámetros) y última publicación.
  const [programacion, setProgramacion] = useState<Programacion>(() => ({ ...PROGRAMACION_DEFAULT }));
  const [ultimaPublicacion, setUltimaPublicacion] = useState<Corrida | null>(null);
  const [traza, setTraza] = useState<Traza | null>(null);
  // Empresas cuya prueba contable CP-47 no cuadra (gobierna la publicación).
  const [pruebaMalasCP47, setPruebaMalasCP47] = useState<string[]>([]);

  const kk = (empresa: string, concepto: string) => empresa + '|' + concepto;

  // ── Métodos efectivos (fábrica + propios − borrados) ──
  const metodos = useMemo<Record<string, Metodo>>(() => {
    const m: Record<string, Metodo> = { ...data.metodos, ...metodosUser };
    metBorrados.forEach((k) => delete m[k]);
    return m;
  }, [data.metodos, metodosUser, metBorrados]);

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
      const o = overrides[kk(r.empresa, r.concepto)] || {};
      // Borrada en pantalla, o borrada en la base y no restaurada (CP-31).
      if (o.borrada ?? data.reglasBase[i]?.eliminada) return;
      out.push({
        ...r,
        key: kk(r.empresa, r.concepto),
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
    return out;
  }, [data.reglasBase, data.series, overrides, nuevas, pptoPorConcepto]);

  // ── Cálculo de los DOS escenarios (§H). La cabecera de KPIs necesita ambos. ──
  const escenarios = useMemo(
    () => calcularEscenarios({ reglas, metodos, params, empresas: EMPRESAS, gn }),
    [reglas, metodos, params, gn],
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
      const esc = calcularEscenarios({ reglas: rs, metodos, params, empresas: EMPRESAS, gn });
      const emp = rs[i].empresa;
      return {
        proy: esc.proyeccion.val[i] ?? 0,
        caus: esc.causado.val[i] ?? 0,
        snProy: esc.proyeccion.agg[emp]?.sn ?? 0,
        snCaus: esc.causado.agg[emp]?.sn ?? 0,
      };
    },
    [reglas, metodos, params, gn],
  );

  // Reglas eliminadas (borrado lógico) para el pie con «Restaurar» (CP-31).
  const eliminadas = useMemo(() => {
    const base = ensamblarReglas(data.reglasBase, data.series);
    const borradas = new Set(Object.keys(overrides).filter((k) => overrides[k]?.borrada));
    // Las borradas en la base siguen en el pie hasta que se restauren.
    data.reglasBase.forEach((r) => {
      const k = kk(r.empresa, r.concepto);
      if (r.eliminada && overrides[k]?.borrada !== false) borradas.add(k);
    });
    return [...borradas]
      .map((k) => {
        const r = base.find((x) => kk(x.empresa, x.concepto) === k);
        return {
          key: k,
          empresa: r?.empresa ?? k.split('|')[0],
          concepto: r?.concepto ?? k.split('|')[1],
          combinada: r?.combinada ?? k,
        };
      });
  }, [overrides, data.reglasBase, data.series]);

  const tot = useCallback(
    (k: keyof AgregadoEmpresa) => EMPRESAS.reduce((a, e) => a + (agg[e]?.[k] || 0), 0),
    [agg],
  );

  // ── Carga desde Supabase. Si es manual, primero dispara la extracción de
  //    Fabric (Edge Function refrescar-proyeccion-fabric) y luego recarga lo que
  //    quedó en Supabase. ──
  const traer = useCallback(
    async (manual: boolean) => {
      const seed = construirDesdeSemilla();

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
        }
      })
      .catch(() => {
        if (vivo) {
          setPresupuesto([]);
          setAlertas([]);
          setDetalleCuenta([]);
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
  const baseDe = (key: string) => data.reglasBase.find((r) => kk(r.empresa, r.concepto) === key);

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
      setNuevas((prev) => prev.filter((_, j) => j !== i));
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
    setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], borrada: false } }));
    const b = baseDe(key);
    if (b?.id != null)
      restaurarReglaDb(b.id, b.rev ?? 0).then((r) => {
        avisarEscritura(r, 'la regla');
        if (r.ok) fijarRev(b.id!, r.rev);
      });
  };

  const restablecer = () => {
    const seed = construirDesdeSemilla();
    setData(seed);
    setParams(seed.params);
    setMetodosUser({});
    setMetBorrados([]);
    setOverrides({});
    setNuevas([]);
    setGn(9);
    addToast('info', 'Se restableció todo al estado validado por control.');
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
      setData((d) => ({ ...d, periodo: nuevoPeriodo }));
      addToast('info', `Mes de trabajo fijado en ${nuevoPeriodo} para todos.`);
    },
    [data.periodo, addToast],
  );

  // El factor se guarda POR MES (CP-33 / CP-37). Actualiza el estado local y lo
  // persiste vía `guardarFactorMes(periodo, empresa, factor)`.
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
    // CP-47 / Req 22.3: la prueba contable gobierna la publicación.
    if (pruebaMalasCP47.length) {
      addToast(
        'error',
        `No se publica: la prueba contable de la Renta Bruta no cuadra en ${pruebaMalasCP47.join(', ')}.`,
      );
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
          onFactorMes={factorMes}
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
        <PestanaAlertas
          contador={alertas.length || avisos.length}
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
