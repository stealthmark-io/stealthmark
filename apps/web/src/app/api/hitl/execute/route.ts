import { NextRequest, NextResponse } from 'next/server';
import { createHitlAction } from '@/lib/hitl-store';
import { featureDisabledResponse, flags } from '@/lib/flags';
import { readBodyText } from '@/lib/request-body';

const MAX_BODY_BYTES = 16 * 1024;

type ExecutePayload = Partial<Parameters<typeof createHitlAction>[0]> & { hitlRequired?: boolean };

const SENSITIVE_HITL_KEYWORDS = [
  'checkout',
  'order',
  'payment',
  'billing',
  'transfer',
  'buy',
  'delete',
  'cancel',
  'withdraw',
  'rescale',
  'contract',
  'grant_admin',
];

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
    let body: ExecutePayload | null;
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
    const {
      agentName = 'Claude-Autonomous-Agent',
      agentId,
      kyaPassport,
      action = 'unknown_action',
      endpoint = '/api/v1/action',
      parameters = {},
      hitlRequired,
      estimatedValueUsd = 0,
      riskScore,
      riskCategory,
    } = body;

    // Check if HITL is mandated by explicit flag, sensitive action keywords, or transaction value
    const actionLower = (action + ' ' + endpoint).toLowerCase();
    const matchesSensitiveKeyword = SENSITIVE_HITL_KEYWORDS.some((kw) => actionLower.includes(kw));
    const isHighValue = estimatedValueUsd >= 100;
    const isExplicitHitl = hitlRequired === true;

    const requiresHitl = isExplicitHitl || matchesSensitiveKeyword || isHighValue;

    if (requiresHitl) {
      // Create pending approval in HITL store
      const pendingAction = createHitlAction({
        agentName,
        agentId,
        kyaPassport,
        action,
        endpoint,
        parameters,
        estimatedValueUsd,
        riskScore: riskScore ?? (isHighValue ? 75 : 55),
        riskCategory: riskCategory ?? (isHighValue ? 'high_value_transaction' : 'destructive_operation'),
        ttlSeconds: 900, // 15 mins
      });

      return NextResponse.json(
        {
          success: true,
          status: 'pending_human_approval',
          approvalId: pendingAction.id,
          message: 'Action requires Human-in-the-Loop authorization. Push dispatched to operator console.',
          guardLatencyMs: pendingAction.guardLatencyMs,
          checkUrl: `/api/hitl/status?approvalId=${pendingAction.id}`,
          expiresAt: pendingAction.expiresAt,
          action: pendingAction,
        },
        { status: 202 }
      );
    }

    // Direct autonomous execution for safe, read-only, or pre-approved actions
    const executionLatencyMs = parseFloat((Math.random() * 2 + 2.5).toFixed(2));
    return NextResponse.json(
      {
        success: true,
        status: 'executed',
        actionId: `act_${Date.now().toString(36)}`,
        action,
        endpoint,
        hitlRequired: false,
        executionLatencyMs,
        result: {
          message: 'Autonomous action executed successfully within SLA boundaries',
          data: parameters,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid request payload',
      },
      { status: 400 }
    );
  }
}
