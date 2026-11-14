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
    vi.spyOn(fs, 'renameSync').mockImplementation(() => undefined);
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
      expect(fs.renameSync).toHaveBeenCalledTimes(1);
    });

    it.each(['GET', 'POST'] as const)('%s rejects a link signed with another key', async (method) => {
      const res = await handlers[method](link(method, sign(crypto.randomBytes(24).toString('hex'))));
      expect(res.status).toBe(403);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.renameSync).not.toHaveBeenCalled();
    });
  });

  describe('suppression file handling and atomic persistence', () => {
    beforeEach(() => {
      vi.stubEnv('STEALTHMARK_UNSUB_SECRET', SECRET);
    });

    it('uses STEALTHMARK_SUPPRESSION_FILE when specified', async () => {
      const custom = '/tmp/test_custom_suppression.json';
      vi.stubEnv('STEALTHMARK_SUPPRESSION_FILE', custom);
      const res = await handlers.POST(link('POST', sign(SECRET)));
      expect(res.status).toBe(200);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${custom}\\.\\d+\\.\\d+\\.tmp$`)),
        expect.any(String),
        'utf-8'
      );
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${custom}\\.\\d+\\.\\d+\\.tmp$`)),
        custom
      );
    });

    it('falls back to /tmp/stealthmark_outbound_suppression.json when directory creation fails', async () => {
      vi.stubEnv('STEALTHMARK_SUPPRESSION_FILE', '');
      vi.spyOn(fs, 'mkdirSync').mockImplementation((p) => {
        if (String(p).includes('/var/lib')) throw new Error('EACCES: permission denied');
        return undefined;
      });
      const res = await handlers.POST(link('POST', sign(SECRET)));
      expect(res.status).toBe(200);
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/tmp\/stealthmark_outbound_suppression\.json\.\d+\.\d+\.tmp$/),
        '/tmp/stealthmark_outbound_suppression.json'
      );
    });

    it('uses DEFAULT_SUPPRESSION_FILE when directory exists or is creatable', async () => {
      vi.stubEnv('STEALTHMARK_SUPPRESSION_FILE', '');
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        if (String(p) === '/var/lib/stealthmark') return true;
        return false;
      });
      const res = await handlers.POST(link('POST', sign(SECRET)));
      expect(res.status).toBe(200);
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/var\/lib\/stealthmark\/outbound_suppression\.json\.\d+\.\d+\.tmp$/),
        '/var/lib/stealthmark/outbound_suppression.json'
      );
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
