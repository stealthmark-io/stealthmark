'use client';

import React from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { StealthMarkLogo } from '@/components/StealthMarkLogo';

export type StealthLogoColor =
  | 'auto'
  | 'default'   // Nebula Violet & Cyan (Landing '/')
  | 'emerald'   // Cyber Mint & Emerald (Console '/dashboard')
  | 'cyan';     // Electric Sky & Cyan (Docs '/docs')

export interface StealthMascotProps {
  variant?: 'logo' | 'perch' | 'core' | 'floating' | 'hero';
  color?: StealthLogoColor;
  size?: number; // Height in pixels; natural ~1.84 aspect ratio preserved
  className?: string;
  glow?: boolean;
  onClick?: () => void;
  tooltipText?: string;
}

const COLOR_CONFIGS: Record<
  Exclude<StealthLogoColor, 'auto'>,
  {
    filter: string;
    glowStyle: string;
    label: string;
    badgeText: string;
    borderAccent: string;
  }
> = {
  default: {
    filter: 'hue-rotate(0deg) drop-shadow(0 0 12px rgba(139, 92, 246, 0.5)) drop-shadow(0 0 24px rgba(6, 182, 212, 0.3))',
    glowStyle: 'radial-gradient(circle, rgba(139, 92, 246, 0.4) 0%, rgba(6, 182, 212, 0.15) 50%, transparent 70%)',
    label: 'StealthMark Core',
    badgeText: 'StealthMark',
    borderAccent: 'border-violet-500/30',
  },
  emerald: {
    filter: 'hue-rotate(85deg) saturate(1.25) drop-shadow(0 0 14px rgba(16, 185, 129, 0.6)) drop-shadow(0 0 26px rgba(5, 150, 105, 0.3))',
    glowStyle: 'radial-gradient(circle, rgba(16, 185, 129, 0.45) 0%, rgba(20, 184, 166, 0.18) 50%, transparent 70%)',
    label: 'Console',
    badgeText: 'Console',
    borderAccent: 'border-emerald-500/30',
  },
  cyan: {
    filter: 'hue-rotate(-28deg) saturate(1.3) drop-shadow(0 0 14px rgba(6, 182, 212, 0.6)) drop-shadow(0 0 26px rgba(14, 165, 233, 0.3))',
    glowStyle: 'radial-gradient(circle, rgba(6, 182, 212, 0.45) 0%, rgba(59, 130, 246, 0.18) 50%, transparent 70%)',
    label: 'Docs & API Reference',
    badgeText: 'Docs',
    borderAccent: 'border-cyan-500/30',
  },
};

function resolveColor(pathname: string | null, explicitColor?: StealthLogoColor): Exclude<StealthLogoColor, 'auto'> {
  if (explicitColor && explicitColor !== 'auto') {
    return explicitColor;
  }
  if (!pathname || pathname === '/') return 'default';
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/console')) return 'emerald';
  if (pathname.startsWith('/docs')) return 'cyan';
  return 'default';
}

/**
 * StealthMark 3D Iridescent Ribbon Logo with Dynamic Per-Page Color Adaptation.
 * Auto-detects route or accepts explicit chromatic overrides.
 */
