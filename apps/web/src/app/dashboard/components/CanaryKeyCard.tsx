"use client";

import React, { useState } from "react";
import { AlertCircle, Check, Copy, Radar } from "lucide-react";
import { copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { describeKeyFailure } from "../views/useDashboardActions";

/** Issues the key for the `@stealthmark/next` dotfile fixture. StealthMark keeps no copy, so it is shown once. */
export function CanaryKeyCard() {
  const [canaryKey, setCanaryKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleIssue = async () => {
    if (isIssuing) return;
    setIsIssuing(true);
    setError(null);
    try {
      const res = await fetch("/api/keys/canary", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { key?: unknown; error?: unknown };
      if (!res.ok || typeof data.key !== "string") {
        setError(`The Canary key could not be issued (${describeKeyFailure(res.status, data.error, undefined)}).`);
        return;
      }
      setCanaryKey(data.key);
    } catch (err) {
      console.warn("[Canary Key] Issue failed:", err);
      setError("The Canary key could not be issued (network_error).");
    } finally {
      setIsIssuing(false);
    }
  };

  const handleCopy = async (text: string) => {
    if (await copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card variant="elevated" className="border-white/10 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Radar className="w-4 h-4 text-cyan-400" />
            <span>Canary key for /.env and /.git/</span>
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            With <code className="font-mono text-slate-300">dotfiles: &apos;synthetic_fixture&apos;</code>, @stealthmark/next answers those
            paths with synthetic values and a signed Canary URL. A client that later requests that URL shows up in your
            traffic log as &quot;Canary URL contactada&quot;. Set the key as{" "}
            <code className="font-mono text-slate-300">STEALTHMARK_CANARY_KEY</code> on your site.
          </p>
        </div>
        <Button onClick={handleIssue} variant="secondary" size="sm" disabled={isIssuing}>
          {isIssuing ? "Issuing..." : "Issue Canary key"}
        </Button>
      </div>

      {canaryKey && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Copy this key now: StealthMark does not store it and cannot show it again. Issuing a new key does not
              revoke earlier ones.
            </span>
          </div>
          <div className="p-3 rounded-xl bg-black/60 border border-cyan-500/40 font-mono text-xs text-cyan-200 break-all flex items-center justify-between gap-2">
            <span>{canaryKey}</span>
            <Button size="sm" variant="secondary" onClick={() => handleCopy(canaryKey)} className="shrink-0">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </Card>
  );
}
