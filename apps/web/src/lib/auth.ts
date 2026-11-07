/**
 * StealthMark Autonomous Authentication Engine
 * Pure Web Crypto API implementation with zero heavy external dependencies.
 * Next.js 16 & React 19 production-ready.
 */

export interface AuthUser {
  id: string
  orgId: string
  email: string
  name?: string | null
  avatarUrl?: string | null
  provider: 'github' | 'google' | 'email'
  role: string
  createdAt?: string
}

export interface SessionPayload {
  user: AuthUser
  exp: number // Expiration timestamp in ms
}

export const SESSION_COOKIE_NAME = 'stealthmark_session'
export const OTP_COOKIE_NAME = 'stealthmark_otp_challenge'
export const OAUTH_STATE_COOKIE_NAME = 'stealthmark_oauth_state'

/** Development fallbacks never apply in production: a missing or default secret must fail closed, not open a forgeable session. */
function requiredSecret(name: string, value: string | undefined, developmentFallback: string): string {
  const production = process.env.NODE_ENV === 'production'
  if (value && value.length >= 32 && !(production && value === developmentFallback)) return value
  if (production) {
    throw new Error(`${name} must be set to a non-default value of at least 32 characters in production`)
  }
  return developmentFallback
}

/** Resolved lazily so the Next.js build can collect route metadata without production secrets present. */
const authSecret = () => requiredSecret('AUTH_SECRET', process.env.AUTH_SECRET, 'dev_stealthmark_session_secret_key_32bytes_min')
export const internalAuthSecret = () => requiredSecret('INTERNAL_AUTH_SECRET', process.env.INTERNAL_AUTH_SECRET, 'dev_internal_auth_secret_key_12345')
export const gatewayInternalSecret = () => requiredSecret('GATEWAY_INTERNAL_SECRET', process.env.GATEWAY_INTERNAL_SECRET, 'dev_gateway_internal_secret_key_12345')
export const API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// ── Base64URL Helpers ────────────────────────────────────────────────────────

export function base64UrlEncode(buffer: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array
  if (typeof buffer === 'string') {
    bytes = new TextEncoder().encode(buffer)
  } else if (buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(buffer)
  } else {
    bytes = buffer
  }

  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

// ── HMAC-SHA256 Signing & Verification ──────────────────────────────────────

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signData(data: string, secret = authSecret()): Promise<string> {
  const key = await getHmacKey(secret)
  const enc = new TextEncoder()
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return base64UrlEncode(signature)
}

export async function verifySignature(
  data: string,
  signature: string,
  secret = authSecret()
): Promise<boolean> {
  try {
    const key = await getHmacKey(secret)
    const enc = new TextEncoder()
    const sigBytes = (() => {
      let b64 = signature.replace(/-/g, '+').replace(/_/g, '/')
      while (b64.length % 4) b64 += '='
      const bin = atob(b64)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      return arr
    })()

    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data))
  } catch {
    return false
  }
}

// ── Session Token Management ────────────────────────────────────────────────

