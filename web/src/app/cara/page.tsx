"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Linkedin, Search, RefreshCw, UserCheck, Copy, ChevronLeft, MessageCircle,
  Lightbulb, FlaskConical, Users, Send, Brain, Shield, Target, TrendingUp,
  AlertTriangle, Sparkles, Plus, Trash2, Eye, X, Clock, Zap, MessageSquare,
} from "lucide-react";
import { BotSwitcher } from "@/components/BotSwitcher";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PersonaAnalysis {
  executiveSummary?: string;
  personalityProfile?: { communicationStyle?: string; tone?: string; values?: string[]; motivations?: string[]; petPeeves?: string[]; decisionMakingStyle?: string; };
  professionalInsights?: { currentRole?: string; currentFocus?: string; industryExpertise?: string[]; areasOfExpertise?: string[]; challenges?: string[]; achievements?: string[]; toolsAndTech?: string[]; careerTrajectory?: string; };
  buyerProfile?: { buyerType?: string; decisionFactors?: string[]; likelyObjections?: string[]; buyingTriggers?: string[]; dealBreakers?: string[]; warmthLevel?: number; trustBuilders?: string[]; };
  simulationGuidelines?: { howTheyGreet?: string; responseLength?: string; questionStyle?: string; objectionStyle?: string; samplePhrases?: string[]; topicsTheyLove?: string[]; topicsToAvoid?: string[]; };
  salesApproach?: { bestApproach?: string; openingAngles?: string[]; keyMessages?: string[]; doThis?: string[]; avoidThis?: string[]; followUpStrategy?: string; };
  quotableContent?: { memorableQuotes?: string[]; recurringThemes?: string[]; strongOpinions?: string[]; };
}

interface Persona {
  _id: string;
  profileUrl: string;
  vanityName: string;
  name: string;
  headline: string;
  location: string;
  about?: string;
  analysis: PersonaAnalysis;
  postsAnalyzed?: number;
  scrapedAt: string;
  lastUpdated: string;
  lastSimulatedAt?: string;
}

interface SimMessage { role: "user" | "persona"; content: string; timestamp: string; }
interface SimSession { _id: string; sessionId: string; personaId: string; personaName: string; messages: SimMessage[]; lastActivity: string; createdAt: string; }

const CARA_GRADIENT = "linear-gradient(135deg, #f43f5e, #e11d48, #be123c)";
const CARA_COLOR = "#f43f5e";

type TabId = "personas" | "staging" | "script-lab";