const emptySubscribe = () => () => {};
function useIsMounted() {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export function StealthMascot({
  variant = 'logo',
  color = 'auto',
  size,
  className = '',
  glow = true,
  onClick,
  tooltipText,
}: StealthMascotProps) {
  const pathname = usePathname();
  const mounted = useIsMounted();

  const activeColorKey = mounted ? resolveColor(pathname, color) : (color === 'auto' ? 'default' : color);
  const theme = COLOR_CONFIGS[activeColorKey];

  // 1. Standard Logo for Navbar, Footers, Sub-headers
  if (variant === 'logo') {
    const h = size || 32;
    return (
      <div className={`relative inline-flex items-center justify-center shrink-0 group ${className}`}>
        {glow && (
          <div
            className="absolute -inset-1 rounded-full blur-md opacity-60 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
            style={{ background: theme.glowStyle }}
          />
        )}
        <StealthMarkLogo
          className="relative z-10 select-none pointer-events-none transition-all duration-300 transform group-hover:scale-105"
          style={{
            height: `${h}px`,
            width: `${Math.round(h * 1.0)}px`,
          }}
        />
      </div>
    );
  }

  // 2. Perch Accent in the Hero Headline ("Love" with floating ribbon)
  if (variant === 'perch') {
    const h = size || 34;
    return (
      <span
        className={`absolute -top-7 -right-8 sm:-right-10 inline-block pointer-events-none select-none z-20 ${className}`}
      >
        <div className="relative animate-bounce" style={{ animationDuration: '3s' }}>
          {glow && (
            <div
              className="absolute -inset-2 rounded-full blur-lg opacity-75 pointer-events-none"
              style={{ background: theme.glowStyle }}
            />
          )}
          <Image
            src="/logo.png"
            alt="StealthMark"
            width={Math.round(h * 1.84)}
            height={h}
            unoptimized
            priority
            className="relative z-10 drop-shadow-xl"
            style={{
              height: `${h}px`,
              width: 'auto',
              filter: theme.filter,
            }}
          />
        </div>
      </span>
    );
  }

  // 3. Central Core Node for Constellation Hub
  if (variant === 'core') {
    const h = size || 80;
    return (
      <div className={`relative flex items-center justify-center ${className}`}>
        {/* Multi-tier energy aura */}
        <div
          className="absolute inset-0 w-44 h-44 -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2 rounded-full blur-2xl pointer-events-none animate-pulse"
          style={{ background: theme.glowStyle }}
        />
        <div className="absolute w-32 h-32 rounded-full border border-white/10 animate-ping opacity-20 pointer-events-none" />
        <div className="absolute w-28 h-28 rounded-full border border-white/15 animate-spin pointer-events-none" style={{ animationDuration: '18s' }} />

        {/* 3D Ribbon S Display */}
        <div className="relative z-10 p-3 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-md shadow-2xl flex items-center justify-center">
          <Image
            src="/logo.png"
            alt="StealthMark Core"
            width={Math.round(h * 1.84)}
            height={h}
            unoptimized
            priority
            className="select-none pointer-events-none transition-all duration-500 hover:scale-110"
            style={{
              height: `${h}px`,
              width: 'auto',
              filter: theme.filter,
            }}
          />
        </div>
      </div>
    );
  }

  // 4. Hero Showcase Display
  if (variant === 'hero') {
    const h = size || 110;
    return (
      <div className={`relative inline-flex items-center justify-center ${className}`}>
        <div
          className="absolute -inset-6 rounded-full blur-3xl opacity-80 pointer-events-none animate-pulse"
          style={{ background: theme.glowStyle }}
        />
        <Image
          src="/logo.png"
          alt="StealthMark Hero"
          width={Math.round(h * 1.84)}
          height={h}
          unoptimized
          priority
          className="relative z-10 select-none pointer-events-none transition-all duration-500 hover:scale-105"
          style={{
            height: `${h}px`,
            width: 'auto',
            filter: theme.filter,
          }}
        />
      </div>
    );
  }

  // 5. Floating Interactive Corner Sentinel Companion
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`fixed bottom-6 right-6 z-40 group cursor-pointer select-none ${className}`}
    >
      <div className="relative flex items-center gap-2.5">
        {/* Tooltip on hover */}
        <div className="hidden group-hover:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/95 border border-cyan-500/30 backdrop-blur-xl shadow-2xl text-xs font-mono text-slate-200 transition-all duration-300 -translate-x-2 animate-in fade-in">
          <span className="text-[11px] font-bold text-cyan-300">{tooltipText || theme.badgeText}</span>
        </div>

        {/* Floating Bubble */}
        <div className="relative">
          <div
            className="absolute -inset-2 rounded-full blur-md opacity-70 group-hover:opacity-100 transition duration-300"
            style={{ background: theme.glowStyle }}
          />
          <div
            className={`relative w-12 h-12 rounded-2xl bg-[#0d1017]/85 border ${theme.borderAccent} flex items-center justify-center shadow-xl backdrop-blur-md group-hover:scale-110 transition-transform duration-300`}
          >
            <StealthMarkLogo className="w-6 h-6 select-none pointer-events-none transition-transform group-hover:scale-105" />
          </div>
        </div>
      </div>
    </div>
  );
}
