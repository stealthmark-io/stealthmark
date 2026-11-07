import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { privateRegistries, type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'

const createRegistrySchema = z.object({
  name: z.string().min(3).max(100),
  slug: z.string().min(3).max(50),
  description: z.string().max(500).optional(),
  allowedOrgIds: z.array(z.string().uuid()).default([]),
  capabilityIds: z.array(z.string().uuid()).default([]),
})

export async function privateRegistriesRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/enterprise/private-registries — Create an isolated enterprise registry
  app.post('/enterprise/private-registries', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const parseResult = createRegistrySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const [inserted] = await db
      .insert(privateRegistries)
      .values({
        orgId: callerOrgId,
        name: parseResult.data.name,
        slug: parseResult.data.slug,
        description: parseResult.data.description || null,
        allowedOrgIds: parseResult.data.allowedOrgIds,
        capabilityIds: parseResult.data.capabilityIds,
        status: 'active',
      })
      .returning()

    return reply.code(201).send({
      message: 'Private enterprise registry created',
      registry: inserted,
    })
  })

  // GET /v1/enterprise/private-registries — List enterprise private registries
  app.get('/enterprise/private-registries', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const items = await db
      .select()
      .from(privateRegistries)
      .where(eq(privateRegistries.orgId, callerOrgId))
      .orderBy(desc(privateRegistries.createdAt))

    return reply.code(200).send({
      total: items.length,
      registries: items,
    })
  })
}
