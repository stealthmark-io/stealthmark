import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as postWaitlist } from '../app/api/waitlist/route';
import { POST as postSubscribe } from '../app/api/subscribe/route';
import { POST as postEnterprise } from '../app/api/enterprise/contact/route';
import { LEAD_HONEYPOT_FIELD } from '../lib/lead-fields';
import { resetLeadRateLimits } from '../lib/lead-intake';
import { jsonPost, stubLeadChannels } from './helpers/lead-channels';

const ENTERPRISE_BODY = { name: 'Jane Doe', email: 'jane@acme.example', company: 'Acme Retail' };

const FORMS = [
  { name: 'waitlist', post: postWaitlist, url: 'https://stealthmark.io/api/waitlist', body: { email: 'dev@agents.example' } },
  { name: 'subscribe', post: postSubscribe, url: 'https://stealthmark.io/api/subscribe', body: { email: 'dev@agents.example' } },
  { name: 'enterprise contact', post: postEnterprise, url: 'https://stealthmark.io/api/enterprise/contact', body: ENTERPRISE_BODY },
] as const;

beforeEach(() => {
  resetLeadRateLimits();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(FORMS)('$name delivery honesty', ({ post, url, body }) => {
  it('answers 503 and sends nothing when no delivery channel is configured', async () => {
    const sent = stubLeadChannels({ configure: [] });
    const res = await post(jsonPost(url, body));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'intake_unavailable' });
    expect(sent).toHaveLength(0);
  });

  it('ignores a server webhook taken from a NEXT_PUBLIC variable', async () => {
    const sent = stubLeadChannels({ configure: [] });
    const res = await post(jsonPost(url, body));
    expect(res.status).toBe(503);
    expect(sent.some((request) => request.url.includes('public-must-be-ignored'))).toBe(false);
  });

  it('answers 502 when the Discord webhook rejects the message', async () => {
    stubLeadChannels({ configure: ['discord'], discord: 404 });
    const res = await post(jsonPost(url, body));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'delivery_failed' });
  });

  it('answers 502 when Resend rejects the message', async () => {
    stubLeadChannels({ configure: ['resend'], resend: 403 });
    const res = await post(jsonPost(url, body));
    expect(res.status).toBe(502);
  });

  it('answers 502 when the only channel is unreachable', async () => {
    stubLeadChannels({ configure: ['discord'], discord: 'network-error' });
    const res = await post(jsonPost(url, body));
    expect(res.status).toBe(502);
  });

  it('succeeds when one channel accepts even if the other fails', async () => {
    stubLeadChannels({ configure: ['discord', 'resend'], discord: 500, resend: 200 });
    const res = await post(jsonPost(url, body));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('never repeats an internal address or a response time promise', async () => {
    stubLeadChannels({ configure: ['discord'] });
    const res = await post(jsonPost(url, body));
    const text = JSON.stringify(await res.json()).toLowerCase();
    expect(text).not.toMatch(/@stealthmark\.io|2 hours|architect|\bsla\b/);
  });

  it('rejects a filled honeypot field with 400 before delivering anything', async () => {
    const sent = stubLeadChannels({ configure: ['discord'] });
    const res = await post(jsonPost(url, { ...body, [LEAD_HONEYPOT_FIELD]: 'https://spam.example' }));
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('rejects bodies that are not JSON objects', async () => {
    stubLeadChannels({ configure: ['discord'] });
    const notJson = await post(
      new Request(url, { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body: 'not json' }),
    );
    expect(notJson.status).toBe(400);
    const array = await post(jsonPost(url, [1, 2, 3], { 'x-forwarded-for': '203.0.113.10' }));
    expect(array.status).toBe(400);
  });

  it('rejects oversized bodies with 413', async () => {
    stubLeadChannels({ configure: ['discord'] });
    const res = await post(jsonPost(url, { ...body, message: 'x'.repeat(20_000) }));
    expect(res.status).toBe(413);
  });

  it('counts the 16 KB cap in bytes, not characters', async () => {
    stubLeadChannels({ configure: ['discord'] });
    const res = await post(jsonPost(url, { ...body, message: 'é'.repeat(9000) }));
    expect(res.status).toBe(413);
  });

  it('stops reading a body that declares no content-length once it passes the cap', async () => {
    stubLeadChannels({ configure: ['discord'] });
    const chunk = new TextEncoder().encode(' '.repeat(4096));
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 256) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
      body: stream,
      duplex: 'half',
    };
    const res = await post(new Request(url, init));
    expect(res.status).toBe(413);
    expect(pulls).toBeLessThan(16);
  });

  it('limits one address to 5 submissions an hour and sets Retry-After', async () => {
    stubLeadChannels({ configure: ['discord'] });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await post(jsonPost(url, body))).status).toBe(200);
    }
    const blocked = await post(jsonPost(url, body));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);

    const otherAddress = await post(jsonPost(url, body, { 'x-forwarded-for': '198.51.100.20' }));
    expect(otherAddress.status).toBe(200);
  });

  it('asks Discord not to ping anyone', async () => {
    const sent = stubLeadChannels({ configure: ['discord'] });
    await post(jsonPost(url, body));
    const discord = sent.find((request) => request.url === 'https://discord.example/webhook');
    expect(discord?.body.allowed_mentions).toEqual({ parse: [] });
  });
});

