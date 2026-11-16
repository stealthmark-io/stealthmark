// ═══════════════════════════════════════════════════════════════════
// @stealthmark/express — Usage metering shared by the Express and Fastify adapters
// ═══════════════════════════════════════════════════════════════════

import {
  buildEventMetadata,
  resolveAgentIdentifier,
  resolveRequestHost,
  hasUnsupportedBrotliEncoding,
  BROTLI_BLOCK_STATUS,
  BROTLI_BLOCK_BODY,
  SAFE_OUTBOUND_ACCEPT_ENCODING,
} from '@stealthmark/core';
import type { DetectionResult, StealthMarkInstance, UsageEventType } from '@stealthmark/core';

export function normalizeHeadersRecord(
  rawHeaders: Record<string, string | string[] | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value !== undefined) {
      result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return result;
}

export interface ExpressResponseTarget {
  setHeader(name: string, value: string): void;
  status(code: number): ExpressResponseTarget;
  send(body: string): void;
}

export function tryBlockExpressBrotli(
  headersRecord: Record<string, string>,
  res: ExpressResponseTarget
): boolean {
  if (hasUnsupportedBrotliEncoding(headersRecord['content-encoding'])) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Accept-Encoding', SAFE_OUTBOUND_ACCEPT_ENCODING);
    res.setHeader('Cache-Control', 'no-store');
    res.status(BROTLI_BLOCK_STATUS).send(JSON.stringify(BROTLI_BLOCK_BODY));
    return true;
  }
  return false;
}

export interface FastifyReplyTarget {
  header(name: string, value: string): FastifyReplyTarget;
  code(statusCode: number): FastifyReplyTarget;
  send(payload: unknown): FastifyReplyTarget;
}

export function tryBlockFastifyBrotli(
  headersRecord: Record<string, string>,
  reply: FastifyReplyTarget
): boolean {
  if (hasUnsupportedBrotliEncoding(headersRecord['content-encoding'])) {
    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Accept-Encoding', SAFE_OUTBOUND_ACCEPT_ENCODING)
      .header('Cache-Control', 'no-store');
    reply.code(BROTLI_BLOCK_STATUS).send(BROTLI_BLOCK_BODY);
    return true;
  }
  return false;
}

export function isManifestPath(pathOnly: string): boolean {
  return (
    pathOnly === '/.well-known/agent.json' ||
    pathOnly === '/.well-known/ai-plugin.json' ||
    pathOnly === '/api/agent-manifest'
  );
}

/** A response chosen from the request headers (manifest on an ordinary path, or the block 403) is never stored as the answer for that URL. */
export const NEGOTIATED_CACHE_CONTROL = 'private, no-store';

const NEGOTIATED_VARY_HEADERS = ['Accept', 'User-Agent', 'x-stealthmark-agent'] as const;

/** Vary value that names the headers that decided the response, keeping whatever earlier middleware already put in Vary. */
export function negotiatedVary(existing: unknown): string {
  const current = Array.isArray(existing) ? existing.join(',') : typeof existing === 'string' ? existing : '';
  const tokens = current.split(',').map((token) => token.trim()).filter((token) => token.length > 0);
  if (tokens.includes('*')) return '*';
  const present = new Set(tokens.map((token) => token.toLowerCase()));
  for (const name of NEGOTIATED_VARY_HEADERS) {
    if (!present.has(name.toLowerCase())) tokens.push(name);
  }
  return tokens.join(', ');
}

function recordEvent(
  sm: StealthMarkInstance,
  eventType: UsageEventType,
  headers: Record<string, string>,
  detection: DetectionResult,
  pathOnly: string,
  method: string | undefined
): void {
  sm.recordAgentEvent({
    event_type: eventType,
    agent_identifier: resolveAgentIdentifier(headers, detection),
    metadata: buildEventMetadata({
      path: pathOnly,
      method: method ?? 'GET',
      host: resolveRequestHost(headers, { trustForwardedHost: sm.trustForwardedHost }),
    }),
  });
}

/**
 * Meters exactly one event for a request identified as an AI agent.
 * Requests that do not identify themselves as agents are never recorded. The event carries the request host so the console can
 * tell sites apart, and the site_id when the instance has one.
 */
export function meterAgentRequest(
  sm: StealthMarkInstance,
  headers: Record<string, string>,
  detection: DetectionResult,
  pathOnly: string,
  method: string | undefined
): void {
  if (!detection.isAgent) return;
  recordEvent(sm, isManifestPath(pathOnly) ? 'agent_manifest' : 'agent_request', headers, detection, pathOnly, method);
}

/** Meters one agent request that the `block` policy answered with 403. */
export function meterBlockedRequest(
  sm: StealthMarkInstance,
  headers: Record<string, string>,
  detection: DetectionResult,
  pathOnly: string,
  method: string | undefined
): void {
  recordEvent(sm, 'agent_blocked', headers, detection, pathOnly, method);
}
