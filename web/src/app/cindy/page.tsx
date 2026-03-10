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
  CheckCircle2,
  Copy,
  ChevronLeft
, UserCheck} from "lucide-react";

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

const CINDY_GRADIENT = "linear-gradient(135deg, #10b981, #059669, #34d399)";
const CINDY_COLOR = "#10b981";
const CINDY_SOFT = "rgba(16, 185, 129, 0.1)";

export default function CindyPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [selectedProfile, setSelectedProfile] = useState<StoredProfile | null>(null);
  const [prospectMessage, setProspectMessage] = useState("");
  const [generatedReply, setGeneratedReply] = useState("");
  const [generating, setGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(120); // 2 minutes (120 seconds)

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
      const res = await fetch("/api/cindy");
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

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isTimerRunning && timeLeft > 0) {
      timer = setTimeout(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (isTimerRunning && timeLeft === 0) {
      setIsTimerRunning(false);
      generateReply();
    }
    return () => clearTimeout(timer);
  }, [isTimerRunning, timeLeft]);

  const startSimulation = () => {
    if (!prospectMessage.trim()) {
      showToast("Please enter the prospect's message first.", "error");
      return;
    }
    setGeneratedReply("");
    setTimeLeft(120);
    setIsTimerRunning(true);
  };

  const cancelSimulation = () => {
    setIsTimerRunning(false);
    setTimeLeft(120);
  };

  const skipTimer = () => {
    setIsTimerRunning(false);
    setTimeLeft(0);
    generateReply();
  };

  async function generateReply() {
    if (!prospectMessage.trim()) {
      showToast("Please enter the prospect's message to reply to.", "error");
      return;
    }
    if (!selectedProfile) return;

    setGenerating(true);
    setGeneratedReply("");
    try {
      const res = await fetch("/api/cindy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: selectedProfile,
          prospectMessage,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedReply(data.reply);
      } else {
        showToast(data.error || "Failed to generate reply", "error");
      }
    } catch {
      showToast("Network error generating reply", "error");
    } finally {
      setGenerating(false);
      setIsTimerRunning(false);
    }
  }

  const copyToClipboard = () => {
    if (!generatedReply) return;
    navigator.clipboard.writeText(generatedReply);
    showToast("Reply copied to clipboard!", "success");
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
              <div className="flex items-center justify-center rounded-lg shadow-lg" style={{ width: 32, height: 32, background: CINDY_GRADIENT }}>
                <Headphones size={16} stroke="white" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>Cindy</p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>Customer Service</p>
              </div>
            </div>

            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <BotSwitcher currentBotId="cindy" />
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
                Prospect Customer Support <span className="bg-clip-text text-transparent" style={{ backgroundImage: CINDY_GRADIENT }}>Hub</span>
              </h1>
              <p className="text-sm mt-1" style={{ color: "#5a5e72" }}>Provide intelligent, helpful replies to prospects instantly.</p>
            </div>
            
            <input 
              type="text" placeholder="Search profiles..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:max-w-md rounded-xl px-4 py-3 text-sm outline-none mb-6 border transition-all focus:border-[#10b981]"
              style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(255,255,255,0.1)", color: "#e5e7eb" }}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProfiles.map(p => (
                <div key={p._id} className="p-5 rounded-2xl border transition-all" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }} onMouseEnter={e => e.currentTarget.style.borderColor="rgba(16,185,129,0.3)"} onMouseLeave={e => e.currentTarget.style.borderColor="rgba(255,255,255,0.06)"}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-xl" style={{ background: CINDY_GRADIENT }}>
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-100 text-sm">{p.name}</h3>
                      <p className="text-xs text-gray-500 line-clamp-1">{p.headline}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedProfile(p)} className="w-full mt-3 py-2 rounded-lg text-xs cursor-pointer font-bold text-[#10b981] border border-[#10b981] bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] transition-all">Support & Reply</button>
                </div>
              ))}
            </div>
            
            {filteredProfiles.length === 0 && !loading && (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">No profiles found. Run the Ceevee bot to acquire more profiles.</p>
              </div>
            )}
            
            {loading && profiles.length === 0 && (
              <div className="flex items-center gap-2 justify-center py-12 text-gray-400 text-sm">
                 <RefreshCw size={16} className="animate-spin" /> Loading profiles...
              </div>
            )}
          </div>
        ) : (
          <div className="animate-fade-in max-w-4xl mx-auto">
            <button onClick={() => { setSelectedProfile(null); setGeneratedReply(""); setProspectMessage(""); setIsTimerRunning(false); }} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer transition-all mb-6">
              <ChevronLeft size={16} /> Back to profiles
            </button>

            <div className="p-6 md:p-8 rounded-3xl border mb-6" style={{ background: "rgba(8,9,16,0.6)", borderColor: "rgba(255,255,255,0.08)", backdropFilter: "blur(20px)" }}>
              <div className="flex items-center gap-4 mb-8 pb-6 border-b border-white/10">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl text-white shadow-2xl" style={{ background: CINDY_GRADIENT }}>
                  {selectedProfile.name.charAt(0)}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">{selectedProfile.name}</h2>
                  <p className="text-sm text-gray-400">{selectedProfile.headline}</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Message from Prospect</label>
                <textarea 
                  value={prospectMessage} onChange={(e) => setProspectMessage(e.target.value)}
                  disabled={isTimerRunning || generating}
                  placeholder="Paste the email or message sent by the prospect..."
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none min-h-[120px] disabled:opacity-50"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", color: "#e5e7eb" }}
                />
              </div>

              {!isTimerRunning && !generating && !generatedReply && (
                <button 
                  onClick={startSimulation} disabled={!prospectMessage.trim()}
                  className="w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                  style={{ background: CINDY_GRADIENT, color: "white" }}
                >
                  <MessageSquare size={18} />
                  Receive Message
                </button>
              )}

              {isTimerRunning && (
                <div className="w-full p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/10 mb-4 animate-fade-in">
                  <div className="flex flex-col items-center justify-center">
                    <p className="text-yellow-400 font-bold mb-2">Human Representative Unavailable</p>
                    <p className="text-sm text-gray-300 mb-4">Time until Cindy auto-replies: <span className="font-mono font-bold">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")}</span></p>
                    
                    <div className="flex items-center gap-3 w-full">
                      <button onClick={cancelSimulation} className="flex-1 py-2 rounded-lg text-sm font-bold border border-white/10 hover:bg-white/5 text-white transition-all cursor-pointer">
                        Reply Manually
                      </button>
                      <button onClick={skipTimer} className="flex-1 py-2 rounded-lg text-sm font-bold border border-[#10b981] bg-[rgba(16,185,129,0.1)] hover:bg-[rgba(16,185,129,0.2)] text-[#10b981] transition-all cursor-pointer">
                        Skip Timer (Auto-Reply Now)
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {generating && (
                <div className="w-full py-4 flex flex-col items-center justify-center gap-3 bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.2)] rounded-xl animate-fade-in">
                  <RefreshCw size={24} className="animate-spin text-[#10b981]" />
                  <p className="text-sm font-bold text-[#10b981]">Cindy is studying the profile and message context...</p>
                </div>
              )}
            </div>

            {generatedReply && (
              <div className="p-6 md:p-8 rounded-3xl border animate-fade-in" style={{ background: "rgba(16,185,129,0.05)", borderColor: "rgba(16,185,129,0.2)" }}>
                 <div className="flex items-center justify-between mb-4">
                   <div className="flex items-center gap-2 text-[#10b981]">
                     <CheckCircle2 size={18} />
                     <h3 className="font-bold">Generated Reply</h3>
                   </div>
                   <button onClick={copyToClipboard} className="flex items-center cursor-pointer gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-white transition-all">
                     <Copy size={14} /> Copy
                   </button>
                 </div>
                 <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                   {generatedReply}
                 </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
