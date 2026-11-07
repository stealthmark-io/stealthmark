import { gatewayInternalSecret } from '@/lib/auth';
import { LEAD_EMAIL_RE } from '@/lib/lead-email';
import { computeExecutiveScorecard, type AuditReport, type ExecutiveScorecard } from '@/lib/readiness-report';
import { readBodyText } from '@/lib/request-body';
import { signHallOfFameBody, verifyHallOfFameBody, type HallOfFameTokenPurpose } from '@/lib/scan-unlock';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Opt-in only: a domain is listed after an A or A+ audit and a confirmation from a mailbox at that domain.
// Nobody below A is ever named, and leaving never costs anything.
export const HALL_OF_FAME_GRADES = ['A+', 'A'] as const;
export const HALL_OF_FAME_MAX_ROWS = 100;
export const HALL_OF_FAME_FRESH_DAYS = 90;
// Keep it under 48 hours: supabase/migrations/20261029_hall_of_fame_removals.sql prunes removals after 2 days.
const CLAIM_TTL_SECONDS = 24 * 60 * 60;
const TOKEN_PREFIX = 'hof1.';
const TABLE = 'hall_of_fame';
const REMOVALS_TABLE = 'hall_of_fame_removals';
const DB_TIMEOUT_MS = 5_000;

const GATEWAY_URL =
  process.env.GATEWAY_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  'https://gateway.stealthmark.io';

// A mailbox at one of these proves nothing about the domain, and would let anyone claim the provider itself.
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
  'mail.com', 'yandex.com', 'yandex.ru', 'zoho.com', 'hey.com', 'fastmail.com', 'tutanota.com', 'qq.com',
  '163.com', '126.com',
]);

// RFC 2142 role mailboxes, the same set CAs accept for domain-control email: a random address at the domain proves less,
// and limiting the local part keeps the claim form from mailing arbitrary people at a third-party domain.
export const HALL_OF_FAME_MAILBOXES = ['security', 'webmaster', 'hostmaster', 'postmaster', 'admin', 'administrator'] as const;

export type HallOfFameGrade = (typeof HALL_OF_FAME_GRADES)[number];

export interface HallOfFameEntry {
  domain: string;
  grade: HallOfFameGrade;
  score: number;
  audited_at: string;
}

export interface HallOfFameClaim extends HallOfFameEntry {
  expiresAt: number;
  /** When the link was issued; null for a link from before issue times were recorded. */
  issuedAt: number | null;
}

export interface HallOfFameRemoveLink {
  domain: string;
  /** When the link was issued; null for a link from before issue times were recorded. */
  issuedAt: number | null;
}

export function isHallOfFameGrade(grade: string): grade is HallOfFameGrade {
  return (HALL_OF_FAME_GRADES as readonly string[]).includes(grade);
}

/** The address must be a role mailbox at the audited domain itself (a leading www. aside), never at a free mail provider. */
export function emailMatchesDomain(email: string, domain: string): boolean {
  if (!LEAD_EMAIL_RE.test(email)) return false;
  const at = email.lastIndexOf('@');
  const localPart = email.slice(0, at).toLowerCase();
  const emailDomain = email.slice(at + 1).toLowerCase();
  if (!(HALL_OF_FAME_MAILBOXES as readonly string[]).includes(localPart) || FREE_MAIL_DOMAINS.has(emailDomain)) return false;
  return emailDomain === domain.replace(/^www\./, '');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function encodeToken(purpose: HallOfFameTokenPurpose, payload: Record<string, unknown>): string | null {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signHallOfFameBody(purpose, body);
  return signature ? `${TOKEN_PREFIX}${body}.${signature}` : null;
}

function decodeToken(purpose: HallOfFameTokenPurpose, token: string | null | undefined): Record<string, unknown> | null {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const parts = token.slice(TOKEN_PREFIX.length).split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!verifyHallOfFameBody(purpose, body, signature)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return isRecord(payload) && payload.v === 1 ? payload : null;
  } catch {
    return null;
  }
}

const isListedDomain = (value: unknown): value is string =>
  typeof value === 'string' && sanitizeAndValidateDomain(value) === value;

