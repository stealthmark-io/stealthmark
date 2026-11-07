"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { useLanguage } from "@/context/LanguageContext";
import { SDK_NPM_URL } from "@/lib/site";
import { CtaButtons } from "./Cta";
import { SectionHeading } from "./SectionHeading";

const NEXT_USAGE = `import { withStealthMark } from "@stealthmark/next";

export default withStealthMark(middleware, { siteName: "My Site", agentPolicy: "observe" });`;

export function InstallSection() {
  const { t } = useLanguage();
  const copy = t.landing.install;

  return (
    <section id="install" className="max-w-3xl mx-auto px-4 sm:px-6 space-y-8 py-4 scroll-mt-24">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <a
            href={SDK_NPM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-amber-300 hover:text-amber-200 underline decoration-amber-300/40 hover:decoration-amber-200 transition-colors"
          >
            {copy.previewLabel}
          </a>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white font-mono text-[10px] font-extrabold uppercase tracking-wider">
              Blue Team Shield
            </span>
            <Badge variant="info" size="md">
              {copy.license}
            </Badge>
          </div>
        </div>
        <CodeBlock code={NEXT_USAGE} language="typescript" title={copy.codeTitle} />
        <p className="text-xs text-slate-500 text-center">{copy.note}</p>
      </div>

      <CtaButtons />
    </section>
  );
}
