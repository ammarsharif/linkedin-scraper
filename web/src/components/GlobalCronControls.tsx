"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Play, Square, Activity, MessageSquare, TrendingUp, AlertCircle, RefreshCw, ChevronUp, ChevronDown, Bot } from "lucide-react";

interface CronStatus {
  running: boolean;
  suspended: boolean;
  lastRun: string | null;
}

interface AllStatuses {
  inbox: Record<string, CronStatus>;
  grow: Record<string, CronStatus>;
}

export function GlobalCronControls() {
  const [data, setData] = useState<{ statuses: AllStatuses; anyInboxRunning: boolean; anyGrowRunning: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cron-control");
      const d = await res.json();
      setData(d);
    } catch (err) {
      console.error("Failed to fetch cron status", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const inv = setInterval(fetchStatus, 5000);
    return () => clearInterval(inv);
  }, [fetchStatus]);

  const toggleCrons = async (type: "inbox" | "grow") => {
    if (!data) return;
    setToggling(type);
    const setRunning = type === "inbox" ? data.anyInboxRunning : data.anyGrowRunning;
    const action = setRunning ? "stop" : "start";
    
    // We target the individual bot APIs
    const targets = type === "inbox" 
      ? ["/api/xavier/inbox/cron", "/api/instar/inbox/cron", "/api/felix/inbox/cron", "/api/cindy/inbox/cron"]
      : ["/api/xavier/grow/cron", "/api/instar/grow/cron"];

    try {
      await Promise.all(targets.map(url => 
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        }).catch(err => console.error(`Failed to ${action} ${url}`, err))
      ));
      await fetchStatus();
    } finally {
      setToggling(null);
    }
  };

  if (loading && !data) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {/* Expanded status panel */}
      {isExpanded && data && (
        <div className="pointer-events-auto w-72 rounded-2xl border border-white/10 bg-[#0a0a0b]/90 backdrop-blur-xl shadow-2xl p-4 mb-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Global Cron Status</h3>
            <Activity size={14} className="text-blue-400 animate-pulse" />
          </div>
          
          <div className="space-y-4">
            {/* Inbox Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <MessageSquare size={14} className="text-indigo-400" /> Inbox Crons
                </span>
                <div className={`h-1.5 w-1.5 rounded-full ${data.anyInboxRunning ? 'bg-green-400 animate-pulse ring-4 ring-green-400/20' : 'bg-gray-600'}`} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(data.statuses.inbox).map(([bot, status]) => (
                  <div key={bot} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5">
                    <div className={`w-1.5 h-1.5 rounded-full ${status.running ? (status.suspended ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]' : 'bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.4)]') : 'bg-red-500/30'}`} />
                    <span className="text-[10px] font-bold text-gray-400 capitalize">{bot}</span>
                    {status.suspended && <AlertCircle size={10} className="text-amber-400 animate-bounce ml-auto" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Growth Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <TrendingUp size={14} className="text-cyan-400" /> Growth Crons
                </span>
                <div className={`h-1.5 w-1.5 rounded-full ${data.anyGrowRunning ? 'bg-green-400 animate-pulse ring-4 ring-green-400/20' : 'bg-gray-600'}`} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(data.statuses.grow).map(([bot, status]) => (
                  <div key={bot} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5">
                    <div className={`w-1.5 h-1.5 rounded-full ${status.running ? (status.suspended ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]' : 'bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.4)]') : 'bg-red-500/30'}`} />
                    <span className="text-[10px] font-bold text-gray-400 capitalize">{bot}</span>
                    {status.suspended && <AlertCircle size={10} className="text-amber-400 animate-bounce ml-auto" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <button 
            onClick={() => setIsExpanded(false)}
            className="w-full mt-4 flex items-center justify-center py-1 text-gray-600 hover:text-gray-400 transition-colors"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      )}

      {/* Floating control buttons */}
      <div className="flex flex-col gap-2 pointer-events-auto">
        {/* Toggle Growth Crons */}
        <button
          disabled={!!toggling}
          onClick={() => toggleCrons("grow")}
          className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-bold shadow-lg transition-all active:scale-95 group border ${
            data?.anyGrowRunning 
            ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20" 
            : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20"
          }`}
        >
          {toggling === "grow" ? <RefreshCw size={16} className="animate-spin" /> : (data?.anyGrowRunning ? <Square size={16} /> : <Play size={16} />)}
          <span className="text-xs uppercase tracking-widest whitespace-nowrap">Growth Crons</span>
        </button>

        {/* Toggle Inbox Crons */}
        <button
          disabled={!!toggling}
          onClick={() => toggleCrons("inbox")}
          className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-bold shadow-lg transition-all active:scale-95 group border ${
            data?.anyInboxRunning 
            ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20" 
            : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20"
          }`}
        >
          {toggling === "inbox" ? <RefreshCw size={16} className="animate-spin" /> : (data?.anyInboxRunning ? <Square size={16} /> : <Play size={16} />)}
          <span className="text-xs uppercase tracking-widest whitespace-nowrap">Inbox Crons</span>
        </button>

        {/* Toggle Panel Button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center justify-center w-12 h-12 self-end rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-white shadow-xl backdrop-blur-md transition-all ${isExpanded ? 'rotate-180' : ''}`}
        >
          {isExpanded ? <ChevronDown size={22} /> : <Bot size={22} />}
        </button>
      </div>
    </div>
  );
}
