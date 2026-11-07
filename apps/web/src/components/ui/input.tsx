import React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
  variant?: "default" | "mono";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      error,
      leftIcon,
      rightElement,
      variant = "default",
      type = "text",
      ...props
    },
    ref
  ) => {
    return (
      <div className="w-full space-y-1.5">
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-3.5 flex items-center pointer-events-none text-slate-400">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            type={type}
            className={cn(
              "w-full bg-[#0e0a1c]/80 text-white placeholder:text-slate-500 rounded-xl border border-white/10 px-4 py-2.5 text-sm transition-all duration-200 outline-none",
              "focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:bg-[#151028]/90",
              leftIcon ? "pl-10" : "",
              rightElement ? "pr-12" : "",
              variant === "mono" ? "font-mono text-xs text-purple-200" : "",
              error ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500/20" : "",
              className
            )}
            {...props}
          />
          {rightElement && (
            <div className="absolute right-2.5 flex items-center">
              {rightElement}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-rose-400 pl-1">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
