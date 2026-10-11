"use client";

/**
 * A destructive action as a secondary button (or link) that asks first
 * (docs/design.md: cancel deal, cancel reservation).
 */
import { useState } from "react";

export function ConfirmButton({
  label,
  question,
  confirmLabel,
  keepLabel = "Keep it",
  busyLabel,
  busy,
  disabled,
  variant = "button",
  onConfirm,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  keepLabel?: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  /** How the first step looks: a secondary button (default) or a text link inside a row of actions. */
  variant?: "button" | "link";
  onConfirm: () => void | Promise<void>;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking && !busy) {
    return (
      <button
        type="button"
        className={variant === "link" ? "link link-quiet" : "btn btn-secondary"}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="stack" role="group" aria-label={label} style={variant === "link" ? { flexBasis: "100%" } : undefined}>
      <p className="small">{question}</p>
      <div className="inline">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={async () => {
            await onConfirm();
            setAsking(false);
          }}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
        <button type="button" className="link link-quiet" disabled={busy} onClick={() => setAsking(false)}>
          {keepLabel}
        </button>
      </div>
    </div>
  );
}
