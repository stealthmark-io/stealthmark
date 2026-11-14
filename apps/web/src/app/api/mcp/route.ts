import { NextRequest, NextResponse } from 'next/server';
import { verifyPaidKey } from '@/lib/credit-meter';
import { isPublicMcpTool, McpInvalidParams, runPublicMcpTool } from '@/lib/mcp-call';
import { PRIVILEGED_MCP_TOOLS, PUBLIC_MCP_TOOLS } from '@/lib/mcp-tools';
import { validateMcpPayloadAndToken } from '@/lib/security/october-shield';
import { readBodyText } from '@/lib/request-body';

const MAX_BODY_BYTES = 64 * 1024;

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
  // Opaque `sk_live_` API keys are verified against Supabase in `resolveMcpAuth` (returning 401 -32001 on failure);
  // JWT Bearer tokens (containing '.') are validated for 3-part structure and RFC 8707 `aud` binding by October Shield.
  const jwtBearerCandidate =
    authHeader && /^bearer\s+/i.test(authHeader.trim()) && authHeader.includes('.') ? authHeader : null;
  const mcpCheck = validateMcpPayloadAndToken(rawBody, jwtBearerCandidate, {
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

  const toolName = body.params?.name;
  if (method === 'tools/call' && isPublicMcpTool(toolName)) {
    try {
      const result = await runPublicMcpTool(req, toolName, body.params?.arguments);
      return NextResponse.json({ jsonrpc: '2.0', id, result });
    } catch (error) {
      if (!(error instanceof McpInvalidParams)) throw error;
      return NextResponse.json(
        { jsonrpc: '2.0', id, error: { code: -32602, message: `Invalid params: ${error.message}` } },
        { status: 400 }
      );
    }
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
            'Unauthorized: privileged tools require Authorization: Bearer sk_live_<token>. The public tools run without a key.',
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