export default function CaraPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("personas");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Personas state
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add persona state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProfileUrl, setNewProfileUrl] = useState("");
  const [postsLimit, setPostsLimit] = useState(10);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState(0);

  // Staging / Simulation state
  const [simMessages, setSimMessages] = useState<SimMessage[]>([]);
  const [simInput, setSimInput] = useState("");
  const [simSending, setSimSending] = useState(false);
  const [simSessionId, setSimSessionId] = useState<string | null>(null);
  const [simSessions, setSimSessions] = useState<SimSession[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    fetch("/api/auth").then(r => r.json())
      .then(d => { if (!d.authenticated) router.push("/"); })
      .catch(() => router.push("/"))
      .finally(() => setChecking(false));
  }, [router]);

  // ── Personas loading ──
  const loadPersonas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cara/personas");
      const data = await res.json();
      if (data.success) setPersonas(data.personas || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!checking) loadPersonas(); }, [checking, loadPersonas]);

  // ── Analyze new profile ──
  const ANALYZE_STEPS = ["Connecting to LinkedIn...", "Scraping profile data...", "Scraping posts...", "Analyzing personality...", "Building buyer profile...", "Generating simulation guidelines...", "Saving persona to database..."];

  async function analyzeProfile() {
    if (!newProfileUrl.trim() || !newProfileUrl.includes("linkedin.com/in/")) {
      showToast("Please enter a valid LinkedIn profile URL", "error"); return;
    }
    setAnalyzing(true); setAnalyzeStep(0);
    const stepInterval = setInterval(() => {
      setAnalyzeStep(prev => prev < ANALYZE_STEPS.length - 1 ? prev + 1 : prev);
    }, 8000);
    try {
      const res = await fetch("/api/cara/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileUrl: newProfileUrl.trim(), postsLimit }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Persona created for ${data.persona?.name || "prospect"}!`, "success");
        setShowAddModal(false); setNewProfileUrl(""); loadPersonas();
        if (data.persona) { setSelectedPersona(data.persona); setShowDetail(true); }
      } else {
        showToast(data.error || "Failed to analyze profile", "error");
      }
    } catch { showToast("Network error", "error"); }
    finally { clearInterval(stepInterval); setAnalyzing(false); }
  }

  // ── Delete persona ──
  async function deletePersona(id: string) {
    try {
      const res = await fetch(`/api/cara/personas?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) { showToast("Persona deleted", "success"); loadPersonas(); setShowDetail(false); setSelectedPersona(null); }
    } catch { showToast("Failed to delete", "error"); }
  }

  // ── Staging simulation ──
  function startSimulation(persona: Persona | null) {
    setSelectedPersona(persona);
    setSimMessages([]);
    setSimSessions([]); // Clear previous persona's sessions immediately
    setSimInput("");
    setSimSending(false);
    
    if (persona) {
      setSimSessionId(`session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
      setActiveTab("staging");
      loadSimSessions(persona._id);
    } else {
      setSimSessionId(null);
    }
  }

  async function loadSimSessions(personaId: string) {
    if (!personaId) return;
    try {
      const res = await fetch(`/api/cara/simulate?personaId=${personaId}`);
      const data = await res.json();
      if (data.success) {
        // Only update if this is still the persona we care about
        setSimSessions(data.sessions || []);
      }
    } catch { /* silent */ }
  }

  function loadSession(session: SimSession) {
    if (!session || !session.messages) return;
    // Set messages and update session ID to resume
    setSimMessages(session.messages);
    setSimSessionId(session.sessionId);
    // Smooth scroll to bottom after state update
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  async function sendSimMessage() {
    if (!simInput.trim() || !selectedPersona || simSending) return;
    const userMsg: SimMessage = { role: "user", content: simInput, timestamp: new Date().toISOString() };
    const newMessages = [...simMessages, userMsg];
    setSimMessages(newMessages); setSimInput(""); setSimSending(true);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    try {
      const res = await fetch("/api/cara/simulate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: selectedPersona._id, message: userMsg.content,
          sessionId: simSessionId,
          conversationHistory: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const personaMsg: SimMessage = { role: "persona", content: data.response, timestamp: data.timestamp };
        setSimMessages(prev => [...prev, personaMsg]);
        // Refresh session list so the current session appears in history
        if (selectedPersona) loadSimSessions(selectedPersona._id);
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      } else { showToast(data.error || "Simulation failed", "error"); }
    } catch { showToast("Network error", "error"); }
    finally { setSimSending(false); }
  }

  const copy = (t: string) => { navigator.clipboard.writeText(t); showToast("Copied!", "success"); };
  const filteredPersonas = personas.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.headline && p.headline.toLowerCase().includes(q));
  });

  if (checking) return null;

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "personas", label: "Personas", icon: <Users size={15} /> },
    { id: "staging", label: "Staging Environment", icon: <MessageCircle size={15} /> },
    { id: "script-lab", label: "Script Lab", icon: <FlaskConical size={15} /> },
  ];

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

      {/* Header */}
      <header className="sticky top-0 z-50 border-b" style={{ background: "rgba(8,9,16,0.85)", backdropFilter: "blur(16px)", borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/scraper")} className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border" style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(0,180,216,0.3)", color: "#00b4d8" }}><Linkedin size={13} strokeWidth={2.5} /><span>Scraper</span></button>
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center rounded-lg shadow-lg" style={{ width: 32, height: 32, background: CARA_GRADIENT }}><UserCheck size={16} stroke="white" /></div>
              <div><p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>Cara</p><p className="text-[11px]" style={{ color: "#4b5268" }}>Avatar Simulator</p></div>
            </div>
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <BotSwitcher currentBotId="cara" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg font-bold transition-all cursor-pointer" style={{ background: CARA_GRADIENT, color: "white", boxShadow: "0 2px 10px rgba(244,63,94,0.3)" }}><Plus size={14} /><span>Add Persona</span></button>
            <button onClick={loadPersonas} disabled={loading} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all border border-white/10 cursor-pointer disabled:opacity-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /><span>Refresh</span></button>
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-6">
        <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer"
              style={{ background: activeTab === tab.id ? "rgba(244,63,94,0.12)" : "transparent", color: activeTab === tab.id ? CARA_COLOR : "rgba(255,255,255,0.4)", border: activeTab === tab.id ? "1px solid rgba(244,63,94,0.25)" : "1px solid transparent" }}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-6 py-6">

        {/* ═══ PERSONAS TAB ═══ */}
        {activeTab === "personas" && !showDetail && (
          <div className="animate-fade-in">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">Client Avatar <span className="bg-clip-text text-transparent" style={{ backgroundImage: CARA_GRADIENT }}>Database</span></h1>
              <p className="text-sm mt-1" style={{ color: "#5a5e72" }}>Analyze LinkedIn profiles independently. Each persona is saved for simulation practice.</p>
            </div>
            <input type="text" placeholder="Search personas..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full sm:max-w-md rounded-xl px-4 py-3 text-sm outline-none mb-6 border transition-all focus:border-[#f43f5e]" style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(255,255,255,0.1)", color: "#e5e7eb" }} />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPersonas.map(p => (
                <div key={p._id} className="p-5 rounded-2xl border transition-all hover:-translate-y-1" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }} onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(244,63,94,0.3)"} onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-xl" style={{ background: CARA_GRADIENT }}>{p.name.charAt(0)}</div>
                    <div className="flex-1 min-w-0"><h3 className="font-bold text-gray-100 text-sm">{p.name}</h3><p className="text-xs text-gray-500 line-clamp-1">{p.headline}</p></div>
                    <div className="flex flex-col items-end gap-1">
                      {p.analysis?.buyerProfile?.buyerType && <BuyerTypeBadge type={p.analysis.buyerProfile.buyerType} />}
                      {p.analysis?.buyerProfile?.warmthLevel !== undefined && <WarmthBadge level={p.analysis.buyerProfile.warmthLevel} />}
                    </div>
                  </div>
                  {p.analysis?.executiveSummary && <p className="text-xs text-gray-500 mb-3 line-clamp-2">{p.analysis.executiveSummary}</p>}
                  {p.analysis?.professionalInsights?.areasOfExpertise && (
                    <div className="flex flex-wrap gap-1 mb-3">{p.analysis.professionalInsights.areasOfExpertise.slice(0, 3).map((e, i) => <span key={i} className="px-2 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: "rgba(244,63,94,0.06)", color: "#f87171", border: "1px solid rgba(244,63,94,0.15)" }}>{e}</span>)}</div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => { setSelectedPersona(p); setShowDetail(true); }} className="flex-1 py-2 rounded-lg text-xs cursor-pointer font-bold border transition-all flex items-center justify-center gap-1.5" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)", color: "#e5e7eb" }}><Eye size={12} />View</button>
                    <button onClick={() => startSimulation(p)} className="flex-1 py-2 rounded-lg text-xs cursor-pointer font-bold text-[#f43f5e] border border-[#f43f5e] bg-[rgba(244,63,94,0.1)] hover:bg-[rgba(244,63,94,0.2)] transition-all flex items-center justify-center gap-1.5"><MessageCircle size={12} />Simulate</button>
                    <button onClick={() => setConfirmDeleteId(p._id)} className="py-2 px-3 rounded-lg text-xs cursor-pointer font-bold text-red-400/60 hover:text-red-400 border border-white/5 hover:border-red-500/30 transition-all"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
            {filteredPersonas.length === 0 && !loading && <div className="text-center py-16"><div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 mx-auto" style={{ background: "rgba(244,63,94,0.06)", border: "1px solid rgba(244,63,94,0.12)" }}><Users size={36} className="text-[#f43f5e]" /></div><p className="text-gray-300 text-base font-semibold mb-1">No personas yet</p><p className="text-gray-500 text-sm">Click &quot;Add Persona&quot; to analyze a LinkedIn profile and create your first client avatar.</p></div>}
          </div>
        )}

        {/* ═══ PERSONA DETAIL VIEW ═══ */}
        {activeTab === "personas" && showDetail && selectedPersona && (
          <PersonaDetailView persona={selectedPersona} onBack={() => setShowDetail(false)} onSimulate={() => startSimulation(selectedPersona)} copy={copy} />
        )}

        {/* ═══ STAGING ENVIRONMENT TAB ═══ */}
        {activeTab === "staging" && (
          <StagingTab
            key={selectedPersona?._id || "empty"}
            personas={personas} selectedPersona={selectedPersona} simMessages={simMessages} simInput={simInput}
            simSending={simSending} simSessions={simSessions} chatEndRef={chatEndRef}
            onSelectPersona={startSimulation} setSimInput={setSimInput} onSend={sendSimMessage}
            onLoadSession={loadSession} onNewSession={() => { setSimMessages([]); setSimSessionId(`session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`); }}
          />
        )}

        {/* ═══ SCRIPT LAB TAB ═══ */}
        {activeTab === "script-lab" && (
          <ScriptLabTab personas={personas} copy={copy} showToast={showToast} />
        )}
      </main>

      {/* ═══ CONFIRM DELETE DIALOG ═══ */}
      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        title="Delete Persona"
        message="Are you sure you want to delete this persona? This action cannot be undone and all simulation sessions for this persona will be lost."
        confirmLabel="Delete Persona"
        cancelLabel="Keep Persona"
        onConfirm={() => {
          if (confirmDeleteId) deletePersona(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
        variant="danger"
      />

      {/* ═══ ADD PERSONA MODAL ═══ */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
          <div className="w-full max-w-lg p-8 rounded-2xl border animate-fade-in" style={{ background: "#0d0e18", borderColor: "rgba(255,255,255,0.1)" }}>
            {!analyzing ? (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(244,63,94,0.12)", border: "1px solid rgba(244,63,94,0.25)" }}><Brain size={20} className="text-[#f43f5e]" /></div><div><h3 className="text-lg font-bold text-white">Add New Persona</h3><p className="text-xs text-gray-500">Analyze a LinkedIn profile independently</p></div></div>
                  <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-white transition-all cursor-pointer"><X size={20} /></button>
                </div>
                <div className="mb-4"><label className="text-sm font-medium text-gray-300 mb-2 block">LinkedIn Profile URL</label><input type="url" value={newProfileUrl} onChange={e => setNewProfileUrl(e.target.value)} placeholder="https://linkedin.com/in/username" className="w-full rounded-xl px-4 py-3 text-sm outline-none border transition-all focus:border-[#f43f5e]" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)", color: "#e5e7eb" }} autoFocus /></div>
                <div className="mb-6"><label className="text-sm font-medium text-gray-300 mb-2 block">Posts to analyze</label><div className="flex items-center gap-4"><input type="range" min={2} max={30} value={postsLimit} onChange={e => setPostsLimit(Number(e.target.value))} className="flex-1" style={{ accentColor: CARA_COLOR }} /><span className="text-sm font-mono font-bold text-white min-w-[40px] text-right">{postsLimit}</span></div><p className="mt-1 text-xs text-gray-600">More posts = deeper analysis, but takes longer</p></div>
                <button onClick={analyzeProfile} disabled={!newProfileUrl.trim()} className="w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50" style={{ background: CARA_GRADIENT, color: "white", boxShadow: "0 4px 14px rgba(244,63,94,0.25)" }}><Search size={18} />Analyze &amp; Create Persona</button>
              </>
            ) : (
              <div className="text-center py-4">
                <div className="mx-auto mb-6 flex items-center justify-center rounded-2xl" style={{ width: 64, height: 64, background: CARA_GRADIENT, boxShadow: "0 0 40px rgba(244,63,94,0.3)", animation: "ceevee-pulse 2s ease-in-out infinite" }}><Brain size={28} stroke="white" /></div>
                <h3 className="text-lg font-bold text-white mb-1">Analyzing Profile</h3>
                <p className="text-sm text-gray-400 mb-6">Building comprehensive persona...</p>
                <div className="space-y-2 mb-5 text-left">{ANALYZE_STEPS.map((label, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 rounded-lg transition-all" style={{ background: i === analyzeStep ? "rgba(244,63,94,0.08)" : "transparent", opacity: i <= analyzeStep ? 1 : 0.3 }}>
                    <div className="w-5 h-5 flex items-center justify-center shrink-0">{i < analyzeStep ? <Sparkles size={14} stroke="#00e676" /> : i === analyzeStep ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />}</div>
                    <span className="text-sm flex-1" style={{ color: i <= analyzeStep ? "#e5e7eb" : "#5a5e72" }}>{label}</span>
                  </div>
                ))}</div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden ring-1 ring-white/10"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(5, ((analyzeStep + 1) / ANALYZE_STEPS.length) * 100)}%`, background: CARA_GRADIENT }} /></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════

function PersonaDetailView({ persona, onBack, onSimulate, copy }: { persona: Persona; onBack: () => void; onSimulate: () => void; copy: (t: string) => void }) {
  const a = persona.analysis || {};
  const pp = a.personalityProfile || {};
  const pi = a.professionalInsights || {};
  const bp = a.buyerProfile || {};
  const sg = a.simulationGuidelines || {};
  const sa = a.salesApproach || {};
  const qc = a.quotableContent || {};

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer transition-all mb-6"><ChevronLeft size={16} />Back to personas</button>

      {/* Header Card */}
      <div className="p-6 rounded-2xl border mb-6" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl flex items-center justify-center font-bold text-xl text-white shadow-2xl" style={{ background: CARA_GRADIENT }}>{persona.name.charAt(0)}</div>
            <div><h2 className="text-xl font-bold text-white">{persona.name}</h2><p className="text-sm text-gray-400">{persona.headline}</p><p className="text-xs text-gray-600 mt-1">{persona.location}</p></div>
          </div>
          <div className="flex items-center gap-2">
            {bp.buyerType && <BuyerTypeBadge type={bp.buyerType} size="lg" />}
            {bp.warmthLevel !== undefined && <WarmthBadge level={bp.warmthLevel} size="lg" />}
            <button onClick={onSimulate} className="px-4 py-2 rounded-lg text-sm font-bold cursor-pointer transition-all flex items-center gap-2" style={{ background: CARA_GRADIENT, color: "white" }}><MessageCircle size={14} />Start Simulation</button>
          </div>
        </div>
        {a.executiveSummary && <p className="text-sm text-gray-300 mt-4 leading-relaxed">{a.executiveSummary}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Personality */}
        <DetailSection icon={<Brain size={16} className="text-[#f43f5e]" />} title="Personality Profile">
          {pp.communicationStyle && <DetailItem label="Communication Style" value={pp.communicationStyle} />}
          {pp.tone && <DetailItem label="Tone" value={pp.tone} />}
          {pp.decisionMakingStyle && <DetailItem label="Decision Making" value={pp.decisionMakingStyle} />}
          <TagList label="Values" items={pp.values} color="#8b5cf6" />
          <TagList label="Motivations" items={pp.motivations} color="#10b981" />
          <TagList label="Pet Peeves" items={pp.petPeeves} color="#ef4444" />
        </DetailSection>

        {/* Buyer Profile */}
        <DetailSection icon={<Target size={16} className="text-[#f43f5e]" />} title="Buyer Profile">
          <TagList label="Decision Factors" items={bp.decisionFactors} color="#0ea5e9" />
          <TagList label="Likely Objections" items={bp.likelyObjections} color="#ef4444" />
          <TagList label="Buying Triggers" items={bp.buyingTriggers} color="#10b981" />
          <TagList label="Deal Breakers" items={bp.dealBreakers} color="#f59e0b" />
          <TagList label="Trust Builders" items={bp.trustBuilders} color="#8b5cf6" />
        </DetailSection>

        {/* Professional */}
        <DetailSection icon={<TrendingUp size={16} className="text-[#f43f5e]" />} title="Professional Insights">
          {pi.currentRole && <DetailItem label="Current Role" value={pi.currentRole} />}
          {pi.currentFocus && <DetailItem label="Current Focus" value={pi.currentFocus} />}
          {pi.careerTrajectory && <DetailItem label="Career Trajectory" value={pi.careerTrajectory} />}
          <TagList label="Expertise" items={pi.areasOfExpertise} color="#0ea5e9" />
          <TagList label="Challenges" items={pi.challenges} color="#ef4444" />
          <TagList label="Achievements" items={pi.achievements} color="#10b981" />
        </DetailSection>

        {/* Sales Approach */}
        <DetailSection icon={<Zap size={16} className="text-[#f43f5e]" />} title="Sales Approach">
          {sa.bestApproach && <DetailItem label="Best Approach" value={sa.bestApproach} />}
          {sa.followUpStrategy && <DetailItem label="Follow-Up Strategy" value={sa.followUpStrategy} />}
          <TagList label="Do This" items={sa.doThis} color="#10b981" />
          <TagList label="Avoid This" items={sa.avoidThis} color="#ef4444" />
          {sa.openingAngles && sa.openingAngles.length > 0 && (
            <div className="mt-3"><p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Opening Angles</p>{sa.openingAngles.map((angle, i) => <div key={i} className="flex items-start gap-2 mb-2"><span className="text-[#f43f5e] font-bold text-xs mt-0.5">{i + 1}.</span><p className="text-xs text-gray-300">{angle}</p></div>)}</div>
          )}
        </DetailSection>

        {/* Simulation Guidelines */}
        <DetailSection icon={<MessageCircle size={16} className="text-[#f43f5e]" />} title="Simulation Guidelines">
          {sg.howTheyGreet && <DetailItem label="Greeting Style" value={sg.howTheyGreet} />}
          {sg.responseLength && <DetailItem label="Response Length" value={sg.responseLength} />}
          {sg.questionStyle && <DetailItem label="Question Style" value={sg.questionStyle} />}
          {sg.objectionStyle && <DetailItem label="Objection Style" value={sg.objectionStyle} />}
          <TagList label="Topics They Love" items={sg.topicsTheyLove} color="#10b981" />
          <TagList label="Topics to Avoid" items={sg.topicsToAvoid} color="#ef4444" />
          {sg.samplePhrases && sg.samplePhrases.length > 0 && (
            <div className="mt-3"><p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Sample Phrases</p>{sg.samplePhrases.map((p, i) => <p key={i} className="text-xs text-gray-400 italic mb-1">&ldquo;{p}&rdquo;</p>)}</div>
          )}
        </DetailSection>

        {/* Quotes & Opinions */}
        <DetailSection icon={<Lightbulb size={16} className="text-[#f43f5e]" />} title="Quotable Content">
          {qc.memorableQuotes && qc.memorableQuotes.length > 0 && (
            <div className="mb-3"><p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Memorable Quotes</p>{qc.memorableQuotes.map((q, i) => <div key={i} className="p-3 rounded-lg mb-2 cursor-pointer hover:bg-white/5 transition-all" style={{ background: "rgba(244,63,94,0.04)", border: "1px solid rgba(244,63,94,0.1)" }} onClick={() => copy(q)}><p className="text-xs text-gray-300 italic">&ldquo;{q}&rdquo;</p></div>)}</div>
          )}
          <TagList label="Recurring Themes" items={qc.recurringThemes} color="#0ea5e9" />
          <TagList label="Strong Opinions" items={qc.strongOpinions} color="#f59e0b" />
        </DetailSection>
      </div>
    </div>
  );
}

function BuyerTypeBadge({ type, size = "sm" }: { type: string; size?: "sm" | "lg" }) {
  const getBuyerTypeDetail = (t: string) => {
    const lower = t.toLowerCase();
    if (lower.includes("analytical")) return { label: "Analytical", desc: "Data-driven and methodical. Values ROI, technical specs, and detailed proof. Avoid fluff.", color: "#0ea5e9" };
    if (lower.includes("driver")) return { label: "Driver", desc: "Results-oriented and decisive. Wants direct summaries and bottom-line impact. Be brief.", color: "#f43f5e" };
    if (lower.includes("amiable")) return { label: "Amiable", desc: "Relationship-focused and cautious. Values trust, peer reviews, and connection. Don't be pushy.", color: "#8b5cf6" };
    if (lower.includes("expressive")) return { label: "Expressive", desc: "Vision-driven and creative. Cares about innovation, prestige, and big-picture ideas. Be energetic.", color: "#f59e0b" };
    return { label: t, desc: "A unique professional persona with specific buying preferences and decision factors.", color: "#94a3b8" };
  };

  const detail = getBuyerTypeDetail(type);

  return (
    <div className="group relative">
      <span 
        className={`${size === "lg" ? "px-3 py-1.5 rounded-lg text-xs" : "px-2 py-0.5 rounded-md text-[10px]"} font-bold transition-all cursor-help border uppercase tracking-wider`}
        style={{ 
          background: `${detail.color}10`, 
          color: detail.color, 
          borderColor: `${detail.color}20` 
        }}
      >
        {detail.label}
      </span>
      
      {/* Tooltip Content */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 rounded-xl border shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-left"
        style={{ background: "#0d0e18", borderColor: "rgba(255,255,255,0.1)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-2 mb-1.5">
          <Target size={14} style={{ color: detail.color }} />
          <span className="text-[11px] font-bold text-white uppercase tracking-wider">{detail.label} Buyer</span>
        </div>
        <p className="text-[10px] leading-relaxed text-gray-400">
          {detail.desc}
        </p>
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border-r border-b" style={{ background: "#0d0e18", borderColor: "rgba(255,255,255,0.1)" }} />
      </div>
    </div>
  );
}

function WarmthBadge({ level, size = "sm" }: { level: number; size?: "sm" | "lg" }) {
  const getWarmthDetail = (l: number) => {
    if (l > 7) return { label: "Highly Receptive", desc: "This person is open to networking and likely to engage with personalized outreach.", color: "#10b981" };
    if (l > 4) return { label: "Selective", desc: "Professional and focused. Requires a clear, value-driven approach to secure interest.", color: "#f59e0b" };
    return { label: "Protective", desc: "Highly protective of their time. Requires significant trust-building and social proof.", color: "#ef4444" };
  };

  const detail = getWarmthDetail(level);

  return (
    <div className="group relative">
      <span 
        className={`${size === "lg" ? "px-3 py-1.5 rounded-lg text-xs" : "px-2 py-0.5 rounded-md text-[10px]"} font-bold transition-all cursor-help border`}
        style={{ 
          background: `${detail.color}10`, 
          color: detail.color, 
          borderColor: `${detail.color}20` 
        }}
      >
        Warmth: {level}/10
      </span>
      
      {/* Tooltip Content */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 rounded-xl border shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50"
        style={{ background: "#0d0e18", borderColor: "rgba(255,255,255,0.1)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: detail.color }} />
          <span className="text-[11px] font-bold text-white uppercase tracking-wider">{detail.label}</span>
        </div>
        <p className="text-[10px] leading-relaxed text-gray-400">
          {detail.desc}
        </p>
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border-r border-b" style={{ background: "#0d0e18", borderColor: "rgba(255,255,255,0.1)" }} />
      </div>
    </div>
  );
}

// Helper components
function DetailSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-2xl border" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.2)" }}>{icon}</div><h4 className="text-sm font-bold text-white">{title}</h4></div>
      {children}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return <div className="mb-2"><p className="text-[10px] font-bold text-gray-500 uppercase">{label}</p><p className="text-xs text-gray-300 mt-0.5 leading-relaxed">{value}</p></div>;
}

function TagList({ label, items, color }: { label: string; items?: string[]; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3"><p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1">{items.map((item, i) => <span key={i} className="px-2 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: `${color}10`, color, border: `1px solid ${color}25` }}>{item}</span>)}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGING TAB
// ═══════════════════════════════════════════════════════════════════════════════

function StagingTab({ personas, selectedPersona, simMessages, simInput, simSending, simSessions, chatEndRef, onSelectPersona, setSimInput, onSend, onLoadSession, onNewSession }: {
  personas: Persona[]; selectedPersona: Persona | null; simMessages: SimMessage[]; simInput: string; simSending: boolean;
  simSessions: SimSession[]; chatEndRef: React.RefObject<HTMLDivElement | null>; onSelectPersona: (p: Persona) => void;
  setSimInput: (v: string) => void; onSend: () => void; onLoadSession: (s: SimSession) => void; onNewSession: () => void;
}) {
  if (!selectedPersona) {
    return (
      <div className="animate-fade-in">
        <div className="mb-8"><h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">Staging <span className="bg-clip-text text-transparent" style={{ backgroundImage: CARA_GRADIENT }}>Environment</span></h1><p className="text-sm" style={{ color: "#5a5e72" }}>Select a persona to start a practice conversation. Cara will roleplay as the prospect.</p></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {personas.map(p => (
            <div key={p._id} className="p-5 rounded-2xl border transition-all cursor-pointer hover:-translate-y-1" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }} onClick={() => onSelectPersona(p)} onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(244,63,94,0.3)"} onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"}>
              <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-xl" style={{ background: CARA_GRADIENT }}>{p.name.charAt(0)}</div><div><h3 className="font-bold text-gray-100 text-sm">{p.name}</h3><p className="text-xs text-gray-500 line-clamp-1">{p.headline}</p></div></div>
              {p.analysis?.buyerProfile?.buyerType && <div className="mt-3 flex items-center gap-2"><span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: "rgba(244,63,94,0.1)", color: CARA_COLOR }}>{p.analysis.buyerProfile.buyerType}</span><span className="text-[10px] text-gray-600">Warmth: {p.analysis.buyerProfile.warmthLevel}/10</span></div>}
            </div>
          ))}
        </div>
        {personas.length === 0 && <div className="text-center py-16"><MessageCircle size={48} className="text-gray-700 mx-auto mb-4" /><p className="text-gray-400 text-sm font-semibold">No personas available. Add one from the Personas tab first.</p></div>}
      </div>
    );
  }

  const bp = selectedPersona.analysis?.buyerProfile || {};

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6" style={{ height: "calc(100vh - 200px)" }}>
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4 overflow-y-auto">
          <button onClick={() => { onSelectPersona(null as unknown as Persona); }} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer transition-all"><ChevronLeft size={16} />Change persona</button>
          <div className="p-4 rounded-2xl border" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-3 mb-3"><div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-xl" style={{ background: CARA_GRADIENT }}>{selectedPersona.name.charAt(0)}</div><div><h4 className="font-bold text-white text-sm">{selectedPersona.name}</h4><p className="text-xs text-gray-500 line-clamp-2">{selectedPersona.headline}</p></div></div>
            {bp.buyerType && <div className="flex items-center gap-2 mb-2"><Target size={12} className="text-[#f43f5e]" /><span className="text-xs text-gray-400">{bp.buyerType}</span></div>}
            {bp.warmthLevel !== undefined && <div className="flex items-center gap-2 mb-2"><TrendingUp size={12} className="text-emerald-400" /><span className="text-xs text-gray-400">Warmth: {bp.warmthLevel}/10</span></div>}
            {bp.likelyObjections && bp.likelyObjections.length > 0 && <div className="mt-3"><p className="text-[10px] font-bold text-gray-600 uppercase mb-1">Likely Objections</p>{bp.likelyObjections.slice(0, 3).map((o, i) => <p key={i} className="text-[11px] text-gray-500 flex items-start gap-1"><Shield size={10} className="text-red-400 mt-0.5 shrink-0" />{o}</p>)}</div>}
          </div>
          {/* Past sessions */}
          <div className="p-4 rounded-2xl border" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between mb-3"><h4 className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2"><Clock size={12} />Sessions</h4><button onClick={onNewSession} className="text-[10px] text-[#f43f5e] font-bold cursor-pointer hover:underline">+ New</button></div>
            {simSessions.length === 0 ? <p className="text-xs text-gray-600 italic">No past sessions</p> : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">{simSessions.map(s => (
                <button key={s._id} onClick={() => onLoadSession(s)} className="w-full text-left p-2 rounded-lg border transition-all cursor-pointer text-xs border-white/5 bg-white/[0.02] hover:border-[#f43f5e]/30">
                  <p className="font-semibold text-gray-300">{s.messages?.length || 0} messages</p><p className="text-gray-600 text-[10px]">{new Date(s.lastActivity).toLocaleDateString()}</p>
                </button>
              ))}</div>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="lg:col-span-3 flex flex-col rounded-2xl border" style={{ background: "rgba(8,9,16,0.6)", borderColor: "rgba(255,255,255,0.08)", backdropFilter: "blur(20px)" }}>
          {/* Chat header */}
          <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-sm" style={{ background: CARA_GRADIENT }}>{selectedPersona.name.charAt(0)}</div>
            <div><p className="text-sm font-bold text-white">Chatting as {selectedPersona.name}</p><p className="text-[10px] text-gray-500">Staging simulation — practice your pitch</p></div>
            <span className="ml-auto px-2 py-1 rounded-md text-[10px] font-bold bg-[#f43f5e]/10 text-[#f43f5e] border border-[#f43f5e]/20 animate-pulse">LIVE SIMULATION</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {simMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center"><MessageCircle size={48} className="text-gray-700 mb-4" /><p className="text-gray-400 text-sm font-semibold">Start the conversation</p><p className="text-gray-600 text-xs mt-1">Type a message below to begin your sales simulation with {selectedPersona.name}</p></div>
            )}
            {simMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] p-4 rounded-2xl text-sm leading-relaxed ${m.role === "user" ? "rounded-br-md" : "rounded-bl-md"}`} style={{ background: m.role === "user" ? "rgba(244,63,94,0.12)" : "rgba(255,255,255,0.04)", border: m.role === "user" ? "1px solid rgba(244,63,94,0.2)" : "1px solid rgba(255,255,255,0.08)", color: "#e5e7eb" }}>
                  <div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-bold uppercase" style={{ color: m.role === "user" ? "#f43f5e" : "#8b8fa3" }}>{m.role === "user" ? "You (Sales Rep)" : selectedPersona.name}</span></div>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}
            {simSending && (
              <div className="flex justify-start"><div className="p-4 rounded-2xl rounded-bl-md" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}><div className="flex items-center gap-2"><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /><span className="text-xs text-gray-500">{selectedPersona.name} is typing...</span></div></div></div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="px-6 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-3">
              <input value={simInput} onChange={e => setSimInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} placeholder="Type your sales pitch or message..." className="flex-1 rounded-xl px-4 py-3 text-sm outline-none border transition-all focus:border-[#f43f5e]" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)", color: "#e5e7eb" }} disabled={simSending} />
              <button onClick={onSend} disabled={simSending || !simInput.trim()} className="w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer transition-all disabled:opacity-50" style={{ background: CARA_GRADIENT }}><Send size={18} stroke="white" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIPT LAB TAB (Preserved from original with minor updates)
// ═══════════════════════════════════════════════════════════════════════════════

function ScriptLabTab({ personas, copy, showToast }: { personas: Persona[]; copy: (t: string) => void; showToast: (msg: string, type: "success" | "error") => void }) {
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [salesScript, setSalesScript] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ response?: string; analysis?: string; suggestedScript?: string; personaInsights?: { buyerType?: string; warmthLevel?: number; objections?: string[]; triggers?: string[] } } | null>(null);

  async function runAnalysis() {
    if (!salesScript.trim() || !selectedPersona) return;
    setGenerating(true); setResult(null);
    try {
      const res = await fetch("/api/cara/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: { name: selectedPersona.name, headline: selectedPersona.headline, currentFocus: selectedPersona.analysis?.professionalInsights?.currentFocus, areasOfExpertise: selectedPersona.analysis?.professionalInsights?.areasOfExpertise, challengesMentioned: selectedPersona.analysis?.professionalInsights?.challenges, communicationStyle: selectedPersona.analysis?.personalityProfile?.communicationStyle, values: selectedPersona.analysis?.personalityProfile?.values, achievementsMentioned: selectedPersona.analysis?.professionalInsights?.achievements }, salesScript, mode: "manual" }),
      });
      const data = await res.json();
      if (data.success) setResult({ response: data.response, analysis: data.analysis, suggestedScript: data.suggestedScript, personaInsights: data.personaInsights });
      else showToast(data.error || "Failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setGenerating(false); }
  }

  if (!selectedPersona) {
    return (
      <div className="animate-fade-in max-w-5xl mx-auto">
        <div className="mb-8"><h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">Script <span className="bg-clip-text text-transparent" style={{ backgroundImage: CARA_GRADIENT }}>Lab</span></h1><p className="text-sm" style={{ color: "#5a5e72" }}>Select a persona, then test your sales script against their profile.</p></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{personas.map(p => (
          <div key={p._id} className="p-5 rounded-2xl border transition-all cursor-pointer hover:-translate-y-1 hover:border-[#f43f5e]/30" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }} onClick={() => setSelectedPersona(p)}>
            <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-xl" style={{ background: CARA_GRADIENT }}>{p.name.charAt(0)}</div><div><h3 className="font-bold text-gray-100 text-sm">{p.name}</h3><p className="text-xs text-gray-500 line-clamp-1">{p.headline}</p></div></div>
          </div>
        ))}</div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <button onClick={() => { setSelectedPersona(null); setResult(null); setSalesScript(""); }} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer transition-all mb-6"><ChevronLeft size={16} />Back</button>
      <div className="p-6 rounded-2xl border mb-6" style={{ background: "rgba(8,9,16,0.6)", borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(244,63,94,0.12)", border: "1px solid rgba(244,63,94,0.25)" }}><FlaskConical size={20} className="text-[#f43f5e]" /></div><div><h3 className="text-base font-bold text-white">Test Script Against {selectedPersona.name}</h3><p className="text-xs text-gray-500">Paste your pitch below. Cara will react as this persona would.</p></div></div>
        <textarea value={salesScript} onChange={e => setSalesScript(e.target.value)} placeholder="Type your sales pitch or message..." className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none min-h-[120px] focus:border-[#f43f5e] transition-all" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", color: "#e5e7eb" }} />
        <button onClick={runAnalysis} disabled={generating || !salesScript.trim()} className="w-full mt-4 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50" style={{ background: CARA_GRADIENT, color: "white" }}>{generating ? <RefreshCw size={18} className="animate-spin" /> : <Zap size={18} />}{generating ? "Analyzing..." : "Analyze Script"}</button>
      </div>
      {result && (
        <div className="space-y-4 animate-fade-in">
          {result.response && <div className="relative p-6 rounded-2xl border" style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.1)" }}><div className="absolute -top-3 left-6 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-lg" style={{ background: "#1e293b", color: "#f8fafc", border: "1px solid #334155" }}>In-Character Response</div><p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap italic mt-2">&ldquo;{result.response}&rdquo;</p></div>}
          {result.analysis && <div className="relative p-6 rounded-2xl border" style={{ background: "rgba(244,63,94,0.05)", borderColor: "rgba(244,63,94,0.2)" }}><div className="absolute -top-3 left-6 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-lg" style={{ background: "#f43f5e", color: "white" }}>Analysis</div><p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap mt-2">{result.analysis}</p></div>}
          {result.suggestedScript && <div className="relative p-6 rounded-2xl border" style={{ background: "rgba(16,185,129,0.05)", borderColor: "rgba(16,185,129,0.2)" }}><div className="absolute -top-3 left-6 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-lg" style={{ background: "#10b981", color: "white" }}>Improved Script</div><p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap mt-2">{result.suggestedScript}</p><div className="mt-4 pt-4 border-t border-emerald-500/20 flex justify-end"><button onClick={() => copy(result.suggestedScript!)} className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all font-bold cursor-pointer"><Copy size={14} />Copy</button></div></div>}
        </div>
      )}
    </div>
  );
}
