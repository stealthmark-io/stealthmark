import { NextResponse } from 'next/server';
import { clientIp, clientNetwork } from '@/lib/client-ip';
import {
  HALL_OF_FAME_MAILBOXES,
  auditForHallOfFame,
  emailMatchesDomain,
  isHallOfFameGrade,
  isHallOfFameOpen,
  issueHallOfFameClaimToken,
  issueHallOfFameRemoveToken,
} from '@/lib/hall-of-fame';
import { readBodyText } from '@/lib/request-body';
import { isScanUnlockConfigured } from '@/lib/scan-unlock';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { SITE_ORIGIN } from '@/lib/site';

const HOUR_MS = 60 * 60 * 1000;
const MAX_CLAIMS_PER_NETWORK_PER_HOUR = 5;
// Caps how many confirmation emails anyone can make a domain's mailboxes receive.
const MAX_EMAILS_PER_DOMAIN_PER_DAY = 3;
// Ceiling for the whole server: rotating addresses must not turn the form into a mailer on the Resend key login codes share.
const MAX_EMAILS_PER_HOUR = 30;

type Window = { count: number; resetAt: number };
const claimsByNetwork = new Map<string, Window>();
const emailsByDomain = new Map<string, Window>();
const emailsSent = new Map<string, Window>();

function countIn(hits: Map<string, Window>, key: string, now: number): number {
  const entry = hits.get(key);
  return entry && entry.resetAt > now ? entry.count : 0;
}

