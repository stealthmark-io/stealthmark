'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { X, CheckCircle2, Copy, Check, ArrowRight, Loader2, Globe, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoneypotField } from '@/components/ui/honeypot-field';
import { LEAD_HONEYPOT_FIELD } from '@/lib/lead-fields';

interface ClaimWhitelistModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
  defaultUseCase?: string;
}

const USE_CASES = [
  'Next.js or Vercel site',
  'Express or Fastify API',
  'Docs or content site',
  'Enterprise or compliance request',
] as const;

const TRAFFIC_OPTIONS = [
  'Not sure yet',
  'Under 10,000 agent requests a month',
  '10,000 to 100,000 agent requests a month',
  'Over 100,000 agent requests a month',
] as const;

const DEFAULT_USE_CASE = USE_CASES[0];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WaitlistResponse {
  ticket_id?: string;
  error?: string;
}

function resolveUseCase(requested: string | undefined): string {
  if (requested && (USE_CASES as readonly string[]).includes(requested)) return requested;
  if (requested && requested.startsWith('Enterprise')) return 'Enterprise or compliance request';
  return DEFAULT_USE_CASE;
}

export function ClaimWhitelistModal({
  isOpen,
  onClose,
  initialEmail = '',
  defaultUseCase,
}: ClaimWhitelistModalProps) {
  const [email, setEmail] = useState(initialEmail);
  const [website, setWebsite] = useState('');
  const [useCase, setUseCase] = useState(resolveUseCase(defaultUseCase));
  const [expectedTraffic, setExpectedTraffic] = useState<string>(TRAFFIC_OPTIONS[0]);
  const [trap, setTrap] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!EMAIL_PATTERN.test(email)) {
      setError('Please provide a valid developer or work email address.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website, useCase, expectedTraffic, [LEAD_HONEYPOT_FIELD]: trap }),
      });

      const data = (await res.json()) as WaitlistResponse;

      if (!res.ok) {
        throw new Error(data.error || 'We could not register your request.');
      }

      setReference(data.ticket_id ?? null);
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyReference = () => {
    if (!reference) return;
    navigator.clipboard.writeText(reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setSubmitted(false);
    setReference(null);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="early-access-title"
        className="relative w-full max-w-lg rounded-3xl bg-[#060709] border border-cyan-500/30 p-6 sm:p-8 shadow-[0_0_60px_rgba(0,210,254,0.15)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient Top Glows */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-36 bg-cyan-500/20 blur-3xl pointer-events-none rounded-full" />
        <div className="absolute -bottom-20 right-0 w-60 h-32 bg-purple-500/15 blur-3xl pointer-events-none rounded-full" />

        {/* Close Button */}
        <button
          type="button"
          onClick={handleReset}
          aria-label="Close"
          className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {submitted ? (
          <div className="space-y-6 text-center py-2 animate-in zoom-in-95 duration-200 relative z-10">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_30px_rgba(0,210,254,0.3)]">
              <CheckCircle2 className="w-8 h-8 text-cyan-300" />
            </div>

            <div className="space-y-2">
              <h3 id="early-access-title" className="text-2xl font-black text-white tracking-tight">
                Request received
              </h3>
              <p className="text-xs text-slate-300 max-w-sm mx-auto">
                Your request reached the StealthMark team. If you write to us, mention the reference below.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#0D1017] border border-cyan-500/40 text-left space-y-3 relative overflow-hidden shadow-inner">
              {reference && (
                <div className="flex items-center justify-between gap-3 bg-black/50 p-3 rounded-xl border border-white/10">
                  <div className="space-y-0.5">
                    <div className="text-[11px] text-slate-400 font-mono">REFERENCE</div>
                    <span className="text-xl sm:text-2xl font-black font-mono tracking-wider text-cyan-300">
                      {reference}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyReference}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-white font-medium flex items-center gap-1.5 transition cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-300" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="text-[11px] text-slate-400 flex items-center justify-between">
                <span>Email:</span>
                <span className="text-slate-200 font-mono">{email}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <Link href="/scan" className="w-full">
                <Button
                  variant="gradient"
                  className="w-full py-3 text-xs font-bold shadow-lg shadow-cyan-500/20 cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>Run a free scan</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Button
                variant="ghost"
                onClick={handleReset}
                className="w-full sm:w-auto text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
            <HoneypotField value={trap} onChange={setTrap} />
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
                <span>Contact</span>
              </div>
              <h3 id="early-access-title" className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Contact StealthMark
              </h3>
              <p className="text-xs text-slate-300">
                Tell us about your site and what you need. We reply by email.
              </p>
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs">
                {error}
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label htmlFor="early-access-email" className="text-slate-300 font-medium flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-cyan-400" /> Work or developer email *
                </label>
                <input
                  id="early-access-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@yourcompany.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 text-xs transition"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="early-access-website" className="text-slate-300 font-medium flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" /> Website or app URL
                </label>
                <input
                  id="early-access-website"
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://app.yourdomain.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 text-xs transition font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="early-access-use-case" className="text-slate-300 font-medium">
                  What kind of site is it?
                </label>
                <select
                  id="early-access-use-case"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0d1017] border border-white/10 text-slate-200 focus:outline-none focus:border-cyan-400 text-xs transition"
                >
                  {USE_CASES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="early-access-traffic" className="text-slate-300 font-medium">
                  How much AI agent traffic do you expect?
                </label>
                <select
                  id="early-access-traffic"
                  value={expectedTraffic}
                  onChange={(e) => setExpectedTraffic(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0d1017] border border-white/10 text-slate-200 focus:outline-none focus:border-cyan-400 text-xs transition"
                >
                  {TRAFFIC_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={handleReset}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="gradient"
                disabled={isLoading}
                className="text-xs font-bold px-6 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20 cursor-pointer flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 text-cyan-200" />
                    <span>Send request</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
