'use client';

import React, { useState } from 'react';
import { Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ClaimState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; domain: string; grade: string; score: number }
  | { kind: 'error'; message: string };

export function HallOfFameClaimForm({ initialDomain }: { initialDomain: string }) {
  const [domain, setDomain] = useState(initialDomain);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<ClaimState>({ kind: 'idle' });

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ kind: 'sending' });
    try {
      const res = await fetch('/api/leaderboard/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, email }),
      });
      const data: unknown = await res.json().catch(() => null);
      const body = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      if (res.ok && typeof body.grade === 'string' && typeof body.score === 'number') {
        setState({ kind: 'sent', domain: domain.trim(), grade: body.grade, score: body.score });
        return;
      }
      setState({
        kind: 'error',
        message: typeof body.error === 'string' ? body.error : 'The claim could not be sent. Try again later.',
      });
    } catch {
      setState({ kind: 'error', message: 'The claim could not be sent. Check your connection and try again.' });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-mono uppercase tracking-wider text-slate-400">
          <span>Domain</span>
          <Input
            name="domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="example.com"
            autoComplete="url"
            required
          />
        </label>
        <label className="space-y-1.5 text-xs font-mono uppercase tracking-wider text-slate-400">
          <span>security@, webmaster@ or admin@ at that domain</span>
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="security@example.com"
            autoComplete="email"
            required
          />
        </label>
      </div>
      <Button type="submit" variant="primary" size="md" isLoading={state.kind === 'sending'}>
        <Trophy className="w-4 h-4" aria-hidden /> Audit and send the confirmation
      </Button>
      <div aria-live="polite">
        {state.kind === 'sent' && (
          <p className="text-sm text-emerald-300 leading-relaxed">
            {state.domain} graded {state.grade} ({state.score}/100). We sent a confirmation link to that address; the listing appears
            only after you open it and press Confirm within 24 hours.
          </p>
        )}
      </div>
      {state.kind === 'error' && (
        <p role="alert" className="text-sm text-rose-300 leading-relaxed">
          {state.message}
        </p>
      )}
    </form>
  );
}
