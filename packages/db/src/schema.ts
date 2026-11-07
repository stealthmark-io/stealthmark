import { sql } from 'drizzle-orm'
import { pgTable, uuid, text, timestamp, integer, numeric, boolean, jsonb, unique, index, vector, date } from 'drizzle-orm/pg-core'

// ═══════════════════════════════════════════
// ORGANIZATIONS
// ═══════════════════════════════════════════
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  domain: text('domain'),
  plan: text('plan').default('free').notNull(),
  status: text('status').default('active').notNull(),
  publisherEnabled: boolean('publisher_enabled').default(false).notNull(),
  publisherVerifiedAt: timestamp('publisher_verified_at', { withTimezone: true }),
  publisherTier: text('publisher_tier').default('standard').notNull(),
  escrowBalance: numeric('escrow_balance').default('0').notNull(),
  availableBalance: numeric('available_balance').default('0').notNull(),
  totalEarned: numeric('total_earned').default('0').notNull(),
  totalSpent: numeric('total_spent').default('0').notNull(),
  billingMode: text('billing_mode').default('free').notNull(), // free | credits | enterprise
  monthlyEventCap: integer('monthly_event_cap').default(250).notNull(),
  creditBalanceEvents: integer('credit_balance_events').default(0).notNull(), // remaining prepaid events (credits mode)
  quotaAlert80SentAt: timestamp('quota_alert_80_sent_at', { withTimezone: true }),
  quotaAlert100SentAt: timestamp('quota_alert_100_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  externalId: text('external_id').unique(), // Google Identity Platform UID or OAuth Provider ID
  email: text('email').unique().notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  provider: text('provider'), // github | google | email
  role: text('role').default('member').notNull(), // owner | admin | member
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// API KEYS
// ═══════════════════════════════════════════
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  keyHash: text('key_hash').unique().notNull(),
  keyPrefix: text('key_prefix').notNull(), // "sk_live_xxxx" for display
  name: text('name').notNull(),
  scopes: text('scopes').array().default([]).notNull(),
  rateLimitRpm: integer('rate_limit_rpm').default(60).notNull(),
  rateLimitRpd: integer('rate_limit_rpd').default(10000).notNull(),
  spendLimit: numeric('spend_limit'),
  status: text('status').default('active').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('api_keys_org_id_idx').on(table.orgId),
  index('api_keys_status_idx').on(table.status),
])

// ═══════════════════════════════════════════
// AGENTS
// ═══════════════════════════════════════════
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  agentCard: jsonb('agent_card'),
  protocols: text('protocols').array().default([]).notNull(),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('agents_org_id_idx').on(table.orgId),
  index('agents_status_idx').on(table.status),
])

// ═══════════════════════════════════════════
// CAPABILITIES
// ═══════════════════════════════════════════
export const capabilities = pgTable('capabilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(), // primitive | tool | skill | agent
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  category: text('category'),
  protocols: text('protocols').array().default([]).notNull(),
  endpoint: text('endpoint'),
  schemaJson: jsonb('schema_json'),
  pricingUnit: text('pricing_unit'),
  pricingAmount: numeric('pricing_amount'),
  visibility: text('visibility').default('public').notNull(), // public | private | unlisted
  slaJson: jsonb('sla_json'),
  documentationUrl: text('documentation_url'),
  status: text('status').default('active').notNull(),
  version: text('version').default('1.0.0').notNull(),
  trustScore: integer('trust_score'),
  embedding: vector('embedding', { dimensions: 1536 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('capabilities_org_slug_unique').on(table.orgId, table.slug),
  index('capabilities_org_id_idx').on(table.orgId),
  index('capabilities_type_idx').on(table.type),
  index('capabilities_status_idx').on(table.status),
  index('capabilities_visibility_idx').on(table.visibility),
])

// ═══════════════════════════════════════════
// CAPABILITY PROVIDERS
// ═══════════════════════════════════════════
export const capabilityProviders = pgTable('capability_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  protocol: text('protocol').notNull(),
  endpoint: text('endpoint').notNull(),
  priority: integer('priority').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// USAGE RECORDS
// ═══════════════════════════════════════════
export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'set null' }),
  requestCount: integer('request_count').default(1).notNull(),
  cost: numeric('cost'),
  latencyMs: integer('latency_ms'),
  success: boolean('success'),
  metadata: jsonb('metadata'),
  siteId: uuid('site_id'),
  eventType: text('event_type').default('agent_request').notNull(), // agent_request | agent_blocked | agent_manifest
  units: integer('units').default(1).notNull(),
  source: text('source').default('api').notNull(), // gateway | middleware | api
  agentIdentifier: text('agent_identifier'),
  /** Client-supplied idempotency key; partial unique index (org_id, event_id) WHERE event_id IS NOT NULL lives in 20261001_metering_hardening.sql. */
  eventId: uuid('event_id'),
  /** Generated by Postgres from created_at (UTC month start); never written by the app. */
  periodMonth: date('period_month', { mode: 'string' })
    .notNull()
    .generatedAlwaysAs(sql`date_trunc('month', created_at AT TIME ZONE 'UTC')::date`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('usage_records_org_period_idx').on(table.orgId, table.periodMonth),
])

