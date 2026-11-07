import { eq, and, desc } from 'drizzle-orm'
import {
  actionSchemas,
  registeredSites,
  type ActionSchema,
  type NewActionSchema,
  type RegisteredSite,
  type DbClient,
} from '@stealthmark/db'

export interface CreateActionSchemaParams {
  siteId: string
  actionSlug: string
  displayName: string
  description?: string
  method?: string
  endpointPath: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  requiredScopes?: string[]
  rateLimit?: number
  enabled?: boolean
}

export interface UpdateActionSchemaParams {
  displayName?: string
  description?: string
  method?: string
  endpointPath?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  requiredScopes?: string[]
  rateLimit?: number
  enabled?: boolean
}

export interface AgentManifest {
  manifestVersion: '1.0.0'
  site: {
    id: string
    domain: string
    displayName: string
    description: string | null
    accessPolicy: string
  }
  gateway: {
    auth: 'stealthmark_passport'
    passportTtlSeconds: number
    maxRpm: number
    verificationEndpoint: string
    jwksUri: string
  }
  actions: Array<{
    slug: string
    displayName: string
    description: string | null
    method: string
    endpointUrl: string
    inputSchema: unknown
    outputSchema: unknown
    requiredScopes: string[]
    rateLimitRpm: number
  }>
}

/**
 * Normalizes an action slug: lowercase, underscores or hyphens only.
 */
export function normalizeActionSlug(rawSlug: string): string {
  return rawSlug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
}

/**
 * Creates a new Action Schema for a registered site.
 */
export async function createActionSchema(
  db: DbClient,
  params: CreateActionSchemaParams
): Promise<ActionSchema> {
  const actionSlug = normalizeActionSlug(params.actionSlug)

  // Verify site exists
  const [site] = await db
    .select()
    .from(registeredSites)
    .where(eq(registeredSites.id, params.siteId))
    .limit(1)

  if (!site) {
    throw new Error(`Site with id "${params.siteId}" does not exist`)
  }

  // Check slug uniqueness per site
  const [existing] = await db
    .select()
    .from(actionSchemas)
    .where(
      and(
        eq(actionSchemas.siteId, params.siteId),
        eq(actionSchemas.actionSlug, actionSlug)
      )
    )
    .limit(1)

  if (existing) {
    throw new Error(`Action slug "${actionSlug}" already exists for site ${site.domain}`)
  }

  const [inserted] = await db
    .insert(actionSchemas)
    .values({
      siteId: params.siteId,
      actionSlug,
      displayName: params.displayName,
      description: params.description || null,
      method: (params.method || 'POST').toUpperCase(),
      endpointPath: params.endpointPath,
      inputSchema: params.inputSchema,
      outputSchema: params.outputSchema || null,
      requiredScopes: params.requiredScopes || [],
      rateLimit: params.rateLimit ?? 60,
      enabled: params.enabled ?? true,
    })
    .returning()

  return inserted
}

/**
 * Retrieves an Action Schema by ID.
 */
export async function getActionSchemaById(
  db: DbClient,
  id: string
): Promise<ActionSchema | null> {
  const [found] = await db
    .select()
    .from(actionSchemas)
    .where(eq(actionSchemas.id, id))
    .limit(1)

  return found || null
}

/**
 * Retrieves an Action Schema by Site ID and slug.
 */
export async function getActionSchemaBySlug(
  db: DbClient,
  siteId: string,
  rawSlug: string
): Promise<ActionSchema | null> {
  const actionSlug = normalizeActionSlug(rawSlug)

  const [found] = await db
    .select()
    .from(actionSchemas)
    .where(
      and(
        eq(actionSchemas.siteId, siteId),
        eq(actionSchemas.actionSlug, actionSlug)
      )
    )
    .limit(1)

  return found || null
}

/**
 * Lists all Action Schemas for a site.
 */
export async function listActionSchemas(
  db: DbClient,
  siteId: string,
  onlyEnabled = false
): Promise<ActionSchema[]> {
  const conditions = [eq(actionSchemas.siteId, siteId)]
  if (onlyEnabled) {
    conditions.push(eq(actionSchemas.enabled, true))
  }

  return db
    .select()
    .from(actionSchemas)
    .where(and(...conditions))
    .orderBy(desc(actionSchemas.createdAt))
}

/**
 * Updates an Action Schema.
 */
export async function updateActionSchema(
  db: DbClient,
  id: string,
  params: UpdateActionSchemaParams
): Promise<ActionSchema> {
  const existing = await getActionSchemaById(db, id)
  if (!existing) {
    throw new Error(`Action Schema "${id}" not found`)
  }

  const updates: Partial<NewActionSchema> = {
    updatedAt: new Date(),
  }

  if (params.displayName !== undefined) updates.displayName = params.displayName
  if (params.description !== undefined) updates.description = params.description || null
  if (params.method !== undefined) updates.method = params.method.toUpperCase()
  if (params.endpointPath !== undefined) updates.endpointPath = params.endpointPath
  if (params.inputSchema !== undefined) updates.inputSchema = params.inputSchema
  if (params.outputSchema !== undefined) updates.outputSchema = params.outputSchema || null
  if (params.requiredScopes !== undefined) updates.requiredScopes = params.requiredScopes
  if (params.rateLimit !== undefined) updates.rateLimit = params.rateLimit
  if (params.enabled !== undefined) updates.enabled = params.enabled

  const [updated] = await db
    .update(actionSchemas)
    .set(updates)
    .where(eq(actionSchemas.id, id))
    .returning()

  return updated
}

/**
 * Deletes an Action Schema.
 */
export async function deleteActionSchema(
  db: DbClient,
  id: string
): Promise<boolean> {
  const deleted = await db
    .delete(actionSchemas)
    .where(eq(actionSchemas.id, id))
    .returning()

  return deleted.length > 0
}

/**
 * Generates the standardized agent manifest (.well-known/agent.json) for a site.
 */
export async function generateAgentManifest(
  db: DbClient,
  siteId: string,
  baseUrl = 'https://api.stealthmark.io'
): Promise<AgentManifest> {
  const [site] = await db
    .select()
    .from(registeredSites)
    .where(eq(registeredSites.id, siteId))
    .limit(1)

  if (!site) {
    throw new Error(`Site with id "${siteId}" not found`)
  }

  const actions = await listActionSchemas(db, siteId, true)

  const rootEndpoint = site.endpointUrl
    ? site.endpointUrl.replace(/\/$/, '')
    : `https://${site.domain}`

  return {
    manifestVersion: '1.0.0',
    site: {
      id: site.id,
      domain: site.domain,
      displayName: site.displayName,
      description: site.description,
      accessPolicy: site.accessPolicy,
    },
    gateway: {
      auth: 'stealthmark_passport',
      passportTtlSeconds: site.passportTtlSeconds,
      maxRpm: site.maxRpm,
      verificationEndpoint: `${baseUrl}/v1/gateway/tokens/verify`,
      jwksUri: `${baseUrl}/v1/gateway/.well-known/jwks.json`,
    },
    actions: actions.map((a) => {
      const path = a.endpointPath.startsWith('/') ? a.endpointPath : `/${a.endpointPath}`
      return {
        slug: a.actionSlug,
        displayName: a.displayName,
        description: a.description,
        method: a.method,
        endpointUrl: `${rootEndpoint}${path}`,
        inputSchema: a.inputSchema,
        outputSchema: a.outputSchema,
        requiredScopes: a.requiredScopes,
        rateLimitRpm: a.rateLimit,
      }
    }),
  }
}
