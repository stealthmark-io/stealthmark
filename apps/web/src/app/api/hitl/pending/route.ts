import { NextResponse } from 'next/server';
import { getPendingHitlActions, getAllHitlActions } from '@/lib/hitl-store';
import { featureDisabledResponse, flags } from '@/lib/flags';

export async function GET() {
  if (!flags.hitl) return featureDisabledResponse();
  const pendingActions = getPendingHitlActions();
  const allActions = getAllHitlActions();

  const totalEstimatedValueUsd = pendingActions.reduce(
    (sum, a) => sum + (a.estimatedValueUsd || 0),
    0
  );

  const highRiskCount = pendingActions.filter((a) => a.riskScore >= 70).length;

  return NextResponse.json({
    success: true,
    totalPending: pendingActions.length,
    highRiskCount,
    totalEstimatedValueUsd,
    pending: pendingActions,
    recentHistory: allActions.slice(0, 10),
  });
}
