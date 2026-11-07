import { NextResponse } from 'next/server';
import { LEAD_HONEYPOT_FIELD } from '@/lib/lead-fields';
import { clientIp } from '@/lib/client-ip';
import { readBodyText } from '@/lib/request-body';

export const LEAD_INBOX = 'sales@stealthmark.io';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_FROM = 'StealthMark Enterprise <enterprise@stealthmark.io>';
const DELIVERY_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TRACKED_KEYS = 5000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export type JsonBody = Record<string, unknown>;

export type BodyResult = { ok: true; body: JsonBody } | { ok: false; response: NextResponse };

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordLead {
  content: string;
  title: string;
  fields: DiscordEmbedField[];
  color?: number;
}

export interface LeadNotice {
  subject: string;
  text: string;
  replyTo?: string;
  discord: DiscordLead;
}

export type DeliveryResult =
  | { delivered: true; channels: string[] }
  | { delivered: false; configured: boolean };

export function limitText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, '').trim().slice(0, max);
}

export function singleLine(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function limitList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => limitText(item, maxLength))
    .filter((item) => item.length > 0);
}

export async function readJsonObject(request: Request): Promise<BodyResult> {
  const raw = await readBodyText(request, MAX_BODY_BYTES);
  if (raw === null) {
    return { ok: false, response: NextResponse.json({ error: 'Request body is too large.' }, { status: 413 }) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 }) };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 }) };
  }
  return { ok: true, body: parsed as JsonBody };
}

export function isHoneypotTripped(body: JsonBody): boolean {
  const value = body[LEAD_HONEYPOT_FIELD];
  return typeof value === 'string' && value.trim().length > 0;
}

export function honeypotResponse(): NextResponse {
  return NextResponse.json({ error: 'The submission was rejected.' }, { status: 400 });
}

const rateWindows = new Map<string, number[]>();

export function resetLeadRateLimits(): void {
  rateWindows.clear();
}

/**
 * Best-effort per-address limiter held in instance memory. It slows bursts from one source on a warm
 * instance; it is not a distributed guarantee, so the platform firewall remains the real perimeter.
 */
export function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): NextResponse | null {
  const key = `${scope}:${clientIp(request) ?? 'unknown'}`;
  const recent = (rateWindows.get(key) ?? []).filter((stamp) => now - stamp < windowMs);

  if (recent.length >= limit) {
    rateWindows.set(key, recent);
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  recent.push(now);
  rateWindows.set(key, recent);

  if (rateWindows.size > MAX_TRACKED_KEYS) {
    for (const [staleKey, stamps] of rateWindows) {
      if (stamps.every((stamp) => now - stamp >= windowMs)) rateWindows.delete(staleKey);
    }
  }
  return null;
}

function discordWebhookUrl(): string | null {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  return url && url.startsWith('https://') ? url : null;
}

function discordValue(value: string): string {
  const clean = value.replace(/`/g, "'");
  return clean.length > 0 ? clean.slice(0, 1000) : 'n/a';
}

async function postDiscord(url: string, lead: DiscordLead): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      body: JSON.stringify({
        content: lead.content,
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: lead.title.slice(0, 250),
            color: lead.color ?? 6373357,
            fields: lead.fields.slice(0, 20).map((field) => ({
              name: field.name.slice(0, 250),
              value: discordValue(field.value),
              inline: field.inline ?? false,
            })),
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    if (!response.ok) {
      console.error(`[StealthMark Leads] Discord webhook answered HTTP ${response.status}`);
    }
    return response.ok;
  } catch (error) {
    console.error('[StealthMark Leads] Discord webhook request failed:', error instanceof Error ? error.name : 'unknown');
    return false;
  }
}

async function postResend(apiKey: string, notice: LeadNotice): Promise<boolean> {
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [LEAD_INBOX],
        ...(notice.replyTo ? { reply_to: notice.replyTo } : {}),
        subject: singleLine(notice.subject).slice(0, 200),
        text: notice.text,
      }),
    });
    if (!response.ok) {
      console.error(`[StealthMark Leads] Resend answered HTTP ${response.status}`);
    }
    return response.ok;
  } catch (error) {
    console.error('[StealthMark Leads] Resend request failed:', error instanceof Error ? error.name : 'unknown');
    return false;
  }
}

/**
 * Sends the lead to every configured channel and reports whether at least one of them accepted it.
 * Nothing is persisted here, so a lead that no channel accepted is lost: callers must answer with an error.
 */
export async function deliverLead(notice: LeadNotice): Promise<DeliveryResult> {
  const webhook = discordWebhookUrl();
  const resendKey = process.env.RESEND_API_KEY?.trim() || null;

  if (!webhook && !resendKey) {
    console.error('[StealthMark Leads] No delivery channel configured (DISCORD_WEBHOOK_URL, RESEND_API_KEY)');
    return { delivered: false, configured: false };
  }

  const attempts: Array<{ channel: string; accepted: Promise<boolean> }> = [];
  if (webhook) attempts.push({ channel: 'discord', accepted: postDiscord(webhook, notice.discord) });
  if (resendKey) attempts.push({ channel: 'email', accepted: postResend(resendKey, notice) });

  const outcomes = await Promise.all(attempts.map(async (attempt) => ({ channel: attempt.channel, ok: await attempt.accepted })));
  const channels = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.channel);

  return channels.length > 0 ? { delivered: true, channels } : { delivered: false, configured: true };
}

export function undeliveredResponse(result: Extract<DeliveryResult, { delivered: false }>): NextResponse {
  return NextResponse.json(
    {
      error: 'We could not deliver your request. Please try again in a few minutes.',
      code: result.configured ? 'delivery_failed' : 'intake_unavailable',
    },
    { status: result.configured ? 502 : 503 },
  );
}
