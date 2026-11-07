import { parseEmailOtpType } from '@/lib/email-otp-type'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  getAppUrl,
  createSessionToken,
  upsertUserInBackend,
  SESSION_COOKIE_NAME,
} from '@/lib/auth'
import { AuthFlowError, loginErrorCode, verifiedSupabaseEmail } from '@/lib/verified-email'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = parseEmailOtpType(requestUrl.searchParams.get('type'))
  const appUrl = getAppUrl(request)

  // If no server-side query params exist, it is likely a client-side hash fragment (#access_token=...)
  // Forward to /auth/callback so the browser can parse the hash fragment and sync session.
  if (!code && !tokenHash) {
    return NextResponse.redirect(new URL('/auth/callback', appUrl))
  }

  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) {
      return NextResponse.redirect(new URL('/login?error=supabase_not_configured', appUrl))
    }

    let sbUser = null

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (error || !data.session?.user) {
        console.error('[Supabase Auth Callback] Exchange error:', error)
        return NextResponse.redirect(new URL('/login?error=exchange_failed', appUrl))
      }
      sbUser = data.session.user
    } else if (tokenHash && type) {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      if (error || !data.session?.user) {
        console.error('[Supabase Auth Callback] OTP Verify error:', error)
        return NextResponse.redirect(new URL('/login?error=otp_verification_failed', appUrl))
      }
      sbUser = data.session.user
    }

    if (!sbUser) {
      return NextResponse.redirect(new URL('/login?error=no_user_retrieved', appUrl))
    }

    const email = verifiedSupabaseEmail(sbUser)
    if (!email) {
      throw new AuthFlowError('email_not_verified')
    }
    const name =
      sbUser.user_metadata?.full_name ||
      sbUser.user_metadata?.name ||
      email.split('@')[0] ||
      'User'
    const avatarUrl =
      sbUser.user_metadata?.avatar_url || sbUser.user_metadata?.picture || null

    const rawProvider = sbUser.app_metadata?.provider || 'supabase'
    const provider: 'github' | 'google' | 'email' =
      rawProvider === 'github'
        ? 'github'
        : rawProvider === 'google'
        ? 'google'
        : 'email'

    // Upsert user and sync organization via Fastify backend (Opción A)
    const { user } = await upsertUserInBackend({
      email,
      name,
      avatarUrl,
      provider,
      externalId: sbUser.id,
    })

    // Issue cryptographic session cookie
    const cookieStore = await cookies()
    const sessionToken = await createSessionToken(user)
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    return NextResponse.redirect(
      new URL(`/console?auth=success&provider=${provider}`, appUrl)
    )
  } catch (err) {
    console.error('[Supabase Auth Callback] Fatal error:', err)
    return NextResponse.redirect(new URL(`/login?error=${loginErrorCode(err)}`, appUrl))
  }
}