function record(hits: Map<string, Window>, key: string, windowMs: number, now: number): void {
  if (hits.size > 2000) {
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
  else entry.count += 1;
}

function release(hits: Map<string, Window>, key: string, now: number): void {
  const entry = hits.get(key);
  if (entry && entry.resetAt > now && entry.count > 0) entry.count -= 1;
}

function confirmationEmail(input: {
  domain: string;
  grade: string;
  score: number;
  auditedAt: string;
  confirmUrl: string;
  removeUrl: string;
}): { subject: string; text: string } {
  return {
    subject: `Confirm the StealthMark Hall of Fame listing for ${input.domain}`,
    text: `Hi,

Someone asked to list ${input.domain} in the StealthMark Hall of Fame (${SITE_ORIGIN}/leaderboard). Our audit on ${input.auditedAt.slice(0, 10)} graded it ${input.grade} (${input.score}/100).

Nothing is published until you confirm. To list ${input.domain}, open this link within 24 hours and press Confirm:
${input.confirmUrl}

If you did not ask for this, ignore this email: nothing will be published.

To take ${input.domain} off the Hall of Fame, now or later, use this link (it also cancels the confirmation link above):
${input.removeUrl}

If a newer claim for ${input.domain} is confirmed, use the removal link in that claim's email instead.

StealthMark Security Team
${SITE_ORIGIN}`,
  };
}

export async function POST(request: Request) {
  // A cross-site HTML form cannot send JSON, and a cross-site fetch with it needs a preflight this route never grants.
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: 'Send the claim as JSON.' }, { status: 415 });
  }
  const text = await readBodyText(request, 2048);
  if (text === null) {
    return NextResponse.json({ error: 'The claim is too large.' }, { status: 413 });
  }
  const body: unknown = await new Response(text).json().catch(() => null);
  const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const domain = typeof input.domain === 'string' ? sanitizeAndValidateDomain(input.domain) : null;
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (!domain || !email) {
    return NextResponse.json({ error: 'Enter a valid domain and email address.' }, { status: 400 });
  }
  if (!emailMatchesDomain(email, domain)) {
    const bare = domain.replace(/^www\./, '');
    return NextResponse.json(
      {
        error: `Use ${HALL_OF_FAME_MAILBOXES.map((mailbox) => `${mailbox}@`).join(', ')} at ${bare}: the confirmation link proves you control the domain's mail.`,
      },
      { status: 422 },
    );
  }

  const ip = clientIp(request);
  if (!ip) {
    return NextResponse.json({ error: 'Too many claims from this network. Try again in an hour.' }, { status: 429 });
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey || !isScanUnlockConfigured()) {
    return NextResponse.json({ error: 'The Hall of Fame is not open for claims yet.' }, { status: 503 });
  }

  // Every cap is checked and taken with no await in between, so a parallel burst cannot slip past any of them.
  const network = clientNetwork(ip);
  // www.example.com and example.com mail the same mailboxes, so they share one daily quota.
  const mailDomain = domain.replace(/^www\./, '');
  const now = Date.now();
  if (countIn(claimsByNetwork, network, now) >= MAX_CLAIMS_PER_NETWORK_PER_HOUR) {
    return NextResponse.json({ error: 'Too many claims from this network. Try again in an hour.' }, { status: 429 });
  }
  if (countIn(emailsByDomain, mailDomain, now) >= MAX_EMAILS_PER_DOMAIN_PER_DAY) {
    return NextResponse.json({ error: `Too many claims for ${domain} today. Try again tomorrow.` }, { status: 429 });
  }
  if (countIn(emailsSent, 'all', now) >= MAX_EMAILS_PER_HOUR) {
    return NextResponse.json({ error: 'The Hall of Fame is taking many claims right now. Try again in an hour.' }, { status: 429 });
  }
  record(claimsByNetwork, network, HOUR_MS, now);
  record(emailsByDomain, mailDomain, 24 * HOUR_MS, now);
  record(emailsSent, 'all', HOUR_MS, now);
  // The audit keeps its network slot; the email slots go back whenever no email leaves.
  const unsent = (response: NextResponse) => {
    release(emailsByDomain, mailDomain, now);
    release(emailsSent, 'all', now);
    return response;
  };

  if (!(await isHallOfFameOpen())) {
    release(claimsByNetwork, network, now);
    return unsent(NextResponse.json({ error: 'The Hall of Fame is not open for claims yet.' }, { status: 503 }));
  }

  const audit = await auditForHallOfFame(domain, ip, now);
  if (!audit.ok) {
    if (audit.status === 429) return unsent(NextResponse.json({ error: 'The auditor is busy. Try again in a minute.' }, { status: 429 }));
    if (audit.status === 422) {
      return unsent(
        NextResponse.json(
          {
            error: `Open ports on ${domain} could not be checked (no IPv4 address, or the lookup timed out), so this audit cannot list it. Try again in a few minutes.`,
          },
          { status: 422 },
        ),
      );
    }
    return unsent(NextResponse.json({ error: 'The audit could not complete. Try again later.' }, { status: 502 }));
  }
  if (!isHallOfFameGrade(audit.grade)) {
    return unsent(NextResponse.json(
      {
        error: `${domain} graded ${audit.grade} (${audit.score}/100) in a fresh audit. The Hall of Fame lists A and A+ only.`,
        grade: audit.grade,
        score: audit.score,
      },
      { status: 422 },
    ));
  }

  const entry = { domain, grade: audit.grade, score: audit.score, audited_at: audit.auditedAt };
  // Stamped after the audit, which can take seconds, so a removal used meanwhile does not cancel these links.
  const issuedAt = Date.now();
  const claimToken = issueHallOfFameClaimToken(entry, issuedAt);
  const removeToken = issueHallOfFameRemoveToken(domain, issuedAt);
  if (!claimToken || !removeToken) {
    return unsent(NextResponse.json({ error: 'The Hall of Fame is not open for claims yet.' }, { status: 503 }));
  }

  // D-8: sent as the team, never under a personal name.
  const message = confirmationEmail({
    domain,
    grade: audit.grade,
    score: audit.score,
    auditedAt: audit.auditedAt,
    confirmUrl: `${SITE_ORIGIN}/leaderboard/confirm?token=${encodeURIComponent(claimToken)}`,
    removeUrl: `${SITE_ORIGIN}/leaderboard/remove?token=${encodeURIComponent(removeToken)}`,
  });
  let sent = false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'StealthMark Security Team <security@stealthmark.io>',
        to: [email],
        reply_to: 'security@stealthmark.io',
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    sent = res.ok;
    if (!res.ok) console.error('leaderboard/claim: Resend answered', res.status);
  } catch (err) {
    console.error('leaderboard/claim: Resend request failed:', err instanceof Error ? err.message : err);
  }
  if (!sent) {
    return unsent(NextResponse.json({ error: 'The confirmation email could not be sent. Try again later.' }, { status: 502 }));
  }

  return NextResponse.json({ ok: true, grade: audit.grade, score: audit.score });
}
