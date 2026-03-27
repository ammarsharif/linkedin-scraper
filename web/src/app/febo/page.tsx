"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Target,
  RefreshCw,
  ChevronLeft,
  CheckCircle2,
  Copy,
  Edit3,
  Check,
  ChevronDown,
  ChevronUp,
  User,
  Facebook,
  Phone,
  MessageSquare,
  Monitor,
  Shield,
  MessageCircle,
  Users,
  Send,
  FileText,
  FolderOpen,
  Trash2,
} from "lucide-react";
import { BotSwitcher } from "@/components/BotSwitcher";

// ── Theme ─────────────────────────────────────────────────────────────────────
const FEBO_GRADIENT = "linear-gradient(135deg, #6366f1, #4f46e5, #3730a3)";
const FEBO_COLOR = "#6366f1";

// ── Content Renderer ──────────────────────────────────────────────────────────
// Detects UPPERCASE_LABEL: lines and renders them as styled section headers.
function ScriptContent({ text, accentColor }: { text: any; accentColor: string }) {
  let safeText = typeof text === 'string' ? text : Array.isArray(text) ? text.join('\n\n') : JSON.stringify(text, null, 2) || '';
  
  // Fix inline headers like "REPLY 1: Hello!" by splitting them onto a new line,
  // so the header parser can catch them.
  safeText = safeText.replace(/^([A-Z0-9][A-Z0-9\s\/\-()\.]{0,40}):\s+([^\n]+)/gm, '$1:\n$2');

  const lines = safeText.split(/\n/);
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Blank line → spacing
    if (trimmed === "") {
      elements.push(<div key={key++} style={{ height: 12 }} />);
      continue;
    }

    // Section header detection: short line, ends with colon, mostly uppercase
    // e.g. "OPENING:", "DISCOVERY QUESTIONS:", "REPLY 1:", "CONNECTION REQUEST NOTE:"
    const isHeader =
      trimmed.endsWith(":") &&
      trimmed.length <= 60 &&
      /^[A-Z0-9][A-Z0-9\s\/\-()\.]+:$/.test(trimmed);

    if (isHeader) {
      const label = trimmed.slice(0, -1); // strip trailing colon
      elements.push(
        <div key={key++} className="flex items-center gap-2 mt-2 mb-1">
          <span
            className="inline-block text-[10px] font-extrabold tracking-widest uppercase px-2.5 py-1 rounded-md"
            style={{ background: accentColor + "18", color: accentColor, border: `1px solid ${accentColor}30` }}
          >
            {label}
          </span>
          <div className="flex-1 h-px" style={{ background: accentColor + "18" }} />
        </div>
      );
      continue;
    }

    // Numbered list item e.g. "1." or "1)"
    const numberedMatch = trimmed.match(/^(\d+[\.\)])\s+(.+)$/);
    if (numberedMatch) {
      elements.push(
        <div key={key++} className="flex items-start gap-2.5 py-0.5 pl-1">
          <span
            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
            style={{ background: accentColor + "18", color: accentColor }}
          >
            {numberedMatch[1].replace(/[\.\)]/, "")}
          </span>
          <p className="text-sm leading-relaxed" style={{ color: "#d1d5db" }}>{numberedMatch[2]}</p>
        </div>
      );
      continue;
    }

    // Bullet "- text"
    const bulletMatch = trimmed.match(/^[-•]\s+(.+)$/);
    if (bulletMatch) {
      elements.push(
        <div key={key++} className="flex items-start gap-2 py-0.5 pl-1">
          <span className="shrink-0 w-1.5 h-1.5 rounded-full mt-2" style={{ background: accentColor + "99" }} />
          <p className="text-sm leading-relaxed" style={{ color: "#d1d5db" }}>{bulletMatch[1]}</p>
        </div>
      );
      continue;
    }

    // Inline cue like [PAUSE] [LISTEN] [REACT]
    const hasCue = /\[([A-Z\s]+)\]/.test(trimmed);
    if (hasCue) {
      const parts = trimmed.split(/(\[[A-Z\s]+\])/g);
      elements.push(
        <p key={key++} className="text-sm leading-relaxed py-0.5" style={{ color: "#d1d5db" }}>
          {parts.map((part, pi) =>
            /^\[[A-Z\s]+\]$/.test(part) ? (
              <span key={pi} className="inline-block mx-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider" style={{ background: "rgba(255,255,255,0.06)", color: "#9ca3af" }}>
                {part}
              </span>
            ) : part
          )}
        </p>
      );
      continue;
    }

    // Normal line
    elements.push(
      <p key={key++} className="text-sm leading-relaxed py-0.5" style={{ color: "#d1d5db" }}>
        {trimmed}
      </p>
    );
  }

  return <div className="space-y-0">{elements}</div>;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type FeboMode = "scripts" | "engagement" | "saved";
type InputMethod = "persona" | "manual";
type ScriptType = "sales_call" | "dm_chat" | "demo" | "objection_handling";
type EngagementType = "comment_reply" | "group_post" | "dm_outreach";

interface CaraPersona {
  _id: string;
  name: string;
  headline: string;
  analysis?: {
    executiveSummary?: string;
    personalityProfile?: { tone?: string };
    buyerProfile?: { buyerType?: string };
    professionalInsights?: { currentRole?: string };
  };
}

interface FacebookPost {
  _id: string;
  id: string;
  persona_id: string;
  persona_name?: string;
  content: string;
  original_post?: string;
  created_at: string;
}

interface ScriptMeta {
  id: ScriptType;
  label: string;
  icon: React.ElementType;
  description: string;
  color: string;
  bg: string;
}

interface EngagementMeta {
  id: EngagementType;
  label: string;
  icon: React.ElementType;
  description: string;
  color: string;
  bg: string;
}

