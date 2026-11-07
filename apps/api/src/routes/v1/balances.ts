import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { organizations, escrows, type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'

const payoutRequestSchema = z.object({
  amount: z.number().positive('Payout amount must be positive'),
  destination: z.string().min(3, 'Destination account or email is required'),
})

export async function balancesRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // GET /v1/commerce/balance — Retrieve organization financial balance
  app.get('/commerce/balance', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const [org] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        availableBalance: organizations.availableBalance,
        escrowBalance: organizations.escrowBalance,
        totalEarned: organizations.totalEarned,
        totalSpent: organizations.totalSpent,
      })
      .from(organizations)
      .where(eq(organizations.id, callerOrgId))
      .limit(1)

    if (!org) {
      return reply.code(404).send({ error: 'not_found', message: 'Organization not found' })
    }

    // Aggregate platform fees paid by this organization across released escrows
    const [feeStats] = await db
      .select({
        totalFees: sql<number>`coalesce(sum(${escrows.feeAmount}), 0)::float`,
      })
      .from(escrows)
      .where(eq(escrows.consumerOrgId, callerOrgId))

    return reply.code(200).send({
      organizationId: org.id,
      name: org.name,
      balances: {
        available: Number(org.availableBalance),
        inEscrow: Number(org.escrowBalance),
        totalEarned: Number(org.totalEarned),
        totalSpent: Number(org.totalSpent),
        platformFeesPaid: feeStats?.totalFees || 0,
        currency: 'usd',
      },
    })
  })

  // POST /v1/commerce/payout — Withdraw available balance
  app.post('/commerce/payout', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const parseResult = payoutRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const { amount, destination } = parseResult.data

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, callerOrgId))
      .limit(1)

    if (!org) {
      return reply.code(404).send({ error: 'not_found', message: 'Organization not found' })
    }

    const currentBalance = Number(org.availableBalance)
    if (currentBalance < amount) {
      return reply.code(400).send({
        error: 'insufficient_funds',
        message: `Requested payout ($${amount}) exceeds available balance ($${currentBalance})`,
      })
    }

    // Deduct available balance
    await db
      .update(organizations)
      .set({
        availableBalance: sql`greatest(0, ${organizations.availableBalance} - ${amount})`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, callerOrgId))

    return reply.code(200).send({
      message: `Payout of $${amount} initiated to ${destination}`,
      payout: {
        amount,
        destination,
        status: 'completed',
        currency: 'usd',
        executedAt: new Date(),
      },
    })
  })
}
