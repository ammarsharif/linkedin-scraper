"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Home,
  ArrowLeft,
  Bot,
  Search,
  Zap,
  MessageSquare,
  Instagram,
  Facebook,
  Linkedin,
} from "lucide-react";

// ── Quick-links to bots ────────────────────────────────────────────────────

const BOTS = [
  { name: "Cindy",  href: "/cindy",  color: "#10b981", icon: <Linkedin  size={16} />, desc: "LinkedIn auto-reply" },
  { name: "Felix",  href: "/felix",  color: "#3b82f6", icon: <Facebook  size={16} />, desc: "Facebook messenger" },
  { name: "Instar", href: "/instar", color: "#e1306c", icon: <Instagram size={16} />, desc: "Instagram DMs" },
  { name: "Xavier", href: "/xavier", color: "#1d9bf0", icon: <MessageSquare size={16} />, desc: "Twitter / X" },
];

// ── Animated digit ─────────────────────────────────────────────────────────

function GlitchDigit({ char, delay = 0 }: { char: string; delay?: number }) {
  const [displayed, setDisplayed] = useState(char);
  const chars = "0123456789ABCDEF#@!?";

  useEffect(() => {
    let frame = 0;
    const total = 18;
    const timer = setTimeout(() => {
      const id = setInterval(() => {
        frame++;
        if (frame >= total) {
          setDisplayed(char);
          clearInterval(id);
        } else {
          setDisplayed(chars[Math.floor(Math.random() * chars.length)]);
        }
      }, 40);
      return () => clearInterval(id);
    }, delay);
    return () => clearTimeout(timer);
  }, [char, delay]);

  return <span>{displayed}</span>;
}

// ── Floating orbs background ────────────────────────────────────────────────

