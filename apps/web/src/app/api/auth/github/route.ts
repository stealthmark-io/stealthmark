import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  isGitHubConfigured,
  getAppUrl,
  OAUTH_STATE_COOKIE_NAME,
} from '@/lib/auth'

export async function GET(request: Request) {
  const appUrl = getAppUrl(request.url)

  if (!isGitHubConfigured()) {
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

  const redirectUri = `${appUrl}/api/auth/callback/github`
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize')
  githubAuthUrl.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID!)
  githubAuthUrl.searchParams.set('redirect_uri', redirectUri)
  githubAuthUrl.searchParams.set('scope', 'read:user user:email')
  githubAuthUrl.searchParams.set('state', state)

  return NextResponse.redirect(githubAuthUrl.toString())
}
