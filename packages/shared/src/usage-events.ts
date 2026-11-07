import { z } from 'zod'

/**
 * Unit of metering: one "agent event" is one HTTP request identified as coming from an AI agent
 * that passes through StealthMark middleware (SDK) or the hosted gateway (proxy).
 * Human traffic is never counted.
 *
 * - agent_request: the default; an agent request that was served.
 * - agent_blocked: an agent request rejected by a shield or policy (DEFCON, passport, rate limit, semantic).
 *   Recorded for the customer's visibility but free: units is always 0, it never consumes quota or credits,
 *   never triggers alerts, and is accepted even when the organization is over its cap. Because it is free it is
 *   rate limited instead: at most MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR rows per organization per rolling hour,
 *   the excess is dropped and reported as `skipped_blocked`. Its timestamp is always server time.
 * - agent_manifest: an agent fetch of a manifest or well-known document. Counted.
 *
 * Units are never trusted from SDK traffic. For source 'middleware' (the default, and the only source an
 * ordinary tenant key can use) the server ignores `units` and forces 1 for agent_request and agent_manifest and
 * 0 for agent_blocked. Only source 'api' (internal usage, requires a platform/admin key) honors `units`, an
 * integer between 1 and MAX_EVENT_UNITS (agent_blocked is still forced to 0). A non-platform key that sends
 * source 'api' is treated as 'middleware'. The only payload shape rejected outright is `units` 0 on an event
 * that is not agent_blocked.
 */
export const AGENT_EVENT_TYPES = ['agent_request', 'agent_blocked', 'agent_manifest'] as const
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number]

/** The only event type that is recorded without consuming quota. */
export const ZERO_UNIT_EVENT_TYPE = 'agent_blocked' as const satisfies AgentEventType

export function defaultUnitsFor(eventType: AgentEventType): number {
  return eventType === ZERO_UNIT_EVENT_TYPE ? 0 : 1
}

export const USAGE_EVENT_SOURCES = ['gateway', 'middleware', 'api'] as const
export type UsageEventSource = (typeof USAGE_EVENT_SOURCES)[number]

export const BILLING_MODES = ['free', 'credits', 'enterprise'] as const
export type BillingMode = (typeof BILLING_MODES)[number]

export const MAX_INGEST_BATCH = 500
/** Upper bound of `units` for a trusted (source 'api') event. */
export const MAX_EVENT_UNITS = 100
/** Free (agent_blocked) rows stored per organization per rolling hour. */
export const MAX_BLOCKED_EVENTS_PER_ORG_PER_HOUR = 500
export const MAX_EVENT_METADATA_BYTES = 1024
/**
 * Only these metadata keys are stored; every other key is dropped. Values must be strings, numbers or booleans.
 * served_at (ISO 8601 timestamp of when the Canary fixture was served) and ip_hash (keyed hash of the caller IP) come from Canary hits.
 */
export const EVENT_METADATA_KEYS = ['path', 'method', 'host', 'status', 'reason', 'served_at', 'ip_hash'] as const
export type EventMetadataKey = (typeof EVENT_METADATA_KEYS)[number]
export type EventMetadata = Partial<Record<EventMetadataKey, string | number | boolean>>
/** Longer metadata strings are truncated to this many characters. */
export const MAX_EVENT_METADATA_STRING_LENGTH = 200
/** Value of `retry_after_seconds` in a 429 quota_exceeded response. */
export const QUOTA_RETRY_AFTER_SECONDS = 300

function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

export function sanitizeEventMetadata(raw: Readonly<Record<string, unknown>>): EventMetadata {
  const clean: EventMetadata = {}
  for (const key of EVENT_METADATA_KEYS) {
    const value = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined
    if (typeof value === 'string') clean[key] = value.slice(0, MAX_EVENT_METADATA_STRING_LENGTH)
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) clean[key] = value
  }
  return clean
}

