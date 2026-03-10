"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { 
  Briefcase, 
  Users, 
  Zap, 
  Lightbulb, 
  BookOpen, 
  ArrowRight, 
  Search, 
  Mail, 
  MessageSquare, 
  Linkedin, 
  Copy, 
  Check, 
  RotateCcw 
, Headphones, UserCheck} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type PitchTone =
  | "professional"
  | "friendly"
  | "bold"
  | "consultative"
  | "storytelling"
  | "direct";

interface ProspectData {
  name: string;
  headline: string;
  location?: string;
  profileUrl?: string;
  vanityName?: string;
  executiveSummary?: string;
  areasOfExpertise?: string[];
  challengesMentioned?: string[];
  achievementsMentioned?: string[];
  toolsAndTechnologies?: string[];
  primaryTopics?: string[];
  values?: string[];
  communicationStyle?: string;
  currentFocus?: string;
  companyStage?: string;
  roleLevel?: string;
  quotableLines?: string[];
  commonGround?: string[];
  petPeeves?: string[];
  motivations?: string[];
  careerSummary?: string;
}

interface PitchResult {
  subject: string;
  pitchMessage: string;
  openingHook: string;
  whyItWorks: string;
  keyPersonalizationPoints: string[];
  alternateClosings: string[];
  redFlags: string[];
  followUpAngle: string;
}

interface IntiResponse {
  success: boolean;
  tone: PitchTone;
  toneName: string;
  pitch: PitchResult;
  meta: {
    prospectName: string;
    generatedAt: string;
    poweredBy: string;
  };
}

// ── Brand color (single source of truth) ─────────────────────────────────────
const INTI_COLOR = "#6366f1";
const INTI_GRADIENT = "linear-gradient(135deg, #4f46e5, #6366f1, #818cf8)";
const INTI_GLOW = "rgba(99, 102, 241, 0.35)";
const INTI_SOFT = "rgba(99, 102, 241, 0.1)";

// ── Tone Config ────────────────────────────────────────────────────────────────

const TONES: {
  id: PitchTone;
  label: string;
  tagline: string;
  color: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "professional",
    label: "Professional",
    tagline: "Credible & polished",
    color: "#0ea5e9",
    icon: (
      <Briefcase size={15} />
    ),
  },
  {
    id: "friendly",
    label: "Friendly",
    tagline: "Warm & human",
    color: "#10b981",
    icon: (
      <Users size={15} />
    ),
  },
  {
    id: "bold",
    label: "Bold",
    tagline: "High-impact & fearless",
    color: "#f59e0b",
    icon: (
      <Zap size={15} />
    ),
  },
  {
    id: "consultative",
    label: "Consultative",
    tagline: "Problem-solver focused",
    color: "#a78bfa",
    icon: (
      <Lightbulb size={15} />
    ),
  },
  {
    id: "storytelling",
    label: "Storytelling",
    tagline: "Narrative-driven hook",
    color: "#ec4899",
    icon: (
      <BookOpen size={15} />
    ),
  },
  {
    id: "direct",
    label: "Direct",
    tagline: "No fluff, fast close",
    color: "#fb923c",
    icon: (
      <ArrowRight size={15} />
    ),
  },
];

// ── Copy Button ────────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 12px",
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 600,
        border: `1px solid ${copied ? "rgba(0,230,118,0.25)" : "rgba(255,255,255,0.08)"}`,
        background: copied ? "rgba(0,230,118,0.08)" : "rgba(255,255,255,0.04)",
        color: copied ? "#00e676" : "#8b8fa3",
        cursor: "pointer",
        transition: "all 0.2s",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {copied ? (
        <>
          <Check size={11} strokeWidth={2.5} />
          Copied
        </>
      ) : (
        <>
          <Copy size={11} />
          {label || "Copy"}
        </>
      )}
    </button>
  );
}

// ── Loading Overlay ────────────────────────────────────────────────────────────

const LOADING_STEPS = [
  "Reading prospect intelligence...",
  "Analyzing personalization signals...",
  "Crafting your pitch angle...",
  "Writing tailored message...",
  "Polishing and refining...",
];

