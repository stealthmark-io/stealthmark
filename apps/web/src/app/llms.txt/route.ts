import { NextResponse } from 'next/server';
import { SCAN_CHECK_COUNT, SCAN_MEASURED_COUNT, SCAN_NOT_ASSESSED_COUNT } from '@/lib/readiness-report';
import { SITE_ORIGIN } from '@/lib/site';
import { X402_PROVER_ENDPOINTS } from '@/lib/agent-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildLlmsTxt(): string {
  const provers = X402_PROVER_ENDPOINTS.map(
    (ep) => `- [${ep.name}](${ep.url}): ${ep.priceUsd} via x402 (${ep.rails}). ${ep.summary}`
  ).join('\n');

  return `# StealthMark

> StealthMark (founded in 2026) is an autonomous cyber-defense and agentic security intelligence platform. It features the ${SCAN_CHECK_COUNT}-point perimeter & readiness scanner (${SCAN_MEASURED_COUNT} external / ${SCAN_NOT_ASSESSED_COUNT} internal), open-source agent governance middleware for Next.js/Express, MCP server tools, and 20 formal verification Z3 x402 prover endpoints.

## Core URLs

- [Web & Agent Perimeter Scanner](${SITE_ORIGIN}/scan): Run the ${SCAN_CHECK_COUNT}-point passive audit (${SCAN_MEASURED_COUNT} measured from outside, ${SCAN_NOT_ASSESSED_COUNT} internal posture controls)
- [Agent Hub](${SITE_ORIGIN}/agents): Interactive MCP server tools, REST security endpoints, and Z3 x402 provers
- [Security Advisories & Coordinated Disclosures](${SITE_ORIGIN}/advisories): Verified zero-day research, upstream patches, and embargo-safe coordinated disclosure ledger
- [Agent Catalog JSON](${SITE_ORIGIN}/agents.json): Machine-readable catalog of all agent tools, endpoints, and provers
- [MCP Manifest](${SITE_ORIGIN}/.well-known/mcp.json): Model Context Protocol manifest for AI agent integration
- [MCP Server](${SITE_ORIGIN}/api/mcp): Streamable HTTP MCP server endpoint
- [Security Leaderboard](${SITE_ORIGIN}/leaderboard): Domain security posture rankings and perimeter grades
- [Trust & Architecture](${SITE_ORIGIN}/trust): Cryptographic receipts, privacy invariants, and zero-data retention architecture

## Docs & Resources

- [Documentation](${SITE_ORIGIN}/docs): Installation, agent policies, detection, and credits
- [Trust & Architecture](${SITE_ORIGIN}/trust): Cryptographic receipts, privacy invariants, and zero-data retention architecture
- [Pricing & Tiers](${SITE_ORIGIN}/pricing): Free tier, Fix Pack unlocks, and enterprise engagements
- [Agent Manifest](${SITE_ORIGIN}/.well-known/agent.json): Machine-readable capabilities published for AI agents
- [Agent Skill](${SITE_ORIGIN}/skill.md): Call examples and schemas for every endpoint
- [AI Catalog](${SITE_ORIGIN}/.well-known/ai-catalog.json): Discovery crawler index

## Affiliate & Revenue Share

- [Agent-to-Agent (A2A) Affiliate Bounty](${SITE_ORIGIN}/scan?ref=): 30% revenue share bounty on all Fix Pack unlocks and enterprise audits referred via '?ref=<agent_id_or_wallet>'. Check commissions via '${SITE_ORIGIN}/api/affiliates/stats?ref=<id>'.

## Formal Verification Z3 x402 Prover Endpoints

Hosted on https://gateway.stealthmark.io with per-call micropayments settled in USDC on Base (eip155:8453) or Solana SPL with Deliver-Then-Settle execution:

${provers}

## Source & Packages

- [SDK on npm](https://www.npmjs.com/org/stealthmark): @stealthmark/core, @stealthmark/next, @stealthmark/express, and @stealthmark/cli (Apache-2.0)
`;
}

export async function GET() {
  const body = buildLlmsTxt();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
