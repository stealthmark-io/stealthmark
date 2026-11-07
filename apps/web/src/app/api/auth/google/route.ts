import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  isGoogleConfigured,
  getAppUrl,
  OAUTH_STATE_COOKIE_NAME,
} from '@/lib/auth'

export async function GET(request: Request) {
  const appUrl = getAppUrl(request.url)

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL('/login?error=oauth_not_configured', appUrl))
  }

  const cookieStore = await cookies()

  const state = crypto.randomUUID()
  cookieStore.set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  })

  const redirectUri = `${appUrl}/api/auth/callback/google`
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!)
  googleAuthUrl.searchParams.set('redirect_uri', redirectUri)
  googleAuthUrl.searchParams.set('response_type', 'code')
  googleAuthUrl.searchParams.set('scope', 'openid profile email')
  googleAuthUrl.searchParams.set('state', state)
  googleAuthUrl.searchParams.set('access_type', 'offline')
  googleAuthUrl.searchParams.set('prompt', 'consent select_account')

  return NextResponse.redirect(googleAuthUrl.toString())
}
