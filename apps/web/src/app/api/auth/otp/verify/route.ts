import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSessionToken, upsertUserInBackend, OTP_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/lib/auth'
import { OTP_MAX_ATTEMPTS, normalizeOtpEmail, verifyOtp } from '@/lib/otp'
import { getOtpStore } from '@/lib/otp-store'
import { readBodyText } from '@/lib/request-body'

const CODE_PATTERN = /^\d{6}$/
const MAX_BODY_BYTES = 4 * 1024

function failure(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status })
}

export async function POST(request: Request) {
  try {
    const raw = await readBodyText(request, MAX_BODY_BYTES)
    if (raw === null) return failure(413, 'The request body is too large.')
    let body: { email?: unknown; code?: unknown }
    try {
      body = JSON.parse(raw)
    } catch {
      return failure(400, 'Both email and 6-digit code are required.')
    }
    const { email, code } = body

    if (typeof email !== 'string' || typeof code !== 'string' || !email || !code) {
      return failure(400, 'Both email and 6-digit code are required.')
    }
    const candidate = code.trim()
    if (!CODE_PATTERN.test(candidate)) return failure(400, 'The code has 6 digits.')

    const store = getOtpStore()
    if (!store) return failure(503, 'Email sign-in is temporarily unavailable. Use GitHub or Google instead.')

    const normalizedEmail = normalizeOtpEmail(email)
    const result = await verifyOtp(store, normalizedEmail, candidate)
    if (!result.ok) {
      switch (result.reason) {
        case 'none':
          return failure(400, 'No active code for this email, or it expired. Request a new one.')
        case 'locked':
          return failure(429, `Too many incorrect attempts (${OTP_MAX_ATTEMPTS} allowed). Request a new code.`)
        case 'invalid':
          return failure(400, `Incorrect code. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} remaining.`)
        default:
          return failure(503, 'Email sign-in is temporarily unavailable. Use GitHub or Google instead.')
      }
    }

    const { user } = await upsertUserInBackend({ email: normalizedEmail, provider: 'email' })

    const cookieStore = await cookies()
    cookieStore.delete(OTP_COOKIE_NAME)
    const sessionToken = await createSessionToken(user)
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    })

    return NextResponse.json({
      success: true,
      user,
      message: 'Authentication successful',
    })
  } catch (error) {
    console.error('[OTP Verify Error]:', error)
    return failure(500, 'An unexpected error occurred during verification.')
  }
}
