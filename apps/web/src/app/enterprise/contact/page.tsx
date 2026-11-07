'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Clock,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  Shield,
  Copy,
  Check,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyEmail } from '@/components/ui/copy-email';
import { HoneypotField } from '@/components/ui/honeypot-field';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { LEAD_HONEYPOT_FIELD } from '@/lib/lead-fields';

const OBJECTIVE_OPTIONS = [
  'Red Team perimeter assessment',
  'API and auth security review',
  'Blue Team edge hardening',
  'Cloud architecture review',
  'Post-remediation verification',
  'MSA, purchase order and invoicing',
];

const EMPTY_FORM = {
  name: '',
  email: '',
  company: '',
  website: '',
  companySize: '51-250',
  trafficVolume: '5M - 25M requests / mo',
  cdnProvider: 'Cloudflare',
  objectives: ['Red Team perimeter assessment', 'Blue Team edge hardening'],
  message: '',
};

interface ContactResponse {
  referenceId?: string;
  error?: string;
}

export default function EnterpriseContactPage() {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [trap, setTrap] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [copiedReference, setCopiedReference] = useState(false);

  const copyReference = async () => {
    if (!referenceId) return;
    try {
      await navigator.clipboard.writeText(referenceId);
      setCopiedReference(true);
      setTimeout(() => setCopiedReference(false), 2500);
    } catch (error) {
      console.warn('[Enterprise Contact] Clipboard write was blocked:', error instanceof Error ? error.name : 'unknown');
    }
  };

  const toggleObjective = (objective: string) => {
    setFormData((prev) => {
      const exists = prev.objectives.includes(objective);
      if (exists) {
        return { ...prev, objectives: prev.objectives.filter((o) => o !== objective) };
      }
      return { ...prev, objectives: [...prev.objectives, objective] };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!formData.name.trim()) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setErrorMsg('Please enter a valid work email address.');
      return;
    }
    if (!formData.company.trim()) {
      setErrorMsg('Please enter your company or organization name.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/enterprise/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, [LEAD_HONEYPOT_FIELD]: trap }),
      });

      const data = (await res.json()) as ContactResponse;

      if (!res.ok) {
        throw new Error(data.error || 'We could not send your request.');
      }
      if (typeof data.referenceId !== 'string') {
        throw new Error('We could not confirm that your request was received. Please try again.');
      }

      setReferenceId(data.referenceId);
    } catch (err: unknown) {
      console.error('[Enterprise Contact Error]:', err);
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again later.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      <Navbar />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 pt-32 pb-24 w-full">
        {/* Breadcrumb Back Link */}
        <div className="mb-8">
          <Link
            href="/enterprise"
            className="inline-flex items-center gap-2 text-xs font-mono text-slate-400 hover:text-cyan-400 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Enterprise Overview
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          {/* LEFT COLUMN: The Enterprise Assurance */}
          <div className="lg:col-span-5 space-y-8">
            <div className="space-y-4">
              <Badge variant="info" className="uppercase tracking-widest text-emerald-300 font-mono text-[10px]">
                Enterprise · By contract
              </Badge>
              <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
                Request a custom-scope engagement
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                Tell us which domains and stack you want assessed or hardened, and what your procurement needs. Red Team and Blue Team engagements are scoped one by one and quoted per scope. We will answer by email.
              </p>
            </div>

            <div className="p-6 rounded-3xl bg-[#0D1017] border border-white/[0.08] space-y-4">
              <h2 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-bold flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400" aria-hidden />
                What to expect
              </h2>

              <ul className="space-y-3 text-xs text-slate-300">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden />
                  <span><strong>Scoped to you:</strong> Red Team, Blue Team or both, with a scope and a quote we agree on. There are no list prices.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden />
                  <span><strong>Paperwork by contract:</strong> a mutual NDA, MSA, purchase order and invoicing can be arranged.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden />
                  <span><strong>Not available yet:</strong> no SOC 2 report and no published SLA. If you need either, say so in your message.</span>
                </li>
              </ul>
            </div>

            <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] space-y-3">
              <div className="text-xs font-mono uppercase text-slate-400">Other desks</div>
              <div className="space-y-2 text-xs font-mono text-slate-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400 font-sans">Contracts:</span>
                  <CopyEmail address="sales@stealthmark.io" icon={<Mail className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden />} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400 font-sans">Security reports:</span>
                  <CopyEmail address="security@stealthmark.io" icon={<Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden />} />
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Interactive High-Converting Form */}
          <div className="lg:col-span-7">
            {referenceId ? (
              /* SUCCESS STATE */
              <div className="p-8 sm:p-10 rounded-3xl bg-gradient-to-b from-[#0e1626] to-[#0A0D14] border border-emerald-500/40 shadow-2xl space-y-6 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-mono uppercase tracking-widest text-emerald-300 font-semibold">
                    Request received
                  </span>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
                    Thanks, {formData.name.split(' ')[0]}.
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
                    Your request for {formData.company} reached the StealthMark team. Mention the reference below if you write to us.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 max-w-sm mx-auto font-mono text-xs text-left space-y-1.5">
                  <div className="flex justify-between text-slate-400">
                    <span>Reference:</span>
                    <strong className="text-cyan-400">{referenceId}</strong>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Reply to:</span>
                    <span className="text-slate-200">{formData.email}</span>
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Button
                    variant="gradient"
                    onClick={copyReference}
                    className="w-full sm:w-auto text-xs font-bold py-3 px-6 cursor-pointer"
                  >
                    {copiedReference ? (
                      <>
                        <Check className="w-4 h-4 mr-1.5 text-white" aria-hidden />
                        Reference copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1.5" aria-hidden />
                        Copy reference
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setReferenceId(null);
                      setFormData(EMPTY_FORM);
                    }}
                    className="w-full sm:w-auto text-xs py-3 px-5 border-white/15 text-slate-300 hover:bg-white/5 cursor-pointer"
                  >
                    Send another request
                  </Button>
                </div>
              </div>
            ) : (
              /* THE INTERACTIVE FORM */
              <form
                onSubmit={handleSubmit}
                className="p-6 sm:p-9 rounded-3xl bg-[#0D1017] border border-white/[0.09] shadow-2xl space-y-6"
              >
                <HoneypotField value={trap} onChange={setTrap} />
                <div className="space-y-1 border-b border-white/[0.08] pb-4">
                  <h3 className="text-xl font-bold text-white">Enterprise request</h3>
                  <p className="text-xs text-slate-400">
                    A few details are enough to start. We will reply to the email you give here.
                  </p>
                </div>

                {errorMsg && (
                  <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* ROW 1: Name & Work Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">
                      Full Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Jane Doe"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">
                      Work Email <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="jane@company.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all"
                    />
                  </div>
                </div>

                {/* ROW 2: Company Name & Website */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">
                      Company Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Acme Global Inc."
                      value={formData.company}
                      onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Company Website</label>
                    <input
                      type="text"
                      placeholder="https://acme.com"
                      value={formData.website}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all"
                    />
                  </div>
                </div>

                {/* ROW 3: Company Size & Traffic Volume */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Company Headcount</label>
                    <select
                      value={formData.companySize}
                      onChange={(e) => setFormData({ ...formData, companySize: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#121622] border border-white/10 text-white text-xs focus:outline-none focus:border-cyan-400 transition-all cursor-pointer"
                    >
                      <option value="1-50">1 - 50 employees</option>
                      <option value="51-250">51 - 250 employees</option>
                      <option value="251-1000">251 - 1,000 employees</option>
                      <option value="1000+">1,000+ employees</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Estimated Monthly Traffic</label>
                    <select
                      value={formData.trafficVolume}
                      onChange={(e) => setFormData({ ...formData, trafficVolume: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#121622] border border-white/10 text-white text-xs focus:outline-none focus:border-cyan-400 transition-all cursor-pointer"
                    >
                      <option value="< 5M requests / mo">&lt; 5M requests / mo</option>
                      <option value="5M - 25M requests / mo">5M – 25M requests / mo</option>
                      <option value="25M - 100M requests / mo">25M – 100M requests / mo</option>
                      <option value="100M+ requests / mo">100M+ requests / mo</option>
                    </select>
                  </div>
                </div>

                {/* ROW 4: Current CDN Provider */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Current CDN / WAF Infrastructure</label>
                  <select
                    value={formData.cdnProvider}
                    onChange={(e) => setFormData({ ...formData, cdnProvider: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#121622] border border-white/10 text-white text-xs focus:outline-none focus:border-cyan-400 transition-all cursor-pointer"
                  >
                    <option value="Cloudflare">Cloudflare (Enterprise / Business / Pro)</option>
                    <option value="AWS CloudFront">AWS CloudFront &amp; AWS WAF</option>
                    <option value="Fastly">Fastly Next-Gen WAF</option>
                    <option value="Akamai">Akamai Edge / Kona Site Defender</option>
                    <option value="Google Cloud">Google Cloud CDN &amp; Cloud Armor</option>
                    <option value="Self-Hosted">Self-Hosted (Nginx, Traefik, Envoy, HAProxy)</option>
                    <option value="Other">Other / None</option>
                  </select>
                </div>

                {/* ROW 5: Primary Objectives (Pills) */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">
                    Primary Objectives <span className="text-slate-500 font-normal">(Select all that apply)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {OBJECTIVE_OPTIONS.map((obj) => {
                      const selected = formData.objectives.includes(obj);
                      return (
                        <button
                          key={obj}
                          type="button"
                          onClick={() => toggleObjective(obj)}
                          className={`text-[11px] px-3 py-1.5 rounded-full border transition-all cursor-pointer ${
                            selected
                              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-semibold'
                              : 'bg-white/[0.03] border-white/10 text-slate-400 hover:border-white/20'
                          }`}
                        >
                          {selected ? '✓ ' : '+ '}
                          {obj}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ROW 6: Architectural Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    Notes <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="E.g., We run a Next.js SaaS on Cloudflare and want a Red Team perimeter assessment, then Blue Team hardening, under NDA."
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all resize-none"
                  />
                </div>

                {/* SUBMIT BUTTON */}
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  variant="gradient"
                  className="w-full text-sm font-bold py-3.5 shadow-lg shadow-cyan-500/20 cursor-pointer flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send request
                    </>
                  )}
                </Button>

                <p className="text-[11px] text-center text-slate-500 leading-tight">
                  We use these details only to answer your request. See the Privacy Policy for the providers that process them.
                </p>
              </form>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
