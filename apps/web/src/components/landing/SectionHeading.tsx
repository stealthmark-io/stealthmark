import React from "react";

interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
}

export function SectionHeading({ eyebrow, title, subtitle }: SectionHeadingProps) {
  return (
    <div className="text-center space-y-2 max-w-2xl mx-auto">
      <div className="text-xs font-mono font-semibold tracking-widest text-cyan-400 uppercase">{eyebrow}</div>
      <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm sm:text-base text-slate-400 leading-relaxed">{subtitle}</p>}
    </div>
  );
}
