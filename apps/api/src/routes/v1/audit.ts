import { FastifyInstance } from 'fastify'
import { type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'
import { getAuditLogs, verifyAuditChain } from '../../services/audit.js'

export async function auditRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // GET /v1/enterprise/audit — Get append-only cryptographic audit logs
  app.get('/enterprise/audit', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const query = request.query as { limit?: string }
    const limit = query.limit ? parseInt(query.limit, 10) : 50

    const logs = await getAuditLogs(db, callerOrgId, limit)
    return reply.code(200).send({
      total: logs.length,
      logs,
    })
  })

  // POST /v1/enterprise/audit/verify — Cryptographically verify hash chain integrity
  app.post('/enterprise/audit/verify', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const verification = await verifyAuditChain(db, callerOrgId)
    return reply.code(200).send(verification)
  })
}
