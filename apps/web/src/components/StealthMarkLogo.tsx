import React from "react";

export interface StealthMarkLogoProps {
  className?: string;
  style?: React.CSSProperties;
}

export function StealthMarkLogo({ className = "w-8 h-8", style }: StealthMarkLogoProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const humanGate = `sm-human-gate-${uid}`;
  const agentGate = `sm-agent-gate-${uid}`;

  return (
    <svg viewBox="0 0 120 120" className={className} style={style} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={humanGate} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
        <linearGradient id={agentGate} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00D2FE" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>
      </defs>
      {/* Human Portal Blade (Left) */}
      <path d="M 32,22 L 54,12 L 54,80 L 32,94 Z" fill={`url(#${humanGate})`} fillOpacity="0.95" />
      <path d="M 32,22 L 54,12 L 40,36 L 22,44 Z" fill="#A5B4FC" fillOpacity="0.8" />
      {/* Agent Portal Blade (Right) */}
      <path d="M 88,98 L 66,108 L 66,40 L 88,26 Z" fill={`url(#${agentGate})`} fillOpacity="0.95" />
      <path d="M 88,98 L 66,108 L 80,84 L 98,76 Z" fill="#6EE7B7" fillOpacity="0.8" />
      {/* Center Cryptographic Hexagon Node (The 'Mark') */}
      <polygon points="60,48 70,54 70,66 60,72 50,66 50,54" fill="#060709" stroke="#FFFFFF" strokeWidth="2.5" />
      <circle cx="60" cy="60" r="3.5" fill="#00D2FE">
        <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
