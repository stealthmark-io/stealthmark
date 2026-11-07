import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Write-side view of public.usage_records for the ingest path. It maps the same physical table as
 * `usageRecords` in @stealthmark/db and adds `event_id` (supabase/migrations/20261001_metering_hardening.sql),
 * the idempotency key that the shared Drizzle schema does not declare yet. Once `usageRecords` gains an
 * `eventId` column this file can be deleted and the ingest path pointed at `usageRecords`.
 */
export const usageLedger = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  apiKeyId: uuid('api_key_id'),
  siteId: uuid('site_id'),
  eventType: text('event_type').notNull(),
  units: integer('units').notNull(),
  source: text('source').notNull(),
  agentIdentifier: text('agent_identifier'),
  metadata: jsonb('metadata'),
  eventId: uuid('event_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type NewUsageLedgerRow = typeof usageLedger.$inferInsert
