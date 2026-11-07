import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type ExecuteRoute = typeof import('../app/api/hitl/execute/route');
type PendingRoute = typeof import('../app/api/hitl/pending/route');
type ApproveRoute = typeof import('../app/api/hitl/approve/route');
type RejectRoute = typeof import('../app/api/hitl/reject/route');
type StatusRoute = typeof import('../app/api/hitl/status/route');
type SimulateRoute = typeof import('../app/api/hitl/simulate/route');
type ManifestRoute = typeof import('../app/.well-known/agent.json/route');
type HitlStore = typeof import('../lib/hitl-store');

interface HitlHandlers {
  executeAction: ExecuteRoute['POST'];
  getPendingActions: PendingRoute['GET'];
  approveAction: ApproveRoute['POST'];
  rejectAction: RejectRoute['POST'];
  checkStatus: StatusRoute['GET'];
  simulateAction: SimulateRoute['POST'];
  getAgentManifest: ManifestRoute['GET'];
  resetHitlStoreForTesting: HitlStore['resetHitlStoreForTesting'];
}

// Flags are read at module load, so every route (and the store they share) is re-imported after stubbing the env.
async function loadHitlHandlers(hitlFlag: 'true' | 'false'): Promise<HitlHandlers> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_FEATURE_HITL', hitlFlag);
  const [execute, pending, approve, reject, status, simulate, manifest, store] = await Promise.all([
    import('../app/api/hitl/execute/route'),
    import('../app/api/hitl/pending/route'),
    import('../app/api/hitl/approve/route'),
    import('../app/api/hitl/reject/route'),
    import('../app/api/hitl/status/route'),
    import('../app/api/hitl/simulate/route'),
    import('../app/.well-known/agent.json/route'),
    import('../lib/hitl-store'),
  ]);
  return {
    executeAction: execute.POST,
    getPendingActions: pending.GET,
    approveAction: approve.POST,
    rejectAction: reject.POST,
    checkStatus: status.GET,
    simulateAction: simulate.POST,
    getAgentManifest: manifest.GET,
    resetHitlStoreForTesting: store.resetHitlStoreForTesting,
  };
}

let executeAction: HitlHandlers['executeAction'];
let getPendingActions: HitlHandlers['getPendingActions'];
let approveAction: HitlHandlers['approveAction'];
let rejectAction: HitlHandlers['rejectAction'];
let checkStatus: HitlHandlers['checkStatus'];
let simulateAction: HitlHandlers['simulateAction'];
let getAgentManifest: HitlHandlers['getAgentManifest'];
let resetHitlStoreForTesting: HitlHandlers['resetHitlStoreForTesting'];

