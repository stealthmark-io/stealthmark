import type { FastifyReply, FastifyRequest } from 'fastify'
import { type DbClient, type RegisteredSite } from '@stealthmark/db'
import { getSiteById } from '../../../services/site-registration.js'
import { isAuthorizedForOrg } from '../../../lib/org-context.js'

export interface GatewayDeps {
  db: DbClient
}

export function parseLimit(raw: string | undefined): number {
  const parsed = raw ? parseInt(raw, 10) : 50
  return Math.min(100, Math.max(1, Number.isNaN(parsed) ? 50 : parsed))
}

/**
 * Loads a site and verifies the caller owns it. Sends the 404/403 reply itself and returns null when the
 * caller must stop.
 */
export async function loadOwnedSite(
  db: DbClient,
  request: FastifyRequest,
  reply: FastifyReply,
  siteId: string,
): Promise<RegisteredSite | null> {
  const site = await getSiteById(db, siteId)
  if (!site) {
    reply.code(404).send({ error: 'not_found', message: `Site ${siteId} not found` })
    return null
  }
  if (!isAuthorizedForOrg(request, site.orgId)) {
    reply.code(403).send({ error: 'forbidden', message: 'Access denied: caller does not own this site' })
    return null
  }
  return site
}
