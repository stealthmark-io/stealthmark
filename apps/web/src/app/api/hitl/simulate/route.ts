import { NextRequest, NextResponse } from 'next/server';
import { createHitlAction } from '@/lib/hitl-store';
import { featureDisabledResponse, flags } from '@/lib/flags';
import { readBodyText } from '@/lib/request-body';

const MAX_BODY_BYTES = 2 * 1024;

const SIMULATION_PRESETS = {
  checkout: {
    agentName: 'Claude-Code-Agent',
    action: 'checkout.purchase_licenses',
    endpoint: '/api/v1/checkout/push-auth',
    parameters: {
      sku: 'ENTERPRISE-ANNUAL-TIER-V2',
      quantity: 5,
      deliveryMethod: 'instant_provision',
    },
    estimatedValueUsd: 599.00,
    riskScore: 82,
    riskCategory: 'high_value_transaction' as const,
  },
  rescale: {
    agentName: 'AutoGPT-Cluster-Daemon',
    action: 'infra.scale_database_nodes',
    endpoint: '/api/v1/cluster/resize',
    parameters: {
      clusterId: 'pg-prod-us-central1',
      nodeCount: 8,
      readReplicas: 4,
    },
    estimatedValueUsd: 420.00,
    riskScore: 68,
    riskCategory: 'permission_escalation' as const,
  },
  delete: {
    agentName: 'Cursor-Clean-Bot',
    action: 'storage.purge_cold_snapshots',
    endpoint: '/api/v1/storage/cleanup',
    parameters: {
      bucket: 'stealthmark-audit-archive-2025',
      deletedGigs: 450,
      retentionPolicyOverride: true,
    },
    estimatedValueUsd: 0.00,
    riskScore: 91,
    riskCategory: 'destructive_operation' as const,
  },
};

export async function POST(req: NextRequest) {
  if (!flags.hitl) return featureDisabledResponse();
  try {
    const raw = await readBodyText(req, MAX_BODY_BYTES);
    if (raw === null) {
      return NextResponse.json(
        { success: false, error: 'Payload too large' },
        { status: 413 }
      );
    }
    let body: { type?: string; agentName?: string; estimatedValueUsd?: number } | null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: 'Invalid request payload' },
        { status: 400 }
      );
    }
    const presetKey = (body.type || 'checkout') as keyof typeof SIMULATION_PRESETS;
    const preset = SIMULATION_PRESETS[presetKey] || SIMULATION_PRESETS.checkout;

    const action = createHitlAction({
      agentName: body.agentName || preset.agentName,
      agentId: `ag_sim_${Math.random().toString(36).substring(2, 8)}`,
      kyaPassport: {
        level: 2,
        issuer: 'dns:stealthmark.io',
        verified: true,
      },
      action: preset.action,
      endpoint: preset.endpoint,
      parameters: preset.parameters,
      estimatedValueUsd: body.estimatedValueUsd ?? preset.estimatedValueUsd,
      riskScore: preset.riskScore,
      riskCategory: preset.riskCategory,
      ttlSeconds: 900,
    });

    return NextResponse.json({
      success: true,
      message: 'Simulated agent action dispatched to HITL queue',
      action,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Simulation failed',
      },
      { status: 500 }
    );
  }
}
