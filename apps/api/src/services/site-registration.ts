import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import { eq, and, desc, lt } from 'drizzle-orm'
import {
  registeredSites,
  type RegisteredSite,
  type NewRegisteredSite,
  type DbClient,
} from '@stealthmark/db'

export type SiteRegistrationErrorCode = 'invalid_domain' | 'domain_taken' | 'site_not_found'

/** Expected failure of a site-registration operation; routes map `code` to a fixed client-facing message. */
export class SiteRegistrationError extends Error {
  constructor(readonly code: SiteRegistrationErrorCode, message: string) {
    super(message)
    this.name = 'SiteRegistrationError'
  }
}

export interface RegisterSiteParams {
  orgId: string
  domain: string
  displayName: string
  description?: string
  endpointUrl?: string
  accessPolicy?: 'open' | 'approved' | 'invite_only'
  allowedScopes?: string[]
  allowedAgentIds?: string[]
  maxRpm?: number
  passportTtlSeconds?: number
}

export interface UpdateSitePolicyParams {
  displayName?: string
  description?: string
  endpointUrl?: string
  accessPolicy?: 'open' | 'approved' | 'invite_only'
  allowedScopes?: string[]
  allowedAgentIds?: string[]
  maxRpm?: number
  passportTtlSeconds?: number
  status?: 'pending' | 'active' | 'suspended'
}

export interface DnsVerificationInstruction {
  recordType: 'TXT'
  host: string
  value: string
  instructions: string
}

export interface VerifyDnsResult {
  verified: boolean
  site: RegisteredSite
  error?: string
  expectedHost?: string
  expectedValue?: string
}

/** Resolves a TXT record set the way `dns.resolveTxt` does: one string[] per record, split in 255-byte chunks. */
export type TxtResolver = (host: string) => Promise<string[][]>

export interface VerifySiteDnsOptions {
  resolveTxt?: TxtResolver
}