function FloatingOrbs() {
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
      {[
        { size: 600, x: "10%",  y: "20%",  color: "#0077b5", delay: 0 },
        { size: 400, x: "75%",  y: "60%",  color: "#8b5cf6", delay: 2 },
        { size: 300, x: "50%",  y: "10%",  color: "#10b981", delay: 4 },
        { size: 200, x: "20%",  y: "75%",  color: "#1d9bf0", delay: 1 },
      ].map((orb, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: orb.x,
            top: orb.y,
            width: orb.size,
            height: orb.size,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${orb.color}18 0%, transparent 70%)`,
            transform: "translate(-50%, -50%)",
            animation: `float-orb ${8 + orb.delay}s ease-in-out infinite alternate`,
            animationDelay: `${orb.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Grid overlay ────────────────────────────────────────────────────────────

function GridOverlay() {
  return (
    <div
      style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)," +
          "linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
        maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
      }}
    />
  );
}

// ── Main 404 Page ──────────────────────────────────────────────────────────

export default function NotFound() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(15);
  const [hoverBot, setHoverBot] = useState<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) { router.push("/"); }
  }, [countdown, router]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <style>{`
        @keyframes float-orb {
          from { transform: translate(-50%, -50%) scale(1); }
          to   { transform: translate(-50%, -50%) scale(1.15) rotate(5deg); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-ring {
          0%   { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0,119,181,0.4); }
          70%  { transform: scale(1);    box-shadow: 0 0 0 20px rgba(0,119,181,0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0,119,181,0); }
        }
        @keyframes scan-line {
          0%   { top: 0%; }
          100% { top: 100%; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        .not-found-bot-card {
          transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
        }
        .not-found-bot-card:hover {
          transform: translateY(-3px);
        }
        * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "#080910",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        fontFamily: "inherit",
        padding: "24px 16px",
      }}>
        <FloatingOrbs />
        <GridOverlay />

        {/* Scan line effect */}
        <div style={{
          position: "fixed", left: 0, right: 0, height: 2, zIndex: 1,
          background: "linear-gradient(90deg, transparent, rgba(0,119,181,0.5), transparent)",
          animation: "scan-line 4s linear infinite",
          pointerEvents: "none",
        }} />

        {/* Main content card */}
        <div style={{
          position: "relative", zIndex: 2,
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 0, maxWidth: 680, width: "100%", textAlign: "center",
        }}>

          {/* Bot icon */}
          <div
            style={{
              width: 72, height: 72, borderRadius: "50%",
              background: "rgba(0,119,181,0.1)",
              border: "1.5px solid rgba(0,119,181,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 32,
              animation: "pulse-ring 2.5s cubic-bezier(0.455,0.03,0.515,0.955) infinite",
            }}
          >
            <Bot size={32} color="#0077b5" strokeWidth={1.5} />
          </div>

          {/* 404 digits */}
          <div
            style={{
              fontSize: "clamp(80px, 18vw, 160px)",
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              marginBottom: 24,
              background: "linear-gradient(135deg, #0077b5 0%, #00b4d8 40%, #8b5cf6 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              fontVariantNumeric: "tabular-nums",
              animation: "fade-up 0.6s ease both",
              filter: "drop-shadow(0 0 40px rgba(0,119,181,0.3))",
            }}
          >
            <GlitchDigit char="4" delay={0}  />
            <GlitchDigit char="0" delay={80} />
            <GlitchDigit char="4" delay={160}/>
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize: "clamp(22px, 4vw, 32px)",
            fontWeight: 800,
            color: "#fff",
            margin: "0 0 12px",
            animation: "fade-up 0.6s 0.15s ease both",
          }}>
            Page Not Found
          </h1>

          {/* Sub-text */}
          <p style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.4)",
            maxWidth: 420,
            lineHeight: 1.7,
            margin: "0 0 36px",
            animation: "fade-up 0.6s 0.25s ease both",
          }}>
            The page you&apos;re looking for doesn&apos;t exist or was moved.
            Redirecting you to the dashboard in{" "}
            <span style={{
              color: "#0077b5", fontWeight: 700, fontVariantNumeric: "tabular-nums",
              display: "inline-block", minWidth: 18,
            }}>
              {countdown}
            </span>
            <span style={{ animation: "blink 1s step-start infinite", color: "#0077b5" }}>s</span>
          </p>

          {/* Countdown progress bar */}
          <div style={{
            width: "min(300px, 90%)", height: 3, borderRadius: 4,
            background: "rgba(255,255,255,0.06)",
            marginBottom: 40,
            overflow: "hidden",
            animation: "fade-up 0.6s 0.3s ease both",
          }}>
            <div style={{
              height: "100%", borderRadius: 4,
              background: "linear-gradient(90deg, #0077b5, #00b4d8)",
              width: `${(countdown / 15) * 100}%`,
              transition: "width 1s linear",
            }} />
          </div>

          {/* Action buttons */}
          <div style={{
            display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center",
            marginBottom: 48,
            animation: "fade-up 0.6s 0.35s ease both",
          }}>
            <button
              onClick={() => router.push("/")}
              style={{
                background: "linear-gradient(135deg, #0077b5, #00a0dc)",
                border: "none", borderRadius: 12,
                padding: "12px 24px", cursor: "pointer",
                color: "#fff", fontSize: 14, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 8,
                boxShadow: "0 4px 24px rgba(0,119,181,0.35)",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 32px rgba(0,119,181,0.5)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform = "";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 24px rgba(0,119,181,0.35)";
              }}
            >
              <Home size={16} /> Go to Dashboard
            </button>

            <button
              onClick={() => router.back()}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12, padding: "12px 24px", cursor: "pointer",
                color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 8,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.09)";
                (e.currentTarget as HTMLButtonElement).style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.6)";
              }}
            >
              <ArrowLeft size={16} /> Go Back
            </button>
          </div>

          {/* Divider */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            width: "min(480px, 100%)", marginBottom: 28,
            animation: "fade-up 0.6s 0.45s ease both",
          }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
            <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>
              Or jump to a bot
            </span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
          </div>

          {/* Bot quick-links */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10, width: "min(560px, 100%)",
            animation: "fade-up 0.6s 0.5s ease both",
          }}>
            {BOTS.map((bot) => (
              <button
                key={bot.name}
                className="not-found-bot-card"
                onClick={() => router.push(bot.href)}
                onMouseEnter={() => setHoverBot(bot.name)}
                onMouseLeave={() => setHoverBot(null)}
                style={{
                  background: hoverBot === bot.name
                    ? `${bot.color}12`
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${hoverBot === bot.name ? bot.color + "44" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 14, padding: "14px 10px", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  boxShadow: hoverBot === bot.name ? `0 8px 28px ${bot.color}20` : "none",
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: `${bot.color}15`,
                  border: `1px solid ${bot.color}30`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: bot.color,
                }}>
                  {bot.icon}
                </div>
                <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: 700 }}>
                  {bot.name}
                </div>
                <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, lineHeight: 1.3 }}>
                  {bot.desc}
                </div>
              </button>
            ))}
          </div>

          {/* Error code badge */}
          <div style={{
            marginTop: 48,
            display: "flex", alignItems: "center", gap: 6,
            color: "rgba(255,255,255,0.15)", fontSize: 11,
            animation: "fade-up 0.6s 0.6s ease both",
          }}>
            <Search size={12} />
            <span>Error 404 · Page not found · <span style={{ color: "rgba(255,255,255,0.25)" }}>linkedin-scraper dashboard</span></span>
            <Zap size={11} fill="rgba(255,255,255,0.1)" />
          </div>
        </div>
      </div>
    </>
  );
}
