import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { isAdminEmail } from '@/lib/admin-auth'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value

    if (!sessionCookie) {
      return NextResponse.json({ authenticated: false, user: null })
    }

    const payload = await verifySessionToken(sessionCookie)
    if (!payload || !payload.user) {
      return NextResponse.json({ authenticated: false, user: null })
    }

    return NextResponse.json({
      authenticated: true,
      user: payload.user,
      isAdmin: isAdminEmail(payload.user.email),
      expiresAt: payload.exp,
    })
  } catch (error) {
    console.error('[Session API Error]:', error)
    return NextResponse.json({ authenticated: false, user: null }, { status: 500 })
  }
}
