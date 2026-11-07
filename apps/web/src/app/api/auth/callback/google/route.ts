import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  createSessionToken,
  upsertUserInBackend,
  getAppUrl,
  SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
} from '@/lib/auth'
import { AuthFlowError, loginErrorCode } from '@/lib/verified-email'

export async function GET(request: Request) {
  const appUrl = getAppUrl(request)
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code) {
    console.error('[Google OAuth Error]:', error || 'Missing authorization code')
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error || 'oauth_cancelled')}`, appUrl))
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value
  cookieStore.delete(OAUTH_STATE_COOKIE_NAME)

  if (!storedState || storedState !== state) {
    console.error('[Google OAuth CSRF Error]: State mismatch')
    return NextResponse.redirect(new URL('/login?error=csrf_validation_failed', appUrl))
  }

  const redirectUri = `${appUrl}/api/auth/callback/google`

  try {
    // 1. Exchange authorization code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to obtain Google access token')
    }

    // 2. Fetch Google user profile
    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    })
    const googleUser = await userRes.json()

    if (!googleUser.email) {
      throw new AuthFlowError('no_email')
    }
    if (googleUser.email_verified !== true) {
      throw new AuthFlowError('email_not_verified')
    }

    // 3. Upsert user and auto-provision organization via Fastify backend (Opción A)
    const { user } = await upsertUserInBackend({
      email: googleUser.email,
      name: googleUser.name || googleUser.email.split('@')[0],
      avatarUrl: googleUser.picture,
      provider: 'google',
      externalId: googleUser.sub,
    })

    // 4. Issue cryptographic session cookie
    const sessionToken = await createSessionToken(user)
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    return NextResponse.redirect(new URL('/console?auth=success&provider=google', appUrl))
  } catch (err) {
    console.error('[Google Callback Exception]:', err)
    return NextResponse.redirect(new URL(`/login?error=${loginErrorCode(err)}`, appUrl))
  }
}
