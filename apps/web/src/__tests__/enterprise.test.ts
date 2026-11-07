import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '../app/api/enterprise/contact/route';
import { stubLeadChannels } from './helpers/lead-channels';

describe('Enterprise Contract Tier & Intake API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubLeadChannels({ configure: ['discord'] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('POST /api/enterprise/contact', () => {
    it('should reject request when name is missing or too short', async () => {
      const request = new Request('http://localhost:3000/api/enterprise/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '',
          email: 'jane@enterprise.com',
          company: 'Acme Corp',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Please provide your full name');
    });

    it('should reject request when email is invalid', async () => {
      const request = new Request('http://localhost:3000/api/enterprise/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Jane Doe',
          email: 'not-an-email',
          company: 'Acme Corp',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('valid work email');
    });

    it('should reject request when company is missing', async () => {
      const request = new Request('http://localhost:3000/api/enterprise/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Jane Doe',
          email: 'jane@enterprise.com',
          company: '',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('company or organization name');
    });

    it('should accept valid enterprise payload and return SM-ENT ticket reference', async () => {
      const request = new Request('http://localhost:3000/api/enterprise/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Jane Doe',
          email: 'jane@enterprise.com',
          company: 'Acme Retail Global',
          website: 'https://acme.com',
          companySize: '251-1000',
          trafficVolume: '25M - 100M requests / mo',
          cdnProvider: 'Cloudflare',
          objectives: ['Stop Rogue Scrapers & Bot Floods', 'Dedicated Private Enclave'],
          message: 'Need custom 99.999% SLA and isolated cluster in us-central1.',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.referenceId).toMatch(/^SM-ENT-\d{6}$/);
      expect(data).not.toHaveProperty('routedTo');
      expect(data.message).not.toMatch(/hour|architect/i);
    });
  });
});
