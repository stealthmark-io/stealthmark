'use client';

import { useEffect, useRef, useState, type Ref } from 'react';
import { usePathname } from 'next/navigation';
import { Check, Copy, ExternalLink, Heart, TriangleAlert, X } from 'lucide-react';
import { CRYPTO_WALLETS, DONATION_OPTIONS } from '@/lib/offer';

export const DONATION_NETWORKS = [
  { id: 'tron', network: 'Tron', tokens: 'USDT (TRC-20)', address: CRYPTO_WALLETS.tron },
  { id: 'eth', network: 'Ethereum', tokens: 'USDC / USDT (ERC-20)', address: CRYPTO_WALLETS.eth },
  { id: 'polygon', network: 'Polygon', tokens: 'USDC / USDT', address: CRYPTO_WALLETS.polygon },
  { id: 'arbitrum', network: 'Arbitrum One', tokens: 'USDC / USDT', address: CRYPTO_WALLETS.arbitrum },
  { id: 'btc', network: 'Bitcoin', tokens: 'BTC equivalent', address: CRYPTO_WALLETS.btc },
] as const;

export type DonationNetworkId = (typeof DONATION_NETWORKS)[number]['id'];
export type CopyState = { id: DonationNetworkId; ok: boolean } | null;

const PANEL_ID = 'donate-panel';
const COPY_RESET_MS = 2000;
const COPY_LABEL = { idle: 'Copy', copied: 'Copied', failed: 'Select it' } as const;

/**
 * Where the pill floats. The landing pins the StealthMascot bubble to bottom-6 right-6, so there
 * the pill stacks above it and the panel gives up that height to stay clear of the sticky navbar.
 */
const LAYOUT = {
  corner: {
    wrapper: 'bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 sm:bottom-6 sm:right-6',
    panel: 'max-h-[calc(100dvh-10rem)]',
  },
  aboveMascot: { wrapper: 'bottom-24 right-6', panel: 'max-h-[calc(100dvh-14.5rem)]' },
} as const;

function copyStatus(copyState: CopyState, id: DonationNetworkId): keyof typeof COPY_LABEL {
  if (!copyState || copyState.id !== id) return 'idle';
  return copyState.ok ? 'copied' : 'failed';
}

function copyAnnouncement(copyState: CopyState): string {
  if (!copyState) return '';
  return copyState.ok ? 'Address copied.' : 'Copy failed. Select the address to copy it manually.';
}

type DonationPanelProps = {
  copyState: CopyState;
  onCopy: (id: DonationNetworkId, address: string) => void;
  onClose: () => void;
  maxHeight?: string;
  ref?: Ref<HTMLDivElement>;
};

export function DonationPanel({ copyState, onCopy, onClose, maxHeight = LAYOUT.corner.panel, ref }: DonationPanelProps) {
  return (
    <div
      ref={ref}
      id={PANEL_ID}
      role="dialog"
      aria-labelledby="donate-panel-title"
      tabIndex={-1}
      className={`w-[min(22rem,calc(100vw-2rem))] ${maxHeight} overflow-y-auto overscroll-contain rounded-2xl border border-emerald-500/40 bg-[#0B0E14]/95 p-5 text-left shadow-[0_0_40px_rgba(16,185,129,0.25)] backdrop-blur-md focus:outline-none`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="donate-panel-title" className="text-base font-bold text-white">
          Support StealthMark
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close donation options"
          className="rounded-md p-1 text-gray-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-300"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-300">
        {`The audit is free. If it helped, chip in ${DONATION_OPTIONS.polarUsdAmount} by card or ${DONATION_OPTIONS.stablecoinAmount} in crypto.`}
      </p>
      <a
        href={DONATION_OPTIONS.polarCheckoutUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
      >
        {`Donate ${DONATION_OPTIONS.polarUsdAmount} on Polar`}
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
      <p className="mt-1.5 text-center text-xs text-gray-500">Card checkout by Polar, opens in a new tab</p>

      <div className="mt-5 border-t border-white/10 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
          {`Or send ${DONATION_OPTIONS.stablecoinAmount}`}
        </h3>
        <ul className="mt-3 space-y-2.5">
          {DONATION_NETWORKS.map((row) => {
            const status = copyStatus(copyState, row.id);
            return (
              <li key={row.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{row.network}</p>
                    <p className="text-xs text-gray-400">{row.tokens}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCopy(row.id, row.address)}
                    aria-label={`Copy ${row.network} address`}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/40 px-2.5 py-1.5 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/10 focus-visible:outline-2 focus-visible:outline-emerald-300"
                  >
                    {status === 'copied' ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{COPY_LABEL[status]}</span>
                  </button>
                </div>
                <code className="mt-2 block select-all break-all font-mono text-[11px] leading-relaxed text-cyan-200">
                  {row.address}
                </code>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-300/90">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Send only on the networks listed. Tokens sent on other networks may be lost.</span>
        </p>
        <p className="sr-only" aria-live="polite">
          {copyAnnouncement(copyState)}
        </p>
      </div>
    </div>
  );
}

export function FloatingDonateButton() {
  const layout = usePathname() === '/' ? LAYOUT.aboveMascot : LAYOUT.corner;
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  const copyAddress = (id: DonationNetworkId, address: string) => {
    const done = (ok: boolean) => {
      setCopyState({ id, ok });
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopyState(null), COPY_RESET_MS);
    };
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(address))
      .then(
        () => done(true),
        () => done(false),
      );
  };

  return (
    <div
      ref={rootRef}
      className={`fixed ${layout.wrapper} z-40 flex flex-col items-end gap-3 print:hidden`}
    >
      {open && (
        <DonationPanel
          ref={panelRef}
          copyState={copyState}
          onCopy={copyAddress}
          onClose={close}
          maxHeight={layout.panel}
        />
      )}
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        className="flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-2.5 text-sm font-bold text-black shadow-[0_0_25px_rgba(16,185,129,0.45)] transition hover:scale-105 hover:shadow-[0_0_35px_rgba(16,185,129,0.6)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 motion-reduce:transition-none motion-reduce:hover:scale-100"
      >
        <span className="relative flex h-4 w-4 items-center justify-center" aria-hidden="true">
          {!open && <span className="absolute inline-flex h-full w-full rounded-full bg-white/70 motion-safe:animate-ping" />}
          <Heart className="relative h-4 w-4 fill-current" />
        </span>
        {`Donate ${DONATION_OPTIONS.polarUsdAmount}`}
      </button>
    </div>
  );
}
