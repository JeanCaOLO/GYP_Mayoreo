interface ProgressModalProps {
  isOpen: boolean;
  title: string;
  message: string;
}

export function ProgressModal({ isOpen, title, message }: ProgressModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-sm rounded-xl bg-white shadow-2xl p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg className="animate-spin w-6 h-6 text-emerald-600" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-600">{message}</p>
        <p className="text-xs text-slate-400 mt-3">No cierres ni navegues. Esto puede tomar unos momentos...</p>
      </div>
    </div>
  );
}
