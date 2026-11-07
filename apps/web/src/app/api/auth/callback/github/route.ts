import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  createSessionToken,
  upsertUserInBackend,
  getAppUrl,
  SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
} from '@/lib/auth'
import { AuthFlowError, loginErrorCode, pickVerifiedGithubEmail } from '@/lib/verified-email'

export async function GET(request: Request) {
  const appUrl = getAppUrl(request)
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code) {
    console.error('[GitHub OAuth Error]:', error || 'Missing authorization code')
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error || 'oauth_cancelled')}`, appUrl))
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value
  cookieStore.delete(OAUTH_STATE_COOKIE_NAME)

  if (!storedState || storedState !== state) {
    console.error('[GitHub OAuth CSRF Error]: State mismatch')
    return NextResponse.redirect(new URL('/login?error=csrf_validation_failed', appUrl))
  }

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    })

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to obtain GitHub access token')
    }

    const accessToken = tokenData.access_token

    // 2. Fetch GitHub user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'StealthMark-Auth-Client',
      },
    })
    const githubUser = await userRes.json()

    // 3. Resolve the primary verified email; the public profile email is not proof of ownership
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'StealthMark-Auth-Client',
      },
    })
    const userEmail = emailRes.ok ? pickVerifiedGithubEmail(await emailRes.json()) : null
    if (!userEmail) {
      throw new AuthFlowError('email_not_verified')
    }

    // 4. Upsert user and auto-provision organization via Fastify backend (Opción A)
    const { user } = await upsertUserInBackend({
      email: userEmail,
      name: githubUser.name || githubUser.login,
      avatarUrl: githubUser.avatar_url,
      provider: 'github',
      externalId: String(githubUser.id),
    })

    // 5. Issue cryptographic session cookie
    const sessionToken = await createSessionToken(user)
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    return NextResponse.redirect(new URL('/console?auth=success&provider=github', appUrl))
  } catch (err) {
    console.error('[GitHub Callback Exception]:', err)
    return NextResponse.redirect(new URL(`/login?error=${loginErrorCode(err)}`, appUrl))
  }
}