beforeAll(async () => {
  ({
    executeAction,
    getPendingActions,
    approveAction,
    rejectAction,
    checkStatus,
    simulateAction,
    getAgentManifest,
    resetHitlStoreForTesting,
  } = await loadHitlHandlers('true'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('Sprint 4: Agent Action Engine & Human-in-the-Loop (HITL) Protocol', () => {
  beforeEach(() => {
    resetHitlStoreForTesting();
  });

  describe('Autonomous vs HITL Action Dispatching (/api/hitl/execute)', () => {
    it('directly executes safe autonomous actions without HITL gate (HTTP 200)', async () => {
      const req = new NextRequest('http://localhost:3000/api/hitl/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'Cursor-Indexer-Bot',
          action: 'catalog.browse_products',
          endpoint: '/api/v1/products',
          parameters: { category: 'electronics', page: 1 },
          estimatedValueUsd: 0,
          hitlRequired: false,
        }),
      });

      const res = await executeAction(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('executed');
      expect(json.hitlRequired).toBe(false);
      expect(json.executionLatencyMs).toBeLessThan(50);
      expect(json.actionId).toBeDefined();
    });

    it('halts and requires human approval for sensitive checkout action (HTTP 202 Accepted)', async () => {
      const req = new NextRequest('http://localhost:3000/api/hitl/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'Claude-Code-Agent',
          action: 'checkout.settle_cart',
          endpoint: '/api/v1/orders/settle',
          parameters: {
            sku: 'STEALTHMARK-BIOMETRIC-GATE-V1',
            quantity: 2,
            total: 499.00,
          },
          estimatedValueUsd: 499.00,
        }),
      });

      const res = await executeAction(req);
      expect(res.status).toBe(202);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('pending_human_approval');
      expect(json.approvalId).toMatch(/^hitl_req_/);
      expect(json.guardLatencyMs).toBeLessThan(10); // Target < 1ms guard latency
      expect(json.checkUrl).toContain(`/api/hitl/status?approvalId=${json.approvalId}`);
      expect(json.expiresAt).toBeDefined();
    });

    it('halts and requires human approval for destructive operations like delete or purge', async () => {
      const req = new NextRequest('http://localhost:3000/api/hitl/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'AutoGPT-Cleanup',
          action: 'storage.delete_snapshots',
          endpoint: '/api/v1/storage/delete',
          parameters: { snapshotId: 'snap_prod_0991' },
          estimatedValueUsd: 0,
        }),
      });

      const res = await executeAction(req);
      expect(res.status).toBe(202);

      const json = await res.json();
      expect(json.status).toBe('pending_human_approval');
      expect(json.action.riskCategory).toBe('destructive_operation');
    });
  });

  describe('Pending Actions Introspection (/api/hitl/pending)', () => {
    it('lists pending actions and aggregates financial value at risk', async () => {
      const res = await getPendingActions();
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.totalPending).toBeGreaterThanOrEqual(2);
      expect(json.totalEstimatedValueUsd).toBeGreaterThan(0);
      expect(Array.isArray(json.pending)).toBe(true);
      expect(json.pending[0]).toHaveProperty('agentName');
      expect(json.pending[0]).toHaveProperty('guardLatencyMs');
    });
  });

  describe('Human Approval Lifecycle & Release SLA (/api/hitl/approve & /api/hitl/status)', () => {
    it('releases pending action to origin backend in < 8ms upon operator approval', async () => {
      // 1. Create a pending action
      const createReq = new NextRequest('http://localhost:3000/api/hitl/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'Anthropic-Travel-Planner',
          action: 'flight.reserve_ticket',
          endpoint: '/api/v1/flights/book',
          parameters: { flightNo: 'BA-249', seat: '14A' },
          estimatedValueUsd: 850.00,
        }),
      });
      const createRes = await executeAction(createReq);
      const { approvalId } = await createRes.json();

      // 2. Verify it is pending via status check
      const statusReq1 = new NextRequest(
        `http://localhost:3000/api/hitl/status?approvalId=${approvalId}`
      );
      const statusRes1 = await checkStatus(statusReq1);
      const statusJson1 = await statusRes1.json();
      expect(statusJson1.status).toBe('pending');

      // 3. Human Operator Approves the Action
      const approveReq = new NextRequest('http://localhost:3000/api/hitl/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId,
          operatorEmail: 'founder@stealthmark.io',
          notes: 'Identity cross-checked with VIP whitelist',
        }),
      });
      const approveRes = await approveAction(approveReq);
      expect(approveRes.status).toBe(200);

      const approveJson = await approveRes.json();
      expect(approveJson.success).toBe(true);
      expect(approveJson.status).toBe('approved');
      expect(approveJson.releaseLatencyMs).toBeLessThan(8.0); // Strict SLA check

      // 4. Verify status transitioned to approved
      const statusReq2 = new NextRequest(
        `http://localhost:3000/api/hitl/status?approvalId=${approvalId}`
      );
      const statusRes2 = await checkStatus(statusReq2);
      const statusJson2 = await statusRes2.json();
      expect(statusJson2.status).toBe('approved');
      expect(statusJson2.resolvedBy).toBe('founder@stealthmark.io');
    });

    it('rejects double approval with 409 Conflict', async () => {
      const payload = {
        approvalId: 'hitl_req_order_882',
        operatorEmail: 'operator@stealthmark.io',
      };

      const firstReq = new NextRequest('http://localhost:3000/api/hitl/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // First approval
      const firstRes = await approveAction(firstReq);
      expect(firstRes.status).toBe(200);

      // Second approval attempt on same ID with fresh request stream
      const secondReq = new NextRequest('http://localhost:3000/api/hitl/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const secondRes = await approveAction(secondReq);
      expect(secondRes.status).toBe(409);
      const secondJson = await secondRes.json();
      expect(secondJson.error).toContain('already approved');
    });
  });

  describe('Human Rejection & Threat Neutralization (/api/hitl/reject)', () => {
    it('halts action and dispatches cancellation reason', async () => {
      const rejectReq = new NextRequest('http://localhost:3000/api/hitl/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId: 'hitl_req_rescale_411',
          operatorEmail: 'security-lead@stealthmark.io',
          reason: 'Excessive instance request without prior capacity planning',
        }),
      });

      const res = await rejectAction(rejectReq);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('rejected');
      expect(json.reason).toContain('Excessive instance request');

      // Verify status check reflects rejection
      const statusReq = new NextRequest(
        'http://localhost:3000/api/hitl/status?approvalId=hitl_req_rescale_411'
      );
      const statusRes = await checkStatus(statusReq);
      const statusJson = await statusRes.json();
      expect(statusJson.status).toBe('rejected');
      expect(statusJson.rejectionReason).toBeDefined();
    });

    it('returns 404 for non-existent approvalId', async () => {
      const req = new NextRequest('http://localhost:3000/api/hitl/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId: 'hitl_req_non_existent_999',
          operatorEmail: 'operator@stealthmark.io',
        }),
      });

      const res = await rejectAction(req);
      expect(res.status).toBe(404);
    });
  });

  describe('Simulation Engine & Agent Manifest Contract', () => {
    it('POST /api/hitl/simulate injects new pending action in queue', async () => {
      const req = new NextRequest('http://localhost:3000/api/hitl/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'checkout' }),
      });

      const res = await simulateAction(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.action.status).toBe('pending');
      expect(json.action.action).toContain('checkout');
    });

    it('keeps HITL execution out of the public agent manifest', async () => {
      const res = await getAgentManifest();
      expect(res.status).toBe(200);

      const json = await res.json();
      const hitlCapabilities = json.capabilities.filter((c: { hitl?: boolean }) => c.hitl === true);
      expect(hitlCapabilities).toHaveLength(0);
      expect(JSON.stringify(json)).not.toContain('/api/hitl/');
    });
  });
});

describe('Sprint 4: HITL routes behind NEXT_PUBLIC_FEATURE_HITL', () => {
  it('answers every /api/hitl route with 404 feature_disabled when the flag is off', async () => {
    const off = await loadHitlHandlers('false');
    const post = (name: string) =>
      new NextRequest(`http://localhost:3000/api/hitl/${name}`, { method: 'POST' });

    const responses = await Promise.all([
      off.executeAction(post('execute')),
      off.approveAction(post('approve')),
      off.rejectAction(post('reject')),
      off.simulateAction(post('simulate')),
      off.getPendingActions(),
      off.checkStatus(new NextRequest('http://localhost:3000/api/hitl/status?approvalId=hitl_req_order_882')),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'feature_disabled' });
    }
  });
});
