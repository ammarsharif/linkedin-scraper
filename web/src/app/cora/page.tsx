"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Share2,
  RefreshCw,
  ChevronLeft,
  CheckCircle2,
  Copy,
  Edit3,
  Facebook,
  Twitter,
  Instagram,
  Mail,
  User,
  FileText,
  Check,
  Layers,
  ChevronDown,
  ChevronUp,
  Inbox,
} from "lucide-react";
import { BotSwitcher } from "@/components/BotSwitcher";

const CORA_GRADIENT = "linear-gradient(135deg, #f59e0b, #d97706, #b45309)";
const CORA_COLOR = "#f59e0b";

interface CaraPersona {
  _id: string;
  name: string;
  headline: string;
  location?: string;
  postsAnalyzed?: number;
  lastUpdated?: string;
  analysis?: {
    executiveSummary?: string;
    personalityProfile?: { tone?: string };
    buyerProfile?: { buyerType?: string };
    professionalInsights?: { currentRole?: string };
  };
}

type Platform = "facebook" | "twitter" | "instagram" | "email";
type PageView = "generate" | "saved";

interface PlatformMeta {
  id: Platform;
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  description: string;
}

interface SavedRecord {
  _id: string;
  id: string;
  persona_id: string;
  persona_name?: string;
  original_post: string;
  platform: Platform;
  content: string;
  status: "draft" | "approved";
  created_at: string;
}

const PLATFORMS: PlatformMeta[] = [
  {
    id: "facebook",
    label: "Facebook",
    icon: Facebook,
    color: "#1877f2",
    bg: "rgba(24,119,242,0.1)",
    description: "Conversational · 150-300 words · Storytelling",
  },
  {
    id: "twitter",
    label: "Twitter / X",
    icon: Twitter,
    color: "#1d9bf0",
    bg: "rgba(29,155,240,0.1)",
    description: "3-5 tweet thread · Punchy · Hook-first",
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: Instagram,
    color: "#e1306c",
    bg: "rgba(225,48,108,0.1)",
    description: "100-150 words · Emojis · 10 hashtags",
  },
  {
    id: "email",
    label: "Email Newsletter",
    icon: Mail,
    color: "#10b981",
    bg: "rgba(16,185,129,0.1)",
    description: "Subject line · 200-300 words · Personal CTA",
  },
];

