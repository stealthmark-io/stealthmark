import { FastifyInstance } from 'fastify'
import { eq, desc } from 'drizzle-orm'
import { capabilities, evaluations, type DbClient } from '@stealthmark/db'
import { calculateQualityScore } from '../../services/evaluation.js'
import { evaluateAndAwardBadges } from '../../services/badges.js'

export async function evaluationsRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // GET /v1/capabilities/:id/evaluation — Get latest evaluation for a capability
  app.get('/capabilities/:id/evaluation', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [cap] = await db
      .select({ id: capabilities.id, name: capabilities.name, slug: capabilities.slug })
      .from(capabilities)
      .where(eq(capabilities.id, id))
      .limit(1)

    if (!cap) {
      return reply.code(404).send({ error: 'not_found', message: 'Capability not found' })
    }

    const [latestEval] = await db
      .select()
      .from(evaluations)
      .where(eq(evaluations.capabilityId, id))
      .orderBy(desc(evaluations.evaluatedAt))
      .limit(1)

    if (!latestEval) {
      // Calculate on the fly if none exists yet
      const computed = await calculateQualityScore(db, id)
      return reply.code(200).send({
        capability: cap,
        evaluation: {
          qualityScore: computed.qualityScore,
          taskCompletionRate: (computed.taskCompletionRate * 100).toFixed(1) + '%',
          accuracy: (computed.accuracy * 100).toFixed(1) + '%',
          latencyP50Ms: computed.latencyP50,
          latencyP99Ms: computed.latencyP99,
          consistencyScore: (computed.consistencyScore * 100).toFixed(1) + '%',
          evaluatedAt: computed.evaluatedAt,
        },
      })
    }

    return reply.code(200).send({
      capability: cap,
      evaluation: {
        id: latestEval.id,
        qualityScore: latestEval.qualityScore,
        taskCompletionRate: latestEval.taskCompletionRate ? (parseFloat(latestEval.taskCompletionRate) * 100).toFixed(1) + '%' : '100%',
        accuracy: latestEval.accuracy ? (parseFloat(latestEval.accuracy) * 100).toFixed(1) + '%' : '100%',
        latencyP50Ms: latestEval.latencyP50,
        latencyP99Ms: latestEval.latencyP99,
        consistencyScore: latestEval.consistencyScore ? (parseFloat(latestEval.consistencyScore) * 100).toFixed(1) + '%' : '100%',
        evaluatedAt: latestEval.evaluatedAt,
      },
    })
  })

  // POST /v1/capabilities/:id/evaluate — Trigger re-evaluation of capability quality
  app.post('/capabilities/:id/evaluate', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [cap] = await db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(eq(capabilities.id, id))
      .limit(1)

    if (!cap) {
      return reply.code(404).send({ error: 'not_found', message: 'Capability not found' })
    }

    const result = await calculateQualityScore(db, id)
    const badges = await evaluateAndAwardBadges(db, id)

    return reply.code(200).send({
      message: 'Capability evaluated successfully',
      evaluation: result,
      badgesAwarded: badges,
    })
  })
}
