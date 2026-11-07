import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

/** Path params of a route addressed by one uuid `:id`. */
export const idParams = z.object({ id: z.string().uuid('Valid UUID required') })

/**
 * Validates the path params before any lookup and answers 400 validation_error when they don't match: a malformed id
 * would otherwise reach a uuid column, where Postgres rejects it (22P02) and the error handler answers 500.
 * Returns null once the 400 has been sent.
 */
export function parseParams<T extends z.ZodType>(
  schema: T,
  request: FastifyRequest,
  reply: FastifyReply,
): z.output<T> | null {
  const result = schema.safeParse(request.params)
  if (result.success) return result.data
  reply.code(400).send({ error: 'validation_error', details: result.error.flatten() })
  return null
}
