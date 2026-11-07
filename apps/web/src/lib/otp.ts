import { generate6DigitOtp, hashOtpCode } from '@/lib/auth'
import type { OtpStore } from '@/lib/otp-store'

export const OTP_TTL_MS = 5 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_SENDS_PER_EMAIL_PER_HOUR = 5
export const OTP_SENDS_PER_IP_PER_HOUR = 20
export const OTP_COOLDOWN_SECONDS = 60
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

export type OtpIssueResult =
  | { ok: true; code: string; challengeId: string }
  | { ok: false; reason: 'cooldown' | 'email_limit' | 'ip_limit' | 'unavailable' }

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'none' | 'locked' | 'invalid' | 'unavailable'; attemptsLeft: number }

export const normalizeOtpEmail = (email: string) => email.toLowerCase().trim()

/** Constant-time comparison of two equally encoded hashes. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Creates a fresh code for the email. Sends are limited per email (one per minute, enforced by the store, and
 * OTP_SENDS_PER_EMAIL_PER_HOUR per hour) and per requesting address, and the newest code replaces every older one.
 */
export async function issueOtp(store: OtpStore, email: string, ip: string | null, now = Date.now()): Promise<OtpIssueResult> {
  const normalized = normalizeOtpEmail(email)
  try {
    const since = now - HOUR_MS
    if ((await store.countSince({ email: normalized }, since)) >= OTP_SENDS_PER_EMAIL_PER_HOUR) {
      return { ok: false, reason: 'email_limit' }
    }
    if (ip && (await store.countSince({ ip }, since)) >= OTP_SENDS_PER_IP_PER_HOUR) {
      return { ok: false, reason: 'ip_limit' }
    }

    const code = generate6DigitOtp()
    const inserted = await store.insert({
      email: normalized,
      codeHash: await hashOtpCode(normalized, code),
      requestedIp: ip,
      windowStart: Math.floor(now / MINUTE_MS),
      expiresAt: now + OTP_TTL_MS,
    })
    if (inserted === 'duplicate_window') return { ok: false, reason: 'cooldown' }

    await store.invalidateOthers(normalized, inserted.id, now)
    return { ok: true, code, challengeId: inserted.id }
  } catch (err) {
    console.error('[OTP] issue failed:', err)
    return { ok: false, reason: 'unavailable' }
  }
}

/** Frees the minute slot of a code that could not be delivered, so the user can ask again at once. */
export async function discardOtp(store: OtpStore, challengeId: string): Promise<void> {
  try {
    await store.remove(challengeId)
  } catch (err) {
    console.error('[OTP] discard failed:', err)
  }
}

/**
 * Checks one candidate. Each call spends one of OTP_MAX_ATTEMPTS on the newest active challenge through a
 * compare-and-set, so replaying requests, running them in parallel or never adopting a cookie cannot buy extra guesses,
 * and a code that succeeded or was replaced is gone for good.
 */
export async function verifyOtp(store: OtpStore, email: string, candidate: string, now = Date.now()): Promise<OtpVerifyResult> {
  const normalized = normalizeOtpEmail(email)
  try {
    const challenge = await store.latestActive(normalized, now)
    if (!challenge) return { ok: false, reason: 'none', attemptsLeft: 0 }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'locked', attemptsLeft: 0 }

    const claimed = await store.claimAttempt(challenge.id, challenge.attempts)
    const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - (challenge.attempts + 1))
    if (!claimed) return { ok: false, reason: 'invalid', attemptsLeft }

    const matches = sameHash(await hashOtpCode(normalized, candidate), challenge.codeHash)
    if (!matches) return { ok: false, reason: attemptsLeft === 0 ? 'locked' : 'invalid', attemptsLeft }

    const consumed = await store.consume(challenge.id, now)
    return consumed ? { ok: true } : { ok: false, reason: 'none', attemptsLeft: 0 }
  } catch (err) {
    console.error('[OTP] verify failed:', err)
    return { ok: false, reason: 'unavailable', attemptsLeft: 0 }
  }
}
