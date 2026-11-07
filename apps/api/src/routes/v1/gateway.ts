import { FastifyInstance } from 'fastify'
import { type DbClient } from '@stealthmark/db'
import { registerSiteRoutes } from './gateway/sites.js'
import { registerPassportRoutes } from './gateway/passports.js'
import { registerEventRoutes } from './gateway/events.js'
import { registerActionRoutes } from './gateway/actions.js'

export interface GatewayRoutesOptions {
  db: DbClient
  /** Agent passports (issuance, verification, published key) are part of the frozen FEATURE_PASSPORTS surface. */
  passports: boolean
}

export async function gatewayRoutes(app: FastifyInstance, options: GatewayRoutesOptions) {
  const deps = { db: options.db }
  await registerSiteRoutes(app, deps)
  if (options.passports) {
    await registerPassportRoutes(app, deps)
  }
  await registerEventRoutes(app, deps)
  await registerActionRoutes(app, deps)
}
