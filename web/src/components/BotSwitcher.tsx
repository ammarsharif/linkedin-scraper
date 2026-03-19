"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Linkedin,
  Search,
  MessageSquare,
  Zap,
  Mail,
  Headphones,
  UserCheck,
  Share2,
  Target,
  Facebook,
  ChevronDown,
  LayoutGrid,
  AlertTriangle
} from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";

export const BOTS = [
  { id: "scraper", name: "Scraper", desc: "LinkedIn Profile Data", path: "/scraper", icon: Linkedin, color: "#00b4d8", bg: "rgba(0,180,216,0.1)" },
  { id: "ceevee", name: "Ceevee", desc: "Email Enrichment", path: "/ceevee", icon: Search, color: "#0ea5e9", bg: "rgba(14,165,233,0.1)" },
  { id: "demarko", name: "Demarko", desc: "Cold Outreach", path: "/demarko", icon: Mail, color: "#f97316", bg: "rgba(249,115,22,0.1)" },
  { id: "inti", name: "Inti", desc: "DM Integration", path: "/inti", icon: MessageSquare, color: "#818cf8", bg: "rgba(99,102,241,0.1)" },
  { id: "cindy", name: "Cindy", desc: "Customer Service", path: "/cindy", icon: Headphones, color: "#10b981", bg: "rgba(16,185,129,0.1)" },
  { id: "sienna", name: "Sienna", desc: "Lead Scoring", path: "/sienna", icon: Zap, color: "#c96ef5", bg: "rgba(201,110,245,0.1)", requiredLocal: "sienna_payload" },
  { id: "cara", name: "Cara", desc: "Avatar Simulator", path: "/cara", icon: UserCheck, color: "#f43f5e", bg: "rgba(244,63,94,0.1)" },
  { id: "cora", name: "Cora", desc: "Content Repurposing", path: "/cora", icon: Share2, color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  { id: "febo", name: "Febo", desc: "Sales Scripts & FB Engagement", path: "/febo", icon: Target, color: "#6366f1", bg: "rgba(99,102,241,0.1)" },
  { id: "felix", name: "Felix", desc: "FB Inbox Auto-Reply", path: "/felix", icon: Facebook, color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
];

export function BotSwitcher({ currentBotId }: { currentBotId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAlert, setShowAlert] = useState<{ title: string, message: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentBot = BOTS.find(b => b.id === currentBotId);

  const filteredBots = BOTS.filter(b => 
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    b.desc.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative" ref={ref}>
      <button 
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer border hover:bg-white/5"
        style={{ 
          background: "rgba(0,0,0,0.6)", 
          borderColor: currentBot ? currentBot.color : "rgba(255,255,255,0.1)" 
        }}
      >
        <LayoutGrid size={16} className="text-gray-400" />
        <span className="text-white">Bot Suite</span>
        <ChevronDown size={14} className="text-gray-500 ml-2" />
      </button>

      {open && (
        <div 
          className="absolute top-full left-0 mt-2 w-[320px] rounded-2xl border shadow-2xl p-2 z-50 animate-fade-in"
          style={{ 
            background: "rgba(12,14,20,0.95)", 
            borderColor: "rgba(255,255,255,0.1)",
            backdropFilter: "blur(24px)"
          }}
        >
          <div className="px-3 py-2 mb-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search bots..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 pl-9 pr-3 text-sm text-white placeholder-gray-500 outline-none focus:border-white/20 transition-all"
              />
            </div>
          </div>
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Available Bots
          </div>
          <div className="grid grid-cols-1 gap-1 max-h-[400px] overflow-y-auto custom-scrollbar">
            {filteredBots.map(bot => (
              <button
                key={bot.id}
                onClick={() => {
                  if (bot.requiredLocal && !localStorage.getItem(bot.requiredLocal)) {
                    setShowAlert({
                      title: "Missing Prerequisites",
                      message: `The ${bot.name} bot requires data from a previous step. Please use the Scraper first.`
                    });
                    return;
                  }
                  setOpen(false);
                  router.push(bot.path);
                }}
                className="flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer border border-transparent text-left w-full group"
                style={{
                  background: currentBotId === bot.id ? bot.bg : "transparent",
                  borderColor: currentBotId === bot.id ? "rgba(255,255,255,0.1)" : "transparent"
                }}
              >
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${bot.color}, #1e293b)` }}
                >
                  <bot.icon size={18} color="white" strokeWidth={2.5} />
                </div>
                <div>
                  <p className="font-bold text-sm text-gray-200 group-hover:text-white transition-colors">{bot.name}</p>
                  <p className="text-xs text-gray-500 truncate">{bot.desc}</p>
                </div>
                {/* Visual indicator for current bot */}
                {currentBotId === bot.id && (
                  <div className="ml-auto w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]" style={{ background: bot.color, color: bot.color }} />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {showAlert && (
        <ConfirmDialog
          isOpen={!!showAlert}
          title={showAlert.title}
          message={showAlert.message}
          confirmLabel="I understand"
          onConfirm={() => setShowAlert(null)}
          onCancel={() => setShowAlert(null)}
          variant="warning"
          showCancel={false}
        />
      )}
    </div>
  );
}
