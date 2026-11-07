import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { organizations, users, type DbClient } from '@stealthmark/db'
import { isAuthorizedForOrg, isPlatformCaller } from '../../lib/org-context.js'
import { idParams, parseParams } from '../../lib/params.js'

const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase alphanumeric characters and hyphens'),
  domain: z.string().optional(),
})

const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  domain: z.string().optional(),
  plan: z.enum(['free', 'developer', 'growth', 'enterprise']).optional(),
})

function orgNotFound() {
  return { error: 'not_found', message: 'Organization not found' }
}

const addUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().optional(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
})

export async function organizationsRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/organizations
  app.post('/', async (request, reply) => {
    if (!isPlatformCaller(request)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Only platform administrators can create organizations',
      })
    }

    const parseResult = createOrgSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { name, slug, domain } = parseResult.data

    // Check slug uniqueness
    const [existing] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1)

    if (existing) {
      return reply.code(409).send({
        error: 'conflict',
        message: `Organization slug '${slug}' is already taken`,
      })
    }

    const [created] = await db
      .insert(organizations)
      .values({
        name,
        slug,
        domain: domain || null,
        plan: 'free',
        status: 'active',
      })
      .returning()

    return reply.code(201).send(created)
  })

  // GET /v1/organizations/:id
  app.get('/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    if (!isAuthorizedForOrg(request, id)) {
      return reply.code(404).send(orgNotFound())
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1)

    if (!org) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Organization not found',
      })
    }

    return reply.send(org)
  })

  // PATCH /v1/organizations/:id
  app.patch('/:id', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id } = params
    if (!isAuthorizedForOrg(request, id)) {
      return reply.code(404).send(orgNotFound())
    }
    const parseResult = updateOrgSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    if (parseResult.data.plan !== undefined && !isPlatformCaller(request)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Only platform administrators can change an organization plan',
      })
    }

    const [updated] = await db
      .update(organizations)
      .set({
        ...parseResult.data,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id))
      .returning()

    if (!updated) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Organization not found',
      })
    }

    return reply.send(updated)
  })

  // POST /v1/organizations/:id/users
  app.post('/:id/users', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id: orgId } = params
    if (!isAuthorizedForOrg(request, orgId)) {
      return reply.code(404).send(orgNotFound())
    }
    const parseResult = addUserSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    // Verify org exists
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1)

    if (!org) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Organization not found',
      })
    }

    const { email, name, role } = parseResult.data
    if (role !== 'member' && !isPlatformCaller(request)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Only platform administrators can assign owner or admin roles',
      })
    }

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email,
        name: name || null,
        role,
      })
      .returning()

    return reply.code(201).send(user)
  })

  // GET /v1/organizations/:id/users
  app.get('/:id/users', async (request, reply) => {
    const params = parseParams(idParams, request, reply)
    if (!params) return reply
    const { id: orgId } = params
    if (!isAuthorizedForOrg(request, orgId)) {
      return reply.code(404).send(orgNotFound())
    }

    const orgUsers = await db
      .select({
        id: users.id,
        orgId: users.orgId,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.orgId, orgId))

    return reply.send({ data: orgUsers })
  })
}
