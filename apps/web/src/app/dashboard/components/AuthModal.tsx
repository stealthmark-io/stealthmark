'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  X,
  Lock,
  Mail,
  Zap,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMessage?: string | null;
}

export function AuthModal({ isOpen, onClose, initialMessage }: AuthModalProps) {
  const { loginWithGitHub, loginWithGoogle, sendOtp, verifyOtp } = useAuth();

  const [email, setEmail] = useState('');
  const [otpStep, setOtpStep] = useState<'email' | 'code'>('email');
  const [otpValues, setOtpValues] = useState<string[]>(['', '', '', '', '', '']);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [countdown, setCountdown] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset state when opening/closing
  useEffect(() => {
    if (!isOpen) {
      setEmail('');
      setOtpStep('email');
      setOtpValues(['', '', '', '', '', '']);
      setStatusMessage(null);
      setCountdown(0);
    } else if (initialMessage) {
      setStatusMessage({ type: 'info', text: initialMessage });
    }
  }, [isOpen, initialMessage]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  if (!isOpen) return null;

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid work or personal email.' });
      return;
    }

    setIsSendingOtp(true);
    setStatusMessage(null);

    const res = await sendOtp(email);
    setIsSendingOtp(false);

    if (res.success) {
      setOtpStep('code');
      setCountdown(45);
      setStatusMessage({ type: 'success', text: res.message || 'Verification code dispatched to your inbox.' });
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to dispatch code.' });
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newValues = [...otpValues];
    newValues[index] = value.slice(-1);
    setOtpValues(newValues);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    const combined = newValues.join('');
    if (combined.length === 6 && !combined.includes('')) {
      submitOtp(combined);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpValues[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const newValues = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) {
      newValues[i] = pasted[i];
    }
    setOtpValues(newValues);

    if (pasted.length === 6) {
      submitOtp(pasted);
    } else {
      inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    }
  };

  const submitOtp = async (codeToVerify: string) => {
    setIsVerifyingOtp(true);
    setStatusMessage(null);

    const res = await verifyOtp(email, codeToVerify);
    setIsVerifyingOtp(false);

    if (res.success) {
      setStatusMessage({ type: 'success', text: 'Identity verified! Welcome to StealthMark Console.' });
      setTimeout(() => {
        onClose();
      }, 600);
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Verification failed. Please check the code.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Dark frosted glass backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-md bg-[#0d1017] border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-cyan-950/40 z-10 animate-in zoom-in-95 duration-200 overflow-hidden text-left">
        {/* Subtle top border illumination */}
        <div className="absolute top-0 left-8 right-8 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Heading */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-mono font-medium mb-3">
            <Lock className="w-3.5 h-3.5 text-cyan-400" />
            <span>AUTONOMOUS CONTROL PLANE</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white mb-1.5">
            Sign In to StealthMark
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
            Sign in to see which AI agents read your site and to manage your API keys.
          </p>
        </div>

        {/* Status / Alert Banner */}
        {statusMessage && (
          <div
            className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2.5 transition-all ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                : statusMessage.type === 'info'
                ? 'bg-cyan-950/40 border-cyan-500/30 text-cyan-300'
                : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            ) : statusMessage.type === 'info' ? (
              <Lock className="w-4 h-4 shrink-0 mt-0.5 text-cyan-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            )}
            <span className="leading-snug">{statusMessage.text}</span>
          </div>
        )}

        {/* Provider Buttons */}
        <div className="space-y-2.5">
          {/* GitHub OAuth */}
          <button
            onClick={() => loginWithGitHub()}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-[0.99] border border-white/10 hover:border-white/20 transition group text-left cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
                className="text-white shrink-0 group-hover:scale-105 transition"
              >
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <div>
                <span className="font-semibold text-sm text-white block">Continue with GitHub</span>
                <span className="text-[10px] text-slate-400">1-Click Dev Authentication</span>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-semibold shrink-0">
              Devs
            </span>
          </button>

          {/* Google OAuth */}
          <button
            onClick={() => loginWithGoogle()}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-[0.99] border border-white/10 hover:border-white/20 transition group text-left cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 24 24" width="18" height="18" className="shrink-0 group-hover:scale-105 transition">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <div>
                <span className="font-semibold text-sm text-white block">Continue with Google</span>
                <span className="text-[10px] text-slate-400">Google Workspace &amp; Founders</span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition shrink-0" />
          </button>
        </div>

        {/* Divider */}
        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase font-mono tracking-wider">
            <span className="bg-[#0d1017] px-3 text-slate-500">Or passwordless email code</span>
          </div>
        </div>

        {/* Passwordless OTP Form */}
        {otpStep === 'email' ? (
          <form onSubmit={handleSendOtp} className="space-y-3">
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                Corporate or Personal Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm text-white placeholder:text-slate-600 outline-none transition font-sans"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSendingOtp}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-xs tracking-wide shadow-lg shadow-cyan-950/40 flex items-center justify-center gap-2 transition active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              {isSendingOtp ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Dispatching Code...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 text-cyan-200" />
                  <span>Send Login Code</span>
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-xs text-slate-300">
                Enter the 6-digit code sent to <span className="font-semibold text-white">{email}</span>
              </p>
              <button
                onClick={() => {
                  setOtpStep('email');
                  setOtpValues(['', '', '', '', '', '']);
                }}
                className="text-[11px] text-cyan-400 hover:underline mt-1 inline-block cursor-pointer"
              >
                Change email address
              </button>
            </div>

            {/* 6 Code Cells */}
            <div className="flex justify-between gap-1.5 max-w-[260px] mx-auto" onPaste={handlePaste}>
              {otpValues.map((val, idx) => (
                <input
                  key={idx}
                  ref={(el) => {
                    inputRefs.current[idx] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={val}
                  onChange={(e) => handleOtpChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  className="w-9 h-11 text-center text-base font-mono font-bold bg-black/60 border border-white/15 rounded-xl text-cyan-300 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 outline-none transition"
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                disabled={countdown > 0 || isSendingOtp}
                onClick={handleSendOtp}
                className="text-slate-400 hover:text-white disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSendingOtp ? 'animate-spin' : ''}`} />
                <span>{countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}</span>
              </button>

              <button
                type="button"
                disabled={isVerifyingOtp || otpValues.join('').length < 6}
                onClick={() => submitOtp(otpValues.join(''))}
                className="px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
              >
                {isVerifyingOtp && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Verify</span>
              </button>
            </div>
          </div>
        )}

        {/* Security badges */}
        <div className="mt-4 flex items-center justify-center gap-3 text-[10px] text-slate-500">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-cyan-400" />
            <span>256-bit TLS</span>
          </div>
          <span>•</span>
          <div className="flex items-center gap-1">
            <Lock className="w-3 h-3 text-emerald-400" />
            <span>No passwords stored</span>
          </div>
        </div>
      </div>
    </div>
  );
}
