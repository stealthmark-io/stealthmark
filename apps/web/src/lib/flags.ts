import { NextResponse } from 'next/server';

/**
 * Build-time feature flags for surfaces that are not part of the governance product.
 * NEXT_PUBLIC_* variables are inlined by Next.js only when referenced literally,
 * so each one is read by its full name instead of through a lookup helper.
 */
export const flags = {
  hitl: process.env.NEXT_PUBLIC_FEATURE_HITL === 'true',
  defcon: process.env.NEXT_PUBLIC_FEATURE_DEFCON === 'true',
  sentinel: process.env.NEXT_PUBLIC_FEATURE_SENTINEL === 'true',
  dualDoorDemo: process.env.NEXT_PUBLIC_FEATURE_DUAL_DOOR_DEMO === 'true',
  mcpPanel: process.env.NEXT_PUBLIC_FEATURE_MCP_PANEL === 'true',
};

export function featureDisabledResponse(): NextResponse {
  return NextResponse.json({ error: 'feature_disabled' }, { status: 404 });
}