// ═══════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'set null' }),
  type: text('type'),
  status: text('status').default('queued').notNull(),
  inputJson: jsonb('input_json'),
  outputJson: jsonb('output_json'),
  cost: numeric('cost'),
  latencyMs: integer('latency_ms'),
  traceId: text('trace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('tasks_org_id_idx').on(table.orgId),
  index('tasks_agent_id_idx').on(table.agentId),
  index('tasks_capability_id_idx').on(table.capabilityId),
  index('tasks_status_idx').on(table.status),
  index('tasks_created_at_idx').on(table.createdAt),
])

// ═══════════════════════════════════════════
// TRUST SCORES
// ═══════════════════════════════════════════
export const trustScores = pgTable('trust_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'cascade' }).unique().notNull(),
  ownerVerified: boolean('owner_verified').default(false).notNull(),
  domainVerified: boolean('domain_verified').default(false).notNull(),
  endpointVerified: boolean('endpoint_verified').default(false).notNull(),
  successRate: numeric('success_rate'),
  medianLatencyMs: integer('median_latency_ms'),
  availability: numeric('availability'),
  totalExecutions: integer('total_executions').default(0).notNull(),
  verificationEvents: integer('verification_events').default(0).notNull(),
  score: integer('score'),
  scoreLabel: text('score_label').default('new').notNull(), // new | emerging | established | trusted
  qualityScore: integer('quality_score'),
  reputationScore: integer('reputation_score'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// EVALUATIONS (Quality Scoring)
// ═══════════════════════════════════════════
export const evaluations = pgTable('evaluations', {
  id: uuid('id').primaryKey().defaultRandom(),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'cascade' }).notNull(),
  qualityScore: integer('quality_score').notNull(),
  taskCompletionRate: numeric('task_completion_rate'),
  accuracy: numeric('accuracy'),
  latencyP50: integer('latency_p50'),
  latencyP99: integer('latency_p99'),
  consistencyScore: numeric('consistency_score'),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// REVIEWS (Verified Executions)
// ═══════════════════════════════════════════
export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'cascade' }).notNull(),
  reviewerOrgId: uuid('reviewer_org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  rating: integer('rating').notNull(), // 1 - 5
  comment: text('comment'),
  verifiedExecution: boolean('verified_execution').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// BADGES (Quality & Verification)
// ═══════════════════════════════════════════
export const badges = pgTable('badges', {
  id: uuid('id').primaryKey().defaultRandom(),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'cascade' }).notNull(),
  badgeType: text('badge_type').notNull(), // verified_identity | verified_endpoint | high_reliability | evaluated | production_proven
  evidenceJson: jsonb('evidence_json'),
  awardedAt: timestamp('awarded_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  orgId: uuid('org_id'),
  processed: boolean('processed').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// NEGOTIATIONS (Autonomous Agent Protocols)
// ═══════════════════════════════════════════
export const negotiations = pgTable('negotiations', {
  id: uuid('id').primaryKey().defaultRandom(),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'cascade' }).notNull(),
  consumerOrgId: uuid('consumer_org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  providerOrgId: uuid('provider_org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  status: text('status').default('proposed').notNull(), // proposed | countered | accepted | rejected | expired
  currentOffer: jsonb('current_offer').notNull(), // { price: number, unit: string, volume: number, slaMs: number, customTerms?: string }
  history: jsonb('history').default([]).notNull(), // Array of actions: [{ role, action, offer, note, timestamp }]
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// CONTRACTS (Machine-Readable Agreements)
// ═══════════════════════════════════════════
export const contracts = pgTable('contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  negotiationId: uuid('negotiation_id').references(() => negotiations.id, { onDelete: 'set null' }),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'cascade' }).notNull(),
  consumerOrgId: uuid('consumer_org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  providerOrgId: uuid('provider_org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  termsJson: jsonb('terms_json').notNull(), // { pricing: { amount, unit }, sla: { maxLatencyMs, uptime }, deliverablesSchema }
  termsHash: text('terms_hash').notNull(), // SHA-256 digest of normalized termsJson
  consumerSignedAt: timestamp('consumer_signed_at', { withTimezone: true }),
  providerSignedAt: timestamp('provider_signed_at', { withTimezone: true }),
  status: text('status').default('draft').notNull(), // draft | active | completed | breached | cancelled
  validFrom: timestamp('valid_from', { withTimezone: true }).defaultNow().notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// ESCROWS (Trustless Financial Custody)
// ═══════════════════════════════════════════
export const escrows = pgTable('escrows', {
  id: uuid('id').primaryKey().defaultRandom(),
  contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'cascade' }).notNull(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  consumerOrgId: uuid('consumer_org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  providerOrgId: uuid('provider_org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  amount: numeric('amount').notNull(),
  feeAmount: numeric('fee_amount').default('0').notNull(), // StealthMark platform take-rate (5%)
  netAmount: numeric('net_amount').notNull(), // amount - feeAmount
  currency: text('currency').default('usd').notNull(),
  status: text('status').default('pending').notNull(), // pending | held | work_submitted | released | refunded | disputed
  deliverableJson: jsonb('deliverable_json'),
  disputeReason: text('dispute_reason'),
  heldAt: timestamp('held_at', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// POLICIES (Enterprise Governance & FinOps)
// ═══════════════════════════════════════════
/** @deprecated Frozen until FEATURE_PASSPORTS ships; renamed so it never collides with the DEFCON `policies` table the gateway owns. */
export const policies = pgTable('governance_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull(), // spend_limit | rate_limit | capability_restriction | approval_required
  rulesJson: jsonb('rules_json').notNull(), // { maxCostPerTask?: number, dailySpendCap?: number, allowedCapabilities?: string[], blockedCapabilities?: string[] }
  enforcementAction: text('enforcement_action').default('block').notNull(), // block | flag | require_approval
  status: text('status').default('active').notNull(), // active | disabled
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// AUDIT LOGS (Cryptographic Append-Only Trail)
// ═══════════════════════════════════════════
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(), // task.execute | policy.create | kill_switch.activate | escrow.release | contract.sign
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payloadJson: jsonb('payload_json'),
  ipAddress: text('ip_address'),
  prevHash: text('prev_hash'), // SHA-256 of the prior log row in chain
  logHash: text('log_hash').notNull(), // SHA-256(prevHash + action + timestamp + payload)
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// KILL SWITCHES (Emergency Autonomous Controls)
// ═══════════════════════════════════════════
export const killSwitches = pgTable('kill_switches', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  targetType: text('target_type').notNull(), // organization | agent | capability | api_key
  targetId: text('target_id').notNull(), // specific ID or '*' for organization-wide emergency stop
  reason: text('reason').notNull(),
  triggeredBy: text('triggered_by').notNull(),
  status: text('status').default('active').notNull(), // active (stopped) | disarmed (restored)
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).defaultNow().notNull(),
  disarmedAt: timestamp('disarmed_at', { withTimezone: true }),
})

// ═══════════════════════════════════════════
// PRIVATE REGISTRIES (Isolated Enterprise Networks)
// ═══════════════════════════════════════════
export const privateRegistries = pgTable('private_registries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  allowedOrgIds: text('allowed_org_ids').array().default([]).notNull(),
  capabilityIds: text('capability_ids').array().default([]).notNull(),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ═══════════════════════════════════════════
// AGENT CONTEXT & EXPERIENCE (Phase 7 Agent Intelligence)
// ═══════════════════════════════════════════
export const agentContext = pgTable('agent_context', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  capabilityId: uuid('capability_id').references(() => capabilities.id, { onDelete: 'cascade' }).notNull(),
  providerOrgId: uuid('provider_org_id').references(() => organizations.id, { onDelete: 'set null' }),
  totalExecutions: integer('total_executions').default(0).notNull(),
  successfulExecutions: integer('successful_executions').default(0).notNull(),
  avgLatencyMs: integer('avg_latency_ms'),
  avgCostUsd: numeric('avg_cost_usd'),
  lastExecutionAt: timestamp('last_execution_at', { withTimezone: true }),
  preferenceScore: numeric('preference_score').default('0.0').notNull(), // -1.0 (blocked) to 1.0 (preferred)
  preferenceReason: text('preference_reason'),
  contextType: text('context_type').default('execution_outcome').notNull(), // execution_outcome | provider_preference | policy_constraint
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('agent_context_agent_cap_provider_unique').on(table.agentId, table.capabilityId, table.providerOrgId),
])

// ═══════════════════════════════════════════
// REGISTERED SITES (Agentic Access Network)
// ═══════════════════════════════════════════
export const registeredSites = pgTable('registered_sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  domain: text('domain').unique().notNull(),          // "example.com"
  displayName: text('display_name').notNull(),
  description: text('description'),
  dnsVerified: boolean('dns_verified').default(false).notNull(),
  dnsVerificationToken: text('dns_verification_token'), // TXT record value to verify
  endpointUrl: text('endpoint_url'),                    // agent access endpoint
  accessPolicy: text('access_policy').default('open').notNull(), // open | approved | invite_only
  allowedScopes: text('allowed_scopes').array().default([]).notNull(),
  allowedAgentIds: text('allowed_agent_ids').array().default([]).notNull(), // for invite_only
  maxRpm: integer('max_rpm').default(100).notNull(),
  passportTtlSeconds: integer('passport_ttl_seconds').default(3600).notNull(), // default 1 hour
  status: text('status').default('pending').notNull(),  // pending | active | suspended
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('registered_sites_org_id_idx').on(table.orgId),
  index('registered_sites_status_idx').on(table.status),
])

// ═══════════════════════════════════════════
// AGENT PASSPORTS (Cryptographic Access Tokens)
// ═══════════════════════════════════════════
export const agentPassports = pgTable('agent_passports', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  siteId: uuid('site_id').references(() => registeredSites.id, { onDelete: 'cascade' }).notNull(),
  passportJti: text('passport_jti').unique().notNull(), // JWT ID (unique nonce)
  scopesGranted: text('scopes_granted').array().default([]).notNull(),
  trustLevel: text('trust_level').notNull(),            // new | emerging | established | trusted
  trustScore: integer('trust_score'),
  behavioralScore: integer('behavioral_score'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked: boolean('revoked').default(false).notNull(),
  revokedReason: text('revoked_reason'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('agent_passports_agent_site_idx').on(table.agentId, table.siteId),
  index('agent_passports_org_id_idx').on(table.orgId),
  index('agent_passports_expires_at_idx').on(table.expiresAt),
])

// ═══════════════════════════════════════════
// GATEWAY ACCESS EVENTS (Audit Chain Extension)
// ═══════════════════════════════════════════
export const gatewayAccessEvents = pgTable('gateway_access_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  passportId: uuid('passport_id').references(() => agentPassports.id, { onDelete: 'set null' }),
  siteId: uuid('site_id').references(() => registeredSites.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  action: text('action').notNull(),                     // allowed | blocked | rate_limited | revoked
  reason: text('reason'),
  ipAddress: text('ip_address'),
  latencyMs: integer('latency_ms'),
  prevHash: text('prev_hash'),                          // SHA-256 chain link
  eventHash: text('event_hash').notNull(),              // SHA-256 of this event
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('gateway_access_events_site_created_idx').on(table.siteId, table.createdAt),
  index('gateway_access_events_agent_id_idx').on(table.agentId),
  index('gateway_access_events_org_id_idx').on(table.orgId),
])

// ═══════════════════════════════════════════
// ACTION SCHEMAS (Agentic Gateway Direct Actions)
// ═══════════════════════════════════════════
export const actionSchemas = pgTable('action_schemas', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').references(() => registeredSites.id, { onDelete: 'cascade' }).notNull(),
  actionSlug: text('action_slug').notNull(),            // "reserve_ticket", "add_to_cart"
  displayName: text('display_name').notNull(),
  description: text('description'),
  method: text('method').default('POST').notNull(),     // POST, GET, PUT
  endpointPath: text('endpoint_path').notNull(),        // "/_stealthmark/actions/reserve"
  inputSchema: jsonb('input_schema').notNull(),         // JSON Schema for request payload
  outputSchema: jsonb('output_schema'),                 // JSON Schema for response payload
  requiredScopes: text('required_scopes').array().default([]).notNull(),
  rateLimit: integer('rate_limit').default(60).notNull(), // RPM
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('action_schemas_site_id_idx').on(table.siteId),
  index('action_schemas_action_slug_idx').on(table.actionSlug),
])

// Infer TypeScript types from schema
export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert

export type Capability = typeof capabilities.$inferSelect
export type NewCapability = typeof capabilities.$inferInsert

export type CapabilityProvider = typeof capabilityProviders.$inferSelect
export type NewCapabilityProvider = typeof capabilityProviders.$inferInsert

export type UsageRecord = typeof usageRecords.$inferSelect
export type NewUsageRecord = typeof usageRecords.$inferInsert

export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert

export type TrustScore = typeof trustScores.$inferSelect
export type NewTrustScore = typeof trustScores.$inferInsert

export type Evaluation = typeof evaluations.$inferSelect
export type NewEvaluation = typeof evaluations.$inferInsert

export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert

export type Badge = typeof badges.$inferSelect
export type NewBadge = typeof badges.$inferInsert

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert

export type Negotiation = typeof negotiations.$inferSelect
export type NewNegotiation = typeof negotiations.$inferInsert

export type Contract = typeof contracts.$inferSelect
export type NewContract = typeof contracts.$inferInsert

export type Escrow = typeof escrows.$inferSelect
export type NewEscrow = typeof escrows.$inferInsert

export type Policy = typeof policies.$inferSelect
export type NewPolicy = typeof policies.$inferInsert

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert

export type KillSwitch = typeof killSwitches.$inferSelect
export type NewKillSwitch = typeof killSwitches.$inferInsert

export type PrivateRegistry = typeof privateRegistries.$inferSelect
export type NewPrivateRegistry = typeof privateRegistries.$inferInsert

export type AgentContext = typeof agentContext.$inferSelect
export type NewAgentContext = typeof agentContext.$inferInsert

export type RegisteredSite = typeof registeredSites.$inferSelect
export type NewRegisteredSite = typeof registeredSites.$inferInsert

export type AgentPassport = typeof agentPassports.$inferSelect
export type NewAgentPassport = typeof agentPassports.$inferInsert

export type GatewayAccessEvent = typeof gatewayAccessEvents.$inferSelect
export type NewGatewayAccessEvent = typeof gatewayAccessEvents.$inferInsert

export type ActionSchema = typeof actionSchemas.$inferSelect
export type NewActionSchema = typeof actionSchemas.$inferInsert
