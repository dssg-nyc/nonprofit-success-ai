import { AlertTriangle, X } from 'lucide-react';

/**
 * The visible half of an error path. A failed read or write used to be logged to the
 * console and nothing else — the screen showed an empty list or a form that did
 * nothing, indistinguishable from "no data" or "saved". This puts the failure on screen.
 */
export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-4 text-[11px] font-bold leading-relaxed text-red-600"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p className="flex-1">{message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="shrink-0 hover:text-red-800">
        <X size={14} />
      </button>
    </div>
  );
}
