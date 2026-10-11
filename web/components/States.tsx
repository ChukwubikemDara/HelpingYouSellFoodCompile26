"use client";

/** Loading and error states, the same on every data screen (docs/design.md "States"). */

export function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      Loading…
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="stack" role="alert">
      <p className="note-error">{message}</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** A one-line message under a form or action: errors in an ember note, anything else plain. */
export function InlineMessage({ error, text }: { error?: boolean; text: string | null }) {
  if (!text) return null;
  return (
    <p className={error ? "note-error" : "small"} role={error ? "alert" : "status"} aria-live="polite">
      {text}
    </p>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="inline" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
