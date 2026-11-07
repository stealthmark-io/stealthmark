import type { DbClient } from '@stealthmark/db'

/**
 * Wraps a partial Drizzle stand-in with the `transaction` and `execute` members of a real PostgresJsDatabase.
 * The transaction callback receives the same fake, so statements issued inside it hit the same stubs.
 */
export function withTransactions(stub: object): DbClient {
  const fake: Record<string, unknown> = {
    ...stub,
    execute: async () => [],
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(fake),
  }
  return fake as unknown as DbClient
}
