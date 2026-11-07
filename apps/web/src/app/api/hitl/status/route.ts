import { NextRequest, NextResponse } from 'next/server';
import { getHitlActionById } from '@/lib/hitl-store';
import { featureDisabledResponse, flags } from '@/lib/flags';

export async function GET(req: NextRequest) {
  if (!flags.hitl) return featureDisabledResponse();
  const { searchParams } = new URL(req.url);
  const approvalId = searchParams.get('approvalId');

  if (!approvalId) {
    return NextResponse.json(
      { success: false, error: 'approvalId query parameter is required' },
      { status: 400 }
    );
  }

  const action = getHitlActionById(approvalId);
  if (!action) {
    return NextResponse.json(
      { success: false, error: 'HITL action not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    approvalId: action.id,
    status: action.status,
    action: action.action,
    agentName: action.agentName,
    estimatedValueUsd: action.estimatedValueUsd,
    createdAt: action.createdAt,
    expiresAt: action.expiresAt,
    resolvedAt: action.resolvedAt,
    resolvedBy: action.resolvedBy,
    rejectionReason: action.rejectionReason,
    releaseLatencyMs: action.releaseLatencyMs,
  });
}