function describeDnsFailure(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
    return err.code
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * Normalizes a domain string: removes http(s)://, paths, ports and forces lowercase.
 */
export function normalizeDomain(rawDomain: string): string {
  let domain = rawDomain.trim().toLowerCase()

  // Strip protocol
  domain = domain.replace(/^https?:\/\//, '')
  // Strip trailing slashes and paths
  domain = domain.split('/')[0]
  // Strip ports unless localhost
  if (!domain.startsWith('localhost:')) {
    domain = domain.split(':')[0]
  }

  // Basic validation
  if (!domain || domain.length < 3) {
    throw new SiteRegistrationError('invalid_domain', `Invalid domain name: "${rawDomain}"`)
  }

  return domain
}

/**
 * Registers a new site for agentic access and generates a DNS TXT verification token.
 */
export async function registerSite(
  db: DbClient,
  params: RegisterSiteParams
): Promise<{ site: RegisteredSite; verification: DnsVerificationInstruction }> {
  const domain = normalizeDomain(params.domain)

  // Check if domain already exists
  const [existing] = await db
    .select()
    .from(registeredSites)
    .where(eq(registeredSites.domain, domain))
    .limit(1)

  if (existing) {
    throw new SiteRegistrationError('domain_taken', `Domain "${domain}" is already registered`)
  }

  const dnsVerificationToken = `sm-verify-${crypto.randomBytes(16).toString('hex')}`
  const expectedHost = `_stealthmark-verify.${domain}`

  const [site] = await db
    .insert(registeredSites)
    .values({
      orgId: params.orgId,
      domain,
      displayName: params.displayName,
      description: params.description || null,
      endpointUrl: params.endpointUrl || null,
      dnsVerified: false,
      dnsVerificationToken,
      accessPolicy: params.accessPolicy || 'open',
      allowedScopes: params.allowedScopes || [],
      allowedAgentIds: params.allowedAgentIds || [],
      maxRpm: params.maxRpm !== undefined ? Math.max(1, params.maxRpm) : 100,
      passportTtlSeconds: params.passportTtlSeconds !== undefined
        ? Math.max(300, Math.min(86400, params.passportTtlSeconds))
        : 3600,
      status: 'pending',
    })
    .returning()

  const verification: DnsVerificationInstruction = {
    recordType: 'TXT',
    host: expectedHost,
    value: dnsVerificationToken,
    instructions: `Add a DNS TXT record to your domain DNS settings: Name: "${expectedHost}", Value: "${dnsVerificationToken}"`,
  }

  return {
    site,
    verification,
  }
}

/**
 * Verifies the DNS TXT record for a registered site.
 * `SKIP_DNS_VERIFICATION=true` (local development only, refused by the production config) skips the lookup.
 */
export async function verifySiteDns(
  db: DbClient,
  siteId: string,
  options: VerifySiteDnsOptions = {}
): Promise<VerifyDnsResult> {
  const [site] = await db
    .select()
    .from(registeredSites)
    .where(eq(registeredSites.id, siteId))
    .limit(1)

  if (!site) {
    throw new SiteRegistrationError('site_not_found', `Site not found: ${siteId}`)
  }

  if (site.dnsVerified && site.status === 'active') {
    return { verified: true, site }
  }

  const expectedHost = `_stealthmark-verify.${site.domain}`
  const expectedValue = site.dnsVerificationToken || ''

  const skipLookup = process.env.NODE_ENV !== 'production' && process.env.SKIP_DNS_VERIFICATION === 'true'
  let isMatch = skipLookup

  if (!skipLookup) {
    const resolveTxt = options.resolveTxt ?? dns.resolveTxt
    try {
      const records = await resolveTxt(expectedHost)
      const flatValues = records.map((chunk) => chunk.join(''))
      isMatch = flatValues.some((v) => v.trim() === expectedValue.trim())
    } catch (err: unknown) {
      return {
        verified: false,
        site,
        error: `DNS lookup failed for ${expectedHost}: ${describeDnsFailure(err)}`,
        expectedHost,
        expectedValue,
      }
    }
  }

  if (!isMatch) {
    return {
      verified: false,
      site,
      error: `TXT record at ${expectedHost} does not match verification token`,
      expectedHost,
      expectedValue,
    }
  }

  const [updatedSite] = await db
    .update(registeredSites)
    .set({
      dnsVerified: true,
      status: 'active',
      verifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(registeredSites.id, siteId))
    .returning()

  return {
    verified: true,
    site: updatedSite,
  }
}

/**
 * Updates site access policy and settings.
 */
export async function updateSitePolicy(
  db: DbClient,
  siteId: string,
  params: UpdateSitePolicyParams
): Promise<RegisteredSite> {
  const updateData: Partial<NewRegisteredSite> = {
    updatedAt: new Date(),
  }

  if (params.displayName !== undefined) updateData.displayName = params.displayName
  if (params.description !== undefined) updateData.description = params.description
  if (params.endpointUrl !== undefined) updateData.endpointUrl = params.endpointUrl
  if (params.accessPolicy !== undefined) updateData.accessPolicy = params.accessPolicy
  if (params.allowedScopes !== undefined) updateData.allowedScopes = params.allowedScopes
  if (params.allowedAgentIds !== undefined) updateData.allowedAgentIds = params.allowedAgentIds
  if (params.maxRpm !== undefined) updateData.maxRpm = Math.max(1, params.maxRpm)
  if (params.passportTtlSeconds !== undefined) {
    updateData.passportTtlSeconds = Math.max(300, Math.min(86400, params.passportTtlSeconds))
  }
  if (params.status !== undefined) updateData.status = params.status

  const [updated] = await db
    .update(registeredSites)
    .set(updateData)
    .where(eq(registeredSites.id, siteId))
    .returning()

  if (!updated) {
    throw new SiteRegistrationError('site_not_found', `Site not found: ${siteId}`)
  }

  return updated
}

export async function getSiteById(
  db: DbClient,
  siteId: string
): Promise<RegisteredSite | null> {
  const [site] = await db
    .select()
    .from(registeredSites)
    .where(eq(registeredSites.id, siteId))
    .limit(1)

  return site || null
}

export async function getSiteByDomain(
  db: DbClient,
  domain: string
): Promise<RegisteredSite | null> {
  const normalized = normalizeDomain(domain)
  const [site] = await db
    .select()
    .from(registeredSites)
    .where(eq(registeredSites.domain, normalized))
    .limit(1)

  return site || null
}

function createdBefore(cursor: string | undefined) {
  if (!cursor) return undefined
  const cursorDate = new Date(cursor)
  return isNaN(cursorDate.getTime()) ? undefined : lt(registeredSites.createdAt, cursorDate)
}

export async function listSitesByOrg(
  db: DbClient,
  orgId: string,
  options?: { limit?: number; cursor?: string }
): Promise<RegisteredSite[]> {
  const limit = options?.limit || 50

  return db
    .select()
    .from(registeredSites)
    .where(and(eq(registeredSites.orgId, orgId), createdBefore(options?.cursor)))
    .orderBy(desc(registeredSites.createdAt))
    .limit(limit)
}

export async function listAllSites(
  db: DbClient,
  filters?: { status?: string; limit?: number; cursor?: string }
): Promise<RegisteredSite[]> {
  const limit = filters?.limit || 50

  return db
    .select()
    .from(registeredSites)
    .where(and(
      filters?.status ? eq(registeredSites.status, filters.status) : undefined,
      createdBefore(filters?.cursor)
    ))
    .orderBy(desc(registeredSites.createdAt))
    .limit(limit)
}

export async function suspendSite(
  db: DbClient,
  siteId: string,
  reason?: string
): Promise<RegisteredSite> {
  const [site] = await db
    .update(registeredSites)
    .set({
      status: 'suspended',
      updatedAt: new Date(),
    })
    .where(eq(registeredSites.id, siteId))
    .returning()

  if (!site) {
    throw new SiteRegistrationError('site_not_found', `Site not found: ${siteId}`)
  }

  return site
}

export async function deleteSite(
  db: DbClient,
  siteId: string
): Promise<boolean> {
  const result = await db
    .delete(registeredSites)
    .where(eq(registeredSites.id, siteId))
    .returning({ id: registeredSites.id })

  return result.length > 0
}
