import { GET as auditGet } from '@/app/api/scan/audit/route';
import { GET as trustQuoteGet, POST as trustReceiptPost } from '@/app/api/v2/trust-receipt/route';
import { clientIp, clientNetwork, isValidIpAddress } from '@/lib/client-ip';
import { PUBLIC_MCP_TOOLS } from '@/lib/mcp-tools';

const GATEWAY_URL =
  process.env.GATEWAY_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  'https://gateway.stealthmark.io';

const SITE_ORIGIN = 'https://stealthmark.io';
const MAX_SCAN_TEXT_CHARS = 65_536;
const MAX_CONTEXT_CHARS = 64;
const GATEWAY_TIMEOUT_MS = 15_000;
const SHIELD_SCANS_PER_NETWORK_PER_MINUTE = 5;
const RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_NETWORKS = 2_000;

/**
 * The gateway sees every server-side call as coming from this host and keys one per-address bucket on it, so each
 * caller gets its own smaller budget here; otherwise one MCP client could spend the bucket the site's audits share.
 */
const shieldHits = new Map<string, { count: number; resetAt: number }>();

function allowShieldScan(network: string, now = Date.now()): boolean {
  if (shieldHits.size > MAX_TRACKED_NETWORKS) {
    for (const [key, entry] of shieldHits) if (entry.resetAt <= now) shieldHits.delete(key);
  }
  const entry = shieldHits.get(network);
  if (!entry || entry.resetAt <= now) {
    shieldHits.set(network, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= SHIELD_SCANS_PER_NETWORK_PER_MINUTE) return false;
  entry.count += 1;
  return true;
}

export type PublicMcpToolName = 'stealthmark_audit_domain' | 'stealthmark_shield_scan' | 'stealthmark_issue_trust_receipt';

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
};

export class McpInvalidParams extends Error {}

const PUBLIC_NAMES = new Set<string>(PUBLIC_MCP_TOOLS.map((tool) => tool.name));

export function isPublicMcpTool(name: unknown): name is PublicMcpToolName {
  return typeof name === 'string' && PUBLIC_NAMES.has(name);
}

function requireString(args: Record<string, unknown>, key: string, max: number): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new McpInvalidParams(`arguments.${key} must be a non-empty string`);
  if (value.length > max) throw new McpInvalidParams(`arguments.${key} exceeds ${max} characters`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new McpInvalidParams(`arguments.${key} must be a string`);
  return value.slice(0, MAX_CONTEXT_CHARS);
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new McpInvalidParams(`arguments.${key} must be a boolean`);
  return value;
}

/**
 * Forwards only validated client attribution headers the REST routes key their per-network rate limits on, so an MCP
 * call is limited like a direct call from the same client. Spoofed or malformed CF-Connecting-IP / X-Forwarded-For
 * values are stripped before forwarding. Authorization is never forwarded: a public tool must not spend API-key credits.
 */
function forwardedHeaders(req: Request): Headers {
  const headers = new Headers();
  const resolvedIp = clientIp(req);
  if (resolvedIp && isValidIpAddress(resolvedIp)) {
    headers.set('x-forwarded-for', resolvedIp);
    const cfRay = req.headers.get('cf-ray')?.trim();
    if (cfRay && /^[0-9a-f]{8,32}(?:-[a-z0-9]{2,8})?$/i.test(cfRay)) {
      headers.set('cf-ray', cfRay);
      headers.set('cf-connecting-ip', resolvedIp);
    } else if (process.env.TRUST_CLOUDFLARE_EDGE?.trim().toLowerCase() !== 'true') {
      headers.set('cf-connecting-ip', resolvedIp);
    }
  }
  const userAgent = req.headers.get('user-agent')?.trim();
  if (userAgent) headers.set('user-agent', userAgent);
  return headers;
}

async function toToolResult(res: Response): Promise<McpToolResult> {
  const text = await res.text();
  return { content: [{ type: 'text', text }], isError: !res.ok };
}

function errorResult(message: string): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

async function runShieldScan(req: Request, args: Record<string, unknown>): Promise<McpToolResult> {
  const text = requireString(args, 'text', MAX_SCAN_TEXT_CHARS);
  const context = optionalString(args, 'context');
  const ip = clientIp(req);
  if (!ip) return errorResult('Client address unavailable, so the scan was not run.');
  if (!allowShieldScan(clientNetwork(ip))) return errorResult('Too many shield scans from this network. Wait 60 seconds.');

  try {
    const res = await fetch(`${GATEWAY_URL}/api/v2/shield/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(context === undefined ? { text } : { text, context }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    return await toToolResult(res);
  } catch {
    return errorResult('Shield scan service unavailable. Retry later.');
  }
}

async function runAudit(req: Request, args: Record<string, unknown>): Promise<McpToolResult> {
  const domain = requireString(args, 'domain', 253);
  const url = `${SITE_ORIGIN}/api/scan/audit?domain=${encodeURIComponent(domain.trim())}`;
  return toToolResult(await auditGet(new Request(url, { headers: forwardedHeaders(req) })));
}

async function runTrustReceipt(req: Request, args: Record<string, unknown>): Promise<McpToolResult> {
  const domain = requireString(args, 'domain', 253).trim();
  if (optionalBoolean(args, 'sandbox')) {
    const headers = forwardedHeaders(req);
    headers.set('content-type', 'application/json');
    const sandboxReq = new Request(`${SITE_ORIGIN}/api/v2/trust-receipt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain, sandbox: true, buyerAgent: 'mcp' }),
    });
    return toToolResult(await trustReceiptPost(sandboxReq));
  }
  const url = `${SITE_ORIGIN}/api/v2/trust-receipt?domain=${encodeURIComponent(domain)}`;
  return toToolResult(await trustQuoteGet(new Request(url, { headers: forwardedHeaders(req) })));
}

/** Runs a public MCP tool through the same handler as its REST endpoint. Throws McpInvalidParams on bad arguments. */
export async function runPublicMcpTool(
  req: Request,
  name: PublicMcpToolName,
  rawArgs: unknown
): Promise<McpToolResult> {
  const args = rawArgs === undefined ? {} : rawArgs;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new McpInvalidParams('arguments must be an object');
  }
  const record = args as Record<string, unknown>;
  switch (name) {
    case 'stealthmark_audit_domain':
      return runAudit(req, record);
    case 'stealthmark_shield_scan':
      return runShieldScan(req, record);
    case 'stealthmark_issue_trust_receipt':
      return runTrustReceipt(req, record);
  }
}
