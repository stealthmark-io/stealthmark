import type { FastifyReply } from 'fastify'
import { SiteRegistrationError } from '../../../services/site-registration.js'
import { PassportError } from '../../../services/passport.js'

/**
 * Answers expected domain failures with fixed messages. Anything else is rethrown so the central
 * error handler answers 500 without leaking driver or SQL details.
 */
export function replyWithDomainError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof SiteRegistrationError) {
    switch (err.code) {
      case 'invalid_domain':
        return reply.code(400).send({ error: 'bad_request', message: 'Invalid domain name' })
      case 'domain_taken':
        return reply.code(409).send({ error: 'conflict', message: 'Domain is already registered' })
      case 'site_not_found':
        return reply.code(404).send({ error: 'not_found', message: 'Site not found' })
    }
  }

  if (err instanceof PassportError) {
    switch (err.code) {
      case 'agent_not_found':
        return reply.code(404).send({ error: 'not_found', message: 'Agent not found' })
      case 'site_not_found':
        return reply.code(404).send({ error: 'not_found', message: 'Site not found' })
      case 'passport_not_found':
        return reply.code(404).send({ error: 'not_found', message: 'Passport not found' })
      case 'site_suspended':
        return reply.code(403).send({ error: 'forbidden', message: 'Site access is suspended' })
      case 'agent_not_invited':
        return reply.code(403).send({ error: 'forbidden', message: 'Agent is not on the approved invite list for this site' })
      case 'trust_insufficient':
        return reply.code(403).send({ error: 'forbidden', message: 'Agent trust score does not meet the minimum requirement for this site' })
    }
  }

  throw err
}
