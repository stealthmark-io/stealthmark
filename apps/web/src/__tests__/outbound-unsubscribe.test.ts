import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/outbound/unsubscribe/route';

const SECRET = crypto.randomBytes(24).toString('hex');
const DOMAIN = 'example.com';
const EMAIL = 'ops@example.com';
const handlers = { GET, POST };

function sign(secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${DOMAIN}:${EMAIL}`).digest('hex').slice(0, 20);
}

function link(method: 'GET' | 'POST', sig: string): NextRequest {
  const url = new URL('https://stealthmark.io/api/outbound/unsubscribe');
  url.searchParams.set('domain', DOMAIN);
  url.searchParams.set('email', EMAIL);
  url.searchParams.set('sig', sig);
  return new NextRequest(url, { method });
}

describe('outbound unsubscribe signature check', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('with STEALTHMARK_UNSUB_SECRET set', () => {
    beforeEach(() => {
      vi.stubEnv('STEALTHMARK_UNSUB_SECRET', SECRET);
    });

    it.each(['GET', 'POST'] as const)('%s records a link signed with the configured secret', async (method) => {
      const res = await handlers[method](link(method, sign(SECRET)));
      expect(res.status).toBe(200);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it.each(['GET', 'POST'] as const)('%s rejects a link signed with another key', async (method) => {
      const res = await handlers[method](link(method, sign(crypto.randomBytes(24).toString('hex'))));
      expect(res.status).toBe(403);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('without STEALTHMARK_UNSUB_SECRET', () => {
    beforeEach(() => {
      vi.stubEnv('STEALTHMARK_UNSUB_SECRET', '');
    });

    it.each(['GET', 'POST'] as const)('%s answers 503 instead of falling back to a built-in key', async (method) => {
      const res = await handlers[method](link(method, sign(SECRET)));
      expect(res.status).toBe(503);
      expect((await res.json()).ok).toBe(false);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
