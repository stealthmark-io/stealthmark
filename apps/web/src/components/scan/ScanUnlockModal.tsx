'use client';

import React, { useState } from 'react';
import { X, Heart, CreditCard, Coins, Copy, Check, ExternalLink, ShieldCheck, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { SupportedCryptoNetwork } from '@/lib/crypto-verifier';
import { CRYPTO_WALLETS, DONATION_OPTIONS, FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from '@/lib/offer';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

// Stablecoin networks the unlock endpoint verifies. Bitcoin is left out: the verifier values it at a fixed
// reference rate, so the amount to send cannot be stated exactly.
type CryptoNet = Exclude<SupportedCryptoNetwork, 'btc'>;

const CRYPTO_NETWORKS: Record<CryptoNet, { label: string; chain: string; asset: string; wallet: string; txPlaceholder: string }> = {
  base: { label: 'Base', chain: 'Base', asset: 'USDC or USDT', wallet: CRYPTO_WALLETS.base, txPlaceholder: '0x… transaction hash' },
  polygon: { label: 'Polygon', chain: 'Polygon PoS', asset: 'USDC or USDT', wallet: CRYPTO_WALLETS.polygon, txPlaceholder: '0x… transaction hash' },
  ethereum: { label: 'Ethereum', chain: 'Ethereum Mainnet', asset: 'USDC or USDT (ERC-20)', wallet: CRYPTO_WALLETS.eth, txPlaceholder: '0x… transaction hash' },
  bsc: { label: 'BNB Chain', chain: 'BNB Smart Chain', asset: 'USDT or USDC (BEP-20)', wallet: CRYPTO_WALLETS.bsc, txPlaceholder: '0x… transaction hash' },
  tron: { label: 'Tron', chain: 'Tron', asset: 'USDT (TRC-20)', wallet: CRYPTO_WALLETS.tron, txPlaceholder: 'Tron transaction ID' },
  solana: { label: 'Solana', chain: 'Solana', asset: 'USDC or USDT (SPL)', wallet: CRYPTO_WALLETS.solana, txPlaceholder: 'Solana transaction signature' },
};

const UNLOCK_ERRORS: Record<string, string> = {
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  invalid_tx_hash: 'That is not a valid transaction hash for this network.',
  invalid_domain: 'Run a scan first so we know which domain to unlock.',
  unlock_unavailable: 'Crypto unlock is unavailable right now. Try again shortly or pay by card.',
};

interface ScanUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlocked?: (token: string, deliverables: unknown) => void;
  targetDomain?: string;
  initialEmail?: string;
}

export function ScanUnlockModal({
  isOpen,
  onClose,
  onUnlocked,
  targetDomain = 'stealthmark.io',
  initialEmail = '',
}: ScanUnlockModalProps) {
  const [copied, setCopied] = useState(false);
  const [leadEmail, setLeadEmail] = useState(initialEmail);
  const [cryptoNet, setCryptoNet] = useState<CryptoNet>('base');
  const [txHash, setTxHash] = useState('');
  const [verifyingCrypto, setVerifyingCrypto] = useState(false);
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  if (!isOpen) return null;

  const net = CRYPTO_NETWORKS[cryptoNet];

  const cleanEmail = leadEmail.trim();
  const emailQuery =
    cleanEmail.includes('@') && cleanEmail.includes('.') ? `&email=${encodeURIComponent(cleanEmail)}` : '';
  const polarDonationHref = `/api/billing/polar/checkout?plan=starter_pass&domain=${encodeURIComponent(
    targetDomain
  )}${emailQuery}`;

  const copyWallet = () => {
    void navigator.clipboard.writeText(net.wallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const selectNetwork = (id: CryptoNet) => {
    setCryptoNet(id);
    setCopied(false);
    setCryptoError(null);
  };

  const verifyCryptoPayment = async () => {
    const hash = txHash.trim();
    if (!targetDomain) {
      setCryptoError(UNLOCK_ERRORS.invalid_domain);
      return;
    }
    if (hash.length < 32) {
      setCryptoError('Paste the full transaction hash or signature.');
      return;
    }
    setVerifyingCrypto(true);
    setCryptoError(null);
    try {
      const ref = new URLSearchParams(window.location.search).get('ref') || '';
      const res = await fetch('/api/billing/crypto/unlock-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: targetDomain, network: cryptoNet, txHash: hash, ref }),
      });
      const data: { verified?: boolean; unlock_token?: unknown; deliverables?: unknown; detail?: string; error?: string } =
        await res.json();
      if (!res.ok || data.verified !== true || typeof data.unlock_token !== 'string') {
        setCryptoError(
          data.detail ||
            (data.error ? UNLOCK_ERRORS[data.error] : undefined) ||
            'We could not verify this transaction yet. Wait until it confirms and try again.'
        );
        return;
      }
      setTxHash('');
      onUnlocked?.(data.unlock_token, data.deliverables);
      onClose();
    } catch {
      setCryptoError('Network error while verifying. Please try again.');
    } finally {
      setVerifyingCrypto(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="relative w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl bg-[#0B0E14] border border-cyan-500/40 p-6 sm:p-8 shadow-2xl space-y-6 text-slate-100">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-2">
          <Badge variant="success" className="font-mono text-[10px] uppercase tracking-wider">
            Free Audit &middot; {FREE_SCANS_PER_DOMAIN} Scans / Domain
          </Badge>
          <h3 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Heart className="w-6 h-6 text-emerald-400" />
            Unlock {FIX_PACK.label} for {targetDomain}
          </h3>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            The {SCAN_CHECK_COUNT}-check audit and its full report are{' '}
            <strong className="text-emerald-300">free</strong> for the first {FREE_SCANS_PER_DOMAIN} scans of each
            domain. The {FIX_PACK.label} is a one-time{' '}
            <strong className="text-white">{FIX_PACK.starterPriceLabel}</strong> unlock for{' '}
            <strong>{targetDomain}</strong>: the Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield,
            live badge snippet, white-label PDF report, and unlimited re-scans for {UNLOCK_DAYS} days.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-mono text-slate-400">Optional receipt email:</label>
          <input
            type="email"
            value={leadEmail}
            onChange={(e) => setLeadEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-xl bg-black/60 border border-white/15 px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
          />
        </div>

        <div className="space-y-4">
          {/* Option 1: card on Polar */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-cyan-500/35 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-cyan-300 uppercase">Option 1 &middot; Polar.sh</span>
              <CreditCard className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="space-y-1">
                <div className="text-2xl font-extrabold text-white font-mono">{FIX_PACK.starterPriceLabel} USD</div>
                <p className="text-xs text-slate-400">One-time payment by card on Polar. No subscription.</p>
              </div>
              <a
                href={polarDonationHref}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto shrink-0 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-bold text-xs hover:opacity-95 transition"
              >
                <span>Unlock for {FIX_PACK.starterPriceLabel} USD on Polar</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Option 2: stablecoin on-chain, unlocked by its transaction hash */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-emerald-500/35 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-emerald-300 uppercase">Option 2 &middot; Crypto</span>
              <Coins className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono">{DONATION_OPTIONS.stablecoinAmount}</div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5" role="group" aria-label="Network">
              {(Object.keys(CRYPTO_NETWORKS) as CryptoNet[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectNetwork(id)}
                  aria-pressed={cryptoNet === id}
                  className={`py-1.5 px-1 rounded-lg font-mono text-[11px] font-bold border transition cursor-pointer ${
                    cryptoNet === id
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : 'bg-black/50 text-slate-300 border-white/10 hover:border-white/25'
                  }`}
                >
                  {CRYPTO_NETWORKS[id].label}
                </button>
              ))}
            </div>

            <p className="text-xs text-slate-400">
              1. Send {FIX_PACK.starterPriceUsd} {net.asset} on {net.chain} to this wallet:
            </p>
            <div className="p-2.5 rounded-xl bg-black/70 border border-white/10 flex items-center justify-between gap-2">
              <code className="font-mono text-[11px] text-emerald-300 break-all select-all">{net.wallet}</code>
              <button
                type="button"
                onClick={copyWallet}
                className="inline-flex items-center gap-1 shrink-0 px-2.5 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[11px] font-bold cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="unlock-tx-hash" className="block text-xs text-slate-400">
                2. Once it confirms, paste the transaction hash:
              </label>
              <input
                id="unlock-tx-hash"
                type="text"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder={net.txPlaceholder}
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-xl bg-black/60 border border-white/15 px-3.5 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
              />
              {cryptoError && (
                <p role="alert" className="text-[11px] text-rose-400 font-mono">
                  {cryptoError}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={verifyCryptoPayment}
              disabled={verifyingCrypto}
              className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 font-bold text-xs hover:opacity-95 transition cursor-pointer disabled:opacity-50 disabled:cursor-wait"
            >
              {verifyingCrypto ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying on-chain…</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Verify &amp; Unlock {targetDomain}</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            {FREE_SCANS_PER_DOMAIN} Free Scans / Domain Included
          </span>
          <a
            href="https://gateway.stealthmark.io/x402/catalog"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-300 hover:underline"
          >
            Explore 16 x402 Verification APIs &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