export async function createSessionToken(
  user: AuthUser,
  expiresInMs = 7 * 24 * 60 * 60 * 1000 // 7 days default
): Promise<string> {
  const payload: SessionPayload = {
    user,
    exp: Date.now() + expiresInMs,
  }
  const payloadStr = JSON.stringify(payload)
  const encodedPayload = base64UrlEncode(payloadStr)
  const signature = await signData(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  if (!token || !token.includes('.')) return null

  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return null

  const isValid = await verifySignature(encodedPayload, signature)
  if (!isValid) return null

  try {
    const payloadStr = base64UrlDecode(encodedPayload)
    const payload: SessionPayload = JSON.parse(payloadStr)

    if (payload.exp && Date.now() > payload.exp) {
      return null // Expired
    }

    return payload
  } catch {
    return null
  }
}

// ── Email OTP ────────────────────────────────────────────────────────────────
// Challenges live server-side (see lib/otp.ts): attempts, expiry and single use are enforced by the store,
// never by anything the client holds.

/** HMAC of a code, bound to the email and to AUTH_SECRET. The code itself is never stored. */
export async function hashOtpCode(email: string, code: string): Promise<string> {
  return signData(`otp:${email.toLowerCase().trim()}:${code.trim()}`)
}

export function generate6DigitOtp(): string {
  const array = new Uint8Array(3)
  crypto.getRandomValues(array)
  const num = ((array[0] << 16) | (array[1] << 8) | array[2]) % 1000000
  return num.toString().padStart(6, '0')
}

// ── Backend Fastify Delegation (Opción A) ───────────────────────────────────

/** Organization id synthesized for local development when the API is not running. Never valid in production. */
export const LOCAL_FALLBACK_ORG_ID = '00000000-0000-0000-0000-000000000001'

/** The API scales to zero on Cloud Run; a cold start takes about 7 s, so one short attempt is not enough. */
export const PROVISIONING_TIMEOUT_MS = 15_000
const PROVISIONING_ATTEMPTS = 2

/** Calls the API provisioning route, retrying once when the request never got an answer (cold start, network). */
async function fetchProvisioning(params: object): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= PROVISIONING_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(`${API_URL}/internal/auth/upsert-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': internalAuthSecret(),
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(PROVISIONING_TIMEOUT_MS),
      })
    } catch (err) {
      lastError = err
      console.warn(`[Auth Engine] Provisioning attempt ${attempt} of ${PROVISIONING_ATTEMPTS} got no answer:`, err)
    }
  }
  throw lastError
}

export interface ProvisionedOrganization {
  id: string
  name: string
  plan: string
}

export async function upsertUserInBackend(params: {
  email: string
  name?: string | null
  avatarUrl?: string | null
  provider: 'github' | 'google' | 'email'
  externalId?: string | null
}): Promise<{ user: AuthUser; organization: ProvisionedOrganization }> {
  try {
    const res = await fetchProvisioning(params)

    if (res.ok) {
      const data = await res.json()
      return {
        user: {
          id: data.user.id,
          orgId: data.user.orgId,
          email: data.user.email,
          name: data.user.name,
          avatarUrl: data.user.avatarUrl,
          provider: data.user.provider || params.provider,
          role: data.user.role || 'owner',
        },
        organization: data.organization,
      }
    }
    console.error(`[Auth Engine] Account provisioning answered ${res.status} from ${API_URL}`)
  } catch (err) {
    console.error(`[Auth Engine] Account provisioning unreachable at ${API_URL}:`, err)
  }

  // A synthesized organization does not exist in the database: every key, quota and usage
  // query would fail for that session. Production must refuse the login instead.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('account_provisioning_failed')
  }

  // Fallback for isolated dev / test environments without active PostgreSQL
  const fallbackOrgId = LOCAL_FALLBACK_ORG_ID
  const fallbackUserId = crypto.randomUUID()
  return {
    user: {
      id: fallbackUserId,
      orgId: fallbackOrgId,
      email: params.email.toLowerCase().trim(),
      name: params.name || params.email.split('@')[0],
      avatarUrl: params.avatarUrl || null,
      provider: params.provider,
      role: 'owner',
    },
    organization: {
      id: fallbackOrgId,
      name: `${params.name || params.email.split('@')[0]}'s Workspace`,
      plan: 'free',
    },
  }
}

// ── OAuth Configuration & Helpers ───────────────────────────────────────────

const TRUSTED_APP_HOST_RE =
  /^(?:(?:www\.)?stealthmark\.io|[a-z0-9-]+\.vercel\.app|[a-z0-9-]+-[a-z0-9]+-uc\.a\.run\.app|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)$/i

function isTrustedAppHost(host: string): boolean {
  const clean = host.trim().toLowerCase()
  if (!clean || clean.includes('localhost:8080') || clean.includes('0.0.0.0')) return false
  return TRUSTED_APP_HOST_RE.test(clean)
}

export function getAppUrl(request?: Request | string): string {
  // 1. Explicit environment variable configured in Cloud Run / Vercel takes precedence
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      const parsed = new URL(process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ''))
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && isTrustedAppHost(parsed.host)) {
        return `${parsed.protocol}//${parsed.host}`
      }
    } catch {
      // Fallback
    }
  }

  // 2. Check reverse-proxy forwarded headers only against the strict host allowlist
  if (request && typeof request === 'object' && 'headers' in request) {
    const rawHost = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(',')[0].trim()
    const rawProto = (request.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim().toLowerCase()
    const proto = rawProto === 'http' ? 'http' : 'https'
    if (isTrustedAppHost(rawHost)) {
      return `${proto}://${rawHost}`
    }
  }

  // 3. String URL parsing fallback (validated against allowlist)
  if (typeof request === 'string') {
    try {
      const url = new URL(request)
      if ((url.protocol === 'https:' || url.protocol === 'http:') && isTrustedAppHost(url.host)) {
        return `${url.protocol}//${url.host}`
      }
    } catch {
      // Fallback
    }
  }

  // 4. Default fallback: Canonical production URL or localhost:3000 in dev
  return process.env.NODE_ENV === 'production'
    ? 'https://stealthmark.io'
    : 'http://localhost:3000'
}

export function isGitHubConfigured(): boolean {
  return !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET
}

export function isGoogleConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
}
