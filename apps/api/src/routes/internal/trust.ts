import { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { capabilities, type DbClient } from '@stealthmark/db'
import { calculateTrustScore } from '../../services/trust.js'
import { isInternalSecretValid } from '../../lib/internal-secret.js'

export async function internalTrustRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // Internal-only: recalculation writes trust scores for every capability and must never be public.
  app.addHook('preHandler', async (request, reply) => {
    if (!isInternalSecretValid(request.headers['x-internal-secret'])) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Invalid internal secret' })
    }
  })

  // POST /internal/trust/recalculate
  app.post('/recalculate', async (request, reply) => {
    const startTime = Date.now()

    // Query all active capabilities
    const activeCaps = await db
      .select({ id: capabilities.id, name: capabilities.name, slug: capabilities.slug })
      .from(capabilities)
      .where(eq(capabilities.status, 'active'))

    const updated = []

    for (const cap of activeCaps) {
      try {
        const trust = await calculateTrustScore(db, cap.id)
        updated.push({
          capabilityId: cap.id,
          name: cap.name,
          slug: cap.slug,
          score: trust.score,
          label: trust.label,
        })
      } catch (err) {
        request.log.warn({ err, capabilityId: cap.id }, 'Failed to recalculate trust score for capability')
      }
    }

    const elapsedMs = Date.now() - startTime

    return reply.send({
      status: 'completed',
      updated_count: updated.length,
      elapsed_ms: elapsedMs,
      capabilities: updated,
    })
  })
}
