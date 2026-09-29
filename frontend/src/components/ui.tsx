import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { PaymentStatus } from "../types";

export function Icon({ name, fill, className = "" }: { name: string; fill?: boolean; className?: string }) {
  return (
    <span className={`icon ${fill ? "fill" : ""} ${className}`} aria-hidden>
      {name}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

type Variant = "primary" | "secondary" | "tonal" | "danger" | "ghost";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean };

export function Button({ variant = "primary", block, className = "", children, ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} ${block ? "btn-block" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function PrimaryButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="primary" {...props} />;
}

export function SecondaryButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="secondary" {...props} />;
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

export const STATUS_META: Record<PaymentStatus, { label: string; tone: string }> = {
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

export function DetailRow({
  label,
  value,
  sub,
  icon,
  mono,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: string;
  mono?: boolean;
}) {
  return (
    <div className="detail-row">
      <span className="detail-label">
        {icon ? <Icon name={icon} /> : null}
        {label}
      </span>
      <span className={`detail-value ${mono ? "mono" : ""}`}>
        {value}
        {sub ? <small>{sub}</small> : null}
      </span>
    </div>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

export function PaymentCheckRow({
  title,
  detail,
  percent,
}: {
  title: string;
  detail: string;
  percent?: number;
}) {
  return (
    <div className="check-row">
      <div className="check-head">
        <span className="check-icon">
          <Icon name="check" />
        </span>
        <span className="check-title">{title}</span>
        <span className="check-detail">{detail}</span>
      </div>
      {percent !== undefined ? <ProgressBar percent={percent} /> : null}
    </div>
  );
}
