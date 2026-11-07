import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

/** Supabase's transaction-mode pooler (PgBouncer) does not support prepared statements. */
export function usesTransactionPooler(connectionString: string): boolean {
  return /pooler\.supabase\.com|pgbouncer=true/.test(connectionString)
}

/** Supabase rejects plaintext connections; local Postgres in development does not speak TLS. */
export function requiresSsl(connectionString: string): boolean {
  return /\.supabase\.co(m)?\b|sslmode=require/.test(connectionString)
}

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !usesTransactionPooler(connectionString),
    ssl: requiresSsl(connectionString) ? 'require' : undefined,
  })

  return drizzle(client, { schema })
}

export type DbClient = ReturnType<typeof createDb>
