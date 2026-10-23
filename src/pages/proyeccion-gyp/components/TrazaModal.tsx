import { Modal } from '@/components/base/Modal';
import { fmt } from './formato';
import type { Traza } from './traza';

/**
 * CP-35 · «¿Por qué este número?».
 *
 * Modal con la traza paso a paso del cálculo de una regla en un escenario.
 * Se abre al pulsar una cifra (en Comparar o Resultado) y muestra el desglose
 * que arma `trazaRegla`.
 */
export interface TrazaModalProps {
  traza: Traza | null;
  onClose: () => void;
}

export default function TrazaModal({ traza, onClose }: TrazaModalProps) {
  return (
    <Modal
      isOpen={traza != null}
      onClose={onClose}
      title={traza ? `¿Por qué este número? · ${traza.empresa} / ${traza.concepto}` : ''}
      size="lg"
    >
      {traza && (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Escenario {traza.escenario === 'CAUSADO' ? 'Causado al corte' : 'Proyectado al cierre'}
            </span>
            <span className="font-mono text-lg font-bold tabular-nums text-slate-900">
              {fmt(traza.resultado, 2)} USD
            </span>
          </div>

          <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {traza.lineas.map((l, i) => (
              <div key={i} className="flex items-start justify-between gap-4 px-3 py-2">
                <dt className="text-sm text-slate-600">{l.etiqueta}</dt>
                <dd className="text-right font-mono text-sm tabular-nums text-slate-900">
                  {l.texto != null ? (
                    <span className="font-sans text-slate-700">{l.texto}</span>
                  ) : (
                    fmt(l.valor, l.decimales ?? 0)
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Destino</p>
            <p className="font-mono">
              Combinada {traza.combinada} · Cuenta {traza.cuenta} · Centro {traza.cc}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
