import crypto from 'node:crypto'
import { eq, and, gt, inArray } from 'drizzle-orm'
import {
  agentPassports,
  registeredSites,
  agents,
  capabilities,
  trustScores,
  type AgentPassport,
  type RegisteredSite,
  type Agent,
  type DbClient,
} from '@stealthmark/db'
import { calculateBehavioralScore } from './behavioral-score.js'

export type PassportErrorCode =
  | 'agent_not_found'
  | 'site_not_found'
  | 'site_suspended'
  | 'agent_not_invited'
  | 'trust_insufficient'
  | 'passport_not_found'

/** Expected failure of a passport operation; routes map `code` to a fixed client-facing message. */
export class PassportError extends Error {
  constructor(readonly code: PassportErrorCode, message: string) {
    super(message)
    this.name = 'PassportError'
  }
}

export interface PassportClaims {
  iss: string
  sub: string
  aud: string
  jti: string
  iat: number
  exp: number
  site_id: string
  org_id: string
  agent_name: string
  scopes: string[]
  trust_level: string
  trust_score: number | null
  behavioral_score: number | null
}

export interface IssuePassportParams {
  agentId: string
  siteId?: string
  domain?: string
  scopes?: string[]
  behavioralScore?: number
}

export interface VerifyPassportResult {
  valid: boolean
  payload?: PassportClaims
  error?: string
  site?: RegisteredSite
  isRevoked?: boolean
}

// ═══════════════════════════════════════════
// ED25519 KEY MANAGEMENT & HELPERS
// ═══════════════════════════════════════════

const PASSPORT_KID = 'stealthmark-passport-v1'

export type PassportJwk = crypto.JsonWebKey & { kid: string; use: 'sig'; alg: 'EdDSA' }

export interface PassportKeyPair {
  privateKey: crypto.KeyObject
  publicKey: crypto.KeyObject
  jwk: PassportJwk
}

let cachedKeyPair: PassportKeyPair | null = null

export function base64UrlEncode(data: Buffer | string): string {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  return buf.toString('base64url')
}

export function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url')
}

function buildKeyPair(privateKey: crypto.KeyObject, publicKey: crypto.KeyObject): PassportKeyPair {
  return {
    privateKey,
    publicKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid: PASSPORT_KID, use: 'sig', alg: 'EdDSA' },
  }
}

export function getKeyPair(): PassportKeyPair {
  if (cachedKeyPair) {
    return cachedKeyPair
  }

  const privatePem = process.env.PASSPORT_PRIVATE_KEY
  const publicPem = process.env.PASSPORT_PUBLIC_KEY

  if (privatePem && publicPem) {
    try {
      cachedKeyPair = buildKeyPair(crypto.createPrivateKey(privatePem), crypto.createPublicKey(publicPem))
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`PASSPORT_PRIVATE_KEY / PASSPORT_PUBLIC_KEY are set but could not be parsed as PEM keys: ${reason}`)
    }
    return cachedKeyPair
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PASSPORT_PRIVATE_KEY and PASSPORT_PUBLIC_KEY environment variables are strictly required in production mode. ' +
      'Ephemeral in-memory key generation is disabled in production to prevent cross-instance passport validation failure.'
    )
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  cachedKeyPair = buildKeyPair(privateKey, publicKey)
  return cachedKeyPair
}

export function resetKeyPairForTesting(customPair?: {
  privateKey: crypto.KeyObject
  publicKey: crypto.KeyObject
}): void {
  cachedKeyPair = customPair ? buildKeyPair(customPair.privateKey, customPair.publicKey) : null
}

export function getPublicKeyJwk(): PassportJwk {
  return getKeyPair().jwk
}

export function getJwks(): { keys: PassportJwk[] } {
  return {
    keys: [getPublicKeyJwk()],
  }
}

// ═══════════════════════════════════════════
// JWT SIGNING & LOCAL OFFLINE VERIFICATION
// ═══════════════════════════════════════════

export function signPassportJwt(claims: PassportClaims): string {
  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid: PASSPORT_KID,
  }

  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const payloadB64 = base64UrlEncode(JSON.stringify(claims))
  const dataToSign = Buffer.from(`${headerB64}.${payloadB64}`)

  const signature = crypto.sign(null, dataToSign, getKeyPair().privateKey)
  const signatureB64 = base64UrlEncode(signature)

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

