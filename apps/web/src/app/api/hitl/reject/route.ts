import { NextRequest, NextResponse } from 'next/server';
import { rejectHitlAction, getHitlActionById } from '@/lib/hitl-store';
import { featureDisabledResponse, flags } from '@/lib/flags';
import { readBodyText } from '@/lib/request-body';

const MAX_BODY_BYTES = 4 * 1024;

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
    let body: { approvalId?: string; operatorEmail?: string; reason?: string } | null;
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
      approvalId,
      operatorEmail = 'security-operator@stealthmark.io',
      reason = 'Rejected by Security Operator',
    } = body;

    if (!approvalId) {
      return NextResponse.json(
        { success: false, error: 'approvalId is required' },
        { status: 400 }
      );
    }

    const existing = getHitlActionById(approvalId);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'HITL action not found' },
        { status: 404 }
      );
    }

    if (existing.status !== 'pending') {
      return NextResponse.json(
        {
          success: false,
          error: `Action is already ${existing.status}`,
          status: existing.status,
        },
        { status: 409 }
      );
    }

    const result = rejectHitlAction(approvalId, operatorEmail, reason);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      status: 'rejected',
      approvalId,
      action: result.action,
      rejectedAt: result.action?.resolvedAt,
      reason,
      message: 'Action rejected. Upstream execution aborted. Dispatched HALT command to agent runtime.',
    });
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
