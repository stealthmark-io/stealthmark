/**
 * Prints the agent traffic report (Markdown) for the sites that run the SDK middleware.
 *
 *   DATABASE_URL=... npx tsx apps/api/scripts/agent-report.ts --hours 72 \
 *     --site DemoCV --site "Example Shop" [--org <uuid>] [--exclude <agent>] [--out report.md]
 *
 * Runs one query inside a READ ONLY transaction; it never writes to the database.
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import postgres from 'postgres'
import { requiresSsl, usesTransactionPooler } from '@stealthmark/db'
import {
  AGENT_TRAFFIC_SQL,
  DEFAULT_EXCLUDED_AGENTS,
  renderAgentTrafficReport,
  type AgentTrafficRow,
} from '../src/reports/agent-traffic.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const { values } = parseArgs({
  options: {
    hours: { type: 'string', default: '72' },
    org: { type: 'string' },
    site: { type: 'string', multiple: true, default: [] },
    exclude: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
  },
})

const hours = Number(values.hours)
if (!Number.isInteger(hours) || hours < 1 || hours > 720) fail('--hours must be an integer between 1 and 720')
if (values.org !== undefined && !UUID.test(values.org)) fail('--org must be an organization UUID')
const excluded = [...DEFAULT_EXCLUDED_AGENTS, ...values.exclude]
if (excluded.some((agent) => agent.includes(','))) fail('--exclude values cannot contain commas')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) fail('DATABASE_URL is not set')

// Same connection rules as the API (packages/db/src/client.ts): Supabase requires TLS.
const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 15,
  prepare: !usesTransactionPooler(databaseUrl),
  ssl: requiresSsl(databaseUrl) ? 'require' : undefined,
})
try {
  const result = await sql.begin('read only', (tx) => tx.unsafe(AGENT_TRAFFIC_SQL, [hours, excluded.join(','), values.org ?? null]))
  const rows: AgentTrafficRow[] = result.map((r) => ({
    site: String(r.site),
    host: String(r.host),
    agent: String(r.agent),
    path: String(r.path),
    hits: Number(r.hits),
    lastSeen: new Date(r.last_seen as string | Date),
  }))
  const report = renderAgentTrafficReport(rows, { hours, generatedAt: new Date(), sites: values.site })
  if (values.out) {
    writeFileSync(values.out, report)
    console.error(`Report written to ${values.out} (${rows.length} site/agent/page rows).`)
  } else {
    process.stdout.write(report)
  }
} finally {
  await sql.end()
}
