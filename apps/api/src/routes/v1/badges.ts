import { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { capabilities, type DbClient } from '@stealthmark/db'
import { evaluateAndAwardBadges, getCapabilityBadges } from '../../services/badges.js'

export async function badgesRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // GET /v1/capabilities/:id/badges — Get awarded quality and verification badges
  app.get('/capabilities/:id/badges', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [cap] = await db
      .select({ id: capabilities.id, name: capabilities.name })
      .from(capabilities)
      .where(eq(capabilities.id, id))
      .limit(1)

    if (!cap) {
      return reply.code(404).send({ error: 'not_found', message: 'Capability not found' })
    }

    const badges = await getCapabilityBadges(db, id)

    return reply.code(200).send({
      capabilityId: id,
      totalBadges: badges.length,
      badges,
    })
  })

  // POST /v1/capabilities/:id/badges/evaluate — Trigger badge evaluation
  app.post('/capabilities/:id/badges/evaluate', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [cap] = await db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(eq(capabilities.id, id))
      .limit(1)

    if (!cap) {
      return reply.code(404).send({ error: 'not_found', message: 'Capability not found' })
    }

    const awarded = await evaluateAndAwardBadges(db, id)

    return reply.code(200).send({
      message: 'Badges evaluated successfully',
      capabilityId: id,
      awarded,
    })
  })
}
