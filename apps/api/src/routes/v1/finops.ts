import { FastifyInstance } from 'fastify'
import { type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'
import { getFinOpsBreakdown } from '../../services/finops.js'

export async function finopsRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // GET /v1/enterprise/finops/breakdown — Get detailed task cost breakdown and efficiency analytics
  app.get('/enterprise/finops/breakdown', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const breakdown = await getFinOpsBreakdown(db, callerOrgId)
    return reply.code(200).send(breakdown)
  })
}
