import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { GET as getMetrics } from '../app/api/admin/metrics/route';
import { GET as getOrganizations } from '../app/api/admin/organizations/route';
import { POST as postOverridePlan } from '../app/api/admin/override-plan/route';
import { POST as postPortalSession } from '../app/api/billing/portal-session/route';
import { POST as postWaitlist } from '../app/api/waitlist/route';
import { NextRequest } from 'next/server';
import { GATEWAY_FIXTURES, installGatewayFetchMock } from './helpers/gateway-mock';
import type { GatewayFetchMock } from './helpers/gateway-mock';
import { stubLeadChannels } from './helpers/lead-channels';

const ADMIN_KEY = 'test-admin-key-0123456789';
const adminHeaders = { 'x-admin-key': ADMIN_KEY };

describe('Sprint 1: Admin Control Plane, Billing Portal & Native Whitelist Claim', () => {
  let gateway: GatewayFetchMock;

  beforeEach(() => {
    vi.stubEnv('ADMIN_SECRET_KEY', ADMIN_KEY);
    gateway = installGatewayFetchMock();
  });

  afterEach(() => {
    expect(gateway.strayCalls).toEqual([]);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('Admin Control Plane API (/api/admin/metrics & /api/admin/organizations)', () => {
    it('returns structured KPIs with calculated MRR/ARR and threat defense volume', async () => {
      const req = new NextRequest('https://stealthmark.io/api/admin/metrics', {
        headers: adminHeaders,
      });
      const res = await getMetrics(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.kpis).toBeDefined();
      expect(typeof data.kpis.mrr).toBe('number');
      expect(typeof data.kpis.arr).toBe('number');
      expect(data.kpis.arr).toBe(data.kpis.mrr * 12);
      expect(data.kpis.totalOrganizations).toBe(0);
      expect(data.kpis.totalUsers).toBe(0);
      expect(data.kpis.activeGatewaysCount).toBe(0);
      expect(data.kpis.totalProcessedVolume).toBeGreaterThan(0);
      expect(data.kpis.totalProcessedVolume).toBe(GATEWAY_FIXTURES.telemetry.total_requests);
      expect(data.kpis.threatsNeutralized).toBeGreaterThan(0);
      expect(data.kpis.planDistribution).toBeDefined();
    });

    it('does not invent organizations when the database is not configured', async () => {
      const req = new NextRequest('https://stealthmark.io/api/admin/organizations', { headers: adminHeaders });
      const res = await getOrganizations(req);
      expect(res.status).toBe(503);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.organizations).toEqual([]);
      expect(JSON.stringify(data)).not.toMatch(/DemoCV|DemoDental|Sovereign HQ|142850/);
    });

    it('rejects external unauthorized requests to /api/admin/metrics with HTTP 401', async () => {
      const req = new NextRequest('https://stealthmark.io/api/admin/metrics', {
        headers: { host: 'stealthmark.io' },
      });
      const res = await getMetrics(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('rejects external unauthorized requests to /api/admin/organizations with HTTP 401', async () => {
      const req = new NextRequest('https://stealthmark.io/api/admin/organizations', {
        headers: { host: 'stealthmark.io' },
      });
      const res = await getOrganizations(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });
  });

  describe('Founder Plan Override Engine (/api/admin/override-plan)', () => {
    it('rejects invalid plan tiers with HTTP 400', async () => {
      const req = new NextRequest('https://stealthmark.io/api/admin/override-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders },
        body: JSON.stringify({
          organizationId: '0b6a6f2e-4f7c-4d63-9d2a-3a1f9d2f7c11',
          planTier: 'super-unlimited-gold',
        }),
      });

      const res = await postOverridePlan(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid plan tier');
    });

    it('answers 503 instead of success when there is no database to write to', async () => {
      const req = new NextRequest('https://stealthmark.io/api/admin/override-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders },
        body: JSON.stringify({ organizationId: '0b6a6f2e-4f7c-4d63-9d2a-3a1f9d2f7c11', planTier: 'enterprise' }),
      });

      const res = await postOverridePlan(req);
      expect(res.status).toBe(503);
      expect((await res.json()).success).toBeUndefined();
    });

    it('rejects external unauthorized requests to /api/admin/override-plan with HTTP 401', async () => {
      const req = new NextRequest('https://stealthmark.io/api/admin/override-plan', {
        method: 'POST',
        headers: { host: 'stealthmark.io', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: 'org-stealthmark-prod',
          planTier: 'business',
        }),
      });

      const res = await postOverridePlan(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });
  });

  describe('User Billing & Polar Customer Portal Session (/api/billing/portal-session)', () => {
    it('generates a valid Polar.sh customer portal URL', async () => {
      const req = new NextRequest('http://localhost:3000/api/billing/portal-session', {
        method: 'POST',
      });

      const res = await postPortalSession(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.url).toContain('polar.sh');
      expect(data.provider).toBe('polar.sh');
    });
  });

  describe('Early access intake & ticket generation (/api/waitlist)', () => {
    beforeEach(() => {
      stubLeadChannels({ configure: ['discord'] });
    });

    it('captures full B2B qualification payload and returns an early access ticket', async () => {
      const req = new Request('https://stealthmark.io/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'founder@ai-startup.com',
          website: 'https://ai-startup.com',
          useCase: 'AI Agents & Autonomous Copilots (MCP & KYA)',
          expectedTraffic: '50,000 – 500,000 reqs/mo',
        }),
      });

      const res = await postWaitlist(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('EARLY_ACCESS_REGISTERED');
      expect(data.ticket_id).toBeDefined();
      expect(data.ticket_id.startsWith('SM-VIP-')).toBe(true);
      expect(data.website).toBe('https://ai-startup.com');
      expect(data.use_case).toContain('AI Agents');
      expect(data.ticketId).toBe(data.ticket_id);
    });
  });
});