function LoadingOverlay({ step, toneName }: { step: number; toneName: string }) {
  return (
    <div className="max-w-md mx-auto mt-10 animate-fade-in">
      <div
        className="p-8 rounded-2xl text-center"
        style={{
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div
          className="mx-auto mb-6 flex items-center justify-center rounded-2xl"
          style={{
            width: 64,
            height: 64,
            background: INTI_GRADIENT,
            boxShadow: `0 0 40px ${INTI_GLOW}`,
            animation: "inti-pulse 2s ease-in-out infinite",
          }}
        >
          <MessageSquare size={28} />
        </div>
        <h3 className="text-lg font-bold text-white mb-1">Crafting Your {toneName} Pitch</h3>
        <p className="text-sm text-gray-400 mb-6">Personalizing for maximum impact...</p>
        <div className="space-y-2">
          {LOADING_STEPS.map((label, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-2 rounded-lg transition-all duration-500"
              style={{
                background: i === step ? `${INTI_SOFT}` : "transparent",
                opacity: i <= step ? 1 : 0.3,
              }}
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                {i < step ? (
                  <Check size={13} stroke="#00e676" strokeWidth={2.5} />
                ) : i === step ? (
                  <div
                    style={{
                      width: 13,
                      height: 13,
                      border: `2px solid rgba(99,102,241,0.3)`,
                      borderTopColor: INTI_COLOR,
                      borderRadius: "50%",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                )}
              </div>
              <span className="text-sm" style={{ color: i <= step ? "#e5e7eb" : "#5a5e72" }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function IntiPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [prospect, setProspect] = useState<ProspectData | null>(null);
  const [selectedTone, setSelectedTone] = useState<PitchTone>("professional");
  const [extraContext, setExtraContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState<IntiResponse | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [generatedTones, setGeneratedTones] = useState<Record<string, IntiResponse>>({});

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Auth check
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.push("/");
      })
      .catch(() => router.push("/"))
      .finally(() => setChecking(false));
  }, [router]);

  // Load Ceevee data from localStorage
  useEffect(() => {
    try {
      const stateStr = localStorage.getItem("ceevee_state");
      if (stateStr) {
        const s = JSON.parse(stateStr);
        if (s.data?.profile && s.data?.report) {
          const report = s.data.report;
          const profile = s.data.profile;
          const extracted: ProspectData = {
            name: profile.name,
            headline: profile.headline,
            location: profile.location,
            profileUrl: profile.profileUrl,
            vanityName: profile.vanityName,
            executiveSummary: report.executiveSummary,
            areasOfExpertise: report.profileAnalysis?.areasOfExpertise,
            challengesMentioned: report.professionalInsights?.challengesMentioned,
            achievementsMentioned: report.professionalInsights?.achievementsMentioned,
            toolsAndTechnologies: report.professionalInsights?.toolsAndTechnologies,
            primaryTopics: report.contentAnalysis?.primaryTopics?.map(
              (t: { topic: string }) => t.topic
            ),
            values: report.personalityProfile?.values,
            communicationStyle: report.personalityProfile?.communicationStyle,
            currentFocus: report.professionalInsights?.currentFocus,
            companyStage: report.profileAnalysis?.estimatedCompanyStage,
            roleLevel: report.profileAnalysis?.roleLevel,
            quotableLines: report.keyReferences?.quotableLines,
            commonGround: report.keyReferences?.commonGround,
            petPeeves: report.personalityProfile?.petPeeves,
            motivations: report.personalityProfile?.motivations,
            careerSummary: report.careerTrajectory?.currentFocus,
          };
          setProspect(extracted);

          // Load saved inti state only if it matches this prospect
          const intiStr = localStorage.getItem("inti_state");
          if (intiStr) {
            const s = JSON.parse(intiStr);
            const savedName = s.prospectName || s.result?.meta?.prospectName;
            
            if (savedName === extracted.name) {
              if (s.result) setResult(s.result);
              if (s.generatedTones) setGeneratedTones(s.generatedTones);
              if (s.extraContext) setExtraContext(s.extraContext);
              if (s.selectedTone) setSelectedTone(s.selectedTone);
            } else {
              localStorage.removeItem("inti_state");
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Loading step animation
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev < LOADING_STEPS.length - 1 ? prev + 1 : prev));
    }, 2500);
    return () => clearInterval(interval);
  }, [loading]);

  async function handleGenerate() {
    if (!prospect) return;
    setError("");
    setLoadingStep(0);
    setLoading(true);

    try {
      const res = await fetch("/api/inti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospect, tone: selectedTone, extraContext }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) { router.push("/"); return; }
        setError(data.error || "Failed to generate pitch");
        return;
      }

      const newResult = data as IntiResponse;
      setResult(newResult);
      const newGeneratedTones = { ...generatedTones, [selectedTone]: newResult };
      setGeneratedTones(newGeneratedTones);

      localStorage.setItem(
        "inti_state",
        JSON.stringify({ 
          result: newResult, 
          generatedTones: newGeneratedTones, 
          extraContext, 
          selectedTone,
          prospectName: prospect.name 
        })
      );

      showToast(`${newResult.toneName} pitch generated`, "success");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleToneSwitch(tone: PitchTone) {
    setSelectedTone(tone);
    if (generatedTones[tone]) {
      setResult(generatedTones[tone]);
    }
  }

  function handleReset() {
    setResult(null);
    setGeneratedTones({});
    setExtraContext("");
    setError("");
    localStorage.removeItem("inti_state");
  }

  const currentToneConfig = TONES.find((t) => t.id === selectedTone)!;

  if (checking) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div className="bg-mesh" />
        <div className="spinner-lg spinner" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen" style={{ background: "#080910" }}>
      <div className="bg-mesh" />

      {/* ── Toast ── */}
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

      {/* ── Header ── */}
      <header
        className="sticky top-0 z-50 border-b"
        style={{
          background: "rgba(8,9,16,0.85)",
          backdropFilter: "blur(16px)",
          borderColor: "rgba(255,255,255,0.06)",
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/scraper")}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
              style={{
                background: "rgba(0,0,0,0.4)",
                borderColor: "rgba(0,180,216,0.3)",
                color: "#00b4d8",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,180,216,0.08)";
                e.currentTarget.style.borderColor = "rgba(0,180,216,0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                e.currentTarget.style.borderColor = "rgba(0,180,216,0.3)";
              }}
            >
                <Linkedin size={13} strokeWidth={2.5} />
              <span>Scraper</span>
            </button>

            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />
            {/* Brand */}
            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center justify-center rounded-lg"
                style={{
                  width: 32,
                  height: 32,
                  background: INTI_GRADIENT,
                  boxShadow: `0 0 12px ${INTI_GLOW}`,
                }}
              >
                <MessageSquare size={16} stroke="white" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "#e5e7eb", lineHeight: 1.2 }}>Inti</p>
                <p className="text-[11px]" style={{ color: "#4b5268" }}>Pitching ICP Bot</p>
              </div>
            </div>

            {/* Navigation */}
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
            <nav className="flex items-center gap-1">
              <button
                onClick={() => router.push("/ceevee")}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(14,165,233,0.3)",
                  color: "#0ea5e9",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(14,165,233,0.08)";
                  e.currentTarget.style.borderColor = "rgba(14,165,233,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                  e.currentTarget.style.borderColor = "rgba(14,165,233,0.3)";
                }}
              >
                  <Search size={13} strokeWidth={2.5} />
                <span>Ceevee</span>
              </button>

              <button
                onClick={() => router.push("/demarko")}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(249,115,22,0.3)",
                  color: "#f97316",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(249,115,22,0.08)";
                  e.currentTarget.style.borderColor = "rgba(249,115,22,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                  e.currentTarget.style.borderColor = "rgba(249,115,22,0.3)";
                }}
              >
                  <Mail size={13} strokeWidth={2.5} />
                <span>Demarko</span>
              </button>

              <button
                onClick={() => {
                  const sPayload = localStorage.getItem("sienna_payload");
                  if (sPayload) {
                    router.push("/sienna");
                  } else {
                    showToast("No scraper data found for Sienna", "error");
                  }
                }}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(201,110,245,0.3)",
                  color: "#c96ef5",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(201,110,245,0.08)";
                  e.currentTarget.style.borderColor = "rgba(201,110,245,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                  e.currentTarget.style.borderColor = "rgba(201,110,245,0.3)";
                }}
              >
                  <Zap size={13} strokeWidth={2.5} />
                <span>Sienna</span>
              </button>
            
              <button
                onClick={() => router.push("/cindy")}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(16,185,129,0.3)",
                  color: "#10b981",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(16,185,129,0.08)";
                  e.currentTarget.style.borderColor = "rgba(16,185,129,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                  e.currentTarget.style.borderColor = "rgba(16,185,129,0.3)";
                }}
              >
                  <Headphones size={13} strokeWidth={2.5} />
                <span>Cindy</span>
              </button>
            
              <button
                onClick={() => router.push("/cara")}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  borderColor: "rgba(244,63,94,0.3)",
                  color: "#f43f5e",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(244,63,94,0.08)";
                  e.currentTarget.style.borderColor = "rgba(244,63,94,0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.4)";
                  e.currentTarget.style.borderColor = "rgba(244,63,94,0.3)";
                }}
              >
                  <UserCheck size={13} strokeWidth={2.5} />
                <span>Cara</span>
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {result && (
              <button
                onClick={handleReset}
                className="text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all border border-white/10 cursor-pointer"
              >
                <RotateCcw size={14} className="mr-2 inline" />
                Clear Pitches
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 mx-auto max-w-6xl px-6 py-10">
        {!prospect ? (
          /* ── No Data State ── */
          <div className="max-w-lg mx-auto mt-16 text-center animate-fade-in">
            <div
              className="mx-auto mb-6 flex items-center justify-center rounded-2xl"
              style={{
                width: 72,
                height: 72,
                background: INTI_SOFT,
                border: `1px solid rgba(99,102,241,0.2)`,
              }}
            >
                <MessageSquare size={32} stroke={INTI_COLOR} strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">No Prospect Data Found</h2>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
              Inti needs a Ceevee research report to craft a personalized pitch. First, research your
              prospect using Ceevee, then come back here.
            </p>
            <button
              onClick={() => router.push("/ceevee")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white cursor-pointer"
              style={{ background: "linear-gradient(135deg, #0ea5e9, #2563eb)" }}
            >
                <Search size={16} />
              Go to Ceevee
            </button>
          </div>
        ) : loading ? (
          <LoadingOverlay step={loadingStep} toneName={currentToneConfig.label} />
        ) : (
          <div className="animate-fade-in">
            {/* ── Prospect Banner ── */}
            <div
              className="mb-6 p-5 rounded-2xl border flex items-center gap-4"
              style={{ background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.07)" }}
            >
              <div
                className="flex items-center justify-center rounded-xl text-sm font-bold text-white shrink-0"
                style={{
                  width: 44,
                  height: 44,
                  background: INTI_GRADIENT,
                  boxShadow: `0 4px 14px ${INTI_GLOW}`,
                }}
              >
                {prospect.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 mb-0.5">
                  <h2 className="text-sm font-bold text-white truncate">{prospect.name}</h2>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: INTI_SOFT,
                      color: INTI_COLOR,
                      border: `1px solid rgba(99,102,241,0.25)`,
                    }}
                  >
                    ICP Loaded
                  </span>
                </div>
                <p className="text-xs text-gray-500 truncate">{prospect.headline}</p>
              </div>
              <button
                onClick={() => router.push("/ceevee")}
                className="text-xs text-gray-600 hover:text-gray-300 transition-colors cursor-pointer shrink-0"
              >
                Change
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
              {/* ── Left: Controls ── */}
              <div className="space-y-4">

                {/* Tone Selector */}
                <div
                  className="p-5 rounded-2xl border"
                  style={{ background: "rgba(0,0,0,0.28)", borderColor: "rgba(255,255,255,0.07)" }}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#5a5e72" }}>
                    Pitch Tone
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TONES.map((tone) => {
                      const isActive = selectedTone === tone.id;
                      const hasGenerated = !!generatedTones[tone.id];
                      return (
                        <button
                          key={tone.id}
                          onClick={() => handleToneSwitch(tone.id)}
                          className="relative flex items-center gap-2.5 p-3 rounded-xl border transition-all duration-150 cursor-pointer text-left"
                          style={{
                            background: isActive ? `${tone.color}10` : "rgba(255,255,255,0.02)",
                            borderColor: isActive ? `${tone.color}35` : "rgba(255,255,255,0.05)",
                          }}
                        >
                          {/* Generated dot */}
                          {hasGenerated && (
                            <div
                              className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
                              style={{ background: tone.color }}
                            />
                          )}
                          <div style={{ color: isActive ? tone.color : "#4b5268", flexShrink: 0 }}>
                            {tone.icon}
                          </div>
                          <div className="min-w-0">
                            <p
                              className="text-xs font-semibold leading-tight"
                              style={{ color: isActive ? tone.color : "#c9ccd6" }}
                            >
                              {tone.label}
                            </p>
                            <p className="text-[9px] leading-tight mt-0.5" style={{ color: "#4b5268" }}>
                              {tone.tagline}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Extra Context */}
                <div
                  className="p-5 rounded-2xl border"
                  style={{ background: "rgba(0,0,0,0.28)", borderColor: "rgba(255,255,255,0.07)" }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#5a5e72" }}>
                      Extra Context
                    </p>
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        color: "#5a5e72",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      OPTIONAL
                    </span>
                  </div>
                  <textarea
                    value={extraContext}
                    onChange={(e) => setExtraContext(e.target.value)}
                    placeholder={`Add context to guide the pitch angle...\n\nExamples:\n- We offer AI automation for customer support\n- Focus on their scaling challenge\n- We helped similar companies cut costs 40%`}
                    rows={6}
                    className="w-full rounded-xl resize-none outline-none text-xs leading-relaxed"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: "#d1d5db",
                      padding: "10px 12px",
                      fontFamily: "inherit",
                      transition: "border-color 0.2s, box-shadow 0.2s",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = `rgba(99,102,241,0.4)`;
                      e.currentTarget.style.boxShadow = `0 0 0 3px rgba(99,102,241,0.08)`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                  <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "#3d4155" }}>
                    Tell Inti what you offer or what angle to take. This heavily shapes the pitch.
                  </p>
                </div>

                {/* Generate Button */}
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] transition-all cursor-pointer disabled:opacity-50"
                  style={{
                    background: INTI_GRADIENT,
                    color: "white",
                    boxShadow: `0 4px 18px ${INTI_GLOW}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) e.currentTarget.style.boxShadow = `0 6px 26px rgba(99,102,241,0.55)`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = `0 4px 18px ${INTI_GLOW}`;
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {generatedTones[selectedTone]
                    ? `Regenerate ${currentToneConfig.label} Pitch`
                    : `Generate ${currentToneConfig.label} Pitch`}
                </button>

                {error && (
                  <p className="text-red-400 text-sm text-center">{error}</p>
                )}
              </div>

              {/* ── Right: Pitch Result ── */}
              {result ? (
                <div className="space-y-4 animate-fade-in">
                  {/* Main Pitch Card */}
                  <div
                    className="p-6 rounded-2xl border"
                    style={{
                      background: "rgba(8,9,16,0.6)",
                      borderColor: `${currentToneConfig.color}22`,
                      boxShadow: `0 0 40px ${currentToneConfig.color}07`,
                    }}
                  >
                    {/* Card header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex items-center justify-center rounded-lg"
                          style={{
                            width: 30,
                            height: 30,
                            background: `${currentToneConfig.color}12`,
                            border: `1px solid ${currentToneConfig.color}25`,
                            color: currentToneConfig.color,
                          }}
                        >
                          {currentToneConfig.icon}
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-white">{result.toneName} Pitch</p>
                          <p className="text-[10px]" style={{ color: "#3d4155" }}>Ready to send</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <CopyButton text={result.pitch.pitchMessage} label="Copy Pitch" />
                        {prospect.profileUrl && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(result.pitch.pitchMessage);
                              window.open(prospect.profileUrl, "_blank");
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                            style={{
                              background: "rgba(10,102,194,0.1)",
                              color: "#0a66c2",
                              border: "1px solid rgba(10,102,194,0.2)"
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "rgba(10,102,194,0.2)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "rgba(10,102,194,0.1)";
                            }}
                            title="Copies pitch and opens LinkedIn profile"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                            </svg>
                            DM on LinkedIn
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Subject Line */}
                    {result.pitch.subject && (
                      <div
                        className="mb-4 p-3 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#4b5268" }}>
                          Subject Line
                        </p>
                        <p className="text-sm font-semibold text-gray-200">{result.pitch.subject}</p>
                      </div>
                    )}

                    {/* Pitch Body */}
                    <div
                      className="p-5 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      <p className="text-[14px] leading-[1.75] text-gray-200 whitespace-pre-wrap">
                        {result.pitch.pitchMessage}
                      </p>
                    </div>
                  </div>

                  {/* Why It Works */}
                  <div
                    className="p-5 rounded-2xl border"
                    style={{ background: "rgba(0,0,0,0.22)", borderColor: "rgba(255,255,255,0.06)" }}
                  >
                    <div className="flex items-center gap-2 mb-2.5">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={INTI_COLOR} strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: INTI_COLOR }}>
                        Why This Works
                      </p>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">{result.pitch.whyItWorks}</p>
                  </div>

                  {/* Personalization Points */}
                  <div
                    className="p-5 rounded-2xl border"
                    style={{ background: "rgba(0,0,0,0.22)", borderColor: "rgba(255,255,255,0.06)" }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#5a5e72" }}>
                      Personalization Signals Used
                    </p>
                    <ul className="space-y-2">
                      {result.pitch.keyPersonalizationPoints?.map((point, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-gray-300">
                          <span
                            className="shrink-0 mt-0.5 flex items-center justify-center rounded-full text-[9px] font-bold"
                            style={{
                              width: 17,
                              height: 17,
                              background: `${INTI_SOFT}`,
                              color: INTI_COLOR,
                              border: `1px solid rgba(99,102,241,0.25)`,
                            }}
                          >
                            {i + 1}
                          </span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Alternate Closings + Follow Up in 2-col */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Alternate Closings */}
                    <div
                      className="p-5 rounded-2xl border"
                      style={{ background: "rgba(0,0,0,0.22)", borderColor: "rgba(255,255,255,0.06)" }}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#5a5e72" }}>
                        Alternate Closings
                      </p>
                      <div className="space-y-2">
                        {result.pitch.alternateClosings?.map((c, i) => (
                          <div
                            key={i}
                            className="flex items-start justify-between gap-2 p-3 rounded-lg"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}
                          >
                            <p className="text-xs text-gray-300 leading-relaxed">{c}</p>
                            <CopyButton text={c} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Follow Up + Red Flags */}
                    <div className="space-y-3">
                      <div
                        className="p-5 rounded-2xl border"
                        style={{ background: "rgba(0,0,0,0.22)", borderColor: "rgba(255,255,255,0.06)" }}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#5a5e72" }}>
                          Follow-Up Angle
                        </p>
                        <p className="text-xs text-gray-300 leading-relaxed mb-2">{result.pitch.followUpAngle}</p>
                        <CopyButton text={result.pitch.followUpAngle} label="Copy" />
                      </div>

                      {result.pitch.redFlags?.length > 0 && (
                        <div
                          className="p-4 rounded-2xl border"
                          style={{
                            background: "rgba(251,191,36,0.04)",
                            borderColor: "rgba(251,191,36,0.12)",
                          }}
                        >
                          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(251,191,36,0.6)" }}>
                            Proceed Carefully
                          </p>
                          <ul className="space-y-1">
                            {result.pitch.redFlags.map((flag, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" className="shrink-0 mt-0.5">
                                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                  <line x1="12" y1="9" x2="12" y2="13" />
                                  <line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                {flag}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* ── Empty Right Panel — clean, no duplicate buttons ── */
                <div
                  className="flex flex-col items-center justify-center rounded-2xl border"
                  style={{
                    minHeight: 480,
                    background: "rgba(0,0,0,0.15)",
                    borderColor: "rgba(255,255,255,0.05)",
                    borderStyle: "dashed",
                  }}
                >
                  <div
                    className="flex items-center justify-center rounded-2xl mb-5"
                    style={{
                      width: 64,
                      height: 64,
                      background: INTI_SOFT,
                      border: `1px solid rgba(99,102,241,0.18)`,
                    }}
                  >
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={INTI_COLOR} strokeWidth="1.5">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-base font-bold text-white mb-2">Ready to Generate</h3>
                  <p className="text-sm text-center leading-relaxed max-w-[280px]" style={{ color: "#5a5e72" }}>
                    Select a tone on the left, optionally add context about your offer, then click{" "}
                    <span style={{ color: "#818cf8" }}>Generate</span> to craft a personalized pitch for{" "}
                    <span className="text-gray-300 font-medium">{prospect.name}</span>.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
