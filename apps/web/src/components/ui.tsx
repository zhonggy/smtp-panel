import type { ReactNode, ButtonHTMLAttributes } from "react";

// ===== Button =====
type Variant = "primary" | "ghost" | "danger" | "success" | "outline";
export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  children,
  className = "",
  ...rest
}: {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3 py-1.5 text-sm", lg: "px-4 py-2 text-sm" };
  const variants: Record<Variant, string> = {
    primary: "bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm",
    ghost: "bg-transparent hover:bg-slate-700/50 text-slate-300",
    danger: "bg-rose-600 hover:bg-rose-500 text-white shadow-sm",
    success: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm",
    outline: "border border-slate-600 hover:border-slate-500 text-slate-300 bg-transparent",
  };
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}

// ===== Field =====
export function Field({ label, hint, children, className = "" }: { label?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-xs text-slate-400 font-medium">{label}</label>}
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

// ===== Input =====
export function Input(props: any) {
  return (
    <input
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition"
      {...props}
    />
  );
}

// ===== Select =====
export function Select(props: any) {
  return (
    <select
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition"
      {...props}
    />
  );
}

// ===== Textarea =====
export function Textarea(props: any) {
  return (
    <textarea
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition resize-y"
      rows={4}
      {...props}
    />
  );
}

// ===== Modal =====
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className={`bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-[85vh] overflow-y-auto animate-fade-in ${wide ? "w-[700px]" : "w-[480px]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
            <h2 className="text-base font-semibold text-slate-200">{title}</h2>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">&times;</button>
          </div>
        )}
        <div className="px-5 py-4 space-y-3">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-700 bg-slate-950/50">{footer}</div>}
      </div>
    </div>
  );
}

// ===== Badge =====
const BADGE_COLORS: Record<string, string> = {
  draft: "bg-slate-700 text-slate-300",
  queued: "bg-indigo-600/30 text-indigo-300",
  sending: "bg-sky-600/30 text-sky-300",
  paused: "bg-amber-600/30 text-amber-300",
  completed: "bg-emerald-600/30 text-emerald-300",
  cancelled: "bg-rose-600/30 text-rose-300",
  failed: "bg-rose-600/30 text-rose-300",
  success: "bg-emerald-600/30 text-emerald-300",
  pending: "bg-slate-600/30 text-slate-300",
  sent: "bg-emerald-600/30 text-emerald-300",
  active: "bg-emerald-600/30 text-emerald-300",
  blocked: "bg-rose-600/30 text-rose-300",
  ssl: "bg-sky-600/30 text-sky-300",
  starttls: "bg-violet-600/30 text-violet-300",
  none: "bg-slate-600/30 text-slate-300",
};

export function Badge({ color, children, className = "" }: { color?: string; children: ReactNode; className?: string }) {
  const cls = BADGE_COLORS[color ?? ""] ?? "bg-slate-700 text-slate-300";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls} ${className}`}>{children}</span>;
}

// ===== Pagination =====
export function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-1 text-sm">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="px-2 py-1 rounded hover:bg-slate-800 disabled:opacity-30">
        &laquo;
      </button>
      <span className="px-2 text-slate-400">
        {page} / {totalPages}
      </span>
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} className="px-2 py-1 rounded hover:bg-slate-800 disabled:opacity-30">
        &raquo;
      </button>
    </div>
  );
}

// ===== Spinner =====
export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin ${className}`} />;
}

// ===== EmptyRow =====
export function EmptyRow({ colSpan, children = "暂无数据" }: { colSpan: number; children?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center py-8 text-slate-500 text-sm">
        {children}
      </td>
    </tr>
  );
}