export function verifyPassportLocally(
  token: string,
  customPublicKey?: crypto.KeyObject | crypto.JsonWebKey
): VerifyPassportResult {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid JWT format: must have 3 parts' }
    }

    const [headerB64, payloadB64, signatureB64] = parts

    let header: { alg?: unknown }
    let payload: PassportClaims
    try {
      header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'))
      payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'))
    } catch {
      return { valid: false, error: 'Malformed JWT JSON header or payload' }
    }
    if (typeof header !== 'object' || header === null || typeof payload !== 'object' || payload === null) {
      return { valid: false, error: 'Malformed JWT JSON header or payload' }
    }

    if (header.alg !== 'EdDSA') {
      return { valid: false, error: `Unsupported algorithm: expected EdDSA, got ${header.alg}` }
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    // Check expiration (with 5 seconds skew allowance)
    if (payload.exp && nowSeconds > payload.exp + 5) {
      return { valid: false, payload, error: 'Passport token has expired' }
    }

    // Check issued at (cannot be more than 60 seconds in the future)
    if (payload.iat && payload.iat > nowSeconds + 60) {
      return { valid: false, payload, error: 'Passport token issued in the future' }
    }

    let pubKey: crypto.KeyObject
    if (!customPublicKey) {
      pubKey = getKeyPair().publicKey
    } else if (customPublicKey instanceof crypto.KeyObject) {
      pubKey = customPublicKey
    } else {
      pubKey = crypto.createPublicKey({ key: customPublicKey, format: 'jwk' })
    }

    const dataToVerify = Buffer.from(`${headerB64}.${payloadB64}`)
    const signature = base64UrlDecode(signatureB64)

    const isSignatureValid = crypto.verify(null, dataToVerify, pubKey, signature)
    if (!isSignatureValid) {
      return { valid: false, payload, error: 'Invalid cryptographic signature' }
    }

    return {
      valid: true,
      payload,
    }
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error && err.message ? err.message : 'Passport verification failed' }
  }
}

// ═══════════════════════════════════════════
// DATABASE PASSPORT LIFECYCLE
// ═══════════════════════════════════════════

export async function issuePassport(
  db: DbClient,
  params: IssuePassportParams
): Promise<{ passport: AgentPassport; token: string; claims: PassportClaims }> {
  const { agentId, siteId, domain, scopes = [], behavioralScore } = params

  // 1. Resolve Agent
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent) {
    throw new PassportError('agent_not_found', `Agent not found: ${agentId}`)
  }

  // 2. Resolve Site
  let site: RegisteredSite | undefined
  if (siteId) {
    const [found] = await db.select().from(registeredSites).where(eq(registeredSites.id, siteId)).limit(1)
    site = found
  } else if (domain) {
    const [found] = await db.select().from(registeredSites).where(eq(registeredSites.domain, domain)).limit(1)
    site = found
  }

  if (!site) {
    throw new PassportError('site_not_found', `Site not found: ${siteId || domain}`)
  }

  if (site.status === 'suspended') {
    throw new PassportError('site_suspended', `Site access is suspended: ${site.domain}`)
  }

  // 3. Access Policy Check
  if (site.accessPolicy === 'invite_only') {
    const isAllowed = site.allowedAgentIds && site.allowedAgentIds.includes(agent.id)
    if (!isAllowed) {
      throw new PassportError('agent_not_invited', `Agent ${agent.name} is not on the approved invite list for ${site.domain}`)
    }
  }

  // 4. Resolve Trust Score (dynamically queries trust_scores for agent's organization)
  let trustLevel = agent.status === 'active' ? 'established' : 'new'
  let trustScore = agent.status === 'active' ? 85 : 40

  const orgCapabilities = await db
    .select({ id: capabilities.id })
    .from(capabilities)
    .where(eq(capabilities.orgId, agent.orgId))
    .limit(10)

  if (orgCapabilities.length > 0) {
    const capIds = orgCapabilities.map((c) => c.id)
    const scores = await db
      .select({ score: trustScores.score, scoreLabel: trustScores.scoreLabel })
      .from(trustScores)
      .where(inArray(trustScores.capabilityId, capIds))
      .limit(10)

    const validScores = scores.flatMap((row) => (row.score === null ? [] : [row.score]))
    if (validScores.length > 0) {
      trustScore = Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
      if (trustScore >= 80) trustLevel = 'established'
      else if (trustScore >= 50) trustLevel = 'emerging'
      else trustLevel = 'new'
    }
  }

  if (site.accessPolicy === 'approved' && trustLevel === 'new' && trustScore < 30) {
    throw new PassportError('trust_insufficient', `Agent trust score (${trustScore}) does not meet the minimum requirement for ${site.domain}`)
  }

  // 5. Resolve Behavioral Score
  const effectiveBehavioralScore = behavioralScore !== undefined
    ? behavioralScore
    : (await calculateBehavioralScore(db, agent.id)).score

  // 6. Scopes Resolution
  const grantedScopes = scopes.length > 0
    ? scopes.filter((s) => site!.allowedScopes.length === 0 || site!.allowedScopes.includes(s))
    : site.allowedScopes

  // 7. TTL & Expiration
  const ttlSeconds = Math.max(300, Math.min(86400, site.passportTtlSeconds || 3600))
  const issuedAt = new Date()
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000)
  const passportJti = `sm_pass_${crypto.randomUUID()}`

  // 8. Insert Passport Record
  const [passportRecord] = await db
    .insert(agentPassports)
    .values({
      agentId: agent.id,
      orgId: agent.orgId,
      siteId: site.id,
      passportJti,
      scopesGranted: grantedScopes,
      trustLevel,
      trustScore,
      behavioralScore: effectiveBehavioralScore,
      issuedAt,
      expiresAt,
      revoked: false,
    })
    .returning()

  // 9. Construct Claims and Sign JWT
  const claims: PassportClaims = {
    iss: 'stealthmark.io',
    sub: agent.id,
    aud: site.domain,
    jti: passportJti,
    iat: Math.floor(issuedAt.getTime() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
    site_id: site.id,
    org_id: agent.orgId,
    agent_name: agent.name,
    scopes: grantedScopes,
    trust_level: trustLevel,
    trust_score: trustScore,
    behavioral_score: effectiveBehavioralScore,
  }

  const token = signPassportJwt(claims)

  return {
    passport: passportRecord,
    token,
    claims,
  }
}