function platformMeta(id: Platform): PlatformMeta {
  return PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CoraPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [pageView, setPageView] = useState<PageView>("generate");

  // ── Personas ──────────────────────────────────────────────────────────────
  const [personas, setPersonas] = useState<CaraPersona[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(false);

  // ── Setup step inputs ──────────────────────────────────────────────────────
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [originalPost, setOriginalPost] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(
    new Set(["facebook", "twitter", "instagram", "email"])
  );

  // ── Generation ────────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genStep, setGenStep] = useState<"setup" | "review">("setup");
  const [generatedContent, setGeneratedContent] = useState<Record<Platform, string>>(
    {} as Record<Platform, string>
  );
  const [editedContent, setEditedContent] = useState<Record<Platform, string>>(
    {} as Record<Platform, string>
  );
  const [approvedPlatforms, setApprovedPlatforms] = useState<Set<Platform>>(new Set());
  const [approvingPlatform, setApprovingPlatform] = useState<Platform | null>(null);
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null);
  const [currentPersonaId, setCurrentPersonaId] = useState("");
  const [currentOriginalPost, setCurrentOriginalPost] = useState("");

  // ── Saved Content ─────────────────────────────────────────────────────────
  const [savedRecords, setSavedRecords] = useState<SavedRecord[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savedFilter, setSavedFilter] = useState<Platform | "all">("all");
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [savedPersonaFilter, setSavedPersonaFilter] = useState<string>("all");

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => { if (!d.authenticated) router.push("/"); })
      .catch(() => router.push("/"))
      .finally(() => setChecking(false));
  }, [router]);

  const loadPersonas = useCallback(async () => {
    setLoadingPersonas(true);
    try {
      const res = await fetch("/api/cora/personas");
      const data = await res.json();
      if (res.ok && data.personas) setPersonas(data.personas);
      else showToast(data.error || "Failed to load personas", "error");
    } catch {
      showToast("Network error loading personas", "error");
    } finally {
      setLoadingPersonas(false);
    }
  }, [showToast]);

  const loadSavedContent = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const res = await fetch("/api/cora/approve");
      const data = await res.json();
      if (res.ok && data.records) setSavedRecords(data.records);
      else showToast(data.error || "Failed to load saved content", "error");
    } catch {
      showToast("Network error loading saved content", "error");
    } finally {
      setLoadingSaved(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!checking) {
      loadPersonas();
      loadSavedContent();
    }
  }, [checking, loadPersonas, loadSavedContent]);

  function togglePlatform(p: Platform) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  async function handleGenerate() {
    if (!selectedPersonaId) return showToast("Please select a Cara persona.", "error");
    if (!originalPost.trim()) return showToast("Please paste a LinkedIn post.", "error");
    if (selectedPlatforms.size === 0) return showToast("Select at least one platform.", "error");

    setGenerating(true);
    try {
      const res = await fetch("/api/cora/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: selectedPersonaId,
          originalPost,
          platforms: Array.from(selectedPlatforms),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedContent(data.results);
        setEditedContent({ ...data.results });
        setApprovedPlatforms(new Set());
        setCurrentPersonaId(selectedPersonaId);
        setCurrentOriginalPost(originalPost);
        setGenStep("review");
        showToast("Content generated successfully!", "success");
      } else {
        showToast(data.error || "Generation failed", "error");
      }
    } catch {
      showToast("Network error during generation", "error");
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove(platform: Platform) {
    setApprovingPlatform(platform);
    const persona = personas.find((p) => p._id === currentPersonaId);
    try {
      const res = await fetch("/api/cora/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: currentPersonaId,
          personaName: persona?.name ?? null,
          originalPost: currentOriginalPost,
          platform,
          content: editedContent[platform] || generatedContent[platform],
          status: "approved",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setApprovedPlatforms((prev) => new Set([...prev, platform]));
        setSavedRecords((prev) => [data.record, ...prev]);
        showToast(`${platformMeta(platform).label} content approved!`, "success");
      } else {
        showToast(data.error || "Approval failed", "error");
      }
    } catch {
      showToast("Network error saving content", "error");
    } finally {
      setApprovingPlatform(null);
    }
  }

  async function handleApproveAll() {
    const pending = Array.from(selectedPlatforms).filter(
      (p) => !approvedPlatforms.has(p) && generatedContent[p]
    );
    for (const platform of pending) await handleApprove(platform);
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!", "success");
  }

  // ── Saved content derived state ──────────────────────────────────────────
  const filteredRecords = savedRecords.filter((r) => {
    const matchPlatform = savedFilter === "all" || r.platform === savedFilter;
    const matchPersona = savedPersonaFilter === "all" || r.persona_id === savedPersonaFilter;
    return matchPlatform && matchPersona;
  });

  // Unique personas that appear in saved records
  const savedPersonaOptions = Array.from(
    new Map(
      savedRecords
        .filter((r) => r.persona_id)
        .map((r) => [r.persona_id, r.persona_name || r.persona_id])
    ).entries()
  );

  const selectedPersona = personas.find((p) => p._id === selectedPersonaId);
  const allApproved =
    approvedPlatforms.size > 0 &&
    Array.from(selectedPlatforms).every((p) => approvedPlatforms.has(p) || !generatedContent[p]);

  if (checking) return null;

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 animate-fade-in flex items-center gap-3 px-5 py-3 rounded-xl border text-sm font-semibold shadow-2xl"
          style={{
            background: toast.type === "success" ? "rgba(0,230,118,0.1)" : "rgba(239,68,68,0.1)",
            color: toast.type === "success" ? "#00e676" : "#ef4444",
            borderColor: toast.type === "success" ? "rgba(0,230,118,0.2)" : "rgba(239,68,68,0.2)",
            backdropFilter: "blur(12px)",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* HEADER */}
      <header
        className="sticky top-0 z-50 border-b"
        style={{ background: "rgba(8,9,16,0.85)", backdropFilter: "blur(16px)", borderColor: "rgba(255,255,255,0.06)" }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-4">
            <div
              className="flex items-center justify-center rounded-lg shadow-lg"
              style={{ width: 32, height: 32, background: CORA_GRADIENT }}
            >
              <Share2 size={16} stroke="white" />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>Cora</p>
              <p className="text-[11px]" style={{ color: "#4b5268" }}>Content Repurposing Bot</p>
            </div>
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <BotSwitcher currentBotId="cora" />
          </div>

          {/* Tab switcher */}
          <div className="flex items-center gap-1 p-1 rounded-xl border" style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(255,255,255,0.08)" }}>
            <button
              onClick={() => setPageView("generate")}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer"
              style={pageView === "generate"
                ? { background: CORA_GRADIENT, color: "#000" }
                : { color: "#6b7280" }}
            >
              <Share2 size={13} />
              Generate
            </button>
            <button
              onClick={() => setPageView("saved")}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer"
              style={pageView === "saved"
                ? { background: CORA_GRADIENT, color: "#000" }
                : { color: "#6b7280" }}
            >
              <Layers size={13} />
              Saved
              {savedRecords.length > 0 && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={pageView === "saved"
                    ? { background: "rgba(0,0,0,0.25)", color: "#000" }
                    : { background: "rgba(245,158,11,0.15)", color: CORA_COLOR }}
                >
                  {savedRecords.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {pageView === "generate" && genStep === "review" && (
              <button
                onClick={() => setGenStep("setup")}
                className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 font-medium transition-all border border-white/10 cursor-pointer"
              >
                <ChevronLeft size={13} /> New
              </button>
            )}
            <button
              onClick={() => { loadPersonas(); if (pageView === "saved") loadSavedContent(); }}
              disabled={loadingPersonas || loadingSaved}
              className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 font-medium transition-all border border-white/10 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={13} className={loadingPersonas || loadingSaved ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="relative z-10 mx-auto max-w-6xl px-6 py-8">

        {/* ══════════════ GENERATE VIEW ══════════════ */}
        {pageView === "generate" && (
          genStep === "setup" ? (
            <div className="animate-fade-in">
              <div className="mb-8">
                <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">
                  Content{" "}
                  <span className="bg-clip-text text-transparent" style={{ backgroundImage: CORA_GRADIENT }}>
                    Repurposing
                  </span>{" "}
                  Bot
                </h1>
                <p className="text-sm" style={{ color: "#5a5e72", maxWidth: 600 }}>
                  Select a Cara buyer persona, paste a LinkedIn post, choose your platforms — Cora repurposes it in the voice that resonates with your ideal client.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left */}
                <div className="space-y-6">
                  {/* Step 1: Persona */}
                  <div className="p-6 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-black" style={{ background: CORA_COLOR }}>1</div>
                      <h2 className="text-sm font-bold text-white">Select Cara Persona</h2>
                    </div>
                    {loadingPersonas ? (
                      <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
                        <RefreshCw size={14} className="animate-spin" /> Loading personas...
                      </div>
                    ) : personas.length === 0 ? (
                      <div className="text-center py-6">
                        <User size={32} className="text-gray-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No Cara personas found. Run Cara first to create a buyer persona.</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                        {personas.map((persona) => (
                          <button
                            key={persona._id}
                            onClick={() => setSelectedPersonaId(persona._id)}
                            className="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer"
                            style={{
                              background: selectedPersonaId === persona._id ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.02)",
                              borderColor: selectedPersonaId === persona._id ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.06)",
                            }}
                          >
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm text-white shrink-0" style={{ background: CORA_GRADIENT }}>
                              {persona.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-200 truncate">{persona.name}</p>
                              <p className="text-xs text-gray-500 truncate">{persona.headline}</p>
                            </div>
                            {selectedPersonaId === persona._id && (
                              <CheckCircle2 size={16} className="ml-auto shrink-0" style={{ color: CORA_COLOR }} />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedPersona && (
                      <div className="mt-4 p-3 rounded-xl text-xs" style={{ background: "rgba(245,158,11,0.05)", borderLeft: `3px solid ${CORA_COLOR}` }}>
                        <p className="text-amber-400 font-semibold mb-1">{selectedPersona.name}</p>
                        {selectedPersona.analysis?.personalityProfile?.tone && (
                          <p className="text-gray-400">Tone: {selectedPersona.analysis.personalityProfile.tone}</p>
                        )}
                        {selectedPersona.analysis?.buyerProfile?.buyerType && (
                          <p className="text-gray-400">Buyer type: {selectedPersona.analysis.buyerProfile.buyerType}</p>
                        )}
                        {selectedPersona.analysis?.executiveSummary && (
                          <p className="text-gray-500 mt-1 line-clamp-2">{selectedPersona.analysis.executiveSummary}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Step 2: LinkedIn post */}
                  <div className="p-6 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-black" style={{ background: CORA_COLOR }}>2</div>
                      <h2 className="text-sm font-bold text-white">Paste LinkedIn Post</h2>
                    </div>
                    <textarea
                      value={originalPost}
                      onChange={(e) => setOriginalPost(e.target.value)}
                      placeholder="Paste the LinkedIn post you want to repurpose here..."
                      rows={8}
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none transition-all"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#e5e7eb" }}
                      onFocus={(e) => (e.target.style.borderColor = "rgba(245,158,11,0.4)")}
                      onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
                    />
                    <p className="text-xs text-gray-600 mt-2">{originalPost.length} characters</p>
                  </div>
                </div>

                {/* Right */}
                <div className="space-y-6">
                  {/* Step 3: Platforms */}
                  <div className="p-6 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-black" style={{ background: CORA_COLOR }}>3</div>
                      <h2 className="text-sm font-bold text-white">Select Platforms</h2>
                    </div>
                    <div className="space-y-3">
                      {PLATFORMS.map((platform) => {
                        const selected = selectedPlatforms.has(platform.id);
                        return (
                          <button
                            key={platform.id}
                            onClick={() => togglePlatform(platform.id)}
                            className="w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer"
                            style={{
                              background: selected ? platform.bg : "rgba(255,255,255,0.02)",
                              borderColor: selected ? platform.color + "66" : "rgba(255,255,255,0.06)",
                            }}
                          >
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: selected ? platform.bg : "rgba(255,255,255,0.04)", border: `1px solid ${selected ? platform.color + "44" : "rgba(255,255,255,0.08)"}` }}>
                              <platform.icon size={18} style={{ color: selected ? platform.color : "#6b7280" }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold" style={{ color: selected ? "#e5e7eb" : "#9ca3af" }}>{platform.label}</p>
                              <p className="text-xs text-gray-600">{platform.description}</p>
                            </div>
                            <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all" style={{ borderColor: selected ? platform.color : "rgba(255,255,255,0.15)", background: selected ? platform.color : "transparent" }}>
                              {selected && <Check size={12} color="white" strokeWidth={3} />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-600 mt-3">{selectedPlatforms.size} platform{selectedPlatforms.size !== 1 ? "s" : ""} selected</p>
                  </div>

                  {/* Generate button */}
                  <button
                    onClick={handleGenerate}
                    disabled={generating || !selectedPersonaId || !originalPost.trim() || selectedPlatforms.size === 0}
                    className="w-full py-4 rounded-2xl font-bold text-black text-[15px] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: generating ? "rgba(245,158,11,0.5)" : CORA_GRADIENT, boxShadow: generating ? "none" : "0 4px 20px rgba(245,158,11,0.25)" }}
                  >
                    {generating ? <><RefreshCw size={18} className="animate-spin" /> Generating content...</> : <><Share2 size={18} /> Generate Platform Content</>}
                  </button>

                  {generating && (
                    <div className="p-4 rounded-xl text-sm text-center" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", color: "#d97706" }}>
                      Building persona-aligned content for {selectedPlatforms.size} platform{selectedPlatforms.size !== 1 ? "s" : ""}...
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ── Review step ── */
            <div className="animate-fade-in">
              <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl font-extrabold text-white mb-1">Review & Approve Content</h1>
                  <p className="text-sm" style={{ color: "#5a5e72" }}>
                    Edit each platform's content inline, then approve to save.
                    {selectedPersona && <span className="text-amber-500"> Writing for {selectedPersona.name}'s audience.</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {!allApproved ? (
                    <button
                      onClick={handleApproveAll}
                      disabled={!!approvingPlatform}
                      className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-bold text-black transition-all cursor-pointer disabled:opacity-50"
                      style={{ background: CORA_GRADIENT }}
                    >
                      <CheckCircle2 size={16} /> Approve All
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-bold" style={{ background: "rgba(0,230,118,0.1)", color: "#00e676" }}>
                      <CheckCircle2 size={16} /> All Approved
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {PLATFORMS.filter((p) => selectedPlatforms.has(p.id)).map((platform) => {
                  const content = editedContent[platform.id] || "";
                  const isApproved = approvedPlatforms.has(platform.id);
                  const isApproving = approvingPlatform === platform.id;
                  const isEditing = editingPlatform === platform.id;
                  const hasContent = !!generatedContent[platform.id];

                  return (
                    <div
                      key={platform.id}
                      className="rounded-2xl border overflow-hidden transition-all"
                      style={{ background: "rgba(0,0,0,0.4)", borderColor: isApproved ? "rgba(0,230,118,0.3)" : platform.color + "33" }}
                    >
                      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ background: isApproved ? "rgba(0,230,118,0.05)" : platform.bg, borderColor: isApproved ? "rgba(0,230,118,0.15)" : platform.color + "22" }}>
                        <div className="flex items-center gap-2.5">
                          <platform.icon size={18} style={{ color: isApproved ? "#00e676" : platform.color }} />
                          <span className="text-sm font-bold" style={{ color: isApproved ? "#00e676" : platform.color }}>{platform.label}</span>
                          {isApproved && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(0,230,118,0.15)", color: "#00e676" }}>APPROVED</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {hasContent && (
                            <>
                              <button onClick={() => handleCopy(editedContent[platform.id] || "")} className="p-1.5 rounded-lg transition-all cursor-pointer hover:bg-white/10 text-gray-400 hover:text-white" title="Copy">
                                <Copy size={14} />
                              </button>
                              {!isApproved && (
                                <button onClick={() => setEditingPlatform(isEditing ? null : platform.id)} className="p-1.5 rounded-lg transition-all cursor-pointer hover:bg-white/10" style={{ color: isEditing ? platform.color : "#6b7280" }} title="Edit">
                                  <Edit3 size={14} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="p-5">
                        {!hasContent ? (
                          <div className="flex items-center gap-2 text-gray-600 text-sm py-4"><FileText size={16} /> No content generated.</div>
                        ) : isEditing ? (
                          <textarea
                            value={content}
                            onChange={(e) => setEditedContent((prev) => ({ ...prev, [platform.id]: e.target.value }))}
                            rows={10}
                            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none transition-all"
                            style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${platform.color}44`, color: "#e5e7eb", lineHeight: 1.7 }}
                          />
                        ) : (
                          <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: isApproved ? "#9ca3af" : "#d1d5db" }}>{content}</div>
                        )}
                      </div>

                      {hasContent && !isApproved && (
                        <div className="px-5 pb-4 pt-1 flex items-center justify-between gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                          {isEditing ? (
                            <button onClick={() => setEditingPlatform(null)} className="text-xs text-gray-400 hover:text-white cursor-pointer transition-all">Done editing</button>
                          ) : (
                            <button onClick={() => setEditingPlatform(platform.id)} className="text-xs cursor-pointer transition-all" style={{ color: platform.color + "99" }}>Click edit icon to modify</button>
                          )}
                          <button
                            onClick={() => handleApprove(platform.id)}
                            disabled={isApproving}
                            className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                            style={{ background: platform.bg, color: platform.color, border: `1px solid ${platform.color}44` }}
                          >
                            {isApproving ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                            {isApproving ? "Saving..." : "Approve & Save"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Original post reference */}
              <div className="mt-8 p-5 rounded-2xl border" style={{ background: "rgba(0,0,0,0.25)", borderColor: "rgba(255,255,255,0.06)" }}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Original LinkedIn Post</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "#6b7280" }}>{currentOriginalPost}</p>
              </div>
            </div>
          )
        )}

        {/* ══════════════ SAVED VIEW ══════════════ */}
        {pageView === "saved" && (
          <div className="animate-fade-in">
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold text-white mb-1">Saved Content</h1>
              <p className="text-sm" style={{ color: "#5a5e72" }}>
                All approved content pieces across platforms and personas.
              </p>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              {/* Platform filter */}
              <div className="flex items-center gap-1 p-1 rounded-xl border" style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(255,255,255,0.08)" }}>
                <button
                  onClick={() => setSavedFilter("all")}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                  style={savedFilter === "all" ? { background: CORA_GRADIENT, color: "#000" } : { color: "#6b7280" }}
                >
                  All Platforms
                </button>
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSavedFilter(p.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                    style={savedFilter === p.id ? { background: p.bg, color: p.color, border: `1px solid ${p.color}44` } : { color: "#6b7280" }}
                  >
                    <p.icon size={12} />
                    {p.label.split(" ")[0]}
                  </button>
                ))}
              </div>

              {/* Persona filter */}
              {savedPersonaOptions.length > 1 && (
                <select
                  value={savedPersonaFilter}
                  onChange={(e) => setSavedPersonaFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold outline-none border cursor-pointer"
                  style={{ background: "rgba(0,0,0,0.5)", borderColor: "rgba(255,255,255,0.1)", color: "#d1d5db" }}
                >
                  <option value="all">All Personas</option>
                  {savedPersonaOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              )}

              <span className="text-xs text-gray-600 ml-auto">
                {filteredRecords.length} record{filteredRecords.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Records */}
            {loadingSaved ? (
              <div className="flex items-center justify-center gap-2 py-20 text-gray-500 text-sm">
                <RefreshCw size={16} className="animate-spin" /> Loading saved content...
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <Inbox size={40} className="text-gray-700 mb-3" />
                <p className="text-gray-400 font-semibold">No saved content yet</p>
                <p className="text-sm text-gray-600 mt-1">Generate and approve content to see it here.</p>
                <button
                  onClick={() => setPageView("generate")}
                  className="mt-4 px-5 py-2.5 rounded-xl text-sm font-bold text-black cursor-pointer"
                  style={{ background: CORA_GRADIENT }}
                >
                  Start Generating
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRecords.map((record) => {
                  const meta = platformMeta(record.platform);
                  const isExpanded = expandedRecord === record.id;
                  const preview = record.content.slice(0, 180) + (record.content.length > 180 ? "…" : "");

                  return (
                    <div
                      key={record.id}
                      className="rounded-2xl border overflow-hidden transition-all"
                      style={{ background: "rgba(0,0,0,0.4)", borderColor: meta.color + "22" }}
                    >
                      {/* Card header */}
                      <div
                        className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none"
                        onClick={() => setExpandedRecord(isExpanded ? null : record.id)}
                        style={{ background: meta.bg }}
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: meta.color + "22", border: `1px solid ${meta.color}33` }}>
                          <meta.icon size={15} style={{ color: meta.color }} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold" style={{ color: meta.color }}>{meta.label}</span>
                            {record.persona_name && (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(245,158,11,0.1)", color: "#d97706" }}>
                                {record.persona_name}
                              </span>
                            )}
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase" style={{ background: record.status === "approved" ? "rgba(0,230,118,0.12)" : "rgba(255,255,255,0.06)", color: record.status === "approved" ? "#00e676" : "#9ca3af" }}>
                              {record.status}
                            </span>
                          </div>
                          {!isExpanded && (
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{preview}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-gray-600 hidden sm:block">{formatDate(record.created_at)}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopy(record.content); }}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-all cursor-pointer"
                            title="Copy"
                          >
                            <Copy size={13} />
                          </button>
                          {isExpanded ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
                        </div>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="px-5 pb-5 pt-4" style={{ borderTop: `1px solid ${meta.color}18` }}>
                          <div className="text-sm leading-relaxed whitespace-pre-wrap text-gray-300 mb-4">
                            {record.content}
                          </div>

                          {/* Original post collapsible */}
                          <details className="group">
                            <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 transition-colors list-none flex items-center gap-1 select-none">
                              <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
                              View original LinkedIn post
                            </summary>
                            <div className="mt-2 p-3 rounded-xl text-xs leading-relaxed text-gray-500 whitespace-pre-wrap" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                              {record.original_post}
                            </div>
                          </details>

                          <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                            <span className="text-xs text-gray-600">Saved {formatDate(record.created_at)}</span>
                            <button
                              onClick={() => handleCopy(record.content)}
                              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg transition-all cursor-pointer"
                              style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33` }}
                            >
                              <Copy size={12} /> Copy Content
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
