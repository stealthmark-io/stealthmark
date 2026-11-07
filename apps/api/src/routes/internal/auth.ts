import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users, organizations, type DbClient } from '@stealthmark/db'
import { config } from '../../config.js'
import { isInternalSecretValid } from '../../lib/internal-secret.js'

const upsertUserSchema = z.object({
  email: z.string().email('Valid email is required'),
  name: z.string().optional().nullable(),
  avatarUrl: z.string().optional().nullable(),
  provider: z.enum(['github', 'google', 'email']),
  externalId: z.string().optional().nullable(),
})

export async function internalAuthRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /internal/auth/upsert-user
  app.post('/upsert-user', async (request, reply) => {
    const internalSecret = request.headers['x-internal-secret']
    if (!isInternalSecretValid(internalSecret)) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Invalid or missing internal secret header',
      })
    }

    const parseResult = upsertUserSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { email, name, avatarUrl, provider, externalId } = parseResult.data
    const normalizedEmail = email.toLowerCase().trim()

    // 1. Check if user already exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)

    if (existingUser) {
      // Update existing user with latest info from OAuth / login
      const updateData: Partial<typeof users.$inferInsert> = {
        provider,
      }
      if (name) updateData.name = name
      if (avatarUrl) updateData.avatarUrl = avatarUrl
      if (externalId) updateData.externalId = externalId

      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, existingUser.id))
        .returning()

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, existingUser.orgId))
        .limit(1)

      return reply.send({
        user: updatedUser || existingUser,
        organization: org || null,
        isNew: false,
      })
    }

    // 2. User does not exist -> Auto-provision organization and user atomically
    const baseSlug = normalizedEmail.split('@')[0].replace(/[^a-z0-9]/g, '-').slice(0, 30) || 'workspace'
    const uniqueSlug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`
    const orgName = name ? `${name}'s Workspace` : `${normalizedEmail.split('@')[0]}'s Workspace`

    let provisioned: { createdOrg: typeof organizations.$inferSelect; createdUser: typeof users.$inferSelect }
    try {
      provisioned = await db.transaction(async (tx) => {
        const [createdOrg] = await tx
          .insert(organizations)
          .values({
            name: orgName,
            slug: uniqueSlug,
            plan: 'free',
            status: 'active',
          })
          .returning()

        if (!createdOrg) {
          throw new Error('Failed to create organization for new user')
        }

        const [createdUser] = await tx
          .insert(users)
          .values({
            orgId: createdOrg.id,
            email: normalizedEmail,
            name: name || null,
            avatarUrl: avatarUrl || null,
            provider,
            externalId: externalId || null,
            role: 'owner',
          })
          .returning()

        if (!createdUser) {
          throw new Error('Failed to create user for new organization')
        }

        return { createdOrg, createdUser }
      })
    } catch (err) {
      // A concurrent first login for the same email won the race; the transaction rolled the new organization back.
      const [racedUser] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1)
      if (!racedUser) {
        request.log.error({ err }, 'Failed to provision organization and user')
        return reply.code(500).send({
          error: 'database_error',
          message: 'Failed to create organization for new user',
        })
      }
      const [racedOrg] = await db.select().from(organizations).where(eq(organizations.id, racedUser.orgId)).limit(1)
      return reply.send({ user: racedUser, organization: racedOrg || null, isNew: false })
    }

    const { createdOrg, createdUser } = provisioned
    return reply.code(201).send({
      user: createdUser,
      organization: createdOrg,
      isNew: true,
    })
  })
}
