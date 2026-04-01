"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Save, BookOpen, RefreshCw } from "lucide-react";

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
            <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600 }}>TYPE</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as KBEntry["type"] }))}
              style={{
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8, padding: "8px 12px", color: "rgba(255,255,255,0.85)",
                fontSize: 13, outline: "none",
              }}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t} style={{ background: "#111" }}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Scope */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600 }}>APPLIES TO</label>
            <select
              value={form.scope}
              onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as "bot" | "all" }))}
              style={{
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8, padding: "8px 12px", color: "rgba(255,255,255,0.85)",
                fontSize: 13, outline: "none",
              }}
            >
              <option value="bot" style={{ background: "#111" }}>This bot only</option>
              <option value="all" style={{ background: "#111" }}>All bots (shared)</option>
            </select>
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
          style={{
            background: saving ? "rgba(255,255,255,0.05)" : accentAlpha,
            border: `1px solid ${accentColor}44`,
            borderRadius: 10, padding: "10px 16px", cursor: saving ? "not-allowed" : "pointer",
            color: accentColor, fontWeight: 600, fontSize: 13,
            display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
          }}
        >
          {saving ? <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={14} />}
          {saving ? "Saving..." : "Add Entry"}
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
            <div key={entry._id} style={{
              background: cardBg, border: `1px solid ${borderColor}`,
              borderRadius: 12, padding: 14,
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
                  onClick={() => entry._id && handleDelete(entry._id)}
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
    </div>
  );
}
