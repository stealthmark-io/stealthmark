import { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { users, type DbClient } from '@stealthmark/db'
import { isAuthorizedForOrg, orgScope } from '../../lib/org-context.js'

export async function usersRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // GET /v1/users/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), orgScope(request, users.orgId)))
      .limit(1)

    if (!user || !isAuthorizedForOrg(request, user.orgId)) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'User not found',
      })
    }

    return reply.send(user)
  })

  // DELETE /v1/users/:id
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [user] = await db
      .select({ id: users.id, orgId: users.orgId })
      .from(users)
      .where(and(eq(users.id, id), orgScope(request, users.orgId)))
      .limit(1)

    if (!user || !isAuthorizedForOrg(request, user.orgId)) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'User not found',
      })
    }

    const [deleted] = await db
      .delete(users)
      .where(and(eq(users.id, id), orgScope(request, users.orgId)))
      .returning({ id: users.id })

    if (!deleted) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'User not found',
      })
    }

    return reply.send({ success: true, id: deleted.id })
  })
}
