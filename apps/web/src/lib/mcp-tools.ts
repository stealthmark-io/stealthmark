import { FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from '@/lib/offer';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';

/**
 * Public read-only discovery tools exposed to unauthenticated MCP clients.
 * Privileged provisioning, billing, and partner telemetry tools require a valid
 * `Authorization: Bearer sk_live_...` token and are never enumerated anonymously.
 */
export const PUBLIC_MCP_TOOLS = [
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

export const PRIVILEGED_MCP_TOOLS = [
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
