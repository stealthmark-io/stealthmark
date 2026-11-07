"use client";

import React, { useState } from "react";
import { cn, copyToClipboard } from "@/lib/utils";
import { Check, Copy, Terminal } from "lucide-react";

export interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  showLineNumbers?: boolean;
  className?: string;
  variant?: "terminal" | "simple";
}

export function CodeBlock({
  code,
  language = "bash",
  title,
  showLineNumbers = false,
  className,
  variant = "terminal",
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(code);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const lines = code.trim().split("\n");

  return (
    <div
      className={cn(
        "relative rounded-2xl overflow-hidden border border-white/10 bg-[#080612]/95 backdrop-blur-xl shadow-2xl font-mono text-xs sm:text-sm",
        className
      )}
    >
      {variant === "terminal" ? (
        <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            {title && (
              <span className="ml-2 text-xs text-slate-400 font-sans font-medium flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-purple-400" />
                {title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-purple-300/80 uppercase font-sans font-semibold tracking-wider px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
              {language}
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
              title="Copy code"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[11px] text-emerald-400 font-sans font-medium">
                    Copied!
                  </span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-sans">Copy</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </button>
      )}

      <div className="p-4 overflow-x-auto os-scroll">
        <pre className="text-slate-200 leading-relaxed font-mono">
          {showLineNumbers ? (
            <code>
              {lines.map((line, idx) => (
                <div key={idx} className="table-row">
                  <span className="table-cell pr-4 select-none text-slate-600 text-right w-8">
                    {idx + 1}
                  </span>
                  <span className="table-cell">{line}</span>
                </div>
              ))}
            </code>
          ) : (
            <code>{code}</code>
          )}
        </pre>
      </div>
    </div>
  );
}
