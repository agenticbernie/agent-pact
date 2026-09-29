import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { PaymentStatus } from "../types";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Button({
  variant = "primary",
  block,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  block?: boolean;
}) {
  return (
    <button
      className={`btn btn-${variant} ${block ? "btn-block" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" />
      {label ? <p className="spinner-label">{label}</p> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="note note-error">{children}</div>;
}

export function InfoNote({ children }: { children: ReactNode }) {
  return <div className="note note-info">{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

const STATUS_META: Record<PaymentStatus, { label: string; tone: string }> = {
  PROPOSED: { label: "Proposed", tone: "gray" },
  AWAITING_CONFIRMATION: { label: "Awaiting confirmation", tone: "amber" },
  CONFIRMED: { label: "Confirmed", tone: "blue" },
  EXECUTING: { label: "Executing", tone: "blue" },
  SETTLED: { label: "Settled", tone: "green" },
  REJECTED: { label: "Rejected", tone: "red" },
  FAILED: { label: "Failed", tone: "red" },
  EXPIRED: { label: "Expired", tone: "gray" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};

export function StatusBadge({ status }: { status: PaymentStatus }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "gray" };
  return <span className={`badge badge-${meta.tone}`}>{meta.label}</span>;
}

export function DetailRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value ${mono ? "mono" : ""}`}>{value}</span>
    </div>
  );
}
