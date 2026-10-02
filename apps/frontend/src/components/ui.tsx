/** Small reusable UI kit (execution plan B1 "Shared components"). */
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-tutor-blue text-white hover:bg-blue-700",
  secondary: "border border-paper-grid bg-surface text-ink hover:bg-paper",
  danger: "bg-student-red text-white hover:bg-red-700",
  ghost: "text-ink-soft hover:bg-paper",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export function Panel({
  title,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-paper-grid bg-surface shadow-panel ${className}`}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-paper-grid px-3 py-2">
          {title ? (
            <h2 className="text-sm font-semibold text-ink-soft">{title}</h2>
          ) : (
            <span />
          )}
          {actions}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function StatusPill({
  tone = "neutral",
  children,
  title,
}: {
  tone?: "neutral" | "ok" | "warn" | "error";
  children: ReactNode;
  title?: string;
}) {
  const tones = {
    neutral: "bg-gray-100 text-ink-soft",
    ok: "bg-green-100 text-green-800",
    warn: "bg-amber-100 text-amber-800",
    error: "bg-red-100 text-red-800",
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? "Loading"}
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-paper-grid border-t-tutor-blue"
    />
  );
}

export function Banner({
  tone = "warn",
  children,
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
}) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-300 bg-red-50 text-red-900",
  } as const;
  return (
    <div role="alert" className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function TextField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "rounded-lg border border-paper-grid bg-surface px-3 py-2 text-sm outline-none focus:border-tutor-blue";

export function EmptyState({
  title,
  hint,
  ...props
}: HTMLAttributes<HTMLDivElement> & { title: string; hint?: string }) {
  return (
    <div
      {...props}
      className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center"
    >
      <p className="text-sm font-semibold text-ink-soft">{title}</p>
      {hint ? <p className="max-w-xs text-xs text-ink-soft/80">{hint}</p> : null}
    </div>
  );
}
