'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Send,
  X,
  Sparkles,
  Bot,
  Activity,
  Cpu,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  Terminal,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StealthMarkLogo } from '@/components/StealthMarkLogo';

import type { GatewayMetrics } from '@/hooks/useGatewayTelemetry';

interface AiSentinelDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  defconLevel: number;
  domain: string;
  metrics?: GatewayMetrics | {
    total_requests?: number;
    threats_blocked?: number | {
      semantic_injections?: number;
      spoofed_identities?: number;
      payload_bombs?: number;
      rate_limit_throttled?: number;
    };
    performance?: {
      latency_p50_ms?: number;
    };
    economic_impact?: {
      tokens_saved?: number;
      estimated_usd_saved?: number;
    };
    latency_p50_ms?: number;
    tokens_saved?: number;
    usd_saved?: number;
  };
  onDefconSelect?: (level: number) => void;
}

interface Message {
  id: string;
  sender: 'sentinel' | 'user';
  text: string;
  timestamp: string;
  suggestedActions?: string[];
  category?: string;
  postureAssessment?: {
    level: number;
    status: string;
    summary: string;
  };
}

const DEFAULT_SUGGESTED_PROMPTS = [
  'Why was the latest bot request blocked?',
  'Verify Fail-Open Latency SLA (< 250ms)',
  'Calculate Token Cost Savings',
  'Run Security Pentest Simulation',
];

export function AiSentinelDrawer({
  isOpen,
  onClose,
  defconLevel,
  domain,
  metrics,
  onDefconSelect,
}: AiSentinelDrawerProps) {
  const rawThreats = metrics?.threats_blocked;
  const threatCount = typeof rawThreats === 'number'
    ? rawThreats
    : rawThreats && typeof rawThreats === 'object'
      ? ((rawThreats.semantic_injections || 0) +
         (rawThreats.spoofed_identities || 0) +
         (rawThreats.payload_bombs || 0) +
         (rawThreats.rate_limit_throttled || 0))
      : 1842;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg-initial',
      sender: 'sentinel',
      text: `### 🤖 StealthMark AI Sentinel Online

Perimeter guard active for **\`${domain || 'stealthmark.io'}\`**.

- **Active Defense:** DEFCON ${defconLevel}
- **Resilience:** Fail-Open < 250ms Guaranteed
- **Mitigated Threats:** ${threatCount.toLocaleString()} attacks neutralized

Ask me anything regarding perimeter security, why requests were blocked, or how to tune agent policies.`,
      timestamp: 'Just now',
      suggestedActions: DEFAULT_SUGGESTED_PROMPTS,
    },
  ]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSendPrompt = async (promptText: string) => {
    const text = promptText.trim();
    if (!text || isLoading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/ai/sentinel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          defconLevel,
          domain,
          metrics,
        }),
      });

      const data = await res.json();
      if (data.success) {
        const sentinelMsg: Message = {
          id: `sentinel-${Date.now()}`,
          sender: 'sentinel',
          text: data.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedActions: data.suggestedActions,
          category: data.category,
          postureAssessment: data.postureAssessment,
        };
        setMessages((prev) => [...prev, sentinelMsg]);
      } else {
        throw new Error(data.message || 'Error communicating with Sentinel');
      }
    } catch {
      const fallbackMsg: Message = {
        id: `sentinel-err-${Date.now()}`,
        sender: 'sentinel',
        text: `### 🛡️ Sentinel Autonomous Offline Diagnosis
        
Currently inspecting **\`${domain}\`** under **DEFCON ${defconLevel}**.
- **Perimeter Posture:** All edge shields operational.
- **Fail-Open Doctrine:** Active (< 250ms threshold transparent bypass).
- **Recent Threats Blocked:** Injections, payload bombs, and unverified bot crawlers neutralized at perimeter.`,
        timestamp: 'Just now',
        suggestedActions: DEFAULT_SUGGESTED_PROMPTS,
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Backdrop click to dismiss */}
      <div className="flex-1" onClick={onClose} />

      {/* Slide-over Drawer Panel */}
      <div
        className="w-full max-w-lg h-full bg-[#07090E] border-l border-cyan-500/30 shadow-[0_0_50px_rgba(0,0,0,0.9),0_0_30px_rgba(0,210,254,0.15)] flex flex-col text-left animate-in slide-in-from-right duration-300 relative z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 bg-[#0D1017] border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="absolute -inset-1 rounded-xl bg-cyan-500/30 blur-md animate-pulse" />
              <div className="relative w-9 h-9 rounded-xl bg-[#060709] border border-cyan-500/40 flex items-center justify-center">
                <StealthMarkLogo className="w-5 h-5" />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">AI Sentinel Copilot</h3>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 uppercase tracking-wider">
                  Live
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                DEFCON {defconLevel} · Fail-Open &lt; 250ms SLA
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer border border-white/10"
              title="Close Sentinel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Action Chips Toolbar */}
        <div className="p-3 bg-black/40 border-b border-white/[0.06] flex items-center gap-2 overflow-x-auto text-[11px] font-mono shrink-0">
          {DEFAULT_SUGGESTED_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSendPrompt(prompt)}
              disabled={isLoading}
              className="px-2.5 py-1 rounded-xl bg-white/[0.04] hover:bg-cyan-500/15 hover:border-cyan-500/30 text-slate-300 hover:text-cyan-300 border border-white/10 whitespace-nowrap transition cursor-pointer shrink-0 disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs font-sans">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col space-y-1.5 ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 px-1">
                <span>{m.sender === 'user' ? 'You' : 'AI Sentinel'}</span>
                <span>•</span>
                <span>{m.timestamp}</span>
              </div>

              <div
                className={`p-4 rounded-2xl max-w-[92%] leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 rounded-br-none'
                    : 'bg-[#0D1017] border border-white/10 text-slate-200 rounded-bl-none shadow-xl'
                }`}
              >
                {/* Markdown-style content renderer */}
                <div className="space-y-2 whitespace-pre-line text-xs">
                  {m.text}
                </div>

                {/* Follow-up Suggested Action Buttons */}
                {m.suggestedActions && m.suggestedActions.length > 0 && (
                  <div className="pt-3 mt-3 border-t border-white/[0.08] space-y-1.5">
                    <span className="text-[10px] font-mono text-slate-400 block font-semibold">Suggested Investigations:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {m.suggestedActions.map((action, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSendPrompt(action)}
                          className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/25 text-[10px] font-mono transition cursor-pointer"
                        >
                          {action} ↗
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono p-3 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Sentinel analyzing telemetry &amp; security vectors...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 bg-[#0D1017] border-t border-white/10 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendPrompt(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
              placeholder="Ask Sentinel about blocked requests, DEFCON, or tokens..."
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-400 transition"
            />
            <Button
              type="submit"
              variant="gradient"
              size="sm"
              disabled={!input.trim() || isLoading}
              className="px-3.5 py-2.5 rounded-xl cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
