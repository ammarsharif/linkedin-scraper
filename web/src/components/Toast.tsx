"use client";

/**
 * Shared Toast notification system.
 *
 * Usage:
 *   const { showToast, ToastComponent } = useToast();
 *   // ... inside JSX:
 *   <ToastComponent />
 *   // ... to trigger:
 *   showToast("Saved!", "success");
 *   showToast("Something went wrong", "error");
 */

import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

interface ToastState {
  id: number;
  message: string;
  type: ToastType;
}

// ── Style map ──────────────────────────────────────────────────────────────

const STYLES: Record<ToastType, {
  bg: string;
  border: string;
  iconBg: string;
  iconBorder: string;
  textColor: string;
  barGradient: string;
  shadow: string;
  icon: React.ReactNode;
}> = {
  success: {
    bg:          "rgba(7,20,15,0.97)",
    border:      "rgba(16,185,129,0.28)",
    iconBg:      "rgba(16,185,129,0.14)",
    iconBorder:  "rgba(16,185,129,0.35)",
    textColor:   "#d1fae5",
    barGradient: "linear-gradient(90deg,#059669,#10b981,#34d399)",
    shadow:      "0 20px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(16,185,129,0.25)",
    icon:        <CheckCircle2 size={16} color="#10b981" />,
  },
  error: {
    bg:          "rgba(20,7,7,0.97)",
    border:      "rgba(239,68,68,0.28)",
    iconBg:      "rgba(239,68,68,0.14)",
    iconBorder:  "rgba(239,68,68,0.35)",
    textColor:   "#fee2e2",
    barGradient: "linear-gradient(90deg,#dc2626,#ef4444,#f87171)",
    shadow:      "0 20px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(239,68,68,0.25)",
    icon:        <AlertCircle size={16} color="#ef4444" />,
  },
  info: {
    bg:          "rgba(7,12,22,0.97)",
    border:      "rgba(59,130,246,0.28)",
    iconBg:      "rgba(59,130,246,0.14)",
    iconBorder:  "rgba(59,130,246,0.35)",
    textColor:   "#dbeafe",
    barGradient: "linear-gradient(90deg,#1d4ed8,#3b82f6,#60a5fa)",
    shadow:      "0 20px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(59,130,246,0.25)",
    icon:        <Info size={16} color="#3b82f6" />,
  },
};

// ── Toast UI ───────────────────────────────────────────────────────────────

const DURATION = 3800;

function ToastUI({
  toast,
  onClose,
}: {
  toast: ToastState;
  onClose: () => void;
}) {
  const s = STYLES[toast.type];

  return (
    <>
      <style>{`
        @keyframes toast-slide-up {
          from { opacity:0; transform:translateY(20px) scale(0.94); }
          to   { opacity:1; transform:translateY(0)    scale(1);    }
        }
        @keyframes toast-progress {
          from { width: 100%; }
          to   { width: 0%;   }
        }
        .toast-dismiss-btn { transition: color 0.15s; color: rgba(255,255,255,0.28); }
        .toast-dismiss-btn:hover { color: rgba(255,255,255,0.75); }
      `}</style>

      <div
        style={{
          position: "fixed",
          bottom: 28,
          right: 28,
          zIndex: 99999,
          minWidth: 300,
          maxWidth: 420,
          borderRadius: 16,
          overflow: "hidden",
          background: s.bg,
          border: `1px solid ${s.border}`,
          boxShadow: s.shadow,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          animation: "toast-slide-up 0.3s cubic-bezier(0.34,1.56,0.64,1) both",
          fontFamily: "inherit",
        }}
      >
        {/* Body row */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 14px 14px 16px",
        }}>
          {/* Icon */}
          <div style={{
            width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
            background: s.iconBg,
            border: `1.5px solid ${s.iconBorder}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {s.icon}
          </div>

          {/* Message */}
          <span style={{
            flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.45,
            color: s.textColor,
          }}>
            {toast.message}
          </span>

          {/* Dismiss */}
          <button
            onClick={onClose}
            className="toast-dismiss-btn"
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "3px", flexShrink: 0,
              display: "flex", alignItems: "center",
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Auto-shrink progress bar */}
        <div style={{ height: 3, background: "rgba(255,255,255,0.05)" }}>
          <div
            key={toast.id}
            style={{
              height: "100%",
              background: s.barGradient,
              animation: `toast-progress ${DURATION}ms linear both`,
            }}
          />
        </div>
      </div>
    </>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (message: string, type: ToastType = "success") => {
      const id = Date.now();
      setToast({ id, message, type });
      setTimeout(() => setToast(null), DURATION);
    },
    []
  );

  const dismiss = useCallback(() => setToast(null), []);

  // Rendered via portal so fixed positioning is always relative to the viewport
  const ToastComponent = toast && typeof document !== "undefined"
    ? createPortal(
        <ToastUI toast={toast} onClose={dismiss} />,
        document.body
      )
    : null;

  return { showToast, ToastComponent };
}
