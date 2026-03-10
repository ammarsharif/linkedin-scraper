"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { 
  Linkedin, 
  RefreshCw,
  Share2,
  CheckCircle2,
  Copy,
  ChevronLeft,
  FileText,
  MessageCircle,
  Mail,
  Zap
} from "lucide-react";
import { BotSwitcher } from "@/components/BotSwitcher";

interface StoredProfile {
  _id: string;
  profileUrl: string;
  name: string;
  headline: string;
  areasOfExpertise?: string[];
  currentFocus?: string;
}

const CORA_GRADIENT = "linear-gradient(135deg, #f59e0b, #d97706, #b45309)";

const FORMATS = [
  { id: "Twitter Thread", label: "Twitter Thread", desc: "Punchy, engaging multi-tweet thread.", icon: MessageCircle },
  { id: "LinkedIn Carousel Outline", label: "LinkedIn Carousel", desc: "Slide-by-slide text for a carousel.", icon: FileText },
  { id: "Newsletter Email", label: "Newsletter Intro", desc: "Warm, value-driven newsletter text.", icon: Mail },
  { id: "Short-form Script", label: "Short Video Script", desc: "Hook, body, and CTA for TikTok/Reels.", icon: Zap },
];

export default function CoraPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [selectedProfile, setSelectedProfile] = useState<StoredProfile | null>(null);
  const [sourceContent, setSourceContent] = useState("");
  const [selectedFormat, setSelectedFormat] = useState(FORMATS[0].id);
  const [step, setStep] = useState<"setup" | "editor" | "result">("setup");
  
  const [generatedContent, setGeneratedContent] = useState("");
  const [generationExplanation, setGenerationExplanation] = useState("");
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
      const res = await fetch("/api/cora");
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

  async function generateContent() {
    if (!sourceContent.trim() && !selectedProfile) {
      showToast("Please provide source content or select a profile context.", "error");
      return;
    }

    setGenerating(true);
    setGeneratedContent("");
    setGenerationExplanation("");
    setStep("result");
    
    try {
      const res = await fetch("/api/cora/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: selectedProfile,
          sourceContent,
          format: selectedFormat
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedContent(data.content);
        setGenerationExplanation(data.explanation);
        showToast("Content repurposed successfully!", "success");
      } else {
        showToast(data.error || "Failed to generate content", "error");
      }
    } catch {
      showToast("Network error generating content", "error");
    } finally {
      setGenerating(false);
    }
  }

  const copyToClipboard = () => {
    if (!generatedContent) return;
    navigator.clipboard.writeText(generatedContent);
    showToast("Content copied to clipboard!", "success");
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
            <div className="flex items-center justify-center rounded-lg shadow-lg" style={{ width: 32, height: 32, background: CORA_GRADIENT }}>
              <Share2 size={16} stroke="white" />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>Cora</p>
              <p className="text-[11px]" style={{ color: "#4b5268" }}>Content Repurposing Bot</p>
            </div>
            
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <BotSwitcher currentBotId="cora" />
          </div>
          
          <div className="flex items-center gap-3">
            <button onClick={loadProfiles} disabled={loading} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all border border-white/10 cursor-pointer disabled:opacity-50">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              <span>Refresh Profiles</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-8">
        {step === "setup" ? (
          <div className="animate-fade-in">
            <div className="mb-8">
              <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">
                Content Repurposing <span className="bg-clip-text text-transparent" style={{ backgroundImage: CORA_GRADIENT }}>Machine</span>
              </h1>
              <p className="text-sm mt-1" style={{ color: "#5a5e72", maxWidth: "600px" }}>Transform raw LinkedIn posts or profile data into engaging multi-platform content. Choose an author persona below or directly paste your text.</p>
            </div>

            <div className="mb-10 p-6 md:p-8 rounded-3xl border bg-black/40 backdrop-blur-xl border-white/10 shadow-lg">
              <h2 className="text-lg font-bold text-white mb-3">Option 1: Paste Raw LinkedIn Content</h2>
              <textarea 
                value={sourceContent} onChange={(e) => setSourceContent(e.target.value)}
                placeholder="Paste the LinkedIn post, hook, or text you want to repurpose here..."
                className="w-full rounded-xl px-4 py-4 text-sm outline-none resize-none min-h-[140px] focus:border-[#fbbf24] transition-all"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", color: "#e5e7eb" }}
              />
              <button 
                onClick={() => { if(sourceContent.trim()) setStep("editor"); }}
                disabled={!sourceContent.trim()}
                className="mt-4 px-6 py-2.5 rounded-xl text-sm font-bold bg-[#fbbf24] text-black hover:bg-[#f59e0b] disabled:opacity-50 transition-colors"
              >
                Continue without Persona Profiling
              </button>
            </div>
            
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Option 2: Use Profile Context (Maintains Voice)</h2>
              <input 
                type="text" placeholder="Search saved profiles..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full max-w-xs rounded-xl px-4 py-2 text-sm outline-none border transition-all focus:border-[#fbbf24]"
                style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(255,255,255,0.1)", color: "#e5e7eb" }}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProfiles.map(p => (
                <div key={p._id} className="p-5 rounded-2xl border transition-all cursor-pointer hover:-translate-y-1 group" style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.06)" }} onMouseEnter={e => e.currentTarget.style.borderColor="rgba(251,191,36,0.3)"} onMouseLeave={e => e.currentTarget.style.borderColor="rgba(255,255,255,0.06)"}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-xl transition-transform group-hover:scale-105" style={{ background: CORA_GRADIENT }}>
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-100 text-sm group-hover:text-amber-400 transition-colors">{p.name}</h3>
                      <p className="text-xs text-gray-500 line-clamp-1">{p.headline}</p>
                    </div>
                  </div>
                  <button onClick={() => { setSelectedProfile(p); setStep("editor"); }} className="w-full mt-3 py-2 rounded-lg text-xs cursor-pointer font-bold text-[#fbbf24] border border-[#fbbf24] bg-[rgba(251,191,36,0.1)] hover:bg-[rgba(251,191,36,0.2)] transition-all">
                    Repurpose for {p.name.split(" ")[0]}
                  </button>
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
        ) : step === "editor" ? (
          <div className="animate-fade-in max-w-4xl mx-auto">
            <button onClick={() => { setStep("setup"); }} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer transition-all mb-6">
              <ChevronLeft size={16} /> Back to setup
            </button>

            <div className="p-6 md:p-8 rounded-3xl border mb-6 bg-black/40 backdrop-blur-xl border-white/10 shadow-lg">
              
              {selectedProfile && (
                <div className="flex items-center gap-4 mb-8 pb-6 border-b border-white/10">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl text-white shadow-2xl relative" style={{ background: CORA_GRADIENT }}>
                    {selectedProfile.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Author Context: {selectedProfile.name}</h2>
                    <p className="text-sm text-amber-500/70">{selectedProfile.headline}</p>
                  </div>
                </div>
              )}

              <div className="mb-8">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Original LinkedIn Material</label>
                <textarea 
                  value={sourceContent} onChange={(e) => setSourceContent(e.target.value)}
                  placeholder="Paste the LinkedIn post, thoughts, or ideas to repurpose. If left blank, we'll use their general profile expertise to generate entirely new ideas..."
                  className="w-full rounded-xl px-5 py-4 text-sm outline-none resize-none min-h-[140px] focus:border-[#fbbf24] transition-all"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", color: "#e5e7eb" }}
                />
              </div>

              <div className="mb-8">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Target Platform / Format</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {FORMATS.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setSelectedFormat(f.id)}
                      className={`relative flex flex-col items-center justify-center p-4 rounded-2xl border text-center transition-all cursor-pointer ${selectedFormat === f.id ? "bg-[#fbbf24]/10 border-[#fbbf24]" : "bg-white/5 border-white/10 hover:border-white/20"}`}
                    >
                      <f.icon size={24} className={`mb-2 ${selectedFormat === f.id ? "text-[#fbbf24]" : "text-gray-400"}`} />
                      <span className={`text-sm font-bold ${selectedFormat === f.id ? "text-[#fbbf24]" : "text-gray-300"}`}>{f.label}</span>
                      <span className="text-[10px] text-gray-500 mt-1">{f.desc}</span>
                      
                      {selectedFormat === f.id && (
                        <div className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded-full bg-[#fbbf24] text-black">
                          <CheckCircle2 size={12} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <button 
                onClick={generateContent} disabled={generating || (!sourceContent.trim() && !selectedProfile)}
                className="w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 hover:shadow-lg text-black text-[15px]"
                style={{ background: CORA_GRADIENT, boxShadow: "0 4px 14px rgba(245,158,11,0.25)" }}
              >
                {generating ? <RefreshCw size={18} className="animate-spin" /> : <Share2 size={18} />}
                {generating ? "Repurposing & Formatting..." : `Generate ${FORMATS.find(f => f.id === selectedFormat)?.label}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="animate-fade-in max-w-5xl mx-auto">
             <div className="flex items-center justify-between mb-6">
                <button onClick={() => { setGeneratedContent(""); setGenerationExplanation(""); setStep("editor"); }} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer transition-all">
                  <ChevronLeft size={16} /> Try another format
                </button>
             </div>
             
             {generating ? (
                <div className="p-12 rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl flex flex-col items-center justify-center text-center">
                   <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6 animate-pulse" style={{ background: "rgba(251,191,36,0.1)" }}>
                      <RefreshCw size={28} className="text-[#fbbf24] animate-spin" />
                   </div>
                   <h2 className="text-xl font-bold text-white mb-2">Analyzing and Rewriting...</h2>
                   <p className="text-gray-400 text-sm max-w-md">Adapting tone, formatting structure for {FORMATS.find(f => f.id === selectedFormat)?.label}, and optimizing hooks.</p>
                </div>
             ) : (
               <div className="grid gap-6">
                 {/* Repurposed Output */}
                 <div className="relative p-6 md:p-8 rounded-3xl border border-white/10 bg-[#0c0e14]">
                    <div className="absolute -top-3 left-6 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-lg bg-[#fbbf24] text-black">
                      Ready to Publish: {FORMATS.find(f => f.id === selectedFormat)?.label}
                    </div>
                    
                    <div className="mt-4 flex justify-between items-start mb-6 pb-6 border-b border-white/5">
                       <div className="flex items-center gap-3">
                         <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 text-[#fbbf24]">
                            {(() => {
                               const Icon = FORMATS.find(f => f.id === selectedFormat)?.icon || FileText;
                               return <Icon size={20} />;
                            })()}
                         </div>
                         <div>
                            <h3 className="text-white font-bold">{selectedFormat}</h3>
                            <p className="text-xs text-gray-500">Optimized for engagement</p>
                         </div>
                       </div>
                       <button onClick={copyToClipboard} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl bg-[#fbbf24]/10 text-[#fbbf24] hover:bg-[#fbbf24]/20 transition-all font-bold cursor-pointer">
                          <Copy size={16} /> Copy Text
                       </button>
                    </div>

                    <div className="text-gray-200 text-[15px] leading-loose whitespace-pre-wrap font-sans">
                      {generatedContent}
                    </div>
                 </div>

                 {/* Bot Explanation */}
                 {generationExplanation && (
                    <div className="relative p-6 md:p-8 rounded-3xl border bg-[#fbbf24]/5 border-[#fbbf24]/20">
                      <div className="absolute -top-3 left-6 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-lg bg-[#1e293b] text-white border border-[#334155]">
                        Cora's Reasoning
                      </div>
                      <div className="mt-2 text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                        {generationExplanation}
                      </div>
                    </div>
                 )}
               </div>
             )}
          </div>
        )}
      </main>
    </div>
  );
}