const metadataSchema = z.record(z.string(), z.unknown()).transform((raw, ctx): EventMetadata => {
  const clean = sanitizeEventMetadata(raw)
  if (utf8ByteLength(JSON.stringify(clean)) > MAX_EVENT_METADATA_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `metadata must serialize to at most ${MAX_EVENT_METADATA_BYTES} bytes`,
    })
    return z.NEVER
  }
  return clean
})

export const usageEventInputSchema = z
  .object({
    /** Optional client idempotency key. A repeated (organization, event_id) is stored once and counted as a duplicate. */
    event_id: z.guid().optional(),
    event_type: z.enum(AGENT_EVENT_TYPES).optional(),
    /** Ignored for source 'middleware' (see AGENT_EVENT_TYPES). */
    units: z.number().int().min(0).max(MAX_EVENT_UNITS).optional(),
    site_id: z.guid().optional(),
    agent_identifier: z.string().min(1).max(256).optional(),
    occurred_at: z.string().datetime({ offset: true }).optional(),
    metadata: metadataSchema.optional(),
  })
  .refine((event) => event.units !== 0 || event.event_type === ZERO_UNIT_EVENT_TYPE, {
    message: `units 0 is only allowed for event_type ${ZERO_UNIT_EVENT_TYPE}`,
    path: ['units'],
  })
export type UsageEventInput = z.infer<typeof usageEventInputSchema>

export const usageIngestRequestSchema = z.object({
  events: z.array(usageEventInputSchema).min(1).max(MAX_INGEST_BATCH),
  source: z.enum(['api']).optional(),
})
export type UsageIngestRequest = z.infer<typeof usageIngestRequestSchema>

/**
 * 200 when at least one event was accepted and quota remains (or the plan has no cap).
 * Events beyond the cap are never stored.
 *
 * Every event of the batch lands in exactly one counter:
 * - accepted: stored.
 * - rejected: billable events cut by the quota (not stored).
 * - duplicates: events whose event_id was already seen, in the same batch or an earlier one (not stored, free).
 * - skipped_blocked: agent_blocked events dropped by the hourly cap (not stored, free).
 * Older servers omit the last two; they parse as 0.
 */
export const usageIngestResponseSchema = z.object({
  accepted: z.number().int().min(0),
  rejected: z.number().int().min(0),
  duplicates: z.number().int().min(0).default(0),
  skipped_blocked: z.number().int().min(0).default(0),
  cap: z.number().int().nullable(),
  used: z.number().int().min(0),
  remaining: z.number().int().min(0).nullable(),
  billing_mode: z.enum(BILLING_MODES),
})
export type UsageIngestResponse = z.infer<typeof usageIngestResponseSchema>

/**
 * 429 when the organization is at or over its cap after the batch (nothing beyond the cap is stored).
 * `accepted` may be above 0 when the batch crossed the cap: those events were stored.
 */
export const usageQuotaExceededSchema = z.object({
  error: z.literal('quota_exceeded'),
  accepted: z.number().int().min(0),
  rejected: z.number().int().min(0),
  duplicates: z.number().int().min(0).default(0),
  skipped_blocked: z.number().int().min(0).default(0),
  cap: z.number().int().nullable(),
  used: z.number().int().min(0),
  remaining: z.literal(0),
  billing_mode: z.enum(BILLING_MODES),
  retry_after_seconds: z.number().int().min(1),
})
export type UsageQuotaExceeded = z.infer<typeof usageQuotaExceededSchema>

export const usageQuotaResponseSchema = z.object({
  billing_mode: z.enum(BILLING_MODES),
  cap: z.number().int().nullable(),
  used: z.number().int().min(0),
  remaining: z.number().int().min(0).nullable(),
  percent: z.number().min(0).nullable(),
  period_month: z.string().regex(/^\d{4}-\d{2}-01$/),
  alerts: z.object({
    eighty_percent_sent_at: z.string().nullable(),
    hundred_percent_sent_at: z.string().nullable(),
  }),
})
export type UsageQuotaResponse = z.infer<typeof usageQuotaResponseSchema>
