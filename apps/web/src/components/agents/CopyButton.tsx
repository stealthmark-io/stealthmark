'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type CopyState = 'idle' | 'copied' | 'failed';

const RESET_MS = 2000;

const STATUS_TEXT: Record<CopyState, string> = {
  idle: '',
  copied: 'Copied to clipboard',
  failed: 'Copy failed. Select the text and copy it manually.',
};

export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), RESET_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch (error) {
      console.warn('Clipboard write was refused', error);
      setState('failed');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors motion-reduce:transition-none',
          'border-white/10 bg-white/5 text-slate-300 hover:border-cyan-500/40 hover:bg-white/10 hover:text-white active:bg-white/15',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060709]',
          state === 'copied' && 'border-emerald-500/40 text-emerald-300',
          state === 'failed' && 'border-rose-500/40 text-rose-300',
          className,
        )}
      >
        {state === 'copied' ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : state === 'failed' ? (
          <TriangleAlert className="h-4 w-4" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
        <span className="hidden sm:inline">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Failed' : 'Copy'}</span>
      </button>
      <span className="sr-only" aria-live="polite">
        {STATUS_TEXT[state]}
      </span>
    </>
  );
}
