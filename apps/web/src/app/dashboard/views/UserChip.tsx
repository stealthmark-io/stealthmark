"use client";

import { LogOut } from "lucide-react";
import type { AuthUser } from "@/lib/auth";

interface UserChipProps {
  user: AuthUser;
  isSuperAdmin: boolean;
  onLogout: () => void;
}

export function UserChip({ user, isSuperAdmin, onLogout }: UserChipProps) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-300">
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.name || "User"}
          className="w-5 h-5 rounded-full object-cover border border-cyan-400/50 shrink-0"
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center text-[10px] font-bold shrink-0">
          {(user.name || user.email)[0].toUpperCase()}
        </div>
      )}
      <div className="hidden sm:flex flex-col text-left">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-white leading-none text-[11px] truncate max-w-[120px]">
            {user.name ? `${user.name}` : "StealthMark Sovereign"}
          </span>
          {isSuperAdmin && (
            <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[8px] font-mono font-bold tracking-wider uppercase">
              Admin
            </span>
          )}
        </div>
        <span className="text-[9px] text-slate-400 font-mono mt-0.5 truncate max-w-[130px]">
          {user.email || user.provider}
        </span>
      </div>
      <button
        onClick={() => onLogout()}
        title="Sign Out"
        className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-rose-400 transition ml-0.5 cursor-pointer"
      >
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
