"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Save, BookOpen, RefreshCw, ChevronDown } from "lucide-react";
import { ConfirmModal } from "./ConfirmModal";

interface KBEntry {
  _id?: string;
  botId: string;
  type: "policy" | "faq" | "terms" | "guideline" | "instruction";
  title: string;
  content: string;
  updatedAt: string;
}

interface Props {
  botId: "cindy" | "felix" | "xavier" | "instar";
  accentColor: string;
}

const TYPE_OPTIONS = ["policy", "faq", "terms", "guideline", "instruction"] as const;

export function KnowledgeBasePanel({ botId, accentColor }: Props) {
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New entry form state
  const [form, setForm] = useState({
    type: "faq" as KBEntry["type"],
    title: "",
    content: "",
    scope: "bot" as "bot" | "all",
  });

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const cardBg = "rgba(255,255,255,0.04)";
  const borderColor = "rgba(255,255,255,0.08)";
  const accentAlpha = accentColor + "22";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge-base?botId=${botId}`);
      const data = await res.json();
      if (data.success) setEntries(data.entries);
      else setError(data.error || "Failed to load.");
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setError("Title and content are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: form.scope === "all" ? "all" : botId,
          type: form.type,
          title: form.title.trim(),
          content: form.content.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setForm({ type: "faq", title: "", content: "", scope: "bot" });
        await load();
      } else {
        setError(data.error || "Failed to save.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/knowledge-base?id=${id}`, { method: "DELETE" });
      setEntries((prev) => prev.filter((e) => e._id !== id));
    } catch {
      setError("Delete failed.");
    }
  };

  const typeColor: Record<string, string> = {
    policy: "#f59e0b",
    faq: "#10b981",
    terms: "#6366f1",
    guideline: "#3b82f6",
    instruction: "#ec4899",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{`
        .kb-input {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .kb-input:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          border-color: rgba(255, 255, 255, 0.15) !important;
        }
        .kb-input:focus {
          background: rgba(255, 255, 255, 0.09) !important;
          border-color: ${accentColor} !important;
          box-shadow: 0 0 0 3px ${accentColor}18;
          transform: translateY(-1px);
        }
        .kb-btn {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .kb-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.15);
          box-shadow: 0 4px 12px ${accentColor}25;
        }
        .kb-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .kb-card {
          transition: all 0.3s ease;
        }
        .kb-card:hover {
          border-color: rgba(255, 255, 255, 0.15) !important;
          background: rgba(255, 255, 255, 0.06) !important;
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BookOpen size={18} color={accentColor} />
          <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 600, fontSize: 15 }}>
            Knowledge Base
          </span>
          <span style={{
            background: accentAlpha, color: accentColor,
            fontSize: 11, fontWeight: 700, borderRadius: 20,
            padding: "2px 8px",
          }}>{entries.length} entries</span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, padding: "6px 10px", cursor: "pointer",
            color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          <span style={{ fontSize: 12 }}>Refresh</span>
        </button>
      </div>

      {error && (
        <div style={{
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 10, padding: "10px 14px", color: "#ef4444", fontSize: 13,
        }}>{error}</div>
      )}

      {/* Add new entry form */}
      <div style={{
        background: cardBg, border: `1px solid ${borderColor}`,
        borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 12,
      }}>
        <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Add Entry
        </span>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {/* Type */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>TYPE</label>
            <div style={{ position: "relative" }}>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as KBEntry["type"] }))}
                className="kb-input"
                style={{
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10, padding: "9px 32px 9px 14px", color: "rgba(255,255,255,0.9)",
                  fontSize: 13, outline: "none", width: "100%", appearance: "none",
                  cursor: "pointer", fontWeight: 600,
                }}
              >
                <option value="policy" style={{ background: "#12131f", color: "#fff" }}>Policy</option>
                <option value="faq" style={{ background: "#12131f", color: "#fff" }}>Faq</option>
                <option value="terms" style={{ background: "#12131f", color: "#fff" }}>Terms</option>
                <option value="guideline" style={{ background: "#12131f", color: "#fff" }}>Guideline</option>
                <option value="instruction" style={{ background: "#12131f", color: "#fff" }}>Instruction</option>
              </select>
              <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", opacity: 0.4 }} />
            </div>
          </div>

          {/* Scope */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>APPLIES TO</label>
            <div style={{ position: "relative" }}>
              <select
                value={form.scope}
                onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as "bot" | "all" }))}
                className="kb-input"
                style={{
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10, padding: "10px 32px 10px 14px", color: "rgba(255,255,255,0.9)",
                  fontSize: 13, outline: "none", width: "100%", appearance: "none",
                  cursor: "pointer", fontWeight: 600,
                }}
              >
                <option value="bot" style={{ background: "#12131f", color: "#fff" }}>This bot only</option>
                <option value="all" style={{ background: "#12131f", color: "#fff" }}>All bots (shared)</option>
              </select>
              <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", opacity: 0.4 }} />
            </div>
          </div>
        </div>

        {/* Title */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600 }}>TITLE</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Refund Policy, Pricing FAQ..."
            style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8, padding: "8px 12px", color: "rgba(255,255,255,0.85)",
              fontSize: 13, outline: "none", width: "100%",
            }}
          />
        </div>

        {/* Content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600 }}>CONTENT</label>
          <textarea
            rows={4}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="Write the policy, FAQ answer, or instruction here..."
            style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8, padding: "10px 12px", color: "rgba(255,255,255,0.85)",
              fontSize: 13, outline: "none", resize: "vertical", width: "100%", lineHeight: 1.6,
            }}
          />
        </div>

        <button
          onClick={handleAdd}
          disabled={saving}
          className="kb-btn"
          style={{
            background: saving ? "rgba(255,255,255,0.05)" : accentColor,
            border: "none",
            borderRadius: 10, padding: "12px 16px", cursor: saving ? "not-allowed" : "pointer",
            color: "#fff", fontWeight: 700, fontSize: 13,
            display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
            marginTop: 4,
          }}
        >
          {saving ? <RefreshCw size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={16} strokeWidth={2.5} />}
          {saving ? "Saving..." : "Add Entry to Knowledge Base"}
        </button>
      </div>

      {/* Entries list */}
      {loading && entries.length === 0 ? (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 30, fontSize: 13 }}>
          Loading entries...
        </div>
      ) : entries.length === 0 ? (
        <div style={{
          background: cardBg, border: `1px dashed ${borderColor}`,
          borderRadius: 14, padding: 30, textAlign: "center",
          color: "rgba(255,255,255,0.25)", fontSize: 13,
        }}>
          No entries yet. Add company policies, FAQs, and guidelines above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map((entry) => (
            <div key={entry._id} className="kb-card" style={{
              background: cardBg, border: `1px solid ${borderColor}`,
              borderRadius: 14, padding: 18,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    background: (typeColor[entry.type] || accentColor) + "22",
                    color: typeColor[entry.type] || accentColor,
                    fontSize: 10, fontWeight: 700, borderRadius: 6,
                    padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>{entry.type}</span>
                  {entry.botId === "all" && (
                    <span style={{
                      background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)",
                      fontSize: 10, fontWeight: 600, borderRadius: 6, padding: "2px 7px",
                    }}>shared</span>
                  )}
                  <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: 600 }}>
                    {entry.title}
                  </span>
                </div>
                <button
                  onClick={() => entry._id && setDeleteId(entry._id)}
                  style={{
                    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
                    borderRadius: 7, padding: "5px 8px", cursor: "pointer",
                    color: "#ef4444", display: "flex", alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <p style={{
                color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 1.6,
                margin: 0, whiteSpace: "pre-wrap",
              }}>
                {entry.content.length > 200 ? entry.content.slice(0, 200) + "..." : entry.content}
              </p>
              <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, marginTop: 8 }}>
                Updated {new Date(entry.updatedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && handleDelete(deleteId)}
        title="Delete Entry"
        message="Are you sure you want to delete this knowledge base entry? This will permanently remove it from the database and it won't be used for future replies."
        color="#ef4444"
      />
    </div>
  );
}
