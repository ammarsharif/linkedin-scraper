"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { 
  Linkedin, 
  Search, 
  MessageSquare, 
  Zap, 
  Mail, 
  RefreshCw,
  Headphones,
  UserCheck,
  CheckCircle2,
  Copy,
  ChevronLeft,
  MessageCircle,
  Lightbulb
} from "lucide-react";

import { BotSwitcher } from "@/components/BotSwitcher";

interface StoredProfile {
  _id: string;
  profileUrl: string;
  vanityName: string;
  name: string;
  headline: string;
  location: string;
  executiveSummary?: string;
  currentFocus?: string;
  areasOfExpertise?: string[];
  challengesMentioned?: string[];
  achievementsMentioned?: string[];
  emailAddress?: string;
}

const CARA_GRADIENT = "linear-gradient(135deg, #f43f5e, #e11d48, #be123c)";
const CARA_COLOR = "#f43f5e";
const CARA_SOFT = "rgba(244, 63, 94, 0.1)";

export default function CaraPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [selectedProfile, setSelectedProfile] = useState<StoredProfile | null>(null);
  const [salesScript, setSalesScript] = useState("");
  const [simulationResponse, setSimulationResponse] = useState("");
  const [simulationAnalysis, setSimulationAnalysis] = useState("");
  const [generating, setGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    fetch("/api/auth").then((r) => r.json())
      .then((d) => { if (!d.authenticated) router.push("/"); })
      .catch(() => router.push("/"))
      .finally(() => setChecking(false));
  }, [router]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cara");
      const data = await res.json();
      if (res.ok && data.profiles) {
        setProfiles(data.profiles);
      } else {
        setError(data.error || "Failed to load profiles");
      }
    } catch {
      setError("Network error loading profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!checking) loadProfiles();
  }, [checking, loadProfiles]);

  async function generateSimulation() {
    if (!salesScript.trim()) {
      showToast("Please enter your pitch or sales script first.", "error");
      return;
    }
    if (!selectedProfile) return;

    setGenerating(true);
    setSimulationResponse("");
    setSimulationAnalysis("");
    
    try {
      const res = await fetch("/api/cara/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: selectedProfile,
          salesScript,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSimulationResponse(data.response);
        setSimulationAnalysis(data.analysis);
      } else {
        showToast(data.error || "Failed to generate simulation", "error");
      }
    } catch {
      showToast("Network error generating simulation", "error");
    } finally {
      setGenerating(false);
    }
  }

  const copyToClipboard = () => {
    if (!simulationResponse) return;
    navigator.clipboard.writeText(simulationResponse);
    showToast("Feedback copied to clipboard!", "success");
  };

  const filteredProfiles = profiles.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.headline && p.headline.toLowerCase().includes(q));
  });

  if (checking) return null;

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

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
      <header className="sticky top-0 z-50 border-b" style={{ background: "rgba(8,9,16,0.85)", backdropFilter: "blur(16px)", borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/scraper")} className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border" style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(0,180,216,0.3)", color: "#00b4d8" }} onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,180,216,0.08)"; }} onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.4)"; }}>
              <Linkedin size={13} strokeWidth={2.5} />
              <span>Scraper</span>
            </button>
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />
            
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center rounded-lg shadow-lg" style={{ width: 32, height: 32, background: CARA_GRADIENT }}>
                <UserCheck size={16} stroke="white" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>Cara</p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>Avatar Simulator</p>
              </div>
            </div>

            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <BotSwitcher currentBotId="cara" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadProfiles} disabled={loading} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all border border-white/10 cursor-pointer disabled:opacity-50">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-8">
        {!selectedProfile ? (
          <div className="animate-fade-in">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
                Client Avatar <span className="bg-clip-text text-transparent" style={{ backgroundImage: CARA_GRADIENT }}>Simulation</span>
              </h1>
              <p className="text-sm mt-1" style={{ color: "#5a5e72" }}>Simulate real-world buyer reactions to your sales scripts and pitches.</p>
            </div>
            
            <input 
              type="text" placeholder="Search profiles to simulate..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:max-w-md rounded-xl px-4 py-3 text-sm outline-none mb-6 border transition-all focus:border-[#f43f5e]"
              style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(255,255,255,0.1)", color: "#e5e7eb" }}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProfiles.map(p => (
                <div key={p._id} className="p-5 rounded-2xl border transition-all cursor-pointer hover:-translate-y-1" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }} onMouseEnter={e => e.currentTarget.style.borderColor="rgba(244,63,94,0.3)"} onMouseLeave={e => e.currentTarget.style.borderColor="rgba(255,255,255,0.06)"}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-xl" style={{ background: CARA_GRADIENT }}>
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-100 text-sm">{p.name}</h3>
                      <p className="text-xs text-gray-500 line-clamp-1">{p.headline}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedProfile(p)} className="w-full mt-3 py-2 rounded-lg text-xs cursor-pointer font-bold text-[#f43f5e] border border-[#f43f5e] bg-[rgba(244,63,94,0.1)] hover:bg-[rgba(244,63,94,0.2)] transition-all">Select Persona</button>
                </div>
              ))}
            </div>
            
            {filteredProfiles.length === 0 && !loading && (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">No profiles found. Run the Ceevee bot to acquire more profiles.</p>
              </div>
            )}
            
            {loading && profiles.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-12 text-gray-400 text-sm">
                 <RefreshCw size={16} className="animate-spin" /> Loading profiles...
              </div>
            )}
          </div>
        ) : (
          <div className="animate-fade-in max-w-4xl mx-auto">
            <button onClick={() => { setSelectedProfile(null); setSimulationResponse(""); setSimulationAnalysis(""); setSalesScript(""); }} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer transition-all mb-6">
              <ChevronLeft size={16} /> Back to personas
            </button>

            <div className="p-6 md:p-8 rounded-3xl border mb-6" style={{ background: "rgba(8,9,16,0.6)", borderColor: "rgba(255,255,255,0.08)", backdropFilter: "blur(20px)" }}>
              <div className="flex items-center gap-4 mb-8 pb-6 border-b border-white/10">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl text-white shadow-2xl relative" style={{ background: CARA_GRADIENT }}>
                  {selectedProfile.name.charAt(0)}
                  <span className="absolute -bottom-2 -right-2 bg-gray-900 rounded-full p-1 border border-gray-700">
                    <UserCheck size={14} className="text-[#f43f5e]" />
                  </span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Simulating: {selectedProfile.name}</h2>
                  <p className="text-sm text-gray-400">{selectedProfile.headline}</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Your Sales Pitch / Message</label>
                <textarea 
                  value={salesScript} onChange={(e) => setSalesScript(e.target.value)}
                  placeholder="Paste the email, cold flow, or script you plan to use on them..."
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none min-h-[140px] focus:border-[#f43f5e] transition-all"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", color: "#e5e7eb" }}
                />
              </div>

              <button 
                onClick={generateSimulation} disabled={generating || !salesScript.trim()}
                className="w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 hover:shadow-lg"
                style={{ background: CARA_GRADIENT, color: "white", boxShadow: "0 4px 14px rgba(244,63,94,0.25)" }}
              >
                {generating ? <RefreshCw size={18} className="animate-spin" /> : <Zap size={18} />}
                {generating ? "Simulating their reaction..." : "Test Pitch on Persona"}
              </button>
            </div>

            {simulationResponse && simulationAnalysis && (
              <div className="animate-fade-in grid gap-6">
                {/* Simulated Response */}
                <div className="relative p-6 md:p-8 rounded-3xl border" style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.1)" }}>
                   <div className="absolute -top-3 left-6 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-lg" style={{ background: "#1e293b", color: "#f8fafc", border: "1px solid #334155" }}>
                     In-Character Response
                   </div>
                   <div className="flex items-start gap-4 mt-2">
                     <MessageCircle size={24} className="text-gray-400 shrink-0 mt-1" />
                     <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap italic">
                       "{simulationResponse}"
                     </div>
                   </div>
                </div>

                {/* Analysis / Feedback */}
                <div className="relative p-6 md:p-8 rounded-3xl border" style={{ background: "rgba(244,63,94,0.05)", borderColor: "rgba(244,63,94,0.2)" }}>
                   <div className="absolute -top-3 left-6 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-lg" style={{ background: "#f43f5e", color: "white" }}>
                     Breakdown & Feedback
                   </div>
                   <div className="flex items-start gap-4 mt-2">
                     <Lightbulb size={24} className="text-[#f43f5e] shrink-0 mt-1" />
                     <div className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                       {simulationAnalysis}
                     </div>
                   </div>
                   
                   <div className="mt-6 pt-6 border-t border-[#f43f5e]/20 flex justify-end">
                      <button onClick={copyToClipboard} className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl bg-[#f43f5e]/10 text-[#f43f5e] hover:bg-[#f43f5e]/20 transition-all font-bold cursor-pointer">
                        <Copy size={14} /> Copy Feedback
                      </button>
                   </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