const SCRIPT_TYPES: ScriptMeta[] = [
  { id: "sales_call", label: "Sales Call Script", icon: Phone, description: "Opening · Discovery · Pitch · Objections · Close", color: "#6366f1", bg: "rgba(99,102,241,0.1)" },
  { id: "dm_chat", label: "DM / Chat Script", icon: MessageSquare, description: "LinkedIn & Instagram message sequences", color: "#8b5cf6", bg: "rgba(139,92,246,0.1)" },
  { id: "demo", label: "Demo Script", icon: Monitor, description: "Structured product walkthrough with CTAs", color: "#06b6d4", bg: "rgba(6,182,212,0.1)" },
  { id: "objection_handling", label: "Objection Handling", icon: Shield, description: "Word-for-word responses to 6-8 objections", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
];

const ENGAGEMENT_TYPES: EngagementMeta[] = [
  { id: "comment_reply", label: "Comment Reply Templates", icon: MessageCircle, description: "5 varied replies to drive conversation", color: "#1877f2", bg: "rgba(24,119,242,0.1)" },
  { id: "group_post", label: "Group Post Adaptation", icon: Users, description: "Rewrite for Facebook group context", color: "#10b981", bg: "rgba(16,185,129,0.1)" },
  { id: "dm_outreach", label: "Facebook DM Outreach", icon: Send, description: "Short DM for people who engaged", color: "#e1306c", bg: "rgba(225,48,108,0.1)" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Saved Library Tab ─────────────────────────────────────────────────────────

function SavedLibraryTab({ showToast }: { showToast: (msg: string, type: "success" | "error") => void }) {
  const [activeSubTab, setActiveSubTab] = useState<"scripts" | "engagement">("scripts");
  const [loading, setLoading] = useState(false);
  const [scripts, setScripts] = useState<any[]>([]);
  const [engagements, setEngagements] = useState<any[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, eRes] = await Promise.all([
        fetch("/api/febo/approve-script"),
        fetch("/api/febo/approve-engagement"),
      ]);
      const [sData, eData] = await Promise.all([sRes.json(), eRes.json()]);
      if (sData.success) setScripts(sData.records || []);
      if (eData.success) setEngagements(eData.records || []);
    } catch {
      showToast("Failed to load saved items", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleDelete(id: string, type: "scripts" | "engagement") {
    if (!confirm("Delete this saved item?")) return;
    try {
      const endpoint = type === "scripts" ? "/api/febo/approve-script" : "/api/febo/approve-engagement";
      const res = await fetch(`${endpoint}?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showToast("Deleted successfully", "success");
        if (type === "scripts") setScripts(prev => prev.filter(s => s.id !== id));
        else setEngagements(prev => prev.filter(e => e.id !== id));
      } else {
        showToast(data.error || "Failed to delete", "error");
      }
    } catch {
      showToast("Network error", "error");
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!", "success");
  }

  const renderItem = (item: any, type: "scripts" | "engagement") => {
    const isExpanded = expandedId === item.id;
    const meta = type === "scripts" 
      ? SCRIPT_TYPES.find(s => s.id === item.script_type) 
      : ENGAGEMENT_TYPES.find(s => s.id === item.engagement_type);
      
    if (!meta) return null;

    let displayStr = item.content;
    if (typeof displayStr !== 'string') {
      displayStr = Array.isArray(item.content) ? item.content.join('\n\n') : JSON.stringify(item.content);
    } else {
      displayStr = displayStr.replace(/\\n/g, '\n');
    }
    
    return (
      <div key={item.id} className="rounded-2xl border overflow-hidden transition-all mb-4"
        style={{ background: "rgba(0,0,0,0.4)", borderColor: meta.color + "33" }}>
        <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none"
          onClick={() => setExpandedId(isExpanded ? null : item.id)}
          style={{ background: meta.bg, borderBottom: isExpanded ? `1px solid ${meta.color + "22"}` : "none" }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${meta.color + "44"}` }}>
            <meta.icon size={17} style={{ color: meta.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-bold" style={{ color: meta.color }}>{meta.label}</span>
              {item.persona_name && <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: "rgba(255,255,255,0.08)", color: "#a5b4fc" }}>{item.persona_name}</span>}
              <span className="text-[10px] text-gray-500">{new Date(item.created_at).toLocaleDateString()}</span>
            </div>
            {!isExpanded && (
              <p className="text-xs text-gray-600 truncate">{displayStr.slice(0, 100)}…</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={e => { e.stopPropagation(); handleCopy(displayStr); }}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-all cursor-pointer" title="Copy">
              <Copy size={13} />
            </button>
            <button onClick={e => { e.stopPropagation(); handleDelete(item.id, type); }}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-all cursor-pointer" title="Delete">
              <Trash2 size={13} />
            </button>
            {isExpanded ? <ChevronUp size={15} className="text-gray-500 ml-1" /> : <ChevronDown size={15} className="text-gray-500 ml-1" />}
          </div>
        </div>

        {isExpanded && (
          <div className="p-5">
            <ScriptContent text={displayStr} accentColor={meta.color} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="animate-fade-in pb-12">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Saved <span className="bg-clip-text text-transparent" style={{ backgroundImage: FEBO_GRADIENT }}>Library</span></h1>
        <p className="text-sm" style={{ color: "#5a5e72" }}>View all your explicitly approved sales scripts and engagement templates.</p>
      </div>

      <div className="flex gap-2 mb-6">
        <button onClick={() => setActiveSubTab("scripts")} className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer border"
          style={activeSubTab === "scripts" ? { background: "rgba(99,102,241,0.15)", borderColor: FEBO_COLOR, color: "#a5b4fc" } : { background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)", color: "#6b7280" }}>
          Sales Scripts ({scripts.length})
        </button>
        <button onClick={() => setActiveSubTab("engagement")} className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer border"
          style={activeSubTab === "engagement" ? { background: "rgba(99,102,241,0.15)", borderColor: FEBO_COLOR, color: "#a5b4fc" } : { background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)", color: "#6b7280" }}>
          Facebook Engagement ({engagements.length})
        </button>
      </div>

      {loading && scripts.length === 0 && engagements.length === 0 ? (
        <div className="py-12 flex justify-center"><RefreshCw className="animate-spin text-indigo-500" /></div>
      ) : activeSubTab === "scripts" ? (
        scripts.length > 0 ? scripts.map(s => renderItem(s, "scripts")) : <div className="text-center py-10 text-gray-500 text-sm">No saved scripts yet.</div>
      ) : (
        engagements.length > 0 ? engagements.map(e => renderItem(e, "engagement")) : <div className="text-center py-10 text-gray-500 text-sm">No saved engagement content yet.</div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function FeboPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<FeboMode>("scripts");

  // Shared data
  const [personas, setPersonas] = useState<CaraPersona[]>([]);
  const [facebookPosts, setFacebookPosts] = useState<FacebookPost[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Mode 1: Sales Scripts state ──────────────────────────────────────────
  const [scriptStep, setScriptStep] = useState<"setup" | "review">("setup");
  const [inputMethod, setInputMethod] = useState<InputMethod>("persona");
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [manualInput, setManualInput] = useState({ targetAudience: "", productService: "", mainPainPoint: "", keyObjection: "" });
  const [selectedScriptTypes, setSelectedScriptTypes] = useState<Set<ScriptType>>(new Set(["sales_call", "dm_chat"]));
  const [generatingScripts, setGeneratingScripts] = useState(false);
  const [generatedScripts, setGeneratedScripts] = useState<Record<ScriptType, any>>({} as Record<ScriptType, any>);
  const [editedScripts, setEditedScripts] = useState<Record<ScriptType, any>>({} as Record<ScriptType, any>);
  const [approvedScripts, setApprovedScripts] = useState<Set<ScriptType>>(new Set());
  const [approvingScript, setApprovingScript] = useState<ScriptType | null>(null);
  const [editingScript, setEditingScript] = useState<ScriptType | null>(null);
  const [expandedScript, setExpandedScript] = useState<ScriptType | null>(null);
  const [scriptPersonaId, setScriptPersonaId] = useState("");

  // ── Mode 2: Engagement state ─────────────────────────────────────────────
  const [engagementStep, setEngagementStep] = useState<"setup" | "review">("setup");
  const [selectedPostId, setSelectedPostId] = useState("");
  const [engPersonaId, setEngPersonaId] = useState("");
  const [selectedEngTypes, setSelectedEngTypes] = useState<Set<EngagementType>>(new Set(["comment_reply", "dm_outreach"]));
  const [generatingEng, setGeneratingEng] = useState(false);
  const [generatedEng, setGeneratedEng] = useState<Record<EngagementType, any>>({} as Record<EngagementType, any>);
  const [editedEng, setEditedEng] = useState<Record<EngagementType, any>>({} as Record<EngagementType, any>);
  const [approvedEng, setApprovedEng] = useState<Set<EngagementType>>(new Set());
  const [approvingEng, setApprovingEng] = useState<EngagementType | null>(null);
  const [editingEng, setEditingEng] = useState<EngagementType | null>(null);
  const [expandedEng, setExpandedEng] = useState<EngagementType | null>(null);
  const [engCoraId, setEngCoraId] = useState("");

  // Auth check
  useEffect(() => {
    fetch("/api/auth").then(r => r.json())
      .then(d => { if (!d.authenticated) router.push("/"); })
      .catch(() => router.push("/"))
      .finally(() => setChecking(false));
  }, [router]);

  // Load shared data
  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [pRes, fpRes] = await Promise.all([
        fetch("/api/febo/personas"),
        fetch("/api/febo/facebook-posts"),
      ]);
      const [pData, fpData] = await Promise.all([pRes.json(), fpRes.json()]);
      if (pData.personas) setPersonas(pData.personas);
      if (fpData.posts) setFacebookPosts(fpData.posts);
    } catch {
      showToast("Failed to load data", "error");
    } finally {
      setLoadingData(false);
    }
  }, [showToast]);

  useEffect(() => { if (!checking) loadData(); }, [checking, loadData]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function toggleScriptType(t: ScriptType) {
    setSelectedScriptTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
  }
  function toggleEngType(t: EngagementType) {
    setSelectedEngTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
  }

  // ── Mode 1: Generate Scripts ─────────────────────────────────────────────
  async function handleGenerateScripts() {
    if (inputMethod === "persona" && !selectedPersonaId) return showToast("Select a Cara persona.", "error");
    if (inputMethod === "manual" && !manualInput.targetAudience.trim()) return showToast("Fill in target audience.", "error");
    if (selectedScriptTypes.size === 0) return showToast("Select at least one script type.", "error");

    setGeneratingScripts(true);
    try {
      const body: Record<string, unknown> = { scriptTypes: Array.from(selectedScriptTypes) };
      if (inputMethod === "persona") body.personaId = selectedPersonaId;
      else body.manualInput = manualInput;

      const res = await fetch("/api/febo/generate-scripts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedScripts(data.results);
        setEditedScripts({ ...data.results });
        setApprovedScripts(new Set());
        setExpandedScript(Object.keys(data.results)[0] as ScriptType);
        setScriptPersonaId(selectedPersonaId);
        setScriptStep("review");
        showToast("Scripts generated!", "success");
      } else showToast(data.error || "Generation failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setGeneratingScripts(false); }
  }

  async function handleApproveScript(type: ScriptType) {
    setApprovingScript(type);
    const persona = personas.find(p => p._id === scriptPersonaId);
    try {
      const res = await fetch("/api/febo/approve-script", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: scriptPersonaId || null,
          personaName: persona?.name || null,
          manualInput: inputMethod === "manual" ? manualInput : null,
          scriptType: type,
          content: editedScripts[type] || generatedScripts[type],
          status: "approved",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setApprovedScripts(prev => new Set([...prev, type]));
        showToast(`${SCRIPT_TYPES.find(s => s.id === type)?.label} saved!`, "success");
      } else showToast(data.error || "Failed to save", "error");
    } catch { showToast("Network error", "error"); }
    finally { setApprovingScript(null); }
  }

  async function handleApproveAllScripts() {
    const pending = Array.from(selectedScriptTypes).filter(t => !approvedScripts.has(t) && generatedScripts[t]);
    for (const t of pending) await handleApproveScript(t);
  }

  // ── Mode 2: Generate Engagement ──────────────────────────────────────────
  async function handleGenerateEngagement() {
    const post = facebookPosts.find(p => p.id === selectedPostId || p._id?.toString() === selectedPostId);
    if (!post) return showToast("Select a Facebook post.", "error");
    if (selectedEngTypes.size === 0) return showToast("Select at least one engagement type.", "error");

    setGeneratingEng(true);
    try {
      const res = await fetch("/api/febo/generate-engagement", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coraContentId: post.id || post._id,
          facebookPostContent: post.content,
          personaId: engPersonaId || null,
          engagementTypes: Array.from(selectedEngTypes),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedEng(data.results);
        setEditedEng({ ...data.results });
        setApprovedEng(new Set());
        setExpandedEng(Object.keys(data.results)[0] as EngagementType);
        setEngCoraId(post.id || post._id?.toString());
        setEngagementStep("review");
        showToast("Engagement content generated!", "success");
      } else showToast(data.error || "Generation failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setGeneratingEng(false); }
  }

  async function handleApproveEng(type: EngagementType) {
    setApprovingEng(type);
    const persona = personas.find(p => p._id === engPersonaId);
    try {
      const res = await fetch("/api/febo/approve-engagement", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coraContentId: engCoraId || null,
          personaId: engPersonaId || null,
          personaName: persona?.name || null,
          engagementType: type,
          content: editedEng[type] || generatedEng[type],
          status: "approved",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setApprovedEng(prev => new Set([...prev, type]));
        showToast(`${ENGAGEMENT_TYPES.find(e => e.id === type)?.label} saved!`, "success");
      } else showToast(data.error || "Failed to save", "error");
    } catch { showToast("Network error", "error"); }
    finally { setApprovingEng(null); }
  }

  async function handleApproveAllEng() {
    const pending = Array.from(selectedEngTypes).filter(t => !approvedEng.has(t) && generatedEng[t]);
    for (const t of pending) await handleApproveEng(t);
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!", "success");
  }

  const selectedPersona = personas.find(p => p._id === selectedPersonaId);
  const selectedPost = facebookPosts.find(p => p.id === selectedPostId || p._id?.toString() === selectedPostId);
  const engPersona = personas.find(p => p._id === engPersonaId);

  const allScriptsApproved = approvedScripts.size > 0 && Array.from(selectedScriptTypes).every(t => approvedScripts.has(t) || !generatedScripts[t]);
  const allEngApproved = approvedEng.size > 0 && Array.from(selectedEngTypes).every(t => approvedEng.has(t) || !generatedEng[t]);

  if (checking) return null;

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in flex items-center gap-3 px-5 py-3 rounded-xl border text-sm font-semibold shadow-2xl"
          style={{ background: toast.type === "success" ? "rgba(0,230,118,0.1)" : "rgba(239,68,68,0.1)", color: toast.type === "success" ? "#00e676" : "#ef4444", borderColor: toast.type === "success" ? "rgba(0,230,118,0.2)" : "rgba(239,68,68,0.2)", backdropFilter: "blur(12px)" }}>
          {toast.message}
        </div>
      )}

      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b" style={{ background: "rgba(8,9,16,0.85)", backdropFilter: "blur(16px)", borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center rounded-lg shadow-lg" style={{ width: 32, height: 32, background: FEBO_GRADIENT }}>
              <Target size={16} stroke="white" />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>Febo</p>
              <p className="text-[11px]" style={{ color: "#4b5268" }}>Sales Script & Facebook Engagement Bot</p>
            </div>
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <BotSwitcher currentBotId="febo" />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl border" style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(255,255,255,0.08)" }}>
            <button onClick={() => setMode("scripts")}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer"
              style={mode === "scripts" ? { background: FEBO_GRADIENT, color: "#fff" } : { color: "#6b7280" }}>
              <FileText size={13} /> Sales Scripts
            </button>
            <button onClick={() => setMode("engagement")}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer"
              style={mode === "engagement" ? { background: FEBO_GRADIENT, color: "#fff" } : { color: "#6b7280" }}>
              <Facebook size={13} /> Facebook Engagement
            </button>
            <button onClick={() => setMode("saved")}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer"
              style={mode === "saved" ? { background: FEBO_GRADIENT, color: "#fff" } : { color: "#6b7280" }}>
              <FolderOpen size={13} /> Saved Library
            </button>
          </div>

          <div className="flex items-center gap-2">
            {mode === "scripts" && scriptStep === "review" && (
              <button onClick={() => setScriptStep("setup")} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 font-medium transition-all border border-white/10 cursor-pointer">
                <ChevronLeft size={13} /> New
              </button>
            )}
            {mode === "engagement" && engagementStep === "review" && (
              <button onClick={() => setEngagementStep("setup")} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 font-medium transition-all border border-white/10 cursor-pointer">
                <ChevronLeft size={13} /> New
              </button>
            )}
            <button onClick={loadData} disabled={loadingData} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 font-medium transition-all border border-white/10 cursor-pointer disabled:opacity-50">
              <RefreshCw size={13} className={loadingData ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="relative z-10 mx-auto max-w-6xl px-6 py-8">

        {/* ══════════════ MODE 1: SALES SCRIPTS ══════════════ */}
        {mode === "scripts" && (
          scriptStep === "setup" ? (
            <div className="animate-fade-in">
              <div className="mb-8">
                <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">
                  Sales Script <span className="bg-clip-text text-transparent" style={{ backgroundImage: FEBO_GRADIENT }}>Generator</span>
                </h1>
                <p className="text-sm" style={{ color: "#5a5e72", maxWidth: 600 }}>
                  Generate human, ready-to-use sales scripts tailored to your buyer persona or manual inputs.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Input */}
                <div className="space-y-5">

                  {/* Input method toggle */}
                  <div className="p-5 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: FEBO_COLOR }}>1</div>
                      <h2 className="text-sm font-bold text-white">Choose Input Method</h2>
                    </div>
                    <div className="flex gap-2">
                      {(["persona", "manual"] as InputMethod[]).map(m => (
                        <button key={m} onClick={() => setInputMethod(m)}
                          className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all cursor-pointer"
                          style={inputMethod === m
                            ? { background: "rgba(99,102,241,0.15)", borderColor: FEBO_COLOR, color: "#a5b4fc" }
                            : { background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)", color: "#6b7280" }}>
                          {m === "persona" ? "Cara Persona" : "Manual Input"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Persona picker */}
                  {inputMethod === "persona" && (
                    <div className="p-5 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: FEBO_COLOR }}>2</div>
                        <h2 className="text-sm font-bold text-white">Select Cara Persona</h2>
                      </div>
                      {loadingData ? (
                        <div className="flex items-center gap-2 text-gray-500 text-sm py-3"><RefreshCw size={13} className="animate-spin" /> Loading...</div>
                      ) : personas.length === 0 ? (
                        <div className="text-center py-6"><User size={28} className="text-gray-600 mx-auto mb-2" /><p className="text-sm text-gray-500">No personas found. Run Cara first.</p></div>
                      ) : (
                        <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                          {personas.map(p => (
                            <button key={p._id} onClick={() => setSelectedPersonaId(p._id)}
                              className="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer"
                              style={{ background: selectedPersonaId === p._id ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.02)", borderColor: selectedPersonaId === p._id ? FEBO_COLOR + "66" : "rgba(255,255,255,0.06)" }}>
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-white shrink-0" style={{ background: FEBO_GRADIENT }}>{p.name.charAt(0)}</div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-200 truncate">{p.name}</p>
                                <p className="text-xs text-gray-500 truncate">{p.headline}</p>
                              </div>
                              {selectedPersonaId === p._id && <CheckCircle2 size={15} className="ml-auto shrink-0" style={{ color: FEBO_COLOR }} />}
                            </button>
                          ))}
                        </div>
                      )}
                      {selectedPersona && (
                        <div className="mt-3 p-3 rounded-xl text-xs" style={{ background: "rgba(99,102,241,0.05)", borderLeft: `3px solid ${FEBO_COLOR}` }}>
                          <p className="font-semibold mb-1" style={{ color: "#a5b4fc" }}>{selectedPersona.name}</p>
                          {selectedPersona.analysis?.personalityProfile?.tone && <p className="text-gray-400">Tone: {selectedPersona.analysis.personalityProfile.tone}</p>}
                          {selectedPersona.analysis?.buyerProfile?.buyerType && <p className="text-gray-400">Buyer: {selectedPersona.analysis.buyerProfile.buyerType}</p>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manual input form */}
                  {inputMethod === "manual" && (
                    <div className="p-5 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: FEBO_COLOR }}>2</div>
                        <h2 className="text-sm font-bold text-white">Target & Context</h2>
                      </div>
                      <div className="space-y-3">
                        {[
                          { key: "targetAudience", label: "Target Audience", placeholder: "e.g. SaaS founders with 10-50 employees looking to automate outreach" },
                          { key: "productService", label: "Product / Service", placeholder: "e.g. AI-powered LinkedIn automation tool" },
                          { key: "mainPainPoint", label: "Main Pain Point", placeholder: "e.g. Spending 3+ hours/day manually messaging leads" },
                          { key: "keyObjection", label: "Key Objection to Handle", placeholder: "e.g. We already use another tool / Too expensive" },
                        ].map(field => (
                          <div key={field.key}>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">{field.label}</label>
                            <input
                              value={manualInput[field.key as keyof typeof manualInput]}
                              onChange={e => setManualInput(prev => ({ ...prev, [field.key]: e.target.value }))}
                              placeholder={field.placeholder}
                              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all"
                              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#e5e7eb" }}
                              onFocus={e => e.target.style.borderColor = FEBO_COLOR + "66"}
                              onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Script types + generate */}
                <div className="space-y-5">
                  <div className="p-5 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: FEBO_COLOR }}>3</div>
                      <h2 className="text-sm font-bold text-white">Select Script Types</h2>
                    </div>
                    <div className="space-y-2.5">
                      {SCRIPT_TYPES.map(st => {
                        const selected = selectedScriptTypes.has(st.id);
                        return (
                          <button key={st.id} onClick={() => toggleScriptType(st.id)}
                            className="w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer"
                            style={{ background: selected ? st.bg : "rgba(255,255,255,0.02)", borderColor: selected ? st.color + "55" : "rgba(255,255,255,0.06)" }}>
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                              style={{ background: selected ? st.bg : "rgba(255,255,255,0.03)", border: `1px solid ${selected ? st.color + "44" : "rgba(255,255,255,0.06)"}` }}>
                              <st.icon size={17} style={{ color: selected ? st.color : "#4b5568" }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold" style={{ color: selected ? "#e5e7eb" : "#9ca3af" }}>{st.label}</p>
                              <p className="text-xs text-gray-600">{st.description}</p>
                            </div>
                            <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all"
                              style={{ borderColor: selected ? st.color : "rgba(255,255,255,0.15)", background: selected ? st.color : "transparent" }}>
                              {selected && <Check size={11} color="white" strokeWidth={3} />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-600 mt-3">{selectedScriptTypes.size} type{selectedScriptTypes.size !== 1 ? "s" : ""} selected</p>
                  </div>

                  <button onClick={handleGenerateScripts}
                    disabled={generatingScripts || selectedScriptTypes.size === 0 || (inputMethod === "persona" && !selectedPersonaId) || (inputMethod === "manual" && !manualInput.targetAudience.trim())}
                    className="w-full py-4 rounded-2xl font-bold text-white text-[15px] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: generatingScripts ? "rgba(99,102,241,0.4)" : FEBO_GRADIENT, boxShadow: generatingScripts ? "none" : "0 4px 20px rgba(99,102,241,0.3)" }}>
                    {generatingScripts ? <><RefreshCw size={18} className="animate-spin" /> Generating scripts...</> : <><Target size={18} /> Generate Sales Scripts</>}
                  </button>

                  {generatingScripts && (
                    <div className="p-4 rounded-xl text-sm text-center" style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", color: "#818cf8" }}>
                      Writing {selectedScriptTypes.size} script{selectedScriptTypes.size !== 1 ? "s" : ""} — this takes ~15 seconds...
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ── Script Review ── */
            <div className="animate-fade-in">
              <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl font-extrabold text-white mb-1">Review & Approve Scripts</h1>
                  <p className="text-sm" style={{ color: "#5a5e72" }}>
                    Edit each script inline then approve to save to your library.
                    {scriptPersonaId && selectedPersona && <span style={{ color: "#a5b4fc" }}> Tailored for {selectedPersona.name}.</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {!allScriptsApproved ? (
                    <button onClick={handleApproveAllScripts} disabled={!!approvingScript}
                      className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-bold text-white transition-all cursor-pointer disabled:opacity-50"
                      style={{ background: FEBO_GRADIENT }}>
                      <CheckCircle2 size={16} /> Approve All
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-bold" style={{ background: "rgba(0,230,118,0.1)", color: "#00e676" }}>
                      <CheckCircle2 size={16} /> All Saved
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                {SCRIPT_TYPES.filter(st => selectedScriptTypes.has(st.id)).map(st => {
                  const contentRaw = editedScripts[st.id] || "";
                  const content = typeof contentRaw === 'string' ? contentRaw : Array.isArray(contentRaw) ? contentRaw.join('\n\n') : JSON.stringify(contentRaw, null, 2);
                  const isApproved = approvedScripts.has(st.id);
                  const isApproving = approvingScript === st.id;
                  const isEditing = editingScript === st.id;
                  const isExpanded = expandedScript === st.id;
                  const hasContent = !!generatedScripts[st.id];

                  return (
                    <div key={st.id} className="rounded-2xl border overflow-hidden transition-all"
                      style={{ background: "rgba(0,0,0,0.4)", borderColor: isApproved ? "rgba(0,230,118,0.3)" : st.color + "33" }}>
                      {/* Card header — click to expand */}
                      <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none"
                        onClick={() => setExpandedScript(isExpanded ? null : st.id)}
                        style={{ background: isApproved ? "rgba(0,230,118,0.05)" : st.bg, borderBottom: isExpanded ? `1px solid ${isApproved ? "rgba(0,230,118,0.1)" : st.color + "22"}` : "none" }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: isApproved ? "rgba(0,230,118,0.1)" : st.bg, border: `1px solid ${isApproved ? "rgba(0,230,118,0.2)" : st.color + "33"}` }}>
                          <st.icon size={17} style={{ color: isApproved ? "#00e676" : st.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold" style={{ color: isApproved ? "#00e676" : st.color }}>{st.label}</span>
                            {isApproved && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(0,230,118,0.15)", color: "#00e676" }}>SAVED</span>}
                          </div>
                          {!isExpanded && hasContent && (
                            <p className="text-xs text-gray-600 truncate mt-0.5">{content.slice(0, 100)}…</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {hasContent && (
                            <button onClick={e => { e.stopPropagation(); handleCopy(content); }}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-all cursor-pointer" title="Copy">
                              <Copy size={13} />
                            </button>
                          )}
                          {isExpanded ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
                        </div>
                      </div>

                      {/* Expanded body */}
                      {isExpanded && (
                        <div className="p-5">
                          {!hasContent ? (
                            <div className="flex items-center gap-2 text-gray-600 text-sm py-3"><FileText size={15} /> No content generated.</div>
                          ) : isEditing ? (
                            <textarea
                              value={content}
                              onChange={e => setEditedScripts(prev => ({ ...prev, [st.id]: e.target.value }))}
                              rows={16}
                              className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none transition-all font-mono"
                              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${st.color}44`, color: "#e5e7eb", lineHeight: 1.75 }}
                            />
                          ) : (
                            <div style={{ opacity: isApproved ? 0.55 : 1 }}>
                              <ScriptContent text={content} accentColor={st.color} />
                            </div>
                          )}

                          {hasContent && !isApproved && (
                            <div className="flex items-center justify-between gap-3 mt-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                              <button onClick={() => setEditingScript(isEditing ? null : st.id)}
                                className="flex items-center gap-1.5 text-xs cursor-pointer transition-all"
                                style={{ color: isEditing ? st.color : "#6b7280" }}>
                                <Edit3 size={12} /> {isEditing ? "Done editing" : "Edit script"}
                              </button>
                              <button onClick={() => handleApproveScript(st.id)} disabled={isApproving}
                                className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                                style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}44` }}>
                                {isApproving ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                {isApproving ? "Saving..." : "Approve & Save"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* ══════════════ MODE 2: FACEBOOK ENGAGEMENT ══════════════ */}
        {mode === "engagement" && (
          engagementStep === "setup" ? (
            <div className="animate-fade-in">
              <div className="mb-8">
                <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">
                  Facebook <span className="bg-clip-text text-transparent" style={{ backgroundImage: FEBO_GRADIENT }}>Engagement Bot</span>
                </h1>
                <p className="text-sm" style={{ color: "#5a5e72", maxWidth: 600 }}>
                  Turn Cora's approved Facebook content into comment replies, group posts, and DM outreach — all ready to copy and send.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left */}
                <div className="space-y-5">

                  {/* Step 1: Facebook post */}
                  <div className="p-5 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: FEBO_COLOR }}>1</div>
                      <h2 className="text-sm font-bold text-white">Select Facebook Post (from Cora)</h2>
                    </div>
                    {loadingData ? (
                      <div className="flex items-center gap-2 text-gray-500 text-sm py-3"><RefreshCw size={13} className="animate-spin" /> Loading...</div>
                    ) : facebookPosts.length === 0 ? (
                      <div className="text-center py-6">
                        <Facebook size={28} className="text-gray-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No approved Facebook posts found.</p>
                        <p className="text-xs text-gray-600 mt-1">Generate and approve Facebook content in Cora first.</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                        {facebookPosts.map(post => {
                          const postId = post.id || post._id?.toString();
                          const isSelected = selectedPostId === postId;
                          return (
                            <button key={postId} onClick={() => setSelectedPostId(postId)}
                              className="w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer"
                              style={{ background: isSelected ? "rgba(24,119,242,0.08)" : "rgba(255,255,255,0.02)", borderColor: isSelected ? "#1877f266" : "rgba(255,255,255,0.06)" }}>
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: isSelected ? "rgba(24,119,242,0.15)" : "rgba(255,255,255,0.05)" }}>
                                <Facebook size={13} style={{ color: isSelected ? "#1877f2" : "#6b7280" }} />
                              </div>
                              <div className="min-w-0 flex-1">
                                {post.persona_name && <p className="text-[10px] font-semibold mb-0.5" style={{ color: "#d97706" }}>{post.persona_name}</p>}
                                <p className="text-xs text-gray-400 line-clamp-2">{post.content}</p>
                                <p className="text-[10px] text-gray-600 mt-1">{formatDate(post.created_at)}</p>
                              </div>
                              {isSelected && <CheckCircle2 size={14} className="shrink-0 mt-0.5" style={{ color: "#1877f2" }} />}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {selectedPost && (
                      <div className="mt-3 p-3 rounded-xl text-xs" style={{ background: "rgba(24,119,242,0.05)", borderLeft: "3px solid #1877f2" }}>
                        <p className="text-blue-400 font-semibold mb-1">Selected Post Preview</p>
                        <p className="text-gray-400 line-clamp-3">{selectedPost.content}</p>
                      </div>
                    )}
                  </div>

                  {/* Step 2: Optional persona */}
                  <div className="p-5 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: FEBO_COLOR }}>2</div>
                      <h2 className="text-sm font-bold text-white">Persona for Tone Matching <span className="text-[11px] font-normal text-gray-500">(optional)</span></h2>
                    </div>
                    {personas.length === 0 ? (
                      <p className="text-xs text-gray-600">No personas available.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                        <button onClick={() => setEngPersonaId("")}
                          className="w-full flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer text-xs"
                          style={{ background: !engPersonaId ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.02)", borderColor: !engPersonaId ? FEBO_COLOR + "44" : "rgba(255,255,255,0.06)", color: !engPersonaId ? "#a5b4fc" : "#6b7280" }}>
                          No persona — use post tone as-is
                        </button>
                        {personas.map(p => (
                          <button key={p._id} onClick={() => setEngPersonaId(p._id)}
                            className="w-full flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer"
                            style={{ background: engPersonaId === p._id ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.02)", borderColor: engPersonaId === p._id ? FEBO_COLOR + "44" : "rgba(255,255,255,0.06)" }}>
                            <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: FEBO_GRADIENT }}>{p.name.charAt(0)}</div>
                            <p className="text-xs font-medium text-gray-300 truncate">{p.name}</p>
                            {engPersonaId === p._id && <CheckCircle2 size={12} className="ml-auto shrink-0" style={{ color: FEBO_COLOR }} />}
                          </button>
                        ))}
                      </div>
                    )}
                    {engPersona && (
                      <p className="text-xs mt-2" style={{ color: "#818cf8" }}>Tone: {engPersona.analysis?.personalityProfile?.tone || "—"}</p>
                    )}
                  </div>
                </div>

                {/* Right */}
                <div className="space-y-5">
                  <div className="p-5 rounded-2xl border" style={{ background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: FEBO_COLOR }}>3</div>
                      <h2 className="text-sm font-bold text-white">Select Engagement Types</h2>
                    </div>
                    <div className="space-y-2.5">
                      {ENGAGEMENT_TYPES.map(et => {
                        const selected = selectedEngTypes.has(et.id);
                        return (
                          <button key={et.id} onClick={() => toggleEngType(et.id)}
                            className="w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer"
                            style={{ background: selected ? et.bg : "rgba(255,255,255,0.02)", borderColor: selected ? et.color + "55" : "rgba(255,255,255,0.06)" }}>
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                              style={{ background: selected ? et.bg : "rgba(255,255,255,0.03)", border: `1px solid ${selected ? et.color + "44" : "rgba(255,255,255,0.06)"}` }}>
                              <et.icon size={17} style={{ color: selected ? et.color : "#4b5568" }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold" style={{ color: selected ? "#e5e7eb" : "#9ca3af" }}>{et.label}</p>
                              <p className="text-xs text-gray-600">{et.description}</p>
                            </div>
                            <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all"
                              style={{ borderColor: selected ? et.color : "rgba(255,255,255,0.15)", background: selected ? et.color : "transparent" }}>
                              {selected && <Check size={11} color="white" strokeWidth={3} />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button onClick={handleGenerateEngagement}
                    disabled={generatingEng || !selectedPostId || selectedEngTypes.size === 0}
                    className="w-full py-4 rounded-2xl font-bold text-white text-[15px] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: generatingEng ? "rgba(99,102,241,0.4)" : FEBO_GRADIENT, boxShadow: generatingEng ? "none" : "0 4px 20px rgba(99,102,241,0.3)" }}>
                    {generatingEng ? <><RefreshCw size={18} className="animate-spin" /> Generating...</> : <><Facebook size={18} /> Generate Engagement Content</>}
                  </button>

                  {generatingEng && (
                    <div className="p-4 rounded-xl text-sm text-center" style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", color: "#818cf8" }}>
                      Creating {selectedEngTypes.size} engagement piece{selectedEngTypes.size !== 1 ? "s" : ""}...
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ── Engagement Review ── */
            <div className="animate-fade-in">
              <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl font-extrabold text-white mb-1">Review Engagement Content</h1>
                  <p className="text-sm" style={{ color: "#5a5e72" }}>
                    Edit each piece inline then approve to save.
                    {engPersona && <span style={{ color: "#a5b4fc" }}> Tone matched to {engPersona.name}.</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {!allEngApproved ? (
                    <button onClick={handleApproveAllEng} disabled={!!approvingEng}
                      className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-bold text-white transition-all cursor-pointer disabled:opacity-50"
                      style={{ background: FEBO_GRADIENT }}>
                      <CheckCircle2 size={16} /> Approve All
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl font-bold" style={{ background: "rgba(0,230,118,0.1)", color: "#00e676" }}>
                      <CheckCircle2 size={16} /> All Saved
                    </div>
                  )}
                </div>
              </div>

              {/* Selected post reference */}
              {selectedPost && (
                <div className="mb-5 p-4 rounded-xl border" style={{ background: "rgba(24,119,242,0.05)", borderColor: "rgba(24,119,242,0.2)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Facebook size={13} style={{ color: "#1877f2" }} />
                    <span className="text-xs font-semibold" style={{ color: "#1877f2" }}>Source Facebook Post</span>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-3">{selectedPost.content}</p>
                </div>
              )}

              <div className="space-y-4">
                {ENGAGEMENT_TYPES.filter(et => selectedEngTypes.has(et.id)).map(et => {
                  const contentRaw = editedEng[et.id] || "";
                  const content = typeof contentRaw === 'string' ? contentRaw : Array.isArray(contentRaw) ? contentRaw.join('\n\n') : JSON.stringify(contentRaw, null, 2);
                  const isApproved = approvedEng.has(et.id);
                  const isApproving = approvingEng === et.id;
                  const isEditing = editingEng === et.id;
                  const isExpanded = expandedEng === et.id;
                  const hasContent = !!generatedEng[et.id];

                  return (
                    <div key={et.id} className="rounded-2xl border overflow-hidden transition-all"
                      style={{ background: "rgba(0,0,0,0.4)", borderColor: isApproved ? "rgba(0,230,118,0.3)" : et.color + "33" }}>
                      <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none"
                        onClick={() => setExpandedEng(isExpanded ? null : et.id)}
                        style={{ background: isApproved ? "rgba(0,230,118,0.05)" : et.bg, borderBottom: isExpanded ? `1px solid ${isApproved ? "rgba(0,230,118,0.1)" : et.color + "22"}` : "none" }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: isApproved ? "rgba(0,230,118,0.1)" : et.bg, border: `1px solid ${isApproved ? "rgba(0,230,118,0.2)" : et.color + "33"}` }}>
                          <et.icon size={17} style={{ color: isApproved ? "#00e676" : et.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold" style={{ color: isApproved ? "#00e676" : et.color }}>{et.label}</span>
                            {isApproved && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(0,230,118,0.15)", color: "#00e676" }}>SAVED</span>}
                          </div>
                          {!isExpanded && hasContent && (
                            <p className="text-xs text-gray-600 truncate mt-0.5">{content.slice(0, 100)}…</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {hasContent && (
                            <button onClick={e => { e.stopPropagation(); handleCopy(content); }}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-all cursor-pointer" title="Copy">
                              <Copy size={13} />
                            </button>
                          )}
                          {isExpanded ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-5">
                          {!hasContent ? (
                            <div className="flex items-center gap-2 text-gray-600 text-sm py-3"><FileText size={15} /> No content generated.</div>
                          ) : isEditing ? (
                            <textarea
                              value={content}
                              onChange={e => setEditedEng(prev => ({ ...prev, [et.id]: e.target.value }))}
                              rows={12}
                              className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none transition-all"
                              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${et.color}44`, color: "#e5e7eb", lineHeight: 1.75 }}
                            />
                          ) : (
                            <div style={{ opacity: isApproved ? 0.55 : 1 }}>
                              <ScriptContent text={content} accentColor={et.color} />
                            </div>
                          )}

                          {hasContent && !isApproved && (
                            <div className="flex items-center justify-between gap-3 mt-4 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                              <button onClick={() => setEditingEng(isEditing ? null : et.id)}
                                className="flex items-center gap-1.5 text-xs cursor-pointer transition-all"
                                style={{ color: isEditing ? et.color : "#6b7280" }}>
                                <Edit3 size={12} /> {isEditing ? "Done editing" : "Edit content"}
                              </button>
                              <button onClick={() => handleApproveEng(et.id)} disabled={isApproving}
                                className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                                style={{ background: et.bg, color: et.color, border: `1px solid ${et.color}44` }}>
                                {isApproving ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                {isApproving ? "Saving..." : "Approve & Save"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* ══════════════ MODE 3: SAVED LIBRARY ══════════════ */}
        {mode === "saved" && (
          <SavedLibraryTab showToast={showToast} />
        )}
      </main>
    </div>
  );
}
