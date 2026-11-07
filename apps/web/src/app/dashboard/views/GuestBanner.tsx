"use client";

interface GuestBannerProps {
  onSignIn: () => void;
}

export function GuestBanner({ onSignIn }: GuestBannerProps) {
  return (
    <div className="p-3.5 rounded-2xl bg-gradient-to-r from-cyan-950/30 via-blue-950/20 to-purple-950/30 border border-cyan-500/20 flex items-center justify-between gap-4 text-xs">
      <div className="flex flex-wrap items-center gap-2.5 text-slate-300">
        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono font-bold uppercase tracking-wider text-[10px] shrink-0">
          Demo data
        </span>
        <span>
          You are exploring the console in <strong>Guest Mode</strong>. The agents, keys and routes shown here are sample data, not real traffic. Sign in to add your own site and see real agent events.
        </span>
      </div>
      <button
        type="button"
        onClick={onSignIn}
        className="px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 font-semibold border border-cyan-500/30 transition shrink-0 cursor-pointer"
      >
        Sign In Now →
      </button>
    </div>
  );
}
