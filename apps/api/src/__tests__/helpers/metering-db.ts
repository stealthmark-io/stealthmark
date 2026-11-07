import { getTableName } from 'drizzle-orm'
import type { DbClient } from '@stealthmark/db'

export interface FakeOrg {
  name: string
  billingMode: string
  monthlyEventCap: number
  creditBalanceEvents: number
  quotaAlert80SentAt: Date | null
  quotaAlert100SentAt: Date | null
}

export interface FakeMeteringState {
  org: FakeOrg | null
  usedBase: number
  inserted: Record<string, unknown>[]
  ownedSiteIds: string[]
  owners: { email: string }[]
  members: { email: string }[]
  orgUpdates: Record<string, unknown>[]
}

export function defaultOrg(overrides: Partial<FakeOrg> = {}): FakeOrg {
  return {
    name: 'Acme Corp',
    billingMode: 'free',
    monthlyEventCap: 10,
    creditBalanceEvents: 0,
    quotaAlert80SentAt: null,
    quotaAlert100SentAt: null,
    ...overrides,
  }
}

export function createState(overrides: Partial<FakeMeteringState> = {}): FakeMeteringState {
  return {
    org: defaultOrg(),
    usedBase: 0,
    inserted: [],
    ownedSiteIds: [],
    owners: [],
    members: [],
    orgUpdates: [],
    ...overrides,
  }
}

type Resolve<T> = (value: T) => unknown

function chain<T>(rows: T[]) {
  const node: Record<string, unknown> = {}
  for (const method of ['where', 'for', 'limit', 'orderBy']) {
    node[method] = () => node
  }
  node.then = (resolve: Resolve<T[]>) => resolve(rows)
  return node
}

/**
 * Stateful Drizzle stand-in for the metering tables. Every query builder is chainable; WHERE conditions are not
 * evaluated, so each table answers from the scripted state. Transactions run against the same state.
 */
export function createMeteringDb(state: FakeMeteringState): DbClient {
  let userQueries = 0

  const selectFrom = (table: unknown) => {
    switch (getTableName(table as Parameters<typeof getTableName>[0])) {
      case 'organizations':
        return chain(state.org ? [{ ...state.org }] : [])
      case 'usage_records': {
        const insertedUnits = state.inserted.reduce<number>((sum, row) => sum + Number(row.units ?? 1), 0)
        return chain([{ used: state.usedBase + insertedUnits }])
      }
      case 'registered_sites':
        return chain(state.ownedSiteIds.map((id) => ({ id })))
      case 'users': {
        userQueries += 1
        return chain(userQueries % 2 === 1 ? state.owners : state.members)
      }
      default:
        return chain([])
    }
  }

  const fake = {
    select: () => ({ from: selectFrom }),
    insert: () => ({
      values: async (values: Record<string, unknown> | Record<string, unknown>[]) => {
        state.inserted.push(...(Array.isArray(values) ? values : [values]))
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const isOrg = getTableName(table as Parameters<typeof getTableName>[0]) === 'organizations'
          const credit = values.creditBalanceEvents
          const rejectedByGuard = typeof credit === 'number' && credit < 0
          if (isOrg && state.org && !rejectedByGuard) {
            Object.assign(state.org, values)
            state.orgUpdates.push(values)
          }
          return Object.assign(Promise.resolve(undefined), {
            returning: async () => (isOrg && !rejectedByGuard ? [{ id: 'org' }] : []),
          })
        },
      }),
    }),
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(fake),
  }
  return fake as unknown as DbClient
}
