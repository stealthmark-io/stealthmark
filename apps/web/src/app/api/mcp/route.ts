import { NextRequest, NextResponse } from 'next/server';
import { verifyPaidKey } from '@/lib/credit-meter';
import { FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from '@/lib/offer';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';
import { validateMcpPayloadAndToken } from '@/lib/security/october-shield';
import { readBodyText } from '@/lib/request-body';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Public read-only discovery tools exposed to unauthenticated MCP clients.
 * Privileged provisioning, billing, and partner telemetry tools require a valid
 * `Authorization: Bearer sk_live_...` token and are never enumerated anonymously.
 */
const PUBLIC_MCP_TOOLS = [
  {
    name: 'stealthmark_audit_domain',
    description:
      `Run the ${SCAN_CHECK_COUNT}-point Web, DNS/DMARC, Client-Bundle & AI-Surface Readiness Audit on a domain (free; the full report with fixes is free for the first ${FREE_SCANS_PER_DOMAIN} scans per domain; the ${FIX_PACK.starterPriceLabel} per-domain Fix Pack adds the fix files and unlimited re-scans for ${UNLOCK_DAYS} days).`,
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Target domain (e.g. example.com)' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'stealthmark_shield_scan',
    description:
      'Scan untrusted text or web content for NFKC homoglyphs, invisible Plane 14 Unicode tags, and wallet-draining prompt injections.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Untrusted text or HTML to scan' },
        context: { type: 'string', description: 'Context label (e.g. webpage, prompt)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'stealthmark_issue_trust_receipt',
    description:
      'Issue or cryptographically verify (constant-time HMAC-SHA256 + 128-bit nonce + 24h TTL) a Pre-Pay Trust & Claim-Verification Receipt for a counterparty domain.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Counterparty domain to verify before payment' },
        sandbox: { type: 'boolean', description: 'Set true for a free watermarked sandbox test receipt' },
      },
      required: ['domain'],
    },
  },
];

const PRIVILEGED_MCP_TOOLS = [
  {
    name: 'stealthmark_generate_manifests',
    description:
      'Synthesize production-ready /llms.txt and /.well-known/agent.json manifests for a verified domain (requires authenticated sk_live_ session).',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Target domain (e.g. example.com)' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'stealthmark_generate_edge_shield',
    description:
      'Generate Cloudflare Worker v5.1 and WAF rule expressions + enforced DMARC policy for a verified domain (requires authenticated sk_live_ session).',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Target domain (e.g. example.com)' },
      },
      required: ['domain'],
    },
  },
];

type McpAuth = 'authenticated' | 'anonymous' | 'unavailable';

/** Checks `Authorization: Bearer sk_live_...` against the active API keys: a well-formed key is not enough. */
async function resolveMcpAuth(authHeader: string | null): Promise<McpAuth> {
  const match = authHeader?.trim().match(/^bearer\s+(\S+)$/i);
  if (!match) return 'anonymous';
  const check = await verifyPaidKey(match[1]);
  if (check.ok) return 'authenticated';
  return check.reason === 'unavailable' ? 'unavailable' : 'anonymous';
}

export async function GET(req: NextRequest) {
  const isAuthenticated = (await resolveMcpAuth(req.headers.get('authorization'))) === 'authenticated';
  const tools = isAuthenticated
    ? [...PUBLIC_MCP_TOOLS, ...PRIVILEGED_MCP_TOOLS]
    : PUBLIC_MCP_TOOLS;

  return NextResponse.json({
    name: 'stealthmark-a2a-mcp',
    version: '5.1.2',
    protocol: 'mcp-streamable-http',
    surfaceScope: isAuthenticated ? 'authenticated' : 'public_discovery_only',
    skillManifest: 'https://stealthmark.io/skill.md',
    tools,
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await readBodyText(req, MAX_BODY_BYTES);
  if (rawBody === null) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Payload too large' } },
      { status: 413 }
    );
  }

  const host = (req.headers.get('host') ?? 'stealthmark.io').normalize('NFKC').toLowerCase().trim();
  const authHeader = req.headers.get('authorization');
  const mcpCheck = validateMcpPayloadAndToken(rawBody, authHeader, {
    expectedAudience: `https://${host}/api/mcp`,
    maxToolInputElements: 2000,
    maxNumericDigits: 64,
  });
  if (!mcpCheck.valid) {
    return NextResponse.json(
      { error: 'MCP Protocol Guard Violation', reason: mcpCheck.reason },
      { status: 422 }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 }
    );
  }
  // `null`, a batch array or a bare value is valid JSON but not a request object this server answers.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
      { status: 400 }
    );
  }
  const body = parsed as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

  const { id = null, method } = body;
  const auth = await resolveMcpAuth(authHeader);
  const isAuthenticated = auth === 'authenticated';

  if (method === 'initialize') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: {
          name: 'stealthmark-a2a-mcp',
          version: '5.1.2',
          surfaceScope: isAuthenticated ? 'authenticated' : 'public_discovery_only',
        },
        capabilities: { tools: { listChanged: false } },
      },
    });
  }

  if (method === 'tools/list') {
    const tools = isAuthenticated
      ? [...PUBLIC_MCP_TOOLS, ...PRIVILEGED_MCP_TOOLS]
      : PUBLIC_MCP_TOOLS;
    return NextResponse.json({
      jsonrpc: '2.0',
      id,
      result: { tools },
    });
  }

  if (auth === 'unavailable') {
    return NextResponse.json(
      { jsonrpc: '2.0', id, error: { code: -32603, message: 'API key verification is unavailable; retry later.' } },
      { status: 503 }
    );
  }

  if (!isAuthenticated) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32001,
          message:
            'Unauthorized: tool execution and privileged tool schemas require Authorization: Bearer sk_live_<token>.',
        },
      },
      { status: 401 }
    );
  }

  return NextResponse.json({
    jsonrpc: '2.0',
    id,
    result: {
      message: 'Authenticated MCP session verified. Dispatch tool call via https://stealthmark.io/skill.md endpoints.',
      tools: [...PUBLIC_MCP_TOOLS, ...PRIVILEGED_MCP_TOOLS].map((t) => t.name),
    },
  });
}
