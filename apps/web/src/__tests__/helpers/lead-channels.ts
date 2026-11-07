import { vi } from 'vitest';
import { resetLeadRateLimits } from '../../lib/lead-intake';

export type ChannelOutcome = number | 'network-error';

export interface ChannelStubs {
  discord?: ChannelOutcome;
  resend?: ChannelOutcome;
}

export interface SentRequest {
  url: string;
  body: Record<string, unknown>;
}

const DISCORD_URL = 'https://discord.example/webhook';

function outcomeFor(outcome: ChannelOutcome | undefined): Response {
  if (outcome === 'network-error') throw new TypeError('network down');
  const status = outcome ?? 204;
  return new Response(status === 204 ? null : '{}', { status });
}

/** Configures which lead channels exist and how each one answers; returns what was sent to them. */
export function stubLeadChannels(channels: ChannelStubs & { configure: Array<'discord' | 'resend'> }): SentRequest[] {
  resetLeadRateLimits();
  vi.stubEnv('DISCORD_WEBHOOK_URL', channels.configure.includes('discord') ? DISCORD_URL : '');
  vi.stubEnv('RESEND_API_KEY', channels.configure.includes('resend') ? 're_test_placeholder' : '');
  vi.stubEnv('NEXT_PUBLIC_DISCORD_WEBHOOK_URL', 'https://discord.example/public-must-be-ignored');

  const sent: SentRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return outcomeFor(url.startsWith('https://api.resend.com') ? channels.resend : channels.discord);
    }),
  );
  return sent;
}

export function jsonPost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  });
}