describe('enterprise contact input handling', () => {
  it('sends plain text mail with every submitted field and no HTML', async () => {
    const sent = stubLeadChannels({ configure: ['resend'] });
    const hostile = '<script>alert(1)</script><a href="mailto:x@y.z">x</a>';
    const res = await postEnterprise(
      jsonPost('https://stealthmark.io/api/enterprise/contact', {
        ...ENTERPRISE_BODY,
        company: `Acme ${hostile}`,
        message: hostile,
        objectives: [hostile, 'Visibility'],
        companySize: hostile,
        trafficVolume: hostile,
        cdnProvider: hostile,
        website: hostile,
      }),
    );
    expect(res.status).toBe(200);

    const mail = sent.find((request) => request.url === 'https://api.resend.com/emails');
    expect(mail).toBeDefined();
    expect(mail?.body.html).toBeUndefined();
    expect(typeof mail?.body.text).toBe('string');
    expect(mail?.body.reply_to).toBe('jane@acme.example');
    expect(String(mail?.body.text)).toContain('Visibility');
  });

  it('strips line breaks from the subject so a header cannot be injected', async () => {
    const sent = stubLeadChannels({ configure: ['resend'] });
    await postEnterprise(
      jsonPost('https://stealthmark.io/api/enterprise/contact', {
        ...ENTERPRISE_BODY,
        company: 'Acme\r\nBcc: attacker@evil.example',
      }),
    );
    const mail = sent.find((request) => request.url === 'https://api.resend.com/emails');
    expect(String(mail?.body.subject)).not.toMatch(/[\r\n]/);
  });

  it('caps field lengths and tolerates non-array objectives', async () => {
    const sent = stubLeadChannels({ configure: ['resend'] });
    const res = await postEnterprise(
      jsonPost('https://stealthmark.io/api/enterprise/contact', {
        ...ENTERPRISE_BODY,
        message: 'm'.repeat(5000),
        objectives: 'not-an-array',
      }),
    );
    expect(res.status).toBe(200);
    const text = String(sent.find((request) => request.url.includes('resend'))?.body.text);
    expect(text).toContain('General discovery');
    expect(text.length).toBeLessThan(3000);
  });

  it('keeps the SM-ENT reference format', async () => {
    stubLeadChannels({ configure: ['discord'] });
    const res = await postEnterprise(jsonPost('https://stealthmark.io/api/enterprise/contact', ENTERPRISE_BODY));
    expect((await res.json()).referenceId).toMatch(/^SM-ENT-\d{6}$/);
  });
});
