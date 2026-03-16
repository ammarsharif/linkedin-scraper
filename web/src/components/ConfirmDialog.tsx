"use client";

import React from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "warning" | "info";
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  variant = "danger",
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const themes = {
    danger: {
      icon: <AlertTriangle size={24} className="text-red-500" />,
      bg: "rgba(239, 68, 68, 0.1)",
      border: "rgba(239, 68, 68, 0.2)",
      button: "linear-gradient(135deg, #ef4444, #dc2626)",
      shadow: "rgba(239, 68, 68, 0.25)",
    },
    warning: {
      icon: <AlertTriangle size={24} className="text-amber-500" />,
      bg: "rgba(245, 158, 11, 0.1)",
      border: "rgba(245, 158, 11, 0.2)",
      button: "linear-gradient(135deg, #f59e0b, #d97706)",
      shadow: "rgba(245, 158, 11, 0.25)",
    },
    info: {
      icon: <AlertTriangle size={24} className="text-blue-500" />,
      bg: "rgba(59, 130, 246, 0.1)",
      border: "rgba(59, 130, 246, 0.2)",
      button: "linear-gradient(135deg, #3b82f6, #2563eb)",
      shadow: "rgba(59, 130, 246, 0.25)",
    },
  };

  const theme = themes[variant];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
    >
      <div 
        className="w-full max-w-md rounded-2xl border p-6 shadow-2xl animate-scale-in"
        style={{ background: "#0d0e18", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border"
              style={{ background: theme.bg, borderColor: theme.border }}
            >
              {theme.icon}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{title}</h3>
              <p className="text-sm text-gray-400 mt-1">{message}</p>
            </div>
          </div>
          <button 
            onClick={onCancel}
            className="text-gray-500 hover:text-white transition-all cursor-pointer p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-3 mt-8">
          <button 
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-gray-400 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button 
            onClick={onConfirm}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all cursor-pointer shadow-lg"
            style={{ 
              background: theme.button,
              boxShadow: `0 4px 14px ${theme.shadow}`
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
