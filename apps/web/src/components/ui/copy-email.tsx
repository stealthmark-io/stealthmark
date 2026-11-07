'use client';

import React, { useRef, useState } from 'react';

interface CopyEmailProps {
  address: string;
  icon?: React.ReactNode;
  className?: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

/** Shows an address as selectable text with a copy button; replaces mailto: links. */
export function CopyEmail({ address, icon, className = '' }: CopyEmailProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setState('copied');
    } catch (error) {
      console.warn('[StealthMark] Clipboard write was blocked:', error instanceof Error ? error.name : 'unknown');
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2500);
  };

  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy it manually' : 'Copy';

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {icon}
      <span className="select-all">{address}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${address}`}
        className="text-[10px] px-1.5 py-0.5 rounded border border-white/15 text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
      >
        {label}
      </button>
    </span>
  );
}
