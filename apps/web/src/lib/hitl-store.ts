// ═══════════════════════════════════════════════════════════════════
// @stealthmark/web — Agent Action Engine & HITL Store
// Centralized store for Human-in-the-Loop autonomous agent approvals
// ═══════════════════════════════════════════════════════════════════

export interface HitlAction {
  id: string;
  agentName: string;
  agentId: string;
  kyaPassport?: {
    level: number;
    issuer: string;
    verified: boolean;
  };
  action: string;
  endpoint: string;
  parameters: Record<string, unknown>;
  estimatedValueUsd: number;
  riskScore: number; // 0 - 100
  riskCategory: 'high_value_transaction' | 'destructive_operation' | 'permission_escalation' | 'policy_anomaly';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  rejectionReason?: string;
  guardLatencyMs: number;
  releaseLatencyMs?: number;
}

const DEFAULT_INITIAL_ACTIONS: HitlAction[] = [
  {
    id: 'hitl_req_order_882',
    agentName: 'Claude-Code-Purchaser',
    agentId: 'agent_anthropic_prod_01',
    kyaPassport: {
      level: 1,
      issuer: 'dns:stealthmark.io',
      verified: true,
    },
    action: 'checkout.settle_cart',
    endpoint: '/api/v1/orders/settle',
    parameters: {
      orderId: 'SM-ORD-9281',
      itemsCount: 3,
      sku: 'ENTERPRISE-AGENTIC-SHIELD-V1',
      recipientOrg: 'Vercel-Partner-Lab',
    },
    estimatedValueUsd: 349.00,
    riskScore: 78,
    riskCategory: 'high_value_transaction',
    status: 'pending',
    createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(), // 3 mins ago
    expiresAt: new Date(Date.now() + 1000 * 60 * 12).toISOString(), // 12 mins left
    guardLatencyMs: 0.84,
  },
  {
    id: 'hitl_req_rescale_411',
    agentName: 'AutoGPT-Infra-Ops',
    agentId: 'agent_autogpt_cloud_99',
    kyaPassport: {
      level: 2,
      issuer: 'dns:stealthmark.io',
      verified: true,
    },
    action: 'infra.scale_edge_cluster',
    endpoint: '/api/v1/infra/scale',
    parameters: {
      region: 'us-central1',
      instancesTarget: 12,
      previousInstances: 4,
      reason: 'Anticipated traffic surge from HackerNews frontpage',
    },
    estimatedValueUsd: 180.00,
    riskScore: 65,
    riskCategory: 'permission_escalation',
    status: 'pending',
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(), // 8 mins ago
    expiresAt: new Date(Date.now() + 1000 * 60 * 7).toISOString(), // 7 mins left
    guardLatencyMs: 0.92,
  },
];

// Persistent state in process memory for Next.js dev & edge runtime
const globalForHitl = globalThis as unknown as {
  __stealthmark_hitl_store?: Map<string, HitlAction>;
};

function getStore(): Map<string, HitlAction> {
  if (!globalForHitl.__stealthmark_hitl_store) {
    globalForHitl.__stealthmark_hitl_store = new Map();
    for (const action of DEFAULT_INITIAL_ACTIONS) {
      globalForHitl.__stealthmark_hitl_store.set(action.id, { ...action });
    }
  }
  return globalForHitl.__stealthmark_hitl_store;
}

export function getAllHitlActions(): HitlAction[] {
  const store = getStore();
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getPendingHitlActions(): HitlAction[] {
  const store = getStore();
  const now = Date.now();
  return Array.from(store.values())
    .filter((action) => {
      if (action.status === 'pending') {
        if (new Date(action.expiresAt).getTime() < now) {
          action.status = 'expired';
          return false;
        }
        return true;
      }
      return false;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getHitlActionById(id: string): HitlAction | undefined {
  const store = getStore();
  const action = store.get(id);
  if (action && action.status === 'pending' && new Date(action.expiresAt).getTime() < Date.now()) {
    action.status = 'expired';
  }
  return action;
}

export function createHitlAction(data: {
  agentName: string;
  agentId?: string;
  kyaPassport?: { level: number; issuer: string; verified: boolean };
  action: string;
  endpoint: string;
  parameters?: Record<string, unknown>;
  estimatedValueUsd?: number;
  riskScore?: number;
  riskCategory?: HitlAction['riskCategory'];
  ttlSeconds?: number;
}): HitlAction {
  const store = getStore();
  const id = `hitl_req_${Math.random().toString(36).substring(2, 8)}_${Date.now().toString(36)}`;
  const now = Date.now();
  const ttl = (data.ttlSeconds || 900) * 1000; // default 15 minutes

  const newAction: HitlAction = {
    id,
    agentName: data.agentName || 'Anonymous-Agent',
    agentId: data.agentId || `ag_${Math.random().toString(36).substring(2, 10)}`,
    kyaPassport: data.kyaPassport,
    action: data.action,
    endpoint: data.endpoint,
    parameters: data.parameters || {},
    estimatedValueUsd: data.estimatedValueUsd || 0,
    riskScore: data.riskScore ?? 50,
    riskCategory: data.riskCategory || 'high_value_transaction',
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    guardLatencyMs: parseFloat((Math.random() * 0.5 + 0.5).toFixed(2)),
  };

  store.set(id, newAction);
  return newAction;
}

export function approveHitlAction(
  id: string,
  operatorEmail: string = 'security-operator@stealthmark.io',
  notes?: string
): { success: boolean; action?: HitlAction; error?: string } {
  const store = getStore();
  const action = store.get(id);

  if (!action) {
    return { success: false, error: 'HITL action not found' };
  }

  if (action.status !== 'pending') {
    return { success: false, error: `Action is already ${action.status}` };
  }

  if (new Date(action.expiresAt).getTime() < Date.now()) {
    action.status = 'expired';
    return { success: false, error: 'HITL action has expired' };
  }

  action.status = 'approved';
  action.resolvedAt = new Date().toISOString();
  action.resolvedBy = operatorEmail;
  action.releaseLatencyMs = parseFloat((Math.random() * 3 + 2.1).toFixed(2)); // < 8ms (target SLA)
  if (notes) {
    action.parameters.__operatorNotes = notes;
  }

  store.set(id, action);
  return { success: true, action };
}

export function rejectHitlAction(
  id: string,
  operatorEmail: string = 'security-operator@stealthmark.io',
  reason: string = 'Blocked by Human Operator Policy'
): { success: boolean; action?: HitlAction; error?: string } {
  const store = getStore();
  const action = store.get(id);

  if (!action) {
    return { success: false, error: 'HITL action not found' };
  }

  if (action.status !== 'pending') {
    return { success: false, error: `Action is already ${action.status}` };
  }

  action.status = 'rejected';
  action.resolvedAt = new Date().toISOString();
  action.resolvedBy = operatorEmail;
  action.rejectionReason = reason;

  store.set(id, action);
  return { success: true, action };
}

export function resetHitlStoreForTesting(): void {
  const store = getStore();
  store.clear();
  for (const action of DEFAULT_INITIAL_ACTIONS) {
    store.set(action.id, { ...action });
  }
}
