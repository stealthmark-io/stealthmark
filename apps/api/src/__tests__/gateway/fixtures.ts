import type { DbClient } from '@stealthmark/db'
import { buildApp } from '../../app.js'
import { clearAllCounters } from '../../services/behavioral-score.js'
import type { PassportClaims } from '../../services/passport.js'
import { withTransactions } from '../helpers/fake-db.js'
import { ENABLED_FEATURES, testApiKeyResolver } from '../helpers/test-auth.js'

export const SUITE_NAME = 'Phase 8 — Agent Access & Passport Authority'

export const SAMPLE_ORG_ID = '777e4567-e89b-12d3-a456-426614174777'
export const SAMPLE_AGENT_ID = '999e4567-e89b-12d3-a456-426614174999'
export const SAMPLE_SITE_ID = '555e4567-e89b-12d3-a456-426614174555'

export const GENESIS_HASH = '0'.repeat(64)

export type Row = Record<string, unknown>

export function resetGatewayState(): void {
  clearAllCounters()
}

export function asDb(mock: object): DbClient {
  return mock as unknown as DbClient
}

export function buildGatewayApp(db: DbClient) {
  return buildApp({
    db,
    apiKeyResolver: testApiKeyResolver({ orgId: SAMPLE_ORG_ID }),
    features: ENABLED_FEATURES,
  })
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function passportClaims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  const now = nowSeconds()
  return {
    iss: 'stealthmark.io',
    sub: SAMPLE_AGENT_ID,
    aud: 'api.partner.com',
    jti: 'sm_pass_12345',
    iat: now,
    exp: now + 3600,
    site_id: SAMPLE_SITE_ID,
    org_id: SAMPLE_ORG_ID,
    agent_name: 'Scout Agent',
    scopes: ['content:read'],
    trust_level: 'trusted',
    trust_score: 90,
    behavioral_score: 95,
    ...overrides,
  }
}

function tableNameOf(table: unknown): string | undefined {
  if (typeof table !== 'object' || table === null) return undefined
  const name: unknown = Reflect.get(table, Symbol.for('drizzle:Name'))
  return typeof name === 'string' ? name : undefined
}

const noRowsLookup = {
  from: () => ({ where: () => ({ limit: async () => [] }) }),
}

const noopUpdate = () => ({ set: () => ({ where: () => Promise.resolve([]) }) })

/** Domain is unused, so registerSite proceeds to insert and echoes the row back with an id. */
export function siteRegistrationDb(): DbClient {
  return asDb({
    select: () => noRowsLookup,
    insert: () => ({
      values: (val: Row) => ({
        returning: async () => [
          { id: SAMPLE_SITE_ID, ...val, createdAt: new Date(), updatedAt: new Date() },
        ],
      }),
    }),
    update: noopUpdate,
  })
}

/** Returns the given site on lookup and merges any update values into it. */
export function siteVerificationDb(site: Row): DbClient {
  return asDb({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [site] }) }) }),
    update: () => ({
      set: (vals: Row) => ({
        where: () => ({ returning: async () => [{ ...site, ...vals }] }),
      }),
    }),
  })
}

/** Append-only store: the latest inserted event is what the next insert chains onto. */
export function chainedEventsDb(): DbClient {
  const events: Row[] = []
  return withTransactions({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => (events.length > 0 ? [events[events.length - 1]] : []),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (val: Row) => ({
        returning: async () => {
          const row = { id: `evt-${events.length + 1}`, ...val }
          events.push(row)
          return [row]
        },
      }),
    }),
  })
}

export function storedEventsDb(events: Row[]): DbClient {
  return asDb({
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => events }) }) }),
  })
}

export function passportIssuanceDb(site: Row, agent: Row): DbClient {
  return asDb({
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            const name = tableNameOf(table)
            if (name === 'registered_sites') return [site]
            if (name === 'agents') return [agent]
            return []
          },
        }),
      }),
    }),
    insert: () => ({
      values: (val: Row) => ({ returning: async () => [{ id: 'pass-999', ...val }] }),
    }),
    update: noopUpdate,
  })
}