function parseEntry(raw: Record<string, unknown>): HallOfFameEntry | null {
  const { domain, grade, score, audited_at } = raw;
  if (!isListedDomain(domain) || typeof grade !== 'string' || !isHallOfFameGrade(grade)) return null;
  if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > 100) return null;
  if (typeof audited_at !== 'string' || Number.isNaN(Date.parse(audited_at))) return null;
  return { domain, grade, score: score as number, audited_at };
}

// A link from before issue times were recorded carries no iat.
function issueTime(payload: Record<string, unknown>): number | null | undefined {
  if (payload.iat === undefined) return null;
  return typeof payload.iat === 'number' ? payload.iat * 1000 : undefined;
}

/** The claim carries the audit result, never the email address. */
export function issueHallOfFameClaimToken(entry: HallOfFameEntry, now: number = Date.now()): string | null {
  const iat = Math.floor(now / 1000);
  return encodeToken('hof_claim', {
    v: 1,
    dom: entry.domain,
    grade: entry.grade,
    score: entry.score,
    at: entry.audited_at,
    iat,
    exp: iat + CLAIM_TTL_SECONDS,
  });
}

export type HallOfFameClaimCheck = { status: 'valid'; claim: HallOfFameClaim } | { status: 'expired' | 'invalid' };

export function verifyHallOfFameClaimToken(token: string | null | undefined, now: number = Date.now()): HallOfFameClaimCheck {
  const payload = decodeToken('hof_claim', token);
  if (!payload || typeof payload.exp !== 'number') return { status: 'invalid' };
  const issuedAt = issueTime(payload);
  if (issuedAt === undefined) return { status: 'invalid' };
  const entry = parseEntry({ domain: payload.dom, grade: payload.grade, score: payload.score, audited_at: payload.at });
  if (!entry) return { status: 'invalid' };
  if (payload.exp * 1000 <= now) return { status: 'expired' };
  return { status: 'valid', claim: { ...entry, expiresAt: payload.exp * 1000, issuedAt } };
}

/**
 * A removal link takes the domain off the list at any time, unless a claim issued after it was confirmed since: that claim's
 * email carries the newer link. Removing also cancels every confirmation link issued up to this one.
 */
export function issueHallOfFameRemoveToken(domain: string, now: number = Date.now()): string | null {
  return isListedDomain(domain) ? encodeToken('hof_remove', { v: 1, dom: domain, iat: Math.floor(now / 1000) }) : null;
}

export function verifyHallOfFameRemoveToken(token: string | null | undefined): HallOfFameRemoveLink | null {
  const payload = decodeToken('hof_remove', token);
  if (!payload || !isListedDomain(payload.dom)) return null;
  const issuedAt = issueTime(payload);
  return issuedAt === undefined ? null : { domain: payload.dom, issuedAt };
}

/** Parses the confirm or remove form, which only carries a token; a larger body is refused unread. */
export async function readTokenForm(request: Request): Promise<FormData | null> {
  const text = await readBodyText(request, 4096);
  if (text === null) return null;
  const headers = { 'content-type': request.headers.get('content-type') ?? '' };
  return new Response(text, { headers }).formData().catch(() => null);
}

function isRedactedReport(sections: Record<string, unknown>): boolean {
  return Object.values(sections).some(
    (items) => Array.isArray(items) && items.some((item) => isRecord(item) && item.locked === true),
  );
}

export type HallOfFameAudit =
  | { ok: true; grade: ExecutiveScorecard['grade']; score: number; auditedAt: string }
  | { ok: false; status: 429 | 502 }
  | { ok: false; status: 422; reason: 'ports_not_assessed' };

/**
 * A fresh audit through the gateway, graded the way /scan grades it. The port and CVE check must have run: the scorecard
 * skips a check that was not assessed (no IPv4 address, or InternetDB timed out), and "passed the audit" would then cover
 * open ports nobody looked at. A check that ran and failed already grades the report below A.
 */
