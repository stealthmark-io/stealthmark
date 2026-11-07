'use client';

import React, { useState } from 'react';
import { IntegrationIcon } from '@/components/IntegrationIcon';

interface ConstellationHubProps {
  onSelectTool?: (toolId: string) => void;
  selectedTool?: string;
}

export function ConstellationHub({ onSelectTool, selectedTool }: ConstellationHubProps) {
  const [activeNode, setActiveNode] = useState<string>(selectedTool || 'cursor');

  const handleNodeClick = (toolId: string) => {
    setActiveNode(toolId);
    if (onSelectTool) {
      onSelectTool(toolId);
    }
    // Also dispatch event for global listeners if any
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('stealthmark:select-tool', { detail: { toolId } }));
    }
  };

  return (
    <section id="network" className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
      <div className="text-center space-y-2 max-w-xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-mono font-bold uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
          Radial Agentic Topology
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          The Core that Agents Love
        </h2>
        <p className="text-xs sm:text-sm text-slate-400">
          StealthMark acts as the orbital clearinghouse, routing intent and protecting web infrastructures in sub-10ms.
        </p>
      </div>

      <div className="bento-card p-4 sm:p-8 md:p-12 rounded-3xl relative overflow-hidden flex items-center justify-center min-h-[580px] border border-white/10 bg-[#0d1017]/85 backdrop-blur-xl shadow-2xl">
        {/* Ambient Radial Lights */}
        <div className="absolute w-[320px] h-[320px] rounded-full bg-indigo-600/20 blur-[90px] pointer-events-none"></div>
        <div className="absolute w-[260px] h-[260px] rounded-full bg-cyan-500/20 blur-[80px] pointer-events-none"></div>

        <svg viewBox="0 0 800 600" className="w-full max-w-3xl h-auto select-none" fill="none">
          <defs>
            {/* Core Gradient */}
            <radialGradient id="sm-core-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00D2FE" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
            </radialGradient>

            {/* Radial Line Gradient */}
            <linearGradient id="sm-line-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366F1" stopOpacity="0.25" />
              <stop offset="50%" stopColor="#00D2FE" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.25" />
            </linearGradient>

            {/* Dual Door Core Blades */}
            <linearGradient id="core-human-blade" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#818CF8" />
              <stop offset="100%" stopColor="#4F46E5" />
            </linearGradient>
            <linearGradient id="core-agent-blade" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00D2FE" />
              <stop offset="100%" stopColor="#10B981" />
            </linearGradient>
          </defs>

          {/* Outer Radar Rings */}
          <circle cx="400" cy="300" r="240" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4 6" />
          <circle cx="400" cy="300" r="160" stroke="rgba(0,210,254,0.14)" strokeWidth="1.5" />
          <circle cx="400" cy="300" r="85" fill="url(#sm-core-glow)" />

          {/* ── 8 Radial Spokes with Continuous SVG Moving Data Packets ── */}
          {/* Spoke 1: Top (Claude Code) */}
          <line x1="400" y1="300" x2="400" y2="75" stroke="url(#sm-line-grad)" strokeWidth="1.5" />
          <circle r="3.5" fill="#00D2FE">
            <animateMotion path="M 400 75 L 400 300" dur="3s" repeatCount="indefinite" />
          </circle>

          {/* Spoke 2: Top-Right (Cursor) */}
          <line x1="400" y1="300" x2="570" y2="130" stroke="url(#sm-line-grad)" strokeWidth="1.5" />
          <circle r="3.5" fill="#6366F1">
            <animateMotion path="M 570 130 L 400 300" dur="2.4s" repeatCount="indefinite" />
          </circle>

          {/* Spoke 3: Right (Windsurf) */}
          <line x1="400" y1="300" x2="640" y2="300" stroke="url(#sm-line-grad)" strokeWidth="1.5" />
          <circle r="3.5" fill="#10B981">
            <animateMotion path="M 640 300 L 400 300" dur="2.8s" repeatCount="indefinite" />
          </circle>

          {/* Spoke 4: Bottom-Right (OpenAI Operator) */}
          <line x1="400" y1="300" x2="570" y2="470" stroke="url(#sm-line-grad)" strokeWidth="1.5" />
          <circle r="3.5" fill="#00D2FE">
            <animateMotion path="M 570 470 L 400 300" dur="3.2s" repeatCount="indefinite" />
          </circle>

          {/* Spoke 5: Bottom (Cline) */}
          <line x1="400" y1="300" x2="400" y2="525" stroke="url(#sm-line-grad)" strokeWidth="1.5" />
          <circle r="3.5" fill="#6366F1">
            <animateMotion path="M 400 525 L 400 300" dur="2.6s" repeatCount="indefinite" />
          </circle>

          {/* Spoke 6: Bottom-Left (GitHub Copilot) */}
          <line x1="400" y1="300" x2="230" y2="470" stroke="url(#sm-line-grad)" strokeWidth="1.5" />
          <circle r="3.5" fill="#10B981">
            <animateMotion path="M 230 470 L 400 300" dur="3.5s" repeatCount="indefinite" />
          </circle>

          {/* Spoke 7: Left (REST & MCP) */}
          <line x1="400" y1="300" x2="160" y2="300" stroke="url(#sm-line-grad)" strokeWidth="1.5" />
          <circle r="3.5" fill="#00D2FE">
            <animateMotion path="M 160 300 L 400 300" dur="2.1s" repeatCount="indefinite" />
          </circle>

          {/* Spoke 8: Top-Left (Hermes Agent) */}
          <line x1="400" y1="300" x2="230" y2="130" stroke="url(#sm-line-grad)" strokeWidth="1.5" />
          <circle r="3.5" fill="#6366F1">
            <animateMotion path="M 230 130 L 400 300" dur="2.9s" repeatCount="indefinite" />
          </circle>

          {/* ── 4 Floating Contextual Chips (Memanto Style) ── */}
          {/* Chip 1: KYA Handshake Verified */}
          <g transform="translate(460, 195)">
            <rect x="0" y="0" width="145" height="26" rx="13" fill="#0d1017" stroke="rgba(0,210,254,0.35)" strokeWidth="1" />
            <circle cx="13" cy="13" r="3.5" fill="#00D2FE" />
            <text x="24" y="16" fill="#e2e8f0" fontSize="9.5" fontFamily="'JetBrains Mono', monospace" fontWeight="600">
              KYA Handshake Verified
            </text>
          </g>

          {/* Chip 2: 8.5 ms Fastpath */}
          <g transform="translate(195, 205)">
            <rect x="0" y="0" width="135" height="26" rx="13" fill="#0d1017" stroke="rgba(99,102,241,0.35)" strokeWidth="1" />
            <circle cx="13" cy="13" r="3.5" fill="#818CF8" />
            <text x="24" y="16" fill="#e2e8f0" fontSize="9.5" fontFamily="'JetBrains Mono', monospace" fontWeight="600">
              8.5 ms Fastpath
            </text>
          </g>

          {/* Chip 3: Anti-Replay (120s) */}
          <g transform="translate(480, 385)">
            <rect x="0" y="0" width="145" height="26" rx="13" fill="#0d1017" stroke="rgba(16,185,129,0.35)" strokeWidth="1" />
            <circle cx="13" cy="13" r="3.5" fill="#10B981" />
            <text x="24" y="16" fill="#e2e8f0" fontSize="9.5" fontFamily="'JetBrains Mono', monospace" fontWeight="600">
              Anti-Replay (120s)
            </text>
          </g>

          {/* Chip 4: 422 Semantic Guard */}
          <g transform="translate(175, 385)">
            <rect x="0" y="0" width="150" height="26" rx="13" fill="#0d1017" stroke="rgba(244,63,94,0.35)" strokeWidth="1" />
            <circle cx="13" cy="13" r="3.5" fill="#F43F5E" />
            <text x="24" y="16" fill="#e2e8f0" fontSize="9.5" fontFamily="'JetBrains Mono', monospace" fontWeight="600">
              422 Semantic Guard
            </text>
          </g>

          {/* ── Central Core Node: StealthMark Dual-Door Engine ── */}
          <g transform="translate(400, 300)" className="cursor-pointer">
            {/* Outer Hexagon Ring with breathing opacity */}
            <polygon points="0,-48 42,-24 42,24 0,48 -42,24 -42,-24" fill="#060709" stroke="#00D2FE" strokeWidth="2.5">
              <animate attributeName="stroke-opacity" values="0.4;1;0.4" dur="2.4s" repeatCount="indefinite" />
            </polygon>
            <circle r="34" fill="#0d1017" stroke="#6366F1" strokeWidth="1.5" />
            
            {/* Official StealthMark Dual-Door Logo inside Center */}
            <g transform="translate(-16, -16) scale(0.26)">
              <path d="M 32,22 L 54,12 L 54,80 L 32,94 Z" fill="url(#core-human-blade)" fillOpacity="0.95"/>
              <path d="M 32,22 L 54,12 L 40,36 L 22,44 Z" fill="#A5B4FC" fillOpacity="0.8"/>
              <path d="M 88,98 L 66,108 L 66,40 L 88,26 Z" fill="url(#core-agent-blade)" fillOpacity="0.95"/>
              <path d="M 88,98 L 66,108 L 80,84 L 98,76 Z" fill="#6EE7B7" fillOpacity="0.8"/>
              <polygon points="60,48 70,54 70,66 60,72 50,66 50,54" fill="#060709" stroke="#FFFFFF" strokeWidth="2.5"/>
              <circle cx="60" cy="60" r="4.5" fill="#00D2FE"/>
            </g>

            <text textAnchor="middle" y="65" fill="#ffffff" fontSize="11" fontWeight="800" fontFamily="'Plus Jakarta Sans', sans-serif">
              STEALTHMARK
            </text>
            <text textAnchor="middle" y="78" fill="#00D2FE" fontSize="8" fontFamily="'JetBrains Mono', monospace" fontWeight="700">
              DUAL-GATEWAY CORE
            </text>
          </g>

          {/* ── 8 Satellite Agent Nodes (Interactive) ── */}
          {/* 1. Claude Code (Top) */}
          <g transform="translate(400, 75)" className="cursor-pointer group" onClick={() => handleNodeClick('claude-code')}>
            <rect x="-24" y="-24" width="48" height="48" rx="14" fill="#0d1017" stroke={activeNode === 'claude-code' ? '#F59E0B' : 'rgba(245, 158, 11, 0.45)'} strokeWidth={activeNode === 'claude-code' ? '2.5' : '1.5'} />
            <foreignObject x="-20" y="-20" width="40" height="40" className="pointer-events-none">
              <IntegrationIcon id="claude-code" size="md" active={activeNode === 'claude-code'} className="border-0 bg-transparent" />
            </foreignObject>
            <text textAnchor="middle" y="38" fill="#ffffff" fontSize="10" fontWeight="700" fontFamily="'Plus Jakarta Sans', sans-serif">
              Claude Code
            </text>
            <text textAnchor="middle" y="49" fill="#94a3b8" fontSize="8" fontFamily="'JetBrains Mono', monospace">
              CLI · Anthropic
            </text>
          </g>

          {/* 2. Cursor (Top Right) */}
          <g transform="translate(570, 130)" className="cursor-pointer group" onClick={() => handleNodeClick('cursor')}>
            <rect x="-24" y="-24" width="48" height="48" rx="14" fill="#0d1017" stroke={activeNode === 'cursor' ? '#00D2FE' : 'rgba(0, 210, 254, 0.45)'} strokeWidth={activeNode === 'cursor' ? '2.5' : '1.5'} />
            <foreignObject x="-20" y="-20" width="40" height="40" className="pointer-events-none">
              <IntegrationIcon id="cursor" size="md" active={activeNode === 'cursor'} className="border-0 bg-transparent" />
            </foreignObject>
            <text textAnchor="middle" y="38" fill="#ffffff" fontSize="10" fontWeight="700" fontFamily="'Plus Jakarta Sans', sans-serif">
              Cursor
            </text>
            <text textAnchor="middle" y="49" fill="#94a3b8" fontSize="8" fontFamily="'JetBrains Mono', monospace">
              IDE Agent
            </text>
          </g>

          {/* 3. Windsurf (Right) */}
          <g transform="translate(640, 300)" className="cursor-pointer group" onClick={() => handleNodeClick('windsurf')}>
            <rect x="-24" y="-24" width="48" height="48" rx="14" fill="#0d1017" stroke={activeNode === 'windsurf' ? '#38BDF8' : 'rgba(56, 189, 248, 0.45)'} strokeWidth={activeNode === 'windsurf' ? '2.5' : '1.5'} />
            <foreignObject x="-20" y="-20" width="40" height="40" className="pointer-events-none">
              <IntegrationIcon id="windsurf" size="md" active={activeNode === 'windsurf'} className="border-0 bg-transparent" />
            </foreignObject>
            <text textAnchor="middle" y="38" fill="#ffffff" fontSize="10" fontWeight="700" fontFamily="'Plus Jakarta Sans', sans-serif">
              Windsurf
            </text>
            <text textAnchor="middle" y="49" fill="#94a3b8" fontSize="8" fontFamily="'JetBrains Mono', monospace">
              Cascade Engine
            </text>
          </g>

          {/* 4. OpenAI Operator (Bottom Right) */}
          <g transform="translate(570, 470)" className="cursor-pointer group" onClick={() => handleNodeClick('openai-operator')}>
            <rect x="-24" y="-24" width="48" height="48" rx="14" fill="#0d1017" stroke={activeNode === 'openai-operator' ? '#10B981' : 'rgba(16, 185, 129, 0.45)'} strokeWidth={activeNode === 'openai-operator' ? '2.5' : '1.5'} />
            <foreignObject x="-20" y="-20" width="40" height="40" className="pointer-events-none">
              <IntegrationIcon id="openai-operator" size="md" active={activeNode === 'openai-operator'} className="border-0 bg-transparent" />
            </foreignObject>
            <text textAnchor="middle" y="38" fill="#ffffff" fontSize="10" fontWeight="700" fontFamily="'Plus Jakarta Sans', sans-serif">
              OpenAI Operator
            </text>
            <text textAnchor="middle" y="49" fill="#94a3b8" fontSize="8" fontFamily="'JetBrains Mono', monospace">
              Autonomous Web
            </text>
          </g>

          {/* 5. Cline (Bottom) */}
          <g transform="translate(400, 525)" className="cursor-pointer group" onClick={() => handleNodeClick('cline')}>
            <rect x="-24" y="-24" width="48" height="48" rx="14" fill="#0d1017" stroke={activeNode === 'cline' ? '#C084FC' : 'rgba(192, 132, 252, 0.45)'} strokeWidth={activeNode === 'cline' ? '2.5' : '1.5'} />
            <foreignObject x="-20" y="-20" width="40" height="40" className="pointer-events-none">
              <IntegrationIcon id="cline" size="md" active={activeNode === 'cline'} className="border-0 bg-transparent" />
            </foreignObject>
            <text textAnchor="middle" y="38" fill="#ffffff" fontSize="10" fontWeight="700" fontFamily="'Plus Jakarta Sans', sans-serif">
              Cline
            </text>
            <text textAnchor="middle" y="49" fill="#94a3b8" fontSize="8" fontFamily="'JetBrains Mono', monospace">
              Autonomous Agent
            </text>
          </g>

          {/* 6. GitHub Copilot (Bottom Left) */}
          <g transform="translate(230, 470)" className="cursor-pointer group" onClick={() => handleNodeClick('github-copilot')}>
            <rect x="-24" y="-24" width="48" height="48" rx="14" fill="#0d1017" stroke={activeNode === 'github-copilot' ? '#A855F7' : 'rgba(168, 85, 247, 0.45)'} strokeWidth={activeNode === 'github-copilot' ? '2.5' : '1.5'} />
            <foreignObject x="-20" y="-20" width="40" height="40" className="pointer-events-none">
              <IntegrationIcon id="github-copilot" size="md" active={activeNode === 'github-copilot'} className="border-0 bg-transparent" />
            </foreignObject>
            <text textAnchor="middle" y="38" fill="#ffffff" fontSize="10" fontWeight="700" fontFamily="'Plus Jakarta Sans', sans-serif">
              GitHub Copilot
            </text>
            <text textAnchor="middle" y="49" fill="#94a3b8" fontSize="8" fontFamily="'JetBrains Mono', monospace">
              Editor Agent
            </text>
          </g>

          {/* 7. REST & MCP (Left) */}
          <g transform="translate(160, 300)" className="cursor-pointer group" onClick={() => handleNodeClick('mcp-server')}>
            <rect x="-24" y="-24" width="48" height="48" rx="14" fill="#0d1017" stroke={activeNode === 'mcp-server' ? '#00D2FE' : 'rgba(0, 210, 254, 0.45)'} strokeWidth={activeNode === 'mcp-server' ? '2.5' : '1.5'} />
            <foreignObject x="-20" y="-20" width="40" height="40" className="pointer-events-none">
              <IntegrationIcon id="mcp-server" size="md" active={activeNode === 'mcp-server'} className="border-0 bg-transparent" />
            </foreignObject>
            <text textAnchor="middle" y="38" fill="#ffffff" fontSize="10" fontWeight="700" fontFamily="'Plus Jakarta Sans', sans-serif">
              REST & MCP
            </text>
            <text textAnchor="middle" y="49" fill="#94a3b8" fontSize="8" fontFamily="'JetBrains Mono', monospace">
              Agentic API
            </text>
          </g>

          {/* 8. Hermes Agent (Top Left) */}
          <g transform="translate(230, 130)" className="cursor-pointer group" onClick={() => handleNodeClick('hermes-agent')}>
            <rect x="-24" y="-24" width="48" height="48" rx="14" fill="#0d1017" stroke={activeNode === 'hermes-agent' ? '#00D2FE' : 'rgba(0, 210, 254, 0.45)'} strokeWidth={activeNode === 'hermes-agent' ? '2.5' : '1.5'} />
            <foreignObject x="-20" y="-20" width="40" height="40" className="pointer-events-none">
              <IntegrationIcon id="hermes-agent" size="md" active={activeNode === 'hermes-agent'} className="border-0 bg-transparent" />
            </foreignObject>
            <text textAnchor="middle" y="38" fill="#00D2FE" fontSize="10" fontWeight="700" fontFamily="'Plus Jakarta Sans', sans-serif">
              Hermes Agent
            </text>
            <text textAnchor="middle" y="49" fill="#94a3b8" fontSize="8" fontFamily="'JetBrains Mono', monospace">
              Nous Research
            </text>
          </g>
        </svg>
      </div>
    </section>
  );
}
