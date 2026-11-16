import { describe, expect, it } from 'vitest';
import { GET } from '../app/api/scan/route';

describe('GET /api/scan', () => {
  it('redirects to the audit endpoint and keeps the query', () => {
    const res = GET(new Request('http://localhost:3000/api/scan?domain=example.com&fresh=1'));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/api/scan/audit?domain=example.com&fresh=1');
  });

  it('answers with a relative location so the internal origin never leaks', () => {
    const res = GET(new Request('http://127.0.0.1:3000/api/scan'));
    expect(res.headers.get('location')).toBe('/api/scan/audit');
  });

  it('keeps encoded line breaks encoded in the location header', () => {
    const res = GET(new Request('http://localhost:3000/api/scan?domain=a.com%0d%0aSet-Cookie:x=1'));
    expect(res.headers.get('location')).toBe('/api/scan/audit?domain=a.com%0d%0aSet-Cookie:x=1');
  });
});
