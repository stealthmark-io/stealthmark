import type { FastifyInstance } from 'fastify'
import type { DbClient } from '@stealthmark/db'

export async function a2aRoutes(app: FastifyInstance, _options: { db: DbClient }) {
  // GET /.well-known/agent.json (A2A Agent Card)
  app.get('/agent.json', async () => ({
    name: 'StealthMark Agent Governance API',
    description: 'Control plane for sites that observe, rate-limit and authorize AI agent traffic through StealthMark middleware.',
    url: 'https://api.stealthmark.io',
    version: '2.0.0',
    protocol_version: 'A2A/v0.2',
    authentication: {
      schemes: ['bearer'],
      header: 'Authorization',
    },
    capabilities: ['site-registration', 'agent-events', 'usage-metering'],
  }))
}
