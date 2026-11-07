/**
 * Accounts are matched by email, so a login may only carry an address the identity provider has verified.
 * Anything else would let a provider account claiming someone else's address land in that person's organization.
 */

/** A failure of a sign-in flow whose code is safe to show on the login page. */
export class AuthFlowError extends Error {
  constructor(readonly code: 'no_email' | 'email_not_verified') {
    super(code)
    this.name = 'AuthFlowError'
  }
}

/** Code to place in /login?error=: our own codes pass through, everything else is reported generically. */
export function loginErrorCode(err: unknown): string {
  return err instanceof AuthFlowError ? err.code : 'auth_failed'
}

interface GithubEmailEntry {
  email: string
  primary: boolean
  verified: boolean
}

function isGithubEmailEntry(value: unknown): value is GithubEmailEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.email === 'string' && typeof entry.primary === 'boolean' && typeof entry.verified === 'boolean'
}

/** The primary address GitHub marks as verified, never an unverified or non-primary one. */
export function pickVerifiedGithubEmail(emails: unknown): string | null {
  if (!Array.isArray(emails)) return null
  const primary = emails.filter(isGithubEmailEntry).find((entry) => entry.primary && entry.verified)
  return primary ? primary.email : null
}

interface SupabaseIdentity {
  email?: string | null
  email_confirmed_at?: string | null
}

/** The Supabase user's address, only when Supabase has confirmed it. */
export function verifiedSupabaseEmail(user: SupabaseIdentity): string | null {
  return user.email && user.email_confirmed_at ? user.email : null
}