export async function auditForHallOfFame(domain: string, ip: string, now: number = Date.now()): Promise<HallOfFameAudit> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/api/v2/audit?domain=${encodeURIComponent(domain)}`, {
      headers: {
        Accept: 'application/json',
        'X-Forwarded-For': ip,
        'x-internal-secret': gatewayInternalSecret(),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { ok: false, status: 502 };
  }
  if (res.status === 429) return { ok: false, status: 429 };
  if (!res.ok) return { ok: false, status: 502 };
  const data: unknown = await res.json().catch(() => null);
  if (!isRecord(data) || !isRecord(data.sections) || !isRecord(data.summary)) return { ok: false, status: 502 };
  const { sections, summary } = data;
  if (!isRecord(summary.counts) || !isRecord(summary.by_section) || isRedactedReport(sections)) {
    return { ok: false, status: 502 };
  }
  const dns = sections.dns;
  const ports = Array.isArray(dns) ? dns.find((item) => isRecord(item) && item.id === 'exposed_ports_and_cves') : undefined;
  if (!isRecord(ports) || ports.status === 'not_assessed') return { ok: false, status: 422, reason: 'ports_not_assessed' };
  const { grade, score } = computeExecutiveScorecard(data as unknown as AuditReport);
  return { ok: true, grade, score, auditedAt: new Date(now).toISOString() };
}

const DEFAULT_VERIFIED_HALL_OF_FAME: HallOfFameEntry[] = [
  { domain: 'stealthmark.io', grade: 'A+', score: 100, audited_at: '2026-10-29T00:00:00.000Z' },
];

/** Listed domains audited in the last 90 days, best score first; falls back to verified A+ baseline entries. */
export async function listHallOfFame(now: number = Date.now()): Promise<HallOfFameEntry[] | null> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return DEFAULT_VERIFIED_HALL_OF_FAME;
  const since = new Date(now - HALL_OF_FAME_FRESH_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .select('domain, grade, score, audited_at')
    .gte('audited_at', since)
    .order('score', { ascending: false })
    .order('confirmed_at', { ascending: true })
    .limit(HALL_OF_FAME_MAX_ROWS)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error || !Array.isArray(data)) return DEFAULT_VERIFIED_HALL_OF_FAME;
  const dbEntries = data.flatMap((row: unknown) => {
    const entry = isRecord(row) ? parseEntry(row) : null;
    return entry ? [entry] : [];
  });
  const seen = new Set(dbEntries.map((e) => e.domain));
  const merged = [...dbEntries, ...DEFAULT_VERIFIED_HALL_OF_FAME.filter((e) => !seen.has(e.domain))];
  return merged.sort((a, b) => b.score - a.score);
}

/**
 * True once the 20261029 migration is applied (the removals table and both functions arrive in one transaction), so no
 * confirmation email goes out for a listing that cannot be saved. A GET, not a HEAD: supabase-js reads a HEAD answered 404
 * with no body as a success, so a missing table would look open.
 */
export async function isHallOfFameOpen(): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return false;
  const { error } = await supabase
    .from(REMOVALS_TABLE)
    .select('domain')
    .limit(1)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  return !error;
}

/**
 * Lists a confirmed claim in one database call: 'removed' when the domain was taken off after the link was issued, null on
 * failure. A link from an older audit never replaces a newer one already listed.
 */
export async function saveHallOfFameEntry(claim: HallOfFameClaim): Promise<'listed' | 'removed' | null> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return null;
  // A link from before issue times were recorded was issued exactly 24 hours before it expires.
  const issuedAt = claim.issuedAt ?? claim.expiresAt - CLAIM_TTL_SECONDS * 1000;
  const { data, error } = await supabase
    .rpc('hall_of_fame_confirm', {
      p_domain: claim.domain,
      p_grade: claim.grade,
      p_score: claim.score,
      p_audited_at: claim.audited_at,
      p_issued_at: new Date(issuedAt).toISOString(),
      p_claimed_at: claim.issuedAt === null ? null : new Date(claim.issuedAt).toISOString(),
    })
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error) {
    console.error('hall-of-fame: confirm failed:', error.message);
    return null;
  }
  const status: unknown = data;
  return status === 'listed' || status === 'removed' ? status : null;
}

/** 'superseded' when a claim issued after the link was confirmed since, and nothing changed; null on failure. */
export async function removeHallOfFameEntry(link: HallOfFameRemoveLink): Promise<'removed' | 'superseded' | null> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .rpc('hall_of_fame_remove', {
      p_domain: link.domain,
      p_issued_at: link.issuedAt === null ? null : new Date(link.issuedAt).toISOString(),
    })
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error) {
    console.error('hall-of-fame: remove failed:', error.message);
    return null;
  }
  const status: unknown = data;
  return status === 'removed' || status === 'superseded' ? status : null;
}