export async function revokePassport(
  db: DbClient,
  passportId: string,
  reason = 'Revoked by owner or security policy'
): Promise<AgentPassport> {
  const [revoked] = await db
    .update(agentPassports)
    .set({
      revoked: true,
      revokedReason: reason,
      revokedAt: new Date(),
    })
    .where(eq(agentPassports.id, passportId))
    .returning()

  if (!revoked) {
    throw new PassportError('passport_not_found', `Passport not found: ${passportId}`)
  }

  return revoked
}

export async function getPassportById(
  db: DbClient,
  passportId: string
): Promise<AgentPassport | null> {
  const [record] = await db
    .select()
    .from(agentPassports)
    .where(eq(agentPassports.id, passportId))
    .limit(1)

  return record || null
}

export async function getAgentOrgId(db: DbClient, agentId: string): Promise<string | null> {
  const [agent] = await db
    .select({ orgId: agents.orgId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1)

  return agent?.orgId ?? null
}

export async function getActivePassports(
  db: DbClient,
  agentId?: string,
  siteId?: string,
  orgId?: string
): Promise<AgentPassport[]> {
  const conditions = [
    eq(agentPassports.revoked, false),
    gt(agentPassports.expiresAt, new Date()),
  ]

  if (agentId) {
    conditions.push(eq(agentPassports.agentId, agentId))
  }
  if (siteId) {
    conditions.push(eq(agentPassports.siteId, siteId))
  }
  if (orgId) {
    conditions.push(eq(agentPassports.orgId, orgId))
  }

  return db.select().from(agentPassports).where(and(...conditions))
}

export async function verifyPassportOnline(
  db: DbClient,
  token: string
): Promise<VerifyPassportResult> {
  // First verify crypto & expiry locally
  const localResult = verifyPassportLocally(token)
  if (!localResult.valid || !localResult.payload) {
    return localResult
  }

  const { jti, site_id } = localResult.payload

  // Check database revocation status
  const [record] = await db
    .select()
    .from(agentPassports)
    .where(eq(agentPassports.passportJti, jti))
    .limit(1)

  if (record && record.revoked) {
    return {
      valid: false,
      payload: localResult.payload,
      isRevoked: true,
      error: `Passport has been revoked: ${record.revokedReason || 'no reason provided'}`,
    }
  }

  // Check site status
  const [site] = await db
    .select()
    .from(registeredSites)
    .where(eq(registeredSites.id, site_id))
    .limit(1)

  if (!site || site.status === 'suspended') {
    return {
      valid: false,
      payload: localResult.payload,
      error: site ? 'Target site access is currently suspended' : 'Target site is not registered',
    }
  }

  return {
    valid: true,
    payload: localResult.payload,
    site,
    isRevoked: false,
  }
}